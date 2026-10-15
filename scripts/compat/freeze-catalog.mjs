// SPDX-License-Identifier: GPL-3.0-only
// Offline byte freeze. freeze.json is private; public exports are explicit allowlists.
import { constants } from 'node:fs';
import { lstat, open, readdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { jarUrlKey } from '../../backend/spider-runtime/artifact-cache.mjs';

const SELF = fileURLToPath(import.meta.url);
const REPOSITORY = resolve(dirname(SELF), '../..');
const FREEZE = 'freeze.json';
const REQUIRED = ['index.html', 'site-config.json', 'list.txt', 'inventory.json', 'artifact-inventory.json', 'input-manifest.json'];
const DEFAULT_SCRIPTS = ['scripts/compat/capture-catalog.mjs', 'scripts/compat/freeze-catalog.mjs', 'scripts/container/jar-matrix-probe.mjs', 'scripts/compat/compare-jar-matrix.mjs'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const semanticHash = value => hash(JSON.stringify(canonical(value)));
const assert = (condition, code) => { if (!condition) throw new Error('FREEZE_' + code); };
const shaPattern = /^[a-f0-9]{64}$/;
const label = value => {
  const text = String(value ?? '');
  return text.length > 160 || /(?:https?:|:\/\/|[?=&\r\n]|bearer\s|(?:token|password|secret|authorization)[:\s])/i.test(text) ? 'sha256:' + hash(text) : text;
};
const roleOf = value => { assert(['main', 'site'].includes(value), 'ROLE'); return value; };
const route = api => api.endsWith('.js') || api.includes('.js?') ? 'js' : api.includes('.py') ? 'py' : 'jar';
const extBytes = value => typeof value === 'string' ? value : JSON.stringify(value ?? '');
const contained = (root, path) => { const rel = relative(root, path); return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep); };

function inputPath(root, file) {
  assert(typeof file === 'string' && file.length > 0 && !file.includes('\\') && !file.includes('\0')
    && !isAbsolute(file) && !/^[A-Za-z]:/.test(file) && file.split('/').every(part => part && part !== '.' && part !== '..'), 'PATH');
  const path = resolve(root, file);
  assert(contained(root, path), 'PATH');
  return path;
}

async function privateRoot(directory) {
  const requested = resolve(directory);
  const info = await lstat(requested);
  assert(info.isDirectory() && !info.isSymbolicLink(), 'ROOT');
  return realpath(requested);
}

async function regularFile(root, file) {
  const path = inputPath(root, file);
  const parts = file.split('/');
  let current = root;
  for (let i = 0; i < parts.length; i++) {
    current = join(current, parts[i]);
    const info = await lstat(current);
    assert(!info.isSymbolicLink() && (i === parts.length - 1 ? info.isFile() : info.isDirectory()), 'SYMLINK_OR_SPECIAL_FILE');
  }
  assert(contained(root, await realpath(path)), 'PATH');
  return path;
}

async function readStable(root, file, { bytes = false } = {}) {
  const path = await regularFile(root, file);
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const before = await handle.stat({ bigint: true });
    assert(before.isFile(), 'SPECIAL_FILE');
    const digest = createHash('sha256'), chunks = [], buffer = Buffer.alloc(1024 * 1024);
    let size = 0;
    for (;;) {
      const result = await handle.read(buffer, 0, buffer.length, null);
      if (!result.bytesRead) break;
      const chunk = buffer.subarray(0, result.bytesRead);
      digest.update(chunk); size += result.bytesRead;
      if (bytes) chunks.push(Buffer.from(chunk));
    }
    const after = await handle.stat({ bigint: true });
    const pathInfo = await lstat(path, { bigint: true });
    assert(['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].every(key => before[key] === after[key] && after[key] === pathInfo[key]) && !pathInfo.isSymbolicLink(), 'CHANGED_DURING_READ');
    await regularFile(root, file);
    return { file, sha256: digest.digest('hex'), bytes: size, ...(bytes ? { content: Buffer.concat(chunks) } : {}) };
  } finally { await handle.close(); }
}

async function inputFiles(root) {
  const files = [];
  async function visit(directory, prefix = '') {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const file = prefix + entry.name;
      if (!prefix && file === FREEZE) continue;
      inputPath(root, file);
      assert(!entry.isSymbolicLink(), 'SYMLINK_OR_SPECIAL_FILE');
      if (entry.isDirectory()) await visit(join(directory, entry.name), file + '/');
      else { assert(entry.isFile(), 'SYMLINK_OR_SPECIAL_FILE'); files.push(file); }
    }
  }
  await visit(root);
  return files.sort();
}

async function snapshot(root) {
  const names = await inputFiles(root), files = [];
  for (const file of names) files.push(await readStable(root, file));
  assert(JSON.stringify(names) === JSON.stringify(await inputFiles(root)), 'CHANGED_DURING_SNAPSHOT');
  return files;
}

async function readPinned(root, file, files, expected) {
  const pin = files.get(file);
  assert(pin, 'UNLISTED_FILE');
  const actual = await readStable(root, file, { bytes: true });
  assert(actual.sha256 === pin.sha256 && actual.bytes === pin.bytes && (!expected || actual.sha256 === expected), 'CHECKSUM');
  return actual.content;
}

async function pinnedJson(root, file, files, expected) {
  return JSON.parse((await readPinned(root, file, files, expected)).toString('utf8'));
}

function bindingSummary(bindings) {
  const executable = bindings.filter(row => row.kind === 'jar-csp');
  // Keep the original SHA/null denominator stable for already-frozen manifests.
  // Missing bytes require their original signature hash or unrelated downloads
  // collapse together. The main artifact uses the same fallback independently.
  const artifactIdentity = row => row?.artifactSha256 ? ['artifact-sha256', row.artifactSha256]
    : ['signature-sha256', row?.signatureSha256 || hash(row?.signature || '')];
  const roleContextKey = row => JSON.stringify([artifactIdentity(row), row.role, artifactIdentity(row.main), row.api, row.executionExtSha256]);
  // Match loaderContextOf(...).identity for executable plans; retain the original
  // main signature even when its bytes are missing and no plan can be executed.
  const signatureContextKey = row => JSON.stringify([artifactIdentity(row), {
    loaderMode: row.role, jarSignatureSha256: hash(row.signature),
    jarLoadKey: row.role === 'main' ? 'main' : jarUrlKey(row.signature),
    mainJarSha256: row.role === 'site' && row.main.signature ? row.main.artifactSha256 || null : null,
    mainSignatureSha256: row.role === 'site' && row.main.signature ? hash(row.main.signature) : null,
  }, row.api, row.executionExtSha256]);
  return {
    bindings: bindings.length, executableReferences: executable.length,
    executableRoleVariants: new Set(executable.map(row => JSON.stringify([row.artifactSha256, row.role, row.main.artifactSha256, row.api, row.executionExtSha256]))).size,
    executableCapturedVariants: new Set(executable.filter(row => row.artifactSha256).map(row => JSON.stringify([row.artifactSha256, row.api, row.executionExtSha256]))).size,
    executableRoleContextVariants: new Set(executable.map(roleContextKey)).size,
    executableCapturedRoleContextVariants: new Set(executable.filter(row => row.artifactSha256).map(roleContextKey)).size,
    executableUnavailableRoleContextVariants: new Set(executable.filter(row => !row.artifactSha256).map(roleContextKey)).size,
    executableSignatureContextVariants: new Set(executable.map(signatureContextKey)).size,
    executableCapturedSignatureContextVariants: new Set(executable.filter(row => row.artifactSha256).map(signatureContextKey)).size,
    executableUnavailableSignatureContextVariants: new Set(executable.filter(row => !row.artifactSha256).map(signatureContextKey)).size,
    mainBindings: bindings.filter(row => row.role === 'main').length,
    siteBindings: bindings.filter(row => row.role === 'site').length,
    unavailableBindings: bindings.filter(row => !row.retrievalOk).length,
    helperBindings: bindings.filter(row => row.kind !== 'jar-csp').length,
  };
}

function artifactResponseSummary(retrievals, root, files) {
  const summary = { retrievalsWithoutResponseMetadata: 0, responseReferences: 0, completeBodies: 0, prefixBodies: 0, uncapturedBodies: 0 };
  for (const retrieval of retrievals) {
    // Legacy captures and owned fixtures did not record HTTP transport bodies.
    if (!Object.hasOwn(retrieval, 'responses')) { summary.retrievalsWithoutResponseMetadata++; continue; }
    assert(Array.isArray(retrieval.responses), 'ARTIFACT_RESPONSE_SCHEMA');
    for (const response of retrieval.responses) {
      summary.responseReferences++;
      assert(response && typeof response === 'object' && !Array.isArray(response)
        && ['jar', 'image-jar', 'remote-md5'].includes(response.kind)
        && typeof response.complete === 'boolean' && typeof response.bodyCaptured === 'boolean', 'ARTIFACT_RESPONSE_SCHEMA');
      assert(!response.complete || response.bodyCaptured, 'ARTIFACT_RESPONSE_COMPLETE_WITHOUT_BODY');
      if (!response.bodyCaptured) {
        assert(['file', 'sha256', 'bytes', 'observedBytes'].every(key => !Object.hasOwn(response, key)), 'ARTIFACT_RESPONSE_UNCAPTURED_BODY');
        summary.uncapturedBodies++; continue;
      }
      inputPath(root, response.file);
      assert(/^artifact-responses\/[A-Za-z0-9][A-Za-z0-9._-]*\.bin$/.test(response.file), 'ARTIFACT_RESPONSE_PATH');
      assert(typeof response.sha256 === 'string' && shaPattern.test(response.sha256)
        && Number.isSafeInteger(response.bytes) && response.bytes >= 0
        && Number.isSafeInteger(response.observedBytes) && response.observedBytes >= response.bytes, 'ARTIFACT_RESPONSE_SCHEMA');
      const pin = files.get(response.file);
      assert(pin && pin.sha256 === response.sha256 && pin.bytes === response.bytes, 'ARTIFACT_RESPONSE_CHECKSUM');
      if (response.complete) {
        assert(response.observedBytes === response.bytes, 'ARTIFACT_RESPONSE_COMPLETE_SIZE');
        summary.completeBodies++;
      } else {
        assert(response.error && typeof response.error === 'object' && typeof response.error.code === 'string', 'ARTIFACT_RESPONSE_PREFIX_WITHOUT_ERROR');
        summary.prefixBodies++;
      }
    }
  }
  return { ...summary,
    byteScope: 'Captured fetch response bytes precede text/image decoding; HTTP content encoding may already be decompressed. complete=false/bodyCaptured=true pins only the retained received prefix, never a complete response. observedBytes may exceed prefix bytes after a size-limit rejection. bodyCaptured=false pins no response body. Shared cache references may name the same pinned file.' };
}

async function reconstruct(root, files) {
  for (const file of REQUIRED) assert(files.has(file), 'MISSING_REQUIRED_FILE');
  const inventory = await pinnedJson(root, 'inventory.json', files);
  const artifacts = await pinnedJson(root, 'artifact-inventory.json', files);
  const manifest = await pinnedJson(root, 'input-manifest.json', files);
  assert(Array.isArray(inventory.entries) && Array.isArray(artifacts.retrievals) && Array.isArray(artifacts.artifacts) && Array.isArray(manifest.artifacts), 'SCHEMA');
  const artifactResponseCapture = artifactResponseSummary(artifacts.retrievals, root, files);
  const artifactBySha = new Map();
  for (const artifact of manifest.artifacts) {
    assert(shaPattern.test(artifact.sha256) && artifact.id === artifact.sha256 && !artifactBySha.has(artifact.sha256), 'ARTIFACT_ID');
    const bytes = files.get(artifact.jarPath);
    inputPath(root, artifact.jarPath);
    assert(bytes && bytes.sha256 === artifact.sha256 && bytes.bytes === artifact.bytes, 'ARTIFACT_CHECKSUM');
    artifactBySha.set(artifact.sha256, { sha256: artifact.sha256, jarPath: artifact.jarPath, bytes: bytes.bytes, roles: [] });
  }
  assert(artifactBySha.size === artifacts.artifacts.length, 'ARTIFACT_INVENTORY');
  const inspected = new Set();
  for (const artifact of artifacts.artifacts) {
    const row = artifactBySha.get(artifact.sha256);
    assert(row && !inspected.has(artifact.sha256) && row.bytes === artifact.bytes && row.jarPath === artifact.jarPath, 'ARTIFACT_INVENTORY');
    inspected.add(artifact.sha256);
    row.validContent = artifact.inspection?.ok === true;
    row.inspection = artifact.inspection;
  }
  const retrievals = new Map();
  for (const row of artifacts.retrievals) {
    roleOf(row.role);
    assert(typeof row.signature === 'string', 'SIGNATURE');
    const key = row.role + '\0' + row.signature;
    assert(!retrievals.has(key), 'DUPLICATE_RETRIEVAL');
    if (row.ok) {
      const artifact = artifactBySha.get(row.sha256);
      assert(artifact && row.bytes === artifact.bytes, 'RETRIEVAL_CHECKSUM');
      if (!artifact.roles.includes(row.role)) artifact.roles.push(row.role);
    }
    retrievals.set(key, row);
  }
  const bindings = [], captures = [], seen = new Set(), matchedRetrievals = new Set();
  const retrieval = (signature, role) => {
    const row = retrievals.get(role + '\0' + signature);
    return { signature, signatureSha256: hash(signature), retrievalOk: !!row?.ok, artifactSha256: row?.ok ? row.sha256 : null,
      ...(row?.error?.code ? { errorCode: row.error.code } : {}), ...(!row ? { unrecordedRetrieval: true } : {}) };
  };
  for (const entry of inventory.entries) {
    assert(entry && typeof entry.id === 'string' && !seen.has(entry.id), 'CAPTURE_ID');
    inputPath(root, 'captures/' + entry.id + '/metadata.json'); seen.add(entry.id);
    const metadataFile = 'captures/' + entry.id + '/metadata.json';
    assert(files.has(metadataFile), 'MISSING_CAPTURE_METADATA');
    const metadata = await pinnedJson(root, metadataFile, files);
    assert(metadata.id === entry.id, 'CAPTURE_METADATA');
    for (const response of entry.responses || []) {
      assert(typeof response.file === 'string' && !response.file.includes('/'), 'PATH');
      const path = 'captures/' + entry.id + '/' + response.file;
      inputPath(root, path);
      const pin = files.get(path);
      assert(pin && pin.sha256 === response.sha256 && pin.bytes === response.bytes, 'RESPONSE_CHECKSUM');
    }
    const configFile = entry.configFile || entry.partialConfigFile;
    const capture = { id: entry.id, publicName: entry.publicName, catalogFile: entry.catalogFile, origin: entry.origin,
      accepted: !!entry.parseSuccess, partial: !!entry.partialConfigFile, responses: (entry.responses || []).length };
    captures.push(capture);
    if (!configFile) { assert(!entry.parseSuccess, 'MISSING_CONFIG'); continue; }
    assert(configFile.startsWith('captures/' + entry.id + '/'), 'CONFIG_PATH');
    const expected = entry.configSha256 || entry.partialConfigSha256;
    assert(shaPattern.test(expected), 'CONFIG_CHECKSUM');
    const config = await pinnedJson(root, configFile, files, expected);
    assert(!entry.configSemanticSha256 || semanticHash(config) === entry.configSemanticSha256, 'CONFIG_SEMANTIC_CHECKSUM');
    assert(Array.isArray(config.sites), 'CONFIG_SCHEMA');
    Object.assign(capture, { configFile, configSha256: expected, configSemanticSha256: semanticHash(config) });
    const mainSignature = config.globals?.spider || '';
    assert(typeof mainSignature === 'string', 'SIGNATURE');
    const main = retrieval(mainSignature, 'main');
    const add = (role, signature, kind, source, siteIndex) => {
      assert(typeof signature === 'string', 'SIGNATURE');
      const retrievalKey = role + '\0' + signature;
      assert(retrievals.has(retrievalKey), 'MISSING_RETRIEVAL');
      matchedRetrievals.add(retrievalKey);
      const relation = { captureId: entry.id, publicName: entry.publicName, origin: entry.origin, partial: !entry.parseSuccess,
        configFile, configSha256: expected, role, kind, ...retrieval(signature, role), main, jarCache: config.globals?.jarCache ?? '' };
      if (source) Object.assign(relation, { siteIndex, source, sourceKey: source.key, api: source.api,
        extPresent: Object.hasOwn(source, 'ext'), ext: source.ext === undefined ? '' : source.ext,
        executionExtSha256: hash(extBytes(source.ext)), canonicalExtSha256: semanticHash(source.ext === undefined ? '' : source.ext) });
      relation.id = semanticHash([entry.id, role, signature, siteIndex ?? null, kind]);
      bindings.push(relation);
    };
    let mainSources = 0;
    for (let index = 0; index < config.sites.length; index++) {
      const site = config.sites[index];
      if (site.type !== 3) continue;
      assert(typeof site.api === 'string', 'SOURCE_API');
      const kind = route(site.api);
      if (site.jar) add('site', site.jar, kind === 'jar' ? 'jar-csp' : kind + '-helper', site, index);
      else if (kind === 'jar') { mainSources++; add('main', mainSignature, 'jar-csp', site, index); }
    }
    if (mainSignature && !mainSources) add('main', mainSignature, 'unused-main');
  }
  assert(matchedRetrievals.size === retrievals.size, 'UNREFERENCED_RETRIEVAL');
  return { limits: manifest.limits || {}, captures, artifacts: [...artifactBySha.values()], bindings, artifactResponseCapture,
    summary: { catalogEntries: captures.length, accepted: captures.filter(row => row.accepted).length, partial: captures.filter(row => row.partial).length,
      artifacts: artifactBySha.size, validContent: [...artifactBySha.values()].filter(row => row.validContent).length,
      retrievals: retrievals.size, retrievalFailures: [...retrievals.values()].filter(row => !row.ok).length, ...bindingSummary(bindings) } };
}

const immutableCore = freeze => Object.fromEntries(Object.entries(freeze).filter(([key]) => !['inputSetSha256', 'runs'].includes(key)));

async function writePrivate(root, value, { create = false } = {}) {
  const path = join(root, FREEZE);
  if (create) { await writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); return; }
  await regularFile(root, FREEZE);
  const pending = join(root, '.freeze-' + randomUUID());
  try { await writeFile(pending, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); await rename(pending, path); }
  finally { await unlink(pending).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

/** Stops if the capture is incomplete, any recorded checksum differs, or a link is found. */
export async function freezeCatalog({ directory, metadata = {}, repository = REPOSITORY, scriptPaths = DEFAULT_SCRIPTS } = {}) {
  const root = await privateRoot(directory), files = await snapshot(root), pins = new Map(files.map(row => [row.file, row]));
  const reconstructed = await reconstruct(root, pins);
  const scripts = [];
  for (const file of scriptPaths) {
    const pin = await readStable(await privateRoot(repository), file);
    scripts.push(pin);
  }
  const freeze = { schemaVersion: 1, createdAt: new Date().toISOString(),
    scope: 'Frozen capture bytes and original loader associations; no loading or business-success claim',
    nodeVersion: process.version, files, filesSha256: semanticHash(files), scripts, metadata, ...reconstructed, runs: [] };
  freeze.inputSetSha256 = semanticHash(immutableCore(freeze));
  // Re-read every byte before publication so metadata reconstruction cannot hide a concurrent capture write.
  assert(semanticHash(files) === semanticHash(await snapshot(root)), 'CHANGED_DURING_FREEZE');
  await writePrivate(root, freeze, { create: true });
  return freeze;
}

async function readFreeze(root) {
  const bytes = await readStable(root, FREEZE, { bytes: true });
  const freeze = JSON.parse(bytes.content.toString('utf8'));
  assert(freeze.schemaVersion === 1 && Array.isArray(freeze.files) && Array.isArray(freeze.bindings) && Array.isArray(freeze.runs), 'SCHEMA');
  assert(semanticHash(immutableCore(freeze)) === freeze.inputSetSha256, 'MANIFEST_CHECKSUM');
  assert(freeze.runs.every(row => row && row.metadataSha256 === semanticHash(row.metadata)), 'RUN_METADATA_CHECKSUM');
  return freeze;
}

/** Checks the complete root tree. Write execution reports outside this root. */
export async function verifyCatalogFreeze({ directory } = {}) {
  const root = await privateRoot(directory), freeze = await readFreeze(root);
  const actual = await snapshot(root);
  assert(semanticHash(actual) === semanticHash(freeze.files), 'INPUT_CHANGED');
  // Validate raw-body metadata links for existing schema-1 freezes too; never
  // rewrite their manifest merely because the validation code gained checks.
  const { artifactResponseCapture } = await reconstruct(root, new Map(actual.map(row => [row.file, row])));
  return { ok: true, inputSetSha256: freeze.inputSetSha256, files: actual.length,
    bytes: actual.reduce((sum, file) => sum + file.bytes, 0), artifactResponseCapture };
}

/** Append private run parameters only after verifying every frozen input byte. */
export async function appendFreezeRun({ directory, metadata } = {}) {
  await verifyCatalogFreeze({ directory });
  const root = await privateRoot(directory), freeze = await readFreeze(root);
  freeze.runs.push({ recordedAt: new Date().toISOString(), metadata, metadataSha256: semanticHash(metadata) });
  await writePrivate(root, freeze);
  return freeze;
}

/** No URLs, signatures, keys, ext values, arbitrary metadata, or raw paths cross this boundary. */
export function publicFreezeSummary(freeze) {
  return { schemaVersion: 1, createdAt: freeze.createdAt, inputSetSha256: freeze.inputSetSha256, filesSha256: freeze.filesSha256,
    scope: freeze.scope, nodeVersion: label(freeze.nodeVersion), summary: { ...freeze.summary, ...bindingSummary(freeze.bindings) },
    roleContextVariantIdentity: 'Target JAR SHA256, or original signature SHA256 when unavailable; original role; main JAR SHA256, or original main signature SHA256 when unavailable; API; actual execution-ext SHA256. Captured and unavailable counts concern the target JAR, not main availability or execution success.',
    signatureContextVariantIdentity: 'Target JAR SHA256, or original signature SHA256 when unavailable; loaderContextOf identity containing role, full original signature SHA256, original JarLoader key (main or site signature MD5), coexisting main JAR SHA256 and full main signature SHA256; API; actual execution-ext SHA256. A missing configured main retains its signature SHA256 with a null main JAR SHA256. Captured and unavailable counts concern target bytes, not executable completeness or success.',
    files: freeze.files.map(row => ({ pathSha256: hash(row.file), sha256: row.sha256, bytes: row.bytes })),
    scripts: freeze.scripts.map(row => ({ file: label(row.file), sha256: row.sha256, bytes: row.bytes })),
    metadataSha256: semanticHash(freeze.metadata), runMetadataSha256: freeze.runs.map(row => row.metadataSha256),
    ...(freeze.artifactResponseCapture ? { artifactResponseCapture: freeze.artifactResponseCapture } : {}),
    limits: Object.fromEntries(Object.entries(freeze.limits).filter(([key, value]) => /^[A-Za-z]+$/.test(key) && Number.isSafeInteger(value) && value >= 0)),
    artifacts: freeze.artifacts.map(row => ({ sha256: row.sha256, bytes: row.bytes, roles: row.roles, validContent: row.validContent })),
    associations: freeze.bindings.map(row => ({ id: row.id, catalogName: label(row.publicName), role: row.role, kind: row.kind,
      artifactSha256: row.artifactSha256, mainArtifactSha256: row.main.artifactSha256, retrievalOk: row.retrievalOk,
      ...(row.api === undefined ? {} : { api: label(row.api), executionExtSha256: row.executionExtSha256, canonicalExtSha256: row.canonicalExtSha256 }) })) };
}

/** Historical outcomes are connected exclusively by SHA; names identify association changes only. */
export function compareFrozenHistory(freeze, comparison, catalog) {
  assert(Array.isArray(comparison.artifacts) && Array.isArray(catalog.artifacts) && Array.isArray(catalog.retrieval?.retrievals), 'HISTORY_SCHEMA');
  const current = new Set(freeze.artifacts.map(row => row.sha256));
  const old = new Set([...comparison.artifacts, ...catalog.artifacts].map(row => row.sha256));
  for (const sha of old) assert(shaPattern.test(sha), 'HISTORY_SHA');
  const groups = new Map();
  const group = (name, role) => {
    roleOf(role);
    const catalogName = label(name), key = JSON.stringify([catalogName, role]);
    if (!groups.has(key)) groups.set(key, { catalogName, role, previous: new Set(), current: new Set(), currentRetrievalFailures: 0 });
    return groups.get(key);
  };
  for (const row of catalog.retrieval.retrievals) for (const name of row.catalogNames || []) {
    const association = group(name, row.role);
    if (row.ok && shaPattern.test(row.sha256)) association.previous.add(row.sha256);
  }
  for (const row of freeze.bindings) {
    const association = group(row.publicName, row.role);
    if (row.artifactSha256) association.current.add(row.artifactSha256);
    else association.currentRetrievalFailures++;
  }
  const associations = [...groups.values()].map(row => {
    const previous = [...row.previous].sort(), now = [...row.current].sort();
    const status = !previous.length ? now.length ? 'new' : 'unavailable' : !now.length ? 'missing' : JSON.stringify(previous) === JSON.stringify(now) ? 'same' : 'changed';
    return { catalogName: row.catalogName, role: row.role, status, previousSha256: previous, currentSha256: now,
      removedSha256: previous.filter(sha => !row.current.has(sha)), addedSha256: now.filter(sha => !row.previous.has(sha)), currentRetrievalFailures: row.currentRetrievalFailures };
  });
  const exactShaMatches = [...current].filter(sha => old.has(sha)).sort().map(sha256 => {
    const comparisonRow = comparison.artifacts.find(row => row.sha256 === sha256);
    const catalogRow = catalog.artifacts.find(row => row.sha256 === sha256);
    const loadState = value => ['loaded', 'failed', 'unknown'].includes(value) ? value : 'unknown';
    const initState = value => ['ready', 'failed', 'unknown'].includes(value) ? value : 'unknown';
    const pinnedHash = value => typeof value === 'string' && shaPattern.test(value) ? value : undefined;
    return { sha256,
      comparison: comparisonRow ? { oldLoad: loadState(comparisonRow.oldLoad), newLoad: loadState(comparisonRow.newLoad),
        variants: (Array.isArray(comparisonRow.variants) ? comparisonRow.variants : []).filter(row => row && typeof row === 'object').map(row => ({ api: label(typeof row.api === 'string' ? row.api : ''),
          executionExtSha256: pinnedHash(row.executionExtSha256), captureExtSha256: pinnedHash(row.captureExtSha256),
          oldInit: initState(row.old?.init), newInit: initState(row.new?.init) })) } : null,
      catalog: catalogRow ? { catalogNames: (Array.isArray(catalogRow.catalogNames) ? catalogRow.catalogNames : []).filter(value => typeof value === 'string').map(label),
        referencedRoles: [...new Set((Array.isArray(catalogRow.referencedRoles) ? catalogRow.referencedRoles : []).filter(value => value === 'main' || value === 'site'))],
        loadedAtLeastOnce: typeof catalogRow.execution?.loadedAtLeastOnce === 'boolean' ? catalogRow.execution.loadedAtLeastOnce : null } : null };
  });
  const missingSha256 = [...old].filter(sha => !current.has(sha)).sort(), newSha256 = [...current].filter(sha => !old.has(sha)).sort();
  return { schemaVersion: 1, generatedAt: new Date().toISOString(), inputSetSha256: freeze.inputSetSha256,
    scope: 'Cross-round historical observations; outcomes join only identical JAR SHA256. Directory/role associations describe changed, missing and new bytes, never execution equivalence.',
    historicalRoleCoverage: 'The old comparison selected one role per JAR SHA. An exact SHA match does not establish main/site or API/ext coverage for this round.',
    historicalComparisonCanonicalSha256: semanticHash(comparison), historicalCatalogCanonicalSha256: semanticHash(catalog),
    summary: { currentArtifacts: current.size, historicalArtifacts: old.size, exactShaMatches: exactShaMatches.length, missingArtifacts: missingSha256.length, newArtifacts: newSha256.length,
      associationStates: associations.reduce((counts, row) => ({ ...counts, [row.status]: (counts[row.status] || 0) + 1 }), {}) },
    exactShaMatches, missingSha256, newSha256, associations };
}

async function publicOutput(path, value, root) {
  if (!path) { process.stdout.write(JSON.stringify(value, null, 2) + '\n'); return; }
  const target = resolve(path);
  const actualTarget = join(await realpath(dirname(target)), basename(target));
  assert(!contained(root, actualTarget), 'OUTPUT_INSIDE_INPUT');
  await writeFile(target, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}

async function main(argv) {
  const [command = 'help', ...args] = argv, options = {};
  assert(args.length % 2 === 0, 'CLI_ARGUMENT');
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    assert(['--directory', '--metadata', '--output', '--history-comparison', '--history-catalog'].includes(option) && !Object.hasOwn(options, option), 'CLI_ARGUMENT');
    options[option] = args[index + 1];
  }
  if (command === 'help') {
    process.stdout.write('Usage: node scripts/compat/freeze-catalog.mjs freeze|verify|append-run|history --directory PRIVATE_CAPTURE_ROOT [--metadata PRIVATE_JSON] [--output PUBLIC_JSON] [--history-comparison JSON] [--history-catalog JSON]\nWrite execution reports outside the frozen root. freeze.json contains private configuration/ext and must never be committed.\n'); return;
  }
  assert(options['--directory'], 'CLI_DIRECTORY');
  const directory = options['--directory'], root = await privateRoot(directory);
  if (command === 'verify') { await publicOutput(options['--output'], await verifyCatalogFreeze({ directory }), root); return; }
  if (command === 'freeze' || command === 'append-run') {
    const metadata = options['--metadata'] ? JSON.parse(await readFile(options['--metadata'], 'utf8')) : {};
    const freeze = command === 'freeze' ? await freezeCatalog({ directory, metadata }) : await appendFreezeRun({ directory, metadata });
    await publicOutput(options['--output'], publicFreezeSummary(freeze), root); return;
  }
  assert(command === 'history', 'CLI_COMMAND');
  await verifyCatalogFreeze({ directory });
  const freeze = await readFreeze(root);
  const comparisonBytes = await readFile(options['--history-comparison'] || join(REPOSITORY, 'docs/linux/post-repair-catalog-comparison.json'));
  const catalogBytes = await readFile(options['--history-catalog'] || join(REPOSITORY, 'docs/linux/catalog-matrix-probe.json'));
  const history = compareFrozenHistory(freeze, JSON.parse(comparisonBytes), JSON.parse(catalogBytes));
  Object.assign(history, { historicalComparisonFileSha256: hash(comparisonBytes), historicalCatalogFileSha256: hash(catalogBytes) });
  await publicOutput(options['--output'], history, root);
}

if (process.argv[1] && resolve(process.argv[1]) === SELF) {
  await main(process.argv.slice(2)).catch(error => {
    // Parser exceptions and OS error messages can contain private data or paths.
    process.stderr.write(JSON.stringify({ ok: false, code: /^FREEZE_[A-Z_]+$/.test(error.message) ? error.message : 'FREEZE_IO_OR_SCHEMA', errorSha256: hash(String(error.message)) }) + '\n');
    process.exitCode = 1;
  });
}
