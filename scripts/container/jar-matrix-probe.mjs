// SPDX-License-Identifier: GPL-3.0-only
// Captured JAR compatibility matrix. Requires Node + the prebuilt JRE runtime.
// Stdout/outputs contain metadata only; inputs and live response bodies stay private.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, openSync, readFileSync, writeSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSpiderRuntime } from '../../backend/spider-runtime/index.mjs';

const SELF = fileURLToPath(import.meta.url);
const digest = value => createHash('sha256').update(value).digest('hex');
const RUNNER_SHA256 = digest(readFileSync(SELF));
const DEFAULT_LIMITS = Object.freeze({
  loadMs: 45000, initMs: 20000, callMs: 20000, artifactMs: 180000,
  closeMs: 5000, jvmMs: 45000, maxHomeSites: 3, maxJarBytes: 128 * 1024 * 1024,
});

export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
const semanticHash = value => digest(JSON.stringify(canonical(value)));

function label(value, fallback = '') {
  const text = String(value ?? fallback);
  // Keep useful source keys while refusing URL/query/token-shaped labels.
  if (text.length > 160 || /(?:https?:|:\/\/|[?=&\r\n]|bearer\s|token[:\s])/i.test(text)) return 'sha256:' + digest(text);
  return text;
}
const classLabel = value => typeof value === 'string' && /^[\w.$]+$/.test(value) && value.length <= 240 ? value : undefined;
// Match SpiderWorker.route exactly: everything except JS/Python is a JAR route.
export const isJarSource = source => !!source && (source.type === undefined || source.type === 3) && typeof source.api === 'string' && !source.api.endsWith('.js') && !source.api.includes('.js?') && !source.api.includes('.py');
const extHashOf = source => digest(typeof source.ext === 'string' ? source.ext : JSON.stringify(source.ext ?? ''));

function helperValidationOf(value = false) {
  if (typeof value !== 'boolean') throw new Error('INPUT_SCHEMA: helperLoadValidation must be boolean');
  return value;
}

function executionIdentityOf(artifact, limits) {
  return {
    runnerSha256: RUNNER_SHA256,
    inputSha256: semanticHash({
      expectedJarSha256: artifact.sha256 ?? artifact.jarSha256 ?? null,
      role: artifact.role === 'site' ? 'site' : 'main',
      helperLoadValidation: helperValidationOf(artifact.helperLoadValidation), sites: artifact.sites,
    }),
    limitsSha256: semanticHash(limits),
  };
}

function finishLoadValidation(report) {
  const validation = report.loadValidation;
  if (!validation.attempted) {
    validation.status = 'not-tested';
    validation.reason = report.error?.stage === 'input' ? 'input-rejected'
      : report.error?.stage === 'load' ? 'registration-failed'
      : report.error ? 'runtime-not-ready' : validation.reason;
    return;
  }
  if (report.load?.loaded === true) { validation.status = 'loaded'; delete validation.error; return; }
  const failure = report.load?.error || report.error || validation.error
    || report.sites.find(row => row.init?.includesArtifactLoad)?.init?.error;
  validation.status = ['timeout', 'artifact-timeout'].includes(failure?.category) ? 'timeout'
    : (report.load?.loaded === false || failure && !['input', 'environment', 'network'].includes(failure.category)) ? 'failed' : 'unknown';
  if (failure) validation.error = failure;
  delete validation.reason;
}

function planSources(sites = []) {
  const representatives = new Map(), variants = new Map();
  let eligible = 0;
  for (const source of sites) {
    if (!isJarSource(source)) continue;
    eligible++;
    const key = source.api + '\0' + extHashOf(source);
    if (variants.has(key)) continue;
    variants.set(key, source);
    if (!representatives.has(source.api)) representatives.set(source.api, source);
  }
  return { representatives, variants, duplicateSources: eligible - variants.size, skippedNonJarSources: sites.length - eligible };
}

/** No exception messages or diagnostic text leave this boundary. */
export function classifyFailure(error, diagnosticText = '') {
  const message = String(error?.message ?? error ?? '');
  const text = [error?.errorType, error?.code, message, diagnosticText].join('\n');
  const failureCodes = [];
  for (const code of ['DUPLICATE_DEX_CLASS', 'ZIP_INVALID', 'PROTECTED_INIT_UNBOUND', 'NATIVE_GET_LOADER_NOT_READY', 'JAR_LOAD_FAILED', 'INPUT_CHECKSUM', 'INPUT_PATH', 'INPUT_SIZE', 'INPUT_SCHEMA']) if (new RegExp('\\b' + code + '\\b').test(text)) failureCodes.push(code);
  if (/ZipException|zip END header not found|invalid (?:CEN|LOC) header/i.test(text) && !failureCodes.includes('ZIP_INVALID')) failureCodes.push('ZIP_INVALID');
  if (/Dex(?:Convert|Conversion)|dex2jar|DEX_CONVERSION_FAILED/.test(text)) failureCodes.push('DEX_CONVERSION_FAILED');
  if (/UnsatisfiedLinkError/.test(text)) failureCodes.push('NATIVE_LINK_ERROR');
  let category = 'execution';
  if (error?.code === 'ARTIFACT_DEADLINE') category = 'artifact-timeout';
  else if (error?.code === 'CALL_DEADLINE' || /Spider worker timed out|shutdown timed out/i.test(text)) category = 'timeout';
  else if (error instanceof SyntaxError || /INVALID_JSON|JSON_SYNTAX/.test(text)) category = 'invalid-json';
  else if (/ClassNotFoundException|NoClassDefFoundError|NoSuchMethod(?:Exception|Error)|NoSuchField(?:Exception|Error)/.test(text)) category = 'missing-class-or-member';
  else if (/PROTECTED_INIT_UNBOUND|NATIVE_GET_LOADER_NOT_READY|UnsatisfiedLinkError|UnsupportedNative/.test(text)) category = 'native-binding';
  else if (/UnknownHostException|Socket(?:Timeout|Exception)|ConnectException|SSL\w*Exception|HTTP\s*[45]\d\d|Network is unreachable|Connection refused|ECONN|ENOTFOUND/i.test(text)) category = 'network';
  else if (/timed out|\btimeout\b/i.test(text)) category = 'timeout';
  else if (/INVALID_RESULT/.test(text)) category = 'invalid-result';
  else if (/INPUT_CHECKSUM|INPUT_PATH|INPUT_SIZE|INPUT_SCHEMA/.test(text)) category = 'input';
  else if (/Prebuilt .*missing|dependency missing|runtime missing|ENOENT/.test(text)) category = 'environment';
  else if (/SpiderNull|SPIDER_NOT_READY/.test(text)) category = 'spider-not-ready';
  return {
    category,
    type: classLabel(error?.errorType) || classLabel(error?.name) || 'Error',
    fingerprint: digest([error?.errorType ?? '', error?.code ?? '', message].join('\n')),
    ...(failureCodes.length ? { failureCodes } : {}),
  };
}

function limitsOf(value = {}) {
  const limits = { ...DEFAULT_LIMITS };
  for (const key of Object.keys(limits)) {
    if (value[key] === undefined) continue;
    if (!Number.isSafeInteger(value[key]) || value[key] < (key === 'maxHomeSites' ? 0 : 1)) throw new Error('INPUT_SCHEMA: invalid limit ' + key);
    limits[key] = value[key];
  }
  // The first pass deliberately permits at most three homepage calls per JAR.
  limits.maxHomeSites = Math.min(3, limits.maxHomeSites);
  limits.jvmMs = Math.min(limits.jvmMs, limits.artifactMs);
  return limits;
}

/** Supports artifacts or groups; all paths are checked again after realpath. */
export function normalizeManifest(manifest, { manifestPath, inputRoot } = {}) {
  if (!manifest || typeof manifest !== 'object' || ![undefined, 1].includes(manifest.schemaVersion)) throw new Error('INPUT_SCHEMA: unsupported manifest');
  const artifacts = manifest.artifacts ?? manifest.groups;
  if (!Array.isArray(artifacts)) throw new Error('INPUT_SCHEMA: artifacts must be an array');
  const base = dirname(resolve(manifestPath || 'manifest.json'));
  const root = inputRoot ? resolve(inputRoot) : resolve(base, manifest.inputRoot || '.');
  const limits = limitsOf(manifest.limits);
  const helperLoadValidation = helperValidationOf(manifest.helperLoadValidation);
  return {
    schemaVersion: 1, inputRoot: root, limits,
    artifacts: artifacts.map((artifact, index) => {
      if (!artifact || typeof artifact.jarPath !== 'string' || !Array.isArray(artifact.sites)) throw new Error('INPUT_SCHEMA: invalid artifact');
      return { ...artifact, id: label(artifact.id, 'artifact-' + index), jarPath: resolve(root, artifact.jarPath), limits: limitsOf({ ...limits, ...artifact.limits }), sites: artifact.sites,
        helperLoadValidation: helperValidationOf(artifact.helperLoadValidation ?? helperLoadValidation) };
    }),
  };
}

function contained(root, path) {
  const rel = relative(root, path);
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep);
}

async function checkArtifact(artifact, root, limits) {
  const [base, path] = await Promise.all([realpath(root), realpath(artifact.jarPath)]);
  if (!contained(base, path)) throw new Error('INPUT_PATH: JAR escapes captured input root');
  const info = await stat(path);
  if (!info.isFile() || info.size < 1 || info.size > limits.maxJarBytes) throw new Error('INPUT_SIZE: invalid JAR size');
  const bytes = await readFile(path);
  const sha256 = digest(bytes);
  const expected = artifact.sha256 ?? artifact.jarSha256;
  if (expected !== undefined && sha256 !== expected) throw new Error('INPUT_CHECKSUM: captured JAR differs');
  return { path, bytes: bytes.length, sha256 };
}

/** Do not serialize raw native report paths, owner names, logs, or plugin data. */
export function summarizeNativeState(value) {
  const result = {};
  for (const name of ['enabled', 'loaderCalls', 'spiderCalls', 'nullSpiderCalls', 'extraLoaders', 'dexLoaders', 'listeners']) {
    if (typeof value?.[name] === 'boolean' || Number.isSafeInteger(value?.[name])) result[name] = value[name];
  }
  for (const name of ['payloadLoader', 'backend', 'lastSpider']) {
    if (value?.[name] === null) result[name] = null;
    else if (classLabel(value?.[name])) result[name] = value[name];
  }
  if (value?.spiderTypes && typeof value.spiderTypes === 'object') result.spiderTypes = Object.fromEntries(Object.entries(value.spiderTypes).filter(([key, count]) => classLabel(key) && Number.isSafeInteger(count)));
  for (const name of ['report', 'payload']) if (value?.[name] != null) result[name + 'Sha256'] = semanticHash(value[name]);
  return result;
}

/** Returns private JSON separately so category/detail IDs never enter metadata. */
export function summarizeResponse(value) {
  if (typeof value !== 'string') throw new Error('INVALID_RESULT: Spider result must be a JSON string');
  const metadata = { bytes: Buffer.byteLength(value), sha256: digest(value) };
  let json;
  try { json = JSON.parse(value); }
  catch (error) { error.responseMetadata = metadata; throw error; }
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    const error = new Error('INVALID_RESULT: Spider JSON must be an object');
    error.responseMetadata = metadata;
    throw error;
  }
  return { json, metadata: {
    ...metadata, semanticSha256: semanticHash(json), fields: Object.keys(json).length,
    emptyObject: Object.keys(json).length === 0,
    hasContent: Array.isArray(json.class) && json.class.length > 0 || Array.isArray(json.list) && json.list.length > 0,
    classes: Array.isArray(json.class) ? json.class.length : null,
    list: Array.isArray(json.list) ? json.list.length : null,
    filterGroups: json.filters && typeof json.filters === 'object' ? Object.keys(json.filters).length : null,
    ...(json.class === undefined ? {} : { classSha256: semanticHash(json.class) }),
    ...(json.filters === undefined ? {} : { filtersSha256: semanticHash(json.filters) }),
  } };
}

function deadlineError(kind) {
  const error = new Error(kind === 'artifact' ? 'Artifact budget exceeded' : 'Probe call deadline exceeded');
  error.code = kind === 'artifact' ? 'ARTIFACT_DEADLINE' : 'CALL_DEADLINE';
  return error;
}

function killPid(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1 || pid === process.pid) return false;
  try { process.kill(pid, 'SIGKILL'); return true; }
  catch (error) { if (error.code === 'ESRCH') return true; return false; }
}

/** One actual JAR per runtime. runtimeFactory is injectable for offline checks. */
export async function probeJarArtifact(artifact, {
  inputRoot, limits: overrides, runtimeFactory = createSpiderRuntime, onProgress = () => {}, workRoot,
} = {}) {
  const limits = limitsOf({ ...artifact.limits, ...overrides });
  const helperLoadValidation = helperValidationOf(artifact.helperLoadValidation);
  const started = Date.now(), end = started + limits.artifactMs;
  const plan = planSources(artifact.sites);
  const report = {
    id: label(artifact.id), role: label(artifact.role, 'main'),
    chosenRole: artifact.role === 'site' ? 'site' : 'main',
    ...(Array.isArray(artifact.roles) ? { referencedRoles: artifact.roles.map(value => label(value)) } : {}),
    scope: 'Captured artifact; independent host JVM/DEX/ARM bridge; live source calls; no Android/ART parity claim',
    limits, sites: [], selected: { homes: 0, category: 0, detail: 0, search: 0 },
    sourceCount: artifact.sites?.length ?? 0, unattempted: [], cleanup: {},
    uniqueApis: plan.representatives.size, uniqueVariants: plan.variants.size,
    duplicateSources: plan.duplicateSources, skippedNonJarSources: plan.skippedNonJarSources,
    skippedNonCspSources: plan.skippedNonJarSources, // Legacy output key; means non-JAR routes.
    executionIdentity: executionIdentityOf(artifact, limits),
    loadValidation: { attempted: false, status: 'not-tested', trigger: artifact.role === 'site' ? 'site-source-init' : 'main-load',
      reason: artifact.role === 'site' && !plan.representatives.size ? 'helper-only-not-triggered' : 'not-reached' },
  };
  let runtime, directory, workerPid, fatal = false, stage = 'input';
  const diagnostics = {};
  let diagnosticText = '';
  const progress = row => { try { onProgress({ event: 'stage', artifact: report.id, ...row }); } catch {} };
  const remaining = () => end - Date.now();
  const getDiagnosticText = () => runtime?.getDiagnostics?.().stderr || diagnosticText;
  const diagnosticSince = before => { const after = getDiagnosticText(); return after.startsWith(before) ? after.slice(before.length) : after; };
  async function bounded(action, milliseconds, { cleanup = false } = {}) {
    const left = cleanup ? milliseconds : Math.min(milliseconds, remaining());
    if (left <= 0) { fatal = true; killPid(workerPid); throw deadlineError('artifact'); }
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(action),
        new Promise((_, reject) => { timer = setTimeout(() => {
          fatal = true;
          report.cleanup.forcedWorkerKill = killPid(workerPid);
          reject(deadlineError(!cleanup && remaining() <= 1 ? 'artifact' : 'call'));
        }, left); }),
      ]);
    } finally { clearTimeout(timer); }
  }
  function failed(error, diagnostic = '') {
    const metadata = classifyFailure(error, diagnostic);
    if (['timeout', 'artifact-timeout'].includes(metadata.category) || /worker exited|runtime is closed/.test(String(error?.message))) fatal = true;
    return { ok: false, error: metadata, ...(error.responseMetadata ? { response: error.responseMetadata } : {}) };
  }
  async function readState() {
    const state = await bounded(() => runtime.request({ operation: 'nativeState' }), Math.min(5000, limits.callMs));
    if (Number.isSafeInteger(state?.workerPid)) workerPid = state.workerPid;
    return summarizeNativeState(state);
  }
  async function execute(row, token, method, args) {
    stage = method;
    const before = getDiagnosticText();
    const begin = Date.now();
    try {
      const value = await bounded(() => runtime.call(token, method, args), limits.callMs);
      const result = summarizeResponse(value);
      row[method] = { ok: true, milliseconds: Date.now() - begin, ...result.metadata };
      progress({ stage: method, sourceKey: row.sourceKey, api: row.api, ok: true });
      return result.json;
    } catch (error) {
      row[method] = { ...failed(error, diagnosticSince(before)), milliseconds: Date.now() - begin };
      progress({ stage: method, sourceKey: row.sourceKey, api: row.api, ok: false, category: row[method].error.category });
      return undefined;
    }
  }
  try {
    const checked = await checkArtifact(artifact, inputRoot || dirname(artifact.jarPath), limits);
    report.input = { bytes: checked.bytes, sha256: checked.sha256 };
    progress({ stage: 'input', input: report.input, executionIdentity: report.executionIdentity });
    directory = await mkdtemp(join(workRoot || tmpdir(), 'tvbox-jar-probe-'));
    stage = 'start';
    runtime = runtimeFactory({
      nativeBridge: true, timeoutMs: limits.jvmMs, dataDir: join(directory, 'runtime'),
      onStderr: chunk => {
        diagnosticText = (diagnosticText + String(chunk)).slice(-65536);
        for (const match of String(chunk).matchAll(/\b((?:java|javax|android|org|com)\.(?:[\w$]+\.)*[A-Z][\w$]*(?:Exception|Error))\b/g)) diagnostics[match[1]] = (diagnostics[match[1]] || 0) + 1;
      },
    });
    report.nativeBefore = await readState();
    stage = 'load';
    const loadStart = Date.now();
    const siteAlias = 'matrix:' + checked.sha256;
    let admitted;
    if (report.chosenRole === 'site') {
      await bounded(() => runtime.registerJar(siteAlias, checked.path), limits.loadMs);
      report.load = { loaded: null, deferred: true, registered: true, milliseconds: Date.now() - loadStart };
      admitted = true;
    } else {
      report.loadValidation = { attempted: true, status: 'unknown', trigger: 'main-load' };
      progress({ stage: 'load-attempt', loadValidation: report.loadValidation });
      const loaded = await bounded(() => runtime.loadMain(checked.path), limits.loadMs);
      report.load = { loaded: loaded?.loaded === true, milliseconds: Date.now() - loadStart };
      if (!report.load.loaded) report.load.error = classifyFailure(new Error(String(loaded?.failure || 'JAR_LOAD_FAILED')), getDiagnosticText());
      admitted = report.load.loaded;
    }
    finishLoadValidation(report);
    progress({ stage: 'load', loaded: report.load.loaded, deferred: !!report.load.deferred, load: report.load, loadValidation: report.loadValidation, ...(report.load.error ? { category: report.load.error.category } : {}) });
    report.nativeLoaded = await readState();
    if (admitted) {
      await bounded(() => runtime.setModules({ remote: true }), limits.initMs);
      const representatives = plan.representatives;
      report.variantBudgetSkipped = plan.variants.size - representatives.size;
      const ready = [];
      if (report.chosenRole === 'site' && !representatives.size && helperLoadValidation) {
        // Trigger parseJar without counting an invented Spider as a captured API.
        // The sentinel contains '/' so no legal JVM class can be instantiated.
        stage = 'helper-load';
        report.loadValidation = { attempted: true, status: 'unknown', trigger: 'site-helper-synthetic-class' };
        progress({ stage: 'load-attempt', loadValidation: report.loadValidation });
        const begin = Date.now(), before = getDiagnosticText();
        try {
          await bounded(() => runtime.getCSP({ key: 'matrix-helper-load', type: 3, api: 'csp_/matrix-loader-validation', ext: '', jar: siteAlias }), limits.loadMs);
        } catch (error) { report.loadValidation.error = failed(error, diagnosticSince(before)).error; }
        report.loadValidation.milliseconds = Date.now() - begin;
        if (!fatal && remaining() > 0) {
          const state = await bounded(() => runtime.getState(), limits.callMs);
          report.load.loaderCount = Number.isSafeInteger(state?.jar?.loaderCount) ? state.jar.loaderCount : null;
          report.load.loaded = report.load.loaderCount === null ? null : report.load.loaderCount > 0;
          if (report.load.loaded === false) report.load.error = classifyFailure(new Error('JAR_LOAD_FAILED'), diagnosticSince(before));
          report.nativeLoaded = await readState();
        }
        finishLoadValidation(report);
        progress({ stage: 'helper-load', loaded: report.load.loaded, load: report.load, loadValidation: report.loadValidation });
      }
      for (const source of representatives.values()) {
        if (fatal || remaining() <= 0) {
          report.unattempted.push({ sourceKey: label(source.key), api: label(source.api), reason: 'artifact-budget' });
          continue;
        }
        const row = { sourceKey: label(source.key), api: label(source.api), extSha256: digest(typeof source.ext === 'string' ? source.ext : JSON.stringify(source.ext ?? '')) };
        report.sites.push(row);
        stage = 'init';
        const before = getDiagnosticText(), begin = Date.now();
        const includesArtifactLoad = report.load.deferred === true && report.load.loaded === null;
        const usedBudgetMs = includesArtifactLoad ? limits.loadMs : limits.initMs;
        if (includesArtifactLoad) {
          report.loadValidation = { attempted: true, status: 'unknown', trigger: 'site-source-init' };
          progress({ stage: 'load-attempt', loadValidation: report.loadValidation });
        }
        progress({ stage: 'init-attempt', site: { ...row, init: { attempted: true } } });
        try {
          // Only one captured artifact is admitted; preserve its loader role.
          const spider = await bounded(() => runtime.getCSP({ ...source, type: 3, jar: report.chosenRole === 'site' ? siteAlias : '' }), usedBudgetMs);
          row.init = { ok: spider?.ready === true, milliseconds: Date.now() - begin, includesArtifactLoad, usedBudgetMs, ...(classLabel(spider?.className) ? { className: spider.className } : {}) };
          if (row.init.ok) ready.push({ row, token: spider.token });
          else row.init.error = classifyFailure(new Error('SPIDER_NOT_READY: SpiderNull'), diagnosticSince(before));
        } catch (error) { row.init = { ...failed(error, diagnosticSince(before)), milliseconds: Date.now() - begin, includesArtifactLoad, usedBudgetMs }; }
        if (report.load.deferred && report.load.loaded === null && !fatal && remaining() > 0) {
          const state = await bounded(() => runtime.getState(), limits.callMs);
          report.load.loaderCount = Number.isSafeInteger(state?.jar?.loaderCount) ? state.jar.loaderCount : null;
          report.load.loaded = report.load.loaderCount === null ? null : report.load.loaderCount > 0;
          if (!report.load.loaded) report.load.error = classifyFailure(new Error('JAR_LOAD_FAILED'), getDiagnosticText());
          report.nativeLoaded = await readState();
          finishLoadValidation(report);
          progress({ stage: 'deferred-load', loaded: report.load.loaded, loaderCount: report.load.loaderCount, load: report.load, loadValidation: report.loadValidation });
        }
        progress({ stage: 'init', sourceKey: row.sourceKey, api: row.api, ready: row.init.ok, site: row, ...(row.init.error ? { category: row.init.error.category } : {}) });
      }
      let categoryCandidate;
      for (const entry of ready.slice(0, limits.maxHomeSites)) {
        if (fatal || remaining() <= 0) break;
        report.selected.homes++;
        const home = await execute(entry.row, entry.token, 'homeContent', [true]);
        const category = Array.isArray(home?.class) ? home.class.find(item => item && ['string', 'number'].includes(typeof item.type_id) && String(item.type_id).length > 0) : undefined;
        if (category && !categoryCandidate) categoryCandidate = { ...entry, id: String(category.type_id) };
      }
      if (categoryCandidate && !fatal && remaining() > 0) {
        const { row, token, id } = categoryCandidate;
        report.selected.category++;
        const category = await execute(row, token, 'categoryContent', [id, '1', true, {}]);
        const item = Array.isArray(category?.list) ? category.list.find(value => value && ['string', 'number'].includes(typeof value.vod_id) && String(value.vod_id).length > 0) : undefined;
        if (item && !fatal && remaining() > 0) {
          report.selected.detail++;
          await execute(row, token, 'detailContent', [[String(item.vod_id)]]);
        }
      }
    }
    if (!fatal && remaining() > 0) { stage = 'state'; report.nativeAfter = await readState(); }
    if (remaining() <= 0 && !report.error) report.error = classifyFailure(deadlineError('artifact'));
  } catch (error) {
    report.error = { stage, ...classifyFailure(error, getDiagnosticText()) };
  } finally {
    const closeStart = Date.now();
    if (runtime) {
      try {
        await bounded(() => runtime.close(), limits.closeMs, { cleanup: true });
        report.cleanup.closed = true;
      } catch (error) {
        report.cleanup.closed = false;
        report.cleanup.error = classifyFailure(error);
        report.cleanup.forcedWorkerKill = killPid(workerPid);
      }
    }
    report.cleanup.milliseconds = Date.now() - closeStart;
    if (workerPid) {
      try { process.kill(workerPid, 0); report.cleanup.workerExited = false; }
      catch (error) { report.cleanup.workerExited = error.code === 'ESRCH'; }
    }
    if (directory) {
      try { await rm(directory, { recursive: true, force: true }); report.cleanup.temporaryDataRemoved = true; }
      catch (error) { report.cleanup.temporaryDataRemoved = false; report.cleanup.error = classifyFailure(error); }
    }
  }
  report.diagnostics = diagnostics;
  finishLoadValidation(report);
  const attempted = new Set(report.sites.map(site => site.api + '\0' + site.extSha256));
  const exhausted = ['timeout', 'artifact-timeout'].includes(report.error?.category);
  const loadFailed = report.load?.loaded === false || (!report.sites.length && stage === 'load' && !exhausted);
  report.unattempted = [...plan.variants.values()].filter(source => !attempted.has(label(source.api) + '\0' + extHashOf(source))).map(source => ({
    sourceKey: label(source.key), api: label(source.api), extSha256: extHashOf(source),
    reason: exhausted ? 'artifact-budget' : loadFailed ? 'load-failure' : plan.representatives.get(source.api) !== source ? 'variant-budget' : report.error ? 'artifact-failure' : 'artifact-budget',
  }));
  report.unattemptedApis = plan.representatives.size - report.sites.length;
  report.allUnattemptedVariants = report.unattempted.length;
  report.unattemptedLoadFailure = report.unattempted.filter(row => row.reason === 'load-failure').length;
  report.variantBudgetSkipped = report.unattempted.filter(row => row.reason === 'variant-budget').length;
  report.budgetSkipped = report.unattempted.filter(row => row.reason === 'artifact-budget' || row.reason === 'variant-budget').length;
  report.milliseconds = Date.now() - started;
  report.observations = {
    attemptedApis: report.sites.length, readyApis: report.sites.filter(site => site.init?.ok).length,
    homes: report.sites.filter(site => site.homeContent?.ok).length,
    homesWithContent: report.sites.filter(site => site.homeContent?.ok && site.homeContent.hasContent).length,
    categories: report.sites.filter(site => site.categoryContent?.ok).length,
    categoriesWithContent: report.sites.filter(site => site.categoryContent?.ok && site.categoryContent.hasContent).length,
    details: report.sites.filter(site => site.detailContent?.ok).length,
    detailsWithContent: report.sites.filter(site => site.detailContent?.ok && site.detailContent.hasContent).length,
    budgetSkipped: report.budgetSkipped || 0,
    allUnattemptedVariants: report.allUnattemptedVariants,
    unattemptedLoadFailure: report.unattemptedLoadFailure,
  };
  return report;
}

function stopChild(child) {
  try { if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); }
  catch (error) { if (error.code !== 'ESRCH') child.kill('SIGKILL'); }
}

function unrunVariantCount(sites = []) {
  const variants = new Set();
  for (const source of sites) {
    if (isJarSource(source)) variants.add(source.api + '\0' + extHashOf(source));
  }
  return variants.size;
}

async function isolatedArtifact(manifestPath, index, artifact, { inputRoot, workRoot, onProgress }) {
  const started = Date.now();
  return new Promise(done => {
    const child = spawn(process.execPath, [SELF, '--manifest', manifestPath, '--worker-index', String(index), '--input-root', inputRoot, '--work-root', workRoot], {
      detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'ignore'],
    });
    let buffered = '', report, timedOut = false, spawnError, input, load, loadValidation;
    const sites = [];
    const timer = setTimeout(() => { timedOut = true; stopChild(child); }, artifact.limits.artifactMs + artifact.limits.closeMs + 2000);
    child.stdout.on('data', chunk => {
      buffered += chunk.toString();
      // Metadata lines are bounded too; a broken worker must not flood the parent.
      if (Buffer.byteLength(buffered) > 8 * 1024 * 1024) { stopChild(child); return; }
      let newline;
      while ((newline = buffered.indexOf('\n')) >= 0) {
        const line = buffered.slice(0, newline); buffered = buffered.slice(newline + 1);
        try {
          const event = JSON.parse(line);
          if (event.event === 'artifact') {
            report = event.artifact;
            if (!report.cleanup?.closed) stopChild(child);
          }
          else if (event.event === 'stage') {
            if (event.stage === 'input') input = event.input;
            if (event.load) load = event.load;
            if (event.loadValidation) loadValidation = event.loadValidation;
            if (['init-attempt', 'init'].includes(event.stage) && event.site) {
              const index = sites.findIndex(site => site.api === event.site.api && site.extSha256 === event.site.extSha256);
              if (index < 0) sites.push(event.site); else sites[index] = event.site;
            }
            onProgress(event);
          }
        } catch { stopChild(child); }
      }
    });
    child.on('error', error => { spawnError = error; });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      // Catch descendants if an interrupted worker exited before its JVM did.
      stopChild(child);
      if (!report || timedOut) {
        const initialized = sites.length;
        report = {
        id: artifact.id, role: label(artifact.role, 'main'), chosenRole: artifact.role === 'site' ? 'site' : 'main', sites,
        limits: artifact.limits, executionIdentity: executionIdentityOf(artifact, artifact.limits),
        ...(input ? { input } : {}), ...(load ? { load } : {}),
        loadValidation: loadValidation || { attempted: false, status: 'not-tested', trigger: artifact.role === 'site' ? 'site-source-init' : 'main-load', reason: 'runtime-not-ready' },
        error: { stage: 'isolated-worker', ...classifyFailure(timedOut ? deadlineError('artifact') : spawnError || new Error('Probe worker exited')) },
        milliseconds: Date.now() - started,
        partialProgress: true,
        unattemptedVariants: Math.max(0, unrunVariantCount(artifact.sites) - initialized),
        allUnattemptedVariants: Math.max(0, unrunVariantCount(artifact.sites) - initialized),
        budgetSkipped: timedOut ? Math.max(0, unrunVariantCount(artifact.sites) - initialized) : 0,
        observations: { attemptedApis: initialized, readyApis: sites.filter(site => site.init?.ok).length, allUnattemptedVariants: Math.max(0, unrunVariantCount(artifact.sites) - initialized), budgetSkipped: timedOut ? Math.max(0, unrunVariantCount(artifact.sites) - initialized) : 0 },
        cleanup: { closed: false, processGroupKilled: true },
        exit: { code, signal },
        };
        finishLoadValidation(report);
      }
      done(report);
    });
  });
}

export function summarizeMatrix(artifacts) {
  const result = { artifacts: artifacts.length, loaded: 0, attemptedApis: 0, readyApis: 0, homes: 0, homesWithContent: 0, categories: 0, categoriesWithContent: 0, details: 0, detailsWithContent: 0, budgetSkipped: 0, allUnattemptedVariants: 0, unattemptedLoadFailure: 0, artifactErrors: 0, failureCategories: {} };
  result.loadValidation = { attempted: 0, loaded: 0, failed: 0, timeout: 0, unknown: 0, notTested: 0 };
  const count = failure => { if (failure?.category) result.failureCategories[failure.category] = (result.failureCategories[failure.category] || 0) + 1; };
  for (const artifact of artifacts) {
    if (artifact.load?.loaded) result.loaded++;
    const validation = artifact.loadValidation;
    if (validation?.attempted) result.loadValidation.attempted++;
    const status = validation?.status === 'not-tested' ? 'notTested' : validation?.status;
    if (['loaded', 'failed', 'timeout', 'unknown', 'notTested'].includes(status)) result.loadValidation[status]++;
    if (artifact.error) result.artifactErrors++;
    count(artifact.error); count(artifact.load?.error); count(artifact.cleanup?.error);
    for (const key of ['attemptedApis', 'readyApis', 'homes', 'homesWithContent', 'categories', 'categoriesWithContent', 'details', 'detailsWithContent', 'budgetSkipped', 'allUnattemptedVariants', 'unattemptedLoadFailure']) result[key] += artifact.observations?.[key] || 0;
    for (const site of artifact.sites || []) for (const key of ['init', 'homeContent', 'categoryContent', 'detailContent']) count(site[key]?.error);
  }
  return result;
}

/** Isolated subprocesses impose a hard per-artifact process/JVM budget. */
export async function probeJarMatrix(manifest, {
  manifestPath, inputRoot, onProgress = () => {}, isolate = true, runtimeFactory,
} = {}) {
  const normalized = normalizeManifest(manifest, { manifestPath, inputRoot });
  if (isolate && !manifestPath) throw new Error('INPUT_SCHEMA: isolation requires a saved manifest');
  if (isolate && runtimeFactory) throw new Error('INPUT_SCHEMA: injected runtime requires isolate:false');
  let manifestBytesSha256;
  if (manifestPath) {
    const bytes = await readFile(manifestPath);
    if (semanticHash(JSON.parse(bytes)) !== semanticHash(manifest)) throw new Error('INPUT_CHECKSUM: saved manifest differs from requested inputs');
    manifestBytesSha256 = digest(bytes);
  }
  const started = Date.now(), artifacts = [];
  const directory = await mkdtemp(join(tmpdir(), 'tvbox-jar-matrix-'));
  const report = {
    schemaVersion: 1, date: new Date().toISOString(), host: { platform: process.platform, architecture: process.arch },
    scope: 'Independent captured JAR compatibility probes; no Android/ART equivalence certification',
    manifestSha256: semanticHash(manifest), artifacts, cleanup: {},
    runnerSha256: RUNNER_SHA256, ...(manifestBytesSha256 ? { manifestBytesSha256 } : {}),
    limitsSha256: semanticHash(normalized.limits),
  };
  try {
    for (const [index, artifact] of normalized.artifacts.entries()) {
      const artifactRoot = join(directory, 'artifact-' + index);
      await mkdir(artifactRoot);
      const result = isolate
        ? await isolatedArtifact(resolve(manifestPath), index, artifact, { inputRoot: normalized.inputRoot, workRoot: artifactRoot, onProgress })
        : await probeJarArtifact(artifact, { inputRoot: normalized.inputRoot, runtimeFactory, onProgress, workRoot: artifactRoot });
      try { await rm(artifactRoot, { recursive: true, force: true }); result.cleanup.parentTemporaryDataRemoved = true; }
      catch (error) { result.cleanup.parentTemporaryDataRemoved = false; result.cleanup.error = classifyFailure(error); }
      artifacts.push(result);
      onProgress({ event: 'artifact', artifact: result });
    }
  } finally {
    try { await rm(directory, { recursive: true, force: true }); report.cleanup.temporaryDataRemoved = true; }
    catch (error) { report.cleanup.temporaryDataRemoved = false; report.cleanup.error = classifyFailure(error); }
  }
  report.milliseconds = Date.now() - started;
  report.observations = summarizeMatrix(artifacts);
  return report;
}

function argumentsOf(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const name = argv[index];
    if (!['--manifest', '--output', '--jsonl', '--input-root', '--worker-index', '--work-root'].includes(name) || argv[index + 1] === undefined) throw new Error('INPUT_SCHEMA: Usage: node jar-matrix-probe.mjs --manifest /input/manifest.json [--output /output/report.json] [--jsonl /output/progress.jsonl]');
    options[name.slice(2)] = argv[++index];
  }
  if (!options.manifest) throw new Error('INPUT_SCHEMA: --manifest is required');
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === SELF) {
  let jsonlDescriptor;
  try {
    const options = argumentsOf(process.argv.slice(2));
    const manifestPath = resolve(options.manifest);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const normalized = normalizeManifest(manifest, { manifestPath, inputRoot: options['input-root'] });
    if (options.jsonl) {
      await mkdir(dirname(resolve(options.jsonl)), { recursive: true });
      jsonlDescriptor = openSync(resolve(options.jsonl), 'w', 0o600);
    }
    const emit = event => {
      const line = JSON.stringify(event) + '\n';
      process.stdout.write(line);
      if (jsonlDescriptor !== undefined) writeSync(jsonlDescriptor, line);
    };
    if (options['worker-index'] !== undefined) {
      const index = Number(options['worker-index']);
      if (!Number.isSafeInteger(index) || !normalized.artifacts[index]) throw new Error('INPUT_SCHEMA: invalid worker index');
      const report = await probeJarArtifact(normalized.artifacts[index], { inputRoot: normalized.inputRoot, workRoot: options['work-root'], onProgress: emit });
      emit({ event: 'artifact', artifact: report });
    } else {
      const report = await probeJarMatrix(manifest, { manifestPath, inputRoot: options['input-root'], onProgress: emit });
      emit({ event: 'summary', ...report.observations, cleanup: report.cleanup });
      if (options.output) { await mkdir(dirname(resolve(options.output)), { recursive: true }); await writeFile(resolve(options.output), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 }); }
      if (!report.cleanup.temporaryDataRemoved || report.artifacts.some(artifact => !artifact.cleanup?.closed)) process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(JSON.stringify({ event: 'fatal', error: classifyFailure(error) }) + '\n');
    process.exitCode = 1;
  } finally {
    if (jsonlDescriptor !== undefined) closeSync(jsonlDescriptor);
  }
}
