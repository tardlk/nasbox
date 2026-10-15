// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { JarArtifactCache, fetchArtifactBytes, jarSignature } from '../backend/spider-runtime/artifact-cache.mjs';
import { runJarPolicyOracle } from '../scripts/compat/jar-policy-oracle.mjs';
import { policyCases } from '../scripts/compat/jar-policy-cases.mjs';
const md5 = value => createHash('md5').update(value).digest('hex');
const rejected = code => error => error.code === code;
async function folder() { return mkdtemp(join(tmpdir(), 'tvbox-artifact-test-')); }



test('19 JAR cache choices and URL identities match fresh Android methods, including three-day and UTF-16 byte quirks', async () => {
  const original = runJarPolicyOracle(policyCases);
  for (const row of policyCases) {
    const directory = await folder(); let clock = row.downloadedAt;
    const cache = new JarArtifactCache({ directory, now: () => clock, fetchBytes: async url => Buffer.from(url.endsWith('/md5') ? row.remoteMd5 || '' : clock === row.downloadedAt ? 'old' : 'new') });
    try {
      if (row.cached) await cache.resolve(row.signature.split(';md5;')[0], { role: row.role });
      clock = row.now;
      const actual = await cache.resolve(row.signature, row);
      assert.equal(actual.origin, original.rows.find(result => result.id === row.id).origin, row.id);
      assert.equal(actual.key, row.role + '-' + original.rows.find(result => result.id === row.id).cacheKey, row.id + ' identity');
    } finally { await cache.close(); await rm(directory, { recursive: true, force: true }); }
  }
});

test('signature split/trim follows Java fields and keeps the distinct main/site trailing separator behavior', () => {
  assert.deepEqual(jarSignature('http://a;md5;\t ABC \n;md5;ignored'), { source: 'http://a', md5: 'ABC' });
  assert.equal(jarSignature('http://a;md5;').source, 'http://a;md5;');
  assert.equal(jarSignature('http://a;md5;', { role: 'main' }).source, 'http://a');
  assert.equal(jarSignature('http://a;md5;\u00a0hash\u00a0').md5, '\u00a0hash\u00a0');
});

test('cache restart reuses verified bytes and recovers from corrupt JAR, sidecar and orphan staging', async () => {
  const directory = await folder(); let fetches = 0;
  const options = { directory, fetchBytes: async () => { fetches++; return Buffer.from('jar'); } };
  let cache = new JarArtifactCache(options);
  try {
    const first = await cache.resolve('http://fixture.invalid/a');
    await cache.close(); cache = new JarArtifactCache(options);
    assert.equal((await cache.resolve('http://fixture.invalid/a')).sha256, first.sha256);
    assert.equal(fetches, 1);
    for (const [extension, corrupt] of [['jar', 'corrupted'], ['json', 'corrupted'], ['json', 'null']]) {
      await writeFile(join(cache.directory, first.key + '.' + extension), corrupt);
      assert.equal((await cache.resolve('http://fixture.invalid/a')).origin, 'download');
    }
    await writeFile(join(cache.directory, 'pending-1234.jar'), 'incomplete');
    await writeFile(join(directory, 'unrelated.txt'), 'keep');
    await cache.close(); cache = new JarArtifactCache(options);
    await cache.getState();
    assert.equal((await readdir(cache.directory)).includes('pending-1234.jar'), false);
    assert.equal(await readFile(join(directory, 'unrelated.txt'), 'utf8'), 'keep');
    await assert.rejects(cache.invalidate('../unrelated'), rejected('INVALID_JAR_CACHE_KEY'));
    await assert.rejects(cache.pin('../unrelated'), rejected('INVALID_JAR_CACHE_KEY'));
  } finally { await cache.close(); await rm(directory, { recursive: true, force: true }); }
});

test('Android MD5 download semantics and explicit strict validation are distinguishable; bad updates preserve last valid bytes', async () => {
  const directory = await folder(); let body = 'old';
  let cache = new JarArtifactCache({ directory, fetchBytes: async () => Buffer.from(body), integrity: 'strict' });
  try {
    const first = await cache.resolve('http://fixture.invalid/a;md5;' + md5('old'), { role: 'main' });
    await assert.rejects(cache.resolve('http://fixture.invalid/a;md5;' + md5('new'), { role: 'main' }), rejected('JAR_MD5_MISMATCH'));
    assert.equal(await readFile(first.path, 'utf8'), 'old');
    await cache.close(); cache = new JarArtifactCache({ directory, fetchBytes: async () => Buffer.from(body) });
    const accepted = await cache.resolve('http://fixture.invalid/a;md5;' + md5('new'), { role: 'main' });
    assert.equal(accepted.origin, 'download'); assert.equal(accepted.md5Matches, false);
    body = 'new';
    const changed = await cache.resolve('http://fixture.invalid/a;md5;' + md5('new'), { role: 'main' });
    assert.equal(changed.key, first.key); assert.notEqual(changed.sha256, first.sha256); assert.equal(changed.md5Matches, true);
  } finally { await cache.close(); await rm(directory, { recursive: true, force: true }); }
});

test('main network fallback is SHA-verified; strict mismatched fallback and site network failures remain failures', async () => {
  const directory = await folder(); let offline = false;
  const fetchBytes = async () => { if (offline) throw new Error('offline'); return Buffer.from('old'); };
  let cache = new JarArtifactCache({ directory, fetchBytes });
  try {
    await cache.resolve('http://fixture.invalid/a', { role: 'main' });
    await cache.resolve('http://fixture.invalid/a', { role: 'site' });
    offline = true;
    assert.equal((await cache.resolve('http://fixture.invalid/a;md5;' + md5('new'), { role: 'main' })).origin, 'fallback');
    await assert.rejects(cache.resolve('http://fixture.invalid/a;md5;' + md5('new'), { role: 'site' }), /offline/);
    await cache.close(); cache = new JarArtifactCache({ directory, fetchBytes, integrity: 'strict' });
    await assert.rejects(cache.resolve('http://fixture.invalid/a;md5;' + md5('new'), { role: 'main' }), /offline/);
  } finally { await cache.close(); await rm(directory, { recursive: true, force: true }); }
});

test('LRU respects active leases and accounts for staging and replacement peaks', async () => {
  const directory = await folder(); let clock = 1000, body = Buffer.alloc(100, 1);
  const cache = new JarArtifactCache({ directory, maxBytes: 750, now: () => clock++, fetchBytes: async () => body });
  try {
    const a = await cache.acquire('http://fixture.invalid/a');
    await cache.resolve('http://fixture.invalid/b');
    const c = await cache.resolve('http://fixture.invalid/c');
    assert.equal((await cache.getState()).entries, 2);
    assert.equal((await stat(a.path)).size, 100);
    await cache.acquire('http://fixture.invalid/c');
    await assert.rejects(cache.resolve('http://fixture.invalid/d'), rejected('JAR_CACHE_QUOTA'));
    await assert.rejects(cache.resolve('http://fixture.invalid/a', { force: true }), rejected('JAR_UPDATE_REQUIRES_RUNTIME_CLEAR'));
    await cache.releaseAll();
    body = Buffer.alloc(700, 2);
    await assert.rejects(cache.resolve('http://fixture.invalid/c', { force: true }), rejected('JAR_CACHE_QUOTA'));
    assert.equal((await stat(c.path)).size, 100, 'replacement cannot delete its last valid entry to make staging room');
    assert.ok((await cache.getState()).bytes <= 750);
    assert.equal((await readdir(cache.directory)).some(name => name.startsWith('pending-')), false);
  } finally { await cache.close(); await rm(directory, { recursive: true, force: true }); }
});

test('serialized concurrent acquisition downloads once; second owner fails without deleting the first lock', async () => {
  const directory = await folder(); let count = 0;
  const options = { directory, fetchBytes: async () => { count++; return Buffer.from('jar'); } };
  const cache = new JarArtifactCache(options); await cache.getState();
  const other = new JarArtifactCache(options);
  try {
    await cache.getState();
    await assert.rejects(other.getState(), rejected('JAR_CACHE_ALREADY_OWNED'));
    await other.close();
    const [a, b] = await Promise.all([cache.acquire('http://fixture.invalid/a'), cache.acquire('http://fixture.invalid/a')]);
    assert.equal(a.sha256, b.sha256); assert.equal(count, 1);
    assert.equal((await readdir(cache.directory)).includes('.lock'), true);
  } finally { await other.close(); await cache.close(); await rm(directory, { recursive: true, force: true }); }
});

test('actual HTTP transport bounds chunked/declared sizes, errors and hanging responses', async () => {
  const server = createServer((req, res) => {
    if (req.url === '/hang') { res.write('x'); return; }
    if (req.url === '/error') { res.writeHead(503); res.end('error'); return; }
    if (req.url === '/declared') res.setHeader('Content-Length', '100');
    res.end(req.url === '/empty' ? '' : '12345');
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    for (const path of ['/', '/declared']) await assert.rejects(fetchArtifactBytes(base + path, { maxBytes: 4 }), rejected('JAR_SIZE_LIMIT'));
    await assert.rejects(fetchArtifactBytes(base + '/empty'), rejected('EMPTY_JAR'));
    await assert.rejects(fetchArtifactBytes(base + '/error'), rejected('JAR_HTTP_503'));
    await assert.rejects(fetchArtifactBytes(base + '/hang', { timeoutMs: 50 }), error => error.name === 'TimeoutError' || error.name === 'AbortError');
    await assert.rejects(fetchArtifactBytes('file:///tmp/a'), rejected('JAR_SCHEME_UNAVAILABLE'));
  } finally { server.closeAllConnections(); await new Promise(done => server.close(done)); }
});

test('close cancels an active download and removes owned cache; unavailable schemes fail explicitly', async () => {
  let started;
  const ready = new Promise(done => { started = done; });
  const cache = new JarArtifactCache({ fetchBytes: async (_, { signal }) => { started(); await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })); } });
  const pending = cache.resolve('http://fixture.invalid/hang');
  const rejection = assert.rejects(pending, /aborted/);
  await ready; const directory = cache.directory;
  await cache.close(); await rejection;
  await assert.rejects(stat(directory), error => error.code === 'ENOENT');
  const unsupported = new JarArtifactCache();
  try {
    await assert.rejects(unsupported.resolve('img+http://fixture.invalid/a'), rejected('IMAGE_JAR_REQUIRES_EXPLICIT_MAPPING'));
    await assert.rejects(unsupported.resolve('clan://localhost/a'), rejected('JAR_SCHEME_REQUIRES_EXPLICIT_MAPPING'));
  } finally { await unsupported.close(); }
});
