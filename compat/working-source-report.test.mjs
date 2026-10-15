// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loaderContextOf, officialOracleApkSha256 } from '../scripts/android/loader-context.mjs';
import { buildWorkingSourcePlan } from '../scripts/compat/prepare-working-source-plan.mjs';
import { probeWorkingSource } from '../scripts/container/working-source-probe.mjs';
import { buildWorkingSourceReport, compareWorkingSourceCase, summarizeWorkingCall, workingSourceMarkdown } from '../scripts/compat/working-source-report.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const IMAGE = 'sha256:' + sha('owned NAS image'), RUNNER = sha('owned runner');
const PRIVATE = 'sensitive-opaque-source';
const writeJson = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n');

async function diskFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'tvbox-working-report-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const inputRoot = join(directory, 'input'), plansRoot = join(directory, 'plans'), artRoot = join(directory, 'art'), nasRoot = join(directory, 'nas'), sourceRoot = join(directory, 'sources');
  await mkdir(join(inputRoot, 'artifacts'), { recursive: true });
  const jars = [Buffer.from('owned original jar'), Buffer.from('owned standalone jar')];
  const artifacts = jars.map(bytes => ({ sha256: sha(bytes), jarPath: 'artifacts/' + sha(bytes) + '.jar', validContent: true }));
  for (const [index, artifact] of artifacts.entries()) await writeFile(join(inputRoot, artifact.jarPath), jars[index]);
  const bindings = artifacts.map((artifact, index) => {
    const signature = 'https://provider.invalid/' + PRIVATE + index + '.jar';
    const key = PRIVATE + index;
    return { id: sha('binding' + index), artifactSha256: artifact.sha256, role: index === 0 ? 'main' : 'site', signature,
      kind: 'jar-csp', retrievalOk: true, sourceKey: key, api: 'csp_Owned', captureId: 'capture' + index,
      configSha256: sha('config' + index), executionExtSha256: sha(PRIVATE), canonicalExtSha256: sha(JSON.stringify(PRIVATE)),
      main: { signature: index ? 'https://provider.invalid/missing-' + PRIVATE + '.jar' : '', retrievalOk: false, artifactSha256: null },
      source: { key, type: 3, api: 'csp_Owned', jar: index ? signature : '', ext: PRIVATE } };
  });
  const freeze = { schemaVersion: 1, inputSetSha256: sha('frozen-input'), filesSha256: sha('frozen-files'), artifacts, bindings, limits: {} };
  await writeJson(join(inputRoot, 'freeze.json'), freeze);
  const prepared = buildWorkingSourcePlan(freeze, { sha256: artifacts.map(row => row.sha256) }, { includeStandaloneDiagnostics: true });
  const runPlans = [];
  for (const [name, source] of [['original', prepared.plan], ['standalone', prepared.diagnosticPlan]]) {
    const plan = { ...source, artStatePolicy: 'fresh-app-data', artBudgets: { caseMs: 300000, loadMs: 90000, initMs: 15000, callMs: 12000 }, nasBudgets: { caseMs: 300000, loadMs: 90000, initMs: 15000, callMs: 12000 } };
    for (const dir of [join(plansRoot, name), join(artRoot, name + '-results'), join(nasRoot, name)]) await mkdir(dir, { recursive: true });
    const planPath = join(plansRoot, name, 'oracle-plan.json'); await writeJson(planPath, plan);
    const planSha256 = sha(await readFile(planPath));
    const artifact = plan.artifacts[0], site = artifact.sites[0], context = loaderContextOf(artifact, site);
    runPlans.push({ mode: name, manifestSha256: planSha256, cases: [{ index: 0, caseId: '0-0', artifactIndex: 0, siteIndex: 0, sha256: artifact.sha256, sourceScenarioSha256: site.sourceScenarioSha256 }] });
    const privateCalls = [
      { method: 'homeContent', params: [true], value: JSON.stringify({ class: [{ type_id: PRIVATE }] }), metadata: { method: 'homeContent', discoveryStep: 'home', status: 'nonempty' } },
      { method: 'homeVideoContent', params: [], value: '', metadata: { method: 'homeVideoContent', discoveryStep: 'home-video', status: 'not-implemented', methodProvenance: { declaringClass: 'com.github.catvod.crawler.Spider', baseSpiderClass: 'com.github.catvod.crawler.Spider', inheritedBaseDefault: true, baseDelegatingOverload: false } } },
      { method: 'searchContent', params: [], metadata: { method: 'searchContent', discoveryStep: 'search', status: 'not-tested', reason: 'no-derived-keyword' } },
      { method: 'playerContent', params: ['flag', PRIVATE, []], value: '{"url":"https://private.invalid/media?token=secret"}', metadata: { method: 'playerContent', discoveryStep: 'player', status: 'nonempty' } },
    ];
    for (const call of privateCalls) if (typeof call.value === 'string') call.metadata.response = { sha256: sha(call.value), bytes: Buffer.byteLength(call.value) };
    const report = { schemaVersion: 1, caseId: '0-0', artifactIndex: 0, siteIndex: 0, manifestSha256: planSha256, jarSha256: artifact.sha256,
      id: artifact.id, api: site.api, siteKey: site.key, extSha256: sha(site.ext), ...context.identity,
      targetApkSha256: officialOracleApkSha256, symbolMapSha256: sha('owned symbol map'), budgets: plan.artBudgets,
      applicationStatePolicy: plan.artStatePolicy, loadSuccess: true, initSuccess: true, jarBytesVerified: true,
      calls: privateCalls.map(call => call.metadata), spiderClass: 'com.github.catvod.spider.Owned' };
    const android = { report, privateCalls }, artPath = join(artRoot, name + '-results', '0-0-private.json');
    await writeJson(artPath, android);
    const artBytes = await readFile(artPath);
    const collection = { manifestSha256: planSha256, runnerSha256: sha('collector'), budgets: plan.artBudgets, applicationStatePolicy: plan.artStatePolicy,
      cases: [{ id: '0-0', privateResultPulled: true, privateResultSha256: sha(artBytes), privateResultBytes: artBytes.length,
        report, adbExit: 0, instrumentationCode: -1, transportTimeout: false }] };
    await writeJson(join(artRoot, name + '-results', 'summary-private.json'), collection);
    const entry = { artifact, site, artifactIndex: 0, siteIndex: 0, manifestSha256: planSha256, android,
      ...(name === 'standalone' ? { standaloneDiagnostic: true, originalBinding: bindings[1] } : {}) };
    const nas = await probeWorkingSource(entry, { inputRoot, mode: 'replay', budgets: plan.nasBudgets, runtimeFactory: () => ({
      request: async () => ({}), loadMain: async () => ({ loaded: true }), registerJar: async () => {}, setModules: async () => {},
      getCSP: async () => ({ ready: true, token: 'owned', className: 'com.github.catvod.spider.Owned' }), getState: async () => ({ jar: { loaderCount: 1 } }),
      call: async (_token, method) => method === 'homeContent' ? '{"class":[{"type_id":"' + PRIVATE + '"}]}' : method === 'playerContent' ? '{"url":"https://private.invalid/media?token=secret"}' : '', close: async () => {},
    }) });
    assert.equal(nas.report.error, undefined);
    const bundle = { schemaVersion: 1, manifestSha256: planSha256, runnerSha256: RUNNER, cases: [nas] };
    await writeJson(join(nasRoot, name, 'case-000-private.json'), bundle);
    await writeJson(join(nasRoot, name, 'case-000-metadata.json'), { ...bundle, cases: [nas.report] });
    await writeJson(join(nasRoot, name, 'case-000.inspect.json'), [{ Id: sha('container' + name), Image: IMAGE, Config: { User: '10001' },
      Path: 'node', Args: ['scripts/container/working-source-probe.mjs', '--plan', `/run/${name}/oracle-plan.json`, '--calls-dir', `/run/${name}/art-results`, '--mode', 'replay', '--input-root', '/input', '--case-index', '0', '--output', '/output/case-000-private.json', '--metadata', '/output/case-000-metadata.json'],
      Mounts: [{ Destination: '/input', RW: false }, { Destination: '/run', RW: false }, { Destination: '/opt/tvbox/scripts', RW: false }, { Destination: '/output', RW: true }],
      State: { Running: false, Status: 'exited', ExitCode: 0, OOMKilled: false, Error: '' } }]);
    await writeFile(join(nasRoot, name, 'case-000.exit.txt'), '0\n');
  }
  const sources = [['scripts/container/working-source-probe.mjs', 'owned runner'], ['scripts/android/run-oracle.mjs', 'collector'],
    ['scripts/android/loader-context.mjs', 'owned loader'], ['scripts/compat/prepare-working-source-plan.mjs', 'owned planner']];
  for (const [file, body] of sources) { await mkdir(join(sourceRoot, file, '..'), { recursive: true }); await writeFile(join(sourceRoot, file), body); }
  await writeJson(join(nasRoot, 'run-plan.json'), { schemaVersion: 1, image: IMAGE, sourcePins: sources.map(([file, body]) => ({ file, sha256: sha(body) })), plans: runPlans,
    budgets: { caseMs: 300000, loadMs: 90000, initMs: 15000, callMs: 12000 }, outerSeconds: 320, shards: 3 });
  return { directory, inputRoot, plansRoot, artRoot, nasRoot, sourceRoot, imageId: IMAGE, runnerSha256: RUNNER, verifyFreeze: false };
}

test('full report validates private/collection/container evidence and separates original from standalone', async t => {
  const options = await diskFixture(t), report = await buildWorkingSourceReport(options);
  assert.equal(report.tracks.length, 2);
  assert.equal(report.tracks[0].diagnostic, false);
  assert.equal(report.tracks[1].diagnostic, true);
  for (const track of report.tracks) {
    assert.equal(track.summary.cases, 1);
    assert.equal(track.summary.nasReady, 1);
    assert.equal(track.summary.artCalls['not-implemented'], 1);
    assert.equal(track.summary.nasCalls.empty, 1);
    assert.equal(track.summary.nasCalls['not-tested'], 7);
    assert.equal(track.summary.expectedMethodSlots, 10);
    assert.equal(track.summary.artRecordedCalls, 4);
    assert.equal(track.summary.artUnreachedSlots, 6);
    assert.equal(track.summary.parametersReplayed, 3);
    assert.equal(track.summary.playerNonemptyNAS, 1);
    assert.equal(track.summary.sameNonemptyJSON, 2);
    assert.equal(track.summary.nasCleanupPassed, 1);
  }
  assert.equal(report.tracks[0].unexecuted.length, 1);
  const publicText = JSON.stringify(report) + workingSourceMarkdown(report);
  for (const secret of [PRIVATE, 'provider.invalid', 'private.invalid', 'token=secret', 'https://']) assert.equal(publicText.includes(secret), false, secret);
});

test('ART private byte hash and collection report must match, preventing stale outputs', async t => {
  const options = await diskFixture(t), path = join(options.artRoot, 'original-results', '0-0-private.json');
  await writeFile(path, (await readFile(path, 'utf8')) + ' ');
  await assert.rejects(() => buildWorkingSourceReport(options), /ART_COLLECTION_HASH/);
});

test('NAS runner/image/user/exit and paired parameters are strict identity boundaries', async t => {
  const options = await diskFixture(t), path = join(options.nasRoot, 'original', 'case-000-private.json');
  const original = JSON.parse(await readFile(path));
  const changedRunner = structuredClone(original); changedRunner.runnerSha256 = sha('other runner');
  await writeJson(path, changedRunner);
  await assert.rejects(() => buildWorkingSourceReport(options), /NAS_BUNDLE/);
  await writeJson(path, original);
  const inspectPath = join(options.nasRoot, 'original', 'case-000.inspect.json'), inspect = JSON.parse(await readFile(inspectPath));
  inspect[0].Config.User = '0'; await writeJson(inspectPath, inspect);
  await assert.rejects(() => buildWorkingSourceReport(options), /DOCKER_USER/);
  inspect[0].Config.User = '10001'; inspect[0].Image = 'sha256:' + sha('other image'); await writeJson(inspectPath, inspect);
  await assert.rejects(() => buildWorkingSourceReport(options), /DOCKER_IMAGE/);
  inspect[0].Image = IMAGE; inspect[0].State.ExitCode = 2; await writeJson(inspectPath, inspect);
  await assert.rejects(() => buildWorkingSourceReport(options), /DOCKER_EXIT/);
  inspect[0].State.ExitCode = 0; await writeJson(inspectPath, inspect);
  const changedParams = structuredClone(original); changedParams.cases[0].privateCalls[0].params = [false]; await writeJson(path, changedParams);
  await assert.rejects(() => buildWorkingSourceReport(options), /PAIRED_PARAMS/);
});

test('missing NAS data is rejected in final report and explicit in preview', async t => {
  const options = await diskFixture(t);
  await rm(join(options.nasRoot, 'standalone', 'case-000-private.json'));
  await assert.rejects(() => buildWorkingSourceReport(options), /ENOENT/);
  const preview = await buildWorkingSourceReport({ ...options, preview: true });
  assert.equal(preview.preview, true);
  assert.equal(preview.tracks[1].summary.nasPresent, 0);
  assert.equal(preview.tracks[1].jars[0].cases[0].observation, 'missing-evidence');
  assert.equal(workingSourceMarkdown(preview).includes('预览'), true);
});

test('launch source hashes and the separate metadata file are verified before reporting', async t => {
  const options = await diskFixture(t), metadataPath = join(options.nasRoot, 'original', 'case-000-metadata.json');
  const metadata = JSON.parse(await readFile(metadataPath)), changed = structuredClone(metadata);
  changed.cases[0].initSuccess = false; await writeJson(metadataPath, changed);
  await assert.rejects(() => buildWorkingSourceReport(options), /NAS_METADATA_FILE/);
  await writeJson(metadataPath, metadata);
  await writeFile(join(options.sourceRoot, 'scripts/android/loader-context.mjs'), 'changed after dispatch');
  await assert.rejects(() => buildWorkingSourceReport(options), /SOURCE_PIN_BYTES/);
});

test('load/init failure preserves all ART slots without inventing parameter replay', async () => {
  const site = { key: 'private-key', api: 'csp_Fixture', ext: '', jar: '', loaderContext: { role: 'main', signature: 'original' } };
  const artifact = { sha256: sha('jar') };
  const art = { report: { symbolMapSha256: sha('map'), loadSuccess: true, initSuccess: true }, privateCalls: [
    { method: 'detailContent', params: [['actual-id']], value: '{"list":[{"vod_id":"actual-id"}]}', metadata: { status: 'nonempty', discoveryStep: 'detail' } },
  ] };
  const nas = { report: { artSymbolMapSha256: sha('map'), loadSuccess: false, cleanup: { closed: true, temporaryDataRemoved: true } }, privateCalls: [
    { method: 'detailContent', params: [], metadata: { status: 'not-tested', discoveryStep: 'detail' } },
  ] };
  const row = compareWorkingSourceCase({ artifact, site, caseId: '0-0' }, art, nas);
  assert.equal(row.calls[0].parametersReplayed, false);
  assert.equal(row.calls[0].observation, 'not-tested');
  assert.equal(row.calls[0].nas.status, 'not-tested');
});

test('empty strings, base defaults, malformed JSON and failure causes remain separate', () => {
  assert.equal(summarizeWorkingCall({ method: 'homeVideoContent', params: [], value: '', metadata: {} }, 'NAS').status, 'empty');
  assert.equal(summarizeWorkingCall({ method: 'homeContent', params: [true], value: '<html>', metadata: {} }, 'NAS').status, 'invalid-json');
  assert.equal(summarizeWorkingCall({ method: 'searchContent', params: ['x', false], error: { type: 'java.net.UnknownHostException' }, metadata: {} }, 'ART').status, 'network');
  assert.equal(summarizeWorkingCall({ method: 'searchContent', params: ['x', false], error: { type: 'java.util.concurrent.TimeoutException' }, metadata: {} }, 'ART').status, 'timeout');
  const invalid = summarizeWorkingCall({ method: 'homeContent', params: [true], value: '<html>private-response</html>',
    metadata: { status: 'invalid-json', error: { category: 'invalid-json', type: 'SyntaxError', fingerprint: sha('owned error') } } }, 'NAS');
  assert.equal(invalid.status, 'invalid-json');
  assert.equal(invalid.response.sha256, sha('<html>private-response</html>'));
  assert.equal(JSON.stringify(invalid).includes('private-response'), false);
  assert.throws(() => summarizeWorkingCall({ method: 'homeContent', params: [true], value: '{"class":[{}]}',
    metadata: { status: 'invalid-json', error: { category: 'invalid-json' } } }, 'NAS'), /INVALID_JSON_ERROR_RESPONSE/);
});

test('timeout-unreached steps remain in the denominator and semantic comparison ignores key order', () => {
  const site = { key: 'private-key', api: 'csp_Fixture', ext: '', jar: '', loaderContext: { role: 'main', signature: 'original' } };
  const artifact = { sha256: sha('jar') }, params = [true];
  const art = { report: { symbolMapSha256: sha('map'), timedOut: true, loadSuccess: true, initSuccess: true }, privateCalls: [
    { method: 'homeContent', params, value: '{"class":[{"type_id":"1"}],"filters":{}}', metadata: { status: 'nonempty', discoveryStep: 'home' } },
  ] };
  const nas = { report: { artSymbolMapSha256: sha('map'), loadSuccess: true, initSuccess: true, cleanup: { closed: true, temporaryDataRemoved: true } }, privateCalls: [
    { method: 'homeContent', params, value: '{"filters":{},"class":[{"type_id":"1"}]}', metadata: { status: 'nonempty', discoveryStep: 'home' } },
  ] };
  const row = compareWorkingSourceCase({ artifact, site, caseId: '0-0' }, art, nas, { expectedSteps: [['home', 'homeContent'], ['player', 'playerContent']] });
  assert.equal(row.calls.length, 2);
  assert.equal(row.calls[0].semanticEqual, true);
  assert.equal(row.calls[0].rawEqual, false);
  assert.equal(row.calls[1].art.status, 'not-tested');
  assert.equal(row.calls[1].art.reason, 'art-timeout-blocked');
  assert.equal(row.calls[1].art.recordPresent, false);
  assert.equal(row.calls[1].parametersReplayed, false);
});
