// SPDX-License-Identifier: GPL-3.0-only
import { mkdir, readFile, writeFile, rename, unlink, readdir, stat } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const checkKey = key => {
  if (typeof key !== 'string' || !/^[a-f0-9]{32}$/.test(key)) throw new Error('Invalid subscription cache key');
  return key;
};

export class MemorySubscriptionStore {
  constructor({ state = {}, cache = {} } = {}) {
    this.preferences = structuredClone(state);
    this.cache = new Map(Object.entries(cache).map(([key, bytes]) => [checkKey(key), Buffer.from(bytes)]));
  }
  async readState() { return structuredClone(this.preferences); }
  async writeState(state) { this.preferences = structuredClone(state); }
  async readCache(key) { const bytes = this.cache.get(checkKey(key)); return bytes === undefined ? null : Buffer.from(bytes); }
  async writeCache(key, bytes) { this.cache.set(checkKey(key), Buffer.from(bytes)); }
  async listCache() { return Object.fromEntries([...this.cache].sort(([a], [b]) => a.localeCompare(b)).map(([key, bytes]) => [key, Buffer.from(bytes)])); }
}

/** Owns only state.json and configs/<MD5>; callers choose a project data directory. */
export class FileSubscriptionStore {
  constructor(directory, { maxBytes = 8 * 1024 * 1024 } = {}) {
    this.directory = resolve(directory);
    this.maxBytes = maxBytes;
  }
  async readState() {
    let bytes;
    try { bytes = await this.readBounded(join(this.directory, 'state.json')); }
    catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
    const value = JSON.parse(bytes.toString('utf8'));
    if (value.version !== 1 || !value.preferences || typeof value.preferences !== 'object' || Array.isArray(value.preferences)) throw new Error('Unsupported subscription state file');
    return value.preferences;
  }
  async writeState(state) { await this.atomicWrite(join(this.directory, 'state.json'), Buffer.from(JSON.stringify({ version: 1, preferences: state }))); }
  async readCache(key) {
    try { return await this.readBounded(join(this.directory, 'configs', checkKey(key))); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async writeCache(key, bytes) { await this.atomicWrite(join(this.directory, 'configs', checkKey(key)), Buffer.from(bytes)); }
  async readBounded(path) {
    if ((await stat(path)).size > this.maxBytes) throw new Error('Subscription store file exceeds size limit');
    const bytes = await readFile(path);
    if (bytes.length > this.maxBytes) throw new Error('Subscription store file exceeds size limit');
    return bytes;
  }
  async atomicWrite(path, bytes) {
    if (bytes.length > this.maxBytes) throw new Error('Subscription store file exceeds size limit');
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = path + '.' + randomUUID() + '.tmp';
    try { await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 }); await rename(temporary, path); }
    finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
  async listCache() {
    let names;
    try { names = await readdir(join(this.directory, 'configs')); }
    catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
    const result = {};
    for (const name of names.filter(name => /^[a-f0-9]{32}$/.test(name)).sort()) result[name] = await this.readCache(name);
    return result;
  }
}
