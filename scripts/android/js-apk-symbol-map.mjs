// SPDX-License-Identifier: GPL-3.0-only
// Read-only exact-APK DEX audit; provider code is never loaded by this tool.
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { dexToolchain } from '../../backend/spider-runtime/dex/toolchain.mjs';
import { verifyReference } from '../compat/reference.mjs';
import { verifyPlatformReference } from '../compat/platform-reference.mjs';
import { inspectParserSymbols } from './apk-symbol-map.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
export const jsOracleOfficialApkSha256 = '5fb63e491f280c0e271091da5490fcdf0923d6c2f8773ef03553b20a333db657';
const check = (condition, code) => { if (!condition) throw new Error('JS_APK_SYMBOL_' + code); };
const classes = {
  loader: 'com/github/catvod/crawler/JsLoader', spider: 'androidx/base/rr', initCallable: 'androidx/base/da0',
  files: 'androidx/base/dk', md5: 'androidx/base/yv', connect: 'androidx/base/m7', clients: 'androidx/base/mz',
  http: 'com/github/catvod/net/OkHttp',
};
export function validateJsDisassembly(texts) {
  const evidence = {};
  const method = (key, signature, tokens) => {
    const matches = [...texts[key].matchAll(/^\.method ([^\n]+)\n([\s\S]*?)^\.end method/gm)].filter(match => match[1] === signature);
    check(matches.length === 1 && tokens.every(token => matches[0][2].includes(token)), key.toUpperCase() + '_METHOD');
    evidence[key + ':' + signature] = hash(matches[0][2]);
  };
  method('loader', 'public declared-synchronized getSpider(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)Lcom/github/catvod/crawler/Spider;',
    ['Landroidx/base/rr;-><init>(Ljava/lang/String;Ljava/lang/String;Ljava/lang/Class;)V', 'Landroidx/base/rr;->init(Landroid/content/Context;Ljava/lang/String;)V', '->siteKey:', '->spiders:', '->loadJarInternal(']);
  method('loader', 'public declared-synchronized clear()V', ['->destroy()V', '->spiders:', '->classes:']);
  method('files', 'public static o(Ljava/lang/String;)Ljava/lang/String;', ['"debug_open"', 'Landroidx/base/dk;->g(', 'Landroidx/base/yv;->a(', '"data"', '"expires"', 'Landroidx/base/dk;->e(']);
  method('files', 'public static g(Ljava/lang/String;)Ljava/lang/String;', ['Landroidx/base/dk;->p(', '"expires"', '"data"', '->getAsString()']);
  method('files', 'public static p(Ljava/lang/String;)Ljava/io/File;', ['Landroidx/base/dk;->i()', '"/qjscache_"', '".js"']);
  method('connect', 'public static e(Ljava/lang/String;Landroidx/base/j40;)Lokhttp3/Call;', ['Landroidx/base/mz;->g:Lokhttp3/OkHttpClient;', '"js_okhttp_tag"', 'Lokhttp3/Request$Builder;']);
  method('http', 'public static declared-synchronized client()Lokhttp3/OkHttpClient;', ['Landroidx/base/mz;->g:Lokhttp3/OkHttpClient;', '->newBuilder()', '->client:Lokhttp3/OkHttpClient;']);
  for (const [signature, jsName] of [
    ['public final homeContent(Z)Ljava/lang/String;', 'home'], ['public final homeVideoContent()Ljava/lang/String;', 'homeVod'],
    ['public final categoryContent(Ljava/lang/String;Ljava/lang/String;ZLjava/util/HashMap;)Ljava/lang/String;', 'category'],
    ['public final detailContent(Ljava/util/List;)Ljava/lang/String;', 'detail'], ['public final searchContent(Ljava/lang/String;Z)Ljava/lang/String;', 'search'],
    ['public final playerContent(Ljava/lang/String;Ljava/lang/String;Ljava/util/List;)Ljava/lang/String;', 'play'],
  ]) method('spider', signature, ['"' + jsName + '"', 'Landroidx/base/rr;->b(']);
  check(texts.spider.includes('.field public d:Lcom/whl/quickjs/wrapper/JSObject;') && texts.initCallable.includes('Landroidx/base/dk;->o(')
    && texts.initCallable.includes('"tv_box_root.js"') && texts.initCallable.includes('->setModuleLoader('), 'JS_INITIALIZER');
  for (const field of ['g', 'h']) check(texts.clients.includes('.field public static ' + field + ':Lokhttp3/OkHttpClient;'), 'CLIENT_FIELD');
  return { schemaVersion: 1, apkSha256: jsOracleOfficialApkSha256, loaderClass: classes.loader.replaceAll('/', '.'), spiderClass: classes.spider.replaceAll('/', '.'),
    methods: { getSpider: 'getSpider', clear: 'clear', loadModule: 'o', getCache: 'g', cacheFile: 'p', md5: 'a' },
    fileClass: classes.files.replaceAll('/', '.'), md5Class: classes.md5.replaceAll('/', '.'), jsObjectField: 'd',
    clientFields: [{ class: classes.clients.replaceAll('/', '.'), field: 'g' }, { class: classes.clients.replaceAll('/', '.'), field: 'h' },
      { class: classes.http.replaceAll('/', '.'), field: 'client', initialize: 'client' }],
    evidence: { methodBodySha256: evidence, disassemblySha256: Object.fromEntries(Object.entries(texts).map(([key, value]) => [key, hash(value)])), staticOnly: true },
    scope: 'Exact original APK only. Original JsLoader/JsSpider execute; harness preloads frozen module cache and intercepts only exact captured static GET URLs. Other business networking remains live.' };
}

export async function inspectJsSymbols({ apk, java, output }) {
  check(hash(await readFile(apk)) === jsOracleOfficialApkSha256, 'APK_HASH');
  const primary = verifyReference(), platform = verifyPlatformReference(), toolchain = dexToolchain({ required: true });
  const temporary = await mkdtemp(join(output, 'js-symbol-inspect-'));
  try {
    const texts = {};
    for (const dexName of ['classes.dex', 'classes2.dex']) {
      const extracted = spawnSync('/usr/bin/unzip', ['-p', resolve(apk), dexName], { maxBuffer: 32 * 1024 * 1024 });
      check(extracted.status === 0, 'APK_DEX');
      const dexPath = join(temporary, dexName), disassembly = join(temporary, dexName + '-out');await writeFile(dexPath, extracted.stdout);
      const run = spawnSync(join(java, 'bin/java'), ['-cp', toolchain.classpath, 'com.googlecode.d2j.smali.BaksmaliCmd', dexPath, '-o', disassembly], { encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024 });
      check(run.status === 0, 'DISASSEMBLY');
      for (const [key, cls] of Object.entries(classes)) {
        const text = await readFile(join(disassembly, cls + '.smali'), 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
        if (text) { check(!texts[key], 'DUPLICATE_CLASS');texts[key] = text; }
      }
    }
    check(Object.keys(texts).length === Object.keys(classes).length, 'MISSING_CLASS');
    const result = validateJsDisassembly(texts);
    const parser = await inspectParserSymbols({ apk, java, output });
    result.configClass = parser.apiClass;
    result.methods.configSingleton = parser.methods.singleton;
    result.evidence.apiConfigSingletonMethodBodySha256 = parser.evidence.methodBodySha256.singleton;
    result.evidence.dexToolchainFingerprint = toolchain.fingerprint;
    result.evidence.pinnedSource = { commit: primary.commit, primaryFiles: primary.files.length, extraFiles: platform.additional.files.length,
      relation: 'Same loader/module/method sequence verified by static tokens; R8 and release commit differ from source baseline. This is original-product ART, not proof of exact pinned-source execution.' };
    return result;
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
