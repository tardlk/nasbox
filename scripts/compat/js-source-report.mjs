// SPDX-License-Identifier: GPL-3.0-only
// Strict private QuickJS evidence validation. Public reports contain allowlisted metadata.
import { createHash } from 'node:crypto';
import { readFile, readdir, lstat, realpath, mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { canonical } from '../container/jar-matrix-probe.mjs';
import { classifyJsResponse, jsProbeBudgets, jsSourceIdentity, verifyJsInputs } from '../container/js-source-probe.mjs';
import { validateWorkingCalls } from '../container/working-source-probe.mjs';
import { verifyJsSourceInputs } from './prepare-js-source-inputs.mjs';

const SELF = fileURLToPath(import.meta.url), sha = value => createHash('sha256').update(value).digest('hex');
const semantic = value => sha(JSON.stringify(canonical(value)));
const hashPattern = /^[a-f0-9]{64}$/, imagePattern = /^sha256:[a-f0-9]{64}$/;
const statuses = ['nonempty', 'empty', 'not-implemented', 'invalid-json', 'network', 'failed', 'timeout', 'not-tested'];
const steps = [['home', 'homeContent'], ['home-video', 'homeVideoContent'], ['category-page1', 'categoryContent'], ['category-page2', 'categoryContent'],
  ['category-filter', 'categoryContent'], ['detail', 'detailContent'], ['search', 'searchContent'], ['search-page1', 'searchContent'], ['search-detail', 'detailContent'], ['player', 'playerContent']];
const check = (condition, reason) => { if (!condition) throw new Error('JS_REPORT_' + reason); };
const contained = (root, path) => { const rel = relative(root, path); return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep); };
const safeName = value => typeof value === 'string' && /^[\p{L}\p{N}_ .-]{1,120}$/u.test(value) && !/bearer\s|(?:token|secret|password|authorization)[:\s]/i.test(value) ? value : 'sha256:' + sha(String(value));
const safeClass = value => typeof value === 'string' && /^[\w.$]{1,240}$/.test(value) ? value : undefined;
const safeReason = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,80}$/.test(value) ? value : undefined;

function safeError(error) {
  if (!error) return undefined;
  const result = {};
  if (safeClass(error.type || error.name)) result.type = error.type || error.name;
  if (hashPattern.test(error.fingerprint)) result.fingerprint = error.fingerprint;
  if (['execution', 'artifact-timeout', 'timeout', 'invalid-json', 'missing-class-or-member', 'native-binding', 'network', 'invalid-result', 'input', 'environment', 'spider-not-ready'].includes(error.category)) result.category = error.category;
  return result;
}

/** These are host diagnostic strings; provider code can also write the log channel. */
export function jsLogMarkers(logs) {
  check(Array.isArray(logs) && logs.every(value => typeof value === 'string'), 'LOG_SCHEMA');
  const counts = { fixtureHits: 0, liveHttp: 0 };
  for (const text of logs) for (const line of text.split(/\r?\n/)) {
    if (/^JS_FIXTURE_HIT urlSha256=[a-f0-9]{64} status=2\d\d bytes=\d+$/.test(line)) counts.fixtureHits++;
    if (/^JS_LIVE_HTTP method=(?:GET|POST|PUT|DELETE|HEAD|OPTIONS|PATCH) urlSha256=[a-f0-9]{64}$/.test(line)) counts.liveHttp++;
  }
  return counts;
}

function validateLogs(logs, metadata) {
  check(Array.isArray(logs) && logs.every(value => typeof value === 'string') && metadata && metadata.count === logs.length && metadata.sha256 === semantic(logs), 'LOG_HASH');
  const entries = logs.map(value => ({ bytes: Buffer.byteLength(value), sha256: sha(value) }));
  check(logs.length ? isDeepStrictEqual(metadata.entries, entries) : metadata.entries === undefined || Array.isArray(metadata.entries) && metadata.entries.length === 0, 'LOG_ENTRIES');
  return { count: logs.length, sha256: semantic(logs), ...jsLogMarkers(logs) };
}

export function summarizeJsCall(call) {
  const meta = call.metadata;
  check(meta && typeof call.method === 'string' && Array.isArray(call.params) && statuses.includes(meta.status), 'CALL_SCHEMA');
  const result = { method: call.method, discoveryStep: meta.discoveryStep, status: meta.status, recordPresent: true,
    implementation: 'unknown', paramsSha256: semantic(call.params) };
  if (meta.status === 'not-tested') {
    check(call.params.length === 0 && !Object.hasOwn(call, 'value'), 'SKIPPED_CALL_VALUE');
    if (safeReason(meta.reason)) result.reason = meta.reason;
    return result;
  }
  check(meta.paramsSha256 === semantic(call.params), 'CALL_PARAMETER_HASH');
  const error = safeError(call.error || meta.error);
  if (Object.hasOwn(call, 'value')) {
    const { json, ...observation } = classifyJsResponse(call.method, call.value);
    check(meta.status === observation.status && isDeepStrictEqual(meta.response, observation.response), 'CALL_RESPONSE_METADATA');
    result.status = observation.status; result.response = observation.response;
    if (observation.returnedNull === true) result.returnedNull = true;
    if (observation.implementation === 'unknown-default-compatible') result.implementation = observation.implementation;
    if (call.method === 'playerContent' && json) {
      result.playbackUrlPresent = typeof json.url === 'string' && json.url.trim().length > 0;
      if (Number.isSafeInteger(json.parse)) result.parse = json.parse;
      result.returnedInputIdSame = typeof json.url === 'string' && json.url === call.params[1];
    }
  } else {
    check(error && ['timeout', 'network', 'failed'].includes(meta.status), 'CALL_MISSING_RESULT');
    check(meta.status === (['timeout', 'artifact-timeout'].includes(error.category) ? 'timeout' : error.category === 'network' ? 'network' : 'failed'), 'CALL_FAILURE_STATUS');
  }
  if (error) result.error = error;
  if (Number.isSafeInteger(meta.runtimeGeneration)) result.runtimeGeneration = meta.runtimeGeneration;
  if (Number.isSafeInteger(meta.elapsedMs)) result.elapsedMs = meta.elapsedMs;
  if (meta.logs) result.logs = validateLogs(call.logs, meta.logs);
  return result;
}

function validateContainer(inspectInput, exitCode, imageId, name, index) {
  const inspect = Array.isArray(inspectInput) && inspectInput.length === 1 ? inspectInput[0] : undefined;
  check(inspect?.Image === imageId && imagePattern.test(imageId), 'CONTAINER_IMAGE');
  check(inspect.Config?.User === '10001:10001', 'CONTAINER_USER');
  const stem = 'case-' + String(index).padStart(3, '0');
  const args = ['scripts/container/js-source-probe.mjs', '--plan', `/run/${name}/input-plan.json`, '--input-root', '/input', '--case-index', String(index), '--mode', 'discover',
    ...(name === 'frozen' ? ['--host-binding', '/run/host-binding'] : []), '--output', `/output/${name}/${stem}-private.json`, '--metadata', `/output/${name}/${stem}-metadata.json`];
  check(inspect.Path === 'node' && isDeepStrictEqual(inspect.Args, args), 'CONTAINER_COMMAND');
  check(inspect.State?.Status === 'exited' && inspect.State?.Running === false && Number.isSafeInteger(inspect.State.ExitCode) && inspect.State.ExitCode === exitCode, 'CONTAINER_EXIT');
  check(Array.isArray(inspect.Mounts) && ['/input', '/run', '/opt/tvbox/scripts'].every(path => inspect.Mounts.some(mount => mount.Destination === path && mount.RW === false))
    && inspect.Mounts.some(mount => mount.Destination === '/output' && mount.RW === true), 'CONTAINER_MOUNTS');
  return { imageId, user: '10001:10001', exitCode, exited: true, oomKilled: inspect.State.OOMKilled === true,
    errorPresent: !!inspect.State.Error, ...(hashPattern.test(inspect.Id) ? { id: inspect.Id } : {}) };
}

function validateSourceResult(bundle, metadata, { source, sourceIndex, plan, verified, planSha256, runnerSha256, binding, name }) {
  check(bundle?.schemaVersion === 1 && bundle.manifestSha256 === planSha256 && bundle.runnerSha256 === runnerSha256 && Array.isArray(bundle.cases) && bundle.cases.length === 1, 'BUNDLE_IDENTITY');
  check(isDeepStrictEqual(metadata, { ...bundle, cases: bundle.cases.map(value => value.report) }), 'METADATA_FILE');
  const result = bundle.cases[0], report = result.report, sourceIdentitySha256 = jsSourceIdentity(source);
  check(isDeepStrictEqual(result.input, { source }) && report?.schemaVersion === 1 && report.sourceIndex === sourceIndex && report.manifestSha256 === planSha256 && report.sourceIdentitySha256 === sourceIdentitySha256
    && report.sourceKeySha256 === sha(source.key) && report.apiSha256 === sha(source.api) && report.extSha256 === sha(source.ext) && report.inputSetSha256 === verified.inputSetSha256, 'SOURCE_IDENTITY');
  check(report.nativeBridge === false && report.mode === 'discover' && report.httpMode === (name === 'frozen' ? 'frozen' : 'live') && isDeepStrictEqual(report.budgets, jsProbeBudgets(plan)), 'SOURCE_MODE_BUDGETS');
  check(isDeepStrictEqual(report.modules, verified.moduleMetadata) && isDeepStrictEqual(report.httpFixtures, verified.httpMetadata), 'SOURCE_FROZEN_INPUTS');
  if (name === 'frozen') check(binding && report.hostBinding?.sourceSha256 === binding.sourceSha256 && report.hostBinding?.manifestSha256 === binding.manifestSha256
    && report.hostBinding?.sha256 === binding.sha256 && isDeepStrictEqual(report.hostBinding.classes, binding.classes), 'HOST_BINDING_IDENTITY');
  else check(!report.hostBinding, 'UNEXPECTED_HOST_BINDING');
  check(Array.isArray(result.privateCalls) && result.privateCalls.length === steps.length && Array.isArray(report.calls) && report.calls.length === steps.length, 'METHOD_SLOT_COUNT');
  validateWorkingCalls(result.privateCalls);
  const calls = [];
  for (const [index, call] of result.privateCalls.entries()) {
    const [step, method] = steps[index];
    check(call.method === method && call.metadata.discoveryStep === step && isDeepStrictEqual(call.metadata, report.calls[index]) && call.metadata.sourceIdentitySha256 === sourceIdentitySha256, 'METHOD_SLOT_IDENTITY');
    calls.push(summarizeJsCall(call));
  }
  check(isDeepStrictEqual(report.observations, counts(calls)), 'OBSERVATION_COUNTS');
  check(Array.isArray(report.runtimes) && Array.isArray(result.runtimeInitializationLogs) && result.runtimeInitializationLogs.length === report.runtimes.length, 'RUNTIME_EVIDENCE');
  const runtimes = report.runtimes.map((runtime, index) => {
    check(runtime.generation === index + 1 && ['initial', 'independent-continuation-after-timeout'].includes(runtime.reason) && runtime.cleanup && typeof runtime.cleanup.closed === 'boolean'
      && typeof runtime.cleanup.temporaryDataRemoved === 'boolean' && typeof runtime.cleanup.workerExited === 'boolean', 'RUNTIME_CLEANUP_EVIDENCE');
    const privateLog = result.runtimeInitializationLogs[index];
    check(privateLog.generation === runtime.generation && runtime.init?.attempted === true && typeof runtime.init.ready === 'boolean', 'RUNTIME_INIT_EVIDENCE');
    const logs = validateLogs(privateLog.logs, runtime.init.logs);
    return { generation: runtime.generation, reason: runtime.reason, initReady: runtime.init.ready,
      ...(safeClass(runtime.init.spiderClass) ? { spiderClass: runtime.init.spiderClass } : {}), initLogs: logs,
      cleanup: { closed: runtime.cleanup.closed, workerExited: runtime.cleanup.workerExited, temporaryDataRemoved: runtime.cleanup.temporaryDataRemoved,
        ...(typeof runtime.cleanup.forcedWorkerKill === 'boolean' ? { forcedWorkerKill: runtime.cleanup.forcedWorkerKill } : {}) },
      ...(safeError(runtime.init.error) ? { error: safeError(runtime.init.error) } : {}) };
  });
  const actualGenerations = new Set(runtimes.map(runtime => runtime.generation));
  for (const call of calls) if (call.runtimeGeneration !== undefined) check(actualGenerations.has(call.runtimeGeneration), 'CALL_RUNTIME_GENERATION');
  const cleanup = { closed: runtimes.every(runtime => runtime.cleanup.closed), workerExited: runtimes.every(runtime => runtime.cleanup.workerExited), temporaryDataRemoved: runtimes.every(runtime => runtime.cleanup.temporaryDataRemoved) };
  check(report.cleanup?.closed === cleanup.closed && report.cleanup?.workerExited === cleanup.workerExited && report.cleanup?.temporaryDataRemoved === cleanup.temporaryDataRemoved, 'AGGREGATE_CLEANUP');
  return { calls, runtimes, cleanup, report };
}

const counts = calls => Object.fromEntries(statuses.map(status => [status, calls.filter(call => call.status === status).length]));
function summary(sources) {
  const calls = sources.flatMap(source => source.calls), allLogs = sources.flatMap(source => [...source.calls.flatMap(call => call.logs ? [call.logs] : []), ...source.runtimes.map(runtime => runtime.initLogs)]);
  return { sources: sources.length, present: sources.filter(source => source.present).length, expectedMethodSlots: sources.length * steps.length,
    recordedCalls: calls.filter(call => call.recordPresent).length, methodStatuses: counts(calls),
    initializedSources: sources.filter(source => source.runtimes.some(runtime => runtime.initReady)).length,
    sourcesWithNonemptyResponses: sources.filter(source => source.calls.some(call => call.status === 'nonempty')).length,
    allTenNonemptySingleRuntime: sources.filter(source => source.runtimes.length === 1 && source.calls.every(call => call.status === 'nonempty')).length,
    returnedNulls: calls.filter(call => call.returnedNull).length, independentContinuations: sources.reduce((sum, source) => sum + Math.max(0, source.runtimes.length - 1), 0),
    playerNonemptyReturns: calls.filter(call => call.method === 'playerContent' && call.status === 'nonempty').length,
    playerReturnedInputIds: calls.filter(call => call.method === 'playerContent' && call.returnedInputIdSame === true).length,
    playerParseRequested: calls.filter(call => call.method === 'playerContent' && call.parse === 1).length,
    fixtureHitMarkers: allLogs.reduce((sum, log) => sum + log.fixtureHits, 0), liveHttpMarkers: allLogs.reduce((sum, log) => sum + log.liveHttp, 0),
    cleanupPassed: sources.filter(source => source.present && source.cleanup.closed && source.cleanup.workerExited && source.cleanup.temporaryDataRemoved).length,
    containerZeroExit: sources.filter(source => source.container?.exitCode === 0).length };
}

export function compareJsTrackSources(production, frozen) {
  check(production.sourceIdentitySha256 === frozen.sourceIdentitySha256 && production.sourceIndex === frozen.sourceIndex, 'TRACK_SOURCE_PAIR');
  const calls = steps.map(([discoveryStep, method], index) => {
    const a = production.calls[index], b = frozen.calls[index];
    check(a.discoveryStep === discoveryStep && b.discoveryStep === discoveryStep && a.method === method && b.method === method, 'TRACK_METHOD_PAIR');
    const row = { discoveryStep, method, productionStatus: a.status, frozenStatus: b.status,
      argumentScope: 'Each group independently derived its arguments from its own live responses' };
    if (a.status === 'not-tested' || b.status === 'not-tested') return { ...row, observation: 'not-tested' };
    row.paramsEqual = a.paramsSha256 === b.paramsSha256;
    if (!row.paramsEqual) return { ...row, observation: 'different-derived-params-not-comparable' };
    if (a.response?.sha256 && b.response?.sha256) row.rawEqual = a.response.sha256 === b.response.sha256;
    if (a.response?.semanticSha256 && b.response?.semanticSha256) row.semanticEqual = a.response.semanticSha256 === b.response.semanticSha256;
    row.observation = a.status !== b.status ? 'same-params-status-difference'
      : row.semanticEqual === true ? 'same-params-same-json'
      : row.semanticEqual === false ? 'same-params-live-response-difference'
      : a.status === 'empty' && b.status === 'empty' ? 'same-params-both-empty' : 'same-params-non-json-outcome';
    return row;
  });
  return { sourceIndex: production.sourceIndex, name: production.name, sourceIdentitySha256: production.sourceIdentitySha256, calls };
}

async function jsonFile(path) { const bytes = await readFile(path); return { bytes, value: JSON.parse(bytes) }; }
async function snapshotBinding(directory, sourceSha256) {
  const root = await realpath(directory), manifest = await jsonFile(join(root, 'binding.json')), classes = [];
  check(manifest.value.schemaVersion === 1 && manifest.value.sourceSha256 === sourceSha256 && Array.isArray(manifest.value.files), 'BINDING_MANIFEST');
  async function walk(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      check(!entry.isSymbolicLink(), 'BINDING_SYMLINK');
      const child = join(path, entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (child !== join(root, 'binding.json')) {
        check(entry.isFile() && entry.name.endsWith('.class'), 'BINDING_FILE');
        const bytes = await readFile(child); classes.push({ path: relative(root, child).split(sep).join('/'), sha256: sha(bytes), bytes: bytes.length });
      }
    }
  }
  await walk(root); classes.sort((a, b) => a.path.localeCompare(b.path));
  check(isDeepStrictEqual([...manifest.value.files].sort((a, b) => a.path.localeCompare(b.path)), classes)
    && classes.some(row => row.path === 'tvbox/runtime/HostServices.class'), 'BINDING_CLASS_PINS');
  return { sourceSha256, manifestSha256: sha(manifest.bytes), sha256: semantic(classes), classes, manifest: manifest.value };
}
export async function buildJsSourceReport({ bundleRoot, nasRoot, inputRoot, imageId = 'sha256:808d15d8ac47fed98670eda0e33ffcb00a12b637114690b94536e53e40e447e7', preview = false, generatedAt = new Date().toISOString(), verifyFreeze = true } = {}) {
  const input = await realpath(inputRoot), snapshot = await realpath(bundleRoot), run = await jsonFile(join(nasRoot, 'run-plan.json'));
  const runSnapshot = await readFile(join(snapshot, 'run-plan.json'));
  check(run.bytes.equals(runSnapshot) && run.value.schemaVersion === 1 && run.value.image === imageId && Array.isArray(run.value.sourcePins) && Array.isArray(run.value.plans), 'RUN_PLAN');
  const freeze = await jsonFile(join(input, 'freeze.json'));
  check(run.value.inputFreezeSha256 === sha(freeze.bytes), 'FREEZE_PIN');
  if (verifyFreeze) await verifyJsSourceInputs({ directory: input });
  const pins = new Map();
  for (const pin of run.value.sourcePins) {
    check(typeof pin.file === 'string' && /^scripts\/[a-zA-Z0-9_./-]+$/.test(pin.file) && !pin.file.split('/').includes('..') && !pins.has(pin.file) && hashPattern.test(pin.sha256), 'SOURCE_PIN_SCHEMA');
    const unresolved = join(snapshot, pin.file); check(!(await lstat(unresolved)).isSymbolicLink(), 'SOURCE_PIN_SYMLINK');
    const path = await realpath(unresolved); check(contained(snapshot, path) && sha(await readFile(path)) === pin.sha256, 'SOURCE_PIN_BYTES');
    pins.set(pin.file, pin.sha256);
  }
  const runnerSha256 = pins.get('scripts/container/js-source-probe.mjs');
  check(hashPattern.test(runnerSha256) && pins.has('scripts/compat/js-fixture-host/tvbox/runtime/HostServices.java'), 'REQUIRED_SOURCE_PINS');
  const binding = await snapshotBinding(join(snapshot, 'host-binding'), pins.get('scripts/compat/js-fixture-host/tvbox/runtime/HostServices.java'));
  check(binding.sourceSha256 === pins.get('scripts/compat/js-fixture-host/tvbox/runtime/HostServices.java')
    && isDeepStrictEqual(binding.manifest, run.value.hostBinding), 'RUN_HOST_BINDING');
  const frozenPlanInput = await jsonFile(join(input, 'input-plan.json'));
  const output = { schemaVersion: 1, generatedAt, preview, imageId, runnerSha256, runPlanSha256: sha(run.bytes), inputFreezeSha256: sha(freeze.bytes),
    capturedInputSetSha256: freeze.value.inputSetSha256, originalInputPlanSha256: sha(frozenPlanInput.bytes),
    scope: 'Selected real JS sources and finite observed arguments; no JAR execution, Android parity or all-script compatibility claim',
    playbackScope: 'playerContent return values only. A nonempty returned URL may be the unchanged episode input or a page requiring further parsing; it does not establish resolved media or playback. parse and equality with the input ID are reported without exposing URLs. Media is never downloaded or played.',
    continuationScope: 'After timeout, later derivable methods run in a new source runtime once; mutable state from the previous instance is not restored.',
    logScope: 'Anchored host diagnostic marker observations in captured log snapshots. Repeated or colliding strings may occur; counts are not exact HTTP request counts, a packet trace, or proof against provider-generated log text.',
    inputScope: 'Source key/API/ext unchanged; registered modules frozen in both tracks. Production rule URL and business HTTP live; frozen track uses an explicit test-only host overlay for captured code/rule GETs and leaves business HTTP live.',
    sourcePins: run.value.sourcePins.map(pin => ({ file: pin.file, sha256: pin.sha256 })), tracks: [] };
  for (const name of ['production', 'frozen']) {
    const planInput = await jsonFile(join(snapshot, name, 'input-plan.json')), plan = planInput.value, planSha256 = sha(planInput.bytes);
    const launch = run.value.plans.find(row => row.name === name);
    check(launch?.manifestSha256 === planSha256 && launch.sourceCount === plan.sources?.length, 'PLAN_LAUNCH_PIN');
    const expected = structuredClone(frozenPlanInput.value);
    if (name === 'production') expected.http = { mode: 'live', fixtures: [] };
    check(isDeepStrictEqual(plan, expected), 'PLAN_ORIGINAL_INPUTS');
    const verified = await verifyJsInputs(plan, { inputRoot: input });
    const track = { name, planSha256, executionInputSetSha256: verified.inputSetSha256, usesResearchHostBinding: name === 'frozen', sources: [] };
    for (const [sourceIndex, source] of plan.sources.entries()) {
      const stem = 'case-' + String(sourceIndex).padStart(3, '0'), directory = join(nasRoot, name);
      const evidence = await Promise.all([jsonFile(join(directory, stem + '-private.json')), jsonFile(join(directory, stem + '-metadata.json')), jsonFile(join(directory, stem + '.inspect.json')), readFile(join(directory, stem + '.exit.txt'), 'utf8')])
        .catch(error => { if (preview && error.code === 'ENOENT') return null; throw error; });
      const row = { sourceIndex, name: safeName(source.key), sourceIdentitySha256: jsSourceIdentity(source), sourceKeySha256: sha(source.key), apiSha256: sha(source.api), extSha256: sha(source.ext),
        present: !!evidence, calls: [], runtimes: [], cleanup: {} };
      if (!evidence) row.calls = steps.map(([discoveryStep, method]) => ({ discoveryStep, method, status: 'not-tested', recordPresent: false, reason: 'missing-execution-evidence' }));
      else {
        const [privateInput, metadata, inspect, exitRaw] = evidence, exitText = exitRaw.trim();
        check(/^\d{1,3}$/.test(exitText), 'EXIT_FILE');
        const result = validateSourceResult(privateInput.value, metadata.value, { source, sourceIndex, plan, verified, planSha256, runnerSha256, binding, name });
        row.calls = result.calls; row.runtimes = result.runtimes; row.cleanup = result.cleanup;
        row.container = validateContainer(inspect.value, Number(exitText), imageId, name, sourceIndex);
        row.privateResultSha256 = sha(privateInput.bytes);
        if (safeError(result.report.error)) row.error = safeError(result.report.error);
      }
      track.sources.push(row);
    }
    track.summary = summary(track.sources); output.tracks.push(track);
  }
  output.comparisons = output.tracks[0].sources.map((source, index) => compareJsTrackSources(source, output.tracks[1].sources[index]));
  const comparisons = output.comparisons.flatMap(source => source.calls);
  output.comparisonSummary = { expectedMethodPairs: comparisons.length, sameParams: comparisons.filter(call => call.paramsEqual === true).length,
    differentDerivedParams: comparisons.filter(call => call.paramsEqual === false).length,
    sameParamsSameJson: comparisons.filter(call => call.observation === 'same-params-same-json').length,
    sameParamsLiveResponseDifference: comparisons.filter(call => call.observation === 'same-params-live-response-difference').length,
    notTested: comparisons.filter(call => call.observation === 'not-tested').length };
  output.reporterSha256 = sha(await readFile(SELF));
  return output;
}

export function jsSourceReportMarkdown(report) {
  const localTime = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(report.generatedAt));
  const lines = ['# 真实 JS 源 NAS 业务观察', '', `生成时间：${localTime}（Asia/Shanghai）`, '',
    report.preview ? '**预览：执行证据未齐，缺项全部保持未测试。**' : '以下为固定脚本与有限真实参数的运行记录，不代表所有脚本或全部业务可用。', '',
    '生产宿主组的原规则 URL 与业务 HTTP 在线；冻结组以研究用宿主 overlay 返回捕获代码/规则，业务 HTTP 仍在线。两个组分开统计。', '',
    '`playerContent` 只验证方法返回；非空 URL 可能是原样透传的剧集 ID 或待继续解析的页面，不能据此称为解出媒体或能播放。JS 返回 null、空串、非法 JSON、失败、超时及未测试分别记录。', ''];
  for (const track of report.tracks) {
    const s = track.summary;
    lines.push(`## ${track.name === 'production' ? '生产宿主：规则与业务在线' : '研究宿主：代码/规则冻结，业务在线'}`, '',
      `源 ${s.sources}，实际收齐 ${s.present}；固定步骤 ${s.expectedMethodSlots}，实际记录 ${s.recordedCalls}；获得非空业务响应的源 ${s.sourcesWithNonemptyResponses}。`, '',
      '| 状态 | 次数 |', '| --- | ---: |', ...statuses.map(status => `| ${status} | ${s.methodStatuses[status]} |`), '',
      `null 返回 ${s.returnedNulls}；独立 runtime 续测 ${s.independentContinuations}；十步骤均非空且同一 runtime ${s.allTenNonemptySingleRuntime}；player 非空返回 ${s.playerNonemptyReturns}（原样返回输入 ID ${s.playerReturnedInputIds}，parse=1 ${s.playerParseRequested}）。`, '',
      `清理通过 ${s.cleanupPassed}/${s.sources}；容器零退出 ${s.containerZeroExit}/${s.sources}；fixture 命中诊断标记 ${s.fixtureHitMarkers}，在线 HTTP 诊断标记 ${s.liveHttpMarkers}。`, '');
    for (const source of track.sources) lines.push(`### ${source.name}`, '', `源索引 ${source.sourceIndex}，source identity SHA256：${source.sourceIdentitySha256}。`, '',
      '| 步骤 | 状态 | runtime |', '| --- | --- | ---: |', ...source.calls.map(call => `| ${call.discoveryStep} | ${call.status}${call.returnedNull ? '（null）' : ''}${call.method === 'playerContent' && call.playbackUrlPresent ? `（parse=${call.parse ?? '未声明'}，${call.returnedInputIdSame ? '原样输入 ID' : '返回值异于输入 ID'}）` : ''} | ${call.runtimeGeneration ?? '—'} |`), '');
  }
  lines.push('## 两组观察比较', '', '两组各自从真实响应推导参数。只有参数相同时才比较响应；在线响应差异不直接归因于核心缺陷。', '',
    `方法配对 ${report.comparisonSummary.expectedMethodPairs}；参数相同 ${report.comparisonSummary.sameParams}；参数不同、不可直接比较 ${report.comparisonSummary.differentDerivedParams}；未测试 ${report.comparisonSummary.notTested}。`, '',
    `相同参数且 JSON 语义相同 ${report.comparisonSummary.sameParamsSameJson}；相同参数但在线响应不同 ${report.comparisonSummary.sameParamsLiveResponseDifference}。`, '',
    '日志数字是捕获快照中的诊断标记观察次数，可能重复或碰撞，不是精确 HTTP 请求数。', '');
  return lines.join('\n') + '\n';
}

async function main(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const key = args[index]; if (key === '--preview') { options.preview = true; continue; }
    check(['--bundle-root', '--nas-root', '--input-root', '--output-json', '--output-md', '--image-id'].includes(key) && args[index + 1] && !Object.hasOwn(options, key), 'CLI'); options[key] = args[++index];
  }
  for (const key of ['--bundle-root', '--nas-root', '--input-root', '--output-json', '--output-md']) check(options[key], 'CLI');
  const report = await buildJsSourceReport({ bundleRoot: resolve(options['--bundle-root']), nasRoot: resolve(options['--nas-root']), inputRoot: resolve(options['--input-root']), imageId: options['--image-id'], preview: !!options.preview });
  for (const [path, text] of [[options['--output-json'], JSON.stringify(report, null, 2) + '\n'], [options['--output-md'], jsSourceReportMarkdown(report)]]) {
    await mkdir(dirname(resolve(path)), { recursive: true }); await writeFile(resolve(path), text, { flag: 'wx', mode: 0o600 });
  }
  process.stdout.write(JSON.stringify({ preview: report.preview, tracks: report.tracks.map(track => ({ name: track.name, summary: track.summary })) }) + '\n');
}
if (process.argv[1] && resolve(process.argv[1]) === SELF) main(process.argv.slice(2)).catch(error => { process.stderr.write(JSON.stringify({ code: /^JS_REPORT_[A-Z_]+$/.test(error.message) ? error.message : 'JS_REPORT_INPUT_OR_IO', fingerprint: sha(String(error.message)) }) + '\n'); process.exitCode = 1; });
