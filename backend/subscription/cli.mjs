// SPDX-License-Identifier: GPL-3.0-only
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSourceSubscriptionLoader } from './loader.mjs';
import { FileSubscriptionStore } from './store.mjs';
import { createVodSubscriptionLoader } from './vod-loader.mjs';

const args = process.argv.slice(2);
let data = resolve(dirname(fileURLToPath(import.meta.url)), '../../.data/subscriptions');
let url, useCache = false, vod = false;
for (let index = 0; index < args.length; index++) {
  const value = args[index];
  if (value === '--cache') useCache = true;
  else if (value === '--vod') vod = true;
  else if (value === '--data') {
    const directory = args[++index];
    if (!directory || directory.startsWith('--')) throw new Error('--data needs a directory');
    data = directory;
  } else if (value.startsWith('--')) throw new Error('Unknown subscription option');
  else { if (url !== undefined) throw new Error('Provide one subscription URL'); url = value; }
}
const loader = (vod ? createVodSubscriptionLoader : createSourceSubscriptionLoader)({ store: new FileSubscriptionStore(data) });
try {
  const result = await loader.load({ apiUrl: url, useCache });
  if (!result.ok) { console.log(JSON.stringify({ ...result, scope: loader.scope })); process.exitCode = 1; }
  else {
    const counts = {};
    for (const site of result.sites) counts[site.type] = (counts[site.type] || 0) + 1;
    const summary = { ok: true, sourceCount: result.sites.length, typeCounts: counts,
      collectionLines: (await loader.getState()).apiLineList.length, scope: loader.scope };
    if (vod) {
      const config = await loader.getConfig();
      Object.assign(summary, { hasGlobalSpider: !!config.globals.spider, parseCount: config.parses.length,
        vipFlagCount: config.flags.length, hasHomeSource: config.home !== null });
    }
    console.log(JSON.stringify(summary));
  }
} finally { await loader.close(); }
