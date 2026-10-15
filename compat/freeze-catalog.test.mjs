// SPDX-License-Identifier: GPL-3.0-only
// Owned synthetic inputs only: no fetching, Java, Android, Docker, or services.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  appendFreezeRun, compareFrozenHistory, freezeCatalog, publicFreezeSummary, verifyCatalogFreeze,
} from '../scripts/compat/freeze-catalog.mjs';
import { loaderContextOf } from '../scripts/android/loader-context.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const SECRET = 'frozen-private-ext-3971';
const MAIN = 'https://private.invalid/main.jar?token=' + SECRET;
const SITE = 'https://private.invalid/site.jar?token=' + SECRET;
const writeJson = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n');

async function fixture(t, { sameBytes = true, siteExt = { z: SECRET, a: 1 }, failed = false } = {}) {
  const root = await realpath(tmpdir()), directory = await mkdtemp(join(root, 'tvbox-freeze-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const mainBytes = Buffer.from('owned synthetic JAR bytes'), siteBytes = sameBytes ? mainBytes : Buffer.from('owned different site JAR bytes');
  const mainSha = hash(mainBytes), siteSha = hash(siteBytes), raw = Buffer.from('owned raw subscription response');
  const config = { globals: { spider: MAIN, jarCache: 'private-cache-setting' }, sites: [
    { key: 'main-source', type: 3, api: 'csp_Fixture', ext: SECRET },
    { key: 'site-source', type: 3, api: 'csp_Fixture', ext: siteExt, jar: SITE },
    { key: 'same-ext-site-source', type: 3, api: 'csp_Fixture', ext: SECRET, jar: SITE },
    { key: 'js-helper', type: 3, api: 'https://private.invalid/test.js', ext: SECRET, jar: SITE },
  ] };
  await mkdir(join(directory, 'captures', 'catalog-1'), { recursive: true });
  await mkdir(join(directory, 'artifacts'));
  const configFile = 'captures/catalog-1/config.json';
  await writeJson(join(directory, configFile), config);
  await writeFile(join(directory, 'captures/catalog-1/raw-00.bin'), raw);
  const entry = { id: 'catalog-1', publicName: '公开目录', catalogFile: '公开目录.json', origin: 'list', parseSuccess: true,
    configFile, configSha256: hash(await readFile(join(directory, configFile))),
    responses: [{ file: 'raw-00.bin', bytes: raw.length, sha256: hash(raw), requestedUrl: 'https://private.invalid/config?token=' + SECRET }] };
  await writeJson(join(directory, 'captures/catalog-1/metadata.json'), entry);
  const artifacts = [{ id: mainSha, sha256: mainSha, bytes: mainBytes.length, jarPath: 'artifacts/' + mainSha + '.jar', role: 'main', sites: [] }];
  if (!failed && !sameBytes) artifacts.push({ id: siteSha, sha256: siteSha, bytes: siteBytes.length, jarPath: 'artifacts/' + siteSha + '.jar', role: 'site', sites: [] });
  await writeFile(join(directory, 'artifacts', mainSha + '.jar'), mainBytes);
  if (!failed && !sameBytes) await writeFile(join(directory, 'artifacts', siteSha + '.jar'), siteBytes);
  const retrievals = [
    { role: 'main', signature: MAIN, ok: true, sha256: mainSha, bytes: mainBytes.length },
    failed ? { role: 'site', signature: SITE, ok: false, error: { code: 'JAR_HTTP_404', message: SITE } }
      : { role: 'site', signature: SITE, ok: true, sha256: siteSha, bytes: siteBytes.length },
  ];
  await Promise.all([
    writeFile(join(directory, 'index.html'), '<html>owned public index</html>'),
    writeFile(join(directory, 'list.txt'), '公开目录.json|2026-10-15|100B|' + MAIN),
    writeJson(join(directory, 'site-config.json'), { private: SECRET }),
    writeJson(join(directory, 'inventory.json'), { entries: [entry], summary: { completed: 1 } }),
    writeJson(join(directory, 'artifact-inventory.json'), { retrievals, artifacts: artifacts.map(row => ({ ...row, inspection: { ok: true } })) }),
    writeJson(join(directory, 'input-manifest.json'), { schemaVersion: 1, limits: { loadMs: 45000, initMs: 12000 }, artifacts }),
  ]);
  return { directory, mainSha, siteSha, configFile, entry, config, artifacts, retrievals };
}

test('freeze rehashes every byte and restores original roles, main association, and exact ext serialization', async t => {
  const f = await fixture(t), freeze = await freezeCatalog({ directory: f.directory, metadata: { image: 'sha256:' + hash('image'), private: SECRET } });
  assert.equal(freeze.artifacts.length, 1);
  assert.deepEqual(freeze.artifacts[0].roles, ['main', 'site']);
  assert.equal(freeze.bindings.length, 4);
  const main = freeze.bindings.find(row => row.sourceKey === 'main-source');
  const site = freeze.bindings.find(row => row.sourceKey === 'site-source');
  assert.equal(main.role, 'main'); assert.equal(site.role, 'site');
  assert.equal(main.artifactSha256, site.artifactSha256);
  assert.equal(site.main.artifactSha256, f.mainSha);
  assert.equal(site.main.signature, MAIN); assert.equal(site.signature, SITE);
  assert.equal(main.executionExtSha256, hash(SECRET));
  assert.equal(main.canonicalExtSha256, hash(JSON.stringify(SECRET)));
  assert.equal(site.executionExtSha256, hash(JSON.stringify({ z: SECRET, a: 1 })));
  assert.equal(site.canonicalExtSha256, hash(JSON.stringify({ a: 1, z: SECRET })));
  assert.deepEqual(site.ext, { z: SECRET, a: 1 });
  assert.equal(freeze.summary.executableReferences, 3);
  assert.equal(freeze.summary.executableRoleVariants, 3);
  assert.equal(freeze.summary.executableCapturedVariants, 2);
  assert.equal(freeze.summary.helperBindings, 1);
  assert.equal((await verifyCatalogFreeze({ directory: f.directory })).ok, true);
  assert.equal((await lstat(join(f.directory, 'freeze.json'))).mode & 0o777, 0o600);
  const publicBytes = JSON.stringify(publicFreezeSummary(freeze));
  for (const value of [SECRET, MAIN, SITE, 'private-cache-setting', f.directory, 'main-source']) assert.equal(publicBytes.includes(value), false, 'private value leaked');
  assert.equal(publicBytes.includes('公开目录'), true);
  assert.equal(publicBytes.includes('https://'), false);
  await assert.rejects(freezeCatalog({ directory: f.directory }), { code: 'EEXIST' });
});

test('same canonical object with different property order preserves different actual execution ext', async t => {
  const f = await fixture(t);
  f.config.sites.push({ key: 'reordered', type: 3, api: 'csp_Fixture', ext: { a: 1, z: SECRET }, jar: SITE });
  await writeJson(join(f.directory, f.configFile), f.config);
  f.entry.configSha256 = hash(await readFile(join(f.directory, f.configFile)));
  await writeJson(join(f.directory, 'inventory.json'), { entries: [f.entry] });
  const freeze = await freezeCatalog({ directory: f.directory });
  const a = freeze.bindings.find(row => row.sourceKey === 'site-source'), b = freeze.bindings.find(row => row.sourceKey === 'reordered');
  assert.equal(a.canonicalExtSha256, b.canonicalExtSha256);
  assert.notEqual(a.executionExtSha256, b.executionExtSha256);
});

test('null ext keeps its original value and canonical hash while following worker execution normalization', async t => {
  const f = await fixture(t, { siteExt: null }), freeze = await freezeCatalog({ directory: f.directory });
  const site = freeze.bindings.find(row => row.sourceKey === 'site-source');
  assert.equal(site.extPresent, true);
  assert.equal(site.ext, null);
  assert.equal(site.source.ext, null);
  assert.equal(site.executionExtSha256, hash(JSON.stringify('')));
  assert.equal(site.canonicalExtSha256, hash('null'));
});

test('download failures stay frozen as unavailable bindings and never become executable inputs', async t => {
  const f = await fixture(t, { failed: true }), freeze = await freezeCatalog({ directory: f.directory });
  assert.equal(freeze.summary.retrievalFailures, 1);
  assert.equal(freeze.summary.unavailableBindings, 3);
  assert.equal(freeze.summary.executableCapturedVariants, 1);
  assert.equal(freeze.bindings.find(row => row.role === 'site').artifactSha256, null);
  assert.equal(freeze.bindings.find(row => row.role === 'site').errorCode, 'JAR_HTTP_404');
  assert.equal(freeze.summary.executableRoleContextVariants, 3);
  assert.equal(freeze.summary.executableCapturedRoleContextVariants, 1);
  assert.equal(freeze.summary.executableUnavailableRoleContextVariants, 2);
});

test('public summary recomputes signature-aware missing and main contexts without changing a legacy private freeze', async t => {
  const f = await fixture(t), freeze = await freezeCatalog({ directory: f.directory });
  const sample = freeze.bindings.find(row => row.role === 'site' && typeof row.ext === 'string');
  const withContext = (name, captured, mainSignature) => ({ ...structuredClone(sample), id: hash(name),
    artifactSha256: captured ? f.mainSha : null, retrievalOk: captured,
    signature: 'https://missing.invalid/' + name + '.jar', signatureSha256: hash('https://missing.invalid/' + name + '.jar'),
    main: { signature: mainSignature, signatureSha256: hash(mainSignature), artifactSha256: null, retrievalOk: false } });
  freeze.bindings = [withContext('missing-a', false, 'main-a'), withContext('missing-b', false, 'main-a'),
    withContext('captured-a', true, 'main-a'), withContext('captured-b', true, 'main-b')];
  freeze.bindings.push(structuredClone(freeze.bindings[0]));
  // Model a schema-1 freeze created before the extra denominator fields existed.
  delete freeze.summary.executableRoleContextVariants;
  delete freeze.summary.executableCapturedRoleContextVariants;
  delete freeze.summary.executableUnavailableRoleContextVariants;
  const original = JSON.stringify(freeze);
  const summary = publicFreezeSummary(freeze).summary;
  assert.equal(summary.executableReferences, 5);
  assert.equal(summary.executableRoleVariants, 2, 'original SHA/null definition must remain stable');
  assert.equal(summary.executableRoleContextVariants, 4);
  assert.equal(summary.executableCapturedRoleContextVariants, 2);
  assert.equal(summary.executableUnavailableRoleContextVariants, 2);
  assert.equal(summary.executableSignatureContextVariants, 4);
  assert.equal(summary.executableCapturedSignatureContextVariants, 2);
  assert.equal(summary.executableUnavailableSignatureContextVariants, 2);
  assert.equal(JSON.stringify(freeze), original, 'public export must not rewrite the private freeze');
});

test('full signature context keeps same-SHA same-role original load keys and main signatures distinct', async t => {
  const f = await fixture(t), freeze = await freezeCatalog({ directory: f.directory });
  const main = freeze.bindings.find(row => row.role === 'main');
  const site = freeze.bindings.find(row => row.role === 'site' && typeof row.ext === 'string');
  const row = (sample, signature, mainSignature) => ({ ...structuredClone(sample), signature, signatureSha256: hash(signature),
    main: { ...structuredClone(sample.main), signature: mainSignature, signatureSha256: hash(mainSignature) } });
  freeze.bindings = [row(main, 'https://same.invalid/main-a', 'https://same.invalid/main-a'),
    row(main, 'https://same.invalid/main-b', 'https://same.invalid/main-b'),
    row(site, 'https://same.invalid/site-a', 'https://same.invalid/main-a'),
    row(site, 'https://same.invalid/site-b', 'https://same.invalid/main-a'),
    row(site, 'https://same.invalid/site-a', 'https://same.invalid/main-b')];
  const original = JSON.stringify(freeze), exported = publicFreezeSummary(freeze);
  assert.equal(exported.summary.executableRoleContextVariants, 2, 'preserve the prior SHA-based denominator');
  assert.equal(exported.summary.executableSignatureContextVariants, 5);
  assert.equal(exported.summary.executableCapturedSignatureContextVariants, 5);
  assert.equal(exported.summary.executableUnavailableSignatureContextVariants, 0);
  const identities = freeze.bindings.map(binding => loaderContextOf(freeze.artifacts[0], {
    jar: binding.role === 'site' ? binding.signature : '', loaderContext: { role: binding.role, signature: binding.signature,
      ...(binding.role === 'site' ? { main: { sha256: binding.main.artifactSha256, signature: binding.main.signature,
        jarPath: freeze.artifacts[0].jarPath, jarUrl: 'http://10.0.2.2:18765/artifacts/main.jar' } } : {}) },
  }).identity);
  assert.equal(new Set(identities.map(value => JSON.stringify(value))).size, 5);
  assert.equal(JSON.stringify(freeze), original);
});

test('verify detects changed, extra, and deleted files without relying on stored capture metadata', async t => {
  const f = await fixture(t);
  await freezeCatalog({ directory: f.directory });
  const jar = join(f.directory, f.artifacts[0].jarPath), before = await readFile(jar);
  await writeFile(jar, Buffer.from('different artifact bytes'));
  await assert.rejects(verifyCatalogFreeze({ directory: f.directory }), /FREEZE_INPUT_CHANGED/);
  await writeFile(jar, before);
  await writeFile(join(f.directory, 'unexpected-private-response.bin'), SECRET);
  await assert.rejects(verifyCatalogFreeze({ directory: f.directory }), /FREEZE_INPUT_CHANGED/);
  await rm(join(f.directory, 'unexpected-private-response.bin'));
  await rm(join(f.directory, 'captures/catalog-1/raw-00.bin'));
  await assert.rejects(verifyCatalogFreeze({ directory: f.directory }), /FREEZE_INPUT_CHANGED/);
});

test('freeze rejects stale JAR, config, and raw-response checksums before publishing a freeze', async t => {
  for (const file of ['artifacts', 'config', 'response']) {
    const f = await fixture(t);
    const path = file === 'artifacts' ? f.artifacts[0].jarPath : file === 'config' ? f.configFile : 'captures/catalog-1/raw-00.bin';
    await writeFile(join(f.directory, path), 'tampered bytes');
    await assert.rejects(freezeCatalog({ directory: f.directory }), /FREEZE_(?:ARTIFACT_|RESPONSE_)?CHECKSUM/);
    await assert.rejects(readFile(join(f.directory, 'freeze.json')), { code: 'ENOENT' });
  }
});

test('freeze rejects an unfinished retrieval inventory and unmatched retrieval records', async t => {
  const f = await fixture(t), path = join(f.directory, 'artifact-inventory.json');
  const inventory = JSON.parse(await readFile(path, 'utf8'));
  inventory.retrievals.pop();
  await writeJson(path, inventory);
  await assert.rejects(freezeCatalog({ directory: f.directory }), /FREEZE_MISSING_RETRIEVAL/);
  inventory.retrievals = [...f.retrievals, { role: 'main', signature: 'https://private.invalid/unreferenced.jar', ok: false }];
  await writeJson(path, inventory);
  await assert.rejects(freezeCatalog({ directory: f.directory }), /FREEZE_UNREFERENCED_RETRIEVAL/);
});

async function responseFixture(t) {
  const f = await fixture(t), bytes = Buffer.from('owned original HTTP body before decoding');
  await mkdir(join(f.directory, 'artifact-responses'));
  await writeFile(join(f.directory, 'artifact-responses/body.bin'), bytes);
  await writeFile(join(f.directory, 'artifact-responses/other.bin'), 'different body');
  const inventoryPath = join(f.directory, 'artifact-inventory.json');
  const inventory = JSON.parse(await readFile(inventoryPath, 'utf8'));
  const response = { kind: 'jar', bodyCaptured: true, complete: true,
    file: 'artifact-responses/body.bin', sha256: hash(bytes), bytes: bytes.length, observedBytes: bytes.length };
  inventory.retrievals[0].responses = [response];
  inventory.retrievals[1].responses = [];
  return { ...f, inventoryPath, inventory, response, bytes };
}

test('artifact response bodies and partial prefixes are hash-linked separately from decoded JAR bytes', async t => {
  const f = await responseFixture(t);
  f.inventory.retrievals[1].responses = [{ ...f.response, complete: false, observedBytes: f.response.bytes + 10,
    error: { code: 'JAR_SIZE_LIMIT', message: 'owned partial prefix diagnostic' } },
  { kind: 'jar', bodyCaptured: false, complete: false, error: { code: 'JAR_HTTP_503' } }];
  await writeJson(f.inventoryPath, f.inventory);
  const freeze = await freezeCatalog({ directory: f.directory });
  assert.equal(freeze.artifactResponseCapture.responseReferences, 3);
  assert.equal(freeze.artifactResponseCapture.completeBodies, 1);
  assert.equal(freeze.artifactResponseCapture.prefixBodies, 1);
  assert.equal(freeze.artifactResponseCapture.uncapturedBodies, 1);
  assert.equal(freeze.artifactResponseCapture.retrievalsWithoutResponseMetadata, 0);
  assert.match(freeze.artifactResponseCapture.byteScope, /retained received prefix, never a complete response/);
  assert.equal(freeze.files.find(row => row.file === f.response.file).sha256, hash(f.bytes));
  assert.notEqual(hash(f.bytes), f.mainSha, 'raw HTTP body and decoded JAR need not match');
  assert.deepEqual(publicFreezeSummary(freeze).artifactResponseCapture, freeze.artifactResponseCapture);
  assert.equal((await verifyCatalogFreeze({ directory: f.directory })).ok, true);
});

test('artifact response metadata rejects tampered digest, size, wrong file, traversal, and absolute paths before freeze', async t => {
  const mutations = [
    row => { row.sha256 = hash('wrong claimed raw HTTP bytes'); },
    row => { row.bytes++; row.observedBytes++; },
    row => { row.file = 'artifact-responses/other.bin'; },
    row => { row.file = '../body.bin'; },
    row => { row.file = '/tmp/body.bin'; },
    row => { row.file = 'artifact-responses/../index.html'; },
    row => { row.file = 'captures/catalog-1/raw-00.bin'; },
    row => { row.file = 'artifact-responses/missing.bin'; },
    row => { row.sha256 = SECRET; },
  ];
  for (const mutate of mutations) {
    const f = await responseFixture(t);
    mutate(f.response);
    await writeJson(f.inventoryPath, f.inventory);
    await assert.rejects(freezeCatalog({ directory: f.directory }), /FREEZE_(?:PATH|ARTIFACT_RESPONSE_(?:CHECKSUM|PATH|SCHEMA))/);
    await assert.rejects(readFile(join(f.directory, 'freeze.json')), { code: 'ENOENT' });
  }
});

test('artifact response completeness cannot claim an uncaptured body or conceal an unexplained prefix', async t => {
  const mutations = [
    row => { row.bodyCaptured = false; },
    row => { row.complete = 'true'; },
    row => { row.bodyCaptured = 'true'; },
    row => { row.observedBytes++; },
    row => { row.observedBytes--; },
    row => { row.complete = false; },
    row => { row.complete = false; row.error = { message: SECRET }; },
    row => { row.complete = false; row.bodyCaptured = false; },
  ];
  for (const mutate of mutations) {
    const f = await responseFixture(t);
    mutate(f.response);
    await writeJson(f.inventoryPath, f.inventory);
    await assert.rejects(freezeCatalog({ directory: f.directory }), /FREEZE_ARTIFACT_RESPONSE_/);
  }
});

test('legacy retrieval records without responses remain valid and explicitly lack response metadata', async t => {
  const f = await fixture(t), freeze = await freezeCatalog({ directory: f.directory });
  assert.equal(freeze.artifactResponseCapture.retrievalsWithoutResponseMetadata, 2);
  assert.equal(freeze.artifactResponseCapture.responseReferences, 0);
});

test('freeze rejects path traversal, absolute references, and symlinks anywhere inside input root', async t => {
  for (const escaped of ['../elsewhere.jar', '/tmp/elsewhere.jar', 'artifacts/../../elsewhere.jar', 'artifacts\\elsewhere.jar']) {
    const f = await fixture(t);
    const manifest = JSON.parse(await readFile(join(f.directory, 'input-manifest.json'), 'utf8'));
    manifest.artifacts[0].jarPath = escaped;
    await writeJson(join(f.directory, 'input-manifest.json'), manifest);
    await assert.rejects(freezeCatalog({ directory: f.directory }), /FREEZE_PATH/);
  }
  const f = await fixture(t);
  await symlink(join(f.directory, 'artifacts'), join(f.directory, 'linked-artifacts'));
  await assert.rejects(freezeCatalog({ directory: f.directory }), /FREEZE_SYMLINK_OR_SPECIAL_FILE/);
  await rm(join(f.directory, 'linked-artifacts'));
  await freezeCatalog({ directory: f.directory });
  await symlink(join(f.directory, f.configFile), join(f.directory, 'linked-config'));
  await assert.rejects(verifyCatalogFreeze({ directory: f.directory }), /FREEZE_SYMLINK_OR_SPECIAL_FILE/);
});

test('run metadata can be appended without changing the fixed input identity; freeze tampering is rejected', async t => {
  const f = await fixture(t), first = await freezeCatalog({ directory: f.directory });
  const appended = await appendFreezeRun({ directory: f.directory, metadata: { image: hash('image'), budgets: { initMs: 12000 }, private: SECRET } });
  assert.equal(appended.inputSetSha256, first.inputSetSha256);
  assert.equal(appended.runs.length, 1);
  assert.equal((await verifyCatalogFreeze({ directory: f.directory })).ok, true);
  assert.equal(JSON.stringify(publicFreezeSummary(appended)).includes(SECRET), false);
  appended.bindings[0].role = 'site';
  await writeJson(join(f.directory, 'freeze.json'), appended);
  await assert.rejects(verifyCatalogFreeze({ directory: f.directory }), /FREEZE_MANIFEST_CHECKSUM/);
});

test('history joins evidence by identical SHA and classifies directory/role changes independently', async t => {
  const f = await fixture(t, { sameBytes: false }), freeze = await freezeCatalog({ directory: f.directory });
  const changed = hash('previous main bytes'), missing = hash('missing historic artifact');
  const comparison = { artifacts: [{ sha256: changed, oldLoad: 'loaded', newLoad: 'failed', catalogNames: ['公开目录'] },
    { sha256: f.siteSha, oldLoad: 'failed', newLoad: 'loaded', variants: [{ api: 'csp_Fixture', executionExtSha256: hash(SECRET), old: { init: 'failed' }, new: { init: 'ready' } }] }] };
  const catalog = { artifacts: [{ sha256: changed }, { sha256: f.siteSha }, { sha256: missing }], retrieval: { retrievals: [
    { role: 'main', ok: true, sha256: changed, catalogNames: ['公开目录'] },
    { role: 'site', ok: true, sha256: f.siteSha, catalogNames: ['公开目录'] },
    { role: 'main', ok: true, sha256: missing, catalogNames: ['缺失目录'] },
  ] } };
  const history = compareFrozenHistory(freeze, comparison, catalog);
  assert.equal(history.exactShaMatches.length, 1);
  assert.equal(history.exactShaMatches[0].sha256, f.siteSha);
  assert.equal(history.exactShaMatches[0].comparison.newLoad, 'loaded');
  assert.deepEqual(history.newSha256, [f.mainSha]);
  assert.equal(history.missingSha256.includes(changed), true);
  assert.equal(history.associations.find(row => row.catalogName === '公开目录' && row.role === 'main').status, 'changed');
  assert.equal(history.associations.find(row => row.catalogName === '公开目录' && row.role === 'site').status, 'same');
  assert.equal(history.associations.find(row => row.catalogName === '缺失目录').status, 'missing');
  assert.equal(JSON.stringify(history).includes(SECRET), false);
});

test('history public evidence permits only known load/init states, roles, hashes, and booleans', async t => {
  const f = await fixture(t), freeze = await freezeCatalog({ directory: f.directory });
  const comparison = { artifacts: [{ sha256: f.mainSha, oldLoad: SECRET, newLoad: { private: SECRET }, variants: [
    { api: 'csp_Fixture', executionExtSha256: SECRET, captureExtSha256: { private: SECRET }, old: { init: SECRET }, new: { init: [SECRET] } },
    { api: 'csp_Valid', executionExtSha256: hash('ext'), captureExtSha256: hash('canonical ext'), old: { init: 'failed' }, new: { init: 'ready' } },
  ] }] };
  const catalog = { artifacts: [{ sha256: f.mainSha, catalogNames: ['公开目录'],
    referencedRoles: ['main', SECRET, { private: SECRET }, 'site', 'main'], execution: { loadedAtLeastOnce: SECRET } }], retrieval: { retrievals: [] } };
  const history = compareFrozenHistory(freeze, comparison, catalog), row = history.exactShaMatches[0];
  assert.equal(row.comparison.oldLoad, 'unknown');
  assert.equal(row.comparison.newLoad, 'unknown');
  assert.equal(row.comparison.variants[0].oldInit, 'unknown');
  assert.equal(row.comparison.variants[0].newInit, 'unknown');
  assert.equal(row.comparison.variants[0].executionExtSha256, undefined);
  assert.equal(row.comparison.variants[0].captureExtSha256, undefined);
  assert.equal(row.comparison.variants[1].oldInit, 'failed');
  assert.equal(row.comparison.variants[1].newInit, 'ready');
  assert.equal(row.comparison.variants[1].executionExtSha256, hash('ext'));
  assert.deepEqual(row.catalog.referencedRoles, ['main', 'site']);
  assert.equal(row.catalog.loadedAtLeastOnce, null);
  assert.equal(JSON.stringify(history).includes(SECRET), false);
  comparison.artifacts[0].oldLoad = 'loaded'; comparison.artifacts[0].newLoad = 'failed';
  catalog.artifacts[0].execution.loadedAtLeastOnce = false;
  const valid = compareFrozenHistory(freeze, comparison, catalog).exactShaMatches[0];
  assert.equal(valid.comparison.oldLoad, 'loaded'); assert.equal(valid.comparison.newLoad, 'failed');
  assert.equal(valid.catalog.loadedAtLeastOnce, false);
});

test('CLI verifies a frozen input with metadata-only output and keeps private parser failures off stderr', async t => {
  const f = await fixture(t);
  await freezeCatalog({ directory: f.directory });
  const run = spawnSync(process.execPath, ['scripts/compat/freeze-catalog.mjs', 'verify', '--directory', f.directory], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(run.stdout).ok, true);
  await writeFile(join(f.directory, 'freeze.json'), '{ "private": "' + SECRET);
  const bad = spawnSync(process.execPath, ['scripts/compat/freeze-catalog.mjs', 'verify', '--directory', f.directory], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.equal(JSON.parse(bad.stderr).code, 'FREEZE_IO_OR_SCHEMA');
  assert.equal(bad.stderr.includes(SECRET), false);
  assert.equal(bad.stderr.includes(f.directory), false);
});
