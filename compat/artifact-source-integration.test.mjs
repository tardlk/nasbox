// SPDX-License-Identifier: GPL-3.0-only
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm, readFile, writeFile, readdir, symlink, realpath, unlink, rename } from 'node:fs/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { JarArtifactCache, JAR_CACHE_AGE_MS, jarUrlKey } from '../backend/spider-runtime/artifact-cache.mjs';
import { createExecutableSubscriptionSession } from '../backend/spider-runtime/session.mjs';
import { buildSpiderFixtures } from '../scripts/compat/spider-fixtures.mjs';

const digest = (bytes, algorithm = 'md5') => createHash(algorithm).update(bytes).digest('hex');
const rejected = code => error => error.code === code;
const image = bytes => 'PNG fixture-prefix A1b2C3d4**' + bytes.toString('base64');
const fixtures = buildSpiderFixtures(), jarBytes = readFileSync(fixtures.jar);
after(() => rm(fixtures.build, { recursive: true, force: true }));
async function directory() { return mkdtemp(join(tmpdir(), 'tvbox-artifact-source-integration-')); }
async function serve(handler) {
  const server = createServer(handler);
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  return { base: 'http://127.0.0.1:' + server.address().port, async close() { server.closeAllConnections(); await new Promise(done => server.close(done)); } };
}
async function noStaging(cache) { assert.equal((await readdir(cache.directory)).some(name => name.startsWith('pending-')), false); }
function utf16be(text) { const bytes = Buffer.from(text, 'utf16le'); bytes.swap16(); return bytes; }

test('actual HTTP image JARs decode response charset/BOM, hash decoded bytes, keep original source keys and reuse after restart', async () => {
  const root = await directory(), requests = [], expected = image(jarBytes);
  const variants = [
    ['utf8', Buffer.from(expected), 'text/plain; charset=utf-8'],
    ['utf16le', Buffer.from(expected, 'utf16le'), 'text/plain; charset="utf-16le"'],
    ['utf16be', utf16be(expected), 'text/plain; charset=utf-16be'],
    ['bom-override', Buffer.concat([Buffer.from([255, 254]), Buffer.from(expected, 'utf16le')]), 'text/plain; charset=utf-8'],
    ['latin1', Buffer.from('é' + expected, 'latin1'), 'text/plain; charset=iso-8859-1'],
    ['unknown-charset', Buffer.from(expected), 'text/plain; charset=fixture-unknown'],
  ];
  const http = await serve((req, res) => {
    requests.push({ url: req.url, userAgent: req.headers['user-agent'] });
    const variant = variants.find(([name]) => req.url === '/' + name);
    if (!variant) { res.end(jarBytes); return; }
    res.setHeader('Content-Type', variant[2]); res.end(variant[1]);
  });
  const options = { directory: root, integrity: 'strict' };
  let cache = new JarArtifactCache(options);
  try {
    for (const [name] of variants) {
      const source = 'img+' + http.base + '/' + name, signature = source + ';md5;' + digest(jarBytes);
      const actual = await cache.resolve(signature, { role: 'main' });
      assert.equal(actual.key, 'main-' + jarUrlKey(source));
      assert.equal(actual.retrieval, 'image'); assert.equal(actual.md5Matches, true);
      assert.equal(actual.sha256, digest(jarBytes, 'sha256')); assert.equal(actual.bytes, jarBytes.length);
      assert.deepEqual(await readFile(actual.path), jarBytes, name);
    }
    const binarySource = http.base + '/img+binary';
    const binary = await cache.resolve(binarySource, { role: 'main' });
    assert.equal(binary.key, 'main-' + jarUrlKey(binarySource)); assert.deepEqual(await readFile(binary.path), jarBytes);
    assert.equal(requests.at(-1).url, '/binary', 'main also removes embedded img+ in binary URLs');
    assert.equal(requests.every(row => row.userAgent === 'okhttp/3.15'), true);
    const previousRequests = requests.length;
    await cache.close(); cache = new JarArtifactCache(options);
    const restarted = await cache.resolve('img+' + http.base + '/utf8;md5;' + digest(jarBytes), { role: 'main' });
    assert.equal(restarted.origin, 'cache'); assert.equal(requests.length, previousRequests);
    assert.equal((await cache.getState()).entries, variants.length + 1); await noStaging(cache);
  } finally { await cache.close(); await http.close(); await rm(root, { recursive: true, force: true }); }
});

test('image transport and decoded limits, malformed padding and strict MD5 failures leave no partial managed files', async () => {
  const roots = [], caches = [], payloads = new Map([
    ['/invalid', 'ABCDEFGH**QQ='], ['/empty', 'not an image JAR'], ['/padding-data', 'ABCDEFGH**QQ==Qg=='],
    ['/large-wire', 'x'.repeat(1025)], ['/large-decoded', image(Buffer.alloc(65))], ['/good', image(Buffer.from('jar'))],
  ]);
  const http = await serve((req, res) => { res.end(payloads.get(req.url)); });
  async function cache(options) { const root = await directory(); roots.push(root); const item = new JarArtifactCache({ directory: root, ...options }); caches.push(item); return item; }
  try {
    const malformed = await cache({ integrity: 'strict' });
    for (const [path, code] of [['/invalid', 'IMAGE_JAR_BASE64_INVALID'], ['/empty', 'EMPTY_JAR'], ['/padding-data', 'IMAGE_JAR_BASE64_INVALID']]) {
      await assert.rejects(malformed.resolve('img+' + http.base + path, { role: 'main' }), rejected(code));
      assert.equal((await malformed.getState()).entries, 0); await noStaging(malformed);
    }
    await assert.rejects(malformed.resolve('img+' + http.base + '/good;md5;' + digest('different'), { role: 'main' }), rejected('JAR_MD5_MISMATCH'));
    assert.equal((await malformed.getState()).entries, 0);
    const wire = await cache({ maxImageBytes: 1024 });
    await assert.rejects(wire.resolve('img+' + http.base + '/large-wire', { role: 'main' }), rejected('JAR_SIZE_LIMIT'));
    const decoded = await cache({ maxArtifactBytes: 64, maxImageBytes: 1024 });
    await assert.rejects(decoded.resolve('img+' + http.base + '/large-decoded', { role: 'main' }), rejected('JAR_SIZE_LIMIT'));
    const quota = await cache({ maxBytes: 2 });
    await assert.rejects(quota.resolve('img+' + http.base + '/good', { role: 'main' }), rejected('JAR_CACHE_QUOTA'));
    for (const item of [wire, decoded, quota]) { assert.equal((await item.getState()).entries, 0); await noStaging(item); }
    const fallback = await cache({});
    const source = 'img+' + http.base + '/good', before = await fallback.resolve(source, { role: 'main' });
    payloads.set('/good', 'ABCDEFGH**QQ=');
    const retained = await fallback.resolve(source, { role: 'main', force: true });
    assert.equal(retained.origin, 'fallback'); assert.equal(retained.sha256, before.sha256);
    assert.equal(await readFile(before.path, 'utf8'), 'jar'); await noStaging(fallback);
  } finally { for (const item of caches) await item.close(); await http.close(); for (const root of roots) await rm(root, { recursive: true, force: true }); }
});

test('asset copies use managed SHA/MD5 cache and age refresh while caller asset files survive cache invalidation', async () => {
  const root = await directory(), assetRoot = join(root, 'assets'); await mkdir(join(assetRoot, 'box'), { recursive: true });
  const source = 'assets://assets/box/assets/source.jar', path = join(assetRoot, 'box/source.jar');
  await writeFile(path, 'asset-old'); let clock = 1000;
  const cache = new JarArtifactCache({ directory: join(root, 'cache'), assetRoot, now: () => clock, integrity: 'strict' });
  try {
    const first = await cache.acquire(source + ';md5;' + digest('asset-old'));
    assert.equal(first.retrieval, 'assets'); assert.notEqual(first.path, path); assert.equal(first.md5Matches, true);
    assert.equal(await readFile(first.path, 'utf8'), 'asset-old');
    assert.ok((await cache.getState()).bytes > Buffer.byteLength('asset-old'));
    await writeFile(path, 'asset-new');
    assert.equal((await cache.resolve(source + ';md5;' + digest('asset-old'))).origin, 'cache');
    await assert.rejects(cache.resolve(source + ';md5;' + digest('asset-new')), rejected('JAR_UPDATE_REQUIRES_RUNTIME_CLEAR'));
    await cache.releaseAll();
    const refreshed = await cache.resolve(source + ';md5;' + digest('asset-new'));
    assert.equal(refreshed.key, first.key); assert.equal(await readFile(refreshed.path, 'utf8'), 'asset-new');
    await assert.rejects(cache.resolve(source + ';md5;' + digest('wrong')), rejected('JAR_MD5_MISMATCH'));
    assert.equal(await readFile(refreshed.path, 'utf8'), 'asset-new');
    await writeFile(path, 'asset-age-update'); clock += JAR_CACHE_AGE_MS + 1;
    assert.equal(await readFile((await cache.resolve(source)).path, 'utf8'), 'asset-age-update');
    await cache.invalidate(first.key); assert.equal((await cache.getState()).entries, 0);
    assert.equal(await readFile(path, 'utf8'), 'asset-age-update'); await noStaging(cache);
  } finally { try { await cache.close(); assert.equal(await readFile(path, 'utf8'), 'asset-age-update'); } finally { await rm(root, { recursive: true, force: true }); } }
});

test('local files prefer externalRoot then fileRoot, reread updates, enforce limits/digests and never consume managed quota or delete caller bytes', async () => {
  const root = await directory(), externalRoot = join(root, 'external'), fileRoot = join(root, 'files');
  await mkdir(join(externalRoot, 'box'), { recursive: true }); await mkdir(join(fileRoot, 'box'), { recursive: true });
  const external = join(externalRoot, 'box/source.jar'), fallback = join(fileRoot, 'box/source.jar');
  await writeFile(external, 'external'); await writeFile(fallback, 'fallback');
  const cache = new JarArtifactCache({ directory: join(root, 'cache'), externalRoot, fileRoot, maxBytes: 1, maxArtifactBytes: 16, integrity: 'strict' });
  try {
    const before = await cache.acquire('file:///box/source.jar;md5;' + digest('external'));
    assert.equal(before.origin, 'local'); assert.equal(before.retrieval, 'file'); assert.equal(before.key, undefined);
    assert.equal(before.path, await realpath(external));
    assert.equal((await cache.getState()).pinned, 0); assert.equal((await cache.getState()).bytes, 0);
    await writeFile(external, 'updated');
    const updated = await cache.resolve('file:///box/source.jar;md5;' + digest('updated'));
    assert.notEqual(updated.sha256, before.sha256); assert.equal(updated.bytes, 7);
    await assert.rejects(cache.resolve('file:///box/source.jar;md5;' + digest('fallback')), rejected('JAR_MD5_MISMATCH'));
    await unlink(external);
    assert.equal((await cache.resolve('file:///box/source.jar')).path, await realpath(fallback));
    await writeFile(external, Buffer.alloc(17));
    await assert.rejects(cache.resolve('file:///box/source.jar'), rejected('JAR_SIZE_LIMIT'));
    await writeFile(external, ''); await assert.rejects(cache.resolve('file:///box/source.jar'), rejected('EMPTY_JAR'));
    await unlink(external); await mkdir(external);
    await assert.rejects(cache.resolve('file:///box/source.jar'), rejected('JAR_FILE_INVALID'));
    assert.equal((await cache.getState()).entries, 0); assert.equal((await cache.getState()).bytes, 0); await noStaging(cache);
    await cache.releaseAll();
  } finally { try { await cache.close(); assert.equal(await readFile(fallback, 'utf8'), 'fallback'); } finally { await rm(root, { recursive: true, force: true }); } }
});

test('explicit local roots reject traversal and external symlinks without falling through to a different caller file', async () => {
  const root = await directory(), assetRoot = join(root, 'assets'), externalRoot = join(root, 'external'), fileRoot = join(root, 'files');
  for (const path of [assetRoot, externalRoot, fileRoot]) await mkdir(path);
  const outside = join(root, 'outside.jar'); await writeFile(outside, 'outside');
  await writeFile(join(fileRoot, 'escaped.jar'), 'fallback');
  await symlink(outside, join(assetRoot, 'escaped.jar')); await symlink(outside, join(externalRoot, 'escaped.jar'));
  const fifo = join(externalRoot, 'named-pipe.jar'), created = spawnSync('/usr/bin/mkfifo', [fifo], { encoding: 'utf8', timeout: 5000 });
  assert.equal(created.status, 0, created.stderr);
  const cache = new JarArtifactCache({ assetRoot, externalRoot, fileRoot });
  const unbound = new JarArtifactCache();
  try {
    for (const source of ['assets://../outside.jar', 'file:/../outside.jar', 'assets://escaped.jar', 'file:/escaped.jar']) {
      await assert.rejects(cache.resolve(source), rejected('JAR_PATH_OUTSIDE_ROOT'), source);
    }
    await assert.rejects(unbound.resolve('assets://source.jar'), rejected('JAR_ASSET_ROOT_REQUIRED'));
    await assert.rejects(unbound.resolve('file:/source.jar'), rejected('JAR_FILE_ROOT_REQUIRED'));
    await assert.rejects(cache.resolve('assets://missing.jar'), rejected('JAR_FILE_NOT_FOUND'));
    await assert.rejects(cache.resolve('file:/named-pipe.jar'), rejected('JAR_FILE_INVALID'));
    assert.equal(await readFile(outside, 'utf8'), 'outside'); assert.equal(await readFile(join(fileRoot, 'escaped.jar'), 'utf8'), 'fallback');
    assert.equal((await cache.getState()).entries, 0);
  } finally { try { await unbound.close(); await cache.close(); assert.equal(await readFile(outside, 'utf8'), 'outside'); } finally { await rm(root, { recursive: true, force: true }); } }
});

test('localhost and remote clan JARs rewrite to real HTTP file routes while retaining distinct source cache identities', async () => {
  const requests = [], http = await serve((req, res) => { requests.push(req.url); res.end(jarBytes); });
  const cache = new JarArtifactCache({ localAddress: http.base + '/' });
  try {
    const local = await cache.resolve('clan://localhost/box/a.jar');
    const remote = await cache.resolve('clan://' + http.base.slice(7) + '/box/a.jar');
    assert.deepEqual(requests, ['/file/box/a.jar', '/file/box/a.jar']);
    assert.notEqual(local.key, remote.key); assert.deepEqual(await readFile(local.path), jarBytes); assert.equal(remote.sha256, local.sha256);
    await assert.rejects(cache.resolve('clan://localhost/box/a.jar', { role: 'main' }), rejected('JAR_SCHEME_UNSUPPORTED_FOR_ROLE'));
    await assert.rejects(cache.resolve('img+' + http.base + '/box/a.jar', { role: 'site' }), rejected('JAR_SCHEME_UNSUPPORTED_FOR_ROLE'));
  } finally { await cache.close(); await http.close(); }
});

test('executable subscription session runs image, assets, local and clan JARs and reimport clears loaded generations before updates', async () => {
  const root = await directory(), assetRoot = join(root, 'assets'), externalRoot = join(root, 'external'), fileRoot = join(root, 'files');
  for (const path of [assetRoot, externalRoot, fileRoot]) await mkdir(path);
  const asset = join(assetRoot, 'fixture.jar'), external = join(externalRoot, 'fixture.jar'), fallback = join(fileRoot, 'fixture.jar');
  await writeFile(asset, jarBytes); await writeFile(external, jarBytes); await writeFile(fallback, jarBytes);
  let body = jarBytes, generation = 0; const requests = [];
  const http = await serve((req, res) => { requests.push(req.url); res.end(req.url === '/image' ? image(body) : body); });
  const config = () => JSON.stringify({
    spider: 'img+' + http.base + '/image;md5;' + digest(body),
    sites: [
      { key: 'main', type: 3, api: 'csp_Contract', ext: 'main-' + generation },
      { key: 'asset', type: 3, api: 'csp_Contract', ext: 'asset-' + generation, jar: 'assets://fixture.jar;md5;' + digest(body) },
      { key: 'local', type: 3, api: 'csp_Contract', ext: 'local-' + generation, jar: 'file:///fixture.jar' },
      { key: 'clan', type: 3, api: 'csp_Contract', ext: 'clan-' + generation, jar: 'clan://localhost/fixture.jar;md5;' + digest(body) },
    ],
  });
  const configRequests = [];
  let session;
  const tokens = new Map();
  try {
    session = await createExecutableSubscriptionSession({ remoteJars: true, artifactCacheDir: join(root, 'cache'), localAddress: http.base + '/', fetchText: async url => { configRequests.push(url); return config(); }, jarCacheOptions: { assetRoot, externalRoot, fileRoot, integrity: 'strict' } });
    assert.equal((await session.load({ apiUrl: http.base + '/config' })).ok, true); assert.equal(requests.length, 0);
    assert.deepEqual(configRequests, [http.base + '/config']);
    for (const key of ['main', 'asset', 'local', 'clan']) {
      const result = await session.call(key, 'homeContent', [true]); tokens.set(key, result.spider.token);
      assert.equal(JSON.parse(result.value).ext, key + '-0');
      assert.equal((await session.call(key, 'action', ['resource'])).value, 'fixture-resource');
    }
    assert.deepEqual(requests, ['/image', '/file/fixture.jar']);
    assert.equal((await session.getState()).artifacts.entries, 3); assert.equal((await session.getState()).artifacts.pinned, 3);
    writeFileSync(join(fixtures.build, 'classes/assets/value.txt'), 'fixture-source-updated');
    const updatedJar = join(root, 'updated.jar');
    const pack = spawnSync(join(fixtures.built.javaHome, 'bin/jar'), ['--create', '--file', updatedJar, '-C', join(fixtures.build, 'classes'), '.'], { encoding: 'utf8', timeout: 30000 });
    assert.equal(pack.status, 0, pack.stderr); body = await readFile(updatedJar); generation++;
    await writeFile(asset, body); await writeFile(fallback, body);
    // Local JARs remain caller files: atomic replacement preserves a loaded
    // ZipFile's old inode until reimport, unlike truncating the active archive.
    const externalNext = join(externalRoot, 'fixture.next.jar'); await writeFile(externalNext, body); await rename(externalNext, external);
    for (const key of ['main', 'asset', 'local', 'clan']) assert.equal((await session.call(key, 'action', ['resource'])).value, 'fixture-resource', key + ' loaded generation');
    assert.equal(requests.length, 2);
    // Reimport invokes the existing runtime cleanup path before installing config.
    assert.equal((await session.load({ apiUrl: http.base + '/config' })).ok, true);
    assert.deepEqual(configRequests, [http.base + '/config', http.base + '/config']);
    for (const key of ['main', 'asset', 'local', 'clan']) {
      const result = await session.call(key, 'homeContent', [true]);
      assert.notEqual(result.spider.token, tokens.get(key)); assert.equal(JSON.parse(result.value).ext, key + '-1');
      assert.equal((await session.call(key, 'action', ['resource'])).value, 'fixture-source-updated');
    }
    assert.deepEqual(requests, ['/image', '/file/fixture.jar', '/image', '/file/fixture.jar']);
    assert.equal((await session.getState()).artifacts.entries, 3); assert.equal((await session.getState()).artifacts.pinned, 3);
  } finally {
    try {
      await session?.close(); await http.close();
      assert.deepEqual(await readFile(asset), body); assert.deepEqual(await readFile(external), body); assert.deepEqual(await readFile(fallback), body);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

test('top-level localAddress maps a real clan subscription request and original clan content rewriting before execution', async () => {
  const requests = [];
  const http = await serve((req, res) => {
    requests.push(req.url);
    if (req.url === '/file/config') {
      res.end(JSON.stringify({ sites: [{ key: 'clan-config', type: 3, api: 'csp_Contract', ext: 'clan-config', jar: 'clan://localhost/fixture.jar' }] }));
    } else res.end(jarBytes);
  });
  let session;
  try {
    session = await createExecutableSubscriptionSession({ remoteJars: true, localAddress: http.base + '/' });
    assert.equal((await session.load({ apiUrl: 'clan://localhost/config' })).ok, true);
    assert.deepEqual(requests, ['/file/config']);
    assert.equal((await session.getConfig()).sites[0].jar, http.base + '/file/fixture.jar');
    const actual = await session.call('clan-config', 'homeContent', [true]);
    assert.equal(JSON.parse(actual.value).ext, 'clan-config');
    assert.equal((await session.call('clan-config', 'action', ['resource'])).value, 'fixture-resource');
    assert.deepEqual(requests, ['/file/config', '/file/fixture.jar']);
  } finally { try { await session?.close(); } finally { await http.close(); } }
});
