import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createVodSubscriptionLoader } from '../backend/subscription/vod-loader.mjs';
import { FileSubscriptionStore, MemorySubscriptionStore } from '../backend/subscription/store.mjs';

test('VOD selections persist through disk cache and a new worker, including older six-field state compatibility', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tvbox-vod-'));
  let loader;
  try {
    const store = new FileSubscriptionStore(directory);
    await store.writeState({ apiUrl: '', liveApiUrl: '', apiLineSource: '', apiLineList: [], apiHistory: [], liveApiHistory: [] });
    loader = createVodSubscriptionLoader({ store, fetchText: async () => '{sites:[{key:"a",type:3,api:"csp_A"}],spider:"demo.jar",parses:[{name:"P",url:"https://p.invalid/?url="}],flags:["vip"]}' });
    assert.equal((await loader.load({ apiUrl: 'https://example.invalid/tv' })).ok, true);
    const before = await loader.getConfig();
    assert.equal(before.home.key, 'a');
    assert.equal(before.defaultParse.name, '超级解析');
    const persisted = await store.readState();
    assert.equal(persisted.homeApi, 'a');
    assert.equal(persisted.defaultParse, '超级解析');
    await loader.close(); loader = undefined;
    loader = createVodSubscriptionLoader({ store: new FileSubscriptionStore(directory), fetchText: async () => { throw new Error('network must not run'); } });
    assert.equal((await loader.load({ useCache: true })).ok, true);
    assert.deepEqual(await loader.getConfig(), before);
    assert.equal(loader.scope, 'vod-prefix');
  } finally { if (loader) await loader.close(); await rm(directory, { recursive: true, force: true }); }
});

test('selection mutations before a parse failure persist while failed config is not cached', async () => {
  const store = new MemorySubscriptionStore({ state: { homeApi: 'missing', defaultParse: 'Old' } });
  const loader = createVodSubscriptionLoader({ store, fetchText: async () => '{sites:[{key:"a",type:3,api:"csp_A"}],spider:"new.jar",parses:null}' });
  try {
    assert.deepEqual(await loader.load({ apiUrl: 'https://example.invalid/tv' }), { ok: false, message: '配置解析失败' });
    const persisted = await store.readState();
    assert.equal(persisted.homeApi, 'a');
    assert.equal(persisted.defaultParse, 'Old');
    const config = await loader.getConfig();
    assert.equal(config.globals.spider, 'new.jar');
    assert.equal(config.home.key, 'a');
    assert.equal(config.defaultParse, null);
    assert.deepEqual(await store.listCache(), {});
    assert.deepEqual((await loader.getSites()).map(site => site.key), ['a']);
  } finally { await loader.close(); }
});
