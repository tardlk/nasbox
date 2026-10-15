// SPDX-License-Identifier: GPL-3.0-only
// Static bytes only. No captured class is loaded, initialized, or invoked.
import { createDecipheriv, createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyReference } from './reference.mjs';
import { verifyPlatformReference } from './platform-reference.mjs';
import { verifyCatalogFreeze } from './freeze-catalog.mjs';
import { dexToolchain } from '../../backend/spider-runtime/dex/toolchain.mjs';
import { dexInventory, zipEntries } from './artifact-inspect.mjs';

const SELF = fileURLToPath(import.meta.url), ROOT = resolve(dirname(SELF), '../..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const INIT = 'Lcom/github/catvod/spider/Init;', NATIVE = 'Lcom/github/catvod/spider/DexNative;';
const PACKAGE = 'com.github.tvbox.osc.jun';
const checked = (value, code) => { if (!value) throw new Error('PROTECTED_STATIC_' + code); };
const symbol = value => typeof value === 'string' && value.length <= 320 && /^[A-Za-z0-9_/$;()<>.[\]-]+$/.test(value) ? value : 'sha256:' + sha(String(value));

/** Original Whitelist rules, applied only to bytes/string constants, never code. */
export function whitelistMatch(value, packageName = PACKAGE) {
  if (!packageName || !value) return null;
  const contains = text => text.split(',').some(item => item.replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, '') === packageName);
  if (value === packageName || contains(value)) return 'literal';
  if (value.length < 24 || value.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return null;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const rawLength = value.length * 3 / 4 - padding;
  if (rawLength <= 0 || rawLength % 16) return null;
  try {
    const key = Buffer.from('1234123412341234'), decipher = createDecipheriv('aes-128-cbc', key, key);
    const text = Buffer.concat([decipher.update(Buffer.from(value, 'base64')), decipher.final()]).toString('utf8');
    return contains(text) ? 'aes-cbc-whitelist' : null;
  } catch { return null; }
}

/** Fixed scanner's 16-bit-unit search is reproduced explicitly, including its heuristic limits. */
export function inspectProtectionDex(bytes, packageName = PACKAGE) {
  const range = (offset, size) => checked(Number.isSafeInteger(offset) && offset >= 0 && offset + size <= bytes.length, 'DEX_RANGE');
  const u16 = offset => { range(offset, 2); return bytes.readUInt16LE(offset); };
  const u32 = offset => { range(offset, 4); return bytes.readUInt32LE(offset); };
  checked(bytes.length >= 112 && bytes.toString('ascii', 0, 4) === 'dex\n', 'DEX');
  for (const [sizeOffset, offsetOffset, stride, limit] of [[56, 60, 4, 1000000], [64, 68, 4, 65536], [72, 76, 12, 65536],
    [80, 84, 8, 65536], [88, 92, 8, 65536], [96, 100, 32, 65536]]) {
    const size = u32(sizeOffset); checked(size <= limit, 'DEX_COUNT'); range(u32(offsetOffset), size * stride);
  }
  const uleb = cursor => { let result = 0, shift = 0; for (let count = 0; count < 5; count++) { range(cursor[0], 1); const value = bytes[cursor[0]++]; result += (value & 127) * 2 ** shift; if (!(value & 128)) return result; shift += 7; } throw new Error('PROTECTED_STATIC_ULEB'); };
  const strings = Array.from({ length: u32(56) }, (_, index) => { const cursor = [u32(u32(60) + index * 4)]; uleb(cursor); const end = bytes.indexOf(0, cursor[0]); checked(end >= 0, 'DEX_STRING'); return bytes.toString('utf8', cursor[0], end); });
  const types = Array.from({ length: u32(64) }, (_, index) => strings[u32(u32(68) + index * 4)]);
  const proto = index => {
    const offset = u32(76) + index * 12, params = u32(offset + 8), count = params ? u32(params) : 0;
    const arguments_ = Array.from({ length: count }, (_, i) => types[u16(params + 4 + i * 2)]).join('');
    return '(' + arguments_ + ')' + types[u32(offset + 4)];
  };
  const method = index => { const offset = u32(92) + index * 8; return { owner: types[u16(offset)], name: strings[u32(offset + 4)], descriptor: proto(u16(offset + 2)) }; };
  const field = index => { const offset = u32(84) + index * 8; return { owner: types[u16(offset)], type: types[u16(offset + 2)], name: strings[u32(offset + 4)] }; };
  const classCount = u32(96), classOffset = u32(100), initClasses = [], nativeClasses = [];
  let allNativeMethods = 0; const nativeMethodDeclarations = [];
  for (let classIndex = 0; classIndex < classCount; classIndex++) {
    const offset = classOffset + classIndex * 32, descriptor = types[u32(offset)], dataOffset = u32(offset + 24), superIndex = u32(offset + 8);
    const cls = { descriptor: symbol(descriptor), superClass: superIndex === 0xffffffff ? null : symbol(types[superIndex]), fields: [], methods: [], killMatches: [], whitelistMatches: [] };
    const selected = descriptor.startsWith('Lcom/github/catvod/spider/Init') || descriptor === NATIVE;
    if (dataOffset) {
      const cursor = [dataOffset], staticFields = uleb(cursor), instanceFields = uleb(cursor), directMethods = uleb(cursor), virtualMethods = uleb(cursor);
      for (const count of [staticFields, instanceFields]) {
        let index = 0;
        for (let i = 0; i < count; i++) { index += uleb(cursor); const access = uleb(cursor), value = field(index); if (selected) cls.fields.push({ name: symbol(value.name), type: symbol(value.type), access, static: !!(access & 8) }); }
      }
      for (const count of [directMethods, virtualMethods]) {
        let index = 0;
        for (let i = 0; i < count; i++) {
          index += uleb(cursor); const access = uleb(cursor), codeOffset = uleb(cursor), value = method(index);
          if (access & 0x100) { allNativeMethods++; nativeMethodDeclarations.push({ owner: symbol(value.owner), signature: symbol(value.name + value.descriptor), static: !!(access & 8) }); }
          if (!selected) continue;
          const signature = symbol(value.name + value.descriptor);
          const row = { signature, access, static: !!(access & 8), native: !!(access & 0x100), codePresent: codeOffset > 0 };
          cls.methods.push(row);
          if (!codeOffset) continue;
          const length = u32(codeOffset + 12), start = codeOffset + 16, end = start + length * 2;
          range(start, length * 2); row.codeSha256 = sha(bytes.subarray(start, end));
          for (let instruction = start; instruction + 1 < end; instruction += 2) {
            const op = bytes[instruction];
            if (op >= 0x6e && op <= 0x72 && instruction + 3 < end) {
              const methodIndex = u16(instruction + 2);
              if (methodIndex < u32(88)) { const target = method(methodIndex); if (target.owner === 'Landroid/os/Process;' && target.name === 'killProcess') cls.killMatches.push({ method: signature, codeUnitOffset: (instruction - start) / 2, opcode: op, target: symbol(target.owner + '->' + target.name + target.descriptor) }); }
            }
            if (descriptor === INIT && value.name === 'init' && ((op === 0x1a && instruction + 3 < end) || (op === 0x1b && instruction + 5 < end))) {
              const stringIndex = op === 0x1a ? u16(instruction + 2) : u32(instruction + 2), constant = strings[stringIndex];
              const matched = typeof constant === 'string' ? whitelistMatch(constant, packageName) : null;
              if (matched) cls.whitelistMatches.push({ method: signature, codeUnitOffset: (instruction - start) / 2, match: matched, constantSha256: sha(constant) });
            }
          }
        }
      }
    }
    if (descriptor.startsWith('Lcom/github/catvod/spider/Init')) initClasses.push(cls);
    if (descriptor === NATIVE) nativeClasses.push(cls);
  }
  const hasExactInit = initClasses.some(cls => cls.descriptor === INIT), hasKillProcess = initClasses.some(cls => cls.killMatches.length > 0);
  const whitelistAccepted = initClasses.some(cls => cls.descriptor === INIT && cls.whitelistMatches.length > 0);
  return { sha256: sha(bytes), bytes: bytes.length, classCount, allNativeMethods, nativeMethodDeclarations, hasExactInit, hasKillProcess, whitelistAccepted,
    heuristicProtected: hasExactInit && hasKillProcess && !whitelistAccepted, initClasses, dexNativeDefined: nativeClasses.length > 0, nativeClasses,
    scope: 'Static fixed-scanner heuristic. A killProcess match does not prove shell protection or that the instruction executes.' };
}

const parserSource = String.raw`
import java.io.*;import java.nio.file.*;import java.util.*;import java.util.zip.*;
import com.googlecode.d2j.reader.*;import com.googlecode.d2j.node.*;import com.googlecode.d2j.smali.*;
public class StaticProtectionParser {
 public static void main(String[] args)throws Exception{
  String prefix=args[2];int selected=0;try(ZipFile zip=new ZipFile(args[0])){Enumeration<? extends ZipEntry> entries=zip.entries();
   while(entries.hasMoreElements()){ZipEntry entry=entries.nextElement();if(!entry.getName().matches("classes[0-9]*[.]dex"))continue;
    DexFileReader reader;try(InputStream input=zip.getInputStream(entry)){reader=new DexFileReader(input.readAllBytes());}
    List<String> names=reader.getClassNames();for(int i=0;i<names.size();i++){String name=names.get(i);if(!(name.startsWith(prefix)||name.equals("Lcom/github/catvod/spider/DexNative;")))continue;
     DexFileNode node=new DexFileNode();reader.accept(node,i,DexFileReader.SKIP_DEBUG);
     for(DexClassNode cls:node.clzs){String stem="symbol-"+Integer.toHexString(selected++);
      try(BufferedWriter out=Files.newBufferedWriter(Path.of(args[1],stem+".smali"))){new BaksmaliDumper().baksmaliClass(cls,out);}
      System.out.println(Base64.getEncoder().encodeToString(name.getBytes("UTF-8"))+"\t"+stem+".smali");
     }
    }
   }
  }
 }
}
`;
const trustedScanSource = String.raw`
package com.github.catvod.crawler;public class TrustedStaticScan {
 public static class OwnedInit{public android.content.Context c;}
 public static void main(String[] args)throws Exception{
  if(args[0].equals("--owned-absent-native")){
   java.lang.reflect.Method bind=ProtectedInitJar.class.getDeclaredMethod("bindDexLoader",Class.class,Object.class);bind.setAccessible(true);
   System.out.println(bind.invoke(new ProtectedInitJar(),OwnedInit.class,new OwnedInit()));return;
  }
  java.lang.reflect.Method method=ProtectedInitJar.class.getDeclaredMethod("scan",String.class,String.class);method.setAccessible(true);
  System.out.println(method.invoke(null,args[0],args[1]));
 }
}
`;
const stubs = {
  'android/content/Context.java': 'package android.content;public class Context{}',
  'android/text/TextUtils.java': 'package android.text;public class TextUtils{public static boolean isEmpty(CharSequence s){return s==null||s.length()==0;}}',
  'android/util/Base64.java': 'package android.util;public class Base64{public static final int DEFAULT=0;public static byte[] decode(String s,int flags){return java.util.Base64.getMimeDecoder().decode(s);}}',
  'dalvik/system/DexClassLoader.java': 'package dalvik.system;public class DexClassLoader extends ClassLoader{}',
  'com/github/tvbox/osc/base/App.java': 'package com.github.tvbox.osc.base;public class App extends android.content.Context{public static App getInstance(){return new App();}public String getPackageName(){return "com.github.tvbox.osc.jun";}}',
};

export function summarizeStaticDisassembly(text) {
  const methods = [...text.matchAll(/^\.method ([^\n]+)\n([\s\S]*?)^\.end method/gm)].map(match => ({ signature: symbol(match[1].split(' ').at(-1)), declarationSha256: sha(match[1]), bodySha256: sha(match[2]),
    killProcessInvokes: [...match[2].matchAll(/invoke-[^\n]*Landroid\/os\/Process;->killProcess\(/g)].length,
    dexNativeNameConstant: match[2].includes('"com.github.catvod.spider.DexNative"'),
    getLoaderNameConstant: match[2].includes('"getLoader"'),
    appSingletonInvocations: [...new Set([...match[2].matchAll(/Lcom\/github\/tvbox\/osc\/base\/App;->([A-Za-z0-9_$]+)\(\)Lcom\/github\/tvbox\/osc\/base\/App;/g)].map(value => value[1]))],
    catchTypes: [...new Set([...match[2].matchAll(/\.catch (L[^;]+;)/g)].map(value => symbol(value[1])))],
    classNotFoundCatchHandlerOpcodes: [...match[2].matchAll(/\.catch Ljava\/lang\/ClassNotFoundException;[^\n]*?(:(?:L\d+|\w+))\s*$/gm)].map(value => {
      const pattern = new RegExp('^\\s*' + value[1] + '\\s*$', 'm'), start = pattern.exec(match[2]);
      if (!start) return [];
      const block = match[2].slice(start.index + start[0].length).split(/^\s*:\w+\s*$/m)[0];
      return block.split('\n').map(line => line.trim()).filter(line => /^[a-z][\w/-]*\b/.test(line)).map(line => line.replace(/"[^"\n]*"/g, '"sha256"'));
    }),
    classNotFoundCatchDirectReturns: [...match[2].matchAll(/\.catch Ljava\/lang\/ClassNotFoundException;[^\n]*?(:(?:L\d+|\w+))\s*$/gm)].map(value => {
      const target = value[1], pattern = new RegExp('^\\s*' + target + '\\s*$', 'm'), start = pattern.exec(match[2]);
      if (!start) return 'unresolved';
      const block = match[2].slice(start.index + start[0].length).split(/^\s*:\w+\s*$/m)[0];
      const returned = /const\/4\s+([vp]\d+),\s*(?:0x)?([01])\s*\n\s*return\s+\1\b/.exec(block);
      if (returned) return returned[2] === '1';
      const register = /^\s*return\s+([vp]\d+)\s*$/m.exec(block)?.[1];
      if (!register) return 'unresolved';
      const writes = match[2].split('\n').map(line => line.trim()).filter(line => {
        const instruction = /^([a-z][\w/-]*)\s+([vp]\d+)\b/.exec(line);
        return instruction?.[2] === register && !/^(?:return|if-|iput|sput|aput|monitor-|throw|invoke-)/.test(instruction[1]);
      });
      const values = writes.map(line => /^(?:const\/4|const\/16|const)\s+[vp]\d+,\s*(?:0x)?([01])$/.exec(line)?.[1]);
      return values.length > 0 && values.every(value => value === values[0] && value !== undefined) ? values[0] === '1' : 'unresolved';
    }) }));
  return { sha256: sha(text), methods, killProcessInvokes: methods.reduce((count, method) => count + method.killProcessInvokes, 0) };
}

/** All compilation is owned harness + checksum-verified upstream scanner source. */
export async function inspectProtectedArtifacts({ directory, sha256: selection, apk,
  java = join(ROOT, '.tools/jdk17'), packageName = PACKAGE } = {}) {
  const primary = verifyReference(), extra = verifyPlatformReference(), toolchain = dexToolchain({ required: true });
  const verified = await verifyCatalogFreeze({ directory });
  const root = resolve(directory), freeze = JSON.parse(await readFile(join(root, 'freeze.json')));
  checked(Array.isArray(selection) && selection.length > 0 && new Set(selection).size === selection.length
    && selection.every(value => /^[a-f0-9]{64}$/.test(value)), 'SELECTION');
  const temporary = await mkdtemp(join(tmpdir(), 'tvbox-protected-static-'));
  const run = (program, args) => {
    const result = spawnSync(join(java, 'bin', program), args, { encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
    checked(!result.error && result.status === 0, 'PARSER_PROCESS'); return result.stdout;
  };
  const fixedPath = 'app/src/main/java/com/github/catvod/crawler/ProtectedInitJar.java';
  try {
    const sources = [];
    for (const [file, text] of Object.entries({ ...stubs, 'StaticProtectionParser.java': parserSource,
      'com/github/catvod/crawler/TrustedStaticScan.java': trustedScanSource,
      'com/github/catvod/crawler/ProtectedInitJar.java': await readFile(join(extra.extra, fixedPath), 'utf8') })) {
      const path = join(temporary, file); await mkdir(dirname(path), { recursive: true }); await writeFile(path, text, { mode: 0o600 }); sources.push(path);
    }
    run('javac', ['--release', '17', '-cp', toolchain.classpath, '-d', temporary, ...sources]);
    const classpath = [temporary, toolchain.classpath].join(delimiter), artifacts = [];
    const ownedAbsentNativeBinding = run('java', ['-cp', classpath, 'com.github.catvod.crawler.TrustedStaticScan', '--owned-absent-native']).trim();
    checked(ownedAbsentNativeBinding === 'false', 'FIXED_OWNED_BINDING');
    const disassemble = async (path, prefix) => {
      const output = run('java', ['-cp', classpath, 'StaticProtectionParser', path, temporary, prefix]);
      const rows = [];
      for (const line of output.trim().split('\n').filter(Boolean)) {
        const [encoded, name] = line.split('\t'); checked(/^symbol-[a-f0-9]+\.smali$/.test(name), 'PARSER_OUTPUT');
        const descriptor = Buffer.from(encoded, 'base64').toString('utf8'), text = await readFile(join(temporary, name), 'utf8');
        rows.push({ descriptor: symbol(descriptor), summary: summarizeStaticDisassembly(text), text });
      }
      return rows;
    };
    for (const selected of selection) {
      const artifact = freeze.artifacts.find(row => row.sha256 === selected); checked(artifact, 'MISSING_ARTIFACT');
      const path = join(root, artifact.jarPath), bytes = await readFile(path); checked(sha(bytes) === selected, 'JAR_CHECKSUM');
      const entries = zipEntries(bytes), dex = entries.filter(entry => entry.name.endsWith('.dex')).map(entry => ({ name: symbol(entry.name), ...inspectProtectionDex(entry.read(), packageName) }));
      const fixedScan = run('java', ['-cp', classpath, 'com.github.catvod.crawler.TrustedStaticScan', path, packageName]).trim();
      checked(['true', 'false'].includes(fixedScan), 'SCANNER_OUTPUT');
      const parser = await disassemble(path, 'Lcom/github/catvod/spider/Init');
      artifacts.push({ sha256: selected, bytes: bytes.length, dex, fixedSourceScanProtected: fixedScan === 'true',
        parser: parser.map(({ descriptor, summary }) => ({ descriptor, ...summary })),
        nativeLibraries: entries.filter(entry => /\.so$/.test(entry.name)).map(entry => ({ name: symbol(entry.name), bytes: entry.bytes, sha256: sha(entry.read()) })) });
    }
    let officialApk;
    if (apk) {
      const bytes = await readFile(apk), expected = JSON.parse(await readFile(join(ROOT, 'docs/linux/android-apk-baseline-probe.json')));
      checked(sha(bytes) === expected.apk.sha256, 'APK_CHECKSUM');
      const loader = await disassemble(apk, 'Lcom/github/catvod/crawler/JarLoader;');
      checked(loader.length === 1, 'APK_LOADER');
      const field = /\.field [^\n]*protectedInitJar:(L[^;]+;)/.exec(loader[0].text); checked(field, 'APK_PROTECTED_FIELD');
      const protection = await disassemble(apk, field[1].slice(0, -1));
      const app = await disassemble(apk, 'Lcom/github/tvbox/osc/base/App;');
      officialApk = { sha256: sha(bytes), declaredSourceCommit: expected.acquisition.declaredSourceCommit,
        protectedInitDescriptor: symbol(field[1]), classes: protection.map(({ descriptor, summary }) => ({ descriptor, ...summary })),
        dexNativeDefined: zipEntries(bytes).filter(entry => entry.name.endsWith('.dex')).some(entry => dexInventory(entry.read()).classes.includes(NATIVE)),
        appClasses: app.map(({ descriptor, summary }) => ({ descriptor, ...summary })),
        knownVersionDifference: expected.baselineScope.knownRelevantDifference.behavior };
    }
    await verifyCatalogFreeze({ directory });
    return { schemaVersion: 1, generatedAt: new Date().toISOString(), inputSetSha256: verified.inputSetSha256,
      scope: 'Static JAR/DEX and trusted fixed-source byte scanner only. No captured class loading, initialization, native invocation, runtime branch trace, or ART parity claim.',
      verifiedSources: { commit: primary.commit, primaryFiles: primary.files.length, extraFiles: extra.additional.files.length,
        platformFiles: extra.manifest.files.length, protectedInitSha256: sha(await readFile(join(extra.extra, fixedPath))) },
      toolchain: { dexFingerprint: toolchain.fingerprint, javaVersion: run('java', ['-version']).trim(), probeSha256: sha(await readFile(SELF)), ownedHarnessSha256: sha(parserSource + trustedScanSource + JSON.stringify(stubs)) },
      fixedSourceOwnedHostControl: { bindDexLoaderWithAbsentDexNative: false,
        scope: 'Host-JVM execution of checksum-verified upstream method against owned classes/stubs only. This is not Android/ART and does not invoke any captured JAR class.' },
      artifacts, officialApk, cleanup: { temporaryBuildRemoved: true, artifactClassesLoaded: false, thirdPartyNativeExecuted: false, servicesStarted: false } };
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === SELF) {
  const args = process.argv.slice(2), options = {}, selected = [];
  for (let index = 0; index < args.length; index += 2) { if (args[index] === '--sha256') selected.push(args[index + 1]); else options[args[index]] = args[index + 1]; }
  inspectProtectedArtifacts({ directory: options['--directory'], sha256: selected, apk: options['--apk'], java: options['--java'] })
    .then(async report => {
      if (options['--output']) {
        const output = resolve(options['--output']), input = resolve(options['--directory']);
        checked(output !== input && !output.startsWith(input + '/'), 'OUTPUT_INSIDE_INPUT');
        await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      } else process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    })
    .catch(error => { process.stderr.write(JSON.stringify({ errorCode: /^PROTECTED_STATIC_[A-Z_]+$/.test(error.message) ? error.message : 'PROTECTED_STATIC_INPUT_OR_IO', fingerprint: sha(String(error.message)) }) + '\n'); process.exitCode = 1; });
}
