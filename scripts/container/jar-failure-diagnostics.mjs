// SPDX-License-Identifier: GPL-3.0-only
// Targeted captured-artifact diagnostics. Raw plugin logs remain in memory only.
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSpiderRuntime } from '../../backend/spider-runtime/index.mjs';
import { classifyFailure, isJarSource, normalizeManifest, summarizeResponse } from './jar-matrix-probe.mjs';

const SELF = fileURLToPath(import.meta.url);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const JAVA = '(?:[A-Za-z_$][\\w$]*\\.)+[A-Za-z_$][\\w$]*';
const JAVA_RE = new RegExp('^' + JAVA + '$');
const CLASS_LITERAL = /^(?:[A-Za-z_$][\w$]*[/.])+[A-Za-z_$][\w$]*$/;
const TYPE_RE = new RegExp('^(?:void|boolean|byte|char|short|int|long|float|double|' + JAVA + ')(?:\\[\\])*$');
const CLASS_ERROR = /\b(?:java\.lang\.)?(ClassNotFoundException|NoClassDefFoundError):\s*([^\s:'"<>]+)/g;
const safeType = value => TYPE_RE.test(value) && value.length < 240;
function safeClass(value) {
  if (typeof value !== 'string' || value.length > 240 || !CLASS_LITERAL.test(value)) return undefined;
  const name = value.replaceAll('/', '.');
  return JAVA_RE.test(name) ? name : undefined;
}
function safeMethod(text) {
  const match = text.trim().match(/^(?:(\S+)\s+)?([\w.$]+)\.([\w$]+)\(([^()]*)\)$/);
  if (!match || !safeClass(match[2]) || match[1] && !safeType(match[1])) return undefined;
  const args = match[4].trim() ? match[4].split(',').map(value => value.trim()) : [];
  if (args.length > 24 || !args.every(safeType)) return undefined;
  return { kind: 'method', owner: match[2], name: match[3], parameters: args, ...(match[1] ? { returns: match[1] } : {}) };
}

/** Only exception-anchored Java grammar is retained; never save arbitrary lines. */
export function extractMissingSymbols(value) {
  const text = String(value ?? '').slice(-1024 * 1024), symbols = [], types = new Set();
  const add = symbol => { if (symbol && !symbols.some(prior => JSON.stringify(prior) === JSON.stringify(symbol))) symbols.push(symbol); };
  for (const match of text.matchAll(/\b((?:java|javax|android|org|com)\.[\w.$]*(?:Exception|Error))(?=:)/g)) if (JAVA_RE.test(match[1])) types.add(match[1]);
  for (const match of text.matchAll(CLASS_ERROR)) {
    const name = safeClass(match[2]);
    if (name) add({ kind: 'class', name });
  }
  for (const match of text.matchAll(/\bNoClassDefFoundError:\s*Failed resolution of:\s*L([\w/$]+);/g)) { const name = safeClass(match[1]); if (name) add({ kind: 'class', name }); }
  for (const match of text.matchAll(/\bNoSuchMethod(?:Error|Exception):\s*['"]?([^\r\n'"]{1,600})['"]?/g)) add(safeMethod(match[1]));
  for (const match of text.matchAll(/\bNoSuchField(?:Error|Exception):\s*['"]?([^\s'"\r\n]{1,300})/g)) {
    const field = match[1].match(/^([\w.$]+)\.([A-Za-z_$][\w$]*)$/);
    if (field && safeClass(field[1])) add({ kind: 'field', owner: field[1], name: field[2] });
  }
  for (const match of text.matchAll(/\bVerifyError:[^\r\n]*?\n\s*Exception Details:\s*\n\s*Location:\s*\n\s*([\w/$]+)\.[\w$]+\(/g)) {
    const name = safeClass(match[1]); if (name) add({ kind: 'verify-class', name });
  }
  return { exceptionTypes: [...types].sort(), missingSymbols: symbols };
}

export async function diagnoseJarFailure(manifest, {
  manifestPath, id, api, home = false, inputRoot, runtimeFactory = createSpiderRuntime,
} = {}) {
  const normalized = normalizeManifest(manifest, { manifestPath, inputRoot });
  const artifact = normalized.artifacts.find(value => value.id === id || value.sha256 === id || value.jarSha256 === id);
  if (!artifact) throw new Error('INPUT_SCHEMA: artifact id not found');
  const report = { schemaVersion: 1, id: artifact.id, role: artifact.role === 'site' ? 'site' : 'main', targets: [], cleanup: {} };
  const started = Date.now(), limits = artifact.limits;
  const end = started + limits.artifactMs;
  let runtime, directory, workerPid, stopped = false, stderr = '', loadFailure = '';
  const evidence = value => extractMissingSymbols(value);
  const kill = () => { if (workerPid && workerPid !== process.pid) try { process.kill(workerPid, 'SIGKILL'); } catch {} };
  async function bounded(action, ms, close = false) {
    let timer;
    const wait = close ? ms : Math.min(ms, Math.max(1, end - Date.now()));
    try { return await Promise.race([Promise.resolve().then(action), new Promise((_, reject) => { timer = setTimeout(() => { stopped = true; kill(); const error = new Error('Probe call deadline exceeded'); error.code = 'CALL_DEADLINE'; reject(error); }, wait); })]); }
    finally { clearTimeout(timer); }
  }
  async function collect(since = 0, extra = '') {
    let logs = '';
    if (!stopped) try { logs = JSON.stringify(await bounded(() => runtime.request({ operation: 'logs' }), Math.min(3000, limits.callMs))); } catch {}
    return evidence(stderr.slice(since) + '\n' + logs + '\n' + extra);
  }
  try {
    const [root, path] = await Promise.all([realpath(normalized.inputRoot), realpath(artifact.jarPath)]);
    const rel = relative(root, path);
    if (isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep)) throw new Error('INPUT_PATH');
    const info = await stat(path);
    if (!info.isFile() || info.size < 1 || info.size > limits.maxJarBytes) throw new Error('INPUT_SIZE');
    const bytes = await readFile(path), hash = sha256(bytes), expected = artifact.sha256 ?? artifact.jarSha256;
    if (!expected || hash !== expected) throw new Error('INPUT_CHECKSUM');
    report.input = { sha256: hash, bytes: bytes.length };
    directory = await mkdtemp(join(tmpdir(), 'tvbox-jar-diagnostic-'));
    runtime = runtimeFactory({ nativeBridge: true, timeoutMs: limits.jvmMs, dataDir: join(directory, 'runtime'), onStderr: chunk => { stderr = (stderr + String(chunk)).slice(-1024 * 1024); } });
    const state = await bounded(() => runtime.request({ operation: 'nativeState' }), limits.callMs);
    if (Number.isSafeInteger(state?.workerPid)) workerPid = state.workerPid;
    const alias = 'diagnostic:' + hash;
    if (report.role === 'site') { await bounded(() => runtime.registerJar(alias, path), limits.loadMs); report.load = { deferred: true, loaded: null }; }
    else {
      const loaded = await bounded(() => runtime.loadMain(path), limits.loadMs);
      report.load = { loaded: loaded?.loaded === true };
      if (!report.load.loaded) { loadFailure = String(loaded?.failure || 'JAR_LOAD_FAILED'); report.load.error = classifyFailure(new Error(loadFailure)); }
    }
    report.load.evidence = await collect(0, loadFailure);
    if (report.load.loaded !== false && !stopped) {
      await bounded(() => runtime.setModules({ remote: true }), limits.initMs);
      const unique = [...new Map(artifact.sites.filter(isJarSource).map(value => [value.api, value])).values()];
      if (api) unique.sort((a, b) => Number(b.api === api) - Number(a.api === api));
      for (const source of unique.slice(0, 3)) {
        if (stopped || Date.now() >= end) break;
        const target = { api: /^[\w.$]+$/.test(source.api) ? source.api : 'sha256:' + sha256(source.api), sourceKeySha256: sha256(String(source.key ?? '')) };
        report.targets.push(target);
        const since = stderr.length;
        let targetFailure = '';
        try {
          const includesArtifactLoad = report.role === 'site' && report.load.loaded === null;
          const spider = await bounded(() => runtime.getCSP({ ...source, type: 3, jar: report.role === 'site' ? alias : '' }), includesArtifactLoad ? limits.loadMs : limits.initMs);
          target.ready = spider?.ready === true;
          if (safeClass(spider?.className)) target.className = spider.className;
          if (includesArtifactLoad && !stopped) {
            const state = await bounded(() => runtime.getState(), limits.callMs);
            report.load.loaded = Number.isSafeInteger(state?.jar?.loaderCount) ? state.jar.loaderCount > 0 : null;
          }
          if (home && target.ready) {
            const value = await bounded(() => runtime.call(spider.token, 'homeContent', [true]), limits.callMs);
            target.home = summarizeResponse(value).metadata;
          }
        } catch (error) { target.error = classifyFailure(error); targetFailure = [error?.errorType, error?.message].join(': '); }
        target.evidence = await collect(since, targetFailure);
      }
    }
  } catch (error) { report.error = classifyFailure(error); if (runtime) report.evidence = await collect(); }
  finally {
    if (runtime) try { await bounded(() => runtime.close(), limits.closeMs, true); report.cleanup.closed = true; } catch (error) { kill(); report.cleanup.closed = false; report.cleanup.error = classifyFailure(error); }
    if (directory) { await rm(directory, { recursive: true, force: true }); report.cleanup.temporaryDataRemoved = true; }
  }
  report.milliseconds = Date.now() - started;
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === SELF) {
  try {
    const options = {};
    for (let i = 2; i < process.argv.length; i++) { const name = process.argv[i]; if (name === '--home') options.home = true; else if (['--manifest', '--id', '--api', '--output'].includes(name) && process.argv[i + 1]) options[name.slice(2)] = process.argv[++i]; else throw new Error('INPUT_SCHEMA'); }
    if (!options.manifest || !options.id || !options.output) throw new Error('INPUT_SCHEMA');
    const manifestPath = resolve(options.manifest), manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const report = await diagnoseJarFailure(manifest, { ...options, manifestPath });
    await mkdir(dirname(resolve(options.output)), { recursive: true });
    await writeFile(resolve(options.output), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    process.stdout.write(JSON.stringify(report) + '\n');
    if (!report.cleanup.closed) process.exitCode = 1;
  } catch (error) { process.stderr.write(JSON.stringify({ error: classifyFailure(error) }) + '\n'); process.exitCode = 1; }
}
