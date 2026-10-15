// SPDX-License-Identifier: GPL-3.0-only
// Offline strict supplemental evidence audit; never executes provider code.
import { createHash } from 'node:crypto';
import { readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual as equal } from 'node:util';
import { canonical } from '../container/jar-matrix-probe.mjs';
import { validateWorkingCalls, workingSourceBudgets } from '../container/working-source-probe.mjs';
import { loaderContextOf, assertLoaderIdentity, officialOracleApkSha256 } from '../android/loader-context.mjs';
import { oracleBudgetsOf, oracleStatePolicyOf } from '../android/run-oracle.mjs';
import { workingSourceScenarioIdentity } from './prepare-working-source-plan.mjs';
import { buildWorkingStandaloneControls } from './prepare-working-standalone-controls.mjs';
import { buildWorkingFollowups, buildWorkingNASFollowups } from './prepare-working-followups.mjs';
import { summarizeWorkingCall } from './working-source-report.mjs';
import { verifyCatalogFreeze } from './freeze-catalog.mjs';

const SELF = fileURLToPath(import.meta.url), ROOT = resolve(dirname(SELF), '../..');
const sha = value => createHash('sha256').update(value).digest('hex');
const semantic = value => sha(JSON.stringify(canonical(value)));
const hashPattern = /^[a-f0-9]{64}$/;
const statuses = ['nonempty', 'empty', 'not-implemented', 'invalid-json', 'network', 'failed', 'timeout', 'not-tested'];
const check = (value, reason) => { if (!value) throw new Error('SUPPLEMENTAL_REPORT_' + reason); };
const label = value => { const text = String(value ?? ''); return text.length > 160 || /(?:https?:|:\/\/|[?=&\r\n]|bearer\s|token[:\s])/i.test(text) ? 'sha256:' + sha(text) : text; };
const api = value => typeof value === 'string' && /^[\w.$]{1,240}$/.test(value) ? value : 'sha256:' + sha(String(value));
const count = calls => Object.fromEntries(statuses.map(status => [status, calls.filter(call => call.status === status).length]));
async function json(path) { const bytes = await readFile(path); return { bytes, value: JSON.parse(bytes), sha256: sha(bytes) }; }
const flat = plan => plan.artifacts.flatMap((artifact, artifactIndex) => artifact.sites.map((site, siteIndex) => ({ artifact, site, artifactIndex, siteIndex, caseId: artifactIndex + '-' + siteIndex })));

export function verifySupplementalContainer(inspectInput, exitCode, { imageId, index, mode = 'discover', extra = '/extra' } = {}) {
  const inspect = Array.isArray(inspectInput) && inspectInput.length === 1 ? inspectInput[0] : inspectInput;
  check(inspect && /^sha256:[a-f0-9]{64}$/.test(imageId) && inspect.Image === imageId, 'CONTAINER_IMAGE');
  check(['10001', '10001:10001'].includes(inspect.Config?.User), 'CONTAINER_USER');
  check(inspect.State?.Running === false && inspect.State.Status === 'exited' && inspect.State.ExitCode === exitCode, 'CONTAINER_EXIT');
  const base = 'case-' + String(index).padStart(3, '0');
  const args = ['scripts/container/working-source-probe.mjs', '--plan', extra + '/oracle-plan.json',
    ...(mode === 'replay' ? ['--calls-dir', extra + '/art-results'] : []), '--mode', mode, '--input-root', '/input', '--case-index', String(index),
    '--output', '/output/' + base + '-private.json', '--metadata', '/output/' + base + '-metadata.json'];
  check(inspect.Path === 'node' && equal(inspect.Args, args), 'CONTAINER_COMMAND');
  check(Array.isArray(inspect.Mounts) && ['/input', '/run', '/opt/tvbox/scripts', extra].every(destination => inspect.Mounts.some(mount => mount.Destination === destination && mount.RW === false))
    && inspect.Mounts.some(mount => mount.Destination === '/output' && mount.RW === true), 'CONTAINER_MOUNTS');
  check(inspect.HostConfig?.ReadonlyRootfs === true && inspect.HostConfig?.Privileged === false && inspect.HostConfig?.RestartPolicy?.Name === 'no', 'CONTAINER_POLICY');
  return { imageId, user: inspect.Config.User, exitCode, running: false, status: 'exited',
    containerId: hashPattern.test(inspect.Id) ? inspect.Id : null, oomKilled: inspect.State.OOMKilled === true,
    errorPresent: typeof inspect.State.Error === 'string' && inspect.State.Error.length > 0,
    inspectSha256: semantic(inspectInput) };
}

function verifyCalls(value, host) {
  check(Array.isArray(value.privateCalls) && Array.isArray(value.report.calls) && value.privateCalls.length === value.report.calls.length, host + '_CALL_COUNT');
  validateWorkingCalls(value.privateCalls);
  for (const [index, call] of value.privateCalls.entries()) {
    check(equal(call.metadata, value.report.calls[index]), host + '_CALL_METADATA');
    if (call.metadata.response) check(typeof call.value === 'string' && call.metadata.response.sha256 === sha(call.value)
      && call.metadata.response.bytes === Buffer.byteLength(call.value), host + '_RAW_HASH');
  }
}

async function artTrack(planInput, directory, collectorSha256) {
  const collection = await json(join(directory, 'summary-private.json'));
  check(collection.value.manifestSha256 === planInput.sha256 && collection.value.runnerSha256 === collectorSha256
    && equal(collection.value.budgets, oracleBudgetsOf(planInput.value))
    && collection.value.applicationStatePolicy === oracleStatePolicyOf(planInput.value), 'ART_COLLECTION_PLAN');
  const results = [];
  for (const entry of flat(planInput.value)) {
    const input = await json(join(directory, entry.caseId + '-private.json')), value = input.value, meta = value.report, { artifact, site } = entry;
    check(meta?.schemaVersion === 1 && meta.manifestSha256 === planInput.sha256 && meta.artifactIndex === entry.artifactIndex && meta.siteIndex === entry.siteIndex
      && meta.jarSha256 === artifact.sha256 && meta.extSha256 === sha(site.ext) && meta.id === label(artifact.id) && meta.api === label(site.api) && meta.siteKey === label(site.key), 'ART_IDENTITY');
    assertLoaderIdentity(meta, artifact, site);
    check(meta.targetApkSha256 === officialOracleApkSha256 && hashPattern.test(meta.symbolMapSha256)
      && equal(meta.budgets, oracleBudgetsOf(planInput.value)) && meta.applicationStatePolicy === oracleStatePolicyOf(planInput.value), 'ART_RUNTIME');
    const row = collection.value.cases.find(row => row.id === entry.caseId);
    check(row?.privateResultPulled === true && row.privateResultSha256 === input.sha256 && row.privateResultBytes === input.bytes.length
      && equal(row.report, meta) && row.adbExit === 0 && row.transportTimeout === false && Number.isSafeInteger(row.instrumentationCode), 'ART_COLLECTION_FILE');
    verifyCalls(value, 'ART');
    results.push({ ...value, caseId: entry.caseId, privateResultSha256: input.sha256 });
  }
  check(collection.value.cases.length === results.length, 'ART_COLLECTION_CASES');
  return { results, collectionSha256: collection.sha256 };
}

async function nasBundles(directory) {
  const values = [];
  for (const file of (await readdir(directory)).filter(name => /^case-\d+-private\.json$/.test(name)).sort()) {
    const input = await json(join(directory, file));values.push({ ...input.value, privateResultSha256: input.sha256 });
  }
  return values;
}

export function verifySupplementalNASCase(entry, bundle, metadata, { plan, planSha256, probeSha256, mode, art } = {}) {
  check(bundle?.schemaVersion === 1 && bundle.manifestSha256 === planSha256 && bundle.runnerSha256 === probeSha256
    && bundle.cases?.length === 1 && equal(metadata, { ...bundle, cases: bundle.cases.map(value => value.report) }), 'NAS_BUNDLE');
  const value = bundle.cases[0], meta = value.report, { artifact, site, artifactIndex, siteIndex, caseId } = entry;
  check(equal(value.input, { artifact, site }), 'NAS_RAW_INPUT');
  check(meta?.schemaVersion === 1 && meta.caseId === caseId && meta.artifactIndex === artifactIndex && meta.siteIndex === siteIndex
    && meta.manifestSha256 === planSha256 && meta.jarSha256 === artifact.sha256 && meta.extSha256 === sha(site.ext) && meta.siteKeySha256 === sha(site.key)
    && meta.api === api(site.api) && meta.caseIdentitySha256 === site.caseIdentitySha256 && meta.sourceScenarioSha256 === site.sourceScenarioSha256, 'NAS_IDENTITY');
  assertLoaderIdentity(meta, artifact, site);
  check(meta.mode === mode && meta.parameterSource === (mode === 'replay' ? 'exact-art-replay' : 'explicit-plan')
    && meta.applicationStatePolicy === 'fresh-runtime-data' && meta.initPolicy === 'android'
    && equal(meta.budgets, workingSourceBudgets(plan)) && (meta.standaloneDiagnostic === true) === (plan.standaloneDiagnostic === true), 'NAS_RUNTIME');
  if (art) check(meta.targetApkSha256 === officialOracleApkSha256 && meta.artSymbolMapSha256 === art.report.symbolMapSha256, 'NAS_ART_MAP');
  verifyCalls(value, 'NAS');
  const sourceCalls = art ? art.privateCalls : site.calls;
  check(Array.isArray(sourceCalls) && sourceCalls.length === value.privateCalls.length, 'NAS_EXPLICIT_CALLS');
  for (const [index, call] of value.privateCalls.entries()) {
    const original = sourceCalls[index];check(call.method === original.method, 'NAS_METHOD');
    if (call.metadata.status === 'not-tested') check(call.params.length === 0 || equal(call.params, original.params), 'NAS_SKIPPED_PARAMS');
    else check(equal(call.params, original.params) && call.metadata.paramsSha256 === semantic(original.params), 'NAS_EXACT_PARAMS');
  }
  check(meta.cleanup?.closed === true && meta.cleanup?.temporaryDataRemoved === true && meta.cleanup?.workerExited !== false, 'NAS_CLEANUP');
  return value;
}

async function auditExecution({ workRoot, tag, planName, mode, reproduced, imageId, probeSha256, art, inputRoot, freeze }) {
  const planInput = await json(join(workRoot, 'run', planName, 'oracle-plan.json')), plan = planInput.value;
  check(equal(plan, reproduced), 'REPRODUCED_PLAN');
  check(plan.metadata?.sourceInputSetSha256 === freeze.inputSetSha256, 'PLAN_FREEZE');
  const launch = await json(join(workRoot, tag + '-bundle', 'run-plan.json'));
  check(launch.value.schemaVersion === 1 && launch.value.tag === tag && launch.value.image === imageId
    && launch.value.planSha256 === planInput.sha256 && launch.value.probeSha256 === probeSha256 && launch.value.mode === mode, 'LAUNCH_PINS');
  const directory = join(workRoot, 'nas-' + tag), copiedLaunch = await json(join(directory, 'run-plan.json'));
  check(equal(launch.value, copiedLaunch.value), 'COLLECTED_LAUNCH');
  const entries = flat(plan);check(entries.length === launch.value.cases.length, 'LAUNCH_CASE_COUNT');
  const rows = [];
  for (const [index, entry] of entries.entries()) {
    const { artifact, site, caseId } = entry, base = 'case-' + String(index).padStart(3, '0'), pin = launch.value.cases[index];
    check(equal(pin, { index, caseId, sha256: artifact.sha256, sourceScenarioSha256: site.sourceScenarioSha256,
      parent: site.originalOmittedContext || site.followup }), 'LAUNCH_CASE');
    const binding = freeze.bindings.find(binding => binding.id === site.bindingId);
    check(workingSourceScenarioIdentity(artifact, site, { originalBinding: binding }) === site.caseIdentitySha256, 'SOURCE_CONTEXT');
    const context = loaderContextOf(artifact, site);
    for (const jar of [artifact, ...(context.main ? [context.main] : [])]) {
      const path = await realpath(resolve(inputRoot, jar.jarPath)), rel = relative(inputRoot, path);
      check(!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep) && sha(await readFile(path)) === jar.sha256, 'FROZEN_JAR');
    }
    const [bundle, metadata, inspect, exitRaw] = await Promise.all([json(join(directory, base + '-private.json')), json(join(directory, base + '-metadata.json')),
      json(join(directory, base + '.inspect.json')), readFile(join(directory, base + '.exit.txt'), 'utf8')]);
    check(/^\d{1,3}\s*$/.test(exitRaw), 'EXIT_FILE');
    const container = verifySupplementalContainer(inspect.value, Number(exitRaw.trim()), { imageId, index, mode });
    const android = art?.results.find(result => result.caseId === caseId);
    const value = verifySupplementalNASCase(entry, bundle.value, metadata.value, { plan, planSha256: planInput.sha256, probeSha256, mode, art: android });
    const calls = value.privateCalls.map((call, callIndex) => {
      const original = android?.privateCalls[callIndex], selected = site.calls?.[callIndex];
      const result = { method: call.method, discoveryStep: selected?.metadata?.discoveryStep || site.followup?.discoveryStep || call.metadata.discoveryStep,
        slotSource: 'explicit-plan', nas: summarizeWorkingCall(call, 'NAS'), paramsVerified: call.metadata.status !== 'not-tested' };
      if (original) {
        result.art = summarizeWorkingCall(original, 'ART');
        if (result.art.response?.semanticSha256 && result.nas.response?.semanticSha256) result.semanticEqual = result.art.response.semanticSha256 === result.nas.response.semanticSha256;
      }
      return result;
    });
    rows.push({ caseId, parentCaseId: site.followup?.parentCaseId || site.originalOmittedContext?.parentCase, jarSha256: artifact.sha256,
      sourceKeySha256: sha(site.key), api: api(site.api), sourceScenarioSha256: site.caseIdentitySha256, ...context.identity,
      scope: plan.standaloneControl ? 'intentionally-omitted-main-control' : plan.standaloneDiagnostic ? 'original-main-missing-standalone-diagnostic' : 'original-loader-context',
      parentEvidence: structuredClone(site.originalOmittedContext || site.followup), nasPrivateSha256: bundle.sha256,
      ...(android ? { artPrivateSha256: android.privateResultSha256 } : {}), container,
      ready: value.report.initSuccess === true, loaded: value.report.loadSuccess === true,
      cleanup: Object.fromEntries(['closed', 'workerExited', 'temporaryDataRemoved', 'forcedWorkerKill'].filter(key => typeof value.report.cleanup[key] === 'boolean').map(key => [key, value.report.cleanup[key]])), calls });
  }
  return { tag, planSha256: planInput.sha256, launchSha256: launch.sha256, mode, diagnostic: plan.standaloneDiagnostic === true,
    control: plan.standaloneControl === true, cases: rows, summary: { cases: rows.length, ready: rows.filter(row => row.ready).length,
      nas: count(rows.flatMap(row => row.calls.map(call => call.nas))), art: count(rows.flatMap(row => row.calls.flatMap(call => call.art ? [call.art] : []))),
      cleanupPassed: rows.length, containerZeroExit: rows.filter(row => row.container.exitCode === 0).length } };
}

export async function buildWorkingSupplementalReport({ workRoot, inputRoot, sourceRoot = ROOT, generatedAt = new Date().toISOString() } = {}) {
  const root = await realpath(inputRoot), freezeInput = await json(join(root, 'freeze.json')), freeze = freezeInput.value;
  await verifyCatalogFreeze({ directory: root });
  const primaryLaunch = await json(join(workRoot, 'nas-bundle/run-plan.json')), imageId = primaryLaunch.value.image;
  const sourcePins = primaryLaunch.value.sourcePins, sourceMap = new Map(sourcePins.map(pin => [pin.file, pin.sha256]));
  const required = ['scripts/container/working-source-probe.mjs', 'scripts/container/jar-matrix-probe.mjs', 'scripts/android/loader-context.mjs', 'scripts/android/run-oracle.mjs', 'scripts/compat/prepare-working-source-plan.mjs'];
  for (const file of required) check(hashPattern.test(sourceMap.get(file)) && sha(await readFile(join(sourceRoot, file))) === sourceMap.get(file), 'EXECUTED_SOURCE_PIN');
  const probeSha256 = sourceMap.get(required[0]), parents = {};
  for (const name of ['original', 'standalone']) {
    const plan = await json(join(workRoot, 'run', name, 'oracle-plan.json'));
    const art = await artTrack(plan, join(workRoot, 'art', name + '-results'), sourceMap.get('scripts/android/run-oracle.mjs'));
    parents[name] = { plan, art, nas: await nasBundles(join(workRoot, 'nas', name)) };
  }
  const controlInput = await json(join(workRoot, 'run/controls/oracle-plan.json'));
  const onlyCases = flat(controlInput.value).map(({ site }) => site.originalOmittedContext.parentCase);
  const original = parents.original, standalone = parents.standalone;
  const controls = buildWorkingStandaloneControls(original.plan.value, original.art.results.filter(row => onlyCases.includes(row.caseId))
    .map(row => ({ caseId: row.caseId, result: { report: row.report, privateCalls: row.privateCalls }, privateResultSha256: row.privateResultSha256 })), { parentManifestSha256: original.plan.sha256, onlyCases });
  const nasOriginal = buildWorkingNASFollowups(original.plan.value, original.art.results, original.nas, { manifestSha256: original.plan.sha256 });
  const nasStandalone = buildWorkingNASFollowups(standalone.plan.value, standalone.art.results, standalone.nas, { manifestSha256: standalone.plan.sha256 });
  const artFollowups = buildWorkingFollowups(standalone.plan.value, standalone.art.results, { manifestSha256: standalone.plan.sha256 });
  const followPlan = await json(join(workRoot, 'run/followups-v2/oracle-plan.json'));
  const followART = await artTrack(followPlan, join(workRoot, 'art/followup-results-v2'), sourceMap.get('scripts/android/run-oracle.mjs'));
  const tracks = [];
  for (const config of [
    { tag: 'controls', planName: 'controls', mode: 'discover', reproduced: controls.plan },
    { tag: 'nasfollow-original', planName: 'nas-follow-original', mode: 'discover', reproduced: nasOriginal.plan },
    { tag: 'nasfollow-standalone', planName: 'nas-follow-standalone', mode: 'discover', reproduced: nasStandalone.plan },
    { tag: 'artfollow-v2', planName: 'followups-v2', mode: 'replay', reproduced: artFollowups.plan, art: followART },
  ]) tracks.push(await auditExecution({ ...config, workRoot, imageId, probeSha256, inputRoot: root, freeze }));
  const oldPlan = await json(join(workRoot, 'run/followups/oracle-plan.json')), oldLaunch = await json(join(workRoot, 'followup-bundle/run-plan.json')), harness = [];
  check(oldPlan.value.standaloneDiagnostic === true && oldPlan.value.metadata?.sourceInputSetSha256 !== freeze.inputSetSha256
    && oldLaunch.value.planSha256 === oldPlan.sha256 && oldLaunch.value.image === imageId, 'HARNESS_PLAN');
  for (const [index, entry] of flat(oldPlan.value).entries()) {
    const base = 'case-' + String(index).padStart(3, '0'), directory = join(workRoot, 'nas-followups');
    const [log, inspect, exitRaw] = await Promise.all([readFile(join(directory, base + '.log'), 'utf8'), json(join(directory, base + '.inspect.json')), readFile(join(directory, base + '.exit.txt'), 'utf8')]);
    let error;try { error = JSON.parse(log.trim()).error; } catch { }
    check(error?.category === 'input' && error.failureCodes?.includes('INPUT_CHECKSUM') && Number(exitRaw.trim()) === 1, 'HARNESS_GUARD');
    const container = verifySupplementalContainer(inspect.value, 1, { imageId, index, mode: 'replay', extra: '/followup' });
    harness.push({ caseId: entry.caseId, planSha256: oldPlan.sha256, logSha256: sha(log), status: 'harness-input-guard-rejected',
      jarExecution: 'not-reached', providerFailure: false, reason: 'standalone-followup-plan-missing-frozen-input-metadata', container });
  }
  return { schemaVersion: 1, generatedAt, scope: 'Supplemental independent observations; primary report and primary counts remain immutable',
    controlScope: 'Available original main intentionally omitted only in controls; results cannot replace original coexistence results',
    diagnosticScope: 'Original-main-missing standalone observations never certify original subscription coexistence',
    playerScope: 'playerContent return data only; no media download, decoding, rendering or playback',
    responseScope: 'Live network responses; different values or outcomes across times do not independently establish a runtime defect',
    imageId, probeSha256, inputSetSha256: freeze.inputSetSha256, freezeSha256: freezeInput.sha256,
    validation: { reproducedPlanAndParentParameters: true, collectionAndPrivateHashes: true, sourceAndLoaderContext: true,
      exactNASParameters: true, imageUIDCommandMountsExitCleanup: true, executedSourcePins: required.map(file => ({ file, sha256: sourceMap.get(file) })) },
    tracks, harnessRejectedAttempts: harness,
    reportDependencies: await Promise.all(['scripts/compat/working-source-report.mjs', 'scripts/compat/prepare-working-followups.mjs',
      'scripts/compat/prepare-working-standalone-controls.mjs'].map(async file => ({ file, sha256: sha(await readFile(join(sourceRoot, file))) }))),
    reporterSha256: sha(await readFile(SELF)) };
}

export function workingSupplementalMarkdown(report) {
  const names = { controls: '故意省略已捕获主包的对照', 'nasfollow-original': 'NAS 超时后独立补测：原始上下文', 'nasfollow-standalone': 'NAS 超时后独立补测：缺主包诊断', 'artfollow-v2': 'ART 超时后独立补测：修正输入计划' };
  const localTime = new Date(report.generatedAt).toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai', hour12: false });
  const lines = ['# 已跑通 JAR 的补充业务验证', '', `生成时间：${localTime}（Asia/Shanghai）；文件日期沿用输入批次 20261015。`, '',
    '本报告保留主轮原始结论；补测分别记录，不能合并为全面兼容率。播放解析只检查返回值，不播放媒体。', '',
    '补测计划已由父计划与私有 ART/NAS 原始证据重新生成并逐字段核对；另核对采集哈希、原参数、加载上下文、镜像、UID、只读挂载、容器退出和 runtime 清理。', ''];
  for (const track of report.tracks) {
    lines.push(`## ${names[track.tag]}`, '', `独立场景 ${track.summary.cases}；NAS ready ${track.summary.ready}；清理通过 ${track.summary.cleanupPassed}；容器零退出 ${track.summary.containerZeroExit}。`, '',
      '| 结果 | ART 本轮 | NAS |', '| --- | ---: | ---: |', ...statuses.map(status => `| ${status} | ${track.summary.art[status]} | ${track.summary.nas[status]} |`), '',
      track.control ? '这些对照故意省略可用原主包。即使成功，也只说明站点包独立执行情况，不能代替原主包与站点包共存结果。' : track.diagnostic ? '本组缺少原配置主包，只能作为独立诊断。' : '本组保留原加载上下文。', '',
      '| 补测场景 | 父场景 | API | 步骤 | ART 本轮 | NAS |', '| --- | --- | --- | --- | --- | --- |',
      ...track.cases.flatMap(row => row.calls.map(call => `| ${row.caseId} | ${row.parentCaseId} | ${row.api} | ${call.discoveryStep} | ${call.art?.status || '未重新执行'} | ${call.nas.status} |`)), '');
  }
  lines.push('## 保留的输入保护拒绝记录', '', `初次补测 ${report.harnessRejectedAttempts.length} 个容器因计划遗漏冻结输入元数据，在进入 runtime 前被 INPUT_CHECKSUM 保护拒绝；这 ${report.harnessRejectedAttempts.length} 次属于测试工具输入错误，JAR 未执行，不计为提供方/JAR 失败。修正计划后已另外记录完整新一轮。`, '',
    '空响应不等于业务可用；ART 基类缺省与 NAS 未知实现分别保留。未执行或缺少真实参数的步骤仍为未测试。', '');
  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2), opt = name => { const index = args.indexOf('--' + name); return index < 0 ? undefined : args[index + 1]; };
  const workRoot = opt('work-root'), inputRoot = opt('input-root'), outputJSON = opt('output-json'), outputMD = opt('output-md');
  check(workRoot && inputRoot && outputJSON && outputMD, 'CLI');
  const report = await buildWorkingSupplementalReport({ workRoot: resolve(workRoot), inputRoot: resolve(inputRoot) });
  await writeFile(resolve(outputJSON), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  await writeFile(resolve(outputMD), workingSupplementalMarkdown(report), { flag: 'wx' });
  console.log(JSON.stringify({ tracks: report.tracks.map(track => ({ tag: track.tag, summary: track.summary })), harnessRejected: report.harnessRejectedAttempts.length }));
}
if (process.argv[1] && resolve(process.argv[1]) === SELF) main().catch(error => { console.error(JSON.stringify({ code: /^SUPPLEMENTAL_REPORT_[A-Z_]+$/.test(error.message) ? error.message : 'SUPPLEMENTAL_REPORT_INPUT_OR_IO', fingerprint: sha(error.message) }));process.exitCode = 1; });
