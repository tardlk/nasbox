// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonical } from '../scripts/container/jar-matrix-probe.mjs';
import { loaderContextOf, officialOracleApkSha256 } from '../scripts/android/loader-context.mjs';
import { workingSourceScenarioIdentity } from '../scripts/compat/prepare-working-source-plan.mjs';
import { chooseCategory, chooseFilter, chooseKeyword, choosePlayer, classifyBusinessResponse, prepareWorkingSourceCases,
  probeWorkingSource, runWorkingSourcePlan, validateWorkingCalls, workingSourceBudgets } from '../scripts/container/working-source-probe.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const identity = value => sha(JSON.stringify(canonical(value)));
const budgets = { caseMs: 1200, loadMs: 200, initMs: 100, callMs: 50, closeMs: 50 };

async function fixture(t, { role = 'main', withMain = false, calls } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'tvbox-working-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bytes = Buffer.from('owned JAR fixture bytes'), hash = sha(bytes);
  await writeFile(join(directory, 'fixture.jar'), bytes);
  const artifact = { id: 'private-provider-label', sha256: hash, jarPath: 'fixture.jar', sites: [] };
  const signature = 'https://private.invalid/plugin.jar;md5;987654321';
  const loaderContext = { role, signature };
  if (withMain) {
    const main = Buffer.from('owned main JAR bytes');
    await writeFile(join(directory, 'main.jar'), main);
    loaderContext.main = { sha256: sha(main), jarPath: 'main.jar', jarUrl: 'http://private.invalid/main.jar', signature: 'https://private.invalid/main.jar;md5;123' };
  }
  const site = { key: 'private-site-key', type: 3, api: 'csp_Owned', ext: 'secret-ext-token', jar: role === 'site' ? signature : '', loaderContext, ...(calls ? { calls } : {}) };
  site.expectedLoaderIdentity = loaderContextOf(artifact, site).identity;
  site.extSha256 = sha(site.ext);
  site.caseIdentitySha256 = identity([hash, site.expectedLoaderIdentity, site.api, site.extSha256]);
  artifact.sites.push(site);
  return { directory, artifact, site, caseId: '0-0', artifactIndex: 0, siteIndex: 0, manifestSha256: sha('saved plan') };
}

function mockedRuntime({ call, init, close, stateCount = 1, loaded = true } = {}) {
  const events = [];
  const runtimeFactory = options => {
    events.push(['create', options]);
    return {
      request: async request => { events.push(['request', request]); return {}; },
      loadMain: async path => { events.push(['loadMain', path]); return { loaded }; },
      registerJar: async (signature, path) => { events.push(['registerJar', signature, path]); },
      setModules: async value => { events.push(['modules', value]); },
      getState: async () => ({ jar: { loaderCount: stateCount } }),
      getCSP: async source => { events.push(['getCSP', source]); return init ? init(source, options) : { ready: true, token: 'owned-token', className: 'com.github.catvod.spider.Owned' }; },
      call: async (token, method, args) => { events.push(['call', token, method, args]); return call ? call(method, args, options) : ''; },
      close: async () => { events.push(['close']); if (close) return close(); },
    };
  };
  return { runtimeFactory, events };
}

test('actual category/filter/episode selection keeps opaque identifiers and aligned play groups', () => {
  const home = { class: [{ type_id: '' }, { type_id: 0 }], filters: { 0: [{ key: 'area', value: [{ v: '' }, { v: 'cn' }] }] } };
  assert.equal(chooseCategory(home), '0');
  assert.deepEqual(chooseFilter(home, '0'), { area: 'cn' });
  assert.equal(chooseFilter({}, '0'), undefined);
  assert.deepEqual(chooseKeyword({ list: [{ vod_name: '电影测试剧集' }] }), { keyword: '电影测试', originIndex: 0, fallback: false });
  assert.deepEqual(chooseKeyword({ list: [] }), { keyword: '测试', fallback: true });
  assert.deepEqual(choosePlayer({ list: [{ vod_play_from: '$$$real-flag', vod_play_url: 'ignored$$$first$opaque$id#next$other' }] }), { flag: 'real-flag', id: 'opaque$id', vipFlags: [] });
  assert.equal(choosePlayer({ list: [{ vod_play_from: 'f', vod_play_url: 'missing-separator' }] }), undefined);
});

test('empty defaults, empty valid objects and invalid JSON remain separate from nonempty business responses', () => {
  assert.equal(classifyBusinessResponse('homeContent', '').status, 'empty');
  assert.equal(classifyBusinessResponse('homeContent', '').implementation, 'unknown-default-compatible');
  assert.equal(classifyBusinessResponse('homeVideoContent', '{"list":[]}').status, 'empty');
  assert.equal(classifyBusinessResponse('homeContent', '{"class":[{"type_id":"1"}]}').status, 'nonempty');
  assert.equal(classifyBusinessResponse('playerContent', '{"parse":1,"url":"opaque"}').status, 'nonempty');
  for (const value of ['<html>private</html>', 'null', '[]', 7]) assert.equal(classifyBusinessResponse('detailContent', value).status, 'invalid-json');
});

test('NAS discovery follows real data through page/filter/search/detail/player and redacts public output', async t => {
  const entry = await fixture(t);
  const home = { class: [{ type_id: 'private-cat' }], filters: { 'private-cat': [{ key: 'private-filter', value: [{ v: '' }, { v: 'private-option' }] }] } };
  const responses = {
    homeContent: home, homeVideoContent: { list: [] },
    categoryContent: { list: [{ vod_id: 'private-video', vod_name: '电影实际名称' }] },
    searchContent: { list: [{ vod_id: 'private-search-video' }] },
    detailContent: { list: [{ vod_id: 'private-video', vod_play_from: 'private-flag', vod_play_url: 'episode$private-play-id' }] },
    playerContent: { parse: 1, url: 'https://private.invalid/media?token=secret' },
  };
  const mock = mockedRuntime({ call: method => JSON.stringify(responses[method]) });
  const result = await probeWorkingSource(entry, { inputRoot: entry.directory, budgets, runtimeFactory: mock.runtimeFactory });
  assert.equal(result.report.calls.length, 9);
  assert.equal(result.report.observations.nonempty, 8);
  assert.equal(result.report.observations.empty, 1);
  assert.equal(result.report.loadSuccess, true);
  assert.equal(result.report.initSuccess, true);
  assert.equal(result.report.cleanup.closed, true);
  assert.equal(result.report.cleanup.temporaryDataRemoved, true);
  assert.deepEqual(result.privateCalls.find(row => row.slot === 'categoryPage2').params, ['private-cat', '2', true, {}]);
  assert.deepEqual(result.privateCalls.find(row => row.slot === 'categoryFilter').params, ['private-cat', '1', true, { 'private-filter': 'private-option' }]);
  assert.deepEqual(result.privateCalls.find(row => row.slot === 'searchThreeArgs').params, ['电影实际', false, '1']);
  assert.deepEqual(result.privateCalls.find(row => row.slot === 'player').params, ['private-flag', 'private-play-id', []]);
  assert.equal(mock.events.filter(row => row[0] === 'create').length, 1);
  const publicText = JSON.stringify(result.report);
  for (const secret of ['private-cat', 'private-video', 'private-filter', 'private-option', 'private-flag', 'private-play-id', 'secret-ext-token', 'private.invalid', 'private-site-key', 'private-provider-label', '电影实际']) assert.equal(publicText.includes(secret), false, secret);
  assert.equal(JSON.stringify(result.privateCalls).includes('private-play-id'), true);
});

test('exact main + site coexistence retains signature/ext and requires both actual loaders', async t => {
  const entry = await fixture(t, { role: 'site', withMain: true, calls: [{ method: 'homeContent', params: [true] }] });
  const mock = mockedRuntime({ stateCount: 2 });
  const result = await probeWorkingSource(entry, { inputRoot: entry.directory, budgets, runtimeFactory: mock.runtimeFactory });
  assert.equal(result.report.parameterSource, 'explicit-plan');
  assert.equal(result.report.mainLoad.loaded, true);
  assert.equal(result.report.selectedLoad.loaderCount, 2);
  assert.equal(result.report.selectedLoad.expectedLoaderCount, 2);
  assert.equal(mock.events.find(row => row[0] === 'registerJar')[1], entry.site.loaderContext.signature);
  const source = mock.events.find(row => row[0] === 'getCSP')[1];
  assert.equal(source.jar, entry.site.jar);
  assert.equal(source.ext, entry.site.ext);
  const single = mockedRuntime({ stateCount: 1 });
  const failed = await probeWorkingSource(entry, { inputRoot: entry.directory, budgets, runtimeFactory: single.runtimeFactory });
  assert.equal(failed.report.loadSuccess, false);
  assert.equal(failed.report.calls[0].status, 'not-tested');
  assert.equal(single.events.some(row => row[0] === 'call'), false);
});

test('nonfatal network, invalid JSON and unsupported method failures do not suppress subsequent methods', async t => {
  const calls = [
    { method: 'homeContent', params: [true] }, { method: 'homeVideoContent', params: [] },
    { method: 'searchContent', params: ['test', false] }, { method: 'searchContent', params: ['test', false, '1'] },
  ];
  const entry = await fixture(t, { calls });
  let index = 0;
  const mock = mockedRuntime({ call: () => {
    index++;
    if (index === 1) throw new Error('UnknownHostException: private.invalid');
    if (index === 2) return 'private-invalid-json';
    if (index === 3) throw Object.assign(new Error('method not supported'), { errorType: 'java.lang.UnsupportedOperationException' });
    return '{"list":[{"vod_id":"x"}]}';
  } });
  const result = await probeWorkingSource(entry, { inputRoot: entry.directory, budgets, runtimeFactory: mock.runtimeFactory });
  assert.deepEqual(result.report.calls.map(row => row.status), ['network', 'invalid-json', 'not-implemented', 'nonempty']);
  assert.equal(result.report.completed, true);
  assert.equal(result.report.calls[3].signatureImplementation, 'unknown-inherited-delegation-possible');
  assert.equal(JSON.stringify(result.report).includes('private.invalid'), false);
});

test('method deadline ends only its own runtime and records all remaining methods as not tested', async t => {
  const entry = await fixture(t);
  const mock = mockedRuntime({ call: () => new Promise(() => {}) });
  const result = await probeWorkingSource(entry, { inputRoot: entry.directory, budgets: { ...budgets, callMs: 8 }, runtimeFactory: mock.runtimeFactory });
  assert.equal(result.report.calls[0].status, 'timeout');
  assert.equal(result.report.calls.length, 9);
  assert.equal(result.report.calls.slice(1).every(row => row.status === 'not-tested'), true);
  assert.equal(mock.events.filter(row => row[0] === 'call').length, 1);
  assert.equal(result.report.completed, false);
  assert.equal(result.report.cleanup.closed, true);
  const second = mockedRuntime();
  const next = await probeWorkingSource(entry, { inputRoot: entry.directory, budgets, runtimeFactory: second.runtimeFactory });
  assert.equal(next.report.calls[0].status, 'empty');
  assert.equal(next.report.completed, true);
});

test('input byte/context/ext verification precedes runtime creation and preserves privacy', async t => {
  const entry = await fixture(t);
  const mock = mockedRuntime();
  entry.site.ext += 'mutated';
  const changed = await probeWorkingSource(entry, { inputRoot: entry.directory, budgets, runtimeFactory: mock.runtimeFactory });
  assert.equal(changed.report.error.category, 'input');
  assert.equal(mock.events.length, 0);
  entry.site.ext = 'secret-ext-token';
  await writeFile(join(entry.directory, 'fixture.jar'), 'mutated JAR');
  const bytes = await probeWorkingSource(entry, { inputRoot: entry.directory, budgets, runtimeFactory: mock.runtimeFactory });
  assert.equal(bytes.report.error.category, 'input');
  assert.equal(mock.events.length, 0);
  assert.equal(JSON.stringify(bytes.report).includes('mutated JAR'), false);
});

test('working-source scenario identity includes the original source key and accepts the generated object contract', async t => {
  const entry = await fixture(t);
  entry.site.executionExtSha256 = entry.site.extSha256;
  const expected = identity({ sha256: entry.artifact.sha256, loaderContext: entry.site.expectedLoaderIdentity,
    api: entry.site.api, executionExtSha256: entry.site.executionExtSha256, sourceKey: entry.site.key });
  assert.equal(workingSourceScenarioIdentity(entry.artifact, entry.site), expected);
  entry.site.sourceScenarioSha256 = expected;
  entry.site.caseIdentitySha256 = expected;
  const mock = mockedRuntime();
  const result = await probeWorkingSource(entry, { inputRoot: entry.directory, budgets, runtimeFactory: mock.runtimeFactory });
  assert.equal(result.report.error, undefined);
  assert.equal(result.report.sourceScenarioSha256, expected);
  assert.equal(mock.events.some(row => row[0] === 'loadMain'), true);
  entry.site.key += '-changed';
  const changed = mockedRuntime();
  const rejected = await probeWorkingSource(entry, { inputRoot: entry.directory, budgets, runtimeFactory: changed.runtimeFactory });
  assert.equal(rejected.report.error.category, 'input');
  assert.equal(changed.events.length, 0);
});

test('realpath containment rejects a symlink escaping the frozen input root', async t => {
  const entry = await fixture(t);
  const outside = await mkdtemp(join(tmpdir(), 'tvbox-working-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, 'outside.jar'), await readFile(join(entry.directory, 'fixture.jar')));
  await symlink(join(outside, 'outside.jar'), join(entry.directory, 'escape.jar'));
  entry.artifact.jarPath = 'escape.jar';
  const mock = mockedRuntime();
  const result = await probeWorkingSource(entry, { inputRoot: entry.directory, budgets, runtimeFactory: mock.runtimeFactory });
  assert.equal(result.report.error.category, 'input');
  assert.equal(mock.events.length, 0);
});

test('ART replay binds the original APK/map/plan/loader identity and skips un-derived parameters', async t => {
  const entry = await fixture(t);
  const metadata = { status: 'not-implemented', discoveryStep: 'home-video', methodProvenance: { declaringClass: 'com.github.catvod.crawler.Spider', baseSpiderClass: 'com.github.catvod.crawler.Spider', inheritedBaseDefault: true } };
  entry.android = {
    report: { ...entry.site.expectedLoaderIdentity, artifactIndex: 0, siteIndex: 0, jarSha256: entry.artifact.sha256, extSha256: entry.site.extSha256, manifestSha256: entry.manifestSha256,
      targetApkSha256: officialOracleApkSha256, symbolMapSha256: sha('owned map'), api: entry.site.api, siteKey: entry.site.key, id: entry.artifact.id },
    privateCalls: [{ method: 'homeVideoContent', params: [], value: '', metadata },
      { method: 'playerContent', params: [], metadata: { status: 'not-tested', discoveryStep: 'player', reason: 'provider text is not public' } }],
  };
  const mock = mockedRuntime();
  const result = await probeWorkingSource(entry, { inputRoot: entry.directory, budgets, runtimeFactory: mock.runtimeFactory, mode: 'replay' });
  assert.equal(result.report.parameterSource, 'exact-art-replay');
  assert.deepEqual(result.report.calls.map(row => row.status), ['empty', 'not-tested']);
  assert.equal(result.report.calls[0].androidMethodProvenance.inheritedBaseDefault, true);
  assert.equal(result.report.calls[0].implementation, 'unknown-default-compatible');
  assert.equal(result.report.calls[0].discoveryStep, 'home-video');
  assert.equal(mock.events.filter(row => row[0] === 'call').length, 1);
  assert.equal(JSON.stringify(result.report).includes('provider text'), false);
  entry.android.report.manifestSha256 = sha('other plan');
  const bad = mockedRuntime();
  const rejected = await probeWorkingSource(entry, { inputRoot: entry.directory, budgets, runtimeFactory: bad.runtimeFactory, mode: 'replay' });
  assert.equal(rejected.report.error.category, 'input');
  assert.equal(bad.events.length, 0);
});

test('saved plan flat indexes include every exact source and keep runtimes independent', async t => {
  const entry = await fixture(t);
  entry.artifact.sites.push({ ...entry.site, calls: [{ method: 'homeContent', params: [false] }] });
  const planPath = join(entry.directory, 'plan.json');
  await writeFile(planPath, JSON.stringify({ schemaVersion: 1, nasBudgets: budgets, artifacts: [entry.artifact] }));
  const prepared = await prepareWorkingSourceCases(planPath);
  assert.deepEqual(prepared.cases.map(row => row.caseId), ['0-0', '0-1']);
  assert.equal(prepared.manifestSha256, sha(await readFile(planPath)));
  const mock = mockedRuntime();
  const result = await runWorkingSourcePlan(planPath, { runtimeFactory: mock.runtimeFactory });
  assert.equal(result.cases.length, 2);
  assert.equal(mock.events.filter(row => row[0] === 'create').length, 2);
  assert.equal(mock.events.filter(row => row[0] === 'close').length, 2);
  assert.deepEqual(result.cases[1].privateCalls[0].params, [false]);
  await assert.rejects(() => runWorkingSourcePlan(planPath, { caseIndex: 5 }), /INPUT_SCHEMA/);
});

test('call schema rejects invented parameters/operations and budget schema rejects unknown values', () => {
  for (const calls of [[{ method: 'exec', params: [] }], [{ method: 'categoryContent', params: ['x', 1, true, {}] }], [{ method: 'playerContent', params: ['f', 'x', 'not-a-list'] }]]) assert.throws(() => validateWorkingCalls(calls), /INPUT_SCHEMA/);
  assert.throws(() => workingSourceBudgets({ nasBudgets: { callMs: 0 } }), /INPUT_SCHEMA/);
  assert.throws(() => workingSourceBudgets({ nasBudgets: { arbitrary: 9 } }), /INPUT_SCHEMA/);
});
