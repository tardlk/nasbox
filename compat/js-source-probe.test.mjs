// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyJsResponse, jsProbeBudgets, jsSourceIdentity, probeJsSource, runJsSourcePlan, verifyJsHostBinding, verifyJsInputs } from '../scripts/container/js-source-probe.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const budgets = { caseMs: 1500, initMs: 150, callMs: 40, closeMs: 40 };
async function fixture(t, { mode = 'live' } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'tvbox-js-probe-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const module = Buffer.from('export default {home(){return "owned"}}'), rule = Buffer.from('var rule={title:"owned"};');
  await writeFile(join(directory, 'root.js'), module); await writeFile(join(directory, 'rule.js'), rule);
  const source = { key: 'sensitive-source-key', type: 3, api: 'https://private.invalid/root.js?token=secret', ext: 'https://private.invalid/rule.js?token=secret', jar: '' };
  const plan = { schemaVersion: 1, budgets, sources: [source], modules: [{ url: source.api, path: 'root.js', sha256: sha(module), bytes: module.length }],
    http: { mode, fixtures: [{ url: source.ext, method: 'GET', status: 200, headers: { 'Content-Type': 'application/javascript' }, path: 'rule.js', sha256: sha(rule), bytes: rule.length }] } };
  const verifiedInputs = await verifyJsInputs(plan, { inputRoot: directory });
  return { directory, plan, source, verifiedInputs, manifestSha256: sha(JSON.stringify(plan)), sourceIndex: 0 };
}
function mockRuntime({ call, init, logs = () => [], factoryError } = {}) {
  const events = []; let generation = 0;
  const runtimeFactory = options => {
    generation++; events.push(['create', generation, options]); if (factoryError) throw factoryError;
    return { getState: async () => ({}), request: async request => { events.push(['request', generation, request]); return request.operation === 'logs' ? logs() : null; },
      setModules: async modules => { events.push(['modules', generation, modules]); },
      getCSP: async source => { events.push(['getCSP', generation, source]); return init ? init(source) : { ready: true, kind: 'js', token: 'owned-' + generation, className: 'com.github.catvod.crawler.js.JsSpider' }; },
      call: async (_token, method, args) => { events.push(['call', generation, method, args]); return call ? call(method, args, generation) : ''; },
      close: async () => { events.push(['close', generation]); },
      loadMain: () => { throw new Error('JAR load must never happen'); }, registerJar: () => { throw new Error('JAR registration must never happen'); },
    };
  };
  return { runtimeFactory, events };
}

test('pure JS discovery uses real arguments, both search signatures and first opaque episode ID', async t => {
  const entry = await fixture(t), mock = mockRuntime({ call: method => JSON.stringify(method === 'homeContent' ? { class: [{ type_id: 'private-cat' }], filters: { 'private-cat': [{ key: 'area', value: [{ v: '' }, { v: 'cn' }] }] } }
    : method === 'homeVideoContent' ? { list: [] } : method === 'detailContent' ? { list: [{ vod_id: 'private-id', vod_play_from: 'private-flag', vod_play_url: 'name$private$episode' }] }
      : method === 'playerContent' ? { url: 'https://private.invalid/media?secret=token' } : { list: [{ vod_id: 'private-id', vod_name: '电影真实名称' }] }) });
  const result = await probeJsSource(entry, { runtimeFactory: mock.runtimeFactory });
  assert.equal(result.report.calls.length, 10);
  assert.equal(result.report.observations.nonempty, 9);
  assert.deepEqual(result.privateCalls.find(row => row.metadata.discoveryStep === 'category-page2').params, ['private-cat', '2', true, {}]);
  assert.deepEqual(result.privateCalls.find(row => row.metadata.discoveryStep === 'search-page1').params, ['电影真实', false, '1']);
  assert.deepEqual(result.privateCalls.find(row => row.metadata.discoveryStep === 'player').params, ['private-flag', 'private$episode', []]);
  assert.equal(mock.events[0][2].nativeBridge, false);
  assert.deepEqual(mock.events.find(row => row[0] === 'getCSP')[2], entry.source);
  assert.equal(result.report.calls.find(row => row.discoveryStep === 'category-page1').argumentProvenance.derivedResponseSha256, result.report.calls[0].response.sha256);
  const metadata = JSON.stringify(result.report);
  for (const secret of ['private.invalid', 'sensitive-source-key', 'private-cat', 'private-id', 'private-flag', 'private$episode', '电影真实', 'token=secret']) assert.equal(metadata.includes(secret), false, secret);
  assert.equal(result.report.cleanup.closed, true); assert.equal(result.report.cleanup.temporaryDataRemoved, true);
  assert.equal(result.report.cleanup.workerExited, null);
});

test('null caught JS values, empty strings, invalid JSON and log fingerprints never count as business success', async t => {
  const entry = await fixture(t), mock = mockRuntime({ call: method => method === 'homeContent' ? null : '<html>private-body</html>', logs: () => ['echo-error https://private.invalid/?secret=token'] });
  const result = await probeJsSource(entry, { runtimeFactory: mock.runtimeFactory });
  assert.equal(result.report.calls[0].status, 'invalid-json'); assert.equal(result.report.calls[0].returnedNull, true);
  assert.equal(result.report.calls[0].logs.count, 1); assert.match(result.report.calls[0].logs.sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.report.calls[1].status, 'invalid-json');
  assert.equal(result.report.observations.nonempty, 0); assert.equal(JSON.stringify(result.report).includes('private.invalid'), false);
  assert.equal(result.privateCalls[0].logs[0].includes('private.invalid'), true);
  assert.equal(classifyJsResponse('homeContent', '').status, 'empty');
  assert.equal(classifyJsResponse('homeContent', undefined).status, 'invalid-json');
});

test('a timed-out method is not retried and later derivable methods use a fresh JVM', async t => {
  const entry = await fixture(t); let first = true;
  const mock = mockRuntime({ call: (method, _args, generation) => {
    if (method === 'homeContent' && first) { first = false; return new Promise(() => {}); }
    if (method === 'homeVideoContent') return '{"list":[{"vod_id":"actual-id","vod_name":"实际电影"}]}';
    if (method === 'detailContent') return '{"list":[{"vod_id":"actual-id","vod_play_from":"f","vod_play_url":"first$opaque-id"}]}';
    if (method === 'playerContent') return '{"url":"opaque-url"}';
    return '{"list":[]}';
  } });
  const result = await probeJsSource(entry, { runtimeFactory: mock.runtimeFactory, budgets: { callMs: 8 } });
  assert.equal(result.report.calls[0].status, 'timeout');
  assert.equal(result.report.runtimes.length, 2);
  assert.equal(result.report.calls[1].runtimeGeneration, 2);
  assert.equal(mock.events.filter(row => row[0] === 'call' && row[2] === 'homeContent').length, 1);
  assert.equal(result.report.calls.find(row => row.discoveryStep === 'detail').status, 'nonempty');
  assert.equal(result.report.calls.find(row => row.discoveryStep === 'player').status, 'nonempty');
  assert.equal(mock.events.filter(row => row[0] === 'close').length, 2);
  assert.equal(result.report.calls.filter(row => row.method === 'categoryContent').every(row => row.status === 'not-tested'), true);
});

test('invalid initialization blocks source calls without repeating the broken initialization', async t => {
  const entry = await fixture(t), mock = mockRuntime({ init: () => ({ ready: false, kind: 'js' }) });
  const result = await probeJsSource(entry, { runtimeFactory: mock.runtimeFactory });
  assert.equal(mock.events.filter(row => row[0] === 'create').length, 1);
  assert.equal(mock.events.filter(row => row[0] === 'call').length, 0);
  assert.equal(result.report.runtimes[0].init.ready, false);
  assert.equal(result.report.cleanup.temporaryDataRemoved, true);
});

test('frozen artifact mode requires explicit binding or injected adapter and keeps original source ext', async t => {
  const entry = await fixture(t, { mode: 'frozen' }), mock = mockRuntime();
  const rejected = await probeJsSource(entry, { runtimeFactory: mock.runtimeFactory });
  assert.equal(rejected.report.error.category, 'input'); assert.equal(mock.events.length, 0);
  let setup;
  const result = await probeJsSource(entry, { runtimeFactory: mock.runtimeFactory, setupRuntime: async (_runtime, options) => { setup = options; } });
  assert.equal(result.report.error, undefined); assert.equal(setup.verifiedInputs.httpFixtures[0].bodyBase64, Buffer.from('var rule={title:"owned"};').toString('base64'));
  assert.equal(mock.events.find(row => row[0] === 'getCSP')[2].ext, entry.source.ext);
  assert.equal(mock.events.find(row => row[0] === 'request' && row[2].operation === 'host')[2].networkDisabled, false);
});

test('frozen file/path/size/hash/module/source guards fail before runtime execution', async t => {
  const entry = await fixture(t);
  await writeFile(join(entry.directory, 'root.js'), 'changed');
  await assert.rejects(() => verifyJsInputs(entry.plan, { inputRoot: entry.directory }), /INPUT_CHECKSUM/);
  const duplicate = structuredClone(entry.plan); duplicate.modules.push(duplicate.modules[0]);
  await assert.rejects(() => verifyJsInputs(duplicate, { inputRoot: entry.directory }), /INPUT_CHECKSUM|INPUT_SCHEMA/);
  const outside = await mkdtemp(join(tmpdir(), 'tvbox-js-outside-')); t.after(() => rm(outside, { recursive: true, force: true }));
  const bytes = Buffer.from('owned'); await writeFile(join(outside, 'outside.js'), bytes); await symlink(join(outside, 'outside.js'), join(entry.directory, 'escape.js'));
  const escaping = structuredClone(entry.plan); escaping.modules[0] = { url: entry.source.api, path: 'escape.js', bytes: bytes.length, sha256: sha(bytes) };
  await assert.rejects(() => verifyJsInputs(escaping, { inputRoot: entry.directory }), /INPUT_PATH/);
  assert.throws(() => jsSourceIdentity({ ...entry.source, jar: 'some.jar' }), /pure JS/);
  assert.throws(() => jsProbeBudgets({ budgets: { arbitrary: 1 } }), /budget/);
});

test('HTTP fixture validation matches GET success host contract and rejects normalized collisions before init', async t => {
  const entry = await fixture(t, { mode: 'frozen' });
  for (const change of [{ method: 'POST' }, { status: 199 }, { status: 300 }, { status: 404 }, { headers: { 'Bad Header': 'value' } }, { headers: { Good: 'value\r\nInjected: secret' } }]) {
    const plan = structuredClone(entry.plan); Object.assign(plan.http.fixtures[0], change);
    await assert.rejects(() => verifyJsInputs(plan, { inputRoot: entry.directory }), /INPUT_SCHEMA/);
  }
  const aliases = structuredClone(entry.plan);
  aliases.http.fixtures[0].url = 'http://EXAMPLE.invalid:80/a/../rule.js';
  aliases.http.fixtures.push({ ...aliases.http.fixtures[0], url: 'http://example.invalid/rule.js' });
  await assert.rejects(() => verifyJsInputs(aliases, { inputRoot: entry.directory }), /duplicate HTTP fixture/);
  const valid = structuredClone(entry.plan); valid.http.fixtures[0].status = 204;
  assert.equal((await verifyJsInputs(valid, { inputRoot: entry.directory })).httpFixtures[0].status, 204);
});

test('all frozen paths are relative and symlink-free even when a symlink stays inside input root', async t => {
  const entry = await fixture(t);
  for (const path of [join(entry.directory, 'root.js'), '../root.js', 'child/../root.js']) {
    const plan = structuredClone(entry.plan); plan.modules[0].path = path;
    await assert.rejects(() => verifyJsInputs(plan, { inputRoot: entry.directory }), /INPUT_PATH/);
  }
  await symlink(join(entry.directory, 'root.js'), join(entry.directory, 'inside-alias.js'));
  const alias = structuredClone(entry.plan); alias.modules[0].path = 'inside-alias.js';
  await assert.rejects(() => verifyJsInputs(alias, { inputRoot: entry.directory }), /symlink refused/);
});

test('exact replay binds original source and frozen inputs, preserves params and skips un-derived slots', async t => {
  const entry = await fixture(t), replay = { input: { source: entry.source }, report: { sourceIdentitySha256: jsSourceIdentity(entry.source), inputSetSha256: entry.verifiedInputs.inputSetSha256 }, privateCalls: [
    { method: 'categoryContent', params: ['actual-cat', '2', true, { area: 'cn' }], metadata: { discoveryStep: 'category-page2' } },
    { method: 'detailContent', params: [], metadata: { discoveryStep: 'detail', status: 'not-tested' } },
  ] }, mock = mockRuntime();
  const result = await probeJsSource({ ...entry, replay, replayInputSha256: sha('private reference') }, { mode: 'replay', runtimeFactory: mock.runtimeFactory });
  assert.deepEqual(result.privateCalls[0].params, replay.privateCalls[0].params);
  assert.equal(result.report.calls[1].status, 'not-tested'); assert.equal(mock.events.filter(row => row[0] === 'call').length, 1);
  const changed = structuredClone(replay); changed.source = { ...entry.source, key: 'other-key' }; delete changed.input;
  const other = mockRuntime();
  const rejected = await probeJsSource({ ...entry, replay: changed }, { mode: 'replay', runtimeFactory: other.runtimeFactory });
  assert.equal(rejected.report.error.category, 'input'); assert.equal(other.events.length, 0);
});

test('saved JS plan selects original source index and records exact plan bytes', async t => {
  const entry = await fixture(t), planPath = join(entry.directory, 'plan.json'); await writeFile(planPath, JSON.stringify(entry.plan));
  const mock = mockRuntime(), result = await runJsSourcePlan(planPath, { inputRoot: entry.directory, caseIndex: 0, runtimeFactory: mock.runtimeFactory });
  assert.equal(result.cases.length, 1); assert.equal(result.manifestSha256, sha(await readFile(planPath)));
  assert.equal(result.cases[0].report.sourceIdentitySha256, jsSourceIdentity(entry.source));
  await assert.rejects(() => runJsSourcePlan(planPath, { inputRoot: entry.directory, caseIndex: 1 }), /invalid source index/);
});

test('research host-binding manifest verifies exact source and every class, refusing extra or escaped files', async t => {
  const entry = await fixture(t), directory = join(entry.directory, 'binding'); await mkdir(join(directory, 'tvbox/runtime'), { recursive: true });
  const source = await readFile(new URL('../scripts/compat/js-fixture-host/tvbox/runtime/HostServices.java', import.meta.url));
  const bytes = Buffer.from('owned class bytes'), path = 'tvbox/runtime/HostServices.class'; await writeFile(join(directory, path), bytes);
  await writeFile(join(directory, 'binding.json'), JSON.stringify({ schemaVersion: 1, sourceSha256: sha(source), files: [{ path, sha256: sha(bytes), bytes: bytes.length }] }));
  const binding = await verifyJsHostBinding(directory); assert.equal(binding.classes.length, 1); assert.equal(binding.sourceSha256, sha(source));
  await writeFile(join(directory, path), 'altered'); await assert.rejects(() => verifyJsHostBinding(directory), /class pins differ/);
});

test('owned real QuickJS executes the ten-step probe without JARs or network and its PID exits', async t => {
  const entry = await fixture(t), text = `export default {
    init(ext){this.ext=ext;},
    home(){return JSON.stringify({class:[{type_id:'owned-category'}],filters:{'owned-category':[{key:'area',value:[{v:'owned-option'}]}]}});},
    homeVod(){return JSON.stringify({list:[{vod_id:'owned-video',vod_name:'Owned title'}]});},
    category(tid,page,filter,extend){return JSON.stringify({list:[{vod_id:'owned-video',vod_name:'Owned title'}],page:page});},
    detail(id){return JSON.stringify({list:[{vod_id:id,vod_play_from:'owned-flag',vod_play_url:'episode$owned-id'}]});},
    search(keyword,quick){return JSON.stringify({list:[{vod_id:'owned-search',vod_name:'Owned title'}]});},
    play(flag,id,vip){return JSON.stringify({url:'owned://'+id});}
  };`;
  await writeFile(join(entry.directory, 'root.js'), text);
  entry.plan.modules[0].sha256 = sha(text); entry.plan.modules[0].bytes = Buffer.byteLength(text);
  entry.verifiedInputs = await verifyJsInputs(entry.plan, { inputRoot: entry.directory });
  const result = await probeJsSource(entry, { budgets: { caseMs: 10000, initMs: 3000, callMs: 2000, closeMs: 3000 } });
  assert.equal(result.report.error, undefined);
  assert.equal(result.report.calls.length, 10);
  assert.equal(result.report.observations.nonempty, 10);
  assert.equal(result.report.runtimes.length, 1);
  assert.equal(result.report.cleanup.closed, true);
  assert.equal(result.report.cleanup.workerExited, true);
  assert.equal(result.report.cleanup.temporaryDataRemoved, true);
});
