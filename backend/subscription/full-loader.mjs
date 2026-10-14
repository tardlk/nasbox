// SPDX-License-Identifier: GPL-3.0-only
import { createConfigCore, ConfigParseError } from '../config-core/index.mjs';
import { createSourceSubscriptionLoader } from './loader.mjs';
import { RuntimeCleanup } from './runtime-cleanup.mjs';

/** Full parseJson state, with explicit unbound transport/script effects. */
export function createFullSubscriptionLoader(options = {}) {
  const owned = !options.core;
  const core = options.core || createConfigCore();
  const runtimeCleanup = options.runtimeCleanup || new RuntimeCleanup();
  const loader = createSourceSubscriptionLoader({ ...options, core, parseScope: 'config-state',
    parseConfig: async (text, { apiUrl }) => {
      // Source clearSpiderCache empties active keys before destroying loaders.
      const reset = await core.query({ operation: 'fullResetKeys' });
      if (!reset.ok) throw new ConfigParseError(reset);
      const cleared = await runtimeCleanup.clearForImport();
      // Replay the failed stage into the state parser so containers and warmed keys
      // retain the same partial state. No new configuration is parsed after failure.
      return (await core.parseFull(text, apiUrl, { clearFailure: cleared.failedAt })).sites;
    },
    readConfig: async () => {
      const result = await core.query({ operation: 'fullState' });
      if (!result.ok) throw new ConfigParseError(result);
      return result.value;
    },
  });
  return {
    ...loader,
    runtimeCleanup,
    getSites() { return loader.getConfig().then(config => config.sites); },
    async close() {
      try { await loader.close(); }
      finally { try { await runtimeCleanup.close(); } finally { if (owned) await core.close(); } }
    },
  };
}
