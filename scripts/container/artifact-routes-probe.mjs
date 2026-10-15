// SPDX-License-Identifier: GPL-3.0-only
// Offline fixture probe: Node + the existing prebuilt JRE runtime; no compiler.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSpiderRuntime } from '../../backend/spider-runtime/index.mjs';
import { JarArtifactCache } from '../../backend/spider-runtime/artifact-cache.mjs';
import { createExecutableSubscriptionSession } from '../../backend/spider-runtime/session.mjs';

const sha256 = value => createHash('sha256').update(value).digest('hex');

/** Does not save subscription text, URLs, tokens, raw homes or runtime logs. */
export async function probeArtifactRoutes(fixtureJar) {
  assert.ok(isAbsolute(fixtureJar || ''), 'fixtureJar must be an absolute path');
  const bytes = await readFile(fixtureJar);
  assert.ok(bytes.length > 0, 'fixtureJar is empty');
  const report = {
    version: 1,
    ok: false,
    fixture: { bytes: bytes.length, sha256: sha256(bytes) },
    downloads: { image: 0, clan: 0, config: 0, unexpected: 0 },
    initial: {},
    reimport: {},
    restart: {},
    lifecycle: { oldTokensRejected: 0, oldRegistrationsReady: 0, changedTokens: 0 },
    cleanup: { ready: false },
  };
  let directory, server, session, runtime, cache, generation = 0, stage = 'prepare';
  let failure;
  const closeSession = async () => {
    const activeSession = session, activeRuntime = runtime, activeCache = cache;
    session = runtime = cache = undefined;
    // A borrowed runtime/cache is deliberately owned and closed by this probe.
    try { await activeSession?.close(); }
    finally { try { await activeRuntime?.close(); } finally { await activeCache?.close(); } }
  };
  try {
    directory = await mkdtemp(join(tmpdir(), 'tvbox-artifact-routes-'));
    const assetRoot = join(directory, 'assets');
    const externalRoot = join(directory, 'external');
    const fileRoot = join(directory, 'files');
    const cacheDirectory = join(directory, 'cache');
    for (const path of [assetRoot, externalRoot, fileRoot, cacheDirectory]) await mkdir(path);
    await copyFile(fixtureJar, join(assetRoot, 'fixture.jar'));
    await copyFile(fixtureJar, join(externalRoot, 'fixture.jar'));
    // This exists only in fileRoot, proving the externalRoot miss falls back.
    await copyFile(fixtureJar, join(fileRoot, 'fallback.jar'));
    let base;
    const routes = [
      ['image', ''],
      ['assets', 'assets://fixture.jar'],
      ['external', 'file:/fixture.jar'],
      ['fileFallback', 'file:/fallback.jar'],
      ['clan', 'clan://localhost/fixture.jar'],
    ];
    const config = () => JSON.stringify({
      spider: 'img+' + base + '/image',
      sites: routes.map(([key, jar]) => ({ key, name: key, type: 3, api: 'csp_Contract', ext: 'generation-' + generation, ...(jar ? { jar } : {}) })),
    });
    server = createServer((request, response) => {
      if (request.url === '/image') {
        report.downloads.image++;
        response.setHeader('Content-Type', 'text/plain; charset=utf-8');
        response.end('ABCDEFGH**' + bytes.toString('base64'));
      } else if (request.url === '/file/fixture.jar') {
        report.downloads.clan++;
        response.setHeader('Content-Type', 'application/java-archive');
        response.end(bytes);
      } else if (request.url === '/config') {
        report.downloads.config++;
        response.setHeader('Content-Type', 'application/json');
        response.end(config());
      } else {
        report.downloads.unexpected++;
        response.writeHead(404).end();
      }
    });
    await new Promise((done, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => { server.off('error', reject); done(); });
    });
    base = 'http://127.0.0.1:' + server.address().port;

    async function openSession() {
      runtime = createSpiderRuntime({ nativeBridge: true, timeoutMs: 45000, dataDir: join(directory, 'runtime') });
      cache = new JarArtifactCache({ directory: cacheDirectory, assetRoot, externalRoot, fileRoot, localAddress: base + '/' });
      session = await createExecutableSubscriptionSession({
        runtime, artifactCache: cache, remoteJars: true,
        localAddress: base + '/',
        jarCacheOptions: { assetRoot, externalRoot, fileRoot },
      });
    }
    async function exercise(target) {
      const tokens = new Map();
      for (const [key] of routes) {
        stage = 'execute-' + key;
        const result = await session.call(key, 'homeContent', [true]);
        assert.equal(result.spider.ready, true, 'fixture Spider must be ready');
        const home = JSON.parse(result.value);
        assert.equal(home.method, 'home', 'fixture home method differs');
        assert.deepEqual(home.args, [true], 'fixture home arguments differ');
        assert.equal(home.ext, 'generation-' + generation, 'fixture generation differs');
        const resource = (await session.call(key, 'action', ['resource'])).value;
        assert.equal(resource, 'fixture-resource', 'fixture JAR resource differs');
        target[key] = { ready: true, homeSha256: sha256(result.value), resource };
        tokens.set(key, result.spider.token);
      }
      const state = (await session.getState()).artifacts;
      target.cache = { entries: state.entries, pinned: state.pinned, bytes: state.bytes, maxBytes: state.maxBytes };
      assert.ok(state.bytes <= state.maxBytes, 'artifact cache exceeded quota');
      return tokens;
    }

    stage = 'initial-open';
    await openSession();
    assert.equal((await session.load({ apiUrl: base + '/config' })).ok, true, 'initial import failed');
    assert.equal(report.downloads.image + report.downloads.clan, 0, 'import must fetch JARs lazily');
    const oldTokens = await exercise(report.initial);
    assert.equal(report.downloads.image, 1, 'image JAR should download once');
    assert.equal(report.downloads.clan, 1, 'clan JAR should download once');

    stage = 'reimport';
    generation++;
    assert.equal((await session.load({ apiUrl: base + '/config' })).ok, true, 'reimport failed');
    for (const token of oldTokens.values()) {
      await assert.rejects(runtime.call(token, 'homeContent', [true]), /cleared Spider token/, 'old Spider token survived import');
      report.lifecycle.oldTokensRejected++;
    }
    // Bypass the session's lazy resolver: old automatic registrations must not
    // become usable just because a replacement native worker replayed settings.
    for (const [key, jar] of routes.filter(([, value]) => value)) {
      const old = await runtime.getCSP({ key: 'old-' + key, type: 3, api: 'csp_Contract', ext: '', jar });
      if (old.ready) report.lifecycle.oldRegistrationsReady++;
    }
    const newTokens = await exercise(report.reimport);
    for (const [key, token] of newTokens) {
      assert.notEqual(token, oldTokens.get(key), 'reimport reused a Spider token');
      report.lifecycle.changedTokens++;
    }
    assert.equal(report.downloads.image, 1, 'reimport should reuse decoded image JAR');
    assert.equal(report.downloads.clan, 1, 'reimport should reuse clan JAR');

    stage = 'restart-close';
    await closeSession();
    stage = 'restart-open';
    await openSession();
    assert.equal((await session.load({ apiUrl: base + '/config', useCache: true })).ok, true, 'restart import failed');
    await exercise(report.restart);
    assert.equal(report.downloads.image, 1, 'restart redownloaded decoded image JAR');
    assert.equal(report.downloads.clan, 1, 'restart redownloaded clan JAR');
    assert.equal(report.downloads.unexpected, 0, 'unexpected HTTP request');
    assert.equal(report.downloads.config, 3, 'each session import should fetch the synthetic config');
    stage = 'old-registration-check';
    assert.equal(report.lifecycle.oldRegistrationsReady, 0, 'old automatic JAR registration survived reimport');
    report.ok = true;
  } catch (error) {
    failure = error;
    report.failure = { stage, name: error.name };
  } finally {
    const cleanupErrors = [];
    try { await closeSession(); } catch (error) { cleanupErrors.push(error); }
    if (server) {
      server.closeAllConnections();
      try { await new Promise((done, reject) => server.close(error => error ? reject(error) : done())); }
      catch (error) { cleanupErrors.push(error); }
    }
    if (directory) {
      try { await rm(directory, { recursive: true, force: true }); }
      catch (error) { cleanupErrors.push(error); }
    }
    report.cleanup.ready = cleanupErrors.length === 0;
    if (cleanupErrors.length) {
      failure ||= cleanupErrors[0];
      report.failure ||= { stage: 'cleanup', name: cleanupErrors[0].name };
      report.ok = false;
    }
  }
  return { report, error: failure };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { report, error } = await probeArtifactRoutes(process.argv[2]);
    const output = JSON.stringify(report, null, 2) + '\n';
    if (process.argv[3]) {
      const reportPath = resolve(process.argv[3]);
      await mkdir(dirname(reportPath), { recursive: true });
      await writeFile(reportPath, output);
    } else process.stdout.write(output);
    if (error) {
      console.error('Artifact route probe failed at ' + report.failure.stage + ': ' + error.message);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error('Artifact route probe setup failed: ' + error.message);
    process.exitCode = 1;
  }
}
