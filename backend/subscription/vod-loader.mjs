// SPDX-License-Identifier: GPL-3.0-only
import { createConfigCore, ConfigParseError } from '../config-core/index.mjs';
import { createSourceSubscriptionLoader } from './loader.mjs';

/** Expanded selected ApiConfig prefix. Live/hosts/proxy/rules/DOH/ads and executors remain pending. */
export function createVodSubscriptionLoader(options = {}) {
  const owned = !options.core;
  const core = options.core || createConfigCore();
  const loader = createSourceSubscriptionLoader({ ...options, core, parseScope: 'vod-prefix',
    parseConfig: async (text, { apiUrl }) => (await core.parseVod(text, apiUrl)).sites,
    readConfig: async () => {
      const result = await core.query({ operation: 'vodState' });
      if (!result.ok) throw new ConfigParseError(result);
      return result.value;
    },
  });
  return {
    ...loader,
    getSites() { return loader.getConfig().then(config => config.sites); },
    async close() { try { await loader.close(); } finally { if (owned) await core.close(); } },
  };
}
