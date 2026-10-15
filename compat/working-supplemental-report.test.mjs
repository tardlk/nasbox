// SPDX-License-Identifier: GPL-3.0-only
// Synthetic immutable evidence only; no provider/runtime/container execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifySupplementalContainer, verifySupplementalNASCase, workingSupplementalMarkdown } from '../scripts/compat/working-supplemental-report.mjs';
import { loaderContextOf } from '../scripts/android/loader-context.mjs';
import { workingSourceBudgets } from '../scripts/container/working-source-probe.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const IMAGE = 'sha256:' + sha('owned image'), RUNNER = sha('owned executed runner'), PRIVATE = 'SUPPLEMENT_PRIVATE_f4';
function container(mode = 'discover', extra = '/extra') {
  return [{ Id: sha('owned container'), Image: IMAGE, Config: { User: '10001:10001' }, Path: 'node',
    Args: ['scripts/container/working-source-probe.mjs', '--plan', extra + '/oracle-plan.json',
      ...(mode === 'replay' ? ['--calls-dir', extra + '/art-results'] : []), '--mode', mode, '--input-root', '/input', '--case-index', '0',
      '--output', '/output/case-000-private.json', '--metadata', '/output/case-000-metadata.json'],
    Mounts: ['/input', '/run', '/opt/tvbox/scripts', extra].map(Destination => ({ Destination, RW: false })).concat([{ Destination: '/output', RW: true }]),
    State: { Running: false, Status: 'exited', ExitCode: 0, OOMKilled: false, Error: '' },
    HostConfig: { ReadonlyRootfs: true, Privileged: false, RestartPolicy: { Name: 'no' } } }];
}
function fixture() {
  const artifact = { id: sha('owned jar'), sha256: sha('owned jar'), jarPath: 'owned.jar' };
  const site = { key: PRIVATE, api: 'csp_Owned', ext: PRIVATE, jar: '', loaderContext: { role: 'main', signature: 'owned signature' },
    caseIdentitySha256: sha('scenario'), sourceScenarioSha256: sha('scenario'), calls: [{ method: 'searchContent', params: [PRIVATE, false], metadata: { discoveryStep: 'search' } }] };
  const plan = { schemaVersion: 1, artifacts: [{ ...artifact, sites: [site] }] }, planSha256 = sha(JSON.stringify(plan));
  const metadata = { method: 'searchContent', discoveryStep: 'search', status: 'empty', paramsSha256: sha(JSON.stringify([PRIVATE, false])), response: { bytes: 11, sha256: sha('{"list":[]}') } };
  const report = { schemaVersion: 1, caseId: '0-0', artifactIndex: 0, siteIndex: 0, manifestSha256: planSha256,
    jarSha256: artifact.sha256, extSha256: sha(PRIVATE), siteKeySha256: sha(PRIVATE), api: site.api, caseIdentitySha256: site.caseIdentitySha256,
    sourceScenarioSha256: site.sourceScenarioSha256, ...loaderContextOf(artifact, site).identity, loadSuccess: true, jarBytesVerified: true,
    initSuccess: true, mode: 'discover', parameterSource: 'explicit-plan', applicationStatePolicy: 'fresh-runtime-data', initPolicy: 'android',
    budgets: workingSourceBudgets(plan), calls: [metadata], cleanup: { closed: true, workerExited: true, temporaryDataRemoved: true } };
  const value = { input: { artifact, site }, report, privateCalls: [{ method: 'searchContent', params: [PRIVATE, false], value: '{"list":[]}', metadata }] };
  const bundle = { schemaVersion: 1, manifestSha256: planSha256, runnerSha256: RUNNER, cases: [value] };
  return { entry: { artifact, site, artifactIndex: 0, siteIndex: 0, caseId: '0-0' }, bundle,
    metadata: { ...bundle, cases: [report] }, options: { plan, planSha256, probeSha256: RUNNER, mode: 'discover' } };
}
const validate = f => verifySupplementalNASCase(f.entry, f.bundle, f.metadata, f.options);

test('supplemental containers require exact image, UID, launch arguments, read-only inputs and observed exit', () => {
  const row = verifySupplementalContainer(container(), 0, { imageId: IMAGE, index: 0 });
  assert.equal(row.exitCode, 0);assert.equal(row.user, '10001:10001');assert.equal(row.running, false);
  for (const alter of [
    value => { value.Image = 'sha256:' + sha('changed'); }, value => { value.Config.User = '0'; },
    value => { value.State.Running = true; }, value => { value.State.ExitCode = 1; },
    value => { value.Args[2] = '/other/plan.json'; }, value => { value.Mounts[0].RW = true; },
    value => { value.HostConfig.ReadonlyRootfs = false; },
  ]) {
    const changed = container();alter(changed[0]);assert.throws(() => verifySupplementalContainer(changed, 0, { imageId: IMAGE, index: 0 }), /SUPPLEMENTAL_REPORT_CONTAINER_/);
  }
  const old = container('replay', '/followup');old[0].State.ExitCode = 1;
  assert.equal(verifySupplementalContainer(old, 1, { imageId: IMAGE, index: 0, mode: 'replay', extra: '/followup' }).exitCode, 1);
});

test('supplemental NAS verification binds private raw values, exact explicit parameters, metadata, context and cleanup', () => {
  const f = fixture();assert.equal(validate(f).report.initSuccess, true);
  for (const change of [
    f => { f.bundle.runnerSha256 = sha('other runner'); }, f => { f.bundle.cases[0].input.site = { ...f.entry.site, ext: 'changed' }; },
    f => { f.bundle.cases[0].privateCalls[0].params = ['invented', false]; },
    f => { f.bundle.cases[0].privateCalls[0].value = '{"list":[1]}'; },
    f => { f.bundle.cases[0].report.mainSignatureSha256 = sha('other main'); },
    f => { f.bundle.cases[0].report.cleanup.temporaryDataRemoved = false; },
  ]) {
    const changed = fixture();change(changed);assert.throws(() => validate(changed), /SUPPLEMENTAL_REPORT_|INPUT_CHECKSUM/);
  }
});

test('markdown separates altered-loader controls and harness refusals from provider failures', () => {
  const report = { generatedAt: '2026-10-15T18:00:00.000Z', tracks: [{ tag: 'controls', control: true,
    summary: { cases: 1, ready: 1, cleanupPassed: 1, containerZeroExit: 1,
      art: Object.fromEntries(['nonempty', 'empty', 'not-implemented', 'invalid-json', 'network', 'failed', 'timeout', 'not-tested'].map(s => [s, 0])),
      nas: Object.fromEntries(['nonempty', 'empty', 'not-implemented', 'invalid-json', 'network', 'failed', 'timeout', 'not-tested'].map(s => [s, s === 'nonempty' ? 1 : 0])) },
    cases: [{ caseId: '0-0', parentCaseId: '0-0', api: 'csp_Owned', calls: [{ discoveryStep: 'search', nas: { status: 'nonempty' } }] }] }],
    harnessRejectedAttempts: [{ providerFailure: false }] };
  const text = workingSupplementalMarkdown(report);
  assert.ok(text.includes('2026-10-16 02:00:00'));assert.ok(text.includes('不能代替原主包与站点包共存结果'));
  assert.ok(text.includes('JAR 未执行，不计为提供方/JAR 失败'));assert.ok(!text.includes(PRIVATE));
});
