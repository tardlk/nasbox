// SPDX-License-Identifier: GPL-3.0-only
// Offline method-isolated followups from byte-bound original ART observations.
import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { assertLoaderIdentity, loaderContextOf, officialOracleApkSha256 } from '../android/loader-context.mjs';

const SELF = fileURLToPath(import.meta.url);
const sha = value => createHash('sha256').update(value).digest('hex');
const hashPattern = /^[a-f0-9]{64}$/;
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const identity = value => sha(JSON.stringify(canonical(value)));
const check = (condition, reason) => { if (!condition) throw new Error('WORKING_FOLLOWUP_' + reason); };
const contained = (root, path) => { const rel = relative(root, path); return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep); };
const label = value => {
  const text = String(value ?? '');
  return text.length > 160 || /(?:https?:|:\/\/|[?=&\r\n]|bearer\s|token[:\s])/i.test(text) ? 'sha256:' + sha(text) : text;
};
const validId = value => ['string', 'number'].includes(typeof value) && String(value).length > 0;
const object = call => { try { const value = JSON.parse(call?.value); return value && typeof value === 'object' && !Array.isArray(value) ? value : null; } catch { return null; } };
const firstVideo = (...responses) => responses.flatMap(value => Array.isArray(value?.list) ? value.list : []).find(value => value && validId(value.vod_id));

export const workingFollowupSlots = Object.freeze([
  ['home', 'homeContent'], ['home-video', 'homeVideoContent'],
  ['category-page1', 'categoryContent'], ['category-page2', 'categoryContent'], ['category-filter', 'categoryContent'],
  ['detail', 'detailContent'], ['search', 'searchContent'], ['search-page1', 'searchContent'],
  ['search-detail', 'detailContent'], ['player', 'playerContent'],
]);
const methodBySlot = new Map(workingFollowupSlots), methods = new Set(workingFollowupSlots.map(([, method]) => method));

function validateParent(plan, entry, result, manifestSha256) {
  const { artifact, site, artifactIndex, siteIndex } = entry, meta = result?.report;
  check(meta?.schemaVersion === 1 && meta.artifactIndex === artifactIndex && meta.siteIndex === siteIndex
    && meta.manifestSha256 === manifestSha256 && meta.jarSha256 === artifact.sha256
    && meta.extSha256 === sha(site.ext) && meta.id === label(artifact.id) && meta.api === label(site.api)
    && meta.siteKey === label(site.key), 'PARENT_IDENTITY');
  const context = assertLoaderIdentity(meta, artifact, site);
  check(context.legacy || meta.targetApkSha256 === officialOracleApkSha256 && hashPattern.test(meta.symbolMapSha256), 'PARENT_APK_IDENTITY');
  check(Array.isArray(result.privateCalls) && result.privateCalls.length <= 20 && Array.isArray(meta.calls)
    && meta.calls.length === result.privateCalls.length, 'PARENT_CALLS');
  const calls = new Map();
  for (const [index, call] of result.privateCalls.entries()) {
    const step = call.metadata?.discoveryStep;
    check(methods.has(call.method) && Array.isArray(call.params) && methodBySlot.get(step) === call.method
      && !calls.has(step) && isDeepStrictEqual(call.metadata, meta.calls[index]), 'PARENT_CALLS');
    if (call.metadata.response) check(typeof call.value === 'string' && call.metadata.response.sha256 === sha(call.value)
      && call.metadata.response.bytes === Buffer.byteLength(call.value), 'PARENT_RESPONSE_HASH');
    calls.set(step, call);
  }
  if (plan.artStatePolicy !== undefined) check(meta.applicationStatePolicy === plan.artStatePolicy, 'PARENT_STATE_POLICY');
  return calls;
}

function chooseFilter(home, tid) {
  const selected = {};
  for (const group of Array.isArray(home?.filters?.[tid]) ? home.filters[tid] : []) {
    if (typeof group?.key !== 'string' || !group.key || !Array.isArray(group.value)) continue;
    const option = group.value.find(value => value && validId(value.v) && String(value.v).trim());
    if (option) selected[group.key] = String(option.v);
  }
  return Object.keys(selected).length ? selected : null;
}

function choosePlayer(...details) {
  for (const detail of details) for (const video of Array.isArray(detail?.list) ? detail.list : []) {
    if (typeof video?.vod_play_from !== 'string' || typeof video.vod_play_url !== 'string') continue;
    const flags = video.vod_play_from.split('$$$'), groups = video.vod_play_url.split('$$$');
    for (let i = 0; i < flags.length && i < groups.length; i++) {
      if (!flags[i]) continue;
      for (const episode of groups[i].split('#')) {
        const split = episode.indexOf('$');
        if (split >= 0 && split < episode.length - 1) return [flags[i], episode.slice(split + 1), []];
      }
    }
  }
  return null;
}

function deriveParameters(plan, artifact, site, calls, slot) {
  const home = object(calls.get('home')), homeVideo = object(calls.get('home-video'));
  const category = object(calls.get('category-page1'));
  const classes = Array.isArray(home?.class) ? home.class : [];
  const tid = classes.find(value => value && validId(value.type_id))?.type_id;
  const selected = firstVideo(category, object(calls.get('category-page2')), object(calls.get('category-filter')), homeVideo, home);
  const searched = firstVideo(object(calls.get('search')), object(calls.get('search-page1')));
  if (slot === 'home') return { params: [true], parameterSource: 'controlled-home-flag' };
  if (slot === 'home-video') return { params: [], parameterSource: 'no-arguments' };
  if (slot.startsWith('category-')) {
    if (!validId(tid)) return { reason: 'no-observed-category-id' };
    const filter = slot === 'category-filter' ? chooseFilter(home, String(tid)) : {};
    if (!filter) return { reason: 'no-observed-filter-values' };
    return { params: [String(tid), slot === 'category-page2' ? '2' : '1', true, filter], parameterSource: 'parent-art-home' };
  }
  if (slot === 'detail' || slot === 'search-detail') {
    const video = slot === 'detail' ? selected : searched;
    return video ? { params: [[String(video.vod_id)]], parameterSource: slot === 'detail' ? 'parent-art-video-id' : 'parent-art-search-video-id' }
      : { reason: slot === 'detail' ? 'no-observed-video-id' : 'no-observed-search-video-id' };
  }
  if (slot === 'search' || slot === 'search-page1') {
    let keyword = site.businessSearchKeyword ?? artifact.businessSearchKeyword ?? plan.businessSearchKeyword;
    let parameterSource = typeof keyword === 'string' && keyword.trim() ? 'explicit-parent-test-keyword' : 'parent-art-video-name';
    const observedSearch = calls.get('search') || calls.get('search-page1');
    if ((typeof keyword !== 'string' || !keyword.trim()) && typeof observedSearch?.params?.[0] === 'string' && observedSearch.params[0].trim()) {
      keyword = observedSearch.params[0]; parameterSource = 'parent-art-search-argument';
    }
    if (typeof keyword !== 'string' || !keyword.trim()) keyword = typeof selected?.vod_name === 'string' ? selected.vod_name.trim() : '';
    if (!keyword) { keyword = '测试'; parameterSource = 'controlled-test-keyword'; }
    return { params: slot === 'search' ? [keyword, false] : [keyword, false, '1'], parameterSource };
  }
  const params = choosePlayer(object(calls.get('detail')), object(calls.get('search-detail')));
  return params ? { params, parameterSource: 'parent-art-detail-playback-entry' } : { reason: 'no-observed-playback-entry' };
}

/** Each planned site contains one call, so runners create an independent process. */
export function buildWorkingFollowups(plan, results, { manifestSha256 } = {}) {
  check(plan?.schemaVersion === 1 && Array.isArray(plan.artifacts) && hashPattern.test(manifestSha256), 'PLAN_SCHEMA');
  check(Array.isArray(results), 'RESULT_SCHEMA');
  const expected = new Map();
  for (const [artifactIndex, artifact] of plan.artifacts.entries()) {
    check(hashPattern.test(artifact.sha256) && Array.isArray(artifact.sites), 'PLAN_SCHEMA');
    for (const [siteIndex, site] of artifact.sites.entries()) {
      check(typeof site.ext === 'string' && typeof site.api === 'string' && typeof site.key === 'string'
        && (!site.extSha256 || site.extSha256 === sha(site.ext))
        && (!site.caseIdentitySha256 || hashPattern.test(site.caseIdentitySha256)), 'PLAN_SCHEMA');
      loaderContextOf(artifact, site);
      expected.set(artifactIndex + '-' + siteIndex, { artifact, site, artifactIndex, siteIndex });
    }
  }
  const indexed = new Map();
  for (const result of results) {
    const caseId = result.caseId ?? result.report?.artifactIndex + '-' + result.report?.siteIndex;
    check(expected.has(caseId) && !indexed.has(caseId), 'UNKNOWN_OR_DUPLICATE_CASE');
    indexed.set(caseId, { result, calls: validateParent(plan, expected.get(caseId), result, manifestSha256) });
  }
  check(indexed.size === expected.size, 'INCOMPLETE_PARENT_RESULTS');
  const artifacts = [], unexecuted = [], parentCases = [], publicCases = [];
  for (const [parentCaseId, entry] of expected) {
    const { artifact, site } = entry, { result, calls } = indexed.get(parentCaseId), report = result.report;
    const timedOut = report.timedOut === true || [...calls.values()].some(call => call.metadata?.status === 'timeout');
    const failed = !!report.error || [...calls.values()].some(call => ['failed', 'network'].includes(call.metadata?.status));
    const unfinished = report.completed !== true || workingFollowupSlots.some(([slot]) => !calls.has(slot));
    const eligible = unfinished && (timedOut || failed);
    const parentPrivateResultSha256 = hashPattern.test(result.privateResultSha256) ? result.privateResultSha256 : identity({ report, privateCalls: result.privateCalls });
    parentCases.push({ parentCaseId, parentPrivateResultSha256, eligible, timedOut, failed,
      sourceCaseIdentitySha256: site.caseIdentitySha256 || null });
    if (!eligible) continue;
    let target;
    for (const [slot, method] of workingFollowupSlots) {
      const prior = calls.get(slot);
      if (prior && prior.metadata?.status !== 'not-tested') continue;
      const outstandingReason = timedOut ? 'parent-timeout-left-method-unexecuted' : 'parent-failure-left-method-unexecuted';
      const followup = { discoveryStep: slot, parentCaseId, parentManifestSha256: manifestSha256, parentPrivateResultSha256,
        sourceCaseIdentitySha256: site.caseIdentitySha256 || null, outstandingReason,
        contextScope: plan.standaloneDiagnostic === true ? 'standalone-diagnostic-original-main-missing' : 'original-loader-context' };
      const derived = report.initSuccess === true ? deriveParameters(plan, artifact, site, calls, slot) : { reason: 'parent-spider-not-ready' };
      if (!derived.params) {
        unexecuted.push({ ...followup, method, status: 'not-tested', reason: derived.reason });
        continue;
      }
      if (!target) {
        target = structuredClone(artifact); target.sites = []; delete target.calls; delete target.businessDiscovery;
        artifacts.push(target);
      }
      const selected = structuredClone(site);
      delete selected.calls; delete selected.businessDiscovery;
      selected.followup = { ...followup, parameterSource: derived.parameterSource };
      selected.calls = [{ method, params: derived.params, metadata: { discoveryStep: slot, parameterSource: derived.parameterSource } }];
      target.sites.push(selected);
      publicCases.push({ ...followup, method, parameterSource: derived.parameterSource, jarSha256: artifact.sha256,
        apiSha256: sha(site.api), sourceKeySha256: sha(site.key), extSha256: sha(site.ext),
        paramsSha256: identity(derived.params), followupArtifactIndex: artifacts.length - 1, followupSiteIndex: target.sites.length - 1 });
    }
  }
  const followupPlan = { schemaVersion: 1, businessDiscovery: false,
    ...(plan.standaloneDiagnostic === true ? { standaloneDiagnostic: true } : {}),
    ...Object.fromEntries(['metadata', 'artBudgets', 'nasBudgets', 'artStatePolicy'].filter(key => plan[key] !== undefined).map(key => [key, structuredClone(plan[key])])),
    followupOf: { manifestSha256, methodIsolation: 'one explicit call per cold-process source case',
      scope: 'Separate additional observations only; historical ART/NAS results remain unchanged. Standalone diagnostics never certify missing-main coexistence.' },
    artifacts, unexecuted };
  const publicMetadata = { schemaVersion: 1, parentManifestSha256: manifestSha256, standaloneDiagnostic: plan.standaloneDiagnostic === true,
    scope: followupPlan.followupOf.scope,
    summary: { parentCases: expected.size, eligibleParentCases: parentCases.filter(row => row.eligible).length,
      executableFollowups: publicCases.length, notTested: unexecuted.length,
      controlledKeywordFollowups: publicCases.filter(row => row.parameterSource === 'controlled-test-keyword').length },
    parentCases, cases: publicCases, unexecuted };
  return { plan: followupPlan, publicMetadata };
}

function validCallParams(call) {
  const a = call.params, string = value => typeof value === 'string', strings = value => Array.isArray(value) && value.every(string);
  if (!Array.isArray(a)) return false;
  if (call.method === 'homeContent') return a.length === 1 && typeof a[0] === 'boolean';
  if (call.method === 'homeVideoContent') return a.length === 0;
  if (call.method === 'categoryContent') return a.length === 4 && string(a[0]) && string(a[1]) && typeof a[2] === 'boolean'
    && a[3] && typeof a[3] === 'object' && !Array.isArray(a[3]) && Object.values(a[3]).every(string);
  if (call.method === 'detailContent') return a.length === 1 && strings(a[0]);
  if (call.method === 'searchContent') return [2, 3].includes(a.length) && string(a[0]) && typeof a[1] === 'boolean' && (a.length === 2 || string(a[2]));
  return call.method === 'playerContent' && a.length === 3 && string(a[0]) && string(a[1]) && strings(a[2]);
}

/** NAS-only supplements: exact attempted ART inputs, isolated after NAS timeout. */
export function buildWorkingNASFollowups(plan, artResults, nasBundles, { manifestSha256 } = {}) {
  // Reuse the strict complete parent ART identity/raw-response checks. No input
  // or previous execution report is changed by this pure validation call.
  buildWorkingFollowups(plan, artResults, { manifestSha256 });
  check(Array.isArray(nasBundles), 'NAS_BUNDLE_SCHEMA');
  const expected = new Map(), arts = new Map(artResults.map(result => [result.caseId ?? result.report.artifactIndex + '-' + result.report.siteIndex, result]));
  for (const [artifactIndex, artifact] of plan.artifacts.entries()) for (const [siteIndex, site] of artifact.sites.entries()) {
    expected.set(artifactIndex + '-' + siteIndex, { artifact, site, artifactIndex, siteIndex });
  }
  const nases = new Map();
  for (const bundle of nasBundles) {
    check(bundle?.schemaVersion === 1 && bundle.manifestSha256 === manifestSha256 && hashPattern.test(bundle.runnerSha256)
      && Array.isArray(bundle.cases), 'NAS_BUNDLE_IDENTITY');
    const parentNASBundleSha256 = hashPattern.test(bundle.privateResultSha256) ? bundle.privateResultSha256
      : identity({ schemaVersion: bundle.schemaVersion, manifestSha256: bundle.manifestSha256, runnerSha256: bundle.runnerSha256, cases: bundle.cases });
    for (const raw of bundle.cases) {
      const meta = raw.report, caseId = meta?.artifactIndex + '-' + meta?.siteIndex, entry = expected.get(caseId);
      check(entry && !nases.has(caseId), 'NAS_UNKNOWN_OR_DUPLICATE_CASE');
      const { artifact, site, artifactIndex, siteIndex } = entry;
      check(meta.schemaVersion === 1 && meta.artifactIndex === artifactIndex && meta.siteIndex === siteIndex && meta.manifestSha256 === manifestSha256
        && meta.jarSha256 === artifact.sha256 && meta.extSha256 === sha(site.ext) && meta.siteKeySha256 === sha(site.key)
        && meta.api === (/^[\w.$]+$/.test(site.api) && site.api.length <= 240 ? site.api : 'sha256:' + sha(site.api))
        && isDeepStrictEqual(raw.input?.artifact, artifact) && isDeepStrictEqual(raw.input?.site, site), 'NAS_CASE_IDENTITY');
      assertLoaderIdentity(meta, artifact, site);
      check((meta.standaloneDiagnostic === true) === (plan.standaloneDiagnostic === true)
        && (!plan.standaloneDiagnostic || meta.originalMissingContextSha256 === site.originalMissingContextSha256), 'NAS_CONTEXT_SCOPE');
      check(!site.caseIdentitySha256 || meta.caseIdentitySha256 === site.caseIdentitySha256, 'NAS_SCENARIO_IDENTITY');
      check(Array.isArray(meta.calls) && Array.isArray(raw.privateCalls) && meta.calls.length === raw.privateCalls.length
        && meta.calls.length <= 20, 'NAS_CALLS');
      const art = arts.get(caseId), artCalls = new Map(art.privateCalls.map(call => [call.metadata.discoveryStep, call]));
      const slots = new Set();
      for (const [index, call] of raw.privateCalls.entries()) {
        const row = meta.calls[index], slot = row.discoveryStep;
        check(isDeepStrictEqual(call.metadata, row) && call.method === row.method && Array.isArray(call.params), 'NAS_CALLS');
        if (meta.initSuccess === true) {
          check(methodBySlot.get(slot) === call.method && !slots.has(slot), 'NAS_CALLS');slots.add(slot);
          if (row.status !== 'not-tested') {
            const original = artCalls.get(slot);
            check(original && original.metadata.status !== 'not-tested' && validCallParams(original)
              && original.method === call.method && isDeepStrictEqual(original.params, call.params)
              && row.paramsSha256 === identity(original.params), 'NAS_EXACT_ART_PARAMS');
          }
        }
        if (row.response?.sha256) check(typeof call.value === 'string' && row.response.sha256 === sha(call.value)
          && row.response.bytes === Buffer.byteLength(call.value), 'NAS_RESPONSE_HASH');
      }
      if (meta.initSuccess === true) check(meta.parameterSource === 'exact-art-replay' && meta.mode === 'replay'
        && meta.targetApkSha256 === art.report.targetApkSha256 && meta.artSymbolMapSha256 === art.report.symbolMapSha256, 'NAS_REPLAY_IDENTITY');
      nases.set(caseId, { raw, parentNASBundleSha256, parentNASRunnerSha256: bundle.runnerSha256 });
    }
  }
  check(nases.size === expected.size, 'INCOMPLETE_NAS_RESULTS');
  const artifacts = [], publicCases = [], unexecuted = [], parentCases = [];
  for (const [parentCaseId, { artifact, site }] of expected) {
    const art = arts.get(parentCaseId), nas = nases.get(parentCaseId), meta = nas.raw.report;
    const ready = meta.initSuccess === true;
    const timeout = ready && meta.calls.some(call => call.status === 'timeout');
    const parentARTPrivateResultSha256 = hashPattern.test(art.privateResultSha256) ? art.privateResultSha256 : identity({ report: art.report, privateCalls: art.privateCalls });
    parentCases.push({ parentCaseId, ready, timeout, parentARTPrivateResultSha256,
      parentNASBundleSha256: nas.parentNASBundleSha256, parentNASRunnerSha256: nas.parentNASRunnerSha256 });
    if (!timeout) continue;
    const artCalls = new Map(art.privateCalls.map(call => [call.metadata.discoveryStep, call]));
    let afterTimeout = false, target;
    for (const row of meta.calls) {
      if (row.status === 'timeout') { afterTimeout = true; continue; }
      if (!afterTimeout || row.status !== 'not-tested') continue;
      const slot = row.discoveryStep, original = artCalls.get(slot);
      const followup = { discoveryStep: slot, parentCaseId, parentManifestSha256: manifestSha256,
        parentARTPrivateResultSha256, parentNASBundleSha256: nas.parentNASBundleSha256, parentNASRunnerSha256: nas.parentNASRunnerSha256,
        sourceCaseIdentitySha256: site.caseIdentitySha256 || null, originalLoaderContextSha256: identity(loaderContextOf(artifact, site).identity),
        outstandingReason: 'nas-timeout-left-method-unexecuted', parameterSource: 'exact-parent-art-call',
        contextScope: plan.standaloneDiagnostic === true ? 'standalone-diagnostic-original-main-missing' : 'original-loader-context' };
      if (!original || original.metadata.status === 'not-tested') {
        unexecuted.push({ ...followup, method: row.method, status: 'not-tested', reason: 'parent-art-method-not-attempted' });continue;
      }
      check(original.method === row.method && validCallParams(original), 'ART_FOLLOWUP_PARAMS');
      const paramsSha256 = identity(original.params);
      if (!target) {
        target = structuredClone(artifact);target.sites = [];delete target.calls;delete target.businessDiscovery;artifacts.push(target);
      }
      const selected = structuredClone(site);delete selected.calls;delete selected.businessDiscovery;
      selected.followup = { ...followup, parentARTParamsSha256: paramsSha256 };
      selected.calls = [{ method: original.method, params: structuredClone(original.params), metadata: {
        discoveryStep: slot, parameterSource: 'exact-parent-art-call', parentARTParamsSha256: paramsSha256,
      } }];
      target.sites.push(selected);
      publicCases.push({ ...selected.followup, method: original.method, paramsSha256, jarSha256: artifact.sha256,
        apiSha256: sha(site.api), sourceKeySha256: sha(site.key), extSha256: sha(site.ext),
        followupArtifactIndex: artifacts.length - 1, followupSiteIndex: target.sites.length - 1 });
    }
  }
  const followupPlan = { schemaVersion: 1, businessDiscovery: false,
    ...(plan.standaloneDiagnostic === true ? { standaloneDiagnostic: true } : {}),
    ...Object.fromEntries(['metadata', 'artBudgets', 'nasBudgets', 'artStatePolicy'].filter(key => plan[key] !== undefined).map(key => [key, structuredClone(plan[key])])),
    followupOf: { manifestSha256, kind: 'nas-post-timeout-exact-art-inputs', executionMode: 'discover-with-explicit-calls',
      methodIsolation: 'one exact parent ART call per fresh NAS source runtime',
      scope: 'NAS-only additional observations of original ART arguments and unchanged source/loader context. No new ART execution is required; primary reports remain unchanged. Standalone diagnostics cannot certify original missing-main coexistence.' },
    artifacts, unexecuted };
  const publicMetadata = { schemaVersion: 1, parentManifestSha256: manifestSha256, standaloneDiagnostic: plan.standaloneDiagnostic === true,
    scope: followupPlan.followupOf.scope, summary: { parentARTCases: arts.size, parentNASCases: nases.size,
      readyTimeoutParentCases: parentCases.filter(row => row.timeout).length, executableFollowups: publicCases.length, excludedARTNotAttempted: unexecuted.length },
    parentCases, cases: publicCases, unexecuted };
  return { plan: followupPlan, publicMetadata };
}

async function newOutput(out, protectedPaths) {
  const output = resolve(out);
  check(protectedPaths.every(path => !contained(path, output) && !contained(output, path)), 'OUTPUT_OVERLAPS_INPUT');
  let cursor = resolve('/');
  for (const part of relative(cursor, output).split(sep)) {
    cursor = join(cursor, part);
    const info = await lstat(cursor).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    check(!info || info.isDirectory() && !info.isSymbolicLink(), 'OUTPUT_PATH');
  }
  await mkdir(output, { recursive: true, mode: 0o700 });
  check(await realpath(output) === output && (await readdir(output)).length === 0, 'OUTPUT_NOT_EMPTY');
  await chmod(output, 0o700);
  return output;
}

export async function prepareWorkingFollowups({ planPath, artDirectory, out } = {}) {
  const [parentPlanPath, parentART] = await Promise.all([realpath(resolve(planPath)), realpath(resolve(artDirectory))]);
  const bytes = await readFile(parentPlanPath), plan = JSON.parse(bytes), manifestSha256 = sha(bytes);
  const results = [], evidenceFiles = [];
  for (const file of (await readdir(parentART)).filter(name => /^\d+-\d+-private\.json$/.test(name)).sort()) {
    const path = join(parentART, file), info = await lstat(path);
    check(info.isFile() && !info.isSymbolicLink() && info.size <= 128 * 1024 * 1024, 'PARENT_FILE');
    const raw = await readFile(path), privateResultSha256 = sha(raw), caseId = file.replace(/-private\.json$/, '');
    results.push({ ...JSON.parse(raw), caseId, privateResultSha256 });
    evidenceFiles.push({ caseId, sha256: privateResultSha256, bytes: raw.length });
  }
  const built = buildWorkingFollowups(plan, results, { manifestSha256 });
  const output = await newOutput(out, [parentART, parentPlanPath]);
  const planBytes = Buffer.from(JSON.stringify(built.plan, null, 2) + '\n');
  const pins = { ...built.publicMetadata, planSha256: sha(planBytes), evidenceFiles, generatorSha256: sha(await readFile(SELF)) };
  await writeFile(join(output, 'oracle-plan.json'), planBytes, { mode: 0o600, flag: 'wx' });
  await writeFile(join(output, 'pins.json'), JSON.stringify(pins, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  return { ...built, pins, output };
}

export async function prepareWorkingNASFollowups({ planPath, artDirectory, nasCasesDirectory, out } = {}) {
  const [parentPlanPath, parentART, parentNAS] = await Promise.all([realpath(resolve(planPath)), realpath(resolve(artDirectory)), realpath(resolve(nasCasesDirectory))]);
  const bytes = await readFile(parentPlanPath), manifestSha256 = sha(bytes), plan = JSON.parse(bytes);
  const results = [], bundles = [], evidenceFiles = [];
  for (const [directory, pattern, host] of [[parentART, /^\d+-\d+-private\.json$/, 'ART'], [parentNAS, /^case-\d+-private\.json$/, 'NAS']]) {
    for (const file of (await readdir(directory)).filter(name => pattern.test(name)).sort()) {
      const path = join(directory, file), info = await lstat(path);
      check(info.isFile() && !info.isSymbolicLink() && info.size <= 128 * 1024 * 1024, 'PARENT_FILE');
      const raw = await readFile(path), privateResultSha256 = sha(raw);
      if (host === 'ART') results.push({ ...JSON.parse(raw), caseId: file.replace(/-private\.json$/, ''), privateResultSha256 });
      else bundles.push({ ...JSON.parse(raw), privateResultSha256 });
      evidenceFiles.push({ host, file, sha256: privateResultSha256, bytes: raw.length });
    }
  }
  const built = buildWorkingNASFollowups(plan, results, bundles, { manifestSha256 });
  const output = await newOutput(out, [parentART, parentNAS, parentPlanPath]);
  const planBytes = Buffer.from(JSON.stringify(built.plan, null, 2) + '\n');
  const pins = { ...built.publicMetadata, planSha256: sha(planBytes), evidenceFiles, generatorSha256: sha(await readFile(SELF)) };
  await writeFile(join(output, 'oracle-plan.json'), planBytes, { mode: 0o600, flag: 'wx' });
  await writeFile(join(output, 'pins.json'), JSON.stringify(pins, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  return { ...built, pins, output };
}

async function main() {
  const args = process.argv.slice(2), option = name => { const index = args.indexOf('--' + name); return index < 0 ? undefined : args[index + 1]; };
  const planPath = option('plan'), artDirectory = option('art'), out = option('out'), nasCasesDirectory = option('nas-cases-dir');
  check(planPath && artDirectory && out, 'USAGE_PLAN_ART_OUT');
  const { pins } = nasCasesDirectory ? await prepareWorkingNASFollowups({ planPath, artDirectory, nasCasesDirectory, out })
    : await prepareWorkingFollowups({ planPath, artDirectory, out });
  console.log(JSON.stringify({ ...pins.summary, parentManifestSha256: pins.parentManifestSha256, planSha256: pins.planSha256, standaloneDiagnostic: pins.standaloneDiagnostic }));
}
if (process.argv[1] && resolve(process.argv[1]) === SELF) main().catch(error => {
  console.error(JSON.stringify({ errorCode: /^WORKING_FOLLOWUP_[A-Z_]+$/.test(error.message) ? error.message : 'WORKING_FOLLOWUP_PREPARATION_FAILED' }));
  process.exitCode = 1;
});
