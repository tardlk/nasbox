// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { buildSpiderFixtures } from '../scripts/compat/spider-fixtures.mjs';
import { createExecutableSubscriptionSession } from '../backend/spider-runtime/session.mjs';
import { JarArtifactCache } from '../backend/spider-runtime/artifact-cache.mjs';
import { createSpiderRuntime } from '../backend/spider-runtime/index.mjs';
const fixtures = buildSpiderFixtures(), bytes = readFileSync(fixtures.jar);
const md5 = value => createHash('md5').update(value).digest('hex');
const root = join(import.meta.dirname, '..');
async function serve(handler) { const server = createServer(handler); await new Promise(done => server.listen(0, '127.0.0.1', done)); return { base: 'http://127.0.0.1:' + server.address().port, async close() { server.closeAllConnections(); await new Promise(done => server.close(done)); } }; }

// Network remains in the parent event loop while a separate CLI process runs.
async function cli(args) {
  const child = spawn(process.execPath, ['backend/spider-runtime/subscription-cli.mjs', ...args], { cwd: root });
  let stdout = '', stderr = '';
  child.stdout.on('data', value => { stdout += value; }); child.stderr.on('data', value => { stderr += value; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 30000);
  try { const code = await new Promise((done, reject) => { child.on('error', reject); child.on('close', done); }); return { code, stdout, stderr }; }
  finally { clearTimeout(timer); }
}

test('real session downloads global and site JARs lazily, retains active generation and updates same URL after clear', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'tvbox-session-artifacts-'));
  let body = bytes, base, requests = 0, generation = 0;
  const http = await serve((req, res) => {
    if (req.url === '/jar') { requests++; res.end(body); return; }
    const signature = base + '/jar;md5;' + md5(body);
    res.end(JSON.stringify({ spider: signature, sites: [{ key: 'main', type: 3, api: 'csp_Contract', ext: String(generation) }, { key: 'site', type: 3, api: 'csp_Contract', ext: 'site', jar: signature }] }));
  }); base = http.base;
  const session = await createExecutableSubscriptionSession({ remoteJars: true, artifactCacheDir: directory, jarCacheOptions: { integrity: 'strict' } });
  try {
    assert.equal((await session.load({ apiUrl: base + '/config' })).ok, true);
    assert.equal(requests, 0, 'config import does not eagerly execute/fetch a JAR');
    const before = await session.call('main', 'homeContent', [true]);
    assert.equal(JSON.parse(before.value).ext, '0');
    assert.equal((await session.call('main', 'action', ['resource'])).value, 'fixture-resource');
    assert.equal(JSON.parse((await session.call('site', 'homeContent', [true])).value).ext, 'site');
    assert.equal(requests, 2, 'global and site caches have distinct Android namespaces');
    writeFileSync(join(fixtures.build, 'classes/assets/value.txt'), 'fixture-updated');
    const updated = join(directory, 'updated.jar');
    const pack = spawnSync(join(fixtures.built.javaHome, 'bin/jar'), ['--create', '--file', updated, '-C', join(fixtures.build, 'classes'), '.'], { encoding: 'utf8' });
    assert.equal(pack.status, 0, pack.stderr); body = readFileSync(updated); generation++;
    assert.equal((await session.call('main', 'action', ['resource'])).value, 'fixture-resource');
    assert.equal(requests, 2, 'loaded instance is not hot-swapped mid-generation');
    assert.equal((await session.load({ apiUrl: base + '/config' })).ok, true);
    const after = await session.call('main', 'homeContent', [true]);
    assert.notEqual(after.spider.token, before.spider.token);
    assert.equal(JSON.parse(after.value).ext, '1');
    assert.equal((await session.call('main', 'action', ['resource'])).value, 'fixture-updated');
    assert.equal((await session.call('site', 'action', ['resource'])).value, 'fixture-updated');
    assert.equal(requests, 4);
    const state = (await session.getState()).artifacts;
    assert.equal(state.pinned, 2); assert.equal(state.entries, 2); assert.ok(state.bytes <= state.maxBytes);
  } finally { await session.close(); await http.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('independent CLI restart imports cached config and JAR without a manual mapping or redownload', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'tvbox-session-cli-')); let base, jarRequests = 0, configRequests = 0;
  const http = await serve((req, res) => {
    if (req.url === '/jar') { jarRequests++; res.end(bytes); return; }
    configRequests++; res.end(JSON.stringify({ spider: base + '/jar;md5;' + md5(bytes), sites: [{ key: 'main', type: 3, api: 'csp_Contract' }] }));
  }); base = http.base;
  try {
    const args = ['--url', base + '/config', '--source', 'main', '--method', 'action', '--args', '["resource"]', '--data', directory, '--strict-md5'];
    for (const extra of [[], ['--cache']]) {
      const result = await cli([...args, ...extra]); assert.equal(result.code, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).value, 'fixture-resource');
    }
    assert.equal(jarRequests, 1); assert.equal(configRequests, 1);
    assert.equal(existsSync(join(directory, 'artifacts/jar-artifacts-v1/.lock')), false);
  } finally { await http.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('invalid downloaded JAR gets one bounded reload and session can recover; strict MD5 errors never reach executor', async () => {
  let body = Buffer.from('not a jar'), base, requests = 0;
  const http = await serve((req, res) => {
    if (req.url === '/jar') { requests++; res.end(body); return; }
    res.end(JSON.stringify({ spider: base + '/jar', sites: [{ key: 'main', type: 3, api: 'csp_Contract' }] }));
  }); base = http.base;
  const session = await createExecutableSubscriptionSession({ remoteJars: true });
  try {
    await session.load({ apiUrl: base + '/config' });
    await assert.rejects(session.call('main', 'action', ['resource']), /could not be initialized/);
    assert.equal(requests, 2);
    body = bytes; await session.load({ apiUrl: base + '/config' });
    assert.equal((await session.call('main', 'action', ['resource'])).value, 'fixture-resource');
    assert.equal(requests, 3);
  } finally { await session.close(); await http.close(); }
  let loads = 0;
  const runtime = { request: async () => 'jar', loadMain: async () => { loads++; return { loaded: true }; }, clear: async () => {}, forgetJarRegistrations() {} };
  const cache = new JarArtifactCache({ integrity: 'strict', fetchBytes: async () => bytes });
  const strict = await createExecutableSubscriptionSession({ runtime, artifactCache: cache, fetchText: async () => JSON.stringify({ spider: 'http://fixture.invalid/a;md5;' + md5('wrong'), sites: [{ key: 'a', type: 3, api: 'csp_Contract' }] }) });
  try { await strict.load({ apiUrl: 'http://config.invalid/a' }); await assert.rejects(strict.getCSP('a'), error => error.code === 'JAR_MD5_MISMATCH'); assert.equal(loads, 0); }
  finally { await strict.close(); await cache.close(); }
});

test('borrowed runtime cannot create an implicitly owned temporary remote-artifact lifetime', async () => {
  await assert.rejects(createExecutableSubscriptionSession({ runtime: {}, remoteJars: true }), /caller-owned artifactCache/);
});

test('native worker replacement forgets automatic registrations before old JARs are evicted', { skip: process.env.TVBOX_TEST_NATIVE !== '1', timeout: 90000 }, async () => {
  let generation = 0, base;
  const directory = mkdtempSync(join(tmpdir(), 'tvbox-native-auto-artifacts-'));
  const http = await serve((req, res) => {
    if (req.url.startsWith('/jar')) { res.end(bytes); return; }
    res.end(JSON.stringify({ sites: [{ key: 'site', type: 3, api: 'csp_Contract', jar: base + '/jar?generation=' + generation }] }));
  }); base = http.base;
  const runtime = createSpiderRuntime({ nativeBridge: true });
  const cache = new JarArtifactCache({ directory, maxBytes: 3 * bytes.length + 1024 });
  const session = await createExecutableSubscriptionSession({ runtime, artifactCache: cache, remoteJars: true });
  try {
    await runtime.registerJar('explicit://fixture', fixtures.jar);
    let previous;
    for (generation = 0; generation < 5; generation++) {
      assert.equal((await session.load({ apiUrl: base + '/config' })).ok, true);
      if (generation) {
        await assert.rejects(runtime.call(previous, 'action', ['resource']), /Unknown or cleared Spider token/);
        const old = await runtime.getCSP({ key: 'old-' + generation, type: 3, api: 'csp_Contract', jar: base + '/jar?generation=' + (generation - 1) });
        assert.equal(old.ready, false, 'new worker must not replay an automatically retrieved old registration');
      }
      const explicit = await runtime.getCSP({ key: 'explicit-' + generation, type: 3, api: 'csp_Contract', jar: 'explicit://fixture' });
      assert.equal(explicit.ready, true, 'caller-owned explicit mappings still replay');
      const result = await session.call('site', 'action', ['resource']);
      assert.equal(result.value, 'fixture-resource'); assert.notEqual(result.spider.token, previous);
      previous = result.spider.token;
    }
    const state = (await session.getState()).artifacts;
    assert.equal(state.pinned, 1); assert.ok(state.entries < 5); assert.ok(state.bytes <= state.maxBytes);
  } finally { await session.close(); await runtime.close(); await cache.close(); await http.close(); rmSync(directory, { recursive: true, force: true }); }
});
