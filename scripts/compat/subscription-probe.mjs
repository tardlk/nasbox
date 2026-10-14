// Read-only subscription probe. It never executes downloaded scripts/JARs.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { createConfigCore } from '../../backend/config-core/index.mjs';
import { buildOracle, queryOracle } from './oracle.mjs';
import { queryWinbox, compareResult } from './compare.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export function unwrapSubscriptionBytes(bytes) {
  const text = bytes.toString('utf8');
  // Android FindResult checks a plain JSON object before looking for a wrapper.
  // Preserve that order for strict JSON; lenient org.json-specific detection
  // remains outside this transport probe's documented coverage.
  try {
    const plain = JSON.parse(text);
    if (plain && typeof plain === 'object' && !Array.isArray(plain)) return { text, envelope: 'unwrapped-text' };
  } catch {}
  const marker = /[A-Za-z0-9]{8}\*\*/.exec(text);
  // This probe covers the visible salt+base64 branch. AES, charset/BOM handling
  // and malformed Android Base64 semantics still need dedicated reference tests.
  if (marker) return { text: Buffer.from(text.slice(marker.index + 10), 'base64').toString('utf8').trim(),
    envelope: 'salt-base64', markerOffset: marker.index };
  return { text, envelope: 'unwrapped-text' };
}

export async function probeSubscription(inputUrl, options = {}) {
  const url = new URL(inputUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Probe accepts HTTP(S) subscription URLs');
  const ua = options.userAgent || 'okhttp/3.12.11';
  const timeoutMs = options.timeoutMs || 25000, maxBytes = options.maxBytes || 8 * 1024 * 1024;
  const response = await fetch(url, { headers: { 'User-Agent': ua, Accept: '*/*' },
    redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`Subscription HTTP ${response.status}`);
  const chunks = []; let size = 0;
  if (!response.body) throw new Error('Subscription response has no body');
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('Subscription exceeds probe size limit');
    chunks.push(Buffer.from(chunk));
  }
  const bytes = Buffer.concat(chunks), decoded = unwrapSubscriptionBytes(bytes);
  const built = options.oracle || buildOracle();
  const json = queryOracle([{ operation: 'json', text: decoded.text }], built)[0];
  const metadata = {
    sourceUrl: url.href, finalUrl: response.url, userAgent: ua, status: response.status,
    contentType: response.headers.get('content-type'), bytes: bytes.length,
    responseSha256: digest(bytes), signatureHex: bytes.subarray(0, 12).toString('hex'),
    envelope: decoded.envelope, decodedSha256: digest(decoded.text),
    sourceParserAccepted: json.ok,
    scope: 'Read-only source-method probe on host JVM; no Android/ART or script execution',
  };
  if (!json.ok) return { ...metadata, sourceErrorType: json.errorType };
  if (!json.value || typeof json.value !== 'object' || Array.isArray(json.value)) return { ...metadata, configObject: false };
  const fixed = queryOracle([{ operation: 'fix', url: inputUrl, text: decoded.text }], built)[0];
  if (!fixed.ok) return { ...metadata, sourceErrorType: fixed.errorType };
  const request = { operation: 'sites', text: fixed.value };
  const androidSource = queryOracle([request], built)[0];
  const winbox = queryWinbox(request);
  const core = createConfigCore();
  let backend, backendFixed;
  try {
    backendFixed = await core.query({ operation: 'fix', url: inputUrl, text: decoded.text });
    backend = backendFixed.ok
      ? await core.query({ operation: 'sites', text: backendFixed.value }) : backendFixed;
  } finally { await core.close(); }
  const config = json.value;
  const sites = Array.isArray(config.sites) ? config.sites : [];
  const typeCounts = {};
  if (androidSource.ok) for (const site of androidSource.value) typeCounts[site.type] = (typeCounts[site.type] || 0) + 1;
  let spiderExtension = null;
  try { spiderExtension = new URL(String(config.spider || '').split(';')[0]).pathname.split('.').at(-1); } catch {}
  return {
    ...metadata, configObject: true, sourceSitesAccepted: androidSource.ok,
    sourceSites: androidSource.ok ? androidSource.value.length : null,
    winboxSites: winbox.ok ? winbox.value.length : null,
    backendSites: backend.ok ? backend.value.length : null,
    backendPathComparison: { equal: isDeepStrictEqual(fixed, backendFixed) },
    backendSiteComparison: { equal: isDeepStrictEqual(androidSource, backend) },
    typeCounts, siteComparison: compareResult(androidSource, winbox),
    hasGlobalSpider: !!config.spider, globalSpiderExtension: spiderExtension,
    globalSpiderMd5Tagged: String(config.spider || '').includes(';md5;'),
    cspSites: sites.filter(site => typeof site.api === 'string' && site.api.startsWith('csp_')).length,
    jsSites: sites.filter(site => typeof site.api === 'string' && /\.js(?:\?|$)/i.test(site.api)).length,
    pySites: sites.filter(site => typeof site.api === 'string' && /\.py(?:\?|$)/i.test(site.api)).length,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const url = process.argv[2];
  if (!url) throw new Error('Usage: subscription-probe.mjs URL [--report PATH]');
  const reportAt = process.argv.indexOf('--report');
  const result = await probeSubscription(url);
  if (reportAt >= 0) {
    const path = process.argv[reportAt + 1];
    if (!path) throw new Error('--report needs an output path');
    writeFileSync(resolve(path), JSON.stringify(result, null, 2) + '\n');
  }
  console.log(JSON.stringify(result, null, 2));
}
