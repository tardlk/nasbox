// Read-only subscription probe. It never executes downloaded scripts/JARs.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { createConfigCore } from '../../backend/config-core/index.mjs';
import { prepareSubscription } from '../../backend/subscription/prepare.mjs';
import { buildOracle, queryOracle } from './oracle.mjs';
import { queryWinbox, compareResult } from './compare.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export async function unwrapSubscriptionBytes(bytes, { core, key = null } = {}) {
  const owned = !core;
  core ||= createConfigCore();
  const text = bytes.toString('utf8');
  try {
    const result = await core.query({ operation: 'decode', text, key });
    if (!result.ok) throw new Error(`Subscription decode failed: ${result.errorType}`);
    const marker = /[A-Za-z0-9]{8}\*\*/.exec(text);
    // Envelope is diagnostic metadata only; the Java result controls decoding.
    const envelope = result.value === null ? 'decode-null' : result.value === text ? 'unwrapped-text'
      : marker ? 'salt-base64' : key !== null || /^\s*2423/.test(text) ? 'aes-or-normalized-text' : 'normalized-text';
    return { text: result.value, envelope };
  } finally { if (owned) await core.close(); }
}

export async function probeSubscription(inputUrl, options = {}) {
  const built = options.oracle || buildOracle();
  const core = createConfigCore();
  try { return await probeWithCore(inputUrl, options, core, built); }
  finally { await core.close(); }
}

async function probeWithCore(inputUrl, options, core, built) {
  const selected = await core.query({ operation: 'url', url: inputUrl });
  if (!selected.ok) throw new Error(`Subscription URL failed: ${selected.errorType}`);
  const sourceSelected = queryOracle([{ operation: 'url', url: inputUrl }], built)[0];
  const url = new URL(selected.value.url);
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
  const bytes = Buffer.concat(chunks);
  const raw = bytes.toString('utf8');
  const decoded = await unwrapSubscriptionBytes(bytes, { core, key: selected.value.key });
  const sourceDecoded = queryOracle([{ operation: 'decode', text: raw, key: sourceSelected.value?.key }], built)[0];
  const json = queryOracle([{ operation: 'json', text: sourceDecoded.value }], built)[0];
  const metadata = {
    sourceUrl: url.href, finalUrl: response.url, userAgent: ua, status: response.status,
    contentType: response.headers.get('content-type'), bytes: bytes.length,
    responseSha256: digest(bytes), signatureHex: bytes.subarray(0, 12).toString('hex'),
    envelope: decoded.envelope, decodedSha256: decoded.text === null ? null : digest(decoded.text),
    backendUrlComparison: { equal: isDeepStrictEqual(sourceSelected, selected) },
    backendDecodeComparison: { equal: isDeepStrictEqual(sourceDecoded, { ok: true, value: decoded.text }) },
    sourceParserAccepted: typeof sourceDecoded.value === 'string' && json.ok,
    scope: 'Read-only source-method probe on host JVM; no Android/ART or script execution',
  };
  if (!json.ok) return { ...metadata, sourceErrorType: json.errorType };
  if (!json.value || typeof json.value !== 'object' || Array.isArray(json.value)) return { ...metadata, configObject: false };
  let sourceText = sourceDecoded.value;
  if (inputUrl.startsWith('clan')) {
    const clanFixed = queryOracle([{ operation: 'clanFix', url: inputUrl, text: sourceText }], built)[0];
    if (!clanFixed.ok) return { ...metadata, sourceErrorType: clanFixed.errorType };
    sourceText = clanFixed.value;
  }
  const fixed = queryOracle([{ operation: 'fix', url: inputUrl, text: sourceText }], built)[0];
  if (!fixed.ok) return { ...metadata, sourceErrorType: fixed.errorType };
  const request = { operation: 'sites', text: fixed.value };
  const androidSource = queryOracle([request], built)[0];
  const winbox = queryWinbox(request);
  const prepared = await prepareSubscription(inputUrl, raw, { core });
  const backendFixed = { ok: true, value: prepared.text };
  const backend = await core.query({ operation: 'sites', text: prepared.text });
  const sourceCollection = queryOracle([{ operation: 'collection', text: fixed.value }], built)[0];
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
    collectionLines: prepared.collectionLines.length,
    backendCollectionComparison: { equal: isDeepStrictEqual(sourceCollection, { ok: true, value: prepared.collectionLines }) },
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
