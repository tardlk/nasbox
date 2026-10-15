// SPDX-License-Identifier: GPL-3.0-only
import { mkdir, readFile, writeFile, rename, unlink, readdir, lstat, utimes, rm, mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { acquireDirectoryLease } from './directory-lease.mjs';
import { planJarSource, decodeImageJar, resolveJarFile } from './artifact-source.mjs';

export const JAR_CACHE_AGE_MS = 3 * 24 * 60 * 60 * 1000; // Pinned FileUtils.isWeekAgo, despite its name.
const hash = (bytes, algorithm = 'sha256') => createHash(algorithm).update(bytes).digest('hex');
const managed = /^(main|site)-[a-f0-9]{32}\.(jar|json)$/;
const checkKey = key => { if (!/^(main|site)-[a-f0-9]{32}$/.test(key)) throw new ArtifactError('INVALID_JAR_CACHE_KEY'); };
const ignoreMissing = error => { if (error.code !== 'ENOENT') throw error; };
export class ArtifactError extends Error {
  constructor(code) { super(code); this.name = 'ArtifactError'; this.code = code; }
}
// Java String.trim and split(regex) drop trailing empty fields, unlike JS trim/split.
const javaTrim = value => value.replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, '');
export function jarUrlKey(source) {
  // Original MD5.string2MD5 casts each UTF-16 char to byte; it does not hash UTF-8.
  const bytes = Buffer.alloc(source.length);
  for (let i = 0; i < source.length; i++) bytes[i] = source.charCodeAt(i) & 255;
  return hash(bytes, 'md5');
}
export function jarSignature(signature, { role = 'site' } = {}) {
  if (typeof signature !== 'string' || !signature) throw new ArtifactError('EMPTY_JAR_SIGNATURE');
  const parts = signature.split(';md5;');
  while (parts.length && parts.at(-1) === '') parts.pop();
  if (!parts.length) throw new ArtifactError('EMPTY_JAR_SIGNATURE');
  return { source: role === 'main' || parts.length > 1 ? parts[0] : signature, md5: parts.length > 1 ? javaTrim(parts[1]) : '' };
}
export function jarCacheRule({ role, useCache = false, jarCache = 'true', expectedMd5 = '', entry, now }) {
  if (!entry) return null;
  if (role === 'main' && useCache) return 'forced';
  if (expectedMd5) return entry.md5.toLowerCase() === expectedMd5.toLowerCase() ? 'md5' : null;
  if ((role === 'site' || String(jarCache).toLowerCase() === 'true') && now - entry.downloadedAt <= JAR_CACHE_AGE_MS) return 'age';
  return null;
}

/** Bounded Node transport; HTTP/DNS/TLS/cookie parity with Android remains unverified. */
export async function fetchArtifactBytes(url, { timeoutMs = 25000, maxBytes = 64 * 1024 * 1024, signal, allowEmpty = false, responseText = false, userAgent = 'okhttp/3.12.11' } = {}) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new ArtifactError('JAR_URL_INVALID'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new ArtifactError('JAR_SCHEME_UNAVAILABLE');
  const deadline = AbortSignal.timeout(timeoutMs);
  const response = await fetch(parsed, { headers: { 'User-Agent': userAgent }, signal: signal ? AbortSignal.any([signal, deadline]) : deadline });
  try {
    if (!response.ok) throw new ArtifactError('JAR_HTTP_' + response.status);
    if (Number(response.headers.get('content-length')) > maxBytes) throw new ArtifactError('JAR_SIZE_LIMIT');
    const chunks = []; let size = 0;
    for await (const chunk of response.body || []) {
      size += chunk.length;
      if (size > maxBytes) throw new ArtifactError('JAR_SIZE_LIMIT');
      chunks.push(Buffer.from(chunk));
    }
    if (!size && !allowEmpty) throw new ArtifactError('EMPTY_JAR');
    const bytes = Buffer.concat(chunks);
    if (!responseText) return bytes;
    let encoding = /charset\s*=\s*["']?([^\s;"']+)/i.exec(response.headers.get('content-type') || '')?.[1] || 'utf-8';
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) encoding = 'utf-8';
    else if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le';
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be';
    try { return new TextDecoder(encoding).decode(bytes); }
    catch { return new TextDecoder('utf-8').decode(bytes); }
  } finally { await response.body?.cancel().catch(() => {}); }
}

/** One owner per directory; immutable pinned files cannot be evicted while loaded. */
export class JarArtifactCache {
  #ready; #queue = Promise.resolve(); #closed = false; #closing; #lease;
  #pins = new Set(); #controller = new AbortController(); #root; #owned;
  constructor({ directory, maxBytes = 128 * 1024 * 1024, maxArtifactBytes = 64 * 1024 * 1024,
    maxImageBytes = Math.ceil(maxArtifactBytes * 4 / 3) + 1024 * 1024, assetRoot, externalRoot, fileRoot, localAddress,
    timeoutMs = 25000, integrity = 'android', fetchBytes = fetchArtifactBytes, now = Date.now, recoverLegacyLock = false } = {}) {
    for (const value of [maxBytes, maxArtifactBytes, maxImageBytes, timeoutMs]) if (!Number.isSafeInteger(value) || value <= 0) throw new ArtifactError('INVALID_JAR_LIMIT');
    if (!['android', 'strict'].includes(integrity)) throw new ArtifactError('INVALID_JAR_INTEGRITY_POLICY');
    Object.assign(this, { maxBytes, maxArtifactBytes, maxImageBytes, assetRoot, externalRoot, fileRoot, localAddress, timeoutMs, integrity, fetchBytes, now });
    this.#owned = !directory;
    this.#ready = (async () => {
      this.#root = directory ? resolve(directory, 'jar-artifacts-v1') : await mkdtemp(join(tmpdir(), 'tvbox-jar-cache-'));
      await mkdir(this.#root, { recursive: true, mode: 0o700 });
      this.#lease = await acquireDirectoryLease(this.#root).catch(error => { if(error.code==='CACHE_ALREADY_OWNED')throw new ArtifactError('JAR_CACHE_ALREADY_OWNED');throw error; });
      const legacy=await lstat(join(this.#root,'.lock')).catch(error=>{ignoreMissing(error);return null;});
      if(legacy){if(!recoverLegacyLock||!legacy.isFile())throw new ArtifactError('LEGACY_JAR_LOCK_REQUIRES_MIGRATION');await unlink(join(this.#root,'.lock'));}
      for (const name of await readdir(this.#root)) if (/^pending-[a-f0-9-]+\.(jar|json)$/.test(name)) await unlink(join(this.#root, name));
      await this.#reserve(0);
    })();
    this.#ready.catch(() => {});
  }
  get directory() { return this.#root; }
  get guardPath() { return this.#lease?.guard; }
  #serialize(action) {
    if (this.#closed) return Promise.reject(new ArtifactError('JAR_CACHE_CLOSED'));
    const pending = this.#queue.then(async () => { await this.#ready; this.#lease.assertAlive(); return action(); });
    this.#queue = pending.catch(() => {}); return pending;
  }
  async #entries() {
    const groups = new Map();
    for (const name of await readdir(this.#root)) {
      if (!managed.test(name)) continue;
      const key = name.slice(0, name.lastIndexOf('.')), file = await lstat(join(this.#root, name));
      const group = groups.get(key) || { key, bytes: 0, accessed: file.mtimeMs };
      group.bytes += file.size;
      if (name.endsWith('.json')) group.accessed = file.mtimeMs;
      groups.set(key, group);
    }
    return [...groups.values()];
  }
  async #remove(key) {
    checkKey(key);
    await unlink(join(this.#root, key + '.jar')).catch(ignoreMissing);
    await unlink(join(this.#root, key + '.json')).catch(ignoreMissing);
  }
  async #reserve(extra, protect) {
    const entries = await this.#entries(); let total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
    for (const entry of entries.sort((a, b) => a.accessed - b.accessed || a.key.localeCompare(b.key))) {
      if (total + extra <= this.maxBytes) break;
      if (entry.key === protect || this.#pins.has(entry.key)) continue;
      await this.#remove(entry.key); total -= entry.bytes;
    }
    if (total + extra > this.maxBytes) throw new ArtifactError('JAR_CACHE_QUOTA');
  }
  async #read(key) {
    checkKey(key);
    const path = join(this.#root, key + '.jar'), sidecar = join(this.#root, key + '.json');
    try {
      const metaStat = await lstat(sidecar), jarStat = await lstat(path);
      if (!metaStat.isFile() || !jarStat.isFile() || metaStat.size > 1024 || jarStat.size > this.maxArtifactBytes) throw new ArtifactError('JAR_CACHE_CORRUPT');
      const entry = JSON.parse(await readFile(sidecar, 'utf8')), bytes = await readFile(path);
      if (!entry || entry.version !== 1 || !Number.isFinite(entry.downloadedAt) || !bytes.length || bytes.length !== entry.bytes || hash(bytes) !== entry.sha256 || hash(bytes, 'md5') !== entry.md5) throw new ArtifactError('JAR_CACHE_CORRUPT');
      return { ...entry, key, path };
    } catch (error) {
      if (this.#pins.has(key)) throw new ArtifactError('PINNED_JAR_CACHE_CORRUPT');
      // Only this cache's own pair is removed; caller files are outside this namespace.
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError) && !(error instanceof ArtifactError)) throw error;
      await this.#remove(key); return null;
    }
  }
  async #resolve(signature, { role = 'site', useCache = false, jarCache = 'true', force = false } = {}) {
    if (!['main', 'site'].includes(role)) throw new ArtifactError('INVALID_JAR_ROLE');
    const { source, md5 } = jarSignature(signature, { role }), key = role + '-' + jarUrlKey(source);
    const plan = planJarSource(source, { role, localAddress: this.localAddress });
    let expectedMd5 = md5;
    // Only JarLoader.parseJar resolves a remote MD5. ApiConfig.loadJar uses literal text.
    if (role === 'site' && md5.startsWith('http')) {
      try { expectedMd5 = javaTrim((await this.fetchBytes(md5, { timeoutMs: this.timeoutMs, maxBytes: 4096, signal: this.#controller.signal, allowEmpty: true })).toString('utf8')); }
      catch (error) {
        if (this.integrity === 'strict' || this.#controller.signal.aborted || error.code === 'JAR_SIZE_LIMIT') throw error;
        expectedMd5 = ''; // Original OkHttp.string returns null on a failed request.
      }
    }
    if (this.integrity === 'strict' && expectedMd5 && !/^[a-fA-F0-9]{32}$/.test(expectedMd5)) throw new ArtifactError('JAR_MD5_INVALID');
    const entry = await this.#read(key);
    const acceptable = entry && (this.integrity !== 'strict' || !expectedMd5 || entry.md5 === expectedMd5.toLowerCase());
    const rule = !force && acceptable ? jarCacheRule({ role, useCache, jarCache, expectedMd5, entry, now: this.now() }) : null;
    if (rule) { await utimes(join(this.#root, key + '.json'), new Date(), new Date(this.now())); return { ...entry, origin: 'cache', rule, md5Matches: expectedMd5 ? entry.md5 === expectedMd5.toLowerCase() : null }; }
    if (plan.kind === 'unsupported') throw new ArtifactError('JAR_SCHEME_UNSUPPORTED_FOR_ROLE');
    if (this.#pins.has(key)) throw new ArtifactError('JAR_UPDATE_REQUIRES_RUNTIME_CLEAR');
    let bytes, localPath;
    try {
      if (plan.kind === 'assets' || plan.kind === 'file') {
        const local = await resolveJarFile(plan, { assetRoot: this.assetRoot, externalRoot: this.externalRoot, fileRoot: this.fileRoot, maxBytes: this.maxArtifactBytes, signal: this.#controller.signal });
        bytes = local.bytes; localPath = local.path;
      } else {
        const image = plan.kind === 'image', limit = image ? this.maxImageBytes : this.maxArtifactBytes;
        const fetched = await this.fetchBytes(plan.requestUrl, { timeoutMs: this.timeoutMs, maxBytes: limit, signal: this.#controller.signal, responseText: image, ...(role === 'main' ? { userAgent: 'okhttp/3.15' } : {}) });
        if ((typeof fetched === 'string' ? Buffer.byteLength(fetched) : fetched.length) > limit) throw new ArtifactError('JAR_SIZE_LIMIT');
        bytes = image ? decodeImageJar(fetched) : Buffer.from(fetched);
      }
      if (!bytes.length) throw new ArtifactError('EMPTY_JAR');
      if (bytes.length > this.maxArtifactBytes) throw new ArtifactError('JAR_SIZE_LIMIT');
    }
    catch (error) {
      if (role !== 'main' || !acceptable || this.#controller.signal.aborted || error.code === 'JAR_SIZE_LIMIT') throw error;
      return { ...entry, origin: 'fallback', rule: 'network-failure', md5Matches: expectedMd5 ? entry.md5 === expectedMd5.toLowerCase() : null };
    }
    if (!bytes.length) throw new ArtifactError('EMPTY_JAR');
    if (bytes.length > this.maxArtifactBytes) throw new ArtifactError('JAR_SIZE_LIMIT');
    const actualMd5 = hash(bytes, 'md5'), md5Matches = expectedMd5 ? actualMd5 === expectedMd5.toLowerCase() : null;
    if (this.integrity === 'strict' && md5Matches === false) throw new ArtifactError('JAR_MD5_MISMATCH');
    if (plan.kind === 'file') return { path: localPath, origin: 'local', retrieval: 'file', sha256: hash(bytes), md5: actualMd5, bytes: bytes.length, md5Matches };
    const metadata = { version: 1, sha256: hash(bytes), md5: actualMd5, bytes: bytes.length, downloadedAt: this.now() }, json = JSON.stringify(metadata);
    await this.#reserve(bytes.length + Buffer.byteLength(json), key);
    const prefix = join(this.#root, 'pending-' + randomUUID()), jarTemp = prefix + '.jar', metaTemp = prefix + '.json';
    try {
      await writeFile(jarTemp, bytes, { flag: 'wx', mode: 0o600 });
      await writeFile(metaTemp, json, { flag: 'wx', mode: 0o600 });
      await rename(jarTemp, join(this.#root, key + '.jar'));
      await rename(metaTemp, join(this.#root, key + '.json'));
      await utimes(join(this.#root, key + '.json'), new Date(), new Date(this.now()));
    } finally { await unlink(jarTemp).catch(ignoreMissing); await unlink(metaTemp).catch(ignoreMissing); }
    return { ...metadata, key, path: join(this.#root, key + '.jar'), origin: 'download', rule: 'download', retrieval: plan.kind, md5Matches };
  }
  resolve(signature, options) { return this.#serialize(() => this.#resolve(signature, options)); }
  acquire(signature, options) { return this.#serialize(async () => { const entry = await this.#resolve(signature, options); if (entry.key) this.#pins.add(entry.key); return entry; }); }
  pin(key) { return this.#serialize(async () => { if (!(await this.#read(key))) throw new ArtifactError('JAR_CACHE_MISSING'); this.#pins.add(key); }); }
  releaseAll() { return this.#serialize(() => { this.#pins.clear(); }); }
  invalidate(key) { return this.#serialize(async () => { if (this.#pins.has(key)) throw new ArtifactError('JAR_UPDATE_REQUIRES_RUNTIME_CLEAR'); await this.#remove(key); }); }
  getState() { return this.#serialize(async () => { const entries = await this.#entries(); return { scope: 'downloaded JAR pairs only; excludes runtime DEX/module/plugin data', integrity: this.integrity, maxBytes: this.maxBytes, bytes: entries.reduce((n, e) => n + e.bytes, 0), entries: entries.length, pinned: this.#pins.size, persistent: !this.#owned }; }); }
  close() {
    this.#closing ||= (async () => {
      this.#closed = true; this.#controller.abort();
      await this.#queue;
      try { await this.#ready; } catch { /* Initialization failures are returned to operations. */ }
      if (this.#lease) await this.#lease.close();
      if (this.#owned && this.#root) await rm(this.#root, { recursive: true, force: true });
    })(); return this.#closing;
  }
}
