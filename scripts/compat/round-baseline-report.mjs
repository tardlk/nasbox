// SPDX-License-Identifier: GPL-3.0-only
// Strict, offline public report boundary for one frozen-input NAS baseline round.
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyCatalogFreeze } from './freeze-catalog.mjs';
import { canonical, isJarSource, normalizeManifest } from '../container/jar-matrix-probe.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const semanticHash = value => hash(JSON.stringify(canonical(value)));
const SHA = /^[a-f0-9]{64}$/, IMAGE = /^sha256:[a-f0-9]{64}$/;
const check = (condition, code) => { if (!condition) throw new Error('ROUND_' + code); };
const counts = rows => rows.reduce((result, value) => (result[value] = (result[value] || 0) + 1, result), {});
const extHash = source => hash(typeof source.ext === 'string' ? source.ext : JSON.stringify(source.ext ?? ''));
const safeApi = value => /^csp_[\w.$]+$/.test(value) && value.length <= 160 ? value : 'sha256:' + hash(value);
const runnerApi = value => value.length > 160 || /(?:https?:|:\/\/|[?=&\r\n]|bearer\s|token[:\s])/i.test(value) ? 'sha256:' + hash(value) : value;
const variantKey = value => value.api + '\0' + value.extSha256;
const contained = (root, path) => { const rel = relative(root, path); return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep); };
const CATEGORIES = new Set(['execution', 'artifact-timeout', 'timeout', 'invalid-json', 'missing-class-or-member', 'native-binding', 'network', 'invalid-result', 'input', 'environment', 'spider-not-ready']);
const CODES = new Set(['DUPLICATE_DEX_CLASS', 'ZIP_INVALID', 'PROTECTED_INIT_UNBOUND', 'NATIVE_GET_LOADER_NOT_READY', 'JAR_LOAD_FAILED', 'INPUT_CHECKSUM', 'INPUT_PATH', 'INPUT_SIZE', 'INPUT_SCHEMA', 'DEX_CONVERSION_FAILED', 'NATIVE_LINK_ERROR']);
const REASONS = new Set(['artifact-budget', 'load-failure', 'variant-budget', 'artifact-failure']);
const METHODS = ['homeContent', 'categoryContent', 'detailContent'];

async function readPinned(root, file, optional = false) {
  check(typeof file === 'string' && !isAbsolute(file) && !file.includes('\\') && file.split('/').every(part => part && part !== '.' && part !== '..'), 'PATH');
  let path = root;
  for (const part of file.split('/')) {
    path = join(path, part);
    let info;
    try { info = await lstat(path); } catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
    check(!info.isSymbolicLink(), 'SYMLINK');
  }
  check((await lstat(path)).isFile() && contained(root, await realpath(path)), 'PATH');
  const bytes = await readFile(path);
  return { bytes, sha256: hash(bytes), json: () => JSON.parse(bytes.toString('utf8')) };
}

function failure(value) {
  if (!value) return undefined;
  check(value && typeof value === 'object' && CATEGORIES.has(value.category), 'FAILURE_CATEGORY');
  check(value.fingerprint === undefined || SHA.test(value.fingerprint), 'FAILURE_FINGERPRINT');
  check(value.failureCodes === undefined || Array.isArray(value.failureCodes) && value.failureCodes.every(code => CODES.has(code)), 'FAILURE_CODE');
  return { category: value.category,
    ...(typeof value.type === 'string' && /^[\w.$]{1,240}$/.test(value.type) ? { type: value.type } : {}),
    ...(value.fingerprint ? { fingerprint: value.fingerprint } : {}),
    ...(value.failureCodes?.length ? { failureCodes: [...new Set(value.failureCodes)] } : {}) };
}

function response(value) {
  if (!value) return { status: 'not-tested' };
  check(typeof value.ok === 'boolean', 'METHOD_SCHEMA');
  const error = failure(value.error);
  if (!value.ok) return { status: error?.category === 'invalid-json' ? 'invalid-json'
    : error?.category === 'network' ? 'network' : ['timeout', 'artifact-timeout'].includes(error?.category) ? 'timeout'
      : error?.category === 'invalid-result' ? 'invalid-result' : 'failed', ...(error ? { error } : {}) };
  check(Number.isSafeInteger(value.bytes) && value.bytes >= 2 && SHA.test(value.sha256) && SHA.test(value.semanticSha256)
    && typeof value.hasContent === 'boolean' && Number.isSafeInteger(value.fields) && value.fields >= 0
    && typeof value.emptyObject === 'boolean', 'RESPONSE_SCHEMA');
  for (const key of ['classes', 'list', 'filterGroups']) check(value[key] === null || Number.isSafeInteger(value[key]) && value[key] >= 0, 'RESPONSE_SCHEMA');
  check(value.hasContent === (value.classes > 0 || value.list > 0) && value.emptyObject === (value.fields === 0), 'RESPONSE_CONTENT');
  const result = { status: value.hasContent ? 'nonempty' : 'empty', bytes: value.bytes, sha256: value.sha256,
    semanticSha256: value.semanticSha256, classes: value.classes, list: value.list, filterGroups: value.filterGroups };
  for (const key of ['classSha256', 'filtersSha256']) if (value[key] !== undefined) { check(SHA.test(value[key]), 'RESPONSE_HASH'); result[key] = value[key]; }
  return result;
}

function expectedSources(artifact) {
  const variants = new Map(), apis = new Set();
  for (const source of artifact.sites.filter(isJarSource)) {
    const api = runnerApi(source.api), extSha256 = extHash(source), key = api + '\0' + extSha256;
    apis.add(api);
    if (!variants.has(key)) variants.set(key, { api: safeApi(source.api), apiSha256: hash(source.api), extSha256 });
  }
  return { variants, apis };
}

function derivedLoadStatus(row) {
  const v = row.loadValidation;
  check(v && typeof v.attempted === 'boolean', 'LOAD_VALIDATION');
  let status;
  if (!v.attempted) status = 'not-tested';
  else if (row.load?.loaded === true) status = 'loaded';
  else {
    const error = row.load?.error || row.error || v.error || row.sites.find(site => site.init?.includesArtifactLoad)?.init?.error;
    status = ['timeout', 'artifact-timeout'].includes(error?.category) ? 'timeout'
      : row.load?.loaded === false || error && !['input', 'environment', 'network'].includes(error.category) ? 'failed' : 'unknown';
  }
  return status;
}

function loadStatus(row, errors) {
  const v = row.loadValidation, status = derivedLoadStatus(row);
  check(v.status === status, 'LOAD_STATUS');
  if (row.load?.loaded === true) check(v.attempted, 'LOAD_NOT_ATTEMPTED');
  return { status, attempted: v.attempted,
    ...(typeof v.trigger === 'string' && ['main-load', 'site-source-init', 'site-helper-synthetic-class'].includes(v.trigger) ? { trigger: v.trigger } : {}),
    ...(errors.length ? { errors } : {}) };
}

function executionIdentity(input, limits, runnerSha256) {
  return { runnerSha256, inputSha256: semanticHash({ expectedJarSha256: input.sha256,
    role: input.role, helperLoadValidation: true, sites: input.sites }), limitsSha256: semanticHash(limits) };
}

function safeArtifact(row, input, normalized, runnerSha256) {
  check(row && row.id === input.id && row.role === input.role && row.chosenRole === input.role, 'EXECUTION_ARTIFACT');
  check(Array.isArray(row.sites) && Array.isArray(row.unattempted || []), 'EXECUTION_SITES');
  check(semanticHash(row.limits) === semanticHash(normalized.limits), 'EXECUTION_LIMITS');
  const expectedIdentity = executionIdentity(input, normalized.limits, runnerSha256);
  check(semanticHash(row.executionIdentity) === semanticHash(expectedIdentity), 'EXECUTION_IDENTITY');
  if (row.input) check(row.input.sha256 === input.sha256 && row.input.bytes === input.bytes, 'EXECUTION_INPUT');
  if (row.loadValidation?.attempted || row.sites.length || row.load?.loaded === true) check(row.input?.sha256 === input.sha256, 'UNVERIFIED_EXECUTION_INPUT');
  const expected = expectedSources(input), seen = new Set(), attemptedApis = new Set(), variants = [];
  for (const site of row.sites) {
    check(typeof site.api === 'string' && SHA.test(site.extSha256), 'VARIANT_IDENTITY');
    const key = variantKey(site);
    check(expected.variants.has(key) && !seen.has(key) && !attemptedApis.has(site.api), 'VARIANT_COVERAGE');
    seen.add(key); attemptedApis.add(site.api);
    const initError = failure(site.init?.error);
    check(site.init && (typeof site.init.ok === 'boolean' || site.init.attempted === true), 'INIT_SCHEMA');
    const init = site.init.ok === true ? 'ready' : site.init.ok === false ? ['timeout', 'artifact-timeout'].includes(initError?.category) ? 'timeout'
      : initError?.category === 'network' ? 'network' : ['input', 'environment'].includes(initError?.category) ? 'unknown' : 'failed' : 'unknown';
    const methods = Object.fromEntries(METHODS.map(method => [method, response(site[method])]));
    if (Object.values(methods).some(method => method.status !== 'not-tested')) check(init === 'ready', 'BUSINESS_BEFORE_INIT');
    variants.push({ ...expected.variants.get(key), attempted: true, init, ...(initError ? { initError } : {}), methods });
  }
  for (const pending of row.unattempted || []) {
    const key = variantKey(pending);
    check(expected.variants.has(key) && !seen.has(key) && REASONS.has(pending.reason), 'UNATTEMPTED_COVERAGE');
    seen.add(key);
    variants.push({ ...expected.variants.get(key), attempted: false, init: 'not-tested', reason: pending.reason,
      methods: Object.fromEntries(METHODS.map(method => [method, { status: 'not-tested' }])) });
  }
  // A killed isolated worker records partial progress, not a complete unattempted
  // table. Recover the known missing identities and label the missing evidence.
  const missing = [...expected.variants].filter(([key]) => !seen.has(key));
  check(!missing.length || row.partialProgress === true, 'INCOMPLETE_VARIANT_COVERAGE');
  for (const [, variant] of missing) variants.push({ ...variant, attempted: false, init: 'not-tested', reason: 'worker-interrupted',
    methods: Object.fromEntries(METHODS.map(method => [method, { status: 'not-tested' }])) });
  const errors = [row.load?.error, row.error, row.loadValidation?.error].filter(Boolean).map(failure);
  const load = loadStatus(row, errors);
  const observations = { expectedApis: expected.apis.size, expectedVariants: expected.variants.size,
    attemptedApis: attemptedApis.size, readyApis: variants.filter(site => site.init === 'ready').length,
    unattemptedApis: expected.apis.size - attemptedApis.size, unattemptedVariants: variants.filter(site => !site.attempted).length,
    initStates: counts(variants.map(site => site.init)),
    methods: Object.fromEntries(METHODS.map(method => [method, counts(variants.map(site => site.methods[method].status))])) };
  return { inputVerified: !!row.input, input: { sha256: input.sha256, bytes: input.bytes }, executionIdentity: expectedIdentity,
    load, variants, observations, partialProgress: row.partialProgress === true,
    cleanup: Object.fromEntries(['closed', 'workerExited', 'temporaryDataRemoved', 'parentTemporaryDataRemoved', 'processGroupKilled', 'forcedWorkerKill'].filter(key => typeof row.cleanup?.[key] === 'boolean').map(key => [key, row.cleanup[key]])),
    ...(row.cleanup?.error ? { cleanupError: failure(row.cleanup.error) } : {}) };
}

/** Validate every available JSONL identity, even when an interrupted tail cannot
 * yield a full report. Only input-pinned events contribute execution evidence. */
function progressEvidence(raw, input, normalized, runnerSha256, interrupted, reason) {
  if (!raw) return null;
  const identity = executionIdentity(input, normalized.limits, runnerSha256), expected = expectedSources(input);
  const lines = raw.bytes.toString('utf8').split('\n');
  let verifiedInput, load, validation, finalArtifact, truncatedTail = false;
  const sites = new Map();
  const validInput = value => check(value?.sha256 === input.sha256 && value?.bytes === input.bytes, 'PROGRESS_INPUT');
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    let event;
    try { event = JSON.parse(line); }
    catch {
      check(interrupted && index === lines.length - 1, 'PROGRESS_JSON');
      truncatedTail = true; continue;
    }
    check(event && typeof event === 'object' && !Array.isArray(event), 'PROGRESS_SCHEMA');
    if (typeof event.artifact === 'string') check(event.artifact === input.id, 'PROGRESS_ARTIFACT');
    if (event.executionIdentity !== undefined) check(semanticHash(event.executionIdentity) === semanticHash(identity), 'PROGRESS_IDENTITY');
    if (event.input !== undefined) validInput(event.input);
    if (event.event === 'artifact') {
      finalArtifact = safeArtifact(event.artifact, input, normalized, runnerSha256);
      continue;
    }
    if (event.event !== 'stage') continue;
    if (event.stage === 'input') {
      validInput(event.input);
      check(semanticHash(event.executionIdentity) === semanticHash(identity), 'PROGRESS_IDENTITY');
      verifiedInput = event.input;
    }
    if (event.site !== undefined) {
      check(typeof event.site.api === 'string' && SHA.test(event.site.extSha256) && expected.variants.has(variantKey(event.site)), 'PROGRESS_VARIANT');
      if (event.api !== undefined) check(event.api === event.site.api, 'PROGRESS_VARIANT');
      if (verifiedInput && ['init-attempt', 'init'].includes(event.stage)) sites.set(variantKey(event.site), event.site);
    }
    // A load notification without a verified input event is never evidence that
    // the expected bytes entered the loader.
    if (!verifiedInput) continue;
    if (['load-attempt', 'load', 'deferred-load', 'helper-load'].includes(event.stage)) {
      if (event.loadValidation) {
        check(typeof event.loadValidation.attempted === 'boolean', 'PROGRESS_LOAD');
        validation = event.loadValidation;
      }
      if (event.load) {
        check([true, false, null].includes(event.load.loaded), 'PROGRESS_LOAD');
        load = event.load;
      }
    }
  }
  if (finalArtifact) return { ...finalArtifact, progressTruncatedTail: truncatedTail };
  if (!verifiedInput) return { ...missingResult(input), progressTruncatedTail: truncatedTail };
  const attempted = validation?.attempted === true;
  const error = { category: reason === 'outer-timeout' ? 'artifact-timeout' : 'environment', type: 'Error', fingerprint: hash('interrupted:' + reason) };
  const row = { id: input.id, role: input.role, chosenRole: input.role, input: verifiedInput,
    limits: normalized.limits, executionIdentity: identity, sites: [...sites.values()], unattempted: [], partialProgress: true,
    ...(load ? { load } : {}), error,
    loadValidation: { attempted,
      trigger: validation?.trigger || (input.role === 'main' ? 'main-load' : 'site-source-init') }, cleanup: {} };
  row.loadValidation.status = derivedLoadStatus(row);
  return { ...safeArtifact(row, input, normalized, runnerSha256), progressTruncatedTail: truncatedTail };
}

function reportArtifact(raw, input, item, manifest, normalized, plan, interrupted) {
  if (!raw) return null;
  let report;
  try { report = raw.json(); }
  catch { check(interrupted, 'REPORT_JSON'); return null; }
  check(report.schemaVersion === 1 && Array.isArray(report.artifacts) && report.artifacts.length === 1, 'REPORT_SCHEMA');
  check(report.host?.platform === 'linux' && report.host?.architecture === 'x64', 'REPORT_HOST');
  check(report.runnerSha256 === plan.runnerSha256 && report.manifestBytesSha256 === item.manifestBytesSha256
    && report.manifestSha256 === semanticHash(manifest) && report.limitsSha256 === semanticHash(normalized.limits), 'REPORT_IDENTITY');
  return { report, artifact: safeArtifact(report.artifacts[0], input, normalized, plan.runnerSha256) };
}

function missingResult(input) {
  const expected = expectedSources(input);
  return { tested: false, load: { status: 'not-tested', attempted: false }, observations: { expectedApis: expected.apis.size,
    expectedVariants: expected.variants.size, attemptedApis: 0, readyApis: 0, unattemptedApis: expected.apis.size,
    unattemptedVariants: expected.variants.size, initStates: { 'not-tested': expected.variants.size },
    methods: Object.fromEntries(METHODS.map(method => [method, { 'not-tested': expected.variants.size }])) }, variants: [...expected.variants.values()].map(variant => ({ ...variant, attempted: false, init: 'not-tested', reason: 'missing-execution', methods: Object.fromEntries(METHODS.map(method => [method, { status: 'not-tested' }])) })) };
}

async function execution(runRoot, name, item, manifest, normalized, plan) {
  const prefix = 'output/' + name + '-' + String(item.index).padStart(3, '0');
  const files = await Promise.all(['.json', '.inspect.json', '.exit.txt', '.command-exit.txt', '.jsonl'].map(suffix => readPinned(runRoot, prefix + suffix, true)));
  if (files.every(file => !file)) return missingResult(manifest.artifacts[0]);
  const [raw, dockerRaw, exitRaw, commandRaw, progressRaw] = files;
  check(dockerRaw && (commandRaw || exitRaw), 'INCOMPLETE_EXECUTION_BUNDLE');
  const inspect = dockerRaw.json();
  check(Array.isArray(inspect) && inspect.length === 1, 'DOCKER_INSPECT');
  const docker = inspect[0], parseExit = value => {
    const text = value.bytes.toString('utf8').trim();
    check(/^\d{1,3}$/.test(text) && Number(text) <= 255, 'DOCKER_EXIT');
    return Number(text);
  };
  const commandExit = parseExit(commandRaw || exitRaw), containerExit = docker.State?.ExitCode;
  if (commandRaw && exitRaw) check(commandExit === parseExit(exitRaw), 'COMMAND_EXIT_CONFLICT');
  check(Number.isSafeInteger(containerExit) && containerExit >= 0 && containerExit <= 255, 'DOCKER_EXIT');
  check(docker.Image === plan.images[name] && docker.State?.Running === false && docker.State?.Status === 'exited', 'DOCKER_IMAGE_OR_STATE');
  check(docker.Config?.User === '10001' || docker.Config?.User === '10001:10001', 'DOCKER_USER');
  const reason = docker.State.OOMKilled === true ? 'out-of-memory' : commandExit === 124 ? 'outer-timeout'
    : [137, 143].includes(commandExit) ? 'container-killed' : null;
  const interrupted = !!reason;
  if (!interrupted) check(commandExit === containerExit, 'DOCKER_EXIT_MISMATCH');
  const input = manifest.artifacts[0], parsed = reportArtifact(raw, input, item, manifest, normalized, plan, interrupted);
  const progress = progressEvidence(progressRaw, input, normalized, plan.runnerSha256, interrupted, reason);
  let artifact;
  if (interrupted) {
    artifact = parsed?.artifact || progress || missingResult(input);
    // A complete validated report may preserve earlier load/init evidence, but
    // an interrupted container never satisfies complete-execution coverage.
    artifact = { ...artifact, tested: false, interrupted: true, interruption: reason, runnerReportPresent: !!parsed,
      cleanup: artifact.cleanup || {}, partialProgress: true };
  } else {
    check(parsed, 'INCOMPLETE_EXECUTION_BUNDLE');
    artifact = parsed.artifact;
    check(parsed.report.cleanup?.temporaryDataRemoved === true, 'REPORT_CLEANUP');
    check(commandExit === (artifact.cleanup.closed === true ? 0 : 1), 'DOCKER_EXIT_REPORT');
    artifact = { ...artifact, tested: true, runnerReportPresent: true };
  }
  return { ...(raw ? { rawReportSha256: raw.sha256 } : {}), inspectSha256: dockerRaw.sha256,
    ...(exitRaw ? { exitSha256: exitRaw.sha256 } : {}), ...(commandRaw ? { commandExitSha256: commandRaw.sha256 } : {}),
    ...(progressRaw ? { progressSha256: progressRaw.sha256 } : {}),
    docker: { image: docker.Image, commandExit, containerExit, exitCode: containerExit, user: docker.Config.User, oomKilled: docker.State.OOMKilled === true }, ...artifact };
}

function summary(artifacts, name) {
  const passes = artifacts.map(row => row[name]);
  const add = key => passes.reduce((sum, pass) => sum + pass.observations[key], 0);
  return { plannedArtifacts: artifacts.length, executionReports: passes.filter(pass => pass.tested).length,
    interruptedExecutions: passes.filter(pass => pass.interrupted).length,
    validArtifacts: artifacts.filter(row => row.validZip).length,
    validArtifactLoads: counts(artifacts.filter(row => row.validZip).map(row => row[name].load.status)),
    invalidContentLoads: counts(artifacts.filter(row => !row.validZip).map(row => row[name].load.status)),
    loadStates: counts(passes.map(pass => pass.load.status)), attemptedApis: add('attemptedApis'), readyApis: add('readyApis'),
    expectedApis: add('expectedApis'), expectedVariants: add('expectedVariants'), unattemptedApis: add('unattemptedApis'), unattemptedVariants: add('unattemptedVariants'),
    initStates: counts(passes.flatMap(pass => pass.variants.map(row => row.init))),
    methods: Object.fromEntries(METHODS.map(method => [method, counts(passes.flatMap(pass => pass.variants.map(row => row.methods[method].status)))])),
    cleanupIncomplete: passes.filter(pass => (pass.tested || pass.interrupted) && (pass.cleanup.closed !== true || pass.cleanup.parentTemporaryDataRemoved !== true)).length };
}

function queue(artifacts) {
  return artifacts.filter(row => row.validZip && (row.final.load.status !== 'loaded' || row.final.variants.some(site => !['ready', 'not-tested'].includes(site.init)))).map(row => {
    const errors = [...(row.final.load.errors || []), ...row.final.variants.flatMap(site => site.initError ? [site.initError] : [])];
    const codes = new Set(errors.flatMap(error => error.failureCodes || []));
    const cluster = codes.has('PROTECTED_INIT_UNBOUND') ? 'protection'
      : codes.has('NATIVE_GET_LOADER_NOT_READY') || codes.has('NATIVE_LINK_ERROR') ? 'native-loader'
        : row.final.load.status === 'timeout' || errors.some(error => ['timeout', 'artifact-timeout'].includes(error.category)) ? 'timeout'
          : errors.some(error => error.category === 'network') && errors.every(error => error.category === 'network') ? 'network-or-state'
          : ['not-tested', 'unknown'].includes(row.final.load.status) ? 'unresolved-coverage' : 'general-execution';
    return { sha256: row.sha256, index: row.index, role: row.role, cluster, load: row.final.load.status, errors };
  }).sort((a, b) => ['protection', 'native-loader', 'general-execution', 'timeout', 'network-or-state', 'unresolved-coverage'].indexOf(a.cluster) - ['protection', 'native-loader', 'general-execution', 'timeout', 'network-or-state', 'unresolved-coverage'].indexOf(b.cluster) || a.index - b.index);
}

/** Verifies every frozen byte and every execution identity before publishing. */
export async function roundBaselineReport({ capture, run } = {}) {
  const captureRoot = await realpath(resolve(capture)), runRoot = await realpath(resolve(run));
  check(!contained(captureRoot, runRoot), 'RUN_INSIDE_CAPTURE');
  const verified = await verifyCatalogFreeze({ directory: captureRoot });
  const [freezeRaw, inputRaw, planRaw, artifactRaw] = await Promise.all([
    readPinned(captureRoot, 'freeze.json'), readPinned(captureRoot, 'input-manifest.json'), readPinned(runRoot, 'plan.json'), readPinned(captureRoot, 'artifact-inventory.json'),
  ]);
  const freeze = freezeRaw.json(), input = inputRaw.json(), plan = planRaw.json(), inventory = artifactRaw.json();
  check(plan.schemaVersion === 1 && Array.isArray(plan.cases) && plan.cases.length === input.artifacts.length, 'PLAN_SCHEMA');
  check(plan.freezeSha256 === freezeRaw.sha256 && plan.inputManifestSha256 === inputRaw.sha256 && SHA.test(plan.runnerSha256), 'PLAN_INPUT_IDENTITY');
  check(freeze.scripts.some(row => row.file === 'scripts/container/jar-matrix-probe.mjs' && row.sha256 === plan.runnerSha256), 'RUNNER_NOT_FROZEN');
  check(IMAGE.test(plan.images?.old) && IMAGE.test(plan.images?.final) && plan.images.old !== plan.images.final, 'PLAN_IMAGES');
  const planNormalized = normalizeManifest({ schemaVersion: 1, inputRoot: '/input', limits: plan.limits, artifacts: [] }, { inputRoot: '/input' });
  const artifacts = [], seen = new Set();
  for (const [position, item] of plan.cases.entries()) {
    check(item.index === position && item.index <= 999 && item.manifest === 'manifests/case-' + String(item.index).padStart(3, '0') + '.json', 'CASE_INDEX');
    check(SHA.test(item.id) && !seen.has(item.id) && ['main', 'site'].includes(item.role) && typeof item.validZip === 'boolean', 'CASE_IDENTITY');
    seen.add(item.id);
    const original = input.artifacts.find(row => row.id === item.id), frozen = freeze.artifacts.find(row => row.sha256 === item.id);
    check(original && frozen && frozen.validContent === item.validZip && frozen.roles.includes(item.role), 'CASE_FROZEN_ARTIFACT');
    const manifestRaw = await readPinned(runRoot, item.manifest), manifest = manifestRaw.json();
    check(manifestRaw.sha256 === item.manifestBytesSha256 && manifest.schemaVersion === 1 && manifest.inputRoot === '/input'
      && manifest.helperLoadValidation === true && Array.isArray(manifest.artifacts) && manifest.artifacts.length === 1, 'CASE_MANIFEST');
    const artifact = manifest.artifacts[0], expected = { ...original, role: item.role };
    // Either manifest-level or explicit artifact-level helper switch is valid.
    if (Object.hasOwn(artifact, 'helperLoadValidation')) expected.helperLoadValidation = true;
    check(semanticHash(artifact) === semanticHash(expected), 'CASE_MANIFEST_SEMANTIC');
    const normalized = normalizeManifest(manifest, { inputRoot: '/input' });
    check(semanticHash(normalized.limits) === semanticHash(planNormalized.limits) && semanticHash(normalized.artifacts[0].limits) === semanticHash(planNormalized.limits), 'CASE_LIMITS');
    const [old, final] = await Promise.all(['old', 'final'].map(name => execution(runRoot, name, item, manifest, normalized, plan)));
    artifacts.push({ index: item.index, sha256: item.id, role: item.role, referencedRoles: frozen.roles,
      validZip: item.validZip, bytes: original.bytes, manifestBytesSha256: manifestRaw.sha256, manifestSemanticSha256: semanticHash(manifest),
      ...(Number.isSafeInteger(item.shard) && item.shard >= 0 ? { shard: item.shard } : typeof item.shard === 'string' ? { shardSha256: hash(item.shard) } : {}), old, final,
      loadTransition: old.load.status === 'loaded' && final.load.status === 'failed' ? 'candidate-regression'
        : old.load.status === 'failed' && final.load.status === 'loaded' ? 'improved' : old.load.status === final.load.status ? 'same' : 'coverage-or-changed' });
  }
  check(seen.size === input.artifacts.length, 'CASE_COVERAGE');
  const retrievalFailures = inventory.retrievals.filter(row => !row.ok);
  const report = { schemaVersion: 1, generatedAt: new Date().toISOString(),
    scope: 'Same frozen JAR/config/ext bytes on two NAS images. Each artifact selects one loader role; other roles and same-API ext variants are not exhaustively executed. Live business responses are observations, not deterministic replay or Android parity.',
    identity: { inputSetSha256: verified.inputSetSha256, freezeSha256: freezeRaw.sha256, inputManifestSha256: inputRaw.sha256, planSha256: planRaw.sha256,
      runnerSha256: plan.runnerSha256, images: { old: plan.images.old, final: plan.images.final }, limits: planNormalized.limits, limitsSha256: semanticHash(planNormalized.limits) },
    capture: { catalogEntries: freeze.captures.length, acceptedSubscriptions: freeze.captures.filter(row => row.accepted).length,
      partialSubscriptions: freeze.captures.filter(row => row.partial && !row.accepted).length,
      failedWithoutConfigSubscriptions: freeze.captures.filter(row => !row.accepted && !row.partial).length,
      requestedSignatures: inventory.retrievals.length,
      downloadFailures: retrievalFailures.length, downloadFailureCodes: counts(retrievalFailures.map(row => /^[A-Z0-9_]{1,80}$/.test(row.error?.code) ? row.error.code : 'other')),
      downloadedArtifacts: input.artifacts.length, validArtifacts: freeze.artifacts.filter(row => row.validContent).length,
      invalidDownloadedContent: freeze.artifacts.filter(row => !row.validContent).map(row => ({ sha256: row.sha256, bytes: row.bytes })) },
    coverage: { completeArtifactExecution: artifacts.every(row => row.old.tested && row.final.tested),
      completeValidLoadAttempts: artifacts.filter(row => row.validZip).every(row => row.old.load.attempted && row.final.load.attempted),
      rolePolicy: 'one-selected-role-per-artifact', allRolesExhaustive: false, allExtVariantsExhaustive: false },
    summary: { old: summary(artifacts, 'old'), final: summary(artifacts, 'final'),
      loadTransitions: counts(artifacts.map(row => row.old.load.status + ' -> ' + row.final.load.status)),
      candidateRegressions: artifacts.filter(row => row.loadTransition === 'candidate-regression').map(row => row.sha256) },
    failurePriority: queue(artifacts), artifacts };
  await verifyCatalogFreeze({ directory: captureRoot });
  return report;
}

export function roundBaselineMarkdown(report) {
  const old = report.summary.old, final = report.summary.final;
  return '# JAR 第一轮同版本冻结基线\n\n' +
    `目录订阅 ${report.capture.catalogEntries} 项：完整解析 ${report.capture.acceptedSubscriptions} 项、部分配置 ${report.capture.partialSubscriptions} 项、无配置失败 ${report.capture.failedWithoutConfigSubscriptions} 项。\n\n` +
    `冻结输入 ${report.identity.inputSetSha256}。下载失败 ${report.capture.downloadFailures} 项；取得 ${report.capture.downloadedArtifacts} 份制品，其中有效 ${report.capture.validArtifacts} 份、内容无效 ${report.capture.invalidDownloadedContent.length} 份。\n\n` +
    `旧镜像：${report.identity.images.old}。最终镜像：${report.identity.images.final}。Runner：${report.identity.runnerSha256}。\n\n` +
    '| 观测 | 旧镜像 | 最终镜像 |\n| --- | ---: | ---: |\n' +
    [['实际报告', old.executionReports, final.executionReports], ...['loaded', 'failed', 'timeout', 'unknown', 'not-tested'].map(status => ['有效制品加载 ' + status, old.validArtifactLoads[status] || 0, final.validArtifactLoads[status] || 0]), ['初始化 API', old.attemptedApis, final.attemptedApis], ['初始化 ready', old.readyApis, final.readyApis], ['未初始化变体', old.unattemptedVariants, final.unattemptedVariants], ['非空首页', old.methods.homeContent.nonempty || 0, final.methods.homeContent.nonempty || 0], ['空首页', old.methods.homeContent.empty || 0, final.methods.homeContent.empty || 0]].map(row => '| ' + row.join(' | ') + ' |').join('\n') +
    '\n\n每份制品仅选择一个加载角色，同 API 的不同 ext 并未穷举。加载、初始化 ready 与业务非空分别统计；未执行、超时、网络和 JSON 错误均单列。业务响应为在线观察，未证明 Android/ART 一致性，也不据此给出全面兼容率。\n\n' +
    '| 序号 | JAR SHA 前 12 位 | 角色 | 内容 | 旧加载 → 最终加载 | ready 旧 → 最终 |\n| ---: | --- | --- | --- | --- | ---: |\n' +
    report.artifacts.map(row => `| ${String(row.index).padStart(3, '0')} | ${row.sha256.slice(0, 12)} | ${row.role} | ${row.validZip ? '有效' : '无效'} | ${row.old.load.status} → ${row.final.load.status} | ${row.old.observations.readyApis} → ${row.final.observations.readyApis} |`).join('\n') + '\n';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), options = {};
    check(args.length % 2 === 0, 'CLI');
    for (let index = 0; index < args.length; index += 2) { check(['--capture', '--run', '--output', '--markdown'].includes(args[index]) && !options[args[index]], 'CLI'); options[args[index]] = args[index + 1]; }
    check(['--capture', '--run', '--output', '--markdown'].every(key => options[key]), 'CLI');
    const root = await realpath(resolve(options['--capture']));
    const outputTargets = [];
    for (const key of ['--output', '--markdown']) {
      const target = resolve(options[key]), actual = join(await realpath(dirname(target)), basename(target));
      check(!contained(root, actual), 'OUTPUT_INSIDE_CAPTURE');
      outputTargets.push(actual);
    }
    check(outputTargets[0] !== outputTargets[1], 'OUTPUT_TARGET_CONFLICT');
    const report = await roundBaselineReport({ capture: options['--capture'], run: options['--run'] });
    await writeFile(resolve(options['--output']), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await writeFile(resolve(options['--markdown']), roundBaselineMarkdown(report), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    process.stderr.write(JSON.stringify({ ok: false, code: /^ROUND_[A-Z_]+$/.test(error.message) ? error.message : 'ROUND_IO_OR_SCHEMA', errorSha256: hash(String(error.message)) }) + '\n');
    process.exitCode = 1;
  }
}
