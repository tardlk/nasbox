// SPDX-License-Identifier: GPL-3.0-only
// Offline role-plan validation: owned synthetic bytes, no Android or network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { freezeCatalog, verifyCatalogFreeze } from '../scripts/compat/freeze-catalog.mjs';
import { buildRoleFixturePlan, prepareRoleFixtures } from '../scripts/android/prepare-role-fixtures.mjs';
import { loaderContextOf } from '../scripts/android/loader-context.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const SECRET = 'ROLE_PRIVATE_1c28';
const SIGNATURE = 'https://provider.invalid/a.jar?token=' + SECRET;
const OTHER_SIGNATURE = 'https://provider.invalid/main.jar?token=' + SECRET;
const ARTIFACT = sha('owned target JAR'), OTHER_MAIN = sha('owned other main JAR');
const writeJson = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n');
const artifact = (sha256, validContent = true) => ({ sha256, jarPath: 'artifacts/' + sha256 + '.jar', bytes: 32, validContent });

function binding(id, { role = 'main', ext = SECRET, api = 'csp_Fixture', mainSha = ARTIFACT,
  mainSignature = SIGNATURE, key = id, signature = SIGNATURE, captureId = 'capture-' + id } = {}) {
  return { id: sha(id), captureId, configSha256: sha('config-' + id), publicName: '公开目录', partial: false,
    artifactSha256: ARTIFACT, role, kind: 'jar-csp', signature, retrievalOk: true,
    main: { signature: mainSignature, artifactSha256: mainSha, retrievalOk: !!mainSha },
    sourceKey: key, api, executionExtSha256: sha(typeof ext === 'string' ? ext : JSON.stringify(ext ?? '')),
    canonicalExtSha256: sha(JSON.stringify(ext)),
    source: { key, api, type: 3, jar: role === 'main' ? '' : signature, ext } };
}

function frozen(bindings = [binding('first')], artifacts = [artifact(ARTIFACT), artifact(OTHER_MAIN)]) {
  return { schemaVersion: 1, inputSetSha256: sha('frozen-input'), filesSha256: sha('frozen-files'),
    artifacts, bindings, limits: { loadMs: 45000, initMs: 12000 } };
}

test('one representative per original role/main context; matching exact duplicates retain every provenance reference', () => {
  const first = binding('first'), duplicate = binding('duplicate', { key: 'another-original-key' });
  const secondApi = binding('another-api', { api: 'csp_Second', ext: 'second ext' });
  const sameBytesSite = binding('site', { role: 'site' });
  const otherMainSite = binding('other-main-site', { role: 'site', mainSha: OTHER_MAIN, mainSignature: OTHER_SIGNATURE });
  const freeze = frozen([first, duplicate, secondApi, sameBytesSite, otherMainSite]);
  const { plan, publicMetadata } = buildRoleFixturePlan(freeze, { sha256: [ARTIFACT] });
  const sites = plan.artifacts[0].sites;
  assert.equal(sites.length, 3);
  assert.deepEqual(sites.map(site => site.loaderContext.role), ['main', 'site', 'site']);
  assert.equal(sites[0].references.length, 2);
  assert.equal(sites[0].references[1].captureId, duplicate.captureId);
  assert.equal(sites[0].references[1].sourceKey, duplicate.sourceKey);
  assert.equal(sites[0].configSha256, first.configSha256);
  assert.equal(sites[0].ext, SECRET);
  assert.equal(sites[0].jar, '');
  assert.equal(sites[1].jar, SIGNATURE);
  assert.equal(sites[1].loaderContext.main.sha256, ARTIFACT);
  assert.equal(sites[2].loaderContext.main.sha256, OTHER_MAIN);
  assert.equal(sites[1].loaderContext.main.signature, SIGNATURE);
  assert.equal(sites[2].loaderContext.main.signature, OTHER_SIGNATURE);
  assert.equal(new Set(sites.map(site => site.caseIdentitySha256)).size, 3);
  for (const site of sites) assert.deepEqual(site.expectedLoaderIdentity, loaderContextOf(plan.artifacts[0], site).identity);
  assert.equal(plan.deferred.length, 1);
  assert.equal(plan.deferred[0].api, 'csp_Second');
  assert.equal(publicMetadata.summary.loaderContexts, 3);
  assert.equal(publicMetadata.summary.mainCases, 1);
  assert.equal(publicMetadata.summary.siteCases, 2);
  const publicText = JSON.stringify(publicMetadata);
  for (const secret of [SECRET, SIGNATURE, OTHER_SIGNATURE, 'another-original-key', 'capture-first']) assert.equal(publicText.includes(secret), false);
});

test('--all-contexts preserves every exact API/ext variant and context keys ignore fixture endpoint changes', () => {
  const freeze = frozen([binding('one'), binding('two', { ext: 'different ext' }), binding('site', { role: 'site' })]);
  const a = buildRoleFixturePlan(freeze, { sha256: [ARTIFACT] }, { allContexts: true, base: 'http://10.0.2.2:18765' });
  const b = buildRoleFixturePlan(freeze, { sha256: [ARTIFACT] }, { allContexts: true, base: 'http://127.0.0.1:20000' });
  assert.equal(a.plan.artifacts[0].sites.length, 3);
  assert.equal(a.plan.deferred.length, 0);
  assert.deepEqual(a.plan.artifacts[0].sites.map(site => site.caseIdentitySha256), b.plan.artifacts[0].sites.map(site => site.caseIdentitySha256));
  assert.notEqual(a.plan.artifacts[0].jarUrl, b.plan.artifacts[0].jarUrl);
});

test('configured missing or invalid main is unexecuted; a genuinely absent main stays absent', () => {
  const absent = binding('absent', { role: 'site', mainSha: null, mainSignature: '' });
  const missing = binding('missing', { role: 'site', mainSha: null, mainSignature: OTHER_SIGNATURE });
  const invalid = binding('invalid', { role: 'site', mainSha: OTHER_MAIN, mainSignature: OTHER_SIGNATURE });
  const { plan, publicMetadata } = buildRoleFixturePlan(frozen([absent, missing, invalid], [artifact(ARTIFACT), artifact(OTHER_MAIN, false)]), { sha256: [ARTIFACT] });
  assert.equal(plan.artifacts[0].sites.length, 1);
  assert.equal(Object.hasOwn(plan.artifacts[0].sites[0].loaderContext, 'main'), false);
  assert.deepEqual(plan.unexecuted.map(row => row.reason), ['original-main-not-captured', 'original-main-content-invalid']);
  assert.equal(publicMetadata.missing.length, 2);
  assert.equal(JSON.stringify(publicMetadata).includes(OTHER_SIGNATURE), false);
});

test('missing SHA, invalid contents, and helper-only original references do not invent execution cases', () => {
  const helper = { ...binding('helper'), kind: 'unused-main' };
  const missingSha = sha('not captured'), invalidSha = sha('downloaded HTML');
  const { plan, publicMetadata } = buildRoleFixturePlan(frozen([helper], [artifact(ARTIFACT), artifact(invalidSha, false)]), { sha256: [missingSha, invalidSha, ARTIFACT] });
  assert.equal(plan.artifacts.length, 0);
  assert.deepEqual(plan.unexecuted.map(row => row.reason), ['selected-sha-not-captured', 'selected-content-invalid', 'no-original-executable-binding']);
  assert.equal(publicMetadata.summary.cases, 0);
});

test('missing, nonstring, or mismatched ext never becomes an empty or guessed ext; provider calls are not execution instructions', () => {
  const missing = binding('missing'); delete missing.source.ext;
  const structured = binding('structured', { ext: { private: SECRET } });
  const changed = binding('changed'); changed.executionExtSha256 = sha('stale ext');
  const valid = binding('valid'); valid.source.calls = [{ method: 'searchContent', params: [SECRET, false] }];
  const { plan } = buildRoleFixturePlan(frozen([missing, structured, changed, valid]), { sha256: [ARTIFACT] });
  assert.deepEqual(plan.unexecuted.map(row => row.reason), ['exact-string-ext-unavailable', 'exact-string-ext-unavailable', 'exact-ext-hash-differs']);
  assert.equal(plan.artifacts[0].sites[0].ext, SECRET);
  assert.equal(Object.hasOwn(plan.artifacts[0].sites[0], 'calls'), false);
});

test('provider harness fields cannot affect planned loader identity, calls, provenance, or case pins', () => {
  const original = binding('provider-reserved', { role: 'site' });
  const clean = buildRoleFixturePlan(frozen([original]), { sha256: [ARTIFACT] }).plan.artifacts[0].sites[0];
  const injected = structuredClone(original);
  Object.assign(injected.source, { calls: [{ method: 'searchContent', params: [SECRET, false] }],
    loaderContext: { role: 'main', signature: 'provider forged signature' },
    expectedLoaderIdentity: { loaderMode: 'main', jarLoadKey: SECRET },
    symbolMap: { protectedBind: SECRET }, targetApk: SECRET, targetPackage: SECRET,
    caseIdentitySha256: SECRET, loaderContextSha256: SECRET,
    references: [{ captureId: SECRET, configSha256: SECRET, sourceKey: SECRET }] });
  const before = JSON.stringify(injected);
  const planned = buildRoleFixturePlan(frozen([injected]), { sha256: [ARTIFACT] }).plan.artifacts[0].sites[0];
  assert.deepEqual(planned, clean);
  assert.equal(JSON.stringify(injected), before, 'frozen original source remains unchanged');
});

test('selection requires full distinct SHA values and fixture URLs cannot carry credentials or queries', () => {
  for (const selection of [{ sha256: ['abc'] }, { sha256: [ARTIFACT, ARTIFACT] }, { sha256: [] }]) {
    assert.throws(() => buildRoleFixturePlan(frozen(), selection), /ROLE_FIXTURE_(?:SELECTION|DUPLICATE_SELECTION)/);
  }
  for (const base of ['file:///tmp', 'http://user:password@localhost:1234', 'http://localhost:1234?token=' + SECRET]) {
    assert.throws(() => buildRoleFixturePlan(frozen(), { sha256: [ARTIFACT] }, { base }), /ROLE_FIXTURE_BASE_URL/);
  }
});

async function diskFixture(t) {
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'tvbox-role-fixture-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const capture = join(directory, 'capture'), out = join(directory, 'private-plan');
  await mkdir(join(capture, 'captures', 'catalog-1'), { recursive: true });
  await mkdir(join(capture, 'artifacts'));
  const bytes = Buffer.from('owned target JAR'), digest = sha(bytes), raw = Buffer.from('owned response');
  await writeFile(join(capture, 'artifacts', digest + '.jar'), bytes);
  const config = { globals: { spider: SIGNATURE }, sites: [{ key: 'original-key', api: 'csp_Fixture', type: 3, ext: SECRET }] };
  await writeJson(join(capture, 'captures/catalog-1/config.json'), config);
  await writeFile(join(capture, 'captures/catalog-1/raw-00.bin'), raw);
  const entry = { id: 'catalog-1', publicName: '公开目录', parseSuccess: true,
    configFile: 'captures/catalog-1/config.json', configSha256: sha(await readFile(join(capture, 'captures/catalog-1/config.json'))),
    responses: [{ file: 'raw-00.bin', sha256: sha(raw), bytes: raw.length }] };
  const item = { id: digest, sha256: digest, jarPath: 'artifacts/' + digest + '.jar', bytes: bytes.length, sites: [] };
  await Promise.all([
    writeFile(join(capture, 'index.html'), 'owned index'), writeFile(join(capture, 'list.txt'), 'owned catalogue'),
    writeJson(join(capture, 'site-config.json'), {}), writeJson(join(capture, 'captures/catalog-1/metadata.json'), entry),
    writeJson(join(capture, 'inventory.json'), { entries: [entry] }),
    writeJson(join(capture, 'input-manifest.json'), { schemaVersion: 1, limits: { loadMs: 45000 }, artifacts: [item] }),
    writeJson(join(capture, 'artifact-inventory.json'), { artifacts: [{ ...item, inspection: { ok: true } }], retrievals: [{ role: 'main', signature: SIGNATURE, ok: true, sha256: digest, bytes: bytes.length }] }),
  ]);
  await freezeCatalog({ directory: capture });
  return { directory, capture, out, digest };
}

test('prepare verifies complete frozen inputs, writes private plan and safe pins, and leaves capture unchanged', async t => {
  const f = await diskFixture(t);
  const result = await prepareRoleFixtures({ directory: f.capture, selection: { sha256: [f.digest] }, out: f.out });
  assert.equal(result.pins.summary.cases, 1);
  assert.equal(result.plan.artifacts[0].sites[0].ext, SECRET);
  assert.equal(result.pins.planSha256, sha(await readFile(join(f.out, 'oracle-plan.json'))));
  assert.equal(JSON.stringify(result.pins).includes(SECRET), false);
  assert.equal((await lstat(join(f.out, 'oracle-plan.json'))).mode & 0o777, 0o600);
  assert.equal((await lstat(f.out)).mode & 0o777, 0o700);
  assert.equal((await verifyCatalogFreeze({ directory: f.capture })).ok, true);
  await assert.rejects(prepareRoleFixtures({ directory: f.capture, selection: { sha256: [f.digest] }, out: join(f.capture, 'plan') }), /ROLE_FIXTURE_OUTPUT_OVERLAPS_CAPTURE/);
  await writeFile(join(f.capture, 'index.html'), 'changed input');
  await assert.rejects(prepareRoleFixtures({ directory: f.capture, selection: { sha256: [f.digest] }, out: join(f.directory, 'another-plan') }), /FREEZE_INPUT_CHANGED/);
});

test('CLI accepts the minimal private selection JSON and reports metadata only', async t => {
  const f = await diskFixture(t), selectionPath = join(f.directory, 'selection.json');
  await writeJson(selectionPath, { sha256: [f.digest] });
  const result = spawnSync(process.execPath, ['scripts/android/prepare-role-fixtures.mjs', '--directory', f.capture, '--selection', selectionPath, '--out', f.out, '--all-contexts'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).cases, 1);
  assert.equal(result.stdout.includes(SECRET), false);
  assert.equal(result.stdout.includes(f.directory), false);
});
