// SPDX-License-Identifier: GPL-3.0-only
// One exact captured source per fresh runtime. Raw inputs/responses are private.
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSpiderRuntime } from '../../backend/spider-runtime/index.mjs';
import { canonical, classifyFailure, summarizeResponse } from './jar-matrix-probe.mjs';
import { extractMissingSymbols } from './jar-failure-diagnostics.mjs';
import { assertLoaderIdentity, loaderContextOf, officialOracleApkSha256 } from '../android/loader-context.mjs';
import { workingSourceScenarioIdentity } from '../compat/prepare-working-source-plan.mjs';

const SELF = fileURLToPath(import.meta.url);
const sha = value => createHash('sha256').update(value).digest('hex');
const identity = value => sha(JSON.stringify(canonical(value)));
const hashPattern = /^[a-f0-9]{64}$/;
const methods = new Set(['homeContent', 'homeVideoContent', 'categoryContent', 'searchContent', 'detailContent', 'playerContent']);
const defaultSlots = [
  ['home', 'homeContent'], ['homeVideo', 'homeVideoContent'],
  ['categoryPage1', 'categoryContent'], ['categoryPage2', 'categoryContent'], ['categoryFilter', 'categoryContent'],
  ['searchTwoArgs', 'searchContent'], ['searchThreeArgs', 'searchContent'],
  ['detail', 'detailContent'], ['player', 'playerContent'],
];
const className = value => typeof value === 'string' && /^[\w.$]+$/.test(value) && value.length <= 240 ? value : undefined;
const originalLabel = value => {
  const text = String(value ?? '');
  return text.length > 160 || /(?:https?:|:\/\/|[?=&\r\n]|bearer\s|token[:\s])/i.test(text) ? 'sha256:' + sha(text) : text;
};
const notTested = (slot, method, reason) => ({ slot, discoveryStep: slot, method, status: 'not-tested', reason, implementation: 'unknown' });
const contained = (root, path) => { const rel = relative(root, path); return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep); };
const validId = value => ['string', 'number'].includes(typeof value) && String(value).length > 0;
const firstVideo = json => Array.isArray(json?.list) ? json.list.find(row => row && validId(row.vod_id)) : undefined;

export function workingSourceBudgets(plan = {}) {
  const result = { caseMs: 240000, loadMs: 90000, initMs: 15000, callMs: 10000, closeMs: 5000, ...plan.nasBudgets };
  for (const [key, value] of Object.entries(result)) {
    if (!['caseMs', 'loadMs', 'initMs', 'callMs', 'closeMs'].includes(key) || !Number.isSafeInteger(value) || value < 1 || value > 3600000) throw new Error('INPUT_SCHEMA: invalid working-source budget');
  }
  return result;
}

/** Calls may be trusted plan instructions or byte-bound ART replay instructions. */
export function validateWorkingCalls(calls) {
  if (!Array.isArray(calls) || calls.length > 20) throw new Error('INPUT_SCHEMA: invalid calls');
  const counts = {};
  return calls.map(call => {
    if (!call || !methods.has(call.method) || !Array.isArray(call.params)) throw new Error('INPUT_SCHEMA: invalid call');
    const count = counts[call.method] = (counts[call.method] || 0) + 1;
    const step = call.metadata?.discoveryStep;
    const slot = typeof step === 'string' && /^[a-z0-9-]{1,40}$/.test(step) ? step : `${call.method}-${count}`;
    const methodProvenance = {};
    for (const key of ['declaringClass', 'baseSpiderClass']) if (className(call.metadata?.methodProvenance?.[key])) methodProvenance[key] = call.metadata.methodProvenance[key];
    for (const key of ['inheritedBaseDefault', 'baseDelegatingOverload']) if (typeof call.metadata?.methodProvenance?.[key] === 'boolean') methodProvenance[key] = call.metadata.methodProvenance[key];
    if (call.metadata?.status === 'not-tested' && call.params.length === 0) return { method: call.method, params: [], slot, skip: true, methodProvenance };
    const a = call.params, s = value => typeof value === 'string', b = value => typeof value === 'boolean';
    const stringList = value => Array.isArray(value) && value.every(s);
    const valid = call.method === 'homeContent' ? a.length === 1 && b(a[0])
      : call.method === 'homeVideoContent' ? a.length === 0
      : call.method === 'categoryContent' ? a.length === 4 && s(a[0]) && s(a[1]) && b(a[2]) && a[3] && !Array.isArray(a[3]) && typeof a[3] === 'object' && Object.values(a[3]).every(s)
      : call.method === 'searchContent' ? [2, 3].includes(a.length) && s(a[0]) && b(a[1]) && (a.length === 2 || s(a[2]))
      : call.method === 'detailContent' ? a.length === 1 && stringList(a[0])
      : a.length === 3 && s(a[0]) && s(a[1]) && stringList(a[2]);
    if (!valid) throw new Error('INPUT_SCHEMA: invalid method parameters');
    // Provider controlled labels/provenance never enter public metadata.
    return { method: call.method, params: structuredClone(a), slot, methodProvenance };
  });
}

export function chooseCategory(home) {
  const category = Array.isArray(home?.class) ? home.class.find(row => row && validId(row.type_id)) : undefined;
  return category ? String(category.type_id) : undefined;
}

export function chooseFilter(home, categoryId) {
  const groups = home?.filters?.[categoryId];
  if (!Array.isArray(groups)) return undefined;
  for (const group of groups) {
    if (!group || typeof group.key !== 'string' || !group.key || !Array.isArray(group.value)) continue;
    const option = group.value.find(row => row && validId(row.v) && String(row.v).trim() !== '');
    if (option) return { [group.key]: String(option.v) };
  }
}

export function chooseKeyword(...responses) {
  for (const [index, response] of responses.entries()) {
    const named = Array.isArray(response?.list) ? response.list.find(row => typeof row?.vod_name === 'string' && row.vod_name.trim()) : undefined;
    if (named) return { keyword: Array.from(named.vod_name.trim()).slice(0, 4).join(''), originIndex: index, fallback: false };
  }
  return { keyword: '测试', fallback: true };
}

export function choosePlayer(detail) {
  const video = Array.isArray(detail?.list) ? detail.list.find(row => row && typeof row === 'object') : undefined;
  if (!video || typeof video.vod_play_from !== 'string' || typeof video.vod_play_url !== 'string') return undefined;
  const flags = video.vod_play_from.split('$$$'), groups = video.vod_play_url.split('$$$');
  for (let index = 0; index < flags.length; index++) {
    if (!flags[index] || !groups[index]) continue;
    for (const episode of groups[index].split('#')) {
      const split = episode.indexOf('$');
      // Split once: an opaque episode identifier may itself contain '$'.
      if (split >= 0 && episode.slice(split + 1)) return { flag: flags[index], id: episode.slice(split + 1), vipFlags: [] };
    }
  }
}

export function classifyBusinessResponse(method, value) {
  const metadata = typeof value === 'string' ? { bytes: Buffer.byteLength(value), sha256: sha(value) } : { valueType: value === null ? 'null' : typeof value };
  if (typeof value === 'string' && value.trim() === '') return { json: undefined, status: 'empty', response: metadata, implementation: 'unknown-default-compatible' };
  try {
    const { json, metadata: response } = summarizeResponse(value);
    const nonempty = method === 'homeContent' ? response.hasContent
      : method === 'playerContent' ? typeof json.url === 'string' && json.url.trim().length > 0
      : Array.isArray(json.list) && json.list.length > 0;
    return { json, status: nonempty ? 'nonempty' : 'empty', response, implementation: 'unknown' };
  } catch (error) {
    const failure = classifyFailure(error);
    return { json: undefined, status: 'invalid-json', response: error.responseMetadata || metadata, error: failure, implementation: 'unknown' };
  }
}

async function checkedJar(input, inputRoot) {
  if (!input || typeof input.jarPath !== 'string' || !hashPattern.test(input.sha256)) throw new Error('INPUT_SCHEMA: missing frozen JAR identity');
  const [root, path] = await Promise.all([realpath(inputRoot), realpath(resolve(inputRoot, input.jarPath))]);
  if (!contained(root, path)) throw new Error('INPUT_PATH: JAR escapes captured input root');
  const info = await stat(path);
  if (!info.isFile() || info.size < 1 || info.size > 128 * 1024 * 1024) throw new Error('INPUT_SIZE: invalid captured JAR');
  const bytes = await readFile(path);
  if (sha(bytes) !== input.sha256) throw new Error('INPUT_CHECKSUM: captured JAR differs');
  return { path, bytes: bytes.length };
}

function killPid(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1 || pid === process.pid) return false;
  try { process.kill(pid, 'SIGKILL'); return true; } catch (error) { return error.code === 'ESRCH'; }
}

/** Fresh runtime per source, including exact main + site coexistence context. */
export async function probeWorkingSource(entry, {
  inputRoot, runtimeFactory = createSpiderRuntime, budgets: overrides, workRoot = tmpdir(), mode = 'discover',
} = {}) {
  const budgets = workingSourceBudgets({ nasBudgets: overrides });
  const { artifact, site, artifactIndex = 0, siteIndex = 0, caseId = `${artifactIndex}-${siteIndex}`, manifestSha256, android } = entry;
  const report = { schemaVersion: 1, caseId, artifactIndex, siteIndex, manifestSha256,
    scope: 'NAS live business-method observation; media bytes are never downloaded or played',
    mode, jarSha256: artifact.sha256, api: className(site.api) || 'sha256:' + sha(String(site.api)), siteKeySha256: sha(String(site.key ?? '')),
    extSha256: sha(typeof site.ext === 'string' ? site.ext : JSON.stringify(site.ext ?? '')), budgets, calls: [], cleanup: {}, controlledEvidence: [],
    parameterPolicy: 'Exact explicit/ART parameters take precedence; discovery arguments are NAS-derived, without ART parity claim',
    methodInventory: { available: false, scope: 'No declared-method reflection API; empty/default-shaped responses cannot establish implementation' },
    applicationStatePolicy: 'fresh-runtime-data', initPolicy: 'android',
  };
  if (entry.standaloneDiagnostic === true) {
    report.standaloneDiagnostic = true;
    report.contextScope = 'Standalone diagnostic; configured original main JAR is unavailable; not original subscription coexistence evidence';
    if (hashPattern.test(site.originalMissingContextSha256)) report.originalMissingContextSha256 = site.originalMissingContextSha256;
  }
  if (hashPattern.test(site.methodSelectionSha256)) report.methodSelectionSha256 = site.methodSelectionSha256;
  const privateCalls = [], started = Date.now(), deadline = started + budgets.caseMs;
  let context, runtime, directory, workerPid, fatal = false, stage = 'input', stderr = '', selectedCalls, token;
  const raw = { input: { artifact, site }, report, privateCalls };
  const skip = (slot, method, reason, methodProvenance) => {
    const row = { ...notTested(slot, method, reason), ...(methodProvenance && Object.keys(methodProvenance).length ? { [report.parameterSource === 'exact-art-replay' ? 'androidMethodProvenance' : 'planMethodProvenance']: methodProvenance } : {}) };
    report.calls.push(row); privateCalls.push({ slot, method, params: [], metadata: row });
  };
  const errorText = error => [error?.errorType || error?.name || 'Error', error?.message || ''].join(': ');
  const classified = error => classifyFailure(error, stderr);
  const isFatal = (error, failure) => ['timeout', 'artifact-timeout'].includes(failure.category) || /worker exited|runtime is closed/i.test(String(error?.message));
  const evidence = (name, error) => {
    const found = extractMissingSymbols(stderr + '\n' + (error ? errorText(error) : ''));
    if (found.exceptionTypes.length || found.missingSymbols.length) report.controlledEvidence.push({ stage: name, ...found });
    stderr = '';
  };
  async function bounded(action, milliseconds = budgets.callMs, cleanup = false) {
    const duration = cleanup ? milliseconds : Math.min(milliseconds, deadline - Date.now());
    if (duration <= 0) { fatal = true; throw Object.assign(new Error('Case budget exceeded'), { code: 'ARTIFACT_DEADLINE' }); }
    let timer;
    try {
      return await Promise.race([Promise.resolve().then(action), new Promise((_, reject) => {
        timer = setTimeout(() => { fatal = true; report.cleanup.forcedWorkerKill = killPid(workerPid); reject(Object.assign(new Error('Working-source deadline exceeded'), { code: Date.now() >= deadline && !cleanup ? 'ARTIFACT_DEADLINE' : 'CALL_DEADLINE' })); }, duration);
      })]);
    } finally { clearTimeout(timer); }
  }
  async function call(slot, method, params, parameterProvenance, methodProvenance) {
    if (fatal || Date.now() >= deadline) { skip(slot, method, fatal ? 'runtime-fatal' : 'case-budget', methodProvenance); return; }
    stage = method;
    const begin = Date.now(), row = { slot, discoveryStep: slot, method, paramsSha256: identity(params), parameterProvenance, implementation: 'unknown', ...(methodProvenance && Object.keys(methodProvenance).length ? { [report.parameterSource === 'exact-art-replay' ? 'androidMethodProvenance' : 'planMethodProvenance']: methodProvenance } : {}) };
    const privateRow = { slot, method, params: structuredClone(params), parameterProvenance };
    if (method === 'searchContent' && params.length === 3) row.signatureImplementation = 'unknown-inherited-delegation-possible';
    try {
      const value = await bounded(() => runtime.call(token, method, params));
      privateRow.value = value;
      const observed = classifyBusinessResponse(method, value);
      const { json, ...publicObservation } = observed;
      Object.assign(row, publicObservation);
      return json;
    } catch (error) {
      const failure = classified(error);
      row.status = failure.category === 'network' ? 'network' : ['timeout', 'artifact-timeout'].includes(failure.category) ? 'timeout'
        : /UnsupportedOperationException/.test(String(error?.errorType)) && /not (?:implemented|supported)|unsupported/i.test(String(error?.message)) ? 'not-implemented' : 'failed';
      row.error = failure;
      privateRow.error = { ...failure, rawMessage: errorText(error) };
      if (isFatal(error, failure)) fatal = true;
      evidence(slot, error);
    } finally {
      row.elapsedMs = Date.now() - begin;
      privateRow.metadata = row;
      report.calls.push(row); privateCalls.push(privateRow);
      evidence(slot);
    }
  }
  async function observeLoadState(afterInitError = false) {
    const state = await bounded(() => runtime.getState());
    const count = state?.jar?.loaderCount;
    const expected = context.main ? 2 : 1;
    Object.assign(report.selectedLoad, { loaderCount: Number.isSafeInteger(count) ? count : null, expectedLoaderCount: expected,
      loaded: Number.isSafeInteger(count) ? count >= expected : null, ...(afterInitError ? { observedAfterInitError: true } : {}) });
    report.loadSuccess = report.selectedLoad.loaded;
  }
  try {
    if (!['discover', 'replay'].includes(mode) || typeof site.ext !== 'string' || typeof site.api !== 'string' || typeof site.key !== 'string' || site.type !== 3) throw new Error('INPUT_SCHEMA: exact source inputs required');
    context = loaderContextOf(artifact, site);
    if (context.legacy) throw new Error('INPUT_SCHEMA: original loader context required');
    Object.assign(report, context.identity);
    if (site.extSha256 && report.extSha256 !== site.extSha256) throw new Error('INPUT_CHECKSUM: source ext differs');
    if (site.loaderContextSha256 && site.loaderContextSha256 !== identity(context.identity)) throw new Error('INPUT_CHECKSUM: loader context hash differs');
    let caseIdentitySha256;
    try {
      caseIdentitySha256 = site.sourceScenarioSha256 === undefined ? identity([artifact.sha256, context.identity, site.api, report.extSha256])
        : workingSourceScenarioIdentity(artifact, site, { originalBinding: entry.originalBinding });
    } catch (error) {
      throw Object.assign(new Error('INPUT_CHECKSUM: source scenario inputs differ'), { cause: error });
    }
    if (site.caseIdentitySha256 && caseIdentitySha256 !== site.caseIdentitySha256) throw new Error('INPUT_CHECKSUM: case identity differs');
    if (site.sourceScenarioSha256 !== undefined && site.sourceScenarioSha256 !== caseIdentitySha256) throw new Error('INPUT_CHECKSUM: source scenario identity differs');
    report.caseIdentitySha256 = caseIdentitySha256;
    if (site.sourceScenarioSha256 !== undefined) report.sourceScenarioSha256 = caseIdentitySha256;
    if (android) {
      assertLoaderIdentity(android.report, artifact, site);
      const a = android.report;
      if (a.targetApkSha256 !== officialOracleApkSha256 || !hashPattern.test(a.symbolMapSha256) || a.manifestSha256 !== manifestSha256 || a.artifactIndex !== artifactIndex || a.siteIndex !== siteIndex || a.jarSha256 !== artifact.sha256 || a.extSha256 !== report.extSha256
        || a.api !== originalLabel(site.api) || a.siteKey !== originalLabel(site.key) || a.id !== originalLabel(artifact.id)) throw new Error('INPUT_CHECKSUM: exact ART identity differs');
      selectedCalls = validateWorkingCalls(android.privateCalls);
      report.targetApkSha256 = a.targetApkSha256;
      report.artSymbolMapSha256 = a.symbolMapSha256;
      report.parameterSource = 'exact-art-replay';
    } else if (Array.isArray(site.calls) && site.calls.length) {
      selectedCalls = validateWorkingCalls(site.calls);
      report.parameterSource = 'explicit-plan';
    } else if (mode === 'replay') throw new Error('INPUT_SCHEMA: replay requires exact ART or explicit calls');
    else report.parameterSource = 'nas-discovery';
    const checked = await checkedJar(artifact, inputRoot);
    report.jarBytes = checked.bytes; report.jarBytesVerified = true;
    let main;
    if (context.main) { main = await checkedJar(context.main, inputRoot); report.mainJarBytes = main.bytes; report.mainJarBytesVerified = true; }
    directory = await mkdtemp(join(workRoot, 'tvbox-working-source-'));
    stage = 'start';
    runtime = runtimeFactory({ nativeBridge: true, timeoutMs: budgets.loadMs, dataDir: join(directory, 'runtime'), onStderr: value => { stderr = (stderr + String(value)).slice(-1024 * 1024); } });
    const state = await bounded(() => runtime.request({ operation: 'nativeState' }));
    if (Number.isSafeInteger(state?.workerPid)) workerPid = state.workerPid;
    raw.workerPid = workerPid;
    await bounded(() => runtime.request({ operation: 'host', jarInitPolicy: 'android', packageName: android?.report?.targetPackage || 'com.github.tvbox.osc.jun' }));
    if (main) {
      stage = 'main-load'; const begin = Date.now(); report.mainLoad = { attempted: true };
      const loaded = await bounded(() => runtime.loadMain(main.path), budgets.loadMs);
      Object.assign(report.mainLoad, { loaded: loaded?.loaded === true, elapsedMs: Date.now() - begin });
      if (!report.mainLoad.loaded) throw Object.assign(new Error(String(loaded?.failure || 'JAR_LOAD_FAILED: configured main JAR')), { code: 'JAR_LOAD_FAILED' });
      evidence(stage);
    }
    stage = 'load';
    if (context.role === 'main') {
      const begin = Date.now(); report.selectedLoad = { attempted: true };
      const loaded = await bounded(() => runtime.loadMain(checked.path), budgets.loadMs);
      report.loadSuccess = loaded?.loaded === true;
      Object.assign(report.selectedLoad, { loaded: report.loadSuccess, elapsedMs: Date.now() - begin });
      if (!report.loadSuccess) throw Object.assign(new Error(String(loaded?.failure || 'JAR_LOAD_FAILED: selected JAR')), { code: 'JAR_LOAD_FAILED' });
    } else {
      await bounded(() => runtime.registerJar(context.signature, checked.path), budgets.loadMs);
      report.selectedLoad = { registered: true, attempted: false, loaded: null, includesSpiderInit: true };
    }
    evidence(stage);
    await bounded(() => runtime.setModules({ remote: true }));
    stage = 'init';
    const begin = Date.now();
    if (context.role === 'site') report.selectedLoad.attempted = true;
    const spider = await bounded(() => runtime.getCSP({ ...site, type: 3, jar: context.role === 'site' ? context.signature : '' }), context.role === 'site' ? budgets.loadMs : budgets.initMs);
    report.initSuccess = spider?.ready === true;
    report.initMs = Date.now() - begin;
    if (className(spider?.className)) report.spiderClass = spider.className;
    await observeLoadState();
    if (report.loadSuccess === false) throw new Error('JAR_LOAD_FAILED: selected loader absent');
    if (!report.initSuccess) throw new Error('SPIDER_NOT_READY: SpiderNull');
    token = spider.token;
    evidence(stage);
    if (selectedCalls) {
      for (const item of selectedCalls) {
        if (item.skip) skip(item.slot, item.method, 'art-or-plan-argument-not-derived', item.methodProvenance);
        else await call(item.slot, item.method, item.params, report.parameterSource, item.methodProvenance);
      }
    } else {
      const home = await call('home', 'homeContent', [true], 'nas-derived:fixed-home-filter-enabled');
      const homeVideo = await call('homeVideo', 'homeVideoContent', [], 'nas-derived:no-parameters');
      const categoryId = chooseCategory(home);
      let category1;
      if (categoryId !== undefined) {
        category1 = await call('categoryPage1', 'categoryContent', [categoryId, '1', true, {}], 'nas-derived:first-valid-home-class');
        await call('categoryPage2', 'categoryContent', [categoryId, '2', true, {}], 'nas-derived:same-home-class-page-2');
        const filter = chooseFilter(home, categoryId);
        if (filter) await call('categoryFilter', 'categoryContent', [categoryId, '1', true, filter], 'nas-derived:first-nonempty-home-filter-option');
        else skip('categoryFilter', 'categoryContent', 'no-actual-home-filter-option');
      } else for (const slot of ['categoryPage1', 'categoryPage2', 'categoryFilter']) skip(slot, 'categoryContent', 'no-valid-home-category');
      const keyword = chooseKeyword(home, category1, homeVideo);
      const provenance = keyword.fallback ? 'nas-derived:explicit-fallback-test-word' : 'nas-derived:first-video-name-first-four-codepoints';
      const search2 = await call('searchTwoArgs', 'searchContent', [keyword.keyword, false], provenance);
      const search3 = await call('searchThreeArgs', 'searchContent', [keyword.keyword, false, '1'], provenance);
      const detailVideo = firstVideo(category1) || firstVideo(search2) || firstVideo(search3);
      let detail;
      if (detailVideo) detail = await call('detail', 'detailContent', [[String(detailVideo.vod_id)]], 'nas-derived:first-valid-category-or-search-video-id');
      else skip('detail', 'detailContent', 'no-actual-category-or-search-video-id');
      const episode = choosePlayer(detail);
      if (episode) await call('player', 'playerContent', [episode.flag, episode.id, episode.vipFlags], 'nas-derived:first-matched-detail-play-group-and-episode');
      else skip('player', 'playerContent', 'no-matched-detail-play-episode');
    }
    report.completed = !fatal;
  } catch (error) {
    report.error = { stage, ...classified(error) };
    raw.error = { stage, rawMessage: errorText(error) };
    fatal ||= isFatal(error, report.error);
    if (stage === 'init' && context?.role === 'site' && runtime && !fatal) {
      try { await observeLoadState(true); } catch (stateError) { report.selectedLoad.stateError = classified(stateError); }
    }
    evidence(stage, error);
  } finally {
    if (runtime) {
      try { await bounded(() => runtime.close(), budgets.closeMs, true); report.cleanup.closed = true; }
      catch (error) { report.cleanup.closed = false; report.cleanup.error = classified(error); report.cleanup.forcedWorkerKill = killPid(workerPid); evidence('cleanup', error); }
    }
    if (workerPid) { try { process.kill(workerPid, 0); report.cleanup.workerExited = false; } catch (error) { report.cleanup.workerExited = error.code === 'ESRCH'; } }
    if (directory) {
      try { await rm(directory, { recursive: true, force: true }); report.cleanup.temporaryDataRemoved = true; }
      catch (error) { report.cleanup.temporaryDataRemoved = false; report.cleanup.error = classifyFailure(error); }
    }
  }
  if (!report.calls.length) for (const [slot, method] of selectedCalls?.map(item => [item.slot, item.method]) || defaultSlots) skip(slot, method, report.error ? 'load-or-init-failure' : 'not-reached');
  report.elapsedMs = Date.now() - started;
  report.observations = Object.fromEntries(['nonempty', 'empty', 'not-implemented', 'invalid-json', 'network', 'failed', 'timeout', 'not-tested'].map(status => [status, report.calls.filter(call => call.status === status).length]));
  report.businessScope = 'Nonempty method responses are observations, not proof that every page, filter, search term, detail or media URL works';
  return raw;
}

/** Flat case order is immutable artifact order followed by original site order. */
export async function prepareWorkingSourceCases(planPath, { inputRoot, callsDir } = {}) {
  const planBytes = await readFile(planPath), plan = JSON.parse(planBytes), manifestSha256 = sha(planBytes);
  if (plan.schemaVersion !== 1 || !Array.isArray(plan.artifacts)) throw new Error('INPUT_SCHEMA: expected captured plan');
  const root = resolve(inputRoot || plan.inputRoot || dirname(resolve(planPath)));
  let diagnosticFreeze;
  if (plan.standaloneDiagnostic === true) {
    diagnosticFreeze = JSON.parse(await readFile(join(root, 'freeze.json'), 'utf8'));
    if (diagnosticFreeze.schemaVersion !== 1 || !Array.isArray(diagnosticFreeze.bindings)
      || diagnosticFreeze.inputSetSha256 !== plan.metadata?.sourceInputSetSha256) throw new Error('INPUT_CHECKSUM: diagnostic frozen source identity differs');
  }
  const cases = [];
  for (const [artifactIndex, artifact] of plan.artifacts.entries()) {
    if (!Array.isArray(artifact.sites)) throw new Error('INPUT_SCHEMA: missing sources');
    for (const [siteIndex, site] of artifact.sites.entries()) {
      const caseId = `${artifactIndex}-${siteIndex}`;
      const android = callsDir ? JSON.parse(await readFile(join(callsDir, caseId + '-private.json'), 'utf8')) : undefined;
      const originalBinding = diagnosticFreeze?.bindings.find(binding => binding.id === site.bindingId);
      cases.push({ caseId, artifactIndex, siteIndex, artifact, site, manifestSha256, ...(plan.standaloneDiagnostic === true ? { standaloneDiagnostic: true, originalBinding } : {}), ...(android ? { android } : {}) });
    }
  }
  return { plan, cases, inputRoot: root, manifestSha256, budgets: workingSourceBudgets(plan) };
}

export async function runWorkingSourcePlan(planPath, { inputRoot, callsDir, caseIndex, mode = 'discover', runtimeFactory, onCase = () => {} } = {}) {
  const prepared = await prepareWorkingSourceCases(planPath, { inputRoot, callsDir });
  if (caseIndex !== undefined && (!Number.isSafeInteger(caseIndex) || !prepared.cases[caseIndex])) throw new Error('INPUT_SCHEMA: invalid case index');
  const selected = caseIndex === undefined ? prepared.cases : [prepared.cases[caseIndex]], results = [];
  for (const entry of selected) {
    const result = await probeWorkingSource(entry, { inputRoot: prepared.inputRoot, budgets: prepared.budgets, runtimeFactory, mode });
    results.push(result); await onCase(result.report);
  }
  return { schemaVersion: 1, manifestSha256: prepared.manifestSha256, runnerSha256: sha(await readFile(SELF)), cases: results };
}

async function main(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (!['--plan', '--output', '--metadata', '--input-root', '--case-index', '--mode', '--calls-dir'].includes(key) || !args[index + 1] || Object.hasOwn(options, key)) throw new Error('INPUT_SCHEMA: invalid arguments');
    options[key] = args[++index];
  }
  if (!options['--plan'] || !options['--output'] || !options['--metadata']) throw new Error('INPUT_SCHEMA: --plan --output --metadata required');
  const caseIndex = options['--case-index'] === undefined ? undefined : Number(options['--case-index']);
  const result = await runWorkingSourcePlan(resolve(options['--plan']), { inputRoot: options['--input-root'], callsDir: options['--calls-dir'], caseIndex, mode: options['--mode'] || 'discover', onCase: report => process.stdout.write(JSON.stringify(report) + '\n') });
  const metadata = { ...result, cases: result.cases.map(row => row.report) };
  for (const [path, value] of [[options['--output'], result], [options['--metadata'], metadata]]) {
    await mkdir(dirname(resolve(path)), { recursive: true, mode: 0o700 });
    await writeFile(resolve(path), JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  }
  if (result.cases.some(row => row.report.cleanup.closed === false || row.report.cleanup.workerExited === false)) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === SELF) main(process.argv.slice(2)).catch(error => { process.stderr.write(JSON.stringify({ error: classifyFailure(error) }) + '\n'); process.exitCode = 1; });
