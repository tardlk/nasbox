// SPDX-License-Identifier: GPL-3.0-only
// Capture exact source/code/rule bytes only. Never evaluates provider JavaScript.
import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyCatalogFreeze } from './freeze-catalog.mjs';
import { androidAssets } from '../../backend/spider-runtime/assets/index.mjs';

const SELF = fileURLToPath(import.meta.url);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const identity = value => sha(JSON.stringify(canonical(value)));
const check = (condition, code) => { if (!condition) throw new Error('JS_INPUT_' + code); };
const contained = (root, path) => { const rel = relative(root, path); return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep); };
const safeName = value => typeof value === 'string' && value.length <= 120 && !/[?:=&\r\n]|:\/\/|bearer\s|token[:\s]/i.test(value) ? value : 'sha256:' + sha(String(value));
const publicError = error => ({ code: /^JS_INPUT_[A-Z_]+$/.test(error?.message) ? error.message : error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'JS_INPUT_FETCH_TIMEOUT' : 'JS_INPUT_FETCH_FAILED', fingerprint: sha(String(error?.message || error)) });
const defaultKeys = ['虎牙js', '斗鱼js', 'dr_兔小贝'];
const defaultLimits = { requestMs: 25000, captureMs: 240000, maxResourceBytes: 6 * 1024 * 1024, maxTotalBytes: 32 * 1024 * 1024, maxResources: 64, maxDepth: 8, maxRedirects: 5 };

function limitsOf(overrides = {}) {
  const limits = { ...defaultLimits, ...overrides };
  for (const [key, value] of Object.entries(limits)) check(Object.hasOwn(defaultLimits, key) && Number.isSafeInteger(value) && value >= 1 && value <= (key.endsWith('Bytes') ? 128 * 1024 * 1024 : key.endsWith('Ms') ? 3600000 : 256), 'LIMITS');
  return limits;
}
function httpUrl(value, base) {
  const url = new URL(value, base);
  check(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password, 'URL');
  return url.href;
}

/** Match one successful original normalized config by exact historical URL. */
export async function selectCapturedJsSources({ directory, historicalReportPath, captureId, keys = defaultKeys } = {}) {
  check(Array.isArray(keys) && keys.length > 0 && new Set(keys).size === keys.length && keys.every(key => typeof key === 'string' && key.length > 0), 'SOURCE_KEYS');
  const verified = await verifyCatalogFreeze({ directory }), root = await realpath(resolve(directory));
  const freeze = JSON.parse(await readFile(join(root, 'freeze.json'), 'utf8'));
  const inventory = JSON.parse(await readFile(join(root, 'inventory.json'), 'utf8'));
  const historicalBytes = historicalReportPath ? await readFile(resolve(historicalReportPath)) : null;
  const historical = historicalBytes ? JSON.parse(historicalBytes) : null;
  check(captureId || typeof historical?.subscription?.url === 'string', 'SELECTION_REFERENCE');
  const candidates = freeze.captures.filter(capture => capture.accepted && !capture.partial && capture.configFile
    && (captureId ? capture.id === captureId : inventory.entries.find(entry => entry.id === capture.id)?.originalUrl === historical.subscription.url));
  check(candidates.length === 1, 'EXACT_CAPTURE');
  const capture = candidates[0], configPath = join(root, capture.configFile);
  check(contained(root, configPath), 'CONFIG_PATH');
  const configBytes = await readFile(configPath); check(sha(configBytes) === capture.configSha256, 'CONFIG_CHANGED');
  const config = JSON.parse(configBytes), sources = [], sourceProvenance = [];
  for (const key of keys) {
    const matches = config.sites.filter(source => source.key === key);
    check(matches.length === 1, 'EXACT_SOURCE'); const source = matches[0];
    check(source.type === 3 && typeof source.api === 'string' && (source.api.endsWith('.js') || source.api.includes('.js?'))
      && typeof source.ext === 'string' && !source.jar, 'PURE_JS_SOURCE');
    httpUrl(source.api); httpUrl(source.ext);
    sources.push(structuredClone(source));
    sourceProvenance.push({ captureId: capture.id, configSha256: capture.configSha256, sourceIndex: config.sites.indexOf(source),
      originalSourceSha256: identity(source), apiSha256: sha(source.api), executionExtSha256: sha(source.ext), sourceKeySha256: sha(source.key),
      pureJsSelection: true, helperJarConfigured: false,
      configuredGlobalJarOmitted: !!config.globals?.spider,
      loaderScope: 'Pure-JS dispatch with no site helper JAR; global subscription JAR is not loaded by this selected JS route.' });
  }
  const entry = inventory.entries.find(row => row.id === capture.id);
  return { schemaVersion: 1, sourceInputSetSha256: verified.inputSetSha256, sourceFilesSha256: freeze.filesSha256,
    captureId: capture.id, configSha256: capture.configSha256,
    historicalReportSha256: historicalBytes ? sha(historicalBytes) : null,
    historicalSubscriptionMatched: !!historical && entry.originalUrl === historical.subscription.url,
    historicalByteIdentityClaim: false,
    scope: 'Exact source configuration from frozen normalized capture. Remote code/rule bytes are newly captured, not assumed equal to deleted historical bytes.',
    sources, sourceProvenance };
}

// A small lexical pass avoids matching dependency-looking text inside comments
// or quoted strings. It does not evaluate expressions or claim to parse all JS.
function lexicalTokens(text) {
  const tokens = []; let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '/' && text[i + 1] === '/') { const end = text.indexOf('\n', i + 2); i = end < 0 ? text.length : end + 1; continue; }
    if (ch === '/' && text[i + 1] === '*') { const end = text.indexOf('*/', i + 2); check(end >= 0, 'DEPENDENCY_COMMENT'); i = end + 2; continue; }
    if (ch === '/') {
      const prior = tokens.at(-1), before = tokens.at(-2);
      const mayStartRegex = !prior || prior.kind === 'punctuation' && /^[=(,:;!&|?{\[}]$/.test(prior.value)
        || prior.kind === 'identifier' && ['return', 'throw', 'case', 'delete', 'void', 'typeof', 'yield'].includes(prior.value)
        || prior.value === '>' && before?.value === '=';
      if (mayStartRegex) {
        const start = i++; let bracket = false, closed = false;
        while (i < text.length) {
          if (text[i] === '\\') { i += 2; continue; }
          if (text[i] === '[') bracket = true;
          else if (text[i] === ']') bracket = false;
          else if (text[i] === '/' && !bracket) { i++; closed = true; break; }
          if (text[i] === '\n' || text[i] === '\r') break; i++;
        }
        check(closed, 'DEPENDENCY_REGEX');
        while (/[a-z]/i.test(text[i] || '') && i < text.length) i++;
        tokens.push({ kind: 'regex', start }); continue;
      }
    }
    if (ch === '"' || ch === "'") {
      const quote = ch, start = i++; let value = '';
      while (i < text.length && text[i] !== quote) {
        if (text[i] !== '\\') { value += text[i++]; continue; }
        const escape = text[++i]; check(escape !== undefined, 'DEPENDENCY_STRING'); i++;
        if (escape === 'x' || escape === 'u') {
          const width = escape === 'x' ? 2 : 4, digits = text.slice(i, i + width);
          check(new RegExp('^[a-fA-F0-9]{' + width + '}$').test(digits), 'DEPENDENCY_STRING'); value += String.fromCharCode(parseInt(digits, 16)); i += width;
        } else if (escape === '\n') {} else if (escape === '\r') { if (text[i] === '\n') i++; }
        else value += ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v' })[escape] ?? escape;
      }
      check(text[i] === quote, 'DEPENDENCY_STRING'); i++; tokens.push({ kind: 'string', value, start }); continue;
    }
    if (ch === '`') {
      // Unknown template interpolation is recorded as a static discovery limit.
      const start = i++; let dynamic = false;
      while (i < text.length && text[i] !== '`') { if (text[i] === '\\') i += 2; else { if (text[i] === '$' && text[i + 1] === '{') dynamic = true; i++; } }
      check(text[i] === '`', 'DEPENDENCY_TEMPLATE'); i++; tokens.push({ kind: 'template', dynamic, start }); continue;
    }
    if (/[\w$]/.test(ch) || ch.charCodeAt(0) > 127) {
      const start = i++; while (i < text.length && (/[\w$]/.test(text[i]) || text.charCodeAt(i) > 127)) i++;
      tokens.push({ kind: 'identifier', value: text.slice(start, i), start }); continue;
    }
    tokens.push({ kind: 'punctuation', value: ch, start: i++ });
  }
  return tokens;
}

/** Only literal dependency names are followed; computed names remain unknown. */
export function discoverJsDependencies(text, baseUrl) {
  check(typeof text === 'string', 'DEPENDENCY_TEXT');
  const tokens = lexicalTokens(text), found = [], unresolved = [], seen = new Set();
  const add = (value, kind) => {
    if (/^assets:\/\/js\/lib\/(?:cheerio\.min|crypto-js|gbk|模板|cat)\.js$/.test(value)
      || ['cheerio.min.js', 'crypto-js.js', 'gbk.js', '模板.js', 'cat.js'].includes(value)) {
      const key = 'bundled\0' + value;
      if (!seen.has(key)) { found.push({ url: value, specifier: value, kind: 'bundled-asset', importKind: kind }); seen.add(key); }
      return;
    }
    let url; try { url = httpUrl(value, baseUrl); } catch { unresolved.push({ kind, expressionSha256: sha(value), reason: 'unsupported-dependency-url' }); return; }
    const key = kind + '\0' + url; if (!seen.has(key)) { found.push({ url, specifier: value, kind }); seen.add(key); }
  };
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i], next = tokens[i + 1];
    if (token.kind !== 'identifier') continue;
    if (token.value === 'import' || token.value === 'export') {
      if (token.value === 'import' && next?.kind === 'string') add(next.value, 'static-import');
      else if (token.value === 'import' && next?.value === '(') {
        if (tokens[i + 2]?.kind === 'string' && tokens[i + 3]?.value === ')') add(tokens[i + 2].value, 'literal-dynamic-import');
        else unresolved.push({ kind: 'dynamic-import', offset: token.start, reason: 'computed-dependency' });
      } else {
        for (let j = i + 1; j < Math.min(i + 60, tokens.length); j++) {
          if (tokens[j].value === ';') break;
          if (tokens[j].value === 'from' && tokens[j + 1]?.kind === 'string') { add(tokens[j + 1].value, 'static-import'); break; }
        }
      }
    }
    if (['require', 'loadModule', 'js_load', 'request', 'fetch'].includes(token.value) && next?.value === '(') {
      const value = tokens[i + 2];
      if (value?.kind === 'string' && [')', ','].includes(tokens[i + 3]?.value)) {
        if (['request', 'fetch'].includes(token.value)) {
          try { if (!/\.(?:js|json|txt)$/i.test(new URL(value.value, baseUrl).pathname)) continue; } catch { continue; }
        }
        add(value.value, 'literal-' + token.value);
      } else if (!['request', 'fetch'].includes(token.value)) unresolved.push({ kind: token.value, offset: token.start, reason: 'computed-dependency' });
    }
  }
  return { dependencies: found, unresolved,
    discoveryScope: 'Literal ES imports/re-exports, import(), require/loadModule/js_load and literal request/fetch code/rule filenames only; computed imports, eval-generated names and dynamic business URLs are not a complete dependency graph.' };
}

/** Bounded raw HTTP capture; failed/status bodies remain evidence, not modules. */
export async function fetchJsInput(url, { fetchImpl = fetch, limits: overrides, remainingBytes = defaultLimits.maxTotalBytes, deadline = Date.now() + defaultLimits.captureMs } = {}) {
  const limits = limitsOf(overrides), redirects = [], requestedUrl = httpUrl(url); let current = requestedUrl;
  const row = { url: requestedUrl, requestedUrl, method: 'GET', redirects, complete: false, retrievalOk: false };
  const budget = Math.min(limits.requestMs, deadline - Date.now()); check(budget > 0, 'CAPTURE_TIMEOUT');
  const signal = AbortSignal.timeout(budget); let response;
  try {
    for (let hop = 0; ; hop++) {
      response = await fetchImpl(current, { method: 'GET', redirect: 'manual', headers: { 'User-Agent': 'okhttp/3.15', Accept: '*/*' }, signal });
      if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.get('location')) {
        check(hop < limits.maxRedirects, 'REDIRECT_LIMIT');
        const next = httpUrl(response.headers.get('location'), current);
        redirects.push({ from: current, to: next, status: response.status }); await response.body?.cancel();
        check(next !== current && !redirects.slice(0, -1).some(redirect => redirect.from === next), 'REDIRECT_LOOP'); current = next; continue;
      }
      break;
    }
    row.finalUrl = current; row.status = response.status;
    row.headers = { 'Content-Type': response.headers.get('content-type') || 'application/octet-stream' };
    const chunks = []; let received = 0;
    if (response.body) for await (const chunk of response.body) {
      const data = Buffer.from(chunk); received += data.length;
      check(received <= limits.maxResourceBytes && received <= remainingBytes, 'RESPONSE_SIZE'); chunks.push(data);
    }
    const bytes = Buffer.concat(chunks); row.complete = true; row.retrievalOk = response.status >= 200 && response.status < 300;
    row.bytes = bytes.length; row.sha256 = sha(bytes);
    if (!row.retrievalOk) row.error = { code: 'JS_INPUT_HTTP_STATUS', status: response.status };
    return { ...row, bytesValue: bytes };
  } catch (error) {
    try { await response?.body?.cancel(); } catch {}
    return { ...row, error: publicError(error) };
  }
}

async function newDirectory(directory, inputRoot) {
  const path = resolve(directory); check(!contained(inputRoot, path) && !contained(path, inputRoot), 'OUTPUT_OVERLAPS_INPUT');
  let cursor = resolve('/');
  for (const part of relative(resolve('/'), path).split(sep)) {
    cursor = join(cursor, part); const info = await lstat(cursor).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    check(!info || info.isDirectory() && !info.isSymbolicLink(), 'OUTPUT_PATH');
  }
  await mkdir(path, { recursive: true, mode: 0o700 }); check(await realpath(path) === path && (await readdir(path)).length === 0, 'OUTPUT_NOT_EMPTY'); await chmod(path, 0o700); return path;
}
async function allFiles(root) {
  const rows = [];
  async function visit(path, prefix = '') {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      check(!entry.isSymbolicLink(), 'SYMLINK'); const name = prefix + entry.name;
      if (entry.isDirectory()) await visit(join(path, entry.name), name + '/');
      else { check(entry.isFile(), 'FILE'); if (name !== 'freeze.json') { const bytes = await readFile(join(path, entry.name)); rows.push({ path: name, sha256: sha(bytes), bytes: bytes.length }); } }
    }
  }
  await visit(root); return rows;
}

export async function verifyJsSourceInputs({ directory } = {}) {
  const root = await realpath(resolve(directory)), freeze = JSON.parse(await readFile(join(root, 'freeze.json'), 'utf8'));
  check(freeze.schemaVersion === 1 && Array.isArray(freeze.files), 'FREEZE_SCHEMA');
  const files = await allFiles(root); check(identity(files) === freeze.filesSha256 && identity(files) === identity(freeze.files), 'FROZEN_BYTES_CHANGED');
  const { inputSetSha256, ...metadata } = freeze; check(identity(metadata) === inputSetSha256, 'FREEZE_IDENTITY');
  return { ok: true, inputSetSha256, files: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0) };
}

export async function prepareJsSourceInputs({ directory, out, historicalReportPath, captureId, keys, fetchImpl = fetch, limits: overrides } = {}) {
  const selection = await selectCapturedJsSources({ directory, historicalReportPath, captureId, keys }), limits = limitsOf(overrides);
  const inputRoot = await realpath(resolve(directory)), output = await newDirectory(out, inputRoot);
  await mkdir(join(output, 'responses'), { mode: 0o700 });
  const resources = [], modules = [], fixtures = [], unresolved = [], queue = [], queued = new Set(), aliases = new Map();
  const deadline = Date.now() + limits.captureMs; let receivedBytes = 0;
  const enqueue = (url, role, parent = null, depth = 0, kind = 'root') => {
    let normalized; try { normalized = httpUrl(url); } catch (error) { unresolved.push({ parentUrlSha256: parent ? sha(parent) : null, role, kind, ...publicError(error) }); return; }
    if (queued.has(normalized)) return; queued.add(normalized); queue.push({ url: normalized, role, parent, depth, kind });
  };
  for (const source of selection.sources) { enqueue(source.api, 'module'); enqueue(source.ext, 'rule'); }
  const bundled = androidAssets(), bundledRows = [];
  for (const asset of bundled.files) bundledRows.push({ name: asset.path.split('/').at(-1), sha256: asset.sha256, bytes: asset.bytes, runtimePath: asset.path, source: 'pinned-android-asset' });
  while (queue.length) {
    const request = queue.shift();
    if (resources.length >= limits.maxResources || request.depth > limits.maxDepth || Date.now() >= deadline) {
      resources.push({ url: request.url, urlSha256: sha(request.url), role: request.role, retrievalOk: false, complete: false,
        error: { code: Date.now() >= deadline ? 'JS_INPUT_CAPTURE_TIMEOUT' : request.depth > limits.maxDepth ? 'JS_INPUT_DEPTH_LIMIT' : 'JS_INPUT_RESOURCE_LIMIT' } }); continue;
    }
    const fetched = await fetchJsInput(request.url, { fetchImpl, limits, remainingBytes: limits.maxTotalBytes - receivedBytes, deadline });
    const { bytesValue, ...metadata } = fetched;
    const row = { ...metadata, urlSha256: sha(request.url), role: request.role, discovery: { kind: request.kind, depth: request.depth, parentUrlSha256: request.parent ? sha(request.parent) : null } };
    if (bytesValue) {
      receivedBytes += bytesValue.length; row.path = 'responses/' + row.sha256 + '.bin';
      await writeFile(join(output, row.path), bytesValue, { mode: 0o600, flag: 'wx' }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    }
    const text = bytesValue?.toString('utf8');
    row.contentUsable = row.retrievalOk && row.complete && !!text?.trim() && !/^\s*(?:\uFEFF)?\s*(?:<!doctype|<html|404\b|not found\b)/i.test(text);
    if (row.retrievalOk && !row.contentUsable) row.contentError = { code: 'JS_INPUT_EMPTY_OR_HTML' };
    resources.push(row);
    if (!row.contentUsable) continue;
    const urls = [...new Set([request.url, ...(row.redirects || []).flatMap(redirect => [redirect.from, redirect.to]), row.finalUrl].filter(Boolean))];
    for (const url of urls) {
      const prior = aliases.get(url); check(!prior || prior === row.sha256, 'ALIAS_COLLISION'); aliases.set(url, row.sha256);
      fixtures.push({ url, method: 'GET', status: row.status, headers: row.headers, path: row.path, sha256: row.sha256, bytes: row.bytes,
        originalRequestedUrlSha256: sha(request.url), aliasOfRedirect: url !== request.url });
      if (request.role === 'module' || /\.js$/i.test(new URL(url).pathname)) modules.push({ url, path: row.path, sha256: row.sha256, bytes: row.bytes });
    }
    if (request.role === 'module' && /(?:drpy|dr_py)/i.test(new URL(request.url).pathname)) {
      for (const name of ['node-rsa.js', 'pako.min.js', 'json5.js', 'jinja.js']) enqueue(new URL(name, request.url).href, 'module', request.url, request.depth + 1, 'drpy-common-dependency');
    }
    let discovered;
    try { discovered = discoverJsDependencies(text, request.url); }
    catch (error) { row.staticDiscoveryError = publicError(error); unresolved.push({ parentUrlSha256: sha(request.url), ...publicError(error) }); continue; }
    row.dependencies = discovered.dependencies.map(dep => ({ url: dep.url, kind: dep.kind }));
    unresolved.push(...discovered.unresolved.map(value => ({ parentUrlSha256: sha(request.url), ...value })));
    for (const dependency of discovered.dependencies) {
      const asset = bundledRows.find(asset => ['gbk.js', '模板.js', 'cat.js'].includes(asset.name) && dependency.specifier.includes(asset.name))
        || bundledRows.find(asset => dependency.specifier === asset.name || dependency.specifier === 'assets://' + asset.runtimePath);
      if (asset) { row.bundledDependencies ||= []; row.bundledDependencies.push({ ...asset, requestedSpecifierSha256: sha(dependency.specifier) }); continue; }
      enqueue(dependency.url, /\.js$/i.test(new URL(dependency.url).pathname) ? 'module' : 'rule-dependency', request.url, request.depth + 1, dependency.kind);
    }
  }
  const dedup = rows => [...new Map(rows.map(row => [row.url, row])).values()];
  const plan = { ...selection, modules: dedup(modules), http: { mode: 'frozen', fixtures: dedup(fixtures),
    scope: 'Only captured code/rule GET URLs are frozen; business endpoint requests remain live in downstream probes. Source api/ext URL strings remain unchanged.' },
    resources, bundledAssets: bundledRows, unresolvedDependencies: unresolved, limits,
    budgets: { caseMs: 240000, initMs: 30000, callMs: 12000, closeMs: 5000 },
    inputReady: resources.every(row => row.contentUsable === true),
    dependencyScope: 'Static literal graph plus explicit DRPY common dependencies only. Computed rule requests and runtime-generated dependencies remain unknown and must be observed during controlled execution.',
    executionScope: 'No provider JavaScript executed; input readiness is not initialization or business success.' };
  const publicPins = { schemaVersion: 1, sourceInputSetSha256: selection.sourceInputSetSha256, configSha256: selection.configSha256,
    historicalReportSha256: selection.historicalReportSha256, historicalSubscriptionMatched: selection.historicalSubscriptionMatched,
    historicalByteIdentityClaim: false, inputReady: plan.inputReady,
    summary: { sources: plan.sources.length, resources: resources.length, retrieved: resources.filter(row => row.retrievalOk).length,
      usable: resources.filter(row => row.contentUsable).length, failed: resources.filter(row => !row.contentUsable).length,
      receivedBytes, moduleAliases: plan.modules.length, frozenGetAliases: plan.http.fixtures.length, unresolvedDependencyExpressions: unresolved.length },
    sources: plan.sources.map((source, index) => ({ name: safeName(source.key), sourceKeySha256: sha(source.key), apiSha256: sha(source.api),
      executionExtSha256: sha(source.ext), originalSourceSha256: selection.sourceProvenance[index].originalSourceSha256 })),
    resources: resources.map(row => ({ urlSha256: row.urlSha256, role: row.role, status: row.status ?? null,
      retrievalOk: row.retrievalOk, complete: row.complete, contentUsable: row.contentUsable === true,
      bytes: row.bytes ?? 0, sha256: row.sha256 ?? null, redirectCount: row.redirects?.length || 0,
      ...(row.error ? { error: row.error } : {}), ...(row.contentError ? { contentError: row.contentError } : {}) })),
    scope: plan.executionScope, dependencyScope: plan.dependencyScope };
  await writeFile(join(output, 'input-plan.json'), JSON.stringify(plan, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  publicPins.planSha256 = sha(await readFile(join(output, 'input-plan.json')));
  await writeFile(join(output, 'js-source-pins.json'), JSON.stringify(publicPins, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  check((await verifyCatalogFreeze({ directory })).inputSetSha256 === selection.sourceInputSetSha256, 'SOURCE_FREEZE_CHANGED');
  const files = await allFiles(output), freeze = { schemaVersion: 1, sourceInputSetSha256: selection.sourceInputSetSha256,
    files, filesSha256: identity(files), preparerSha256: sha(await readFile(SELF)),
    scope: 'New exact downloaded JS/rule response bytes and immutable original source configuration; no code execution or compatibility claim.' };
  freeze.inputSetSha256 = identity(freeze);
  await writeFile(join(output, 'freeze.json'), JSON.stringify(freeze, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  return { output, plan, pins: publicPins, verified: await verifyJsSourceInputs({ directory: output }) };
}

async function main(args) {
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write('Usage: node scripts/compat/prepare-js-source-inputs.mjs --directory PRIVATE_CATALOG_FREEZE --historical-report REPORT_JSON --out NEW_PRIVATE_DIRECTORY [--capture-id EXACT_CAPTURE] [--keys KEY1,KEY2] [--select-only]\nDefaults: historical subscription exact URL; 虎牙js,斗鱼js,dr_兔小贝. Captures bytes only; never executes provider scripts.\n'); return;
  }
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const name = args[index];
    if (name === '--select-only') { check(!Object.hasOwn(options, name), 'CLI_ARGUMENT'); options[name] = true; continue; }
    check(['--directory', '--historical-report', '--out', '--capture-id', '--keys'].includes(name) && args[index + 1] && !Object.hasOwn(options, name), 'CLI_ARGUMENT'); options[name] = args[++index];
  }
  check(options['--directory'] && options['--out'], 'CLI_USAGE');
  const input = { directory: options['--directory'], historicalReportPath: options['--historical-report'], captureId: options['--capture-id'], ...(options['--keys'] ? { keys: options['--keys'].split(',') } : {}) };
  if (options['--select-only']) {
    const selection = await selectCapturedJsSources(input), output = await newDirectory(options['--out'], await realpath(resolve(input.directory)));
    await writeFile(join(output, 'selection-plan.json'), JSON.stringify(selection, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    process.stdout.write(JSON.stringify({ sources: selection.sources.length, configSha256: selection.configSha256, sourceInputSetSha256: selection.sourceInputSetSha256 }) + '\n'); return;
  }
  const { pins, verified } = await prepareJsSourceInputs({ ...input, out: options['--out'] });
  process.stdout.write(JSON.stringify({ ...pins.summary, inputReady: pins.inputReady, inputSetSha256: verified.inputSetSha256, planSha256: pins.planSha256 }) + '\n');
}
if (process.argv[1] && resolve(process.argv[1]) === SELF) main(process.argv.slice(2)).catch(error => {
  process.stderr.write(JSON.stringify({ ok: false, ...publicError(error) }) + '\n'); process.exitCode = 1;
});
