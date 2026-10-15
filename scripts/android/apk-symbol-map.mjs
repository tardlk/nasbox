// SPDX-License-Identifier: GPL-3.0-only
// Fixed-APK R8 symbols established from static DEX instruction bodies.
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { dexToolchain } from '../../backend/spider-runtime/dex/toolchain.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const expectedApkSha256 = '5fb63e491f280c0e271091da5490fcdf0923d6c2f8773ef03553b20a333db657';
const classes = ['Landroidx/base/j0;', 'Landroidx/base/t90;', 'Landroidx/base/k0;', 'Landroidx/base/j0$g;', 'Landroidx/base/k0$a;'];
const helper = String.raw`
import java.nio.file.*;import java.util.*;import java.util.zip.*;import java.io.*;
import com.googlecode.d2j.reader.*;import com.googlecode.d2j.node.*;import com.googlecode.d2j.smali.*;
public class DumpParserSymbols {
 public static void main(String[] args)throws Exception {
  Set<String> names=new HashSet<>(Arrays.asList(args).subList(2,args.length));
  try(ZipFile zip=new ZipFile(args[0])){Enumeration<? extends ZipEntry> entries=zip.entries();
   while(entries.hasMoreElements()){ZipEntry entry=entries.nextElement();if(!entry.getName().matches("classes[0-9]*[.]dex"))continue;
    DexFileReader reader;try(InputStream input=zip.getInputStream(entry)){reader=new DexFileReader(input.readAllBytes());}
    List<String> types=reader.getClassNames();for(int i=0;i<types.size();i++)if(names.contains(types.get(i))){
     DexFileNode node=new DexFileNode();reader.accept(node,i,DexFileReader.SKIP_DEBUG);
     for(DexClassNode cls:node.clzs){Path file=Path.of(args[1],cls.className.substring(1,cls.className.length()-1).replace('/','_')+".smali");
      try(BufferedWriter output=Files.newBufferedWriter(file)){new BaksmaliDumper().baksmaliClass(cls,output);}
     }
    }
   }
  }
 }
}
`;

export async function inspectParserSymbols({ apk, java, output }) {
  const bytes = await readFile(apk);
  if (hash(bytes) !== expectedApkSha256) throw new Error('No audited parser symbol map exists for this APK SHA-256');
  const toolchain = dexToolchain({ required: true }); // Validates every existing dependency hash.
  const temporary = await mkdtemp(join(output, 'symbol-inspect-'));
  const run = (program, args) => {
    const result = spawnSync(join(java, 'bin', program), args, { encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024 });
    if (result.error || result.status !== 0) throw new Error(`Static APK symbol inspection failed: ${result.error?.message || result.stderr}`);
  };
  try {
    const source = join(temporary, 'DumpParserSymbols.java');
    await writeFile(source, helper);
    run('javac', ['--release', '17', '-cp', toolchain.classpath, '-d', temporary, source]);
    run('java', ['-cp', [temporary, toolchain.classpath].join(delimiter), 'DumpParserSymbols', apk, temporary, ...classes]);
    const disassembly = Object.fromEntries(await Promise.all(classes.map(async cls => [cls, await readFile(join(temporary, cls.slice(1, -1).replaceAll('/', '_') + '.smali'), 'utf8')])));
    const methods = text => [...text.matchAll(/^\.method ([^\n]+)\n([\s\S]*?)^\.end method/gm)].map(match => ({ signature: match[1], body: match[2] }));
    const bodies = methods(disassembly[classes[0]]);
    const exact = (signature, required) => {
      const candidates = bodies.filter(method => method.signature.endsWith(signature));
      if (candidates.length !== 1 || required.some(token => !candidates[0].body.includes(token))) throw new Error(`Audited APK method body differs: ${signature}`);
      return hash(candidates[0].body);
    };
    const evidence = {
      configUrl: exact('h(Ljava/lang/String;)Ljava/lang/String;', ['";pk;"', '->z:Ljava/lang/String;', '"clan://localhost/"']),
      findResult: exact('a(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;', ['"2423"', '"AES/ECB/PKCS7Padding"', 'Landroid/util/Base64;->decode']),
      parseJson: exact('F(Ljava/lang/String;Ljava/lang/String;)V', ['"sites"', '"spider"', '"jarCache"', '"live_api_url"', 'Landroidx/base/t90;-><init>()V']),
      fixContentPath: exact('j(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;', ['"\\"./"', '"\\"../"', 'UriUtil;->resolve']),
      getSources: exact('v()Ljava/util/List;', ['->a:Ljava/util/LinkedHashMap;', '->values()Ljava/util/Collection;']),
      singleton: exact('k()Landroidx/base/j0;', ['sget-object', '->E:Landroidx/base/j0;', 'monitor-enter']),
    };
    const parse = bodies.find(method => method.signature.endsWith('F(Ljava/lang/String;Ljava/lang/String;)V')).body;
    const sourceFields = { key:'a', name:'b', api:'c', type:'d', searchable:'e', quickSearch:'f', changeable:'g', playUrl:'h', ext:'i', jar:'j', categories:'k', playerType:'l', timeout:'m', click:'n', style:'o' };
    for (const [logical, field] of Object.entries(sourceFields)) {
      const fieldType = ['type','searchable','quickSearch','changeable','playerType','timeout'].includes(logical) ? 'I' : logical === 'categories' ? 'Ljava/util/ArrayList;' : 'Ljava/lang/String;';
      if (!parse.includes(`Landroidx/base/t90;->${field}:${fieldType}`) || !parse.includes(`"${logical}"`)) throw new Error(`Source assignment evidence differs: ${logical}`);
    }
    const sourceText = disassembly[classes[1]];
    if ((sourceText.match(/^\.field /gm) || []).length !== 15 || /->filterable:/.test(sourceText)) throw new Error('Source field layout changed');
    const timeout = methods(sourceText).find(method => method.signature.endsWith('f()I'));
    if (!timeout || !['->m:I','Ljava/lang/Math;->min(II)I','Ljava/lang/Math;->max(II)I','15'].every(token => timeout.body.includes(token))) throw new Error('Original play timeout getter evidence differs');
    evidence.playTimeoutSeconds = hash(timeout.body);
    const fetch = methods(disassembly[classes[2]]).find(method => method.signature.endsWith('run()V'));
    if (!fetch || !['Landroidx/base/j0;->a(Ljava/lang/String;Ljava/lang/String;)', 'Landroidx/base/j0;->d(Ljava/lang/String;)', 'Landroidx/base/j0;->j(Ljava/lang/String;Ljava/lang/String;)', '"clan://localhost/"', '"file://"', '"/file/"', 'Lokhttp3/ResponseBody;->string()'].every(token => fetch.body.includes(token))) throw new Error('Original fetch preparation flow evidence differs');
    evidence.fetchPreparation = hash(fetch.body);
    if (!disassembly[classes[3]].includes('a(Ljava/lang/String;)V') || !disassembly[classes[3]].includes('error(Ljava/lang/String;)V')) throw new Error('Original callback interface differs');
    const map = {
      schemaVersion: 1, apkSha256: expectedApkSha256,
      apiClass: 'androidx.base.j0', sourceClass: 'androidx.base.t90', fetchClass: 'androidx.base.k0', callbackClass: 'androidx.base.j0$g',
      methods: { singleton:'k', configUrl:'h', findResult:'a', parseJson:'F', getSources:'v', playTimeoutSeconds:'f' },
      apiFields: { configKey:'z', spider:'i', jarCache:'F', danmaku:'o', wallpaper:'n', flags:'f' },
      sourceFields, preferences: { homeApi:'home_api', defaultParse:'parse_default', liveApiUrl:'live_api_url' },
      optimizedOut: ['filterable'],
      scope: 'Exact APK SHA-256 only. Original DEX instruction bodies establish each symbol. filterable storage/getter removed by R8; it is unobservable and excluded from cross-runtime comparison.',
      evidence: { methodBodySha256: evidence, disassemblySha256: Object.fromEntries(Object.entries(disassembly).map(([name,text]) => [name,hash(text)])), staticOnly: true, artifactClassesLoaded: false, dexToolchainFingerprint: toolchain.fingerprint },
    };
    return map;
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
