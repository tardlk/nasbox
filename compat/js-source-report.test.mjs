// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyJsResponse, probeJsSource, verifyJsHostBinding, verifyJsInputs } from '../scripts/container/js-source-probe.mjs';
import { buildJsSourceReport, compareJsTrackSources, jsLogMarkers, jsSourceReportMarkdown, summarizeJsCall } from '../scripts/compat/js-source-report.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const IMAGE = 'sha256:' + sha('owned image'), RUNNER = sha('owned JS probe');
const writeJson = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n');
const getJson = async path => JSON.parse(await readFile(path));
const PRIVATE = 'private-url-token';
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'tvbox-js-report-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const inputRoot = join(directory, 'input'), bundleRoot = join(directory, 'bundle'), nasRoot = join(directory, 'nas');
  for (const path of [inputRoot, bundleRoot, nasRoot, join(bundleRoot, 'host-binding/tvbox/runtime')]) await mkdir(path, { recursive: true });
  const source = { key: '自有测试源', type: 3, api: `https://${PRIVATE}.invalid/root.js`, ext: `https://${PRIVATE}.invalid/rule.js`, jar: '' };
  const text = 'export default {home(){return "owned"}}', rule = 'var rule={title:"owned"};';
  await writeFile(join(inputRoot, 'root.js'), text); await writeFile(join(inputRoot, 'rule.js'), rule);
  const plan = { schemaVersion: 1, sources: [source], modules: [{ url: source.api, path: 'root.js', sha256: sha(text), bytes: Buffer.byteLength(text) }],
    http: { mode: 'frozen', fixtures: [{ url: source.ext, path: 'rule.js', sha256: sha(rule), bytes: Buffer.byteLength(rule), status: 200, method: 'GET', headers: {} }] },
    budgets: { caseMs: 1000, initMs: 100, callMs: 50, closeMs: 50 } };
  await writeJson(join(inputRoot, 'input-plan.json'), plan);
  const freeze = { schemaVersion: 1, inputSetSha256: sha('owned capture freeze'), files: [] }; await writeJson(join(inputRoot, 'freeze.json'), freeze);
  const bindingSource = await readFile(new URL('../scripts/compat/js-fixture-host/tvbox/runtime/HostServices.java', import.meta.url));
  const classBytes = Buffer.from('owned synthetic class bytes'), bindingManifest = { schemaVersion: 1, sourceSha256: sha(bindingSource), files: [{ path: 'tvbox/runtime/HostServices.class', bytes: classBytes.length, sha256: sha(classBytes) }] };
  await writeFile(join(bundleRoot, 'host-binding/tvbox/runtime/HostServices.class'), classBytes); await writeJson(join(bundleRoot, 'host-binding/binding.json'), bindingManifest);
  const binding = await verifyJsHostBinding(join(bundleRoot, 'host-binding'));
  const pinRows = [['scripts/container/js-source-probe.mjs', Buffer.from('owned JS probe')], ['scripts/compat/js-fixture-host/tvbox/runtime/HostServices.java', bindingSource]];
  for (const [path, bytes] of pinRows) { await mkdir(join(bundleRoot, path, '..'), { recursive: true }); await writeFile(join(bundleRoot, path), bytes); }
  const launches = [];
  for (const name of ['production', 'frozen']) {
    const actualPlan = structuredClone(plan); if (name === 'production') actualPlan.http = { mode: 'live', fixtures: [] };
    for (const path of [join(bundleRoot, name), join(nasRoot, name)]) await mkdir(path, { recursive: true });
    const planPath = join(bundleRoot, name, 'input-plan.json'); await writeJson(planPath, actualPlan);
    const planSha256 = sha(await readFile(planPath)), verifiedInputs = await verifyJsInputs(actualPlan, { inputRoot });
    const logs = name === 'frozen' ? [`JS_FIXTURE_HIT urlSha256=${sha('rule')} status=200 bytes=24`, `JS_LIVE_HTTP method=GET urlSha256=${sha('business')}`] : [];
    const result = await probeJsSource({ plan: actualPlan, source, sourceIndex: 0, manifestSha256: planSha256, verifiedInputs }, { setupRuntime: async () => {}, runtimeFactory: () => ({
      getState: async () => ({}), request: async request => request.operation === 'logs' ? logs : null,
      setModules: async () => {}, getCSP: async () => ({ ready: true, kind: 'js', token: 'owned', className: 'com.github.catvod.crawler.js.JsSpider' }),
      call: async (_token, method) => JSON.stringify(method === 'homeContent' ? { class: [{ type_id: 'owned-cat' }], filters: { 'owned-cat': [{ key: 'area', value: [{ v: 'cn' }] }] } }
        : method === 'detailContent' ? { list: [{ vod_id: 'owned-id', vod_play_from: 'owned-flag', vod_play_url: 'episode$owned-id' }] }
          : method === 'playerContent' ? { url: `https://${PRIVATE}.invalid/media` } : { list: [{ vod_id: 'owned-id', vod_name: 'Owned title' }] }), close: async () => {},
    }) });
    // Owned synthetic evidence: model an observed exited PID for strict reporter tests.
    for (const runtime of result.report.runtimes) runtime.cleanup.workerExited = true;
    result.report.cleanup.workerExited = true; result.report.cleanup.workerExitEvidence = 'pid-observed';
    if (name === 'frozen') result.report.hostBinding = { ...binding, directory: undefined };
    const value = { schemaVersion: 1, manifestSha256: planSha256, runnerSha256: RUNNER, cases: [result] };
    await writeJson(join(nasRoot, name, 'case-000-private.json'), value); await writeJson(join(nasRoot, name, 'case-000-metadata.json'), { ...value, cases: [result.report] });
    const args = ['scripts/container/js-source-probe.mjs', '--plan', `/run/${name}/input-plan.json`, '--input-root', '/input', '--case-index', '0', '--mode', 'discover',
      ...(name === 'frozen' ? ['--host-binding', '/run/host-binding'] : []), '--output', `/output/${name}/case-000-private.json`, '--metadata', `/output/${name}/case-000-metadata.json`];
    await writeJson(join(nasRoot, name, 'case-000.inspect.json'), [{ Id: sha('owned container ' + name), Image: IMAGE, Path: 'node', Args: args, Config: { User: '10001:10001' },
      State: { Status: 'exited', Running: false, ExitCode: 0, OOMKilled: false, Error: '' },
      Mounts: [{ Destination: '/input', RW: false }, { Destination: '/run', RW: false }, { Destination: '/opt/tvbox/scripts', RW: false }, { Destination: '/output', RW: true }] }]);
    await writeFile(join(nasRoot, name, 'case-000.exit.txt'), '0\n');
    launches.push({ name, manifestSha256: planSha256, sourceCount: 1 });
  }
  const run = { schemaVersion: 1, image: IMAGE, inputFreezeSha256: sha(await readFile(join(inputRoot, 'freeze.json'))), sourcePins: pinRows.map(([file, bytes]) => ({ file, sha256: sha(bytes) })), plans: launches, hostBinding: bindingManifest };
  await writeJson(join(nasRoot, 'run-plan.json'), run); await writeJson(join(bundleRoot, 'run-plan.json'), run);
  return { directory, inputRoot, bundleRoot, nasRoot, imageId: IMAGE, verifyFreeze: false };
}

test('strict report retains both tracks/ten steps, safe source names and research-binding scope', async t => {
  const options = await fixture(t), report = await buildJsSourceReport(options);
  assert.equal(report.tracks.length, 2);
  for (const track of report.tracks) {
    assert.equal(track.sources[0].name, '自有测试源');
    assert.equal(track.summary.expectedMethodSlots, 10); assert.equal(track.summary.recordedCalls, 10);
    assert.equal(track.summary.methodStatuses.nonempty, 10); assert.equal(track.summary.cleanupPassed, 1);
    assert.equal(track.summary.allTenNonemptySingleRuntime, 1);
  }
  assert.equal(report.tracks[0].usesResearchHostBinding, false); assert.equal(report.tracks[1].usesResearchHostBinding, true);
  assert.equal(report.tracks[0].summary.fixtureHitMarkers, 0); assert.ok(report.tracks[1].summary.fixtureHitMarkers > 0);
  assert.equal(report.comparisonSummary.sameParamsSameJson, 10);
  const publicText = JSON.stringify(report) + jsSourceReportMarkdown(report);
  for (const secret of [PRIVATE, sourceUrl(options), 'https://', options.directory, 'owned-flag', 'owned-id', 'Owned title']) assert.equal(publicText.includes(secret), false, secret);
});
function sourceUrl() { return `https://${PRIVATE}.invalid/root.js`; }

test('mutated source key, response metadata and separate public metadata fail strict validation', async t => {
  const options = await fixture(t), path = join(options.nasRoot, 'production/case-000-private.json'), original = await getJson(path);
  const changedKey = structuredClone(original); changedKey.cases[0].input.source.key = 'other source'; await writeJson(path, changedKey);
  await assert.rejects(() => buildJsSourceReport(options), /METADATA_FILE|SOURCE_IDENTITY/);
  const changedResponse = structuredClone(original); changedResponse.cases[0].privateCalls[0].value = '{"class":[{"type_id":"other"}]}'; await writeJson(path, changedResponse);
  await assert.rejects(() => buildJsSourceReport(options), /CALL_RESPONSE_METADATA/);
  await writeJson(path, original);
  const metadataPath = join(options.nasRoot, 'production/case-000-metadata.json'), changedMeta = await getJson(metadataPath); changedMeta.cases[0].observations.nonempty = 9; await writeJson(metadataPath, changedMeta);
  await assert.rejects(() => buildJsSourceReport(options), /METADATA_FILE/);
});

test('missing results are not fabricated as initialized sources and preserve the denominator in preview', async t => {
  const options = await fixture(t); await rm(join(options.nasRoot, 'frozen/case-000-private.json'));
  await assert.rejects(() => buildJsSourceReport(options), /ENOENT/);
  const report = await buildJsSourceReport({ ...options, preview: true });
  assert.equal(report.tracks[1].summary.present, 0); assert.equal(report.tracks[1].summary.initializedSources, 0);
  assert.equal(report.tracks[1].summary.methodStatuses['not-tested'], 10);
  assert.equal(report.tracks[1].summary.cleanupPassed, 0);
});

test('all runtime PID cleanup, Docker image/user/command and source snapshot pins are checked', async t => {
  const options = await fixture(t), inspectPath = join(options.nasRoot, 'production/case-000.inspect.json'), original = await getJson(inspectPath);
  for (const mutation of [v => { v[0].Config.User = '0'; }, v => { v[0].Image = 'sha256:' + sha('other'); }, v => { v[0].Args[6] = '1'; }, v => { v[0].State.Running = true; }]) {
    const value = structuredClone(original); mutation(value); await writeJson(inspectPath, value); await assert.rejects(() => buildJsSourceReport(options), /CONTAINER_/);
  }
  await writeJson(inspectPath, original);
  await writeFile(join(options.bundleRoot, 'scripts/container/js-source-probe.mjs'), 'changed source snapshot');
  await assert.rejects(() => buildJsSourceReport(options), /SOURCE_PIN_BYTES/);
});

test('unobserved runtime PID exit and altered log snapshots cannot pass as clean verified evidence', async t => {
  const options = await fixture(t), path = join(options.nasRoot, 'production/case-000-private.json'), metadataPath = join(options.nasRoot, 'production/case-000-metadata.json'), original = await getJson(path);
  const unobserved = structuredClone(original); unobserved.cases[0].report.runtimes[0].cleanup.workerExited = null;
  await writeJson(path, unobserved); await writeJson(metadataPath, { ...unobserved, cases: unobserved.cases.map(row => row.report) });
  await assert.rejects(() => buildJsSourceReport(options), /RUNTIME_CLEANUP_EVIDENCE/);
  const changedLogs = structuredClone(original); changedLogs.cases[0].privateCalls[0].logs.push('secret injected log');
  await writeJson(path, changedLogs); await writeJson(metadataPath, { ...changedLogs, cases: changedLogs.cases.map(row => row.report) });
  await assert.rejects(() => buildJsSourceReport(options), /LOG_HASH/);
});

test('JS null, default-shaped empty and diagnostics are reported without leaking raw logs', () => {
  const nullResponse = { valueType: 'null' };
  const call = summarizeJsCall({ method: 'homeContent', params: [true], value: null,
    metadata: { discoveryStep: 'home', status: 'invalid-json', paramsSha256: sha('[true]'), response: nullResponse, error: { category: 'invalid-result', type: 'JsNullOrMissingResult' } } });
  assert.equal(call.status, 'invalid-json'); assert.equal(call.returnedNull, true);
  const logs = [`JS_FIXTURE_HIT urlSha256=${sha('private url')} status=200 bytes=9`, `JS_LIVE_HTTP method=GET urlSha256=${sha('private url')}`, `untrusted prefix JS_LIVE_HTTP method=GET urlSha256=${sha('private url')}`];
  assert.deepEqual(jsLogMarkers(logs), { fixtureHits: 1, liveHttp: 1 });
});

test('player pass-through and parse flags are explicit without publishing page/media identifiers', () => {
  const params = ['flag', 'https://private.invalid/live-page', []], value = JSON.stringify({ parse: 1, url: params[1] });
  const row = summarizeJsCall({ method: 'playerContent', params, value, metadata: { discoveryStep: 'player', status: 'nonempty', paramsSha256: sha(JSON.stringify(params)),
    response: classifyJsResponse('playerContent', value).response } });
  assert.equal(row.parse, 1); assert.equal(row.returnedInputIdSame, true); assert.equal(row.playbackUrlPresent, true);
  assert.equal(JSON.stringify(row).includes('private.invalid'), false);
});

test('independently derived arguments must match before live JSON differences are compared', () => {
  const calls = [['home', 'homeContent'], ['home-video', 'homeVideoContent'], ['category-page1', 'categoryContent'], ['category-page2', 'categoryContent'], ['category-filter', 'categoryContent'], ['detail', 'detailContent'], ['search', 'searchContent'], ['search-page1', 'searchContent'], ['search-detail', 'detailContent'], ['player', 'playerContent']]
    .map(([discoveryStep, method]) => ({ discoveryStep, method, status: 'nonempty', paramsSha256: sha('same'), response: { sha256: sha('rawA'), semanticSha256: sha('sameJSON') } }));
  const production = { sourceIndex: 0, sourceIdentitySha256: sha('source'), name: '自有', calls }, frozen = structuredClone(production);
  frozen.calls[0].response = { sha256: sha('different raw'), semanticSha256: sha('sameJSON') };
  frozen.calls[1].response.semanticSha256 = sha('differentJSON');
  frozen.calls[2].paramsSha256 = sha('independently different params');
  const compared = compareJsTrackSources(production, frozen);
  assert.equal(compared.calls[0].observation, 'same-params-same-json'); assert.equal(compared.calls[0].rawEqual, false);
  assert.equal(compared.calls[1].observation, 'same-params-live-response-difference');
  assert.equal(compared.calls[2].observation, 'different-derived-params-not-comparable');
  assert.equal(compared.calls[2].semanticEqual, undefined);
});
