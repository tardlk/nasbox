// SPDX-License-Identifier: GPL-3.0-only
// One Node implementation hashes both private outputs; public results contain no
// source keys, URLs, ext values, configuration text or exception messages.
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hashPattern = /^[a-f0-9]{64}$/;
const officialApkSha256 = '5fb63e491f280c0e271091da5490fcdf0923d6c2f8773ef03553b20a333db657';
const classPattern = /^(?:[A-Za-z_$][\w$]*\.)*[A-Za-z_$][\w$]*$/;
const knownFields = new Set(['globals','sites','spider','jarCache','danmaku','wallpaper','key','name','api','type','searchable','quickSearch','changeable','filterable','playUrl','ext','jar','categories','playerType','timeout','click','style','playTimeoutSeconds']);
const identityError = reason => Object.assign(new Error('Parser comparison input identity differs: ' + reason), { code: 'INPUT_CHECKSUM' });

export function canonicalParserValue(value) {
  if (Array.isArray(value)) return value.map(canonicalParserValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalParserValue(value[key])]));
  return value;
}
const semantic = value => sha(JSON.stringify(canonicalParserValue(value)));
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const counts = values => values.reduce((result, key) => (result[key] = (result[key] || 0) + 1, result), {});
const safeField = key => knownFields.has(key) ? key : 'sha256:' + sha(key);
const safeError = error => !error ? null : {
  type: typeof error.type === 'string' && error.type.length <= 240 && classPattern.test(error.type) ? error.type : 'UnknownError',
  fingerprint: hashPattern.test(error.fingerprint) ? error.fingerprint : null,
};

export async function readParserResults(directory) {
  const names = (await readdir(directory)).filter(name => /^(?:result-)?\d+(?:-private)?\.json$/.test(name)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return Promise.all(names.map(async name => JSON.parse(await readFile(join(directory, name), 'utf8'))));
}

function indexResults(results, expected, host, manifestSha256, expectedApkSha256) {
  const indexed = new Map();
  for (const result of results) {
    const meta = result?.report;
    const configIndex = meta?.configIndex;
    const input = expected.get(configIndex);
    if (!input || indexed.has(configIndex)) throw identityError(host + ' unknown or duplicate config index');
    if (meta.manifestSha256 !== manifestSha256 || meta.rawSha256 !== input.rawSha256 || meta.apiUrlSha256 !== sha(input.apiUrl) || meta.idSha256 !== sha(input.id)) throw identityError(host + ' manifest/raw/API/id pin');
    if (result.input && (result.input.id !== input.id || result.input.apiUrl !== input.apiUrl || result.input.rawSha256 !== input.rawSha256)) throw identityError(host + ' private input differs');
    if (host === 'ART' && meta.targetApkSha256 !== expectedApkSha256) throw identityError('ART original APK pin');
    if (host === 'ART' && (!Array.isArray(meta.unobservableFields) || meta.unobservableFields.length !== 1 || meta.unobservableFields[0] !== 'filterable')) throw identityError('ART audited unobservable field set');
    if (typeof result.preparedText === 'string') {
      if (meta.configSha256 !== sha(result.preparedText) || input.configSha256 && input.configSha256 !== meta.configSha256) throw identityError(host + ' prepared configuration hash');
    } else if (meta.accepted === true) throw identityError(host + ' accepted result lacks private prepared text');
    if (result.normalized !== undefined && (!object(result.normalized) || !object(result.normalized.globals) || !Array.isArray(result.normalized.sites) || result.normalized.sites.some(row => !object(row)))) throw identityError(host + ' malformed normalized snapshot');
    indexed.set(configIndex, result);
  }
  return indexed;
}

function state(result) {
  if (!result) return 'missing';
  const meta = result.report;
  if (meta.failureKind === 'harnessLookupFailure' || meta.errorPhase?.startsWith('harness') ||
      ['originalConfigUrl','snapshot'].includes(meta.errorPhase) && /(?:ClassNotFoundException|NoSuchMethodException|NoSuchFieldException)$/.test(meta.error?.type || '')) return 'harness-failure';
  if (meta.timedOut || /Timeout/.test(meta.error?.type || '')) return 'timeout';
  if (meta.accepted === true) return result.normalized ? 'accepted' : 'missing-snapshot';
  if (meta.accepted === false) return ['originalFetchPreparation','rawDownload','manifest'].includes(meta.errorPhase) ? 'preparation-failed' : 'rejected';
  return 'unknown';
}

function normalizedValue(result, host) {
  if (!result?.normalized) return null;
  const value = structuredClone(result.normalized);
  // This is the only schema exclusion. No values, defaults, booleans, source
  // order, duplicate handling, categories or string contents are rewritten.
  if (host === 'NAS') for (const row of value.sites) delete row.filterable;
  return value;
}

function summarize(result, host) {
  const prepared = typeof result?.preparedText === 'string' ? result.preparedText : undefined;
  const normalized = normalizedValue(result, host);
  return {
    present: !!result, state: state(result),
    ...(prepared === undefined ? {} : { configSha256: sha(prepared), configBytes: Buffer.byteLength(prepared) }),
    ...(normalized === null ? {} : { sourceCount: normalized.sites.length, sourceRowsSha256: semantic(normalized.sites), globalsSha256: semantic(normalized.globals), normalizedSha256: semantic(normalized) }),
    ...(result?.report.error ? { error: safeError(result.report.error) } : {}),
  };
}

function differences(left, right, path = '', output = []) {
  if (JSON.stringify(canonicalParserValue(left)) === JSON.stringify(canonicalParserValue(right))) return output;
  if (output.length >= 64) return output;
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) output.push(path + '.length');
    for (let i = 0; i < Math.min(left.length, right.length) && output.length < 64; i++) differences(left[i], right[i], path + '[' + i + ']', output);
  } else if (object(left) && object(right)) {
    for (const key of [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()) {
      if (output.length >= 64) break;
      const child = path ? path + '.' + safeField(key) : safeField(key);
      if (!Object.hasOwn(left, key) || !Object.hasOwn(right, key)) output.push(child);
      else differences(left[key], right[key], child, output);
    }
  } else output.push(path || '$');
  return output;
}

export function compareParserResults(plan, artResults, nasResults, { manifestSha256, expectedApkSha256 = officialApkSha256, generatedAt = new Date().toISOString() } = {}) {
  if (plan?.schemaVersion !== 1 || !Array.isArray(plan.configs) || !hashPattern.test(manifestSha256) || expectedApkSha256 !== officialApkSha256) throw new Error('Expected exact parser plan, manifest SHA-256 and audited original APK');
  const expected = new Map();
  plan.configs.forEach((input, index) => {
    if (typeof input.id !== 'string' || typeof input.apiUrl !== 'string' || !hashPattern.test(input.rawSha256) || input.configSha256 && !hashPattern.test(input.configSha256)) throw identityError('malformed plan config');
    expected.set(index, input);
  });
  const art = indexResults(artResults, expected, 'ART', manifestSha256, expectedApkSha256);
  const nas = indexResults(nasResults, expected, 'NAS', manifestSha256, expectedApkSha256);
  const cases = [];
  for (const [configIndex, input] of expected) {
    const a = art.get(configIndex), b = nas.get(configIndex);
    const row = { configIndex, idSha256: sha(input.id), apiUrlSha256: sha(input.apiUrl), rawSha256: input.rawSha256, art: summarize(a, 'ART'), nas: summarize(b, 'NAS') };
    if (a && b && typeof a.preparedText === 'string' && typeof b.preparedText === 'string') row.preparedEqual = a.preparedText === b.preparedText;
    if (!a || !b) row.observation = 'unknown-missing-result';
    else if ([row.art.state, row.nas.state].some(value => ['harness-failure','timeout','unknown','missing-snapshot'].includes(value))) row.observation = 'unknown-execution';
    else if (row.art.state === 'accepted' && row.nas.state === 'accepted') {
      row.globalsEqual = row.art.globalsSha256 === row.nas.globalsSha256;
      row.sourceRowsEqual = row.art.sourceRowsSha256 === row.nas.sourceRowsSha256;
      row.normalizedEqual = row.art.normalizedSha256 === row.nas.normalizedSha256;
      row.observation = row.preparedEqual !== true ? 'preparation-difference' : row.normalizedEqual ? 'matched-observable-parser-output' : 'parser-output-difference';
      if (!row.normalizedEqual) row.differencePaths = differences(normalizedValue(a, 'ART'), normalizedValue(b, 'NAS'));
    } else if (row.art.state === 'rejected' && row.nas.state === 'rejected') {
      row.observation = 'both-rejected';
      row.exceptionTypeEqual = !!row.art.error && !!row.nas.error && row.art.error.type === row.nas.error.type;
      if (a.normalized && b.normalized) {
        row.partialGlobalsEqual = row.art.globalsSha256 === row.nas.globalsSha256;
        row.partialSourceRowsEqual = row.art.sourceRowsSha256 === row.nas.sourceRowsSha256;
        row.partialNormalizedEqual = row.art.normalizedSha256 === row.nas.normalizedSha256;
        if (!row.partialNormalizedEqual) row.partialDifferencePaths = differences(normalizedValue(a, 'ART'), normalizedValue(b, 'NAS'));
      }
    } else if ([row.art.state, row.nas.state].includes('preparation-failed')) row.observation = 'unknown-preparation-failure';
    else row.observation = 'acceptance-difference';
    cases.push(row);
  }
  return {
    schemaVersion: 1, generatedAt, manifestSha256, targetApkSha256: expectedApkSha256,
    scope: 'Original official APK preparation and parseJson on Android/ART versus NAS config core using fixed captured raw bytes and original API URLs. Full configuration and UI behavior are outside this comparison.',
    hashScope: 'Prepared text and normalized JSON are recomputed from private files by one Node implementation; producer semantic hashes are not compared.',
    comparisonFields: { globals: ['spider','jarCache','danmaku','wallpaper'], sourceRows: 'Every observed row and field, preserving values, types and insertion order', excluded: ['sites[].filterable'], exclusionReason: 'Exact audited official APK R8 build removed SourceBean.filterable storage/getter. No Android runtime observation is available; the field is excluded only from NAS projection.' },
    summary: { expectedCases: expected.size, artCases: art.size, nasCases: nas.size, pairedCases: cases.filter(row => row.art.present && row.nas.present).length,
      artAccepted: cases.filter(row => row.art.state === 'accepted').length, nasAccepted: cases.filter(row => row.nas.state === 'accepted').length,
      pairedAccepted: cases.filter(row => row.art.state === 'accepted' && row.nas.state === 'accepted').length,
      preparedMatches: cases.filter(row => row.preparedEqual === true).length, normalizedMatches: cases.filter(row => row.normalizedEqual === true).length,
      matchedCases: cases.filter(row => row.observation === 'matched-observable-parser-output').length,
      matchedSourceRows: cases.filter(row => row.observation === 'matched-observable-parser-output').reduce((sum, row) => sum + row.art.sourceCount, 0),
      bothRejected: cases.filter(row => row.observation === 'both-rejected').length,
      bothRejectedMatchingPartial: cases.filter(row => row.observation === 'both-rejected' && row.partialNormalizedEqual === true).length,
      harnessFailures: cases.filter(row => row.art.state === 'harness-failure' || row.nas.state === 'harness-failure').length,
      missingART: cases.filter(row => !row.art.present).map(row => row.configIndex), missingNAS: cases.filter(row => !row.nas.present).map(row => row.configIndex),
      observations: counts(cases.map(row => row.observation)) }, cases,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [planPath, artDirectory, nasDirectory, output] = process.argv.slice(2);
  if (!output) throw new Error('Usage: node compare-parser-results.mjs PLAN ART_PRIVATE_DIR NAS_PRIVATE_DIR PUBLIC_OUTPUT');
  const [planBytes, art, nas] = await Promise.all([readFile(planPath), readParserResults(artDirectory), readParserResults(nasDirectory)]);
  const report = compareParserResults(JSON.parse(planBytes), art, nas, { manifestSha256: sha(planBytes) });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report.summary));
}
