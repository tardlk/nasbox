// SPDX-License-Identifier: GPL-3.0-only
// Offline configured-source coverage and private frozen-plan integrity checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { freezeCatalog, verifyCatalogFreeze } from '../scripts/compat/freeze-catalog.mjs';
import { buildWorkingSourcePlan, prepareWorkingSourcePlan, workingMethodSelection, workingSourceScenarioIdentity } from '../scripts/compat/prepare-working-source-plan.mjs';
import { loaderContextOf } from '../scripts/android/loader-context.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const SECRET = 'WORKING_PRIVATE_d21';
const SIGNATURE = 'https://provider.invalid/a.jar?token=' + SECRET;
const MAIN_SIGNATURE = 'https://provider.invalid/main.jar?token=' + SECRET;
const ARTIFACT = sha('owned site JAR'), MAIN = sha('owned main JAR');
const artifact = (sha256, validContent = true) => ({ sha256, jarPath: 'artifacts/' + sha256 + '.jar', bytes: 14, validContent });
const writeJson = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n');
function binding(id, { key = id, api = 'csp_Fixture', ext = SECRET, role = 'site', signature = SIGNATURE, mainSha = MAIN, mainSignature = MAIN_SIGNATURE } = {}) {
  return { id: sha(id), captureId: 'capture-' + id, configSha256: sha('config-' + id), publicName: '公开目录', partial: false,
    artifactSha256: ARTIFACT, role, kind: 'jar-csp', signature, retrievalOk: true,
    main: { signature: mainSignature, artifactSha256: mainSha, retrievalOk: !!mainSha },
    sourceKey: key, api, executionExtSha256: sha(typeof ext === 'string' ? ext : JSON.stringify(ext)), canonicalExtSha256: sha(JSON.stringify(ext)),
    source: { key, api, type: 3, jar: role === 'site' ? signature : '', ext } };
}
function frozen(bindings = [binding('first')], artifacts = [artifact(ARTIFACT), artifact(MAIN)]) {
  return { schemaVersion: 1, inputSetSha256: sha('frozen-input'), filesSha256: sha('frozen-files'), artifacts, bindings,
    limits: { loadMs: 45000, initMs: 12000 } };
}

test('complete configured source selection retains distinct keys and all exact duplicate references', () => {
  const first = binding('first', { key: SECRET }), duplicate = binding('duplicate', { key: SECRET });
  const bindings = [first, duplicate, binding('different-key'), binding('different-ext', { key: SECRET, ext: 'second ext' }),
    binding('different-api', { key: SECRET, api: 'csp_Another' }), binding('different-signature', { key: SECRET, signature: SIGNATURE + '&v=2' }),
    binding('different-role', { key: SECRET, role: 'main' }), binding('no-main', { key: SECRET, mainSignature: '', mainSha: null })];
  const input = frozen(bindings), before = JSON.stringify(input);
  const { plan, publicMetadata } = buildWorkingSourcePlan(input, { sha256: [ARTIFACT] });
  const sites = plan.artifacts[0].sites;
  assert.equal(sites.length, 7);
  assert.equal(sites[0].references.length, 2);
  assert.equal(sites[0].key, SECRET);
  assert.equal(sites[1].key, 'different-key');
  assert.notEqual(sites[0].caseIdentitySha256, sites[1].caseIdentitySha256);
  assert.equal(new Set(sites.map(row => row.caseIdentitySha256)).size, 7);
  for (const site of sites) assert.deepEqual(site.expectedLoaderIdentity, loaderContextOf(plan.artifacts[0], site).identity);
  assert.equal(plan.businessDiscovery, true);
  assert.equal(plan.deferred.length, 0);
  assert.equal(publicMetadata.summary.configuredBindings, 8);
  assert.equal(publicMetadata.summary.configuredSourceScenarios, 7);
  assert.equal(publicMetadata.inventory[0].configuredApis, 2);
  assert.equal(publicMetadata.inventory[0].configuredExecutionExts, 2);
  for (const secret of [SECRET, SIGNATURE, MAIN_SIGNATURE, 'different-key', 'capture-first']) assert.equal(JSON.stringify(publicMetadata).includes(secret), false);
  assert.equal(JSON.stringify(input), before);
});

test('missing original main is unexecuted; explicit standalone diagnostics are separately identified', () => {
  const missing = binding('missing', { mainSha: null }), duplicate = binding('duplicate', { mainSha: null, key: 'missing' });
  const invalid = binding('invalid', { mainSha: sha('invalid main') });
  const input = frozen([missing, duplicate, invalid], [artifact(ARTIFACT), artifact(sha('invalid main'), false)]);
  const regular = buildWorkingSourcePlan(input, { sha256: [ARTIFACT] });
  assert.equal(regular.plan.artifacts.length, 0);
  assert.deepEqual(regular.plan.unexecuted.map(row => row.reason), ['original-main-not-captured', 'original-main-not-captured', 'original-main-content-invalid']);
  assert.equal(Object.hasOwn(regular, 'diagnosticPlan'), false);
  const result = buildWorkingSourcePlan(input, { sha256: [ARTIFACT] }, { includeStandaloneDiagnostics: true });
  assert.deepEqual(result.plan, regular.plan, 'diagnosis cannot alter original plan');
  assert.equal(result.diagnosticPlan.artifacts.length, 1);
  const site = result.diagnosticPlan.artifacts[0].sites[0];
  assert.equal(result.diagnosticPlan.artifacts[0].sites.length, 1);
  assert.equal(site.references.length, 2);
  assert.equal(site.jar, SIGNATURE);
  assert.equal(site.ext, SECRET);
  assert.equal(site.key, missing.source.key);
  assert.equal(Object.hasOwn(site.loaderContext, 'main'), false);
  assert.equal(site.originalMissingContext.reason, 'original-main-not-captured');
  assert.equal(site.originalMissingContext.mainSignatureSha256, sha(MAIN_SIGNATURE));
  assert.equal(result.publicMetadata.summary.unexecutedBindings, 3);
  assert.equal(result.publicMetadata.standaloneDiagnostics.cases.length, 1);
  assert.equal(result.diagnosticPlan.standaloneDiagnostic, true);
  assert.equal(JSON.stringify(result.publicMetadata).includes(SECRET), false);
});

test('missing bytes, helper-only references, exact-ext failures and private APIs do not invent executable sources', () => {
  const structured = binding('structured', { ext: { private: SECRET } });
  const stale = binding('stale'); stale.executionExtSha256 = sha('changed');
  const good = binding('private-api', { api: 'https://provider.invalid/script?token=' + SECRET });
  const helper = { ...binding('helper'), kind: 'unused-main', artifactSha256: MAIN };
  const result = buildWorkingSourcePlan(frozen([structured, stale, good, helper]), { sha256: [ARTIFACT, MAIN, sha('missing')] });
  assert.equal(result.plan.artifacts.length, 1);
  assert.equal(result.plan.artifacts[0].sites.length, 1);
  assert.deepEqual(result.plan.unexecuted.map(row => row.reason), ['exact-string-ext-unavailable', 'exact-ext-hash-differs', 'no-original-executable-binding', 'selected-sha-not-captured']);
  assert.equal(result.publicMetadata.cases[0].api, 'sha256:' + sha(good.source.api));
  assert.equal(JSON.stringify(result.publicMetadata).includes(SECRET), false);
});

test('provider reserved execution, provenance and method-policy fields cannot change the plan', () => {
  const original = binding('reserved'), forged = structuredClone(original);
  Object.assign(forged.source, { calls: [{ method: 'searchContent', params: [SECRET] }], loaderContext: { role: 'main' },
    expectedLoaderIdentity: { loaderMode: 'main' }, caseIdentitySha256: SECRET, loaderContextSha256: SECRET,
    references: [{ sourceKey: SECRET }], symbolMap: { protectedBind: SECRET }, targetApk: SECRET, targetPackage: SECRET,
    methodSelection: { methods: ['delete'] }, methodSelectionSha256: SECRET, coverage: { allPassed: true },
    sourceScenarioSha256: SECRET, selectedContexts: [SECRET], limits: { callMs: 1 }, runtimeOptions: { command: SECRET },
    originalMissingContext: { reason: SECRET }, originalMissingContextSha256: SECRET, businessDiscovery: false });
  const a = buildWorkingSourcePlan(frozen([original]), { sha256: [ARTIFACT] });
  const b = buildWorkingSourcePlan(frozen([forged]), { sha256: [ARTIFACT] });
  assert.deepEqual(b, a);
  assert.equal(a.plan.methodSelection.methods.length, 9);
  assert.equal(workingMethodSelection.methods.filter(row => row.method === 'searchContent').length, 2);
});

test('full SHA selection, standalone boolean opt-in, and safe fixture endpoints are enforced', () => {
  for (const selection of [{ sha256: [] }, { sha256: ['abc'] }, { sha256: [ARTIFACT, ARTIFACT] }]) {
    assert.throws(() => buildWorkingSourcePlan(frozen(), selection), /WORKING_PLAN_(?:SELECTION|DUPLICATE_SELECTION)/);
  }
  assert.throws(() => buildWorkingSourcePlan(frozen(), { sha256: [ARTIFACT] }, { includeStandaloneDiagnostics: 'yes' }), /WORKING_PLAN_DIAGNOSTIC_FLAG/);
  for (const base of ['file:///tmp', 'http://u:p@localhost:123', 'http://localhost?token=' + SECRET]) {
    assert.throws(() => buildWorkingSourcePlan(frozen(), { sha256: [ARTIFACT] }, { base }), /ROLE_FIXTURE_BASE_URL/);
  }
});

test('shared scenario identity reproduces normal and standalone plans and rejects altered original missing-main provenance', () => {
  const original = binding('normal'), missing = binding('missing', { mainSha: null });
  const result = buildWorkingSourcePlan(frozen([original, missing]), { sha256: [ARTIFACT] }, { includeStandaloneDiagnostics: true });
  const artifact = result.plan.artifacts[0], site = artifact.sites[0];
  assert.equal(workingSourceScenarioIdentity(artifact, site), site.caseIdentitySha256);
  const diagnosticArtifact = result.diagnosticPlan.artifacts[0], diagnosticSite = diagnosticArtifact.sites[0];
  assert.equal(workingSourceScenarioIdentity(diagnosticArtifact, diagnosticSite, { originalBinding: missing }), diagnosticSite.caseIdentitySha256);
  assert.throws(() => workingSourceScenarioIdentity(diagnosticArtifact, diagnosticSite), /SCENARIO_DIAGNOSTIC_BINDING/);
  for (const change of [
    row => { row.main.signature += '&changed=1'; },
    row => { row.main.retrievalOk = true; },
    row => { row.sourceKey = 'different source'; },
    row => { row.source.ext = 'changed ext'; },
    row => { row.id = sha('different binding'); },
  ]) {
    const altered = structuredClone(missing); change(altered);
    assert.throws(() => workingSourceScenarioIdentity(diagnosticArtifact, diagnosticSite, { originalBinding: altered }), /SCENARIO_DIAGNOSTIC_BINDING/);
  }
  assert.notEqual(workingSourceScenarioIdentity(artifact, { ...site, key: 'another key' }), site.caseIdentitySha256);
  assert.throws(() => workingSourceScenarioIdentity(artifact, { ...site, ext: 'changed ext' }), /SCENARIO_SCHEMA/);
});

async function diskFixture(t) {
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'tvbox-working-plan-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const capture = join(directory, 'capture'), out = join(directory, 'private-plan');
  await mkdir(join(capture, 'captures', 'catalog-1'), { recursive: true });
  await mkdir(join(capture, 'artifacts'));
  const bytes = Buffer.from('owned site JAR'), digest = sha(bytes), raw = Buffer.from('owned response');
  await writeFile(join(capture, 'artifacts', digest + '.jar'), bytes);
  const config = { globals: { spider: '' }, sites: [{ key: 'original-key', api: 'csp_Fixture', type: 3, jar: SIGNATURE, ext: SECRET }] };
  await writeJson(join(capture, 'captures/catalog-1/config.json'), config);
  await writeFile(join(capture, 'captures/catalog-1/raw-00.bin'), raw);
  const entry = { id: 'catalog-1', publicName: '公开目录', parseSuccess: true, configFile: 'captures/catalog-1/config.json',
    configSha256: sha(await readFile(join(capture, 'captures/catalog-1/config.json'))), responses: [{ file: 'raw-00.bin', sha256: sha(raw), bytes: raw.length }] };
  const item = { id: digest, sha256: digest, jarPath: 'artifacts/' + digest + '.jar', bytes: bytes.length, sites: [] };
  await Promise.all([writeFile(join(capture, 'index.html'), 'owned index'), writeFile(join(capture, 'list.txt'), 'owned catalog'),
    writeJson(join(capture, 'site-config.json'), {}), writeJson(join(capture, 'captures/catalog-1/metadata.json'), entry),
    writeJson(join(capture, 'inventory.json'), { entries: [entry] }),
    writeJson(join(capture, 'input-manifest.json'), { schemaVersion: 1, limits: { loadMs: 45000 }, artifacts: [item] }),
    writeJson(join(capture, 'artifact-inventory.json'), { artifacts: [{ ...item, inspection: { ok: true } }],
      retrievals: [{ role: 'site', signature: SIGNATURE, ok: true, sha256: digest, bytes: bytes.length }] })]);
  await freezeCatalog({ directory: capture });
  return { directory, capture, out, digest };
}

test('disk preparation verifies immutable bytes, emits private owner-only files, rejects nonempty/overlapping/symlink outputs', async t => {
  const f = await diskFixture(t);
  const result = await prepareWorkingSourcePlan({ directory: f.capture, selection: { sha256: [f.digest] }, out: f.out, includeStandaloneDiagnostics: true });
  assert.equal(result.pins.summary.cases, 1);
  assert.equal(result.pins.planSha256, sha(await readFile(join(f.out, 'oracle-plan.json'))));
  assert.equal(result.pins.diagnosticPlanSha256, sha(await readFile(join(f.out, 'diagnostic-plan.json'))));
  assert.equal((await lstat(f.out)).mode & 0o777, 0o700);
  assert.equal((await lstat(join(f.out, 'oracle-plan.json'))).mode & 0o777, 0o600);
  assert.equal(JSON.stringify(result.pins).includes(SECRET), false);
  assert.equal((await verifyCatalogFreeze({ directory: f.capture })).ok, true);
  await assert.rejects(prepareWorkingSourcePlan({ directory: f.capture, selection: { sha256: [f.digest] }, out: f.out }), /WORKING_PLAN_OUTPUT_NOT_EMPTY/);
  await assert.rejects(prepareWorkingSourcePlan({ directory: f.capture, selection: { sha256: [f.digest] }, out: join(f.capture, 'plan') }), /WORKING_PLAN_OUTPUT_OVERLAPS_CAPTURE/);
  await symlink(f.out, join(f.directory, 'linked-plan'));
  await assert.rejects(prepareWorkingSourcePlan({ directory: f.capture, selection: { sha256: [f.digest] }, out: join(f.directory, 'linked-plan', 'child') }), /WORKING_PLAN_OUTPUT_PATH/);
  await writeFile(join(f.capture, 'index.html'), 'changed input');
  await assert.rejects(prepareWorkingSourcePlan({ directory: f.capture, selection: { sha256: [f.digest] }, out: join(f.directory, 'another') }), /FREEZE_INPUT_CHANGED/);
});

test('CLI prints only aggregate pins and enables diagnostics only through explicit flag', async t => {
  const f = await diskFixture(t), selectionPath = join(f.directory, 'selection.json');
  await writeJson(selectionPath, { sha256: [f.digest] });
  const result = spawnSync(process.execPath, ['scripts/compat/prepare-working-source-plan.mjs', '--directory', f.capture,
    '--selection', selectionPath, '--out', f.out, '--include-standalone-diagnostics'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).cases, 1);
  assert.equal(result.stdout.includes(SECRET), false);
  assert.equal(result.stdout.includes(f.directory), false);
});
