// SPDX-License-Identifier: GPL-3.0-only
// Offline matrix validation: injected workers and project-owned synthetic JARs only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createSpiderRuntime } from '../backend/spider-runtime/index.mjs';
import { buildSpiderFixtures } from '../scripts/compat/spider-fixtures.mjs';
import {
  classifyFailure, normalizeManifest, probeJarArtifact, probeJarMatrix,
  summarizeMatrix, summarizeNativeState, summarizeResponse,
} from '../scripts/container/jar-matrix-probe.mjs';

const sha256 = value => createHash('sha256').update(value).digest('hex');
const source = (key, api = 'csp_Fixture', ext = '', extra = {}) => ({ key, type: 3, api, ext, ...extra });
const fastLimits = { loadMs: 1000, initMs: 1000, callMs: 1000, artifactMs: 5000, closeMs: 1000 };

function capture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'tvbox-matrix-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  function artifact(id, sites = [source(id)], extra = {}) {
    const jarPath = join(directory, id + '.jar');
    const bytes = Buffer.from('owned mock artifact: ' + id);
    writeFileSync(jarPath, bytes);
    return { id, jarPath, sha256: sha256(bytes), sites, limits: fastLimits, ...extra };
  }
  return { directory, artifact };
}

/** Emulates the single-native-owner restriction without starting Java or networking. */
function fakeFactory({ records = [], get, call, loaded = true } = {}) {
  return options => {
    const record = { options, registrations: new Map(), gets: [], calls: [], loads: [], closed: false };
    records.push(record);
    const spiders = new Map();
    function own(path) {
      if (record.owner && record.owner !== path) throw new Error('NATIVE_WORKER_SINGLE_ARTIFACT');
      record.owner = path;
    }
    return {
      getDiagnostics: () => ({ stderr: '' }),
      async request(request) {
        assert.equal(request.operation, 'nativeState');
        return { enabled: false };
      },
      async loadMain(path) { record.loads.push(path); if (loaded) own(path); return { loaded }; },
      async registerJar(signature, path) { record.registrations.set(signature, path); },
      async getState() { return { jar: { loaderCount: record.owner ? 1 : 0 } }; },
      async setModules() {},
      async getCSP(value) {
        record.gets.push(value);
        const path = value.jar ? record.registrations.get(value.jar) : record.loads.at(-1);
        assert.ok(path, 'source must use its main or registered site artifact');
        own(path);
        const result = get ? await get(value, record) : { ready: true, className: 'fixture.Spider' };
        const token = 'fixture-' + record.gets.length;
        spiders.set(token, value);
        return { token, ...result };
      },
      async call(token, method, args) {
        const value = spiders.get(token);
        assert.ok(value, 'call must use an initialized Spider');
        record.calls.push({ source: value, method, args });
        return call ? call(value, method, args, record) : '{"class":[],"list":[]}';
      },
      async close() { record.closed = true; },
    };
  };
}

test('matrix preserves main/site loader roles and creates an independent worker for each artifact', async t => {
  const { directory, artifact } = capture(t), records = [];
  const first = artifact('main', [source('a', 'csp_Fixture', '', { jar: 'ignored-original-site-signature' })], { role: 'main' });
  const second = artifact('site', [source('b')], { role: 'site' });
  const report = await probeJarMatrix({ artifacts: [first, second] }, {
    inputRoot: directory, isolate: false, runtimeFactory: fakeFactory({ records }),
  });
  assert.equal(records.length, 2);
  assert.notEqual(records[0].owner, records[1].owner);
  assert.deepEqual(records.map(record => record.loads.length), [1, 0]);
  assert.equal(records[0].gets[0].jar, '');
  assert.match(records[1].gets[0].jar, /^matrix:[a-f0-9]{64}$/);
  assert.equal(records[1].registrations.get(records[1].gets[0].jar), realpathSync(second.jarPath));
  assert.deepEqual(report.artifacts.map(row => row.chosenRole), ['main', 'site']);
  assert.equal(report.artifacts[1].load.deferred, true);
  assert.equal(report.observations.loaded, 2);
  assert.equal(report.observations.readyApis, 2);
  assert.equal(report.artifacts.some(row => row.error), false);
  assert.ok(records.every(record => record.closed && !existsSync(record.options.dataDir)));
  assert.equal(report.cleanup.temporaryDataRemoved, true);
});

test('site helper registration stays untested until optional real load validation runs', async t => {
  const { directory, artifact } = capture(t), records = [];
  const helper = artifact('helper', [], { role: 'site' });
  const before = await probeJarArtifact(helper, { inputRoot: directory, runtimeFactory: fakeFactory({ records }) });
  assert.equal(before.load.registered, true);
  assert.equal(before.load.loaded, null);
  assert.equal(before.loadValidation.attempted, false);
  assert.equal(before.loadValidation.status, 'not-tested');
  assert.equal(before.loadValidation.reason, 'helper-only-not-triggered');
  assert.equal(records[0].gets.length, 0);
  const after = await probeJarArtifact({ ...helper, helperLoadValidation: true }, { inputRoot: directory, runtimeFactory: fakeFactory({ records }) });
  assert.equal(records[1].gets.length, 1);
  assert.match(records[1].gets[0].api, /\//);
  assert.equal(after.load.loaded, true);
  assert.equal(after.loadValidation.attempted, true);
  assert.equal(after.loadValidation.status, 'loaded');
  assert.equal(after.loadValidation.trigger, 'site-helper-synthetic-class');
  assert.equal(after.sites.length, 0);
  assert.equal(after.observations.attemptedApis, 0);
  assert.equal(after.observations.readyApis, 0);
  assert.equal(after.observations.homes, 0);
  assert.deepEqual(summarizeMatrix([before, after]).loadValidation, { attempted: 1, loaded: 1, failed: 0, timeout: 0, unknown: 0, notTested: 1 });
});

test('helper load failures and timeouts cannot become ready APIs or successful loads', async t => {
  const { directory, artifact } = capture(t);
  const helper = artifact('helper-error', [], { role: 'site', helperLoadValidation: true, limits: { ...fastLimits, loadMs: 20 } });
  const factory = ({ timeout = false } = {}) => options => {
    const value = fakeFactory()(options);
    return { ...value, getCSP: timeout ? () => new Promise(() => {}) : async () => ({ ready: false }), getState: async () => ({ jar: { loaderCount: 0 } }) };
  };
  const failed = await probeJarArtifact(helper, { inputRoot: directory, runtimeFactory: factory() });
  assert.equal(failed.loadValidation.attempted, true);
  assert.equal(failed.loadValidation.status, 'failed');
  assert.equal(failed.load.loaded, false);
  const timedOut = await probeJarArtifact(helper, { inputRoot: directory, runtimeFactory: factory({ timeout: true }) });
  assert.equal(timedOut.loadValidation.attempted, true);
  assert.equal(timedOut.loadValidation.status, 'timeout');
  assert.equal(timedOut.loadValidation.error.category, 'timeout');
  assert.equal(timedOut.load.loaded, null);
  assert.equal(timedOut.cleanup.closed, true);
  for (const value of [failed, timedOut]) {
    assert.equal(value.sites.length, 0);
    assert.equal(value.observations.attemptedApis, 0);
    assert.equal(value.observations.readyApis, 0);
  }
});

test('main load result, exception, timeout and rejected input keep distinct attempt evidence', async t => {
  const { directory, artifact } = capture(t);
  const input = artifact('main-attempt', [], { limits: { ...fastLimits, loadMs: 20 } });
  const withLoad = loadMain => options => ({ ...fakeFactory()(options), loadMain });
  for (const loadMain of [async () => ({ loaded: false, failure: 'PROTECTED_INIT_UNBOUND' }), async () => { throw new Error('JAR_LOAD_FAILED'); }]) {
    const value = await probeJarArtifact(input, { inputRoot: directory, runtimeFactory: withLoad(loadMain) });
    assert.equal(value.loadValidation.attempted, true);
    assert.equal(value.loadValidation.status, 'failed');
  }
  const progress = [];
  const timeout = await probeJarArtifact(input, { inputRoot: directory, runtimeFactory: withLoad(() => new Promise(() => {})), onProgress: row => progress.push(structuredClone(row)) });
  assert.equal(timeout.loadValidation.attempted, true);
  assert.equal(timeout.loadValidation.status, 'timeout');
  assert.equal(progress.find(row => row.stage === 'input').input.sha256, input.sha256);
  assert.equal(progress.find(row => row.stage === 'load-attempt').loadValidation.attempted, true);
  assert.equal(progress.find(row => row.stage === 'load-attempt').loadValidation.status, 'unknown');
  const rejected = await probeJarArtifact({ ...input, sha256: '0'.repeat(64) }, { inputRoot: directory, runtimeFactory: () => { throw new Error('must not start'); } });
  assert.equal(rejected.loadValidation.attempted, false);
  assert.equal(rejected.loadValidation.status, 'not-tested');
  assert.equal(rejected.loadValidation.reason, 'input-rejected');
});

test('execution identity pins actual runner bytes, captured inputs and resolved budgets', async t => {
  const { directory, artifact } = capture(t);
  const input = artifact('identity', [source('first', 'csp_First', 'secret ext')]);
  const manifestPath = join(directory, 'manifest.json');
  const manifest = { helperLoadValidation: true, artifacts: [input] };
  const manifestBytes = JSON.stringify(manifest, null, 2) + '\n';
  writeFileSync(manifestPath, manifestBytes);
  const report = await probeJarMatrix(manifest, { manifestPath, inputRoot: directory, isolate: false, runtimeFactory: fakeFactory() });
  const row = report.artifacts[0], runnerSha256 = sha256(readFileSync(new URL('../scripts/container/jar-matrix-probe.mjs', import.meta.url)));
  assert.equal(report.runnerSha256, runnerSha256);
  assert.equal(row.executionIdentity.runnerSha256, runnerSha256);
  assert.equal(report.manifestBytesSha256, sha256(manifestBytes));
  assert.match(row.executionIdentity.inputSha256, /^[a-f0-9]{64}$/);
  assert.match(row.executionIdentity.limitsSha256, /^[a-f0-9]{64}$/);
  assert.equal(row.loadValidation.status, 'loaded');
  assert.equal(JSON.stringify(report).includes('secret ext'), false);
  const changed = await probeJarArtifact({ ...input, sites: [source('first', 'csp_First', 'different ext')], limits: { ...fastLimits, initMs: 900 } }, { inputRoot: directory, runtimeFactory: fakeFactory() });
  assert.notEqual(changed.executionIdentity.inputSha256, row.executionIdentity.inputSha256);
  assert.notEqual(changed.executionIdentity.limitsSha256, row.executionIdentity.limitsSha256);
  await assert.rejects(probeJarMatrix({ ...manifest, helperLoadValidation: false }, { manifestPath, inputRoot: directory, isolate: false, runtimeFactory: fakeFactory() }), /saved manifest differs/);
  assert.throws(() => normalizeManifest({ artifacts: [], helperLoadValidation: 'true' }), /helperLoadValidation/);
});

test('outer load success with SpiderNull is never counted as an executed source', async t => {
  const { directory, artifact } = capture(t), records = [];
  const report = await probeJarArtifact(artifact('null'), {
    inputRoot: directory,
    runtimeFactory: fakeFactory({ records, get: () => ({ ready: false, className: 'com.github.catvod.crawler.SpiderNull' }) }),
  });
  assert.equal(report.load.loaded, true);
  assert.equal(report.sites[0].init.ok, false);
  assert.equal(report.sites[0].init.error.category, 'spider-not-ready');
  assert.equal(report.observations.readyApis, 0);
  assert.equal(report.observations.homes, 0);
  assert.equal(records[0].calls.length, 0);
  const summary = summarizeMatrix([report]);
  assert.equal(summary.loaded, 1);
  assert.equal(summary.readyApis, 0);
  assert.equal(summary.failureCategories['spider-not-ready'], 1);
});

test('valid empty JSON and homes with classification/list content remain distinguishable', async t => {
  const { directory, artifact } = capture(t);
  const homes = new Map([
    ['csp_Empty', '{}'],
    ['csp_Class', '{"class":[{"type_name":"owned classification"}]}'],
    ['csp_List', '{"list":[{"vod_id":"owned item"}]}'],
  ]);
  const report = await probeJarArtifact(artifact('homes', [...homes.keys()].map((api, i) => source('home-' + i, api))), {
    inputRoot: directory, runtimeFactory: fakeFactory({ call: value => homes.get(value.api) }),
  });
  assert.equal(report.observations.homes, 3, 'valid JSON calls are counted independently of useful content');
  assert.equal(report.observations.homesWithContent, 2);
  assert.deepEqual(report.sites.map(row => row.homeContent.emptyObject), [true, false, false]);
  assert.deepEqual(report.sites.map(row => row.homeContent.hasContent), [false, true, true]);
  assert.deepEqual(report.sites.map(row => row.homeContent.fields), [0, 1, 1]);
  assert.deepEqual(report.sites.map(row => row.homeContent.classes), [null, 1, null]);
  assert.deepEqual(report.sites.map(row => row.homeContent.list), [null, null, 1]);
  assert.equal(report.sites.filter(row => row.homeContent.classes > 0 || row.homeContent.list > 0).length, 2);
  assert.equal(report.observations.categories, 0, 'no invented category ID is used');
  assert.ok(report.sites.every(row => row.homeContent.ok));
  assert.equal(summarizeMatrix([report]).homesWithContent, 2);
});

test('same API with distinct ext remains pending rather than silently becoming covered', async t => {
  const { directory, artifact } = capture(t), records = [];
  const sites = [
    source('first', 'csp_Same', 'alpha'), source('second', 'csp_Same', 'beta'),
    source('duplicate', 'csp_Same', 'alpha'), source('other', 'csp_Other'),
    source('js', 'https://fixture.invalid/rule.js'), source('py', 'https://fixture.invalid/rule.py'),
    source('xml', 'csp_NotCspType', '', { type: 1 }),
  ];
  const report = await probeJarArtifact(artifact('variants', sites), { inputRoot: directory, runtimeFactory: fakeFactory({ records }) });
  assert.equal(report.sourceCount, 7);
  assert.equal(report.uniqueApis, 2);
  assert.equal(report.uniqueVariants, 3);
  assert.equal(report.duplicateSources, 1);
  assert.equal(report.skippedNonCspSources, 3);
  assert.equal(report.variantBudgetSkipped, 1);
  assert.equal(report.budgetSkipped, 1);
  assert.equal(report.unattempted.filter(row => row.reason === 'variant-budget').length, 1);
  assert.deepEqual(records[0].gets.map(value => [value.api, value.ext]), [['csp_Same', 'alpha'], ['csp_Other', '']]);
  assert.equal(report.observations.attemptedApis, 2);
});

test('network failures and an actual unresolved-call deadline are distinct and still close their workers', { timeout: 5000 }, async t => {
  const { directory, artifact } = capture(t), records = [];
  const network = await probeJarArtifact(artifact('network'), {
    inputRoot: directory, runtimeFactory: fakeFactory({ records, call() { throw new Error('HTTP 403 https://private.invalid/?token=secret'); } }),
  });
  assert.equal(network.sites[0].homeContent.error.category, 'network');
  assert.equal(network.cleanup.closed, true);
  assert.equal(JSON.stringify(network).includes('secret'), false);
  const deadline = await probeJarArtifact(artifact('deadline', [source('deadline')], { limits: { ...fastLimits, callMs: 15 } }), {
    inputRoot: directory, runtimeFactory: fakeFactory({ records, call: () => new Promise(() => {}) }),
  });
  assert.equal(deadline.sites[0].homeContent.error.category, 'timeout');
  assert.equal(deadline.observations.homes, 0);
  assert.equal(deadline.cleanup.closed, true);
  assert.equal(deadline.cleanup.temporaryDataRemoved, true);
  assert.ok(records.every(record => record.closed));
  assert.equal(classifyFailure(new Error('java.net.SocketTimeoutException: private hostname')).category, 'network');
  assert.equal(classifyFailure(new Error('Spider worker timed out')).category, 'timeout');
  assert.equal(classifyFailure(Object.assign(new Error('budget'), { code: 'ARTIFACT_DEADLINE' })).category, 'artifact-timeout');
});

test('escaping paths, symlink escapes, altered hashes and invalid sizes fail before worker creation', async t => {
  const { directory, artifact } = capture(t), original = artifact('input');
  const root = join(directory, 'captured');
  mkdirSync(root);
  const link = join(root, 'outside.jar');
  symlinkSync(original.jarPath, link);
  let started = 0;
  const runtimeFactory = () => { started++; throw new Error('invalid input reached execution'); };
  for (const [value, inputRoot] of [
    [{ ...original, jarPath: join(root, '..', 'input.jar') }, root],
    [{ ...original, jarPath: link }, root],
    [{ ...original, sha256: '0'.repeat(64) }, directory],
    [{ ...original, limits: { ...fastLimits, maxJarBytes: 1 } }, directory],
    [{ ...original, jarPath: root }, directory],
  ]) {
    const report = await probeJarArtifact(value, { inputRoot, runtimeFactory });
    assert.equal(report.error.stage, 'input');
    assert.equal(report.error.category, 'input');
    assert.equal(report.observations.attemptedApis, 0);
  }
  assert.equal(started, 0);
  assert.throws(() => normalizeManifest({ artifacts: [], limits: { artifactMs: 0 } }), /INPUT_SCHEMA/);
  assert.throws(() => normalizeManifest({ schemaVersion: 2, artifacts: [] }), /INPUT_SCHEMA/);
  await assert.rejects(probeJarMatrix({ artifacts: [] }), /saved manifest/);
});

test('response and native-state metadata exclude raw payloads while retaining comparison evidence', () => {
  const first = summarizeResponse('{"class":[{"type_id":"private-id"}],"filters":{}}');
  const reordered = summarizeResponse('{"filters":{},"class":[{"type_id":"private-id"}]}');
  assert.notEqual(first.metadata.sha256, reordered.metadata.sha256);
  assert.equal(first.metadata.semanticSha256, reordered.metadata.semanticSha256);
  assert.equal(JSON.stringify(first.metadata).includes('private-id'), false);
  for (const value of [null, {}, '[]', 'null', 'broken JSON']) assert.throws(() => summarizeResponse(value));
  const native = summarizeNativeState({
    enabled: true, workerPid: process.pid, owner: '/private/secret.jar', report: 'private native report',
    payloadLoader: 'dalvik.system.DexClassLoader', backend: 'fixture.Backend', loaderCalls: 1,
    spiderTypes: { 'fixture.Spider': 2, 'https://private.invalid/?secret': 1 },
  });
  assert.equal(native.loaderCalls, 1);
  assert.deepEqual(native.spiderTypes, { 'fixture.Spider': 2 });
  assert.match(native.reportSha256, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(native).includes('private'), false);
  assert.equal('workerPid' in native, false);
});

test('owned synthetic class JAR executes real home/category/detail through the matrix and cleans its fixture', { timeout: 60000 }, async t => {
  const { directory } = capture(t);
  const fixtures = buildSpiderFixtures();
  const sourcePath = join(fixtures.build, 'MatrixFixture.java');
  const java = `package com.github.catvod.spider;
import java.util.*;
public class MatrixFixture extends Contract {
 public String homeContent(boolean filter) {
  if (!filter) throw new IllegalArgumentException("fixture filter");
  super.homeContent(filter);
  return "{\\"class\\":[{\\"type_id\\":\\"fixture-category\\"}],\\"list\\":[]}";
 }
 public String categoryContent(String id,String page,boolean filter,HashMap<String,String> extend) {
  if (!"fixture-category".equals(id)||!"1".equals(page)||!filter||!extend.isEmpty()) throw new IllegalArgumentException("fixture category args");
  super.categoryContent(id,page,filter,extend);
  return "{\\"list\\":[{\\"vod_id\\":\\"fixture-item\\"}]}";
 }
 public String detailContent(List<String> ids) {
  if (!Collections.singletonList("fixture-item").equals(ids)) throw new IllegalArgumentException("fixture detail args");
  super.detailContent(ids);
  return "{\\"list\\":[{\\"vod_id\\":\\"fixture-item\\",\\"vod_name\\":\\"owned-fixture\\"}]}";
 }
}`;
  const sessions = [];
  try {
    writeFileSync(sourcePath, java);
    const classes = join(fixtures.build, 'classes');
    const compiled = spawnSync(join(fixtures.built.javaHome, 'bin/javac'), ['--release', '8', '-encoding', 'UTF-8', '-cp', classes + delimiter + fixtures.built.classpath, '-d', classes, sourcePath], { encoding: 'utf8', timeout: 30000 });
    assert.equal(compiled.status, 0, compiled.stderr);
    const packed = spawnSync(join(fixtures.built.javaHome, 'bin/jar'), ['--update', '--file', fixtures.jar, '-C', classes, 'com/github/catvod/spider/MatrixFixture.class'], { encoding: 'utf8', timeout: 30000 });
    assert.equal(packed.status, 0, packed.stderr);
    const runtimeFactory = options => {
      const runtime = createSpiderRuntime({ ...options, built: fixtures.built, nativeBridge: false });
      sessions.push(runtime);
      return runtime;
    };
    const report = await probeJarArtifact({
      id: 'owned-fixture', role: 'main', jarPath: fixtures.jar, sha256: sha256(readFileSync(fixtures.jar)),
      sites: [source('owned-fixture', 'csp_MatrixFixture', 'owned-ext')],
      limits: { ...fastLimits, artifactMs: 30000, loadMs: 15000, initMs: 10000, callMs: 10000 },
    }, { inputRoot: fixtures.build, workRoot: directory, runtimeFactory });
    assert.equal(report.error, undefined);
    assert.equal(report.load.loaded, true);
    assert.equal(report.observations.readyApis, 1);
    assert.equal(report.observations.homes, 1);
    assert.equal(report.observations.categories, 1);
    assert.equal(report.observations.details, 1);
    assert.equal(report.observations.homesWithContent, 1);
    assert.equal(report.observations.categoriesWithContent, 1);
    assert.equal(report.observations.detailsWithContent, 1);
    assert.deepEqual(report.selected, { homes: 1, category: 1, detail: 1, search: 0 });
    assert.equal(report.sites[0].homeContent.classes, 1);
    assert.equal(report.sites[0].categoryContent.list, 1);
    assert.equal(report.sites[0].detailContent.list, 1);
    assert.equal(report.cleanup.closed, true);
    assert.equal(report.cleanup.temporaryDataRemoved, true);
    assert.ok(sessions.every(runtime => !existsSync(runtime.dataDirectory)));
    const helper = await probeJarArtifact({
      id: 'owned-site-helper', role: 'site', helperLoadValidation: true, jarPath: fixtures.jar, sha256: sha256(readFileSync(fixtures.jar)), sites: [],
      limits: { ...fastLimits, artifactMs: 30000, loadMs: 15000, initMs: 10000, callMs: 10000 },
    }, { inputRoot: fixtures.build, workRoot: directory, runtimeFactory });
    assert.equal(helper.error, undefined);
    assert.equal(helper.load.loaded, true);
    assert.equal(helper.loadValidation.status, 'loaded');
    assert.equal(helper.load.loaderCount, 1);
    assert.equal(helper.sites.length, 0);
    assert.equal(helper.observations.attemptedApis, 0);
    assert.equal(helper.cleanup.closed, true);
  } finally {
    await Promise.allSettled(sessions.map(runtime => runtime.close()));
    rmSync(fixtures.build, { recursive: true, force: true });
  }
  assert.equal(existsSync(fixtures.build), false);
});
