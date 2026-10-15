// SPDX-License-Identifier: GPL-3.0-only
// Offline ART/NAS plan preparation from byte-verified original loader bindings.
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyCatalogFreeze } from '../compat/freeze-catalog.mjs';
import { loaderContextOf } from './loader-context.mjs';

const SELF = fileURLToPath(import.meta.url);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const identity = value => sha(JSON.stringify(canonical(value)));
const hashPattern = /^[a-f0-9]{64}$/;
const check = (condition, code) => { if (!condition) throw new Error('ROLE_FIXTURE_' + code); };
const contained = (root, path) => { const rel = relative(root, path); return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep); };
const safeLabel = value => {
  const text = String(value ?? '');
  return text.length > 160 || /(?:https?:|:\/\/|[?=&\r\n]|bearer\s|(?:token|password|secret|authorization)[:\s])/i.test(text) ? 'sha256:' + sha(text) : text;
};

function baseUrl(value) {
  const url = new URL(value);
  check(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash, 'BASE_URL');
  return url.href.replace(/\/+$/, '');
}

function selectionOf(selection) {
  check(selection && Array.isArray(selection.sha256) && selection.sha256.length > 0
    && selection.sha256.every(value => typeof value === 'string' && hashPattern.test(value)), 'SELECTION');
  check(new Set(selection.sha256).size === selection.sha256.length, 'DUPLICATE_SELECTION');
  return selection.sha256;
}

function bindingReference(binding) {
  return { bindingId: binding.id, captureId: binding.captureId, configSha256: binding.configSha256,
    sourceKey: binding.sourceKey, publicName: binding.publicName, partial: binding.partial };
}

function publicMissing(row) {
  return { sha256: row.sha256, reason: row.reason, ...(row.role ? { role: row.role } : {}),
    ...(row.bindingId ? { bindingId: row.bindingId } : {}),
    ...(row.loaderContextSha256 ? { loaderContextSha256: row.loaderContextSha256 } : {}),
    ...(row.mainArtifactSha256 ? { mainArtifactSha256: row.mainArtifactSha256 } : {}),
    ...(row.configSha256 ? { configSha256: row.configSha256 } : {}),
    ...(row.captureId ? { captureIdSha256: sha(row.captureId) } : {}) };
}

/** Pure transformation; callers supplying a freeze must verify it before using this API. */
export function buildRoleFixturePlan(freeze, selection, {
  base = 'http://10.0.2.2:18765', allContexts = false,
} = {}) {
  const selected = selectionOf(selection), urlBase = baseUrl(base);
  check(freeze?.schemaVersion === 1 && hashPattern.test(freeze.inputSetSha256)
    && Array.isArray(freeze.artifacts) && Array.isArray(freeze.bindings), 'FREEZE_SCHEMA');
  const bySha = new Map(freeze.artifacts.map(row => [row.sha256, row]));
  const artifacts = [], unexecuted = [], deferred = [], selectedContexts = [];
  const missing = (sha256, reason, binding, contextSha) => unexecuted.push({ sha256, reason,
    ...(binding ? { bindingId: binding.id, role: binding.role, captureId: binding.captureId,
      configSha256: binding.configSha256, sourceKey: binding.sourceKey, api: binding.api,
      mainArtifactSha256: binding.main?.artifactSha256, signature: binding.signature } : {}),
    ...(contextSha ? { loaderContextSha256: contextSha } : {}) });
  for (const sha256 of selected) {
    const artifact = bySha.get(sha256);
    if (!artifact) { missing(sha256, 'selected-sha-not-captured'); continue; }
    if (!artifact.validContent) { missing(sha256, 'selected-content-invalid'); continue; }
    const bindings = freeze.bindings.filter(row => row.artifactSha256 === sha256 && row.kind === 'jar-csp');
    if (!bindings.length) { missing(sha256, 'no-original-executable-binding'); continue; }
    const contexts = new Map();
    for (const binding of bindings) {
      check(['main', 'site'].includes(binding.role) && typeof binding.signature === 'string'
        && binding.source && typeof binding.source.api === 'string', 'BINDING_SCHEMA');
      const mainSignature = binding.main?.signature || '';
      const contextPin = { role: binding.role, signature: binding.signature,
        ...(binding.role === 'site' && mainSignature ? { main: { signature: mainSignature, sha256: binding.main.artifactSha256 || null } } : {}) };
      const unavailableContextSha256 = identity(contextPin);
      let reason;
      if (!binding.retrievalOk) reason = 'selected-artifact-not-retrieved';
      else if (binding.role === 'site' && mainSignature && !binding.main.retrievalOk) reason = 'original-main-not-captured';
      else if (binding.role === 'site' && mainSignature && !bySha.get(binding.main.artifactSha256)?.validContent) reason = 'original-main-content-invalid';
      else if (typeof binding.source.ext !== 'string') reason = 'exact-string-ext-unavailable';
      else if (sha(binding.source.ext) !== binding.executionExtSha256) reason = 'exact-ext-hash-differs';
      else if (typeof binding.source.key !== 'string') reason = 'original-source-key-unavailable';
      else if (binding.source.type !== 3 || binding.source.api !== binding.api) reason = 'original-source-identity-differs';
      else if (binding.role === 'site' && binding.source.jar !== binding.signature) reason = 'original-site-signature-differs';
      else if (binding.role === 'main' && binding.source.jar) reason = 'original-main-role-differs';
      if (reason) { missing(sha256, reason, binding, unavailableContextSha256); continue; }
      const loaderContext = { role: binding.role, signature: binding.signature };
      if (binding.role === 'site' && mainSignature) {
        const main = bySha.get(binding.main.artifactSha256);
        loaderContext.main = { sha256: main.sha256, jarPath: main.jarPath,
          jarUrl: urlBase + '/artifacts/' + main.sha256 + '.jar', signature: mainSignature };
      }
      const jar = binding.role === 'site' ? binding.signature : '';
      const expectedLoaderIdentity = loaderContextOf(artifact, {
        api: binding.source.api, key: binding.source.key, ext: binding.source.ext, type: binding.source.type, jar, loaderContext,
      }).identity;
      const loaderContextSha256 = identity(expectedLoaderIdentity);
      if (!contexts.has(loaderContextSha256)) contexts.set(loaderContextSha256, { loaderContext, variants: new Map() });
      const context = contexts.get(loaderContextSha256), variantIdentity = identity([binding.source.api, binding.executionExtSha256]);
      if (context.variants.has(variantIdentity)) { context.variants.get(variantIdentity).references.push(bindingReference(binding)); continue; }
      const caseIdentitySha256 = identity([sha256, expectedLoaderIdentity, binding.source.api, binding.executionExtSha256]);
      // Calls are plan-owned instructions, never copied from provider-controlled source fields.
      const originalSource = { ...binding.source };
      for (const field of ['calls', 'loaderContext', 'expectedLoaderIdentity', 'caseIdentitySha256', 'loaderContextSha256', 'references',
        'symbolMap', 'targetApk', 'targetPackage']) delete originalSource[field];
      context.variants.set(variantIdentity, {
        ...originalSource, jar,
        ext: binding.source.ext, extSha256: binding.executionExtSha256, executionExtSha256: binding.executionExtSha256,
        canonicalExtSha256: binding.canonicalExtSha256, configSha256: binding.configSha256,
        captureId: binding.captureId, bindingId: binding.id, loaderContext, expectedLoaderIdentity, loaderContextSha256, caseIdentitySha256,
        references: [bindingReference(binding)],
      });
    }
    const sites = [];
    for (const [loaderContextSha256, context] of contexts) {
      const variants = [...context.variants.values()];
      const chosen = allContexts ? variants : variants.slice(0, 1);
      sites.push(...chosen);
      selectedContexts.push({ sha256, loaderContextSha256, role: context.loaderContext.role,
        mainArtifactSha256: context.loaderContext.main?.sha256 || null, uniqueVariants: variants.length, selectedVariants: chosen.length });
      for (const site of variants.slice(chosen.length)) deferred.push({ sha256, reason: 'representative-selection',
        role: site.loaderContext.role, loaderContextSha256, caseIdentitySha256: site.caseIdentitySha256,
        api: site.api, executionExtSha256: site.executionExtSha256, references: site.references });
    }
    if (sites.length) artifacts.push({ id: sha256, sha256, jarPath: artifact.jarPath,
      jarUrl: urlBase + '/artifacts/' + sha256 + '.jar', sites });
  }
  const summary = { selectedArtifacts: selected.length, executableArtifacts: artifacts.length,
    cases: artifacts.reduce((count, row) => count + row.sites.length, 0),
    loaderContexts: selectedContexts.length,
    mainCases: artifacts.reduce((count, row) => count + row.sites.filter(site => site.loaderContext.role === 'main').length, 0),
    siteCases: artifacts.reduce((count, row) => count + row.sites.filter(site => site.loaderContext.role === 'site').length, 0),
    unexecutedBindings: unexecuted.length, deferredVariants: deferred.length };
  const metadata = { sourceInputSetSha256: freeze.inputSetSha256, sourceFilesSha256: freeze.filesSha256,
    selectionSha256: identity(selection), allContexts, loaderContextIdentityRule: 'SHA256 of canonical loaderContextOf(...).identity from scripts/android/loader-context.mjs.', selectionRule: allContexts
      ? 'All unique original loader context/API/execution-ext combinations; exact duplicate references remain attached.'
      : 'First API/execution-ext per original role, exact loader signature, and configured main signature/SHA context in frozen binding order.',
    budgets: { ...freeze.limits }, budgetRule: 'Frozen NAS baseline limits recorded for provenance; ART runner deadlines must be recorded separately when executed.',
    calls: 'No explicit calls synthesized. ART-selected arguments must be replayed unchanged on NAS.',
    scope: 'Prepared inputs only; no Android/NAS execution or business-success evidence.' };
  const plan = { schemaVersion: 1, metadata, artifacts, selectedContexts, unexecuted, deferred };
  const publicMetadata = { schemaVersion: 1, inputSetSha256: freeze.inputSetSha256,
    filesSha256: freeze.filesSha256, selectionSha256: metadata.selectionSha256,
    metadataSha256: identity(metadata), summary, allContexts,
    selectionRule: metadata.selectionRule, scope: metadata.scope,
    contexts: selectedContexts,
    cases: artifacts.flatMap(artifact => artifact.sites.map(site => ({ sha256: artifact.sha256,
      caseIdentitySha256: site.caseIdentitySha256, loaderContextSha256: site.loaderContextSha256,
      role: site.loaderContext.role, mainArtifactSha256: site.loaderContext.main?.sha256 || null,
      api: safeLabel(site.api), executionExtSha256: site.extSha256, canonicalExtSha256: site.canonicalExtSha256,
      configSha256: site.configSha256, captureIdSha256: sha(site.captureId), referenceCount: site.references.length }))),
    missing: unexecuted.map(publicMissing),
    deferred: deferred.map(row => ({ sha256: row.sha256, reason: row.reason, role: row.role,
      loaderContextSha256: row.loaderContextSha256, caseIdentitySha256: row.caseIdentitySha256, executionExtSha256: row.executionExtSha256 })) };
  return { plan, publicMetadata };
}

async function safeOutput(directory, capture) {
  const path = resolve(directory);
  const parts = relative(resolve('/'), path).split(sep);
  let cursor = resolve('/');
  for (const part of parts) {
    cursor = join(cursor, part);
    const info = await lstat(cursor).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    check(!info || (info.isDirectory() && !info.isSymbolicLink()), 'OUTPUT_PATH');
  }
  check(!contained(capture, path) && !contained(path, capture), 'OUTPUT_OVERLAPS_CAPTURE');
  await mkdir(path, { recursive: true, mode: 0o700 });
  check((await realpath(path)) === path, 'OUTPUT_PATH');
  return path;
}

/** Verifies the frozen tree before reading bindings, then verifies again before writing. */
export async function prepareRoleFixtures({ directory, selection, selectionPath, out, base, allContexts = false } = {}) {
  const verified = await verifyCatalogFreeze({ directory });
  const capture = await realpath(resolve(directory));
  const freeze = JSON.parse(await readFile(join(capture, 'freeze.json'), 'utf8'));
  check(freeze.inputSetSha256 === verified.inputSetSha256, 'FREEZE_IDENTITY');
  const selectionBytes = selectionPath ? await readFile(resolve(selectionPath)) : Buffer.from(JSON.stringify(selection));
  const requested = selectionPath ? JSON.parse(selectionBytes) : selection;
  const prepared = buildRoleFixturePlan(freeze, requested, { base, allContexts });
  const after = await verifyCatalogFreeze({ directory });
  check(after.inputSetSha256 === verified.inputSetSha256, 'FREEZE_IDENTITY');
  const output = await safeOutput(out, capture);
  const planBytes = Buffer.from(JSON.stringify(prepared.plan, null, 2) + '\n');
  const pins = { ...prepared.publicMetadata, planSha256: sha(planBytes), selectionFileSha256: sha(selectionBytes),
    preparerSha256: sha(await readFile(SELF)),
    loaderContextHelperSha256: sha(await readFile(join(dirname(SELF), 'loader-context.mjs'))),
    freezeFileSha256: sha(await readFile(join(capture, 'freeze.json'))) };
  await writeFile(join(output, 'oracle-plan.json'), planBytes, { flag: 'wx', mode: 0o600 });
  await writeFile(join(output, 'role-fixture-pins.json'), JSON.stringify(pins, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return { plan: prepared.plan, pins, output };
}

async function main(args) {
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write('Usage: node scripts/android/prepare-role-fixtures.mjs --directory PRIVATE_CAPTURE --selection PRIVATE_SELECTION_JSON --out NEW_PRIVATE_OUTPUT [--base http://10.0.2.2:18765] [--all-contexts]\nSelection: {"sha256":["full captured SHA256", "..."]}\nDefault: first exact API/ext for every original loader context. --all-contexts includes all unique API/ext variants. No execution or network access.\n');
    return;
  }
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const name = args[index];
    if (name === '--all-contexts') { check(!Object.hasOwn(options, name), 'CLI_ARGUMENT'); options[name] = true; continue; }
    check(['--directory', '--selection', '--out', '--base'].includes(name) && args[index + 1] && !Object.hasOwn(options, name), 'CLI_ARGUMENT');
    options[name] = args[++index];
  }
  check(options['--directory'] && options['--selection'] && options['--out'], 'CLI_USAGE');
  const { pins } = await prepareRoleFixtures({ directory: options['--directory'], selectionPath: options['--selection'],
    out: options['--out'], base: options['--base'], allContexts: !!options['--all-contexts'] });
  process.stdout.write(JSON.stringify({ ...pins.summary, inputSetSha256: pins.inputSetSha256, planSha256: pins.planSha256 }) + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === SELF) main(process.argv.slice(2)).catch(error => {
  process.stderr.write(JSON.stringify({ ok: false, code: /^(?:ROLE_FIXTURE|FREEZE)_[A-Z_]+$/.test(error.message) ? error.message : 'ROLE_FIXTURE_INPUT_OR_IO', errorSha256: sha(String(error.message)) }) + '\n');
  process.exitCode = 1;
});
