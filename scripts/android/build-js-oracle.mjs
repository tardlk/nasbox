// SPDX-License-Identifier: GPL-3.0-only
// No downloads or package installation. Requires an existing Android SDK/JDK.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectJsSymbols } from './js-apk-symbol-map.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf('--' + name);
  return index < 0 ? fallback : args[index + 1];
};
const sdk = resolve(option('sdk', join(root, '.tools/android-sdk')));
const java = resolve(option('java', join(root, '.tools/jdk17')));
const buildTools = join(sdk, 'build-tools', option('build-tools', '35.0.0'));
const androidJar = join(sdk, 'platforms', option('platform', 'android-33'), 'android.jar');
const keystore = resolve(option('keystore', join(root, '.cache/android-parity/source-design/TVBoxOSC.jks')));
const originalApk = option('target-apk');
if (!originalApk) throw new Error('--target-apk is required to verify same-certificate instrumentation eligibility');
const output = resolve(option('out', join(root, '.cache/js-business/art/build')));
const expectedSignerSha256 = '4b9421de6d46778f6280b180179413fa6973845f0a0132c00f6800c06464e051';
const hash = value => createHash('sha256').update(value).digest('hex');

function run(program, parameters, { binary = false } = {}) {
  const value = spawnSync(program, parameters, {
    cwd: root, env: { ...process.env, JAVA_HOME: java, PATH: join(java, 'bin') + ':' + process.env.PATH },
    encoding: binary ? null : 'utf8', maxBuffer: 16 * 1024 * 1024,
  });
  if (value.error) throw value.error;
  if (value.status !== 0) throw new Error(`${program} failed: ${String(value.stderr || value.stdout).slice(-4000)}`);
  return value.stdout;
}

await Promise.all([readFile(androidJar), readFile(keystore), readFile(originalApk)]);
const originalBytes = await readFile(originalApk);
const officialCertificate = run(join(buildTools, 'apksigner'), ['verify', '--print-certs', resolve(originalApk)]);
const officialSha256 = officialCertificate.match(/Signer #1 certificate SHA-256 digest:\s*([a-fA-F0-9]+)/)?.[1].toLowerCase();
if (officialSha256 !== expectedSignerSha256) throw new Error('Original APK signer does not match the pinned upstream public build certificate');
const exportedCertificate = run(join(java, 'bin/keytool'), ['-exportcert', '-alias', 'TVBoxOSC', '-keystore', keystore, '-storepass', 'TVBoxOSC'], { binary: true });
if (hash(exportedCertificate) !== officialSha256) throw new Error('Instrumentation signing certificate differs from the original APK');

await mkdir(output, { recursive: true });
const symbolMap = await inspectJsSymbols({ apk: resolve(originalApk), java, output });
const symbolPath = join(output, 'js-symbol-map.json');
await writeFile(symbolPath, JSON.stringify(symbolMap, null, 2) + '\n');
const classes = join(output, 'classes'), dex = join(output, 'dex');
await rm(classes, { recursive: true, force: true });
await rm(dex, { recursive: true, force: true });
await mkdir(classes); await mkdir(dex);
const source = join(root, 'scripts/android/JsOracleInstrumentation.java');
const manifest = join(root, 'scripts/android/AndroidJsManifest.xml');
run(join(java, 'bin/javac'), ['-source', '8', '-target', '8', '-encoding', 'UTF-8', '-cp', androidJar, '-d', classes, source]);
async function classFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? classFiles(join(directory, entry.name)) : entry.name.endsWith('.class') ? [join(directory, entry.name)] : []))).flat();
}
run(join(buildTools, 'd8'), ['--min-api', '21', '--lib', androidJar, '--output', dex, ...await classFiles(classes)]);
const unsigned = join(output, 'oracle-unsigned.apk');
const aligned = join(output, 'oracle-aligned.apk');
const signed = join(output, 'tvbox-art-js-oracle.apk');
run(join(buildTools, 'aapt2'), ['link', '-I', androidJar, '--manifest', manifest, '-o', unsigned]);
run(join(java, 'bin/jar'), ['uf', unsigned, '-C', dex, 'classes.dex']);
const assets = join(output, 'assets');
await mkdir(assets, { recursive: true });
await writeFile(join(assets, 'js-symbol-map.json'), await readFile(symbolPath));
run(join(java, 'bin/jar'), ['uf', unsigned, '-C', output, 'assets/js-symbol-map.json']);
run(join(buildTools, 'zipalign'), ['-f', '4', unsigned, aligned]);
run(join(buildTools, 'apksigner'), ['sign', '--ks', keystore, '--ks-key-alias', 'TVBoxOSC', '--ks-pass', 'pass:TVBoxOSC', '--key-pass', 'pass:TVBoxOSC', '--out', signed, aligned]);
const signedCertificate = run(join(buildTools, 'apksigner'), ['verify', '--print-certs', signed]);
if (!signedCertificate.includes(expectedSignerSha256)) throw new Error('Signed instrumentation certificate verification failed');
if (hash(await readFile(originalApk)) !== hash(originalBytes)) throw new Error('Original APK changed during instrumentation build');
const metadata = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  kind: 'Separate same-signature JS Android instrumentation APK; original upstream APK unchanged',
  packageName: 'com.github.tvbox.parity.jsoracle',
  targetPackage: 'com.github.tvbox.osc.jun',
  targetApk: { path: resolve(originalApk), sha256: hash(originalBytes), bytes: originalBytes.length, originalUnmodified: true },
  instrumentationApk: { path: signed, sha256: hash(await readFile(signed)), bytes: (await readFile(signed)).length },
  symbolMap: { sha256: hash(await readFile(symbolPath)), apkHashBound: true, staticEvidence: symbolMap.evidence },
  signing: {
    certificateSha256: expectedSignerSha256,
    certificateMatchesOfficialApk: true,
    publicUpstreamBuildKey: true,
    keystoreSha256: hash(await readFile(keystore)),
    sourceCommit: 'd5f500677a4da15c5836477352030d9ebb5cb37a',
    keySource: 'https://github.com/q215613905/TVBoxOS/blob/d5f500677a4da15c5836477352030d9ebb5cb37a/.github/workflows/TVBoxOSC.jks',
    publicBuildWorkflow: 'https://github.com/q215613905/TVBoxOS/blob/d5f500677a4da15c5836477352030d9ebb5cb37a/.github/workflows/test.yml',
  },
  source: { javaSha256: hash(await readFile(source)), manifestSha256: hash(await readFile(manifest)), buildScriptSha256: hash(await readFile(fileURLToPath(import.meta.url))), symbolInspectorSha256: hash(await readFile(join(root, 'scripts/android/js-apk-symbol-map.mjs'))) },
};
await writeFile(join(output, 'build-metadata.json'), JSON.stringify(metadata, null, 2) + '\n');
await Promise.all([rm(classes, { recursive: true }), rm(dex, { recursive: true }), rm(unsigned), rm(aligned)]);
console.log(JSON.stringify(metadata));
