// SPDX-License-Identifier: GPL-3.0-only
// Captured JavaScript only. Every timeout retires its JVM before later methods.
import { createHash } from 'node:crypto';
import { readFile, readdir, realpath, lstat, stat, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { buildSpiderRuntime, createSpiderRuntime } from '../../backend/spider-runtime/index.mjs';
import { canonical, classifyFailure } from './jar-matrix-probe.mjs';
import { chooseCategory, chooseFilter, chooseKeyword, choosePlayer, classifyBusinessResponse, validateWorkingCalls } from './working-source-probe.mjs';

const SELF = fileURLToPath(import.meta.url);
const sha = value => createHash('sha256').update(value).digest('hex');
const semantic = value => sha(JSON.stringify(canonical(value)));
const hashPattern = /^[a-f0-9]{64}$/;
const contained = (root, path) => { const rel = relative(root, path); return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep); };
const safeClass = value => typeof value === 'string' && /^[\w.$]{1,240}$/.test(value) ? value : undefined;
const steps = [ ['home', 'homeContent'], ['home-video', 'homeVideoContent'], ['category-page1', 'categoryContent'],
  ['category-page2', 'categoryContent'], ['category-filter', 'categoryContent'], ['detail', 'detailContent'],
  ['search', 'searchContent'], ['search-page1', 'searchContent'], ['search-detail', 'detailContent'], ['player', 'playerContent'] ];
const firstVideo = json => Array.isArray(json?.list) ? json.list.find(row => row && ['string', 'number'].includes(typeof row.vod_id) && String(row.vod_id)) : undefined;
const check = (condition, reason) => { if (!condition) throw new Error('INPUT_SCHEMA: ' + reason); };

export function jsSourceIdentity(source) {
  check(source && source.type === 3 && typeof source.key === 'string' && typeof source.api === 'string' && typeof source.ext === 'string'
    && (source.api.endsWith('.js') || source.api.includes('.js?')) && (source.jar === undefined || source.jar === ''), 'pure JS source required');
  return semantic({ type: source.type, key: source.key, api: source.api, ext: source.ext, jar: source.jar ?? '' });
}

export function jsProbeBudgets(plan = {}) {
  const budgets = { caseMs: 240000, initMs: 30000, callMs: 12000, closeMs: 5000, ...plan.budgets };
  for (const [key, value] of Object.entries(budgets)) check(['caseMs', 'initMs', 'callMs', 'closeMs'].includes(key) && Number.isSafeInteger(value) && value > 0 && value <= 3600000, 'invalid JS budget');
  return budgets;
}

async function frozenFile(input, root) {
  check(input && typeof input.path === 'string' && hashPattern.test(input.sha256) && Number.isSafeInteger(input.bytes) && input.bytes >= 0 && input.bytes <= 8 * 1024 * 1024, 'invalid frozen file');
  if (isAbsolute(input.path) || input.path.includes('\\') || input.path.split('/').some(part => part === '..' || part === '')) throw new Error('INPUT_PATH: frozen file requires a contained relative path');
  let cursor = root;
  for (const part of input.path.split('/')) {
    cursor = join(cursor, part);
    if ((await lstat(cursor)).isSymbolicLink()) throw new Error('INPUT_PATH: frozen file symlink refused');
  }
  const path = await realpath(resolve(root, input.path));
  if (!contained(root, path)) throw new Error('INPUT_PATH: frozen file escapes input root');
  const info = await stat(path), bytes = await readFile(path);
  if (!info.isFile() || bytes.length !== input.bytes || sha(bytes) !== input.sha256) throw new Error('INPUT_CHECKSUM: frozen file differs');
  return bytes;
}

export async function verifyJsInputs(plan, { inputRoot } = {}) {
  check(plan?.schemaVersion === 1 && Array.isArray(plan.sources) && plan.sources.length > 0 && Array.isArray(plan.modules), 'JS plan required');
  const root = await realpath(resolve(inputRoot)), modules = {}, moduleMetadata = [], httpFixtures = [], httpMetadata = [];
  let total = 0;
  for (const module of plan.modules) {
    check(typeof module.url === 'string' && module.url && !Object.hasOwn(modules, module.url), 'unique module URL required');
    const bytes = await frozenFile(module, root); total += bytes.length;
    check(total <= 32 * 1024 * 1024, 'aggregate module size');
    const text = bytes.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(bytes)) throw new Error('INPUT_CHECKSUM: module must be exact UTF-8 text');
    modules[module.url] = text;
    moduleMetadata.push({ urlSha256: sha(module.url), sha256: module.sha256, bytes: bytes.length });
  }
  const httpMode = plan.http?.mode ?? 'live';
  check(['live', 'frozen'].includes(httpMode), 'invalid HTTP mode');
  check(plan.http?.fixtures === undefined || Array.isArray(plan.http.fixtures) && plan.http.fixtures.length <= 128, 'fixture HTTP count');
  const identities = new Set();
  let httpBytes = 0;
  for (const fixture of plan.http?.fixtures || []) {
    check(typeof fixture.url === 'string' && /^https?:\/\//.test(fixture.url), 'fixture HTTP URL');
    let normalizedUrl;
    try { normalizedUrl = new URL(fixture.url).href; } catch { throw new Error('INPUT_SCHEMA: fixture HTTP URL'); }
    const method = fixture.method ?? 'GET';
    check(method === 'GET', 'only successful code/rule GET fixtures supported');
    const key = method + '\0' + normalizedUrl;
    check(!identities.has(key), 'duplicate HTTP fixture'); identities.add(key);
    const bytes = await frozenFile(fixture, root); total += bytes.length;
    httpBytes += bytes.length;
    check(bytes.length <= 6 * 1024 * 1024 && httpBytes <= 32 * 1024 * 1024, 'fixture HTTP byte limit');
    check(total <= 48 * 1024 * 1024, 'aggregate frozen size');
    const status = fixture.status ?? 200;
    check(Number.isSafeInteger(status) && status >= 200 && status <= 299, 'fixture successful HTTP status required');
    const headers = fixture.headers ?? {};
    check(headers && typeof headers === 'object' && !Array.isArray(headers) && Object.values(headers).every(value => typeof value === 'string'), 'fixture HTTP headers');
    check(Object.entries(headers).every(([name, value]) => /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) && /^[\t\x20-\x7e]*$/.test(value)), 'fixture HTTP header syntax');
    httpFixtures.push({ url: fixture.url, method, status, headers, bodyBase64: bytes.toString('base64') });
    httpMetadata.push({ urlSha256: sha(fixture.url), method, status, sha256: fixture.sha256, bytes: bytes.length });
  }
  for (const source of plan.sources) {
    const sourceIdentitySha256 = jsSourceIdentity(source);
    if (source.sourceIdentitySha256 !== undefined && source.sourceIdentitySha256 !== sourceIdentitySha256) throw new Error('INPUT_CHECKSUM: JS source identity differs');
    check(Object.hasOwn(modules, source.api), 'entry module not captured');
  }
  return { modules, moduleMetadata, httpFixtures, httpMetadata, httpMode, inputSetSha256: semantic({ modules: moduleMetadata, http: httpMetadata, sources: plan.sources.map(jsSourceIdentity) }) };
}

export async function verifyJsHostBinding(directory) {
  const root = await realpath(resolve(directory)), classes = [];
  const bindingPath = join(root, 'binding.json'), bindingBytes = await readFile(bindingPath), manifest = JSON.parse(bindingBytes);
  const sourceSha256 = sha(await readFile(resolve(dirname(SELF), '../compat/js-fixture-host/tvbox/runtime/HostServices.java')));
  check(manifest.schemaVersion === 1 && manifest.sourceSha256 === sourceSha256 && Array.isArray(manifest.files), 'host binding source manifest differs');
  async function walk(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      check(!entry.isSymbolicLink(), 'host binding symlink refused');
      if (entry.isDirectory()) await walk(child);
      else {
        if (child === bindingPath) { check(entry.isFile(), 'host binding manifest type'); continue; }
        check(entry.isFile() && entry.name.endsWith('.class'), 'host binding classes only');
        const bytes = await readFile(child);
        check(bytes.length > 0 && bytes.length <= 2 * 1024 * 1024 && classes.length < 100, 'host binding size');
        classes.push({ path: relative(root, child).split(sep).join('/'), sha256: sha(bytes), bytes: bytes.length });
      }
    }
  }
  await walk(root); classes.sort((a, b) => a.path.localeCompare(b.path));
  check(classes.some(row => row.path === 'tvbox/runtime/HostServices.class'), 'host binding HostServices class missing');
  check(isDeepStrictEqual([...manifest.files].sort((a, b) => a.path.localeCompare(b.path)), classes), 'host binding class pins differ');
  return { directory: root, classes, sha256: semantic(classes), manifestSha256: sha(bindingBytes), sourceSha256 };
}

function kill(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1 || pid === process.pid) return false;
  try { process.kill(pid, 'SIGKILL'); return true; } catch (error) { return error.code === 'ESRCH'; }
}

/** Null is observable failure/unknown, never successful empty business JSON. */
export function classifyJsResponse(method, value) {
  if (value === null || value === undefined) return { status: 'invalid-json', implementation: 'unknown', response: { valueType: value === null ? 'null' : 'undefined' }, returnedNull: value === null,
    error: { category: 'invalid-result', type: 'JsNullOrMissingResult', fingerprint: sha('JS_NULL_OR_MISSING_RESULT') } };
  const { json, ...observation } = classifyBusinessResponse(method, value);
  return { ...observation, ...(json ? { json } : {}) };
}

/** Timeout continuation is a new isolated runtime, never a retry of the timed-out call. */
export async function probeJsSource({ plan, source, sourceIndex = 0, manifestSha256, verifiedInputs, replay, replayInputSha256 }, {
  runtimeFactory = createSpiderRuntime, setupRuntime, workRoot = tmpdir(), mode = 'discover', budgets: overrides, hostBinding,
} = {}) {
  const sourceIdentitySha256 = jsSourceIdentity(source), budgets = jsProbeBudgets({ budgets: { ...plan.budgets, ...overrides } });
  const report = { schemaVersion: 1, sourceIndex, manifestSha256, sourceIdentitySha256, sourceKeySha256: sha(source.key), apiSha256: sha(source.api), extSha256: sha(source.ext),
    inputSetSha256: verifiedInputs.inputSetSha256, nativeBridge: false, mode, httpMode: verifiedInputs.httpMode, budgets, calls: [], runtimes: [], cleanup: {},
    scope: 'Pure QuickJS selected source and business arguments; no JAR, media download/playback or Android equivalence',
    httpScope: verifiedInputs.httpMode === 'frozen' ? 'Captured code/rule responses supplied by explicit host binding; other business HTTP requests remain live' : 'Captured JS modules registered; original rule ext and business HTTP requests remain live',
    ...(replayInputSha256 ? { replayInputSha256 } : {}),
    modules: verifiedInputs.moduleMetadata, httpFixtures: verifiedInputs.httpMetadata,
    implementationScope: 'No JS function inventory; empty/default-shaped values and caught nulls do not establish implementation' };
  report.continuationScope = 'Calls after a timed-out method run once in a new freshly initialized JVM. Earlier responses may supply arguments; prior mutable JS instance state is not restored.';
  if (hostBinding) report.hostBinding = { sha256: hostBinding.sha256, manifestSha256: hostBinding.manifestSha256, sourceSha256: hostBinding.sourceSha256, classes: hostBinding.classes,
    scope: 'Explicit research HTTP-fixture host overlay; production HostServices class is replaced for frozen artifact retrieval, business HTTP remains live' };
  const privateCalls = [], output = { input: { source }, report, privateCalls }, started = Date.now(), deadline = started + budgets.caseMs;
  let runtime, directory, workerPid, runtimeRow, generation = 0, token, timedOut = false, stderr = '', selectedCalls, sourceBlocked = false;
  const lastResponse = new Map();
  const provenance = (origin, params) => ({ origin, paramsSha256: semantic(params), sourceIdentitySha256, ...(lastResponse.has(origin) ? { derivedResponseSha256: lastResponse.get(origin) } : {}) });
  async function bounded(action, limit, cleanup = false) {
    const duration = cleanup ? limit : Math.min(limit, deadline - Date.now());
    if (duration <= 0) throw Object.assign(new Error('JS source budget exceeded'), { code: 'ARTIFACT_DEADLINE' });
    let timer;
    try { return await Promise.race([Promise.resolve().then(action), new Promise((_, reject) => { timer = setTimeout(() => { timedOut = true; kill(workerPid); reject(Object.assign(new Error('JS method deadline exceeded'), { code: Date.now() >= deadline && !cleanup ? 'ARTIFACT_DEADLINE' : 'CALL_DEADLINE' })); }, duration); })]); }
    finally { clearTimeout(timer); }
  }
  async function collectLogs() {
    let logs = [];
    if (runtime && !timedOut && deadline - Date.now() > 0) {
      try { const value = await bounded(() => runtime.request({ operation: 'logs' }), Math.min(2000, budgets.callMs)); if (Array.isArray(value)) logs = value.filter(value => typeof value === 'string'); }
      catch (error) { runtimeRow.logCollectionError = classifyFailure(error); }
    }
    const rawLogs = [...logs, ...(stderr ? [stderr] : [])]; stderr = '';
    return { privateLogs: rawLogs, metadata: { count: rawLogs.length, sha256: semantic(rawLogs), ...(rawLogs.length ? { entries: rawLogs.map(value => ({ bytes: Buffer.byteLength(value), sha256: sha(value) })) } : {}) } };
  }
  async function closeRuntime() {
    if (!runtime && !directory) return;
    if (runtime) {
      try { await bounded(() => runtime.close(), budgets.closeMs, true); runtimeRow.cleanup.closed = true; }
      catch (error) { runtimeRow.cleanup.closed = false; runtimeRow.cleanup.error = classifyFailure(error); runtimeRow.cleanup.forcedWorkerKill = kill(workerPid); }
    } else { runtimeRow.cleanup.closed = true; runtimeRow.cleanup.runtimeNotStarted = true; }
    if (workerPid) { try { process.kill(workerPid, 0); runtimeRow.cleanup.workerExited = false; } catch (error) { runtimeRow.cleanup.workerExited = error.code === 'ESRCH'; } }
    else runtimeRow.cleanup.workerPidObserved = false;
    if (directory) { try { await rm(directory, { recursive: true, force: true }); runtimeRow.cleanup.temporaryDataRemoved = true; } catch (error) { runtimeRow.cleanup.temporaryDataRemoved = false; runtimeRow.cleanup.error = classifyFailure(error); } }
    runtime = undefined; token = undefined; directory = undefined; workerPid = undefined;
  }
  async function ensureRuntime() {
    if (runtime && token && !timedOut) return;
    await closeRuntime();
    timedOut = false;
    check(deadline > Date.now(), 'source budget exhausted before continuation');
    generation++;
    directory = await mkdtemp(join(workRoot, 'tvbox-js-source-'));
    runtimeRow = { generation, reason: generation === 1 ? 'initial' : 'independent-continuation-after-timeout', cleanup: {}, init: { attempted: true } };
    report.runtimes.push(runtimeRow);
    let begin = Date.now();
    let built;
    if (hostBinding) { const original = buildSpiderRuntime(); built = { ...original, classpath: hostBinding.directory + delimiter + original.classpath }; }
    runtime = runtimeFactory({ nativeBridge: false, ...(built ? { built } : {}), timeoutMs: Math.max(budgets.initMs, budgets.callMs), dataDir: join(directory, 'runtime'), onStderr: chunk => { stderr = (stderr + String(chunk)).slice(-1024 * 1024); } });
    try {
      await bounded(() => runtime.getState(), budgets.initMs);
      if (Number.isSafeInteger(runtime.workerPid)) workerPid = runtime.workerPid;
      await bounded(() => runtime.request({ operation: 'host', networkDisabled: false }), budgets.initMs);
      if (setupRuntime) await bounded(() => setupRuntime(runtime, { plan, source, verifiedInputs }), budgets.initMs);
      else if (verifiedInputs.httpMode === 'frozen' && verifiedInputs.httpFixtures.length) {
        check(hostBinding, 'frozen HTTP requires explicit research host binding');
        await bounded(() => runtime.request({ operation: 'host', networkDisabled: false, httpFixtures: verifiedInputs.httpFixtures }), budgets.initMs);
      }
      await bounded(() => runtime.setModules({ android: true, remote: false, modules: verifiedInputs.modules }), budgets.initMs);
      const spider = await bounded(() => runtime.getCSP(structuredClone(source)), budgets.initMs);
      runtimeRow.init.ready = spider?.ready === true && spider?.kind === 'js';
      if (safeClass(spider?.className)) runtimeRow.init.spiderClass = spider.className;
      if (!runtimeRow.init.ready) throw new Error('SPIDER_NOT_READY: JS SpiderNull or missing live object');
      token = spider.token;
      const logs = await collectLogs(); runtimeRow.init.logs = logs.metadata;
      output.runtimeInitializationLogs ??= []; output.runtimeInitializationLogs.push({ generation, logs: logs.privateLogs });
      if (timedOut) throw Object.assign(new Error('JS initialization log collection timed out'), { code: 'CALL_DEADLINE' });
      return true;
    } catch (error) {
      sourceBlocked = true;
      runtimeRow.init.ready = false; runtimeRow.init.error = classifyFailure(error);
      const logs = await collectLogs(); runtimeRow.init.logs = logs.metadata;
      output.runtimeInitializationLogs ??= []; output.runtimeInitializationLogs.push({ generation, logs: logs.privateLogs });
      await closeRuntime(); throw error;
    } finally { runtimeRow.init.elapsedMs = Date.now() - begin; }
  }
  function skip(step, method, reason) {
    const row = { discoveryStep: step, method, status: 'not-tested', reason, implementation: 'unknown', sourceIdentitySha256 };
    report.calls.push(row); privateCalls.push({ method, params: [], metadata: row });
  }
  async function execute(step, method, params, origin) {
    if (sourceBlocked) { skip(step, method, 'source-initialization-failed'); return; }
    if (Date.now() >= deadline) { skip(step, method, 'source-budget-exhausted'); return; }
    const begin = Date.now(), row = { discoveryStep: step, method, paramsSha256: semantic(params), argumentProvenance: provenance(origin, params), implementation: 'unknown', sourceIdentitySha256 };
    const privateRow = { method, params: structuredClone(params), metadata: row };
    try {
      await ensureRuntime(); row.runtimeGeneration = generation;
      const value = await bounded(() => runtime.call(token, method, params), budgets.callMs);
      privateRow.value = value;
      const { json, ...observation } = classifyJsResponse(method, value);
      Object.assign(row, observation);
      const logs = await collectLogs(); row.logs = logs.metadata; privateRow.logs = logs.privateLogs;
      if (timedOut) row.logCollectionTimedOut = true;
      if (typeof value === 'string') lastResponse.set(step, sha(value));
      return json;
    } catch (error) {
      const failure = classifyFailure(error, stderr);
      row.status = ['timeout', 'artifact-timeout'].includes(failure.category) ? 'timeout' : failure.category === 'network' ? 'network' : 'failed';
      row.error = failure; privateRow.error = { ...failure, rawMessage: String(error?.message || error) };
      if (row.status === 'timeout') timedOut = true;
      const logs = await collectLogs(); row.logs = logs.metadata; privateRow.logs = logs.privateLogs;
    } finally {
      row.elapsedMs = Date.now() - begin;
      report.calls.push(row); privateCalls.push(privateRow);
      if (timedOut) await closeRuntime();
    }
  }
  try {
    check(['discover', 'replay'].includes(mode), 'invalid JS probe mode');
    check(verifiedInputs.httpMode !== 'frozen' || !verifiedInputs.httpFixtures.length || hostBinding || setupRuntime, 'frozen HTTP requires explicit research host binding');
    if (replay) {
      check(isDeepStrictEqual(replay.input?.source || replay.source, source) && Array.isArray(replay.privateCalls), 'replay source differs');
      if (replay.report?.sourceIdentitySha256 !== sourceIdentitySha256 || replay.report?.inputSetSha256 !== verifiedInputs.inputSetSha256) throw new Error('INPUT_CHECKSUM: replay frozen source identity differs');
      selectedCalls = validateWorkingCalls(replay.privateCalls);
    } else if (mode === 'replay') selectedCalls = validateWorkingCalls(plan.calls?.[sourceIndex] || []);
    if (mode === 'replay') {
      check(selectedCalls.length > 0, 'replay calls missing');
      for (const call of selectedCalls) {
        if (call.skip) skip(call.slot, call.method, 'reference-parameters-not-derived');
        else await execute(call.slot, call.method, call.params, 'exact-private-replay');
      }
    } else {
      const home = await execute('home', 'homeContent', [true], 'fixed-home-filter-enabled');
      const homeVideo = await execute('home-video', 'homeVideoContent', [], 'no-parameters');
      const category = chooseCategory(home); let category1;
      if (category !== undefined) {
        category1 = await execute('category-page1', 'categoryContent', [category, '1', true, {}], 'home');
        await execute('category-page2', 'categoryContent', [category, '2', true, {}], 'home');
        const filters = chooseFilter(home, category);
        if (filters) await execute('category-filter', 'categoryContent', [category, '1', true, filters], 'home');
        else skip('category-filter', 'categoryContent', 'no-real-filter-option');
      } else for (const step of ['category-page1', 'category-page2', 'category-filter']) skip(step, 'categoryContent', 'no-real-category');
      const item = firstVideo(category1) || firstVideo(homeVideo) || firstVideo(home); let detail;
      if (item) detail = await execute('detail', 'detailContent', [[String(item.vod_id)]], firstVideo(category1) ? 'category-page1' : firstVideo(homeVideo) ? 'home-video' : 'home');
      else skip('detail', 'detailContent', 'no-real-video-id');
      const derived = chooseKeyword(category1, homeVideo, home), keyword = derived.fallback ? undefined : derived.keyword;
      let search, searchPage, searchDetail;
      if (keyword) {
        const origin = [category1, homeVideo, home][derived.originIndex] === category1 ? 'category-page1' : derived.originIndex === 1 ? 'home-video' : 'home';
        search = await execute('search', 'searchContent', [keyword, false], origin);
        searchPage = await execute('search-page1', 'searchContent', [keyword, false, '1'], origin);
      } else { skip('search', 'searchContent', 'no-real-search-keyword'); skip('search-page1', 'searchContent', 'no-real-search-keyword'); }
      const searched = firstVideo(search) || firstVideo(searchPage);
      if (searched) searchDetail = await execute('search-detail', 'detailContent', [[String(searched.vod_id)]], firstVideo(search) ? 'search' : 'search-page1');
      else skip('search-detail', 'detailContent', 'no-real-search-video-id');
      const episode = choosePlayer(detail) || choosePlayer(searchDetail);
      if (episode) await execute('player', 'playerContent', [episode.flag, episode.id, []], choosePlayer(detail) ? 'detail' : 'search-detail');
      else skip('player', 'playerContent', 'no-real-playback-entry');
    }
  } catch (error) { report.error = classifyFailure(error); output.error = { rawMessage: String(error?.message || error) }; }
  finally { await closeRuntime(); }
  if (!report.calls.length) for (const [step, method] of steps) skip(step, method, 'source-input-or-init-failure');
  report.cleanup = { closed: report.runtimes.every(row => row.cleanup.closed === true), workerExited: report.runtimes.every(row => row.cleanup.workerExited === true) ? true : report.runtimes.some(row => row.cleanup.workerExited === false) ? false : null,
    temporaryDataRemoved: report.runtimes.every(row => row.cleanup.temporaryDataRemoved === true), workerExitEvidence: report.runtimes.every(row => row.cleanup.workerExited === true) ? 'pid-observed' : 'some-pids-unobserved' };
  report.elapsedMs = Date.now() - started;
  report.observations = Object.fromEntries(['nonempty', 'empty', 'not-implemented', 'invalid-json', 'network', 'failed', 'timeout', 'not-tested'].map(status => [status, report.calls.filter(row => row.status === status).length]));
  report.completed = !report.error && !sourceBlocked && report.calls.every(row => row.status !== 'timeout');
  return output;
}

export async function runJsSourcePlan(planPath, { inputRoot, caseIndex, mode = 'discover', callsPath, runtimeFactory, setupRuntime, hostBinding: hostBindingPath } = {}) {
  const bytes = await readFile(planPath), plan = JSON.parse(bytes), manifestSha256 = sha(bytes);
  const verifiedInputs = await verifyJsInputs(plan, { inputRoot: inputRoot || dirname(resolve(planPath)) });
  const hostBinding = hostBindingPath ? await verifyJsHostBinding(hostBindingPath) : undefined;
  let replayInput, replayInputSha256;
  if (callsPath) { const replayBytes = await readFile(callsPath); replayInput = JSON.parse(replayBytes); replayInputSha256 = sha(replayBytes); }
  if (caseIndex !== undefined) check(Number.isSafeInteger(caseIndex) && plan.sources[caseIndex], 'invalid source index');
  const indices = caseIndex === undefined ? plan.sources.map((_value, index) => index) : [caseIndex], cases = [];
  for (const sourceIndex of indices) {
    const source = plan.sources[sourceIndex];
    const replay = replayInput?.cases ? replayInput.cases.find(row => isDeepStrictEqual(row.input?.source, source)) : replayInput;
    if (callsPath) check(replay, 'reference source missing');
    cases.push(await probeJsSource({ plan, source, sourceIndex, manifestSha256, verifiedInputs, replay, replayInputSha256 }, { mode, runtimeFactory, setupRuntime, hostBinding }));
  }
  return { schemaVersion: 1, manifestSha256, runnerSha256: sha(await readFile(SELF)), cases };
}

async function main(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const name = args[index];
    check(['--plan', '--input-root', '--case-index', '--mode', '--calls', '--output', '--metadata', '--host-binding'].includes(name) && args[index + 1] && !Object.hasOwn(options, name), 'CLI arguments');
    options[name] = args[++index];
  }
  check(options['--plan'] && options['--output'] && options['--metadata'], 'required CLI options');
  const result = await runJsSourcePlan(resolve(options['--plan']), { inputRoot: options['--input-root'], caseIndex: options['--case-index'] === undefined ? undefined : Number(options['--case-index']), mode: options['--mode'] || 'discover', callsPath: options['--calls'], hostBinding: options['--host-binding'] });
  for (const [path, value] of [[options['--output'], result], [options['--metadata'], { ...result, cases: result.cases.map(row => row.report) }]]) {
    await mkdir(dirname(resolve(path)), { recursive: true, mode: 0o700 }); await writeFile(resolve(path), JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  }
  process.stdout.write(JSON.stringify({ manifestSha256: result.manifestSha256, cases: result.cases.map(row => ({ sourceIndex: row.report.sourceIndex, sourceIdentitySha256: row.report.sourceIdentitySha256, observations: row.report.observations, cleanup: row.report.cleanup })) }) + '\n');
  if (result.cases.some(row => !row.report.cleanup.closed || row.report.cleanup.workerExited === false || !row.report.cleanup.temporaryDataRemoved)) process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === SELF) main(process.argv.slice(2)).catch(error => { process.stderr.write(JSON.stringify({ error: classifyFailure(error) }) + '\n'); process.exitCode = 1; });
