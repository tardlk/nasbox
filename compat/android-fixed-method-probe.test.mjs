// SPDX-License-Identifier: GPL-3.0-only
// Preparation checks only. Android execution remains a separate explicit step.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { transformFixedSource, ownedCaseDefinitions, ownedFixtureSources } from '../scripts/android/build-fixed-method-probe.mjs';
import { verifyPlatformReference } from '../scripts/compat/platform-reference.mjs';
import { extractMethod } from '../scripts/compat/oracle.mjs';
import { packageUid, requireEmptyOutput, runFixedMethodProbe, verifyFixedMethodResult } from '../scripts/android/run-fixed-method-probe.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
test('fixed bind and scan extraction remains byte-exact through the explicit target-App namespace binding', async () => {
  const verified = verifyPlatformReference();
  const original = await readFile(verified.extra + '/app/src/main/java/com/github/catvod/crawler/ProtectedInitJar.java', 'utf8');
  const result = transformFixedSource(original);
  assert.equal(result.metadata.sourceSha256, '86a31da8a7e8e573f957a157cafe0b3c0e74b7f8af937a6aa02b133a9973a250');
  assert.equal(result.metadata.methods.bindDexLoader.sourceSha256, '8bd5eb5213d074a0272732d3e2c277b3c18e8e12fb81f2fb7ceefaad65a3344b');
  assert.equal(result.metadata.methods.scan.sourceSha256, 'd30b870ea59d9d77e13961cb4af9f6c13763f5625b350b24c0bb14c9908765c6');
  for (const value of Object.values(result.metadata.methods)) {
    assert.equal(extractMethod(result.source, value.signature), extractMethod(original, value.signature));
    assert.equal(value.sourceSha256, hash(extractMethod(original, value.signature)));
  }
  assert.match(result.source, /import com.github.tvbox.parity.fixed.binding.App;/);
  assert.match(result.metadata.transform, /Application instance/);
  assert.throws(() => transformFixedSource(original + '\nclass ProtectedInitJar {}'), /FIXED_ART_BUILD_SOURCE_LAYOUT/);
});

test('owned classloader fixtures distinguish absent/null/valid loader and inherited-field binding without JNI', () => {
  const definitions = ownedCaseDefinitions();
  assert.equal(definitions.length, 5);
  assert.equal(definitions.filter(row => row.expectedFixed !== row.expectedOfficial).length, 1);
  assert.equal(definitions.find(row => row.expectedFixed !== row.expectedOfficial).id, 'missing-dex-native');
  for (const spec of definitions) {
    const sources = ownedFixtureSources(spec);
    assert.equal(Object.hasOwn(sources, 'com/github/catvod/spider/DexNative.java'), spec.hasDexNative);
    assert.equal(sources['com/github/tvbox/parity/fixture/Base.java'].includes('private dalvik.system.DexClassLoader inheritedLoader'), spec.hasLoaderField);
    const text = Object.values(sources).join('\n');
    assert.doesNotMatch(text, /\bnative\b|System\.load|java\.net|android\.os\.Process/);
    if (spec.hasDexNative) assert.match(text, /lastContext=context;return value/);
  }
});

function resultFixture() {
  const plan = { targetPackage: 'com.github.tvbox.osc.jun', source: { methodHash: hash('exact method') },
    officialMethodEvidence: { bodyHash: hash('official body') }, cases: ownedCaseDefinitions().map(row => ({ ...row, sha256: hash(row.id) })),
    scanInputs: ['first', 'second', 'third'].map(value => ({ sha256: hash(value), bytes: 32 })) };
  const metadata = { planSha256: hash('plan'), targetApkSha256: hash('target'), instrumentationApk: { sha256: hash('probe') } };
  const report = { schemaVersion: 1, planSha256: metadata.planSha256, targetApkSha256: metadata.targetApkSha256,
    instrumentationApkSha256: metadata.instrumentationApk.sha256, source: plan.source, officialMethodEvidence: plan.officialMethodEvidence,
    targetDexNativeAbsentBefore: true, targetDexNativeAbsentAfter: true, applicationUid: 10234, applicationPid: 1234, androidSdk: 30,
    targetApplication: { class: 'com.github.tvbox.osc.base.App', packageName: plan.targetPackage, uid: 10234, classloaderMatchesTarget: true, sameInstanceForBothMethodPaths: true },
    bindings: plan.cases.map(row => ({ id: row.id, fixtureSha256: row.sha256, fixed: row.expectedFixed, official: row.expectedOfficial,
      expectedFixed: row.expectedFixed, expectedOfficial: row.expectedOfficial, fixedFieldBound: row.expectedFieldBound,
      officialFieldBound: row.expectedFieldBound, fixedContextMatchesTargetApplication: true, officialContextMatchesTargetApplication: true,
      classloaderIsolated: true, nativeExecuted: false, pass: true })),
    scans: plan.scanInputs.map(row => ({ jarSha256: row.sha256, bytes: row.bytes, fixedProtected: true, officialProtected: true, classLoaded: false, pass: true })),
    scanInputChecks: plan.scanInputs.map(row => ({ jarSha256: row.sha256, exists: true, file: true, readable: true,
      expectedBytes: row.bytes, actualBytes: row.bytes, actualSha256: row.sha256 })),
    scanDirectory: { targetInternalFilesDirectory: true, exists: true, directory: true, readable: true, searchable: true },
    completed: true, passed: true, cleanup: { ownedTemporaryFilesRemoved: true, capturedInputsUnmodified: true, artifactClassesLoaded: false, thirdPartyNativeExecuted: false } };
  return { report, plan, metadata };
}

test('ART collector requires exact pinned methods, both real App arguments, every fixture and all scan bytes', () => {
  const f = resultFixture();
  assert.equal(verifyFixedMethodResult(f.report, f.plan, f.metadata).ok, true);
  const mutations = [
    report => { report.source = { methodHash: hash('different source') }; },
    report => { report.planSha256 = hash('old result'); },
    report => { report.bindings.pop(); },
    report => { report.bindings[1].fixed = true; },
    report => { report.bindings[3].fixedFieldBound = false; },
    report => { report.bindings[2].fixedContextMatchesTargetApplication = false; },
    report => { report.targetApplication.uid++; },
    report => { report.targetDexNativeAbsentAfter = false; },
    report => { report.scans[0].classLoaded = true; },
    report => { report.scans[0].jarSha256 = hash('different JAR'); },
    report => { report.scanInputChecks[0].readable = false; },
    report => { report.scanInputChecks[0].actualBytes--; },
    report => { report.scanInputChecks[0].actualSha256 = hash('wrong received copy'); },
    report => { report.cleanup.ownedTemporaryFilesRemoved = false; },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(f.report); mutate(changed);
    assert.throws(() => verifyFixedMethodResult(changed, f.plan, f.metadata), /FIXED_ART_RUN_/);
  }
});

test('internal input transport obtains the exact installed target UID instead of hardcoding it', () => {
  assert.equal(packageUid('package:com.github.tvbox.osc.jun uid:10166\n'), 10166);
  assert.equal(packageUid('package:com.example.other uid:10444\npackage:com.github.tvbox.osc.jun uid:10289\n'), 10289);
  for (const text of ['package:com.example.other uid:10166', 'package:com.github.tvbox.osc.jun uid:0',
    'package:com.github.tvbox.osc.jun uid:10166\npackage:com.github.tvbox.osc.jun uid:10289']) assert.throws(() => packageUid(text), /FIXED_ART_RUN_TARGET_UID/);
});

test('old success cannot survive a failed retry: a nonempty output rejects before input reads or adb', async t => {
  const out = await mkdtemp(join(tmpdir(), 'tvbox-fixed-art-output-test-'));
  t.after(() => rm(out, { recursive: true, force: true }));
  await requireEmptyOutput(out);
  const oldSuccess = '{"passed":true,"from":"old run"}\n';
  await writeFile(join(out, 'art-method-results.json'), oldSuccess);
  await assert.rejects(runFixedMethodProbe({ out, directory: '/not-an-input', build: '/not-a-build', adb: '/must-not-run-adb' }), /FIXED_ART_RUN_OUTPUT_NOT_EMPTY/);
  assert.equal(await readFile(join(out, 'art-method-results.json'), 'utf8'), oldSuccess);
  await rm(join(out, 'art-method-results.json'));
  await writeFile(join(out, 'instrumentation.txt'), 'old failed run');
  await assert.rejects(requireEmptyOutput(out), /FIXED_ART_RUN_OUTPUT_NOT_EMPTY/);
});
