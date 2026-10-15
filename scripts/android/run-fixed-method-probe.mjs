// SPDX-License-Identifier: GPL-3.0-only
// Explicit execution entry point; never creates/starts an emulator or HTTP service.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { verifyCatalogFreeze } from '../compat/freeze-catalog.mjs';

const SELF = fileURLToPath(import.meta.url), hash = bytes => createHash('sha256').update(bytes).digest('hex');
const check = (value, code) => { if (!value) throw new Error('FIXED_ART_RUN_' + code); };

export function packageUid(text, packageName = 'com.github.tvbox.osc.jun') {
  const rows = text.trim().split(/\r?\n/).map(line => /^package:([A-Za-z0-9_.]+)\s+uid:(\d+)\s*$/.exec(line)).filter(row => row?.[1] === packageName);
  check(rows.length === 1, 'TARGET_UID');
  const uid = Number(rows[0][2]); check(Number.isSafeInteger(uid) && uid >= 10000 && uid <= 999999, 'TARGET_UID'); return uid;
}

export async function requireEmptyOutput(path) {
  const output = resolve(path), info = await lstat(output).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
  check(!info || info.isDirectory() && !info.isSymbolicLink(), 'OUTPUT_PATH');
  check(!info || (await readdir(output)).length === 0, 'OUTPUT_NOT_EMPTY');
  await mkdir(output, { recursive: true, mode: 0o700 });
  return output;
}

/** A successful process/declared pass is insufficient without every expected case and source pin. */
export function verifyFixedMethodResult(report, plan, metadata) {
  check(report?.schemaVersion === 1 && report.planSha256 === metadata.planSha256
    && report.targetApkSha256 === metadata.targetApkSha256
    && report.instrumentationApkSha256 === metadata.instrumentationApk.sha256
    && isDeepStrictEqual(report.source, plan.source)
    && isDeepStrictEqual(report.officialMethodEvidence, plan.officialMethodEvidence), 'RESULT_IDENTITY');
  check(report.targetDexNativeAbsentBefore === true && report.targetDexNativeAbsentAfter === true
    && report.targetApplication?.class === 'com.github.tvbox.osc.base.App'
    && report.targetApplication?.packageName === plan.targetPackage
    && report.targetApplication?.uid === report.applicationUid
    && report.targetApplication?.classloaderMatchesTarget === true
    && report.targetApplication?.sameInstanceForBothMethodPaths === true
    && Number.isSafeInteger(report.applicationPid) && report.applicationPid > 1
    && Number.isSafeInteger(report.androidSdk) && report.androidSdk >= 21, 'TARGET_APPLICATION');
  check(Array.isArray(report.bindings) && report.bindings.length === plan.cases.length
    && Array.isArray(report.scans) && report.scans.length === plan.scanInputs.length
    && Array.isArray(report.scanInputChecks) && report.scanInputChecks.length === plan.scanInputs.length, 'RESULT_COVERAGE');
  check(report.scanDirectory?.targetInternalFilesDirectory === true && report.scanDirectory.exists === true
    && report.scanDirectory.directory === true && report.scanDirectory.readable === true && report.scanDirectory.searchable === true, 'INTERNAL_SCAN_DIRECTORY');
  const seen = new Set();
  for (const result of report.bindings) {
    const expected = plan.cases.find(row => row.id === result.id);
    check(expected && !seen.has(result.id) && expected.sha256 === result.fixtureSha256, 'FIXTURE_IDENTITY'); seen.add(result.id);
    check(result.fixed === expected.expectedFixed && result.official === expected.expectedOfficial
      && result.expectedFixed === expected.expectedFixed && result.expectedOfficial === expected.expectedOfficial
      && result.fixedFieldBound === expected.expectedFieldBound && result.officialFieldBound === expected.expectedFieldBound
      && result.fixedContextMatchesTargetApplication === true && result.officialContextMatchesTargetApplication === true
      && result.classloaderIsolated === true && result.nativeExecuted === false && result.pass === true, 'FIXTURE_RESULT');
  }
  seen.clear();
  for (const result of report.scanInputChecks) {
    const expected = plan.scanInputs.find(row => row.sha256 === result.jarSha256);
    check(expected && !seen.has(result.jarSha256) && result.exists === true && result.file === true && result.readable === true
      && result.actualBytes === expected.bytes && result.expectedBytes === expected.bytes && result.actualSha256 === expected.sha256, 'SCAN_INPUT_IDENTITY');
    seen.add(result.jarSha256);
  }
  seen.clear();
  for (const result of report.scans) {
    const expected = plan.scanInputs.find(row => row.sha256 === result.jarSha256);
    check(expected && !seen.has(result.jarSha256) && result.bytes === expected.bytes, 'SCAN_IDENTITY'); seen.add(result.jarSha256);
    check(result.fixedProtected === true && result.officialProtected === true && result.classLoaded === false && result.pass === true, 'SCAN_RESULT');
  }
  check(report.completed === true && report.passed === true
    && report.cleanup?.ownedTemporaryFilesRemoved === true
    && report.cleanup?.capturedInputsUnmodified === true
    && report.cleanup?.artifactClassesLoaded === false && report.cleanup?.thirdPartyNativeExecuted === false, 'COMPLETION');
  return { ok: true, bindingCases: report.bindings.length, staticScanCases: report.scans.length,
    missingDexNativeFixed: report.bindings.find(row => row.id === 'missing-dex-native')?.fixed,
    missingDexNativeOfficial: report.bindings.find(row => row.id === 'missing-dex-native')?.official };
}

export async function runFixedMethodProbe({ directory, build, out, adb, serial = 'emulator-5554' } = {}) {
  // A failed retry must never leave an earlier successful report at this path.
  // Reject before input work and, critically, before any adb invocation.
  const capture = resolve(directory), buildRoot = resolve(build), output = resolve(out);
  check(output !== capture && !output.startsWith(capture + '/'), 'OUTPUT_INSIDE_CAPTURE');
  await requireEmptyOutput(output);
  await verifyCatalogFreeze({ directory });
  check(typeof serial === 'string' && /^[A-Za-z0-9_.:-]+$/.test(serial), 'SERIAL');
  const metadata = JSON.parse(await readFile(join(buildRoot, 'build-metadata.json')));
  const planBytes = await readFile(join(buildRoot, 'fixed-method-plan.json')), plan = JSON.parse(planBytes);
  check(hash(planBytes) === metadata.planSha256 && plan.targetApkSha256 === metadata.targetApkSha256, 'PLAN');
  const apk = join(buildRoot, 'tvbox-fixed-method-probe.apk');
  check(hash(await readFile(apk)) === metadata.instrumentationApk.sha256, 'APK');
  for (const input of plan.scanInputs) {
    check(/^[a-f0-9]{64}$/.test(input.sha256), 'SCAN_SHA');
    const bytes = await readFile(join(capture, 'artifacts', input.sha256 + '.jar'));
    check(hash(bytes) === input.sha256 && bytes.length === input.bytes, 'SCAN_BYTES');
  }
  const lock = join(output, '.running');
  await writeFile(lock, String(process.pid), { flag: 'wx', mode: 0o600 });
  const deviceRoot = '/data/user/0/com.github.tvbox.osc.jun/files/fixed-method-inputs-' + metadata.planSha256.slice(0, 12);
  const deviceResult = '/sdcard/Android/data/com.github.tvbox.osc.jun/files/fixed-method-probe/result.json';
  const command = (args, timeout = 30000) => spawnSync(resolve(adb), ['-s', serial, ...args], { encoding: 'utf8',
    timeout, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, ADB_MDNS: '0' } });
  const required = (args, timeout) => { const result = command(args, timeout); check(!result.error && result.status === 0, 'ADB_COMMAND'); return result.stdout; };
  const cleanup = {};
  let report, instrumentText;
  try {
    required(['install', '-r', apk]);
    required(['shell', 'am', 'force-stop', plan.targetPackage]);
    check(required(['shell', 'id', '-u']).trim() === '0', 'ROOT_TRANSPORT_REQUIRED');
    const targetUid = packageUid(required(['shell', 'cmd', 'package', 'list', 'packages', '-U', plan.targetPackage]), plan.targetPackage);
    required(['shell', 'mkdir', '-p', deviceRoot]);
    required(['shell', 'chmod', '755', deviceRoot]);
    required(['shell', 'rm', '-f', deviceResult]);
    for (const input of plan.scanInputs) {
      required(['push', join(capture, 'artifacts', input.sha256 + '.jar'), deviceRoot + '/' + input.sha256 + '.jar']);
      required(['shell', 'chmod', '644', deviceRoot + '/' + input.sha256 + '.jar']);
    }
    required(['shell', 'chown', '-R', targetUid + ':' + targetUid, deviceRoot]);
    required(['shell', 'restorecon', '-R', deviceRoot]);
    const transportAudit = [];
    for (const input of plan.scanInputs) {
      const text = required(['shell', 'su', String(targetUid), 'sha256sum', deviceRoot + '/' + input.sha256 + '.jar']);
      check(text.trim().split(/\s+/)[0] === input.sha256, 'TARGET_UID_CANNOT_READ_INPUT');
      transportAudit.push({ sha256: input.sha256, appUidReadVerified: true });
    }
    await writeFile(join(output, 'transport-audit.json'), JSON.stringify({ kind: 'root transport into task-only internal app files; ownership and SELinux label restored before ordinary app-UID scan',
      targetUid, deviceRootSha256: hash(deviceRoot), inputs: transportAudit }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    const result = command(['shell', 'am', 'instrument', '-w', '-r', '-e', 'planSha256', metadata.planSha256,
      '-e', 'scanDirectory', deviceRoot, 'com.github.tvbox.parity.fixed/com.github.tvbox.parity.fixed.FixedMethodInstrumentation'], 120000);
    instrumentText = String(result.stdout || '') + String(result.stderr || '');
    await writeFile(join(output, 'instrumentation.txt'), instrumentText, { flag: 'wx', mode: 0o600 });
    check(!result.error && result.status === 0 && /^INSTRUMENTATION_CODE: -1\s*$/m.test(instrumentText), 'INSTRUMENTATION');
    const encoded = /^INSTRUMENTATION_RESULT: report=(.*)$/m.exec(instrumentText);
    check(encoded, 'REPORT_MISSING'); report = JSON.parse(encoded[1]);
    const summary = verifyFixedMethodResult(report, plan, metadata);
    const pending = join(output, '.pulled-result.json');
    try {
      required(['pull', deviceResult, pending]);
      const pulled = JSON.parse(await readFile(pending));
      check(isDeepStrictEqual(pulled, report), 'PULLED_RESULT_IDENTITY');
    } finally { await rm(pending, { force: true }); }
    await verifyCatalogFreeze({ directory });
    await writeFile(join(output, 'art-method-results.json'), JSON.stringify({ ...report, runner: {
      sha256: hash(await readFile(SELF)), metadataSha256: hash(await readFile(join(buildRoot, 'build-metadata.json'))), verifiedSummary: summary,
    } }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    return { ...summary, planSha256: metadata.planSha256, targetApkSha256: metadata.targetApkSha256,
      instrumentationApkSha256: metadata.instrumentationApk.sha256 };
  } finally {
    const stopped = command(['shell', 'am', 'force-stop', plan.targetPackage]); cleanup.targetForcedStopped = !stopped.error && stopped.status === 0;
    const removed = command(['shell', 'rm', '-f', ...plan.scanInputs.map(input => deviceRoot + '/' + input.sha256 + '.jar'), deviceResult]);
    cleanup.deviceInputCopiesRemoved = !removed.error && removed.status === 0;
    command(['shell', 'rmdir', deviceRoot]); command(['shell', 'rmdir', '/sdcard/Android/data/com.github.tvbox.osc.jun/files/fixed-method-probe']);
    cleanup.instrumentationPackageRetained = 'com.github.tvbox.parity.fixed';
    await writeFile(join(output, 'runner-cleanup.json'), JSON.stringify(cleanup, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await rm(lock, { force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === SELF) {
  const args = process.argv.slice(2), options = {};
  for (let index = 0; index < args.length; index += 2) { check(args[index]?.startsWith('--') && args[index + 1], 'CLI_ARGUMENT'); options[args[index]] = args[index + 1]; }
  runFixedMethodProbe({ directory: options['--directory'], build: options['--build'], out: options['--out'], adb: options['--adb'], serial: options['--serial'] })
    .then(result => process.stdout.write(JSON.stringify(result) + '\n'))
    .catch(error => { process.stderr.write(JSON.stringify({ ok: false, errorCode: /^FIXED_ART_RUN_[A-Z_]+$/.test(error.message) ? error.message : 'FIXED_ART_RUN_INPUT_OR_IO', fingerprint: hash(String(error.message)) }) + '\n'); process.exitCode = 1; });
}
