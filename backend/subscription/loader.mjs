// SPDX-License-Identifier: GPL-3.0-only
// Port of the selected ApiConfig.loadConfig control flow. Default parse scope: source fields.
import { createConfigCore } from '../config-core/index.mjs';
import { SubscriptionPreparationError } from './prepare.mjs';
import { MemorySubscriptionStore } from './store.mjs';
import { fetchSubscriptionText } from './transport.mjs';

export function createSourceSubscriptionLoader({ core, store = new MemorySubscriptionStore(),
  fetchText = fetchSubscriptionText, parseConfig, onEvent = () => {}, maxHops = 32 } = {}) {
  const owned = !core;
  core ||= createConfigCore();
  let closed = false;
  async function run(stage, request) {
    const result = await core.query(request);
    if (!result.ok) throw new SubscriptionPreparationError(stage, result);
    return result.value;
  }
  parseConfig ||= text => core.parseSites(text);
  let queue = (async () => run('state', { operation: 'state', state: await store.readState() }))();
  // Attach a rejection handler immediately; each queued request still receives the failure.
  queue.catch(() => {});
  let initializationError;
  queue = queue.catch(error => { initializationError = error; });
  function serialize(action) {
    if (closed) return Promise.reject(new Error('Subscription loader is closed'));
    const result = queue.then(() => { if (initializationError) throw initializationError; return action(); });
    queue = result.catch(() => {});
    return result;
  }
  const state = () => run('state', { operation: 'state' });
  async function persist() { await store.writeState(await state()); }
  async function inspect(apiUrl, text) {
    const selection = await run('collectionSwitch', { operation: 'collectionSwitch', url: apiUrl, text });
    await persist();
    if (selection.switched) return { switched: true };
    await run('clearLines', { operation: 'clearLines', url: apiUrl });
    await persist();
    onEvent({ kind: 'parse', url: apiUrl });
    const sites = await parseConfig(text, { apiUrl, core });
    return { switched: false, sites };
  }
  async function saveCache(key, text) {
    onEvent({ kind: 'cacheWrite', key });
    // Original FileUtils.saveCache catches failures; successful parsing still succeeds.
    try { await store.writeCache(key, Buffer.from(text, 'utf8')); } catch {}
  }
  async function visit(useCache, hops) {
    if (hops >= maxHops) throw new Error('Subscription collection exceeds hop limit');
    const apiUrl = (await state()).apiUrl;
    if (apiUrl === '') return { ok: false, message: '-1' };
    const key = await run('cacheKey', { operation: 'cacheKey', url: apiUrl });
    let cached, cacheError;
    try { cached = await store.readCache(key); } catch (error) { cacheError = error; }
    const hasCache = cached !== null && cached !== undefined || !!cacheError;
    async function cacheText() {
      if (cacheError) throw cacheError;
      return run('cacheRead', { operation: 'cacheRead', bytes: cached.toString('base64') });
    }
    if (useCache && hasCache) {
      try {
        const inspected = await inspect(apiUrl, await cacheText());
        if (inspected.switched) return await visit(false, hops + 1);
        return { ok: true, apiUrl, sites: inspected.sites };
      } catch (error) {
        // Host collection limits must not turn into recursive refetch loops.
        if (error.message === 'Subscription collection exceeds hop limit') throw error;
      }
    }
    // Original configUrl runs outside the network callback error handler.
    const selected = await run('url', { operation: 'url', url: apiUrl });
    let text, fetchError;
    try {
      onEvent({ kind: 'fetch', url: selected.url });
      const body = await fetchText(selected.url);
      const prepared = await run('fetchBody', { operation: 'fetchBody', url: apiUrl, text: body, key: selected.key });
      if (!prepared.success) fetchError = prepared.error;
      else text = prepared.text;
    } catch (error) { fetchError = error.message || String(error); }
    if (fetchError !== undefined) {
      if (hasCache) {
        try {
          const inspected = await inspect(apiUrl, await cacheText());
          if (inspected.switched) return await visit(false, hops + 1);
          return { ok: true, apiUrl, sites: inspected.sites };
        } catch (error) { if (error.message === 'Subscription collection exceeds hop limit') throw error; }
      }
      return { ok: false, message: '拉取配置失败\n' + fetchError };
    }
    try {
      const inspected = await inspect(apiUrl, text);
      if (inspected.switched) {
        await saveCache(key, text);
        return await visit(false, hops + 1);
      }
      await saveCache(key, text);
      return { ok: true, apiUrl, sites: inspected.sites };
    } catch (error) {
      if (error.message === 'Subscription collection exceeds hop limit') throw error;
      return { ok: false, message: '配置解析失败' };
    }
  }
  return {
    scope: 'source-fields',
    load({ apiUrl, useCache = false } = {}) {
      return serialize(async () => {
        if (apiUrl !== undefined) {
          const current = await state();
          await run('state', { operation: 'state', state: { ...current, apiUrl } });
          await persist();
        }
        return visit(useCache, 0);
      });
    },
    getState() { return serialize(state); },
    getSites() { return serialize(() => run('siteState', { operation: 'siteState' })); },
    async close() {
      closed = true;
      await queue;
      if (owned) await core.close();
    },
  };
}
