// SPDX-License-Identifier: GPL-3.0-only
// Owned plan/ART-shaped fixtures; no provider code, Android, network or services.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildWorkingSourcePlan, workingSourceScenarioIdentity } from '../scripts/compat/prepare-working-source-plan.mjs';
import { buildWorkingStandaloneControls, prepareWorkingStandaloneControls } from '../scripts/compat/prepare-working-standalone-controls.mjs';
import { loaderContextOf, officialOracleApkSha256 } from '../scripts/android/loader-context.mjs';
import { prepareWorkingSourceCases, runWorkingSourcePlan } from '../scripts/container/working-source-probe.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const SECRET = 'CONTROL_PRIVATE_482', SIGNATURE = 'https://provider.invalid/site.jar?token=' + SECRET;
const MAIN_SIGNATURE = 'https://provider.invalid/main.jar?token=' + SECRET;
const ARTIFACT = sha('owned site JAR'), MAIN = sha('owned main JAR');
const artifact = sha256 => ({ sha256, jarPath: 'artifacts/' + sha256 + '.jar', validContent: true });
const call = (method, params, { step, value, skip = false } = {}) => {
  const metadata = { method, discoveryStep: step, status: skip ? 'not-tested' : 'nonempty', success: !skip,
    ...(typeof value === 'string' ? { response: { bytes: Buffer.byteLength(value), sha256: sha(value) } } : {}) };
  return { method, params, metadata, ...(typeof value === 'string' ? { value } : {}) };
};
function fixture() {
  const bindings = ['first', 'second'].map(id => ({ id: sha(id), captureId: 'capture-' + id, configSha256: sha('config-' + id), publicName: '公开目录', partial: false,
    artifactSha256: ARTIFACT, kind: 'jar-csp', role: 'site', retrievalOk: true, signature: SIGNATURE,
    sourceKey: id, api: 'csp_Owned', executionExtSha256: sha(SECRET), canonicalExtSha256: sha(JSON.stringify(SECRET)),
    main: { signature: MAIN_SIGNATURE, artifactSha256: MAIN, retrievalOk: true }, source: { key: id, api: 'csp_Owned', type: 3, jar: SIGNATURE, ext: SECRET } }));
  const { plan: parent } = buildWorkingSourcePlan({ schemaVersion: 1, inputSetSha256: sha('inputs'), filesSha256: sha('files'), artifacts: [artifact(ARTIFACT), artifact(MAIN)], bindings }, { sha256: [ARTIFACT] });
  const parentBytes = Buffer.from(JSON.stringify(parent, null, 2) + '\n'), parentManifestSha256 = sha(parentBytes), artRows = parent.artifacts[0].sites.map((site, siteIndex) => {
    const privateCalls = [call('homeContent', [true], { step: 'home', value: '{"class":[]}' }),
      call('playerContent', ['returned-flag', SECRET + '$opaque', []], { step: 'player', value: '{"url":"https://provider.invalid/' + SECRET + '"}' }),
      call('categoryContent', [], { step: 'category-filter', skip: true })];
    const report = { schemaVersion: 1, manifestSha256: parentManifestSha256, artifactIndex: 0, siteIndex, id: ARTIFACT, jarSha256: ARTIFACT,
      api: site.api, siteKey: site.key, extSha256: sha(site.ext), targetApkSha256: officialOracleApkSha256, symbolMapSha256: sha('owned symbol map'),
      ...loaderContextOf(parent.artifacts[0], site).identity, loadSuccess: true, initSuccess: true, jarBytesVerified: true, mainJarBytesVerified: true,
      calls: privateCalls.map(row => row.metadata) };
    const result = { report, privateCalls }, bytes = Buffer.from(JSON.stringify(result, null, 2) + '\n');
    return { caseId: `0-${siteIndex}`, result, bytes, privateResultSha256: sha(bytes) };
  });
  return { parent, parentBytes, parentManifestSha256, artRows };
}

test('omitted-main controls preserve exact source/ART arguments and separate altered context from original success', () => {
  const f = fixture(), before = JSON.stringify(f), { plan, pins } = buildWorkingStandaloneControls(f.parent, f.artRows, f);
  assert.equal(plan.standaloneControl, true);
  assert.equal(Object.hasOwn(plan, 'standaloneDiagnostic'), false, 'frozen runner reserves the root flag for truly unavailable mains');
  assert.equal(plan.businessDiscovery, false);
  assert.equal(pins.summary.cases, 2);
  assert.equal(pins.summary.plannedCallSlots, 6);
  assert.equal(pins.summary.executableCalls, 4);
  for (const [index, site] of plan.artifacts[0].sites.entries()) {
    const original = f.parent.artifacts[0].sites[index];
    assert.equal(site.key, original.key); assert.equal(site.api, original.api); assert.equal(site.ext, original.ext); assert.equal(site.jar, original.jar);
    assert.equal(Object.hasOwn(site.loaderContext, 'main'), false);
    assert.equal(site.originalOmittedContext.reason, 'original-main-intentionally-omitted');
    assert.equal(site.originalOmittedContext.mainArtifactSha256, MAIN);
    assert.equal(site.originalOmittedContext.parentCaseIdentitySha256, original.caseIdentitySha256);
    assert.equal(site.parentParametersSource.privateResultSha256, f.artRows[index].privateResultSha256);
    assert.equal(site.caseIdentitySha256, workingSourceScenarioIdentity(plan.artifacts[0], site));
    assert.notEqual(site.caseIdentitySha256, original.caseIdentitySha256);
    assert.equal(Object.hasOwn(site, 'originalMissingContext'), false);
    assert.deepEqual(site.calls.map(row => row.params), f.artRows[index].result.privateCalls.map(row => row.params));
    assert.equal(site.calls[2].metadata.status, 'not-tested');
    assert.equal(Object.hasOwn(site.calls[0], 'value'), false, 'parent responses are not reusable execution outcomes');
  }
  assert.equal(JSON.stringify(f), before);
  assert.equal(JSON.stringify(pins).includes(SECRET), false);
  assert.equal(JSON.stringify(pins).includes(SIGNATURE), false);
});

test('case selection retains parent linkage after compressed output indexing and rejects unknown cases', () => {
  const f = fixture(), { plan, pins } = buildWorkingStandaloneControls(f.parent, [f.artRows[1]], { ...f, onlyCases: ['0-1'] });
  assert.equal(plan.artifacts[0].sites.length, 1);
  assert.equal(plan.artifacts[0].sites[0].originalOmittedContext.parentCase, '0-1');
  assert.equal(pins.cases[0].caseId, '0-0'); assert.equal(pins.cases[0].parentCase, '0-1');
  assert.throws(() => buildWorkingStandaloneControls(f.parent, f.artRows, { ...f, onlyCases: ['8-8'] }), /UNKNOWN_CASE/);
  assert.throws(() => buildWorkingStandaloneControls(f.parent, f.artRows, { ...f, onlyCases: ['0-0', '0-0'] }), /CASE_SELECTION/);
});

test('parent ART manifest, loader, method parameters, metadata and response bytes are checked before derivation', () => {
  const f = fixture();
  for (const mutate of [
    row => { row.result.report.manifestSha256 = sha('other manifest'); },
    row => { row.result.report.mainJarSha256 = sha('other main'); },
    row => { row.result.privateCalls[0].params = ['wrong home argument']; },
    row => { row.result.privateCalls[0].metadata.status = 'forged'; },
    row => { row.result.privateCalls[0].value = 'changed response'; },
  ]) {
    const rows = structuredClone(f.artRows); mutate(rows[0]);
    assert.throws(() => buildWorkingStandaloneControls(f.parent, rows, f));
  }
  assert.throws(() => buildWorkingStandaloneControls(f.parent, [f.artRows[0]], f), /ART_CASE_MISSING/);
  const changedParent = structuredClone(f.parent); changedParent.artifacts[0].sites[0].key = 'changed key';
  assert.throws(() => buildWorkingStandaloneControls(changedParent, f.artRows, f), /PARENT_SCENARIO/);
});

test('prepared controls run with the frozen probe as explicit calls without main loading or ART loader parity assertions', async t => {
  const f = fixture(), directory = await mkdtemp(join(await realpath(tmpdir()), 'tvbox-standalone-control-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const parentDir = join(directory, 'parent'), artDir = join(directory, 'art'), output = join(directory, 'controls'), inputRoot = join(directory, 'inputs');
  await Promise.all([mkdir(parentDir), mkdir(artDir), mkdir(join(inputRoot, 'artifacts'), { recursive: true })]);
  const parentPlanPath = join(parentDir, 'oracle-plan.json'); await writeFile(parentPlanPath, f.parentBytes);
  for (const row of f.artRows) await writeFile(join(artDir, row.caseId + '-private.json'), row.bytes);
  await writeFile(join(inputRoot, 'artifacts', ARTIFACT + '.jar'), 'owned site JAR');
  const generated = await prepareWorkingStandaloneControls({ parentPlanPath, artResultsDir: artDir, out: output, onlyCases: ['0-1'] });
  assert.equal((await lstat(output)).mode & 0o777, 0o700);
  assert.equal((await lstat(join(output, 'oracle-plan.json'))).mode & 0o777, 0o600);
  assert.equal(generated.pins.planSha256, sha(await readFile(join(output, 'oracle-plan.json'))));
  const prepared = await prepareWorkingSourceCases(join(output, 'oracle-plan.json'), { inputRoot });
  assert.equal(Object.hasOwn(prepared.cases[0], 'android'), false);
  assert.equal(Object.hasOwn(prepared.cases[0], 'standaloneDiagnostic'), false);
  const called = [], runtime = { request: async () => ({ enabled: false }), registerJar: async () => {},
    loadMain: async () => { throw new Error('control must not load main'); }, setModules: async () => {},
    getCSP: async () => ({ ready: true, token: 'owned', className: 'fixture.Owned' }), getState: async () => ({ jar: { loaderCount: 1 } }),
    call: async (token, method, params) => { called.push([method, params]); return method === 'playerContent' ? '{"url":"https://owned.invalid/media"}' : '{"class":[]}'; }, close: async () => {} };
  const observed = await runWorkingSourcePlan(join(output, 'oracle-plan.json'), { inputRoot, mode: 'replay', runtimeFactory: () => runtime });
  assert.equal(observed.cases[0].report.parameterSource, 'explicit-plan');
  assert.deepEqual(called, [['homeContent', [true]], ['playerContent', ['returned-flag', SECRET + '$opaque', []]]]);
  assert.equal(observed.cases[0].report.calls[2].status, 'not-tested');
  assert.equal(observed.cases[0].report.cleanup.temporaryDataRemoved, true);
  await assert.rejects(prepareWorkingStandaloneControls({ parentPlanPath, artResultsDir: artDir, out: output }), /OUTPUT_NOT_EMPTY/);
});
