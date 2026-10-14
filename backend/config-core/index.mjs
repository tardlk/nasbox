// SPDX-License-Identifier: GPL-3.0-only
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve, delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const runtime = JSON.parse(readFileSync(join(here, 'runtime.json'), 'utf8'));
const sha256 = data => createHash('sha256').update(data).digest('hex');

function javaCommand(name) {
  const home = process.env.TVBOX_JAVA_HOME || process.env.JAVA_HOME || join(root, '.tools/jdk17');
  const binary = join(home, 'bin', process.platform === 'win32' ? `${name}.exe` : name);
  return existsSync(binary) ? binary : name;
}
function javaSources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? javaSources(path) : entry.name.endsWith('.java') ? [path] : [];
  }).sort();
}

/** Offline build of committed runtime sources, independent of compat/oracle. */
export function buildConfigCore() {
  const gson = process.env.TVBOX_GSON_JAR || join(root, '.tools/lib/gson-2.10.1.jar');
  if (!existsSync(gson)) throw new Error('Gson 2.10.1 missing; set TVBOX_GSON_JAR (see backend/config-core/README.md)');
  if (sha256(readFileSync(gson)) !== runtime.gson.sha256) throw new Error('Gson checksum differs from runtime pin');
  const sources = javaSources(join(here, 'src'));
  const java = javaCommand('java'), javac = javaCommand('javac');
  const fingerprint = sha256(JSON.stringify({ runtime, javac, sources: sources.map(path => [path, sha256(readFileSync(path))]) }));
  const build = join(root, '.cache/backend/config-core', fingerprint);
  if (!existsSync(join(build, 'complete'))) {
    mkdirSync(build, { recursive: true });
    const compile = spawnSync(javac, ['--release', String(runtime.javaRelease), '-encoding', 'UTF-8',
      '-cp', gson, '-d', build, ...sources], { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
    if (compile.error || compile.status !== 0) throw new Error(`Config core compile failed: ${compile.error || compile.stderr}`);
    writeFileSync(join(build, 'complete'), fingerprint);
  }
  return { java, gson, build };
}

export class ConfigParseError extends Error {
  constructor(result) {
    super(`Android config parsing failed: ${result.errorType}`);
    this.name = 'ConfigParseError';
    this.errorType = result.errorType;
    this.partialSites = result.partialSites;
  }
}

/** One serialized configuration session per worker; always close in finally. */
export function createConfigCore({ built = buildConfigCore(), timeoutMs = 30000, maxBytes = 8 * 1024 * 1024 } = {}) {
  const child = spawn(built.java, ['-Xmx128m', '-cp', [built.build, built.gson].join(delimiter), 'tvbox.config.ConfigWorker'],
    { stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = createInterface({ input: child.stdout });
  const pending = new Map();
  let nextId = 0, closed = false, failure, stderr = '';
  const exit = new Promise(resolveExit => child.once('close', () => resolveExit()));
  function fail(error) {
    failure ||= error;
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(failure); }
    pending.clear();
    if (!child.killed) child.kill();
  }
  child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-4096); });
  child.on('error', fail);
  child.stdin.on('error', fail);
  child.on('close', (code, signal) => {
    if (!closed || pending.size) fail(new Error(`Config worker exited (${code ?? signal}): ${stderr}`));
    lines.close();
  });
  lines.on('line', line => {
    try {
      if (Buffer.byteLength(line) > maxBytes) throw new Error('Config response exceeds size limit');
      const { id, ...result } = JSON.parse(line);
      const item = pending.get(id);
      if (!item || typeof result.ok !== 'boolean') throw new Error('Invalid config worker response');
      clearTimeout(item.timer); pending.delete(id); item.resolve(result);
    } catch (error) { fail(error); }
  });
  function query(request) {
    if (closed || failure) return Promise.reject(failure || new Error('Config core is closed'));
    const id = ++nextId;
    let line;
    try {
      line = JSON.stringify({ ...request, id }) + '\n';
      if (Buffer.byteLength(line) > maxBytes) throw new Error('Config request exceeds size limit');
    } catch (error) { return Promise.reject(error); }
    return new Promise((resolveRequest, reject) => {
      const timer = setTimeout(() => fail(new Error('Config worker timed out')), timeoutMs);
      pending.set(id, { resolve: resolveRequest, reject, timer });
      child.stdin.write(line, error => { if (error) fail(error); });
    });
  }
  return {
    query,
    async parseSites(text) {
      const result = await query({ operation: 'sites', text });
      if (!result.ok) throw new ConfigParseError(result);
      return result.value;
    },
    async close() {
      if (!closed) { closed = true; child.stdin.end(); }
      const timer = setTimeout(() => fail(new Error('Config worker shutdown timed out')), timeoutMs);
      try { await exit; } finally { clearTimeout(timer); }
    },
  };
}
