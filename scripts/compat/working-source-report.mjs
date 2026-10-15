// SPDX-License-Identifier: GPL-3.0-only
// Compare private ART/NAS records in one Node process; publish only allowlisted metadata.
import { createHash } from 'node:crypto';
import { readFile, mkdir, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { canonical } from '../container/jar-matrix-probe.mjs';
import { classifyBusinessResponse, validateWorkingCalls, workingSourceBudgets } from '../container/working-source-probe.mjs';
import { assertLoaderIdentity, loaderContextOf, officialOracleApkSha256 } from '../android/loader-context.mjs';
import { oracleBudgetsOf, oracleStatePolicyOf } from '../android/run-oracle.mjs';
import { workingSourceScenarioIdentity } from './prepare-working-source-plan.mjs';
import { verifyCatalogFreeze } from './freeze-catalog.mjs';

const SELF = fileURLToPath(import.meta.url);
const sha = value => createHash('sha256').update(value).digest('hex');
const semantic = value => sha(JSON.stringify(canonical(value)));
const hashPattern = /^[a-f0-9]{64}$/;
const imagePattern = /^sha256:[a-f0-9]{64}$/;
const statuses = ['nonempty', 'empty', 'not-implemented', 'invalid-json', 'network', 'failed', 'timeout', 'not-tested'];
const businessSteps = [
  ['home', 'homeContent'], ['home-video', 'homeVideoContent'], ['category-page1', 'categoryContent'],
  ['category-page2', 'categoryContent'], ['category-filter', 'categoryContent'], ['detail', 'detailContent'],
  ['search', 'searchContent'], ['search-page1', 'searchContent'], ['search-detail', 'detailContent'], ['player', 'playerContent'],
];
const safeClass = value => typeof value === 'string' && /^[\w.$]{1,240}$/.test(value) ? value : undefined;
const safeStep = value => typeof value === 'string' && /^[a-zA-Z0-9-]{1,60}$/.test(value) ? value : undefined;
const label = value => {
  const text = String(value ?? '');
  return text.length > 160 || /(?:https?:|:\/\/|[?=&\r\n]|bearer\s|token[:\s])/i.test(text) ? 'sha256:' + sha(text) : text;
};
const apiLabel = value => safeClass(value) || 'sha256:' + sha(String(value));
const check = (condition, reason) => { if (!condition) throw Object.assign(new Error('WORKING_REPORT_' + reason), { code: 'INPUT_CHECKSUM' }); };
const contained = (root, path) => { const rel = relative(root, path); return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep); };
const count = rows => Object.fromEntries(statuses.map(status => [status, rows.filter(row => row.status === status).length]));

function safeError(error) {
  if (!error) return undefined;
  const result = {};
  const type = safeClass(error.type) || safeClass(error.errorType) || safeClass(error.name);
  if (type) result.type = type;
  if (hashPattern.test(error.fingerprint)) result.fingerprint = error.fingerprint;
  if (['execution', 'artifact-timeout', 'timeout', 'invalid-json', 'missing-class-or-member', 'native-binding', 'network', 'invalid-result', 'input', 'environment', 'spider-not-ready'].includes(error.category)) result.category = error.category;
  else result.category = /Timeout/.test(type || '') ? 'timeout' : /UnknownHost|ConnectException|SSL|Socket/.test(type || '') ? 'network' : 'execution';
  if (safeStep(error.stage)) result.stage = error.stage;
  return result;
}

function methodProvenance(metadata) {
  const value = metadata?.methodProvenance;
  if (!value) return undefined;
  const result = {};
  for (const key of ['declaringClass', 'baseSpiderClass']) if (safeClass(value[key])) result[key] = value[key];
  for (const key of ['inheritedBaseDefault', 'baseDelegatingOverload']) if (typeof value[key] === 'boolean') result[key] = value[key];
  return Object.keys(result).length ? result : undefined;
}

/** Producer semantic hashes are never compared across Java and JavaScript. */
export function summarizeWorkingCall(call, host) {
  check(call && Array.isArray(call.params) && typeof call.method === 'string', 'CALL_SCHEMA');
  const meta = call.metadata || {}, result = { method: call.method, paramsSha256: semantic(call.params) };
  if (safeStep(meta.discoveryStep || call.slot)) result.discoveryStep = meta.discoveryStep || call.slot;
  const provenance = host === 'ART' ? methodProvenance(meta) : undefined;
  if (provenance) result.methodProvenance = provenance;
  if (meta.status === 'not-tested') return { ...result, status: 'not-tested', ...(safeStep(meta.reason) ? { reason: meta.reason } : {}) };
  const error = safeError(call.error || meta.error);
  if (error) {
    if (error.category === 'invalid-json' && typeof call.value === 'string') {
      const observed = classifyBusinessResponse(call.method, call.value);
      check(observed.status === 'invalid-json', 'INVALID_JSON_ERROR_RESPONSE');
      return { ...result, status: 'invalid-json', error, response: observed.response };
    }
    const status = ['timeout', 'artifact-timeout'].includes(error.category) ? 'timeout' : error.category === 'network' ? 'network' : error.category === 'invalid-json' ? 'invalid-json' : meta.status === 'not-implemented' ? 'not-implemented' : 'failed';
    return { ...result, status, error };
  }
  check(typeof call.value === 'string', 'CALL_RESPONSE_MISSING');
  const observed = classifyBusinessResponse(call.method, call.value);
  result.status = observed.status;
  result.response = observed.response;
  if (host === 'ART' && provenance?.inheritedBaseDefault === true) {
    check(provenance.declaringClass === provenance.baseSpiderClass && provenance.baseSpiderClass && !provenance.baseDelegatingOverload, 'ART_DEFAULT_PROVENANCE');
    result.status = 'not-implemented';
  }
  if (observed.implementation === 'unknown-default-compatible') result.implementation = 'unknown-default-compatible';
  if (call.method === 'playerContent' && observed.json) result.playbackUrlPresent = typeof observed.json.url === 'string' && observed.json.url.trim().length > 0;
  return result;
}

function verifyRawCalls(value, host) {
  check(Array.isArray(value.privateCalls) && Array.isArray(value.report.calls) && value.privateCalls.length === value.report.calls.length && value.privateCalls.length <= 20, host + '_CALLS');
  validateWorkingCalls(value.privateCalls);
  for (const [index, call] of value.privateCalls.entries()) {
    check(isDeepStrictEqual(call.metadata, value.report.calls[index]), host + '_CALL_METADATA');
    if (call.metadata.response) {
      check(typeof call.value === 'string' && call.metadata.response.sha256 === sha(call.value)
        && call.metadata.response.bytes === Buffer.byteLength(call.value), host + '_RESPONSE_HASH');
    }
  }
}

function validateArt(entry, result, collection, privateBytes, track) {
  const { artifact, site, artifactIndex, siteIndex, caseId } = entry, meta = result.report;
  check(meta && meta.schemaVersion === 1 && meta.manifestSha256 === track.planSha256 && meta.artifactIndex === artifactIndex && meta.siteIndex === siteIndex
    && meta.jarSha256 === artifact.sha256 && meta.extSha256 === sha(site.ext) && meta.id === label(artifact.id) && meta.api === label(site.api) && meta.siteKey === label(site.key), 'ART_IDENTITY');
  assertLoaderIdentity(meta, artifact, site);
  check(meta.targetApkSha256 === officialOracleApkSha256 && hashPattern.test(meta.symbolMapSha256), 'ART_APK_MAP');
  check(isDeepStrictEqual(meta.budgets, oracleBudgetsOf(track.plan)) && meta.applicationStatePolicy === oracleStatePolicyOf(track.plan), 'ART_BUDGET_STATE');
  check(collection && collection.id === caseId && collection.privateResultPulled === true && collection.privateResultSha256 === sha(privateBytes)
    && collection.privateResultBytes === privateBytes.length && isDeepStrictEqual(collection.report, meta), 'ART_COLLECTION_HASH');
  check(collection.adbExit === 0 && collection.transportTimeout === false && Number.isSafeInteger(collection.instrumentationCode), 'ART_COLLECTION_TRANSPORT');
  verifyRawCalls(result, 'ART');
}

function verifyContainer(inspectInput, exitCode, imageId, { name, flatIndex, base }) {
  const inspect = Array.isArray(inspectInput) ? inspectInput.length === 1 ? inspectInput[0] : undefined : inspectInput;
  check(inspect && imagePattern.test(imageId) && inspect.Image === imageId, 'DOCKER_IMAGE');
  check(['10001', '10001:10001'].includes(inspect.Config?.User), 'DOCKER_USER');
  check(inspect.State?.Running === false && inspect.State?.Status === 'exited' && Number.isSafeInteger(inspect.State.ExitCode) && inspect.State.ExitCode === exitCode, 'DOCKER_EXIT');
  const expectedArgs = ['scripts/container/working-source-probe.mjs', '--plan', `/run/${name}/oracle-plan.json`, '--calls-dir', `/run/${name}/art-results`, '--mode', 'replay', '--input-root', '/input', '--case-index', String(flatIndex), '--output', `/output/${base}-private.json`, '--metadata', `/output/${base}-metadata.json`];
  check(inspect.Path === 'node' && isDeepStrictEqual(inspect.Args, expectedArgs), 'DOCKER_COMMAND');
  check(Array.isArray(inspect.Mounts) && ['/input', '/run', '/opt/tvbox/scripts'].every(destination => inspect.Mounts.some(mount => mount.Destination === destination && mount.RW === false))
    && inspect.Mounts.some(mount => mount.Destination === '/output' && mount.RW === true), 'DOCKER_MOUNTS');
  return { imageId, user: inspect.Config.User, running: false, status: 'exited', exitCode,
    oomKilled: inspect.State.OOMKilled === true, errorPresent: typeof inspect.State.Error === 'string' && inspect.State.Error.length > 0,
    ...(typeof inspect.Id === 'string' && /^[a-f0-9]{64}$/.test(inspect.Id) ? { containerId: inspect.Id } : {}) };
}

function validateNas(entry, bundle, metadata, inspect, exitCode, track, expectedRunnerSha256, imageId, launch) {
  check(bundle?.schemaVersion === 1 && bundle.manifestSha256 === track.planSha256 && bundle.runnerSha256 === expectedRunnerSha256 && Array.isArray(bundle.cases) && bundle.cases.length === 1, 'NAS_BUNDLE');
  check(isDeepStrictEqual(metadata, { ...bundle, cases: bundle.cases.map(row => row.report) }), 'NAS_METADATA_FILE');
  const value = bundle.cases[0], meta = value.report;
  check(isDeepStrictEqual(value.input, { artifact: entry.artifact, site: entry.site }), 'NAS_RAW_INPUT');
  const { artifact, site, artifactIndex, siteIndex, caseId } = entry;
  check(meta && meta.schemaVersion === 1 && meta.caseId === caseId && meta.artifactIndex === artifactIndex && meta.siteIndex === siteIndex && meta.manifestSha256 === track.planSha256
    && meta.jarSha256 === artifact.sha256 && meta.extSha256 === sha(site.ext) && meta.api === apiLabel(site.api) && meta.siteKeySha256 === sha(site.key)
    && meta.caseIdentitySha256 === site.caseIdentitySha256 && meta.sourceScenarioSha256 === site.sourceScenarioSha256, 'NAS_IDENTITY');
  assertLoaderIdentity(meta, artifact, site);
  check(meta.mode === 'replay' && meta.parameterSource === 'exact-art-replay' && meta.targetApkSha256 === officialOracleApkSha256 && hashPattern.test(meta.artSymbolMapSha256), 'NAS_REPLAY_PROVENANCE');
  check(meta.initPolicy === 'android' && meta.applicationStatePolicy === 'fresh-runtime-data'
    && isDeepStrictEqual(meta.budgets, workingSourceBudgets(track.plan)), 'NAS_BUDGET_STATE');
  check(meta.standaloneDiagnostic === (track.diagnostic ? true : undefined), 'NAS_DIAGNOSTIC_SCOPE');
  verifyRawCalls(value, 'NAS');
  const container = verifyContainer(inspect, exitCode, imageId, launch);
  check(meta.cleanup && typeof meta.cleanup.closed === 'boolean' && typeof meta.cleanup.temporaryDataRemoved === 'boolean', 'NAS_CLEANUP_MISSING');
  return { value, container };
}

function hostState(meta, host) {
  const error = safeError(meta?.error);
  const load = meta?.loadSuccess === true ? 'loaded' : meta?.loadSuccess === false ? 'failed'
    : ['timeout', 'artifact-timeout'].includes(error?.category) ? 'timeout' : meta?.mainLoad?.loaded === false ? 'main-failed' : 'not-tested';
  const init = meta?.initSuccess === true ? 'ready' : meta?.initSuccess === false || error?.stage === 'init' && error.category === 'spider-not-ready' ? 'failed'
    : ['timeout', 'artifact-timeout'].includes(error?.category) ? 'timeout' : 'not-tested';
  const state = { present: !!meta, load, init, ...(safeClass(meta?.spiderClass) ? { spiderClass: meta.spiderClass } : {}), ...(error ? { error } : {}) };
  if (host === 'NAS' && meta) {
    state.cleanup = {};
    for (const key of ['closed', 'workerExited', 'temporaryDataRemoved', 'forcedWorkerKill']) if (typeof meta.cleanup?.[key] === 'boolean') state.cleanup[key] = meta.cleanup[key];
    state.cleanupPassed = meta.cleanup?.closed === true && meta.cleanup?.temporaryDataRemoved === true && meta.cleanup?.workerExited !== false;
    if (Number.isSafeInteger(meta.selectedLoad?.loaderCount)) state.loaderCount = meta.selectedLoad.loaderCount;
    if (Number.isSafeInteger(meta.selectedLoad?.expectedLoaderCount)) state.expectedLoaderCount = meta.selectedLoad.expectedLoaderCount;
  }
  return state;
}

export function compareWorkingSourceCase(entry, art, nas, { container, artPrivateSha256, nasPrivateSha256, expectedSteps } = {}) {
  const { site, artifact, caseId, sourceScenarioSha256 } = entry;
  const row = { caseId, jarSha256: artifact.sha256, sourceScenarioSha256: sourceScenarioSha256 || site.sourceScenarioSha256,
    api: apiLabel(site.api), sourceKeySha256: sha(site.key), extSha256: sha(site.ext), ...loaderContextOf(artifact, site).identity,
    art: hostState(art?.report, 'ART'), nas: hostState(nas?.report, 'NAS'), calls: [],
    ...(container ? { container } : {}), ...(artPrivateSha256 ? { artPrivateSha256 } : {}), ...(nasPrivateSha256 ? { nasPrivateSha256 } : {}) };
  const skipped = (method, step, reason) => ({ method, ...(step ? { discoveryStep: step } : {}), status: 'not-tested', recordPresent: false, reason });
  if (art && nas) {
    check(art.report.symbolMapSha256 === nas.report.artSymbolMapSha256, 'PAIRED_ART_SYMBOL_MAP');
    check(nas.privateCalls.length === art.privateCalls.length, 'PAIRED_CALL_COUNT');
  }
  for (const [index, artCall] of (art?.privateCalls || []).entries()) {
    const nasCall = nas?.privateCalls[index];
    if (!nasCall) {
      const a = { ...summarizeWorkingCall(artCall, 'ART'), recordPresent: true };
      row.calls.push({ index, method: artCall.method, ...(a.discoveryStep ? { discoveryStep: a.discoveryStep } : {}),
        artParamsSha256: semantic(artCall.params), parametersReplayed: false, art: a, nas: skipped(artCall.method, a.discoveryStep, 'missing-nas-evidence'), observation: 'not-tested' });
      continue;
    }
    check(nasCall.method === artCall.method, 'PAIRED_METHOD');
    const a = { ...summarizeWorkingCall(artCall, 'ART'), recordPresent: true }, b = { ...summarizeWorkingCall(nasCall, 'NAS'), recordPresent: true };
    const attempted = b.status !== 'not-tested';
    if (attempted) check(isDeepStrictEqual(canonical(artCall.params), canonical(nasCall.params)), 'PAIRED_PARAMS');
    else check(nasCall.params.length === 0 || isDeepStrictEqual(canonical(artCall.params), canonical(nasCall.params)), 'PAIRED_SKIPPED_PARAMS');
    if (a.discoveryStep && b.discoveryStep) check(a.discoveryStep === b.discoveryStep, 'PAIRED_STEP');
    const call = { index, method: artCall.method, ...(a.discoveryStep ? { discoveryStep: a.discoveryStep } : {}), artParamsSha256: semantic(artCall.params),
      parametersReplayed: attempted, ...(attempted ? { nasParamsSha256: semantic(nasCall.params), paramsEqual: true } : {}), art: a, nas: b };
    if (a.response && b.response) {
      call.rawEqual = a.response.sha256 === b.response.sha256;
      if (a.response.semanticSha256 && b.response.semanticSha256) call.semanticEqual = a.response.semanticSha256 === b.response.semanticSha256;
    }
    call.observation = a.status === 'not-tested' || b.status === 'not-tested' ? 'not-tested'
      : a.status === 'not-implemented' || b.status === 'not-implemented' ? 'method-not-implemented'
      : a.status === 'nonempty' && b.status === 'nonempty' ? call.semanticEqual ? 'same-nonempty-json' : 'live-nonempty-response-difference'
      : a.status === 'empty' && b.status === 'empty' ? 'both-empty'
      : a.status === b.status ? 'same-failure-status' : 'status-difference';
    row.calls.push(call);
  }
  if (expectedSteps) {
    const byStep = new Map();
    for (const call of row.calls) {
      check(expectedSteps.some(([step, method]) => step === call.discoveryStep && method === call.method) && !byStep.has(call.discoveryStep), 'BUSINESS_STEP_ORDER');
      byStep.set(call.discoveryStep, call);
    }
    const artTimedOut = art?.report.timedOut === true || art?.privateCalls.some(call => call.metadata?.status === 'timeout');
    row.calls = expectedSteps.map(([step, method], index) => byStep.get(step) || {
      index, method, discoveryStep: step, parametersReplayed: false, reconstructedUnreachedSlot: true,
      art: skipped(method, step, artTimedOut ? 'art-timeout-blocked' : art ? 'art-method-not-reached' : 'missing-art-evidence'),
      nas: skipped(method, step, 'no-art-call-to-replay'), observation: 'not-tested',
    });
  }
  row.observation = !art || !nas ? 'missing-evidence' : row.nas.init !== 'ready' ? 'nas-not-ready' : row.calls.some(call => call.nas.status === 'nonempty') ? 'some-business-methods-nonempty' : 'no-nonempty-business-observation';
  return row;
}

function trackSummary(cases) {
  const artCalls = cases.flatMap(row => row.calls.map(call => call.art)), nasCalls = cases.flatMap(row => row.calls.map(call => call.nas));
  return { cases: cases.length, jars: new Set(cases.map(row => row.jarSha256)).size,
    artPresent: cases.filter(row => row.art.present).length, nasPresent: cases.filter(row => row.nas.present).length,
    artLoaded: cases.filter(row => row.art.load === 'loaded').length, nasLoaded: cases.filter(row => row.nas.load === 'loaded').length,
    artReady: cases.filter(row => row.art.init === 'ready').length, nasReady: cases.filter(row => row.nas.init === 'ready').length,
    nasCleanupPassed: cases.filter(row => row.nas.cleanupPassed).length,
    containersExitZero: cases.filter(row => row.container?.exitCode === 0).length,
    casesWithNonemptyNAS: cases.filter(row => row.calls.some(call => call.nas.status === 'nonempty')).length,
    expectedMethodSlots: cases.reduce((sum, row) => sum + row.calls.length, 0),
    artRecordedCalls: artCalls.filter(call => call.recordPresent).length, nasRecordedCalls: nasCalls.filter(call => call.recordPresent).length,
    artUnreachedSlots: artCalls.filter(call => !call.recordPresent).length, nasUnreachedSlots: nasCalls.filter(call => !call.recordPresent).length,
    artCalls: count(artCalls), nasCalls: count(nasCalls),
    parametersReplayed: cases.reduce((sum, row) => sum + row.calls.filter(call => call.parametersReplayed).length, 0),
    sameNonemptyJSON: cases.reduce((sum, row) => sum + row.calls.filter(call => call.observation === 'same-nonempty-json').length, 0),
    playerNonemptyNAS: nasCalls.filter(call => call.method === 'playerContent' && call.status === 'nonempty').length };
}

async function jsonFile(path) { const bytes = await readFile(path); return { bytes, value: JSON.parse(bytes) }; }
async function checkedInput(input, root, cache) {
  check(hashPattern.test(input.sha256) && typeof input.jarPath === 'string', 'INPUT_JAR_SCHEMA');
  const path = await realpath(resolve(root, input.jarPath));
  check(contained(root, path), 'INPUT_JAR_PATH');
  if (cache.has(input.sha256)) return cache.get(input.sha256);
  const info = await stat(path), bytes = await readFile(path);
  check(info.isFile() && bytes.length > 0 && bytes.length <= 128 * 1024 * 1024 && sha(bytes) === input.sha256, 'INPUT_JAR_HASH');
  const value = { sha256: input.sha256, bytes: bytes.length };
  cache.set(input.sha256, value); return value;
}

/** Strict final reports require all expected private records and container evidence. */
export async function buildWorkingSourceReport({ plansRoot, artRoot, nasRoot, inputRoot, imageId, runnerSha256, preview = false,
  tracks = ['original', 'standalone'], generatedAt = new Date().toISOString(), verifyFreeze = true,
  sourceRoot = resolve(dirname(SELF), '../..') } = {}) {
  check(imagePattern.test(imageId) && hashPattern.test(runnerSha256), 'EXECUTION_PINS');
  const runInput = await jsonFile(join(nasRoot, 'run-plan.json')), runPlan = runInput.value;
  check(runPlan.schemaVersion === 1 && runPlan.image === imageId && Array.isArray(runPlan.sourcePins) && Array.isArray(runPlan.plans), 'RUN_PLAN');
  const sourceMap = new Map();
  for (const pin of runPlan.sourcePins) {
    check(typeof pin.file === 'string' && /^scripts\/[a-zA-Z0-9_./-]+$/.test(pin.file) && !pin.file.split('/').includes('..') && hashPattern.test(pin.sha256) && !sourceMap.has(pin.file), 'SOURCE_PIN');
    check(sha(await readFile(resolve(sourceRoot, pin.file))) === pin.sha256, 'SOURCE_PIN_BYTES');
    sourceMap.set(pin.file, pin.sha256);
  }
  check(sourceMap.get('scripts/container/working-source-probe.mjs') === runnerSha256 && sourceMap.has('scripts/compat/prepare-working-source-plan.mjs')
    && sourceMap.has('scripts/android/loader-context.mjs') && sourceMap.has('scripts/android/run-oracle.mjs'), 'SOURCE_REQUIRED_PINS');
  const root = await realpath(inputRoot), freezeInput = await jsonFile(join(root, 'freeze.json'));
  if (verifyFreeze) await verifyCatalogFreeze({ directory: root });
  const freeze = freezeInput.value, inputCache = new Map(), result = { schemaVersion: 1, generatedAt, preview,
    scope: 'All selected configured source scenarios; original main/site coexistence and standalone missing-main diagnostics remain separate',
    businessScope: 'Observed method responses only; pages, filters, search terms and details outside these sampled arguments are untested',
    playerScope: 'playerContent return values only; nonempty URL presence does not prove playable media; no download, decoder, renderer or playback was tested',
    hashScope: 'Raw response and parameter hashes, and JSON semantic hashes, recomputed from private records in this one Node implementation',
    responseScope: 'Live network observations; response differences do not by themselves establish runtime defects',
    defaultScope: 'ART declaring-class reflection identifies inherited defaults; NAS empty default-shaped responses retain unknown implementation',
    imageId, nasRunnerSha256: runnerSha256, inputSetSha256: freeze.inputSetSha256, freezeSha256: sha(freezeInput.bytes),
    runPlanSha256: sha(runInput.bytes), sourcePins: runPlan.sourcePins.map(pin => ({ file: pin.file, sha256: pin.sha256 })), tracks: [] };
  for (const name of tracks) {
    check(['original', 'standalone'].includes(name), 'TRACK');
    const planInput = await jsonFile(join(plansRoot, name, 'oracle-plan.json')), plan = planInput.value, planSha256 = sha(planInput.bytes);
    check(plan.schemaVersion === 1 && Array.isArray(plan.artifacts) && plan.metadata?.sourceInputSetSha256 === freeze.inputSetSha256, 'PLAN_FREEZE');
    const diagnostic = name === 'standalone';
    check((plan.standaloneDiagnostic === true) === diagnostic, 'PLAN_SCOPE');
    const launchPlan = runPlan.plans.find(row => row.mode === name);
    check(launchPlan?.manifestSha256 === planSha256 && Array.isArray(launchPlan.cases)
      && isDeepStrictEqual(runPlan.budgets, Object.fromEntries(['caseMs', 'loadMs', 'initMs', 'callMs'].map(key => [key, workingSourceBudgets(plan)[key]]))), 'RUN_PLAN_MANIFEST_BUDGET');
    const collectionInput = await jsonFile(join(artRoot, name + '-results', 'summary-private.json')), collection = collectionInput.value;
    check(collection.manifestSha256 === planSha256 && collection.runnerSha256 === sourceMap.get('scripts/android/run-oracle.mjs') && Array.isArray(collection.cases)
      && isDeepStrictEqual(collection.budgets, oracleBudgetsOf(plan)) && collection.applicationStatePolicy === oracleStatePolicyOf(plan), 'ART_COLLECTION_PLAN');
    const track = { name, diagnostic, planSha256, plan, artCollectionSha256: sha(collectionInput.bytes), artCollectorRunnerSha256: collection.runnerSha256,
      cases: [], unexecuted: [] };
    let flatIndex = 0;
    for (const [artifactIndex, artifact] of plan.artifacts.entries()) for (const [siteIndex, site] of artifact.sites.entries()) {
      const caseId = `${artifactIndex}-${siteIndex}`, entry = { artifact, site, artifactIndex, siteIndex, caseId };
      const originalBinding = freeze.bindings.find(binding => binding.id === site.bindingId);
      const scenario = workingSourceScenarioIdentity(artifact, site, { originalBinding });
      check(scenario === site.sourceScenarioSha256 && scenario === site.caseIdentitySha256 && site.extSha256 === sha(site.ext), 'PLAN_SCENARIO');
      entry.sourceScenarioSha256 = scenario;
      await checkedInput(artifact, root, inputCache);
      const context = loaderContextOf(artifact, site);
      if (context.main) await checkedInput(context.main, root, inputCache);
      const artPath = join(artRoot, name + '-results', caseId + '-private.json');
      const caseFlatIndex = flatIndex++, base = 'case-' + String(caseFlatIndex).padStart(3, '0');
      check(isDeepStrictEqual(launchPlan.cases[caseFlatIndex], { index: caseFlatIndex, caseId, artifactIndex, siteIndex, sha256: artifact.sha256, sourceScenarioSha256: scenario }), 'RUN_PLAN_CASE');
      const nasDirectory = join(nasRoot, name), nasPath = join(nasDirectory, base + '-private.json');
      const artInput = await jsonFile(artPath).catch(error => { if (preview && error.code === 'ENOENT') return null; throw error; });
      const nasInput = await jsonFile(nasPath).catch(error => { if (preview && error.code === 'ENOENT') return null; throw error; });
      if (artInput) validateArt(entry, artInput.value, collection.cases.find(row => row.id === caseId), artInput.bytes, track);
      let nas;
      if (nasInput) {
        const evidence = await Promise.all([
          jsonFile(join(nasDirectory, base + '-metadata.json')), jsonFile(join(nasDirectory, base + '.inspect.json')),
          readFile(join(nasDirectory, base + '.exit.txt'), 'utf8'),
        ]).catch(error => { if (preview && error.code === 'ENOENT') return null; throw error; });
        if (evidence) {
          const [metadataInput, inspectInput, exitRaw] = evidence, exitText = exitRaw.trim();
          check(/^\d{1,3}$/.test(exitText), 'DOCKER_EXIT_FILE');
          nas = validateNas(entry, nasInput.value, metadataInput.value, inspectInput.value, Number(exitText), track, runnerSha256, imageId, { name, flatIndex: caseFlatIndex, base });
        }
      }
      const row = compareWorkingSourceCase(entry, artInput?.value, nas?.value, { container: nas?.container,
        expectedSteps: plan.businessDiscovery === true ? businessSteps : undefined,
        ...(artInput ? { artPrivateSha256: sha(artInput.bytes) } : {}), ...(nasInput ? { nasPrivateSha256: sha(nasInput.bytes) } : {}) });
      if (diagnostic && hashPattern.test(site.originalMissingContextSha256)) row.originalMissingContextSha256 = site.originalMissingContextSha256;
      track.cases.push(row);
    }
    check(preview || collection.cases.length === track.cases.length, 'ART_COLLECTION_CASE_COUNT');
    check(launchPlan.cases.length === track.cases.length, 'RUN_PLAN_CASE_COUNT');
    track.unexecuted = (plan.unexecuted || []).map(row => ({ jarSha256: row.sha256,
      ...(hashPattern.test(row.bindingId) ? { bindingId: row.bindingId } : {}), ...(safeStep(row.reason) ? { reason: row.reason } : {}),
      ...(hashPattern.test(row.configSha256) ? { configSha256: row.configSha256 } : {}) }));
    track.summary = trackSummary(track.cases);
    track.jars = [...new Set(track.cases.map(row => row.jarSha256))].map(jarSha256 => {
      const cases = track.cases.filter(row => row.jarSha256 === jarSha256);
      return { jarSha256, summary: trackSummary(cases), cases };
    });
    delete track.plan; delete track.cases;
    result.tracks.push(track);
  }
  result.inputs = [...inputCache.values()];
  result.reporterSha256 = sha(await readFile(SELF));
  return result;
}

export function workingSourceMarkdown(report) {
  const lines = ['# 已跑通 JAR 的配置入口业务复测', '', `生成时间：${report.generatedAt}`, '',
    report.preview ? '**预览：证据尚未收齐，不能作为最终业务验收。**' : '本报告验证已选 JAR 的全部已配置入口；每个入口只覆盖实际记录的有限业务参数。', '',
    '播放解析仅检查 `playerContent` 返回，不下载或播放媒体。非空 URL 不等于可播放。ART 基类默认方法、合法空响应、失败和未测试分别统计。', ''];
  for (const track of report.tracks) {
    const summary = track.summary;
    lines.push(`## ${track.diagnostic ? '缺原主包的独立诊断（不能回填原订阅兼容）' : '原始主包与站点包场景'}`, '',
      `配置场景 ${summary.cases}；ART ready ${summary.artReady}；NAS ready ${summary.nasReady}；NAS 有非空业务响应的场景 ${summary.casesWithNonemptyNAS}。`, '',
      `固定步骤槽位 ${summary.expectedMethodSlots}；ART 实际记录 ${summary.artRecordedCalls}、未到达 ${summary.artUnreachedSlots}；NAS 实际记录 ${summary.nasRecordedCalls}、未到达 ${summary.nasUnreachedSlots}。未到达仍计入 not-tested。`, '',
      '| 方法结果 | ART | NAS |', '| --- | ---: | ---: |',
      ...statuses.map(status => `| ${status} | ${summary.artCalls[status]} | ${summary.nasCalls[status]} |`), '',
      `NAS 清理检查通过 ${summary.nasCleanupPassed}/${summary.cases}；容器零退出 ${summary.containersExitZero}/${summary.cases}；实际原参数重放 ${summary.parametersReplayed} 次。`, '',
      '| JAR SHA256 | 配置场景 | NAS ready | 非空响应场景 |', '| --- | ---: | ---: | ---: |',
      ...track.jars.map(jar => `| ${jar.jarSha256} | ${jar.summary.cases} | ${jar.summary.nasReady} | ${jar.summary.casesWithNonemptyNAS} |`), '');
    if (track.unexecuted.length) lines.push(`原始场景未执行 binding：${track.unexecuted.length}。缺原主包的独立诊断不改变这些未执行记录。`, '');
    for (const jar of track.jars) for (const row of jar.cases) {
      lines.push(`### ${row.caseId} · ${row.api}`, '', `JAR：${row.jarSha256}；source key SHA256：${row.sourceKeySha256}。ART ${row.art.init}；NAS ${row.nas.init}。`, '',
        '| 步骤 | ART | NAS | 比较 |', '| --- | --- | --- | --- |',
        ...row.calls.map(call => `| ${call.discoveryStep || call.method} | ${call.art.status} | ${call.nas.status} | ${call.observation} |`), '');
    }
  }
  return lines.join('\n') + '\n';
}

async function main(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const name = args[index];
    if (name === '--preview') { options.preview = true; continue; }
    check(['--plans-root', '--art-root', '--nas-root', '--input-root', '--output-json', '--output-md', '--image-id', '--runner-sha256'].includes(name) && args[index + 1] && !Object.hasOwn(options, name), 'CLI');
    options[name] = args[++index];
  }
  for (const key of ['--plans-root', '--art-root', '--nas-root', '--input-root', '--output-json', '--output-md', '--image-id', '--runner-sha256']) check(options[key], 'CLI');
  const report = await buildWorkingSourceReport({ plansRoot: resolve(options['--plans-root']), artRoot: resolve(options['--art-root']), nasRoot: resolve(options['--nas-root']), inputRoot: resolve(options['--input-root']),
    imageId: options['--image-id'], runnerSha256: options['--runner-sha256'], preview: !!options.preview });
  for (const [path, value] of [[options['--output-json'], JSON.stringify(report, null, 2) + '\n'], [options['--output-md'], workingSourceMarkdown(report)]]) {
    await mkdir(dirname(resolve(path)), { recursive: true }); await writeFile(resolve(path), value, { flag: 'wx', mode: 0o600 });
  }
  process.stdout.write(JSON.stringify({ preview: report.preview, tracks: report.tracks.map(track => ({ name: track.name, summary: track.summary })) }) + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === SELF) main(process.argv.slice(2)).catch(error => { process.stderr.write(JSON.stringify({ code: /^WORKING_REPORT_[A-Z_]+$/.test(error.message) ? error.message : 'WORKING_REPORT_INPUT_OR_IO', fingerprint: sha(String(error.message)) }) + '\n'); process.exitCode = 1; });
