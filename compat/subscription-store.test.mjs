import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createSourceSubscriptionLoader } from '../backend/subscription/loader.mjs';
import { FileSubscriptionStore, MemorySubscriptionStore } from '../backend/subscription/store.mjs';

test('disk preferences and prepared caches survive a worker restart and load without network', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tvbox-store-'));
  let loader;
  try {
    loader = createSourceSubscriptionLoader({ store: new FileSubscriptionStore(directory), fetchText: async url => url.endsWith('/collection')
      ? '{urls:[{name:"Main",url:"https://example.invalid/tv"}]}' : '{sites:[{key:"demo",type:3,api:"csp_Demo"}]}' });
    assert.equal((await loader.load({ apiUrl: 'https://example.invalid/collection' })).sites.length, 1);
    const before = await loader.getState();
    await loader.close(); loader = undefined;
    loader = createSourceSubscriptionLoader({ store: new FileSubscriptionStore(directory), fetchText: async () => { throw new Error('network must not run'); } });
    assert.deepEqual(await loader.getState(), before);
    const result = await loader.load({ useCache: true });
    assert.equal(result.ok, true); assert.equal(result.sites[0].key, 'demo');
    assert.equal((await readdir(join(directory, 'configs'))).length, 2);
    assert.deepEqual((await readdir(directory)).sort(), ['configs', 'state.json']);
  } finally { if (loader) await loader.close(); await rm(directory, { recursive: true, force: true }); }
});

test('cache write failure preserves successful parse while a corrupt state file is reported and retained', async () => {
  const store = new MemorySubscriptionStore();
  store.writeCache = async () => { throw new Error('disk full'); };
  const loader = createSourceSubscriptionLoader({ store, fetchText: async () => '{sites:[]}' });
  try { assert.equal((await loader.load({ apiUrl: 'https://example.invalid/tv' })).ok, true); }
  finally { await loader.close(); }
  const directory = await mkdtemp(join(tmpdir(), 'tvbox-store-'));
  let corrupt;
  try {
    await writeFile(join(directory, 'state.json'), '{broken');
    corrupt = createSourceSubscriptionLoader({ store: new FileSubscriptionStore(directory) });
    await assert.rejects(corrupt.load(), SyntaxError);
    assert.equal(await readFile(join(directory, 'state.json'), 'utf8'), '{broken');
  } finally { if (corrupt) await corrupt.close(); await rm(directory, { recursive: true, force: true }); }
});

test('disk cache keys cannot escape the data directory; failed atomic writes leave no temporary files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tvbox-store-'));
  try {
    const store = new FileSubscriptionStore(directory, { maxBytes: 64 });
    await assert.rejects(store.writeCache('../escape', Buffer.from('x')), /Invalid subscription cache key/);
    await assert.rejects(store.writeCache('0'.repeat(32), Buffer.alloc(65)), /size limit/);
    assert.deepEqual(await readdir(directory), []);
    await store.writeCache('0'.repeat(32), Buffer.from('original'));
    // Force a failure after temporary-file creation, during rename.
    await writeFile(join(directory, 'state.json'), 'sentinel');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(directory, 'configs', '1'.repeat(32)));
    await assert.rejects(store.writeCache('1'.repeat(32), Buffer.from('new')));
    assert.ok((await readdir(join(directory, 'configs'))).every(name => !name.endsWith('.tmp')));
    assert.equal((await store.readCache('0'.repeat(32))).toString(), 'original');
    assert.equal(await readFile(join(directory, 'state.json'), 'utf8'), 'sentinel');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('concurrent imports serialize entire load sequences and close rejects later loads', async () => {
  const urls = [], events = [];
  const loader = createSourceSubscriptionLoader({ onEvent: event => events.push(event), fetchText: async url => {
    urls.push(url); return `{sites:[{key:"${url.endsWith('/a') ? 'a' : 'b'}",type:3,api:"csp_Demo"}]}`;
  } });
  try {
    const results = await Promise.all([loader.load({ apiUrl: 'https://example.invalid/a' }), loader.load({ apiUrl: 'https://example.invalid/b' })]);
    assert.deepEqual(results.map(result => result.sites[0].key), ['a', 'b']);
    assert.deepEqual(urls, ['https://example.invalid/a', 'https://example.invalid/b']);
    assert.deepEqual(events.map(event => event.kind), ['fetch', 'parse', 'cacheWrite', 'fetch', 'parse', 'cacheWrite']);
  } finally { await loader.close(); }
  await assert.rejects(loader.load(), /closed/);
});

test('collection cycles stop at the host hop limit without recursive fallback loops', async () => {
  let count = 0;
  const loader = createSourceSubscriptionLoader({ maxHops: 3, fetchText: async url => {
    count++; return `{urls:["https://example.invalid/${url.endsWith('/a') ? 'b' : 'a'}"]}`;
  } });
  try {
    await assert.rejects(loader.load({ apiUrl: 'https://example.invalid/a' }), /hop limit/);
    assert.equal(count, 3);
  } finally { await loader.close(); }
});

test('real Node HTTP transport follows a collection and recovers from HTTP failure using prepared cache', async () => {
  const requests = []; let offline = false;
  const server = createServer((request, response) => {
    requests.push({ path: request.url, ua: request.headers['user-agent'] });
    if (offline) { response.writeHead(503); response.end(); }
    else if (request.url === '/collection') response.end(`{urls:["http://127.0.0.1:${server.address().port}/tv"]}`);
    else response.end('Abc12345**' + Buffer.from('{sites:[{key:"demo",type:3,api:"csp_Demo"}]}').toString('base64'));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const loader = createSourceSubscriptionLoader();
  try {
    assert.equal((await loader.load({ apiUrl: `http://127.0.0.1:${server.address().port}/collection` })).sites.length, 1);
    offline = true;
    assert.equal((await loader.load()).sites[0].key, 'demo');
    assert.deepEqual(requests.map(item => item.path), ['/collection', '/tv', '/tv']);
    assert.ok(requests.every(item => item.ua === 'okhttp/3.12.11'));
  } finally { await loader.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
