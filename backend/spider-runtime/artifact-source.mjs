// SPDX-License-Identifier: GPL-3.0-only
import { open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';

export class ArtifactSourceError extends Error {
  constructor(code) { super(code); this.name = 'ArtifactSourceError'; this.code = code; }
}

/** Pinned ApiConfig/JarLoader routing; storage and transport are host bindings. */
export function planJarSource(source, { role = 'site', localAddress = 'http://127.0.0.1:9978/' } = {}) {
  if (!['main', 'site'].includes(role)) throw new ArtifactSourceError('INVALID_JAR_ROLE');
  if (role === 'main') {
    const image = source.startsWith('img+'), requestUrl = source.replaceAll('img+', '');
    return { kind: image ? 'image' : /^https?:\/\//.test(requestUrl) ? 'http' : 'unsupported', source, requestUrl };
  }
  if (source.startsWith('http')) return { kind: 'http', source, requestUrl: source };
  if (source.startsWith('assets')) return { kind: 'assets', source, path: source.replaceAll('assets://', '').replaceAll('assets/', '') };
  if (source.startsWith('file')) return { kind: 'file', source, path: source.replaceAll('file:/', '') };
  if (source.startsWith('clan://')) {
    let requestUrl = source;
    if (source.startsWith('clan://localhost/')) requestUrl = source.replaceAll('clan://localhost/', localAddress + 'file/');
    else {
      const text = source.slice(7), slash = text.indexOf('/');
      if (slash > 0) requestUrl = 'http://' + text.slice(0, slash) + '/file/' + text.slice(slash + 1);
    }
    return { kind: 'http', source, requestUrl };
  }
  return { kind: 'unsupported', source };
}

/** AOSP Base64.DEFAULT states: skips nonalphabet bytes but validates padding. */
export function decodeImageJar(body) {
  const text = Buffer.isBuffer(body) ? body.toString('utf8') : String(body);
  const marker = /[A-Za-z0-9]{8}\*\*/.exec(text);
  if (!marker) return Buffer.alloc(0);
  const encoded = Buffer.from(text.slice(marker.index + 10), 'utf8');
  const output = Buffer.alloc(Math.ceil(encoded.length * 3 / 4));
  let state = 0, value = 0, count = 0;
  const invalid = () => { throw new ArtifactSourceError('IMAGE_JAR_BASE64_INVALID'); };
  for (const byte of encoded) {
    const digit = byte >= 65 && byte <= 90 ? byte - 65 : byte >= 97 && byte <= 122 ? byte - 71
      : byte >= 48 && byte <= 57 ? byte + 4 : byte === 43 ? 62 : byte === 47 ? 63 : byte === 61 ? -2 : -1;
    if (digit === -1) continue;
    if (state === 0) { if (digit < 0) invalid(); value = digit; state = 1; }
    else if (state === 1) { if (digit < 0) invalid(); value = (value << 6) | digit; state = 2; }
    else if (state === 2) {
      if (digit >= 0) { value = (value << 6) | digit; state = 3; }
      else { output[count++] = value >> 4; state = 4; }
    } else if (state === 3) {
      if (digit >= 0) {
        value = (value << 6) | digit;
        output[count++] = value >> 16; output[count++] = value >> 8; output[count++] = value; state = 0;
      } else { output[count++] = value >> 10; output[count++] = value >> 2; state = 5; }
    } else if (state === 4) { if (digit !== -2) invalid(); state = 5; }
    else invalid();
  }
  if (state === 1 || state === 4) invalid();
  if (state === 2) output[count++] = value >> 4;
  if (state === 3) { output[count++] = value >> 10; output[count++] = value >> 2; }
  return output.subarray(0, count);
}

const inside = (root, path) => { const rel = relative(root, path); return rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel); };
async function boundPath(root, path) {
  const base = await realpath(root), candidate = resolve(base, path.replace(/^\/+/, ''));
  if (!inside(base, candidate)) throw new ArtifactSourceError('JAR_PATH_OUTSIDE_ROOT');
  let actual;
  try { actual = await realpath(candidate); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (!inside(base, actual)) throw new ArtifactSourceError('JAR_PATH_OUTSIDE_ROOT');
  return actual;
}
export async function readJarFile(path, maxBytes, signal) {
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile()) throw new ArtifactSourceError('JAR_FILE_INVALID');
    if (info.size > maxBytes) throw new ArtifactSourceError('JAR_SIZE_LIMIT');
    // Read at most maxBytes+1 even if the caller changes the file after stat.
    const chunks = []; let size = 0;
    for await (const chunk of file.createReadStream({ autoClose: false, end: maxBytes, signal })) { chunks.push(chunk); size += chunk.length; }
    if (size > maxBytes) throw new ArtifactSourceError('JAR_SIZE_LIMIT');
    return Buffer.concat(chunks);
  } finally { await file.close(); }
}
/** Explicit roots map Android namespaces to caller-mounted Linux directories. */
export async function resolveJarFile(plan, { assetRoot, externalRoot, fileRoot, maxBytes, signal }) {
  let path;
  if (plan.kind === 'assets') {
    if (!assetRoot) throw new ArtifactSourceError('JAR_ASSET_ROOT_REQUIRED');
    path = await boundPath(assetRoot, plan.path);
  } else {
    if (!externalRoot && !fileRoot) throw new ArtifactSourceError('JAR_FILE_ROOT_REQUIRED');
    if (externalRoot) path = await boundPath(externalRoot, plan.path);
    if (!path && fileRoot) path = await boundPath(fileRoot, plan.path);
  }
  if (!path) throw new ArtifactSourceError('JAR_FILE_NOT_FOUND');
  return { path, bytes: await readJarFile(path, maxBytes, signal) };
}
