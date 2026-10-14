// Controlled fixture adapter around the actual production source subscription loader.
import { createConfigCore } from '../../backend/config-core/index.mjs';
import { createSourceSubscriptionLoader } from '../../backend/subscription/loader.mjs';
import { MemorySubscriptionStore } from '../../backend/subscription/store.mjs';

export async function runLoadScenario(request) {
  const core = createConfigCore();
  let loader;
  try {
    const cache = {};
    for (const [url, value] of Object.entries(request.cache || {})) {
      const key = await core.query({ operation: 'cacheKey', url });
      if (!key.ok) throw new Error('Fixture cache key failed');
      cache[key.value] = typeof value === 'string' ? Buffer.from(value) : Buffer.from(value.base64, 'base64');
    }
    const store = new MemorySubscriptionStore({ state: request.preferences || {}, cache });
    const events = []; let fetchIndex = 0;
    loader = createSourceSubscriptionLoader({ core, store, onEvent: event => events.push(event), fetchText: async url => {
      const plan = request.fetches?.[fetchIndex++];
      if (!plan) throw new Error('fixture exhausted');
      if (plan.url !== undefined && plan.url !== url) throw new Error('unexpected fixture URL');
      if (Object.hasOwn(plan, 'error')) throw new Error(plan.error);
      return plan.body;
    } });
    const results = [];
    for (const load of request.loads) {
      try { results.push(await loader.load({ apiUrl: load.url, useCache: !!load.useCache })); }
      catch (error) { results.push({ ok: false, thrown: error.errorType || error.name }); }
    }
    return { results, state: await loader.getState(), sites: await loader.getSites(),
      cache: Object.fromEntries(Object.entries(await store.listCache()).map(([key, bytes]) => [key, bytes.toString('base64')])), events };
  } finally { if (loader) await loader.close(); await core.close(); }
}
