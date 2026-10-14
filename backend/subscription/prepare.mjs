// SPDX-License-Identifier: GPL-3.0-only
// Composes the source-backed steps in ApiConfig.fetchConfigAsync and collection inspection.
import { createConfigCore } from '../config-core/index.mjs';

export class SubscriptionPreparationError extends Error {
  constructor(stage, result) {
    super(`Subscription ${stage} failed: ${result.errorType}`);
    this.name = 'SubscriptionPreparationError';
    this.stage = stage;
    this.errorType = result.errorType;
    this.partialSites = result.partialSites;
  }
}

/** Input is an already-decoded HTTP body string, not parsed JS JSON. No network/cache/script execution. */
export async function prepareSubscription(apiUrl, body, { core, localAddress } = {}) {
  const owned = !core;
  core ||= createConfigCore();
  async function run(stage, request) {
    const result = await core.query(request);
    if (!result.ok) throw new SubscriptionPreparationError(stage, result);
    return result.value;
  }
  try {
    const selected = await run('url', { operation: 'url', url: apiUrl, ...(localAddress === undefined ? {} : { localAddress }) });
    let text = await run('decode', { operation: 'decode', text: body, key: selected.key });
    // Upstream tests the original configured URL, not the selected HTTP URL.
    if (apiUrl.startsWith('clan')) text = await run('clanFix', { operation: 'clanFix', url: apiUrl, text });
    text = await run('fix', { operation: 'fix', url: apiUrl, text });
    const collectionLines = await run('collection', { operation: 'collection', text });
    return { requestUrl: selected.url, text, collectionLines };
  } finally { if (owned) await core.close(); }
}
