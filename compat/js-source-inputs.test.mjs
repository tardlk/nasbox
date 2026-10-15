// SPDX-License-Identifier: GPL-3.0-only
// Owned frozen catalogs and mocked HTTP bodies; no provider execution or services.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { freezeCatalog, verifyCatalogFreeze } from '../scripts/compat/freeze-catalog.mjs';
import { discoverJsDependencies, fetchJsInput, prepareJsSourceInputs, selectCapturedJsSources, verifyJsSourceInputs } from '../scripts/compat/prepare-js-source-inputs.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const SECRET = 'JS_PRIVATE_7bd', API = 'https://owned.invalid/drpy2.js?token=' + SECRET;
const keys = ['虎牙js', '斗鱼js', 'dr_兔小贝'];
const response = (body, status = 200, headers = {}) => new Response(body, { status, headers: { 'Content-Type': 'application/javascript; charset=utf-8', ...headers } });
const writeJson = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n');

test('static dependencies use lexical imports and literal calls without reading comments, quoted code or regex as dependencies', () => {
  const text = `// import 'https://must-not.invalid/comment.js'
/* require('https://must-not.invalid/block.js') */
const printed = "import 'https://must-not.invalid/string.js'";
const regexp = /['"]import.*\\/fake/gi;
import one from './first.js'; export { one } from './second.js';
import './side.js'; import('./dynamic.js'); import(computedName);
require('./required.js'); request('https://owned.invalid/rule.json');
request('https://business.invalid/api'); fetch('https://business.invalid/get?id=1');
import x from 'assets://js/lib/crypto-js.js';
const stringWithHex='unrelated\\x2f';`;
  const result = discoverJsDependencies(text, 'https://owned.invalid/lib/main.js');
  assert.deepEqual(result.dependencies.map(row => row.specifier), ['./first.js', './second.js', './side.js', './dynamic.js', './required.js', 'https://owned.invalid/rule.json', 'assets://js/lib/crypto-js.js']);
  assert.equal(result.dependencies.at(-1).kind, 'bundled-asset');
  assert.equal(result.unresolved.length, 1);
  assert.equal(result.unresolved[0].reason, 'computed-dependency');
  assert.equal(JSON.stringify(result).includes('must-not.invalid'), false);
});

test('HTTP capture records redirects and original/final identity, keeps failed status separate and bounds byte sizes', async () => {
  const seen = [], fetched = await fetchJsInput('https://owned.invalid/start.js', { fetchImpl: async (url, options) => {
    seen.push([url, options.redirect]); return url.endsWith('start.js') ? response('', 302, { location: './final.js' }) : response('export default {}');
  } });
  assert.equal(fetched.retrievalOk, true);
  assert.equal(fetched.finalUrl, 'https://owned.invalid/final.js');
  assert.equal(fetched.redirects.length, 1);
  assert.deepEqual(seen.map(row => row[1]), ['manual', 'manual']);
  assert.equal(fetched.sha256, sha('export default {}'));
  const failed = await fetchJsInput('https://owned.invalid/missing.js', { fetchImpl: async () => response('not found', 404) });
  assert.equal(failed.complete, true); assert.equal(failed.retrievalOk, false); assert.equal(failed.error.code, 'JS_INPUT_HTTP_STATUS');
  assert.equal(failed.bytes, 9);
  const huge = await fetchJsInput('https://owned.invalid/large.js', { limits: { maxResourceBytes: 4 }, fetchImpl: async () => response('too large') });
  assert.equal(huge.retrievalOk, false); assert.equal(huge.complete, false); assert.equal(huge.error.code, 'JS_INPUT_RESPONSE_SIZE');
  const cycle = await fetchJsInput('https://owned.invalid/loop.js', { fetchImpl: async () => response('', 302, { location: './loop.js' }) });
  assert.equal(cycle.error.code, 'JS_INPUT_REDIRECT_LOOP');
  await assert.rejects(fetchJsInput('http://user:password@owned.invalid/code.js'), /JS_INPUT_URL/);
});

async function diskFixture(t) {
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'tvbox-js-input-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const capture = join(directory, 'capture'), out = join(directory, 'inputs'), historicalReportPath = join(directory, 'history.json');
  await mkdir(join(capture, 'captures', 'catalog-1'), { recursive: true }); await mkdir(join(capture, 'artifacts'));
  const sources = keys.map((key, index) => ({ key, name: key, type: 3, api: API, ext: 'https://owned.invalid/rules/' + index + '.js?token=' + SECRET, jar: '', categories: [] }));
  const config = { globals: { spider: '' }, sites: sources }, configFile = 'captures/catalog-1/config.json';
  await writeJson(join(capture, configFile), config);
  const entry = { id: 'catalog-1', publicName: '公开目录', parseSuccess: true, originalUrl: 'https://owned.invalid/subscription',
    configFile, configSha256: sha(await readFile(join(capture, configFile))), responses: [] };
  await Promise.all([writeFile(join(capture, 'index.html'), 'owned index'), writeFile(join(capture, 'list.txt'), 'owned catalog'),
    writeJson(join(capture, 'site-config.json'), {}), writeJson(join(capture, 'captures/catalog-1/metadata.json'), entry),
    writeJson(join(capture, 'inventory.json'), { entries: [entry] }), writeJson(join(capture, 'input-manifest.json'), { schemaVersion: 1, artifacts: [] }),
    writeJson(join(capture, 'artifact-inventory.json'), { artifacts: [], retrievals: [] }),
    writeJson(historicalReportPath, { subscription: { url: entry.originalUrl } })]);
  await freezeCatalog({ directory: capture });
  const bodies = new Map([[API, "import a from './dependency.js';import tpl from './模板.js';export default {};"],
    ['https://owned.invalid/dependency.js', "export {a} from './nested.js';"], ['https://owned.invalid/nested.js', 'export const a = 1;'],
    ...['node-rsa.js', 'pako.min.js', 'json5.js', 'jinja.js'].map(name => ['https://owned.invalid/' + name, 'export default {};']),
    ...sources.map((source, index) => [source.ext, index === 0 ? "var rule={};request('https://owned.invalid/config.json');" : 'var rule={};']),
    ['https://owned.invalid/config.json', '{"owned":true}']]);
  const requested = [], fetchImpl = async url => { requested.push(url); return bodies.has(url) ? response(bodies.get(url)) : response('not found', 404); };
  return { directory, capture, out, historicalReportPath, sources, bodies, requested, fetchImpl };
}

test('exact historical capture selection preserves original source fields and never substitutes missing keys or a similar subscription', async t => {
  const f = await diskFixture(t), selected = await selectCapturedJsSources({ directory: f.capture, historicalReportPath: f.historicalReportPath });
  assert.deepEqual(selected.sources, f.sources);
  assert.equal(selected.historicalSubscriptionMatched, true);
  assert.equal(selected.historicalByteIdentityClaim, false);
  await assert.rejects(selectCapturedJsSources({ directory: f.capture, historicalReportPath: f.historicalReportPath, keys: ['similar-name'] }), /EXACT_SOURCE/);
  await writeJson(f.historicalReportPath, { subscription: { url: 'https://owned.invalid/other' } });
  await assert.rejects(selectCapturedJsSources({ directory: f.capture, historicalReportPath: f.historicalReportPath }), /EXACT_CAPTURE/);
});

test('capture freezes recursive module/rule bytes and known DRPY dependencies while preserving URL ext semantics', async t => {
  const f = await diskFixture(t), result = await prepareJsSourceInputs({ directory: f.capture, historicalReportPath: f.historicalReportPath, out: f.out, fetchImpl: f.fetchImpl });
  assert.equal(result.pins.inputReady, true);
  assert.deepEqual(result.plan.sources, f.sources, 'URL ext must never be replaced by rule source text');
  assert.equal(result.plan.modules.some(row => row.url.endsWith('/nested.js')), true);
  assert.equal(result.plan.http.fixtures.some(row => row.url.endsWith('/config.json')), true);
  assert.equal(result.plan.resources.filter(row => row.discovery.kind === 'drpy-common-dependency').length, 4);
  assert.equal(f.requested.some(url => url.includes('模板.js') || url.includes('%E6%A8%A1')), false, 'fixed template comes from a bundled asset');
  assert.equal(result.plan.resources.every(row => row.status === 200 && row.contentUsable), true);
  assert.equal(result.plan.sourceProvenance[0].originalSourceSha256.length, 64);
  assert.equal(JSON.stringify(result.pins).includes(SECRET), false);
  assert.equal(JSON.stringify(result.pins).includes('https://'), false);
  assert.equal((await lstat(f.out)).mode & 0o777, 0o700);
  assert.equal((await lstat(join(f.out, 'input-plan.json'))).mode & 0o777, 0o600);
  assert.equal((await verifyJsSourceInputs({ directory: f.out })).ok, true);
  assert.equal((await verifyCatalogFreeze({ directory: f.capture })).ok, true);
  await assert.rejects(prepareJsSourceInputs({ directory: f.capture, historicalReportPath: f.historicalReportPath, out: f.out, fetchImpl: f.fetchImpl }), /OUTPUT_NOT_EMPTY/);
  await writeFile(join(f.out, result.plan.resources[0].path), 'changed frozen input');
  await assert.rejects(verifyJsSourceInputs({ directory: f.out }), /FROZEN_BYTES_CHANGED/);
});

test('HTTP failures, HTML impostors and depth limits remain failed evidence and never become ready modules', async t => {
  const f = await diskFixture(t); f.bodies.delete('https://owned.invalid/jinja.js');
  f.bodies.set('https://owned.invalid/pako.min.js', '<!doctype html><html>unavailable</html>');
  const result = await prepareJsSourceInputs({ directory: f.capture, historicalReportPath: f.historicalReportPath, out: f.out, fetchImpl: f.fetchImpl, limits: { maxDepth: 1 } });
  assert.equal(result.plan.inputReady, false);
  const missing = result.plan.resources.find(row => row.url.endsWith('/jinja.js'));
  assert.equal(missing.status, 404); assert.equal(missing.retrievalOk, false); assert.equal(missing.complete, true);
  assert.equal(result.plan.http.fixtures.some(row => row.url.endsWith('/jinja.js')), false);
  assert.equal(result.plan.modules.some(row => row.url.endsWith('/pako.min.js')), false);
  assert.equal(result.plan.resources.some(row => row.error?.code === 'JS_INPUT_DEPTH_LIMIT'), true);
  assert.equal((await verifyJsSourceInputs({ directory: f.out })).ok, true, 'failed evidence is still frozen accurately');
});
