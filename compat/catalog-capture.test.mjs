// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { runCatalogCapture } from '../scripts/compat/capture-catalog.mjs';

const hash = (value, algorithm = 'sha256') => createHash(algorithm).update(value).digest('hex');
const writeJson = (path, value) => writeFile(path, JSON.stringify(value));
async function fixture(t, config) {
  const root = await mkdtemp(join(tmpdir(), 'tvbox-catalog-capture-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeJson(join(root, 'config.json'), config);
  await writeJson(join(root, 'inventory.json'), { entries: [{ id: 'synthetic', publicName: 'Synthetic fixture', parseSuccess: true, configFile: 'config.json' }] });
  return root;
}
function response(url, body, options = {}) {
  const result = new Response(body, options);
  Object.defineProperty(result, 'url', { value: url });
  return result;
}
const inventory = async root => JSON.parse(await readFile(join(root, 'artifact-inventory.json'), 'utf8'));

test('catalog capture freezes image response bytes before charset/Base64 decoding and remote MD5 bytes, including resumed evidence', async t => {
  const main = Buffer.from('synthetic image JAR'), site = Buffer.from('synthetic site JAR');
  const encoded = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('prefix 12345678**' + main.toString('base64'), 'utf16le')]);
  const md5Text = Buffer.from(' \r\n' + hash(site, 'md5') + '\n ');
  const root = await fixture(t, { globals: { spider: 'img+https://fixture.invalid/main' }, sites: [
    { key: 'main', type: 3, api: 'csp_Main', ext: '' },
    { key: 'site', type: 3, api: 'csp_Site', ext: {}, jar: 'https://fixture.invalid/site;md5;https://fixture.invalid/md5' },
  ] });
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const path = new URL(url).pathname; calls.push({ path, userAgent: options.headers['User-Agent'] });
    const body = path === '/main' ? encoded : path === '/md5' ? md5Text : site;
    return response('https://redirected.invalid' + path, body, { headers: { 'content-type': path === '/main' ? 'text/plain; charset=wrong-encoding' : 'application/octet-stream', 'x-fixture': 'private-value' } });
  });
  await runCatalogCapture({ directory: root, stage: 'artifacts' });
  const first = await inventory(root), [mainRecord, siteRecord] = first.retrievals;
  assert.deepEqual(calls, [{ path: '/main', userAgent: 'okhttp/3.15' }, { path: '/md5', userAgent: 'okhttp/3.12.11' }, { path: '/site', userAgent: 'okhttp/3.12.11' }]);
  assert.equal(mainRecord.sha256, hash(main));
  assert.equal(siteRecord.md5Matches, true);
  assert.deepEqual(siteRecord.responses.map(item => item.kind), ['remote-md5', 'jar']);
  for (const [captured, bytes] of [[mainRecord.responses[0], encoded], [siteRecord.responses[0], md5Text], [siteRecord.responses[1], site]]) {
    assert.equal(captured.complete, true);
    assert.equal(captured.bodyCaptured, true);
    assert.equal(captured.sha256, hash(bytes));
    assert.equal(captured.bytes, bytes.length);
    assert.equal(captured.headers['x-fixture'], 'private-value');
    assert.match(captured.responseUrl, /^https:\/\/redirected\.invalid\//);
    assert.match(captured.file, /^artifact-responses\/[a-f0-9-]+\.bin$/);
    assert.deepEqual(await readFile(join(root, captured.file)), bytes);
    assert.equal((await stat(join(root, captured.file))).mode & 0o777, 0o600);
  }
  await runCatalogCapture({ directory: root, stage: 'artifacts' });
  const second = await inventory(root);
  assert.equal(calls.length, 3, 'resuming a captured signature does not fetch mutable remote bytes again');
  assert.deepEqual(second.retrievals.map(item => item.responses), first.retrievals.map(item => item.responses));
});

test('failed image decoding retains raw body while HTTP failure records unread body explicitly', async t => {
  const encoded = Buffer.from('12345678**A=');
  const root = await fixture(t, { globals: { spider: 'img+https://fixture.invalid/bad-image' }, sites: [
    { key: 'image', type: 3, api: 'csp_Image', ext: '' },
    { key: 'http', type: 3, api: 'csp_Http', ext: '', jar: 'https://fixture.invalid/unavailable' },
  ] });
  t.mock.method(globalThis, 'fetch', async url => new URL(url).pathname === '/bad-image'
    ? response(String(url), encoded) : response(String(url), 'private error body', { status: 503, headers: { 'retry-after': '10' } }));
  await runCatalogCapture({ directory: root, stage: 'artifacts' });
  const result = await inventory(root), [image, http] = result.retrievals;
  assert.equal(image.ok, false);
  assert.equal(image.error.code, 'IMAGE_JAR_BASE64_INVALID');
  assert.equal(image.responses[0].complete, true);
  assert.deepEqual(await readFile(join(root, image.responses[0].file)), encoded);
  assert.equal(http.ok, false);
  assert.equal(http.error.code, 'JAR_HTTP_503');
  assert.equal(http.responses[0].status, 503);
  assert.equal(http.responses[0].headers['retry-after'], '10');
  assert.equal(http.responses[0].complete, false);
  assert.equal(http.responses[0].bodyCaptured, false);
  assert.equal(http.responses[0].file, undefined);
});

test('interrupted response retains only received prefix and cannot be reported as complete', async t => {
  const prefix = Buffer.from('received prefix');
  const root = await fixture(t, { sites: [{ key: 'partial', type: 3, api: 'csp_Partial', ext: '', jar: 'https://fixture.invalid/interrupted' }] });
  t.mock.method(globalThis, 'fetch', async url => {
    let reads = 0;
    return response(String(url), new ReadableStream({ pull(controller) {
      if (reads++ === 0) controller.enqueue(prefix);
      else controller.error(new Error('synthetic connection reset'));
    } }));
  });
  await runCatalogCapture({ directory: root, stage: 'artifacts' });
  const result = await inventory(root), record = result.retrievals[0], captured = record.responses[0];
  assert.equal(record.ok, false);
  assert.match(record.error.message, /synthetic connection reset/);
  assert.equal(captured.bodyCaptured, true);
  assert.equal(captured.complete, false);
  assert.equal(captured.sha256, hash(prefix));
  assert.deepEqual(await readFile(join(root, captured.file)), prefix);
});

test('different signatures sharing a cache identity retain the original HTTP response reference', async t => {
  const bytes = Buffer.from('synthetic shared JAR'), url = 'https://fixture.invalid/shared';
  const root = await fixture(t, { globals: { spider: url + ';md5;' + hash(bytes, 'md5') }, sites: [{ key: 'one', type: 3, api: 'csp_One', ext: '' }] });
  await writeJson(join(root, 'second-config.json'), { globals: { spider: url }, sites: [{ key: 'two', type: 3, api: 'csp_Two', ext: '' }] });
  const catalog = JSON.parse(await readFile(join(root, 'inventory.json'), 'utf8'));
  catalog.entries.push({ id: 'second', publicName: 'Second synthetic fixture', parseSuccess: true, configFile: 'second-config.json' });
  await writeJson(join(root, 'inventory.json'), catalog);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async request => { calls++; return response(String(request), bytes); });
  await runCatalogCapture({ directory: root, stage: 'artifacts' });
  const [first, second] = (await inventory(root)).retrievals;
  assert.equal(calls, 1);
  assert.equal(second.cacheOrigin, 'cache');
  assert.equal(second.cacheKey, first.cacheKey);
  assert.equal(second.responses[0].file, first.responses[0].file);
  assert.equal(second.responses[0].sha256, hash(bytes));
  assert.equal(second.responses[0].reusedFromCache, true);
});
