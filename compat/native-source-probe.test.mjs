// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureNativeSource, readCapturedNativeSource, summarizeHome, probeNativeArtifacts, compareNativeReports, nativeProbePassed } from '../scripts/compat/native-source-probe.mjs';

test('home comparisons ignore object order but retain array order and value types', () => {
  const first = summarizeHome('{"class":[{"id":1,"name":"A"}],"filters":{},"list":[]}');
  const reordered = summarizeHome('{"list":[],"filters":{},"class":[{"name":"A","id":1}]}');
  assert.notEqual(first.sha256, reordered.sha256);
  assert.equal(first.semanticSha256, reordered.semanticSha256);
  assert.notEqual(first.classSha256, summarizeHome('{"class":[{"id":"1","name":"A"}]}').classSha256);
  assert.notEqual(summarizeHome('{"class":[1,2]}').classSha256, summarizeHome('{"class":[2,1]}').classSha256);
  for (const value of ['[]', 'null', 'garbage']) assert.throws(() => summarizeHome(value));
});

test('captured subscription is reimported offline and tampered inputs fail before execution', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'tvbox-probe-capture-'));
  let requests = 0, base;
  const server = createServer((req, res) => {
    requests++;
    res.end(req.url === '/jar' ? 'not-executable-fixture' : JSON.stringify({ spider: base + '/jar', sites: [{ key: 'fixture', name: 'Fixture', type: 3, api: 'csp_Test' }] }));
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  base = 'http://127.0.0.1:' + server.address().port;
  try {
    const metadata = await captureNativeSource(base + '/config', folder);
    assert.equal(metadata.sites, 1);
    const before = requests;
    const captured = await readCapturedNativeSource(folder);
    assert.deepEqual(captured.subscription, { reimported: true, configMatchesCapture: true });
    assert.equal(captured.config.sites[0].key, 'fixture');
    assert.equal(requests, before, 'reimport does not fetch even while server is available');
    for (const name of ['config.json', 'spider.jar', 'responses.json']) {
      const path = join(folder, name), original = readFileSync(path);
      writeFileSync(path, 'tampered');
      await assert.rejects(readCapturedNativeSource(folder), /checksum differs/);
      writeFileSync(path, original);
    }
  } finally {
    await new Promise(done => server.close(done));
    rmSync(folder, { recursive: true, force: true });
  }
});

test('probe retains per-source failures, checks stale tokens and closes after malformed homes', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'tvbox-probe-failure-'));
  let generation = 1, closed = false;
  const runtime = {
    dataDirectory: directory,
    async loadMain() { return { loaded: true }; },
    async getCSP(source) {
      if (source.key === 'broken-init') throw new Error('private URL and token');
      return { ready: source.key !== 'missing', className: 'fixture.Spider', token: generation + ':' + source.key };
    },
    async call(token) {
      if (!token.startsWith(generation + ':')) throw new Error('cleared Spider token');
      return token.endsWith(':bad-json') ? 'private raw response' : '{"class":[]}';
    },
    async request() { return { workerPid: generation, backend: generation === 1 ? 'dynarmic' : null, extraLoaders: 0, dexLoaders: 0, listeners: 0 }; },
    async clear() { generation++; },
    async close() { closed = true; rmSync(directory, { recursive: true, force: true }); },
  };
  const config = { sites: ['Aid', 'bad-json', 'broken-init', 'missing'].map(key => ({ key, type: 3, api: 'csp_Test' })) };
  const report = await probeNativeArtifacts(config, '/not-executed.jar', { homeKeys: ['Aid', 'bad-json'], runtimeFactory: () => runtime });
  assert.deepEqual(report.observations, { sites: 4, ready: 2, homes: 1, homeFailures: 1 });
  assert.equal(report.rows[1].homeError.category, 'invalid-json');
  assert.equal(report.rows[2].error.category, 'execution');
  assert.ok(Object.values(report.lifecycle).every(Boolean));
  assert.equal(closed, true);
  assert.equal(report.close.temporaryDataRemoved, true);
  assert.ok(!JSON.stringify(report).includes('private'), 'raw source messages/bodies are excluded');
  assert.equal(nativeProbePassed(report), false);
});

test('comparison refuses different inputs and exposes a missing home instead of dropping it', () => {
  const input = { configSha256: 'config', jarSha256: 'jar', responsesSha256: 'responses' };
  const home = summarizeHome('{"class":[]}');
  const left = { input, rows: [{ key: 'ok', ready: true, className: 'C', home }, { key: 'missing', ready: false, className: 'Null' }] };
  const right = structuredClone(left);
  delete right.rows[0].home;
  right.rows[0].homeError = { category: 'execution' };
  const comparison = compareNativeReports(left, right);
  assert.equal(comparison.observations.readinessMatches, 2, 'matching unready source is an observation, not a success');
  assert.equal(comparison.observations.comparedHomes, 0);
  assert.equal(comparison.observations.missingHomes, 1);
  right.input.jarSha256 = 'different';
  assert.throws(() => compareNativeReports(left, right), /same captured inputs/);
});

test('CLI success requires cleanup, reload and actual deadline resource release', () => {
  const report = { load: { loaded: true }, close: { ok: true, temporaryDataRemoved: true }, observations: { sites: 45, ready: 44, homes: 5, homeFailures: 0 }, lifecycle: { workerReplaced: true, oldTokenRejected: true, bridgeReleased: true }, reload: { loaded: true, ready: true }, deadline: { loaded: true, nativeLoaderReady: true, timedOut: true, closed: true, workerExited: true, temporaryDataRemoved: true, ownedTcpListenersBefore: 1, ownedTcpListenersReleased: 1 } };
  assert.equal(nativeProbePassed(report), true, 'unavailable CSP is retained without hiding other results');
  for (const [group, key, value] of [['lifecycle', 'oldTokenRejected', false], ['close', 'temporaryDataRemoved', false], ['reload', 'ready', false], ['observations', 'homeFailures', 1], ['deadline', 'workerExited', false], ['deadline', 'ownedTcpListenersReleased', 0], ['deadline', 'ownedTcpListenersBefore', null], ['deadline', 'ownedTcpListenersBefore', undefined]]) {
    const broken = structuredClone(report);
    broken[group][key] = value;
    assert.equal(nativeProbePassed(broken), false, group + '.' + key);
  }
});
