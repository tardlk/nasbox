// SPDX-License-Identifier: GPL-3.0-only
// Prepare only: existing SDK/JDK/key, no adb, emulator, network, or services.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyReference } from '../compat/reference.mjs';
import { verifyPlatformReference } from '../compat/platform-reference.mjs';
import { extractMethod } from '../compat/oracle.mjs';
import { inspectProtectedArtifacts } from '../compat/protected-init-static.mjs';
import { dexInventory, zipEntries } from '../compat/artifact-inspect.mjs';

const SELF = fileURLToPath(import.meta.url), ROOT = resolve(dirname(SELF), '../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const check = (value, code) => { if (!value) throw new Error('FIXED_ART_BUILD_' + code); };
export const protectedProbeSha256 = [
  '65be8df8bfa60f59aecb3c170d5cc0fd3feeaa96daad531faa97d49aff81eab4',
  'a9dce1158db8c7d469399917468f91fcc9dbdd8260d56f32aa5c1e7a5f293ed6',
  'a41f11e12267d0840eb8c949a59e5709d6a6f8fc42c86d845a7dad4be51a4fa1',
];
const officialApkSha256 = '5fb63e491f280c0e271091da5490fcdf0923d6c2f8773ef03553b20a333db657';
const officialCertificateSha256 = '4b9421de6d46778f6280b180179413fa6973845f0a0132c00f6800c06464e051';
const fixedPath = 'app/src/main/java/com/github/catvod/crawler/ProtectedInitJar.java';
const methodSignatures = {
  bindDexLoader: 'private boolean bindDexLoader(Class<?> clz, Object init)',
  scan: 'private static boolean scan(String jar, String packageName)',
};

/** Namespace rebinding is the complete transform; method source bytes stay identical. */
export function transformFixedSource(source) {
  const oldPackage = 'package com.github.catvod.crawler;', newPackage = 'package com.github.tvbox.parity.fixed;';
  const oldApp = 'import com.github.tvbox.osc.base.App;', newApp = 'import com.github.tvbox.parity.fixed.binding.App;';
  check(source.split(oldPackage).length === 2 && source.split('class ProtectedInitJar {').length === 2 && source.split(oldApp).length === 2, 'SOURCE_LAYOUT');
  const transformed = source.replace(oldPackage, newPackage).replace('class ProtectedInitJar {', 'class FixedProtectedInitJar {').replace(oldApp, newApp);
  const methods = {};
  for (const [name, signature] of Object.entries(methodSignatures)) {
    const original = extractMethod(source, signature), copied = extractMethod(transformed, signature);
    check(original === copied, 'METHOD_CHANGED');
    methods[name] = { signature, sourceSha256: hash(original), sourceBytes: Buffer.byteLength(original), copiedMethodUnchanged: true };
  }
  check(transformed.replace(newPackage, oldPackage).replace('class FixedProtectedInitJar {', 'class ProtectedInitJar {').replace(newApp, oldApp) === source, 'UNDECLARED_TRANSFORM');
  return { source: transformed, metadata: { sourceSha256: hash(source), transformedSourceSha256: hash(transformed),
    transform: 'Only class namespaces are rebound: package com.github.catvod.crawler -> com.github.tvbox.parity.fixed; class ProtectedInitJar -> FixedProtectedInitJar; App import com.github.tvbox.osc.base.App -> com.github.tvbox.parity.fixed.binding.App. Fields, method signatures and complete method bodies remain byte-identical. The App namespace bridge returns the unchanged target process Application instance because R8 removed the official App.getInstance method.', methods } };
}

export function ownedCaseDefinitions() {
  return [
    { id: 'init-null', nullInit: true, hasDexNative: false, returnLoader: false, hasLoaderField: true, expectedFixed: false, expectedOfficial: false, expectedFieldBound: false },
    { id: 'missing-dex-native', nullInit: false, hasDexNative: false, returnLoader: false, hasLoaderField: true, expectedFixed: false, expectedOfficial: true, expectedFieldBound: false },
    { id: 'loader-null', nullInit: false, hasDexNative: true, returnLoader: false, hasLoaderField: true, expectedFixed: false, expectedOfficial: false, expectedFieldBound: false },
    { id: 'loader-field', nullInit: false, hasDexNative: true, returnLoader: true, hasLoaderField: true, expectedFixed: true, expectedOfficial: true, expectedFieldBound: true },
    { id: 'loader-no-field', nullInit: false, hasDexNative: true, returnLoader: true, hasLoaderField: false, expectedFixed: false, expectedOfficial: false, expectedFieldBound: false },
  ];
}

export function ownedFixtureSources(spec) {
  const sources = { 'com/github/tvbox/parity/fixture/Init.java': 'package com.github.tvbox.parity.fixture;public class Init extends Base {public Init(){}}',
    'com/github/tvbox/parity/fixture/Base.java': 'package com.github.tvbox.parity.fixture;public class Base {' + (spec.hasLoaderField ? 'private dalvik.system.DexClassLoader inheritedLoader;' : 'public android.content.Context c;') + '}' };
  if (spec.hasDexNative) sources['com/github/catvod/spider/DexNative.java'] = 'package com.github.catvod.spider;public class DexNative {public static Object value;public static Object lastContext;public static Object getLoader(Object context){lastContext=context;return value;}}';
  return sources;
}

async function writeSources(root, sources) {
  const files = [];
  for (const [file, text] of Object.entries(sources)) { const path = join(root, file); await mkdir(dirname(path), { recursive: true }); await writeFile(path, text, { mode: 0o600 }); files.push(path); }
  return files;
}
async function classes(directory) {
  const out = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) out.push(...await classes(join(directory, entry.name)));
    else if (entry.name.endsWith('.class')) out.push(join(directory, entry.name));
  }
  return out.sort();
}

export async function buildFixedMethodProbe({
  directory, targetApk, keystore, out,
  sdk = join(ROOT, '.tools/android-sdk'), java = join(ROOT, '.tools/jdk17'),
  platform = 'android-33', buildToolsVersion = '35.0.0',
} = {}) {
  const primary = verifyReference(), extra = verifyPlatformReference();
  const source = await readFile(join(extra.extra, fixedPath), 'utf8'), transformed = transformFixedSource(source);
  const original = await readFile(targetApk); check(hash(original) === officialApkSha256, 'TARGET_APK');
  const output = resolve(out), capture = resolve(directory);
  check(output !== capture && !output.startsWith(capture + '/'), 'OUTPUT_INSIDE_CAPTURE');
  check(!await stat(join(output, 'build-metadata.json')).catch(error => { if (error.code !== 'ENOENT') throw error; return null; }), 'OUTPUT_EXISTS');
  const buildTools = join(resolve(sdk), 'build-tools', buildToolsVersion), androidJar = join(resolve(sdk), 'platforms', platform, 'android.jar');
  const run = (program, parameters, binary = false) => {
    const result = spawnSync(program, parameters, { cwd: ROOT, encoding: binary ? null : 'utf8',
      env: { ...process.env, JAVA_HOME: resolve(java), PATH: join(resolve(java), 'bin') + ':' + (process.env.PATH || '') },
      timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
    check(!result.error && result.status === 0, 'TOOL_PROCESS'); return result.stdout;
  };
  await Promise.all([readFile(androidJar), readFile(keystore), readFile(join(buildTools, 'd8')), readFile(join(java, 'bin/javac'))]);
  const signer = run(join(buildTools, 'apksigner'), ['verify', '--print-certs', resolve(targetApk)]);
  check(signer.match(/Signer #1 certificate SHA-256 digest:\s*([a-fA-F0-9]+)/)?.[1].toLowerCase() === officialCertificateSha256, 'TARGET_CERTIFICATE');
  const keyCertificate = run(join(java, 'bin/keytool'), ['-exportcert', '-alias', 'TVBoxOSC', '-keystore', resolve(keystore), '-storepass', 'TVBoxOSC'], true);
  check(hash(keyCertificate) === officialCertificateSha256, 'SAME_CERTIFICATE');
  await mkdir(output, { recursive: true, mode: 0o700 });
  const scratch = await mkdtemp(join(output, '.build-'));
  try {
    const staticEvidence = await inspectProtectedArtifacts({ directory, sha256: protectedProbeSha256, apk: targetApk, java });
    const official = staticEvidence.officialApk.classes.find(row => row.descriptor === 'Lcom/github/catvod/crawler/ProtectedInitJar;');
    check(official && !staticEvidence.officialApk.dexNativeDefined, 'OFFICIAL_CLASS');
    const officialBind = official.methods.find(row => row.signature === 'bindDexLoader(Ljava/lang/Class;Ljava/lang/Object;)Z');
    const officialScan = official.methods.find(row => row.signature === 'scan(Ljava/lang/String;Ljava/lang/String;)Z');
    check(officialBind?.bodySha256 === '1935a6a7f2375d5ff9432b58c08a97552f55a5bdde15a49c91dcd9c360874e31'
      && officialBind.classNotFoundCatchDirectReturns.length === 1 && officialBind.classNotFoundCatchDirectReturns[0] === true && officialScan, 'OFFICIAL_METHOD_BODY');
    const fixtureAssets = join(scratch, 'assets/fixtures'); await mkdir(fixtureAssets, { recursive: true });
    const cases = [];
    for (const spec of ownedCaseDefinitions()) {
      const base = join(scratch, 'fixtures', spec.id), classRoot = join(base, 'classes'), dexRoot = join(base, 'dex');
      await mkdir(classRoot, { recursive: true }); await mkdir(dexRoot);
      const sources = ownedFixtureSources(spec), files = await writeSources(join(base, 'src'), sources);
      run(join(java, 'bin/javac'), ['-source', '8', '-target', '8', '-encoding', 'UTF-8', '-cp', androidJar, '-d', classRoot, ...files]);
      run(join(buildTools, 'd8'), ['--min-api', '21', '--lib', androidJar, '--output', dexRoot, ...await classes(classRoot)]);
      const dex = await readFile(join(dexRoot, 'classes.dex')), inventory = dexInventory(dex);
      check(inventory.classes.length === (spec.hasDexNative ? 3 : 2)
        && inventory.classes.includes('Lcom/github/catvod/spider/DexNative;') === spec.hasDexNative, 'FIXTURE_DEX_CLASSES');
      const jar = join(fixtureAssets, spec.id + '.jar');
      run(join(java, 'bin/jar'), ['cf', jar, '-C', dexRoot, 'classes.dex']);
      const bytes = await readFile(jar);
      cases.push({ ...spec, asset: 'fixtures/' + spec.id + '.jar', sha256: hash(bytes), bytes: bytes.length,
        dexSha256: hash(dex), classes: inventory.classes,
        sources: Object.entries(sources).map(([file, text]) => ({ file, sha256: hash(text) })) });
    }
    const sourceMetadata = { commit: primary.commit, path: fixedPath, ...transformed.metadata,
      licenseSha256: extra.additional.files.find(row => row.path === 'LICENSE').sha256,
      appBinding: { officialGetInstanceOptimizedOut: true, officialAppMethods: staticEvidence.officialApk.appClasses.flatMap(row => row.methods.map(method => method.signature)),
        strategy: 'The only App class change is import namespace rebinding. Owned App.getInstance returns the exact target Application supplied by instrumentation; each fixture getLoader argument is checked against that same instance on both fixed and official paths.' } };
    const plan = { schemaVersion: 1, targetPackage: 'com.github.tvbox.osc.jun', targetApkSha256: officialApkSha256,
      officialClass: 'com.github.catvod.crawler.ProtectedInitJar', source: sourceMetadata,
      officialMethodEvidence: { bindDexLoaderBodySha256: officialBind.bodySha256, scanBodySha256: officialScan.bodySha256,
        staticOnly: true, apkHashBound: true, classNotFoundCatchReturnsTrue: true },
      cases, scanInputs: staticEvidence.artifacts.map(row => ({ sha256: row.sha256, bytes: row.bytes, expectedProtected: true })),
      scope: 'Prepared ART method inputs; no execution has occurred. Owned DEX fixtures are isolated child classloaders; captured JAR classes are never loaded.' };
    const planBytes = Buffer.from(JSON.stringify(plan, null, 2) + '\n');
    await writeFile(join(scratch, 'assets/fixed-method-plan.json'), planBytes, { mode: 0o600 });
    await writeFile(join(scratch, 'assets/UPSTREAM-LICENSE.txt'), await readFile(join(extra.extra, 'LICENSE')), { mode: 0o600 });
    const programClasses = join(scratch, 'program-classes'), dexRoot = join(scratch, 'program-dex');
    await mkdir(programClasses); await mkdir(dexRoot);
    const copied = await writeSources(join(scratch, 'src'), {
      'com/github/tvbox/parity/fixed/FixedProtectedInitJar.java': transformed.source,
      'com/github/tvbox/parity/fixed/binding/App.java': 'package com.github.tvbox.parity.fixed.binding;public final class App {'
        + 'private static android.app.Application instance;public static void bind(android.app.Application app){if(app==null)throw new IllegalArgumentException("target App missing");instance=app;}'
        + 'public static android.app.Application getInstance(){if(instance==null)throw new IllegalStateException("target App unbound");return instance;}}',
    });
    const instrumentationSource = join(ROOT, 'scripts/android/FixedMethodInstrumentation.java');
    run(join(java, 'bin/javac'), ['-source', '8', '-target', '8', '-encoding', 'UTF-8', '-cp', androidJar, '-d', programClasses, instrumentationSource, ...copied]);
    run(join(buildTools, 'd8'), ['--min-api', '21', '--lib', androidJar, '--output', dexRoot, ...await classes(programClasses)]);
    const mainDex = await readFile(join(dexRoot, 'classes.dex')), inventory = dexInventory(mainDex);
    check(inventory.classes.length >= 4 && inventory.classes.every(name => name.startsWith('Lcom/github/tvbox/parity/fixed/'))
      && !inventory.classes.includes('Lcom/github/tvbox/osc/base/App;') && !inventory.classes.includes('Lcom/github/catvod/spider/DexNative;'), 'APK_CLASSLOADER_POLLUTION');
    const manifest = join(ROOT, 'scripts/android/AndroidFixedMethodManifest.xml'), unsigned = join(scratch, 'unsigned.apk'), aligned = join(scratch, 'aligned.apk');
    const signed = join(output, 'tvbox-fixed-method-probe.apk');
    run(join(buildTools, 'aapt2'), ['link', '-I', androidJar, '--manifest', manifest, '-o', unsigned]);
    run(join(java, 'bin/jar'), ['uf', unsigned, '-C', dexRoot, 'classes.dex', '-C', scratch, 'assets']);
    run(join(buildTools, 'zipalign'), ['-f', '4', unsigned, aligned]);
    run(join(buildTools, 'apksigner'), ['sign', '--ks', resolve(keystore), '--ks-key-alias', 'TVBoxOSC', '--ks-pass', 'pass:TVBoxOSC', '--key-pass', 'pass:TVBoxOSC', '--out', signed, aligned]);
    const signedCert = run(join(buildTools, 'apksigner'), ['verify', '--print-certs', signed]);
    check(signedCert.includes(officialCertificateSha256), 'SIGNED_CERTIFICATE');
    check(hash(await readFile(targetApk)) === officialApkSha256, 'TARGET_APK_MODIFIED');
    const apkBytes = await readFile(signed), entries = zipEntries(apkBytes);
    for (const spec of cases) check(entries.some(entry => entry.name === 'assets/' + spec.asset && hash(entry.read()) === spec.sha256), 'PACKAGED_FIXTURE');
    const metadata = { schemaVersion: 1, createdAt: new Date().toISOString(), executionStatus: 'prepared-not-executed',
      packageName: 'com.github.tvbox.parity.fixed', targetPackage: 'com.github.tvbox.osc.jun',
      targetApkSha256: officialApkSha256, originalTargetUnmodified: true,
      instrumentationApk: { file: 'tvbox-fixed-method-probe.apk', sha256: hash(apkBytes), bytes: apkBytes.length },
      signerCertificateSha256: officialCertificateSha256, sameCertificateVerified: true,
      publicUpstreamBuildKey: true, keystoreSha256: hash(await readFile(keystore)),
      source: sourceMetadata, planSha256: hash(planBytes), mainDexSha256: hash(mainDex), mainDexClasses: inventory.classes,
      fixtureCount: cases.length, scanInputCount: plan.scanInputs.length,
      sourcePins: { instrumentationSha256: hash(await readFile(instrumentationSource)), manifestSha256: hash(await readFile(manifest)),
        buildScriptSha256: hash(await readFile(SELF)), staticInspectorSha256: hash(await readFile(join(ROOT, 'scripts/compat/protected-init-static.mjs'))) },
      tools: { androidJarSha256: hash(await readFile(androidJar)), dexToolchainFingerprint: staticEvidence.toolchain.dexFingerprint,
        platform, buildToolsVersion },
      cleanup: { temporaryBuildRemoved: true, adbInvoked: false, emulatorStarted: false, servicesStarted: false } };
    await writeFile(join(output, 'fixed-method-plan.json'), planBytes, { flag: 'wx', mode: 0o600 });
    await writeFile(join(output, 'build-metadata.json'), JSON.stringify(metadata, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    return metadata;
  } finally { await rm(scratch, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === SELF) {
  const args = process.argv.slice(2), options = {};
  for (let index = 0; index < args.length; index += 2) { check(args[index]?.startsWith('--') && args[index + 1], 'CLI_ARGUMENT'); options[args[index]] = args[index + 1]; }
  buildFixedMethodProbe({ directory: options['--directory'], targetApk: options['--target-apk'], keystore: options['--keystore'],
    out: options['--out'], sdk: options['--sdk'], java: options['--java'] })
    .then(metadata => process.stdout.write(JSON.stringify(metadata, null, 2) + '\n'))
    .catch(error => { process.stderr.write(JSON.stringify({ errorCode: /^FIXED_ART_BUILD_[A-Z_]+$/.test(error.message) ? error.message : 'FIXED_ART_BUILD_INPUT_OR_IO', fingerprint: hash(String(error.message)) }) + '\n'); process.exitCode = 1; });
}
