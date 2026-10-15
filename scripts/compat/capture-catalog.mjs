// SPDX-License-Identifier: GPL-3.0-only
// Downloads and parses a public subscription catalogue. Never executes spiders.
import { mkdir, readFile, writeFile, copyFile, stat, rename, unlink } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createFullSubscriptionLoader } from '../../backend/subscription/full-loader.mjs';
import { createConfigCore } from '../../backend/config-core/index.mjs';
import { ArtifactError, JarArtifactCache } from '../../backend/spider-runtime/artifact-cache.mjs';
import { inspectArtifact, zipEntries } from './artifact-inspect.mjs';

const MiB = 1024 * 1024;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const semanticHash = value => sha(JSON.stringify(canonical(value)));
const describeError = error => ({ code: typeof error.code === 'string' ? error.code : error.code === 23 ? 'TimeoutError' : error.name || 'Error', message: String(error.message || error).slice(0, 512) });
const route = api => api.endsWith('.js') || api.includes('.js?') ? 'js' : api.includes('.py') ? 'py' : 'jar';
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const writeJson = async (path, value) => {
  const pending = path + '.pending-' + randomUUID();
  try { await writeFile(pending, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); await rename(pending, path); }
  finally { await unlink(pending).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
};
const exists = async path => !!await stat(path).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });

async function boundedText(url, { timeoutMs = 15000, maxBytes = 6 * MiB } = {}) {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Subscription transport accepts HTTP(S)');
  const response = await fetch(parsed, { headers: { 'User-Agent': 'okhttp/3.12.11' }, signal: AbortSignal.timeout(Math.max(1, timeoutMs)) });
  try {
    if (!response.ok) throw new Error('HTTP ' + response.status);
    if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('Subscription response exceeds size limit');
    const chunks = []; let size = 0;
    for await (const chunk of response.body || []) {
      size += chunk.length;
      if (size > maxBytes) throw new Error('Subscription response exceeds size limit');
      chunks.push(Buffer.from(chunk));
    }
    return { bytes: Buffer.concat(chunks), status: response.status, responseUrl: response.url, contentType: response.headers.get('content-type') };
  } finally { await response.body?.cancel().catch(() => {}); }
}

// Capture-only transport preserves fetchArtifactBytes' Buffer/string contract and
// error/charset semantics. These are fetch response bytes (HTTP content encoding
// may already be decompressed), before TextDecoder and img+ Base64 decoding.
async function captureArtifactBytes(root, responses, url, { timeoutMs = 25000, maxBytes = 64 * MiB,
  signal, allowEmpty = false, responseText = false, userAgent = 'okhttp/3.12.11' } = {}) {
  const captured = { requestedUrl: url, capturedAt: new Date().toISOString(),
    kind: allowEmpty ? 'remote-md5' : responseText ? 'image-jar' : 'jar',
    requestHeaders: { 'User-Agent': userAgent }, responseText, bodyCaptured: false, complete: false };
  responses.push(captured);
  let response, readStarted = false;
  const chunks = []; let size = 0;
  try {
    let parsed;
    try { parsed = new URL(url); } catch { throw new ArtifactError('JAR_URL_INVALID'); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new ArtifactError('JAR_SCHEME_UNAVAILABLE');
    const deadline = AbortSignal.timeout(timeoutMs);
    response = await fetch(parsed, { headers: captured.requestHeaders, signal: signal ? AbortSignal.any([signal, deadline]) : deadline });
    Object.assign(captured, { responseUrl: response.url, status: response.status, headers: Object.fromEntries(response.headers),
      byteRepresentation: 'fetch-response-body-before-text-and-image-decoding' });
    if (!response.ok) throw new ArtifactError('JAR_HTTP_' + response.status);
    if (Number(response.headers.get('content-length')) > maxBytes) throw new ArtifactError('JAR_SIZE_LIMIT');
    readStarted = true;
    for await (const chunk of response.body || []) {
      size += chunk.length;
      if (size > maxBytes) throw new ArtifactError('JAR_SIZE_LIMIT');
      chunks.push(Buffer.from(chunk));
    }
    captured.complete = true;
    if (!size && !allowEmpty) throw new ArtifactError('EMPTY_JAR');
    const bytes = Buffer.concat(chunks);
    if (!responseText) return bytes;
    let encoding = /charset\s*=\s*["']?([^\s;"']+)/i.exec(response.headers.get('content-type') || '')?.[1] || 'utf-8';
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) encoding = 'utf-8';
    else if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le';
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be';
    try { return new TextDecoder(encoding).decode(bytes); }
    catch { return new TextDecoder('utf-8').decode(bytes); }
  } catch (error) { captured.error = describeError(error); throw error; }
  finally {
    await response?.body?.cancel().catch(() => {});
    if (readStarted) {
      const bytes = Buffer.concat(chunks), file = 'artifact-responses/' + randomUUID() + '.bin';
      await writeFile(join(root, file), bytes, { flag: 'wx', mode: 0o600 });
      Object.assign(captured, { bodyCaptured: true, bytes: bytes.length, sha256: sha(bytes), file, observedBytes: size });
    }
  }
}

function summarizeConfig(config) {
  const sites = config.sites || [];
  const types = {}, routes = {}, jars = new Map();
  for (const site of sites) {
    types[String(site.type)] = (types[String(site.type)] || 0) + 1;
    if (site.type !== 3) continue;
    const kind = route(site.api || ''); routes[kind] = (routes[kind] || 0) + 1;
    const role = site.jar ? 'site' : 'main', signature = site.jar || config.globals?.spider || '';
    const key = role + '\0' + signature;
    if (!jars.has(key)) jars.set(key, { role, signature, sourceCount: 0, routes: {}, siteKeys: [] });
    const group = jars.get(key); group.sourceCount++; group.routes[kind] = (group.routes[kind] || 0) + 1; group.siteKeys.push(site.key);
  }
  return { sourceCount: sites.length, types, routes, mainSpider: config.globals?.spider || '', jarCache: config.globals?.jarCache || '', jarGroups: [...jars.values()] };
}

async function captureEntry(entry, { root, bases, refresh = false }) {
  const directory = join(root, 'captures', entry.id), metadataPath = join(directory, 'metadata.json');
  if (!refresh && await exists(metadataPath)) return readJson(metadataPath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const metadata = { ...entry, captureStarted: new Date().toISOString(), attempts: [], responses: [], parseSuccess: false };
  const encodedFile = entry.catalogFile?.split('/').map(encodeURIComponent).join('/');
  const candidates = [...new Set(entry.urls || [...bases.map(base => base + encodedFile), entry.originalUrl].filter(Boolean))];
  const deadline = Date.now() + 30000;
  for (const apiUrl of candidates) {
    if (Date.now() >= deadline) { metadata.outstanding = candidates.slice(metadata.attempts.length); break; }
    const attempt = { apiUrl, events: [] }; metadata.attempts.push(attempt);
    let loader;
    try {
      loader = createFullSubscriptionLoader({ maxHops: 8, onEvent: event => { if (['fetch', 'parse'].includes(event.kind)) attempt.events.push(event); }, fetchText: async url => {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error('Catalogue entry capture deadline');
        const result = await boundedText(url, { timeoutMs: Math.min(15000, remaining) });
        const index = metadata.responses.length, file = 'raw-' + String(index).padStart(2, '0') + '.bin';
        await writeFile(join(directory, file), result.bytes, { mode: 0o600 });
        metadata.responses.push({ requestedUrl: url, responseUrl: result.responseUrl, status: result.status, contentType: result.contentType,
          bytes: result.bytes.length, sha256: sha(result.bytes), file });
        return result.bytes.toString('utf8');
      } });
      const result = await loader.load({ apiUrl });
      attempt.ok = result.ok; if (result.message) attempt.message = result.message;
      attempt.state = await loader.getState();
      const visited = new Set(attempt.events.filter(event => event.kind === 'fetch').map(event => event.url));
      const unvisited = (attempt.state.apiLineList || []).filter(line => !visited.has(line.url));
      if (unvisited.length) attempt.unvisitedCollectionLines = unvisited;
      if (result.ok) {
        const config = await loader.getConfig();
        await writeJson(join(directory, 'config.json'), config);
        const responses = Object.fromEntries(await Promise.all(metadata.responses.map(async response => [response.requestedUrl, (await readFile(join(directory, response.file))).toString('utf8')])));
        await writeJson(join(directory, 'responses.json'), responses);
        Object.assign(metadata, summarizeConfig(config), { parseSuccess: true, selectedUrl: result.apiUrl || attempt.state.apiUrl,
          configFile: relative(root, join(directory, 'config.json')), configSha256: sha(await readFile(join(directory, 'config.json'))), configSemanticSha256: semanticHash(config) });
        break;
      }
    } catch (error) { attempt.error = describeError(error); }
    finally { if (loader) await loader.close(); }
  }
  metadata.captureFinished = new Date().toISOString();
  await writeJson(metadataPath, metadata);
  return metadata;
}

function catalogEntries(text) {
  return text.split(/\r?\n/).filter(Boolean).map((line, index) => {
    const [catalogFile, publicDate, publicSize, ...rest] = line.split('|');
    return { id: 'catalog-' + String(index + 1).padStart(3, '0') + '-' + sha(catalogFile).slice(0, 10),
      publicName: catalogFile.replace(/\.json$/i, ''), catalogFile, publicDate, publicSize, originalUrl: rest.join('|'), origin: 'list' };
  });
}

async function captureCatalog(root, { refresh = false, limit = Infinity } = {}) {
  const config = await readJson(join(root, 'site-config.json'));
  const bases = [...new Set(['https://0.12yue.de5.net/tvbox/', ...(config.apiDomains || []).map(item => item.base)])];
  const entries = catalogEntries(await readFile(join(root, 'list.txt'), 'utf8')).slice(0, limit);
  const inventory = { schemaVersion: 1, scope: 'Download/parse/static inspection only; no spider execution', catalogUrl: 'https://0.12yue.de5.net/',
    createdAt: new Date().toISOString(), limits: { concurrency: 3, fetchMs: 15000, entryMs: 30000, configBytes: 6 * MiB, maxHops: 8 }, entries: [] };
  let next = 0, completed = 0, saveQueue = Promise.resolve();
  const save = () => { saveQueue = saveQueue.then(() => writeJson(join(root, 'inventory.json'), inventory)); return saveQueue; };
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (next < entries.length) {
      const index = next++, entry = entries[index];
      const captured = await captureEntry(entry, { root, bases, refresh });
      inventory.entries[index] = captured; completed++;
      inventory.summary = { catalogEntries: entries.length, completed, parsed: inventory.entries.filter(item => item?.parseSuccess).length,
        sourceReferences: inventory.entries.reduce((sum, item) => sum + (item?.sourceCount || 0), 0) };
      await save();
      console.log(JSON.stringify({ stage: 'catalog', completed, total: entries.length, id: entry.id, name: entry.publicName, parsed: captured.parseSuccess, sites: captured.sourceCount || 0 }));
    }
  }));
  await saveQueue;
  inventory.completedAt = new Date().toISOString(); await save();
  return inventory;
}

async function captureCustom(root, inventory) {
  const config = await readJson(join(root, 'site-config.json'));
  if (!config.customApis) return inventory;
  const url = new URL(config.customApis, inventory.catalogUrl).href;
  let response;
  try { response = await boundedText(url); }
  catch (error) {
    inventory.customCatalog = { url, ok: false, error: describeError(error) };
    await writeJson(join(root, 'inventory.json'), inventory);
    console.log(JSON.stringify({ stage: 'custom', ...inventory.customCatalog }));
    return inventory;
  }
  await writeFile(join(root, 'custom-apis.json'), response.bytes, { mode: 0o600 });
  const urls = new Map(); let data;
  inventory.customCatalog = { url, sha256: sha(response.bytes), bytes: response.bytes.length, candidates: 0, ok: false };
  try { data = JSON.parse(response.bytes.toString('utf8')); }
  catch (error) {
    inventory.customCatalog.error = describeError(error);
    await writeJson(join(root, 'inventory.json'), inventory);
    console.log(JSON.stringify({ stage: 'custom', ok: false, error: inventory.customCatalog.error }));
    return inventory;
  }
  // Read only this dedicated VOD catalogue's explicit subscription rows.
  const add = (url, name) => {
    if (typeof url !== 'string' || !/^https?:\/\//.test(url) || typeof name !== 'string') return;
    if (/\.(?:apk|m3u8?|mp4|zip|7z)(?:[?#]|$)/i.test(url) || /(?:直播|下载|安装|应用|APP)/i.test(name)) return;
    urls.set(url, name);
  };
  for (const item of Array.isArray(data) ? data : []) {
    if (!item || typeof item.name !== 'string') continue;
    add(item.origUrl, item.name);
    add(item.url, item.name);
    for (const line of Array.isArray(item.urls) ? item.urls : []) add(line.url, item.name + (line.label ? ' / ' + line.label : ''));
  }
  Object.assign(inventory.customCatalog, { ok: true, candidates: urls.size });
  let index = 0;
  for (const [sourceUrl, publicName] of urls) {
    const entry = { id: 'custom-' + sha(sourceUrl).slice(0, 16), publicName, urls: [sourceUrl], originalUrl: sourceUrl, origin: 'customApis' };
    const captured = await captureEntry(entry, { root, bases: [] });
    const found = inventory.entries.findIndex(item => item.id === entry.id);
    if (found < 0) inventory.entries.push(captured); else inventory.entries[found] = captured;
    await writeJson(join(root, 'inventory.json'), inventory);
    console.log(JSON.stringify({ stage: 'custom', completed: ++index, total: urls.size, name: publicName, parsed: captured.parseSuccess, sites: captured.sourceCount || 0 }));
  }
  return inventory;
}

async function inspectJar(bytes) {
  try {
    const inspected = inspectArtifact(bytes), entries = zipEntries(bytes);
    return { ok: true, entries: inspected.entries, expandedBytes: inspected.expandedBytes,
      classFiles: entries.filter(entry => entry.name.endsWith('.class')).length,
      dexClasses: inspected.dex.reduce((sum, dex) => sum + dex.classCount, 0),
      dex: inspected.dex.map(({ name, bytes, version, classCount, referencesDexNativeLoader }) => ({ name, bytes, version, classCount, referencesDexNativeLoader })),
      native: inspected.native, protectedPayloads: inspected.protectedPayloads };
  } catch (error) { return { ok: false, error: describeError(error) }; }
}

async function capturePartial(root, inventory) {
  for (const entry of inventory.entries.filter(item => item && !item.parseSuccess && item.responses?.length)) {
    if (entry.partialConfigFile) continue;
    const core = createConfigCore();
    try {
      for (const response of entry.responses) {
        const url = response.requestedUrl, text = (await readFile(join(root, 'captures', entry.id, response.file))).toString('utf8');
        const selected = await core.query({ operation: 'url', url });
        if (!selected.ok) continue;
        const prepared = await core.query({ operation: 'fetchBody', url, text, key: selected.value.key });
        if (!prepared.ok || !prepared.value?.success) continue;
        const parsed = await core.query({ operation: 'full', text: prepared.value.text, url });
        const config = parsed.value?.config || parsed.partialConfig;
        if (!config?.sites?.length || parsed.value?.accepted) continue;
        const directory = join(root, 'captures', entry.id);
        await writeFile(join(directory, 'prepared.txt'), prepared.value.text, { mode: 0o600 });
        await writeJson(join(directory, 'partial-config.json'), config);
        await writeJson(join(directory, 'parse-diagnostic.json'), parsed);
        Object.assign(entry, { partial: true, partialErrorType: parsed.value?.errorType || parsed.errorType,
          partialSourceCount: config.sites.length, partialConfigFile: relative(root, join(directory, 'partial-config.json')),
          preparedSha256: sha(prepared.value.text), partialConfigSha256: sha(await readFile(join(directory, 'partial-config.json'))) });
        await writeJson(join(directory, 'metadata.json'), entry);
        console.log(JSON.stringify({ stage: 'partial', name: entry.publicName, sites: config.sites.length, errorType: entry.partialErrorType }));
        break;
      }
    } finally { await core.close(); }
  }
  await writeJson(join(root, 'inventory.json'), inventory);
}

async function downloadArtifacts(root, inventory, { retryFailures = false } = {}) {
  const artifactDirectory = join(root, 'artifacts'); await mkdir(artifactDirectory, { recursive: true, mode: 0o700 });
  await mkdir(join(root, 'artifact-responses'), { recursive: true, mode: 0o700 });
  let activeResponses;
  const cache = new JarArtifactCache({ directory: join(root, 'download-cache'), maxBytes: 1024 * MiB, maxArtifactBytes: 64 * MiB,
    timeoutMs: 15000, fetchBytes: (url, options) => captureArtifactBytes(root, activeResponses, url, { ...options, timeoutMs: 15000 }) });
  const previous = await exists(join(root, 'artifact-inventory.json')) ? await readJson(join(root, 'artifact-inventory.json')) : null;
  const previousRetrievals = new Map((previous?.retrievals || []).map(item => [item.role + '\0' + item.signature, item]));
  const responsesByCacheKey = new Map((previous?.retrievals || []).filter(item => item.cacheKey && item.ok)
    .map(item => [item.cacheKey, (item.responses || []).filter(response => response.kind !== 'remote-md5' && response.complete && response.bodyCaptured)]));
  const bySha = new Map(), requests = new Map();
  const request = (signature, role, reference, site, jarCache) => {
    const key = role + '\0' + signature;
    if (!requests.has(key)) requests.set(key, { signature, role, jarCache, references: [], sites: [] });
    const item = requests.get(key); item.references.push(reference); if (site) item.sites.push({ site, reference });
  };
  for (const entry of inventory.entries.filter(item => item?.parseSuccess || item?.partialConfigFile)) {
    const config = await readJson(join(root, entry.configFile || entry.partialConfigFile)), main = config.globals?.spider || '', jarCache = config.globals?.jarCache;
    const partial = !entry.parseSuccess;
    const mainSites = (config.sites || []).filter(site => site.type === 3 && !site.jar && route(site.api || '') === 'jar');
    if (main && !mainSites.length) request(main, 'main', { captureId: entry.id, publicName: entry.publicName, partial, role: 'main', kind: 'unused-main' }, null, jarCache);
    for (const site of mainSites) request(main, 'main', { captureId: entry.id, publicName: entry.publicName, partial, siteKey: site.key, role: 'main', kind: 'jar-csp' }, site, jarCache);
    for (const site of (config.sites || []).filter(site => site.type === 3 && site.jar)) {
      const kind = route(site.api || '');
      request(site.jar, 'site', { captureId: entry.id, publicName: entry.publicName, partial, siteKey: site.key, role: 'site', kind: kind === 'jar' ? 'jar-csp' : kind + '-helper' }, kind === 'jar' ? site : null, jarCache);
    }
  }
  const retrievals = []; let completed = 0;
  const manifest = { schemaVersion: 1, inputRoot: '/input', limits: { loadMs: 45000, initMs: 12000, callMs: 15000, artifactMs: 180000, maxHomeSites: 3 }, artifacts: [] };
  try {
    for (const item of requests.values()) {
      const record = { signature: item.signature, role: item.role, references: item.references, siteReferences: item.sites.length, responses: [] };
      activeResponses = record.responses;
      try {
        if (!item.signature) throw new Error('No JAR configured');
        const prior = previousRetrievals.get(item.role + '\0' + item.signature);
        if (prior && !prior.ok && !retryFailures) {
          record.responses = prior.responses || [];
          throw Object.assign(new Error(prior.error.message), { code: prior.error.code });
        }
        let downloaded;
        if (prior?.ok && await exists(join(root, 'artifacts', prior.sha256 + '.jar'))) {
          const path = join(root, 'artifacts', prior.sha256 + '.jar'), bytes = await readFile(path);
          if (sha(bytes) !== prior.sha256) throw new Error('Previously captured JAR checksum differs');
          record.responses = prior.responses || [];
          downloaded = { ...prior, key: prior.cacheKey, path, origin: 'capture' };
        } else downloaded = await cache.resolve(item.signature, { role: item.role, jarCache: item.jarCache });
        if (['cache', 'fallback'].includes(downloaded.origin)) {
          record.responses.push(...(responsesByCacheKey.get(downloaded.key) || []).map(response => ({ ...response, reusedFromCache: true })));
        }
        if (downloaded.key && ['download', 'capture'].includes(downloaded.origin)) {
          responsesByCacheKey.set(downloaded.key, record.responses.filter(response => response.kind !== 'remote-md5' && response.complete && response.bodyCaptured));
        }
        const bytes = await readFile(downloaded.path), digest = sha(bytes), artifactPath = 'artifacts/' + digest + '.jar';
        Object.assign(record, { ok: true, sha256: digest, md5: downloaded.md5, md5Matches: downloaded.md5Matches, bytes: bytes.length, retrieval: downloaded.retrieval, cacheOrigin: downloaded.origin, cacheKey: downloaded.key });
        if (!bySha.has(digest)) {
          if (resolve(downloaded.path) !== resolve(root, artifactPath)) await copyFile(downloaded.path, join(root, artifactPath));
          const artifact = { id: digest, jarPath: artifactPath, sha256: digest, bytes: bytes.length, role: item.role, roles: [], sites: [], references: [], inspection: await inspectJar(bytes) };
          bySha.set(digest, { artifact, variants: new Map() });
        }
        const grouped = bySha.get(digest), artifact = grouped.artifact;
        if (!artifact.roles.includes(item.role)) artifact.roles.push(item.role);
        if (item.role === 'main') artifact.role = 'main';
        artifact.references.push(...item.references);
        for (const { site, reference } of item.sites) {
          const extSha256 = semanticHash(site.ext), key = site.api + '\0' + extSha256;
          if (!grouped.variants.has(key)) {
            const variant = { ...site, extSha256, selectedRole: item.role, referenceCount: 0, references: [] };
            grouped.variants.set(key, variant); artifact.sites.push(variant);
          }
          const variant = grouped.variants.get(key); variant.referenceCount++; variant.references.push(reference);
        }
      } catch (error) { record.ok = false; record.error = describeError(error); }
      retrievals.push(record); completed++;
      manifest.artifacts = [...bySha.values()].map(({ artifact }) => artifact);
      const metadata = { schemaVersion: 1, generatedAt: new Date().toISOString(), scope: 'Decoded artifact SHA256 deduplication; static inspection only',
        summary: { requestedSignatures: requests.size, completed, downloaded: retrievals.filter(item => item.ok).length, failed: retrievals.filter(item => !item.ok).length,
          uniqueArtifacts: bySha.size, sourceReferences: manifest.artifacts.reduce((sum, artifact) => sum + artifact.sites.reduce((n, site) => n + site.referenceCount, 0), 0),
          sourceVariants: manifest.artifacts.reduce((sum, artifact) => sum + artifact.sites.length, 0) },
        retrievals, artifacts: manifest.artifacts.map(({ sites, ...artifact }) => ({ ...artifact, sourceVariants: sites.length, sourceReferences: sites.reduce((sum, site) => sum + site.referenceCount, 0),
          sites: sites.map(({ key, name, api, type, extSha256, selectedRole, referenceCount }) => ({ key, name, api, type, extSha256, selectedRole, referenceCount })) })) };
      await writeJson(join(root, 'artifact-inventory.json'), metadata);
      await writeJson(join(root, 'input-manifest.json'), manifest);
      console.log(JSON.stringify({ stage: 'artifact', completed, total: requests.size, ok: record.ok, role: item.role, sha256: record.sha256, bytes: record.bytes, error: record.error, unique: bySha.size }));
    }
  } finally { await cache.close(); }
  return { manifest, retrievals };
}

export async function runCatalogCapture({ directory = '.cache/source-matrix', stage = 'all', custom = false, partial = false, retryFailures = false, refresh = false, limit = Infinity } = {}) {
  const root = resolve(directory); await mkdir(root, { recursive: true, mode: 0o700 });
  let inventory = stage === 'artifacts' ? await readJson(join(root, 'inventory.json')) : await captureCatalog(root, { refresh, limit });
  if (custom) inventory = await captureCustom(root, inventory);
  if (partial) await capturePartial(root, inventory);
  if (stage !== 'capture') await downloadArtifacts(root, inventory, { retryFailures });
  return inventory;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), value = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
  const stage = value('--stage') || 'all';
  if (!['all', 'capture', 'artifacts'].includes(stage)) throw new Error('--stage must be all, capture, or artifacts');
  await runCatalogCapture({ directory: value('--directory'), stage, custom: args.includes('--custom'), partial: args.includes('--include-partial'), retryFailures: args.includes('--retry-failures'), refresh: args.includes('--refresh'), limit: value('--limit') === undefined ? Infinity : Number(value('--limit')) });
}
