// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diagnoseJarFailure, extractMissingSymbols } from '../scripts/container/jar-failure-diagnostics.mjs';

test('only anchored Java classes, methods, fields and verify locations enter evidence', () => {
  const found = extractMissingSymbols(`java.lang.ClassNotFoundException: android.webkit.WebView
java.lang.NoClassDefFoundError: android/content/SharedPreferences
java.lang.NoSuchMethodError: 'java.lang.String android.os.SystemProperties.get(java.lang.String, java.lang.String)'
java.lang.NoSuchMethodException: android.os.Build.foo(int)
java.lang.NoSuchFieldError: android.os.Build.MODEL
java.lang.VerifyError: Bad type on operand stack
Exception Details:
  Location:
    com/github/catvod/spider/Foo.homeContent(Z)Ljava/lang/String;
java.lang.NoClassDefFoundError: Failed resolution of: Landroid/webkit/WebView;
java.lang.ClassNotFoundException: https://secret.invalid/?token=private
java.lang.NoSuchMethodError: https://secret.invalid/private()
java.lang.NoSuchFieldError: token=private
unanchored.android.Class secret-private`);
  assert.ok(found.missingSymbols.some(value => value.kind === 'method' && value.owner === 'android.os.SystemProperties' && value.name === 'get'));
  assert.ok(found.missingSymbols.some(value => value.kind === 'field' && value.name === 'MODEL'));
  assert.ok(found.missingSymbols.some(value => value.kind === 'class' && value.name === 'android.webkit.WebView'));
  assert.ok(found.missingSymbols.some(value => value.kind === 'verify-class' && value.name === 'com.github.catvod.spider.Foo'));
  const text = JSON.stringify(found);
  for (const secret of ['secret.invalid', 'private', 'unanchored']) assert.equal(text.includes(secret), false);
  assert.equal(extractMissingSymbols('NoSuchMethodError: random token private\nClassNotFoundException: secret-token').missingSymbols.length, 0);
});

test('single captured JAR diagnostic retains contracts and cleans up without exposing raw logs', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'tvbox-diagnostic-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bytes = Buffer.from('owned fake artifact'), sha256 = createHash('sha256').update(bytes).digest('hex');
  await writeFile(join(directory, 'fixture.jar'), bytes);
  let closed = false, calls = 0;
  const manifest = { artifacts: [{ id: sha256, sha256, jarPath: 'fixture.jar', role: 'site', sites: [{ key: 'private-key', type: 3, api: 'BareFixture', ext: 'secret-ext' }], limits: { artifactMs: 1000, loadMs: 100, initMs: 50, callMs: 50, closeMs: 50 } }] };
  const report = await diagnoseJarFailure(manifest, { id: sha256, inputRoot: directory, runtimeFactory: options => ({
    getDiagnostics: () => ({ stderr: '' }), registerJar: async () => {}, setModules: async () => {},
    request: async request => request.operation === 'nativeState' ? { enabled: false } : [],
    getState: async () => ({ jar: { loaderCount: 1 } }),
    getCSP: async () => { calls++; options.onStderr('java.lang.ClassNotFoundException: android.webkit.WebView\nsecret-token=https://secret.invalid/\n'); return { ready: false, className: 'com.github.catvod.crawler.SpiderNull' }; },
    close: async () => { closed = true; },
  }) });
  assert.equal(calls, 1);
  assert.equal(closed, true);
  assert.equal(report.cleanup.temporaryDataRemoved, true);
  assert.deepEqual(report.targets[0].evidence.missingSymbols, [{ kind: 'class', name: 'android.webkit.WebView' }]);
  for (const secret of ['private-key', 'secret-ext', 'secret-token', 'secret.invalid']) assert.equal(JSON.stringify(report).includes(secret), false);
});
