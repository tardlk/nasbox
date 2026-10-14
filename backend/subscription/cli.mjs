// SPDX-License-Identifier: GPL-3.0-only
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSourceSubscriptionLoader } from './loader.mjs';
import { FileSubscriptionStore } from './store.mjs';
import { createVodSubscriptionLoader } from './vod-loader.mjs';
import { createFullSubscriptionLoader } from './full-loader.mjs';

const args = process.argv.slice(2);
let data = resolve(dirname(fileURLToPath(import.meta.url)), '../../.data/subscriptions');
let url, useCache = false, vod = false, full = false;
for (let index = 0; index < args.length; index++) {
  const value = args[index];
  if (value === '--cache') useCache = true;
  else if (value === '--vod') vod = true;
  else if (value === '--config') full = true;
  else if (value === '--data') {
    const directory = args[++index];
    if (!directory || directory.startsWith('--')) throw new Error('--data needs a directory');
    data = directory;
  } else if (value.startsWith('--')) throw new Error('Unknown subscription option');
  else { if (url !== undefined) throw new Error('Provide one subscription URL'); url = value; }
}
if (vod && full) throw new Error('Choose --vod or --config');
const loader = (full ? createFullSubscriptionLoader : vod ? createVodSubscriptionLoader : createSourceSubscriptionLoader)({ store: new FileSubscriptionStore(data) });
try {
  const result = await loader.load({ apiUrl: url, useCache });
  if (!result.ok) { console.log(JSON.stringify({ ...result, scope: loader.scope })); process.exitCode = 1; }
  else {
    const counts = {};
    for (const site of result.sites) counts[site.type] = (counts[site.type] || 0) + 1;
    const summary = { ok: true, sourceCount: result.sites.length, typeCounts: counts,
      collectionLines: (await loader.getState()).apiLineList.length, scope: loader.scope };
    if (vod || full) {
      const config = await loader.getConfig();
      Object.assign(summary, { hasGlobalSpider: !!config.globals.spider, parseCount: config.parses.length,
        vipFlagCount: config.flags.length, hasHomeSource: config.home !== null });
    }
    if (full) {
      const config = await loader.getConfig();
      Object.assign(summary, { liveGroupCount: config.liveChannels.length, hostCount: Object.keys(config.hosts || {}).length,
        proxyRuleCount: config.proxies.length, ruleHostCount: Object.keys(config.rules.rules).length,
        dnsOptionCount: config.dnsNames.length, adHostCount: config.ads.length,
        unboundEffects: config.effects.filter(effect => !effect.completed).map(effect => effect.operation) });
    }
    console.log(JSON.stringify(summary));
  }
} finally { await loader.close(); }
