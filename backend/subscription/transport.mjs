// SPDX-License-Identifier: GPL-3.0-only
/** Node transport adapter. OkHttp charset/BOM/DNS/TLS/cookie parity remains unverified. */
export async function fetchSubscriptionText(url, { timeoutMs = 20000, maxBytes = 6 * 1024 * 1024 } = {}) {
  if (!['http:', 'https:'].includes(new URL(url).protocol)) throw new Error('Subscription transport accepts HTTP(S)');
  const response = await fetch(url, { headers: { 'User-Agent': 'okhttp/3.12.11' },
    redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP ${response.status}`); }
  const chunks = []; let size = 0;
  if (response.body) for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('Subscription response exceeds size limit');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}
