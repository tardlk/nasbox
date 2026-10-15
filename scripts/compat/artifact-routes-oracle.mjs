// SPDX-License-Identifier: GPL-3.0-only
// Fresh, unchanged pinned Android methods; Android storage/network/loader services
// are explicit fixture bindings. This is a host JVM reference, not an ART probe.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { reference, verifyReference, sha256 } from './reference.mjs';
import { copyPlatformReference } from './platform-reference.mjs';
import { extractMethod } from './oracle.mjs';
import { buildConfigCore } from '../../backend/config-core/index.mjs';

export function runArtifactRoutesOracle(cases) {
  const manifest = verifyReference();
  const directory = mkdtempSync(join(tmpdir(), 'tvbox-artifact-routes-oracle-'));
  try {
    const platform = copyPlatformReference(directory), built = buildConfigCore();
    const api = readFileSync(join(reference, 'app/src/main/java/com/github/tvbox/osc/api/ApiConfig.java'), 'utf8');
    const jar = readFileSync(join(reference, 'app/src/main/java/com/github/catvod/crawler/JarLoader.java'), 'utf8');
    const md5 = readFileSync(join(platform.extra, 'app/src/main/java/com/github/tvbox/osc/util/MD5.java'), 'utf8');
    const methods = [
      ['ApiConfig.loadJar', extractMethod(api, 'private void loadJar(boolean useCache,')],
      ['JarLoader.parseJar', extractMethod(jar, 'public void parseJar(')],
      ['JarLoader.copyAsset', extractMethod(jar, 'private File copyAsset(')],
      ['JarLoader.local', extractMethod(jar, 'private File local(')],
      ['JarLoader.clanToAddress', extractMethod(jar, 'private String clanToAddress(')],
      ['ApiConfig.getImgJar', extractMethod(api, 'private static byte[] getImgJar(')],
      ['MD5.string2MD5', extractMethod(md5, 'public static String string2MD5(')],
    ];
    const code = `// Generated unchanged methods from TVBoxOS ${manifest.commit}; GPL-3.0-only.
import java.io.*;import java.security.*;import java.util.*;import java.util.regex.*;import com.google.gson.*;import android.util.Base64;
public class ArtifactRoutesOracle {
 static JsonObject input,row;static String route,routePath,requestUrl,storage;static boolean image;static int loads;
 String jarCache="false";final ArtifactRoutesOracle jarLoader=this;static final int LOAD_JAR_MAX_RETRY=1;
 Map<String,Object> loaders=new HashMap<>();Map<String,String> aliases=new HashMap<>();
 // File preserves constructor arguments so the local() transformation can be
 // observed without substituting a host filesystem for Android external storage.
 static class File {String path;boolean present,external,externalRoot;
  File(String path){this.path=path;}
  File(File parent,String child){path=child;external=parent.externalRoot;present=external&&input.has("externalExists")&&input.get("externalExists").getAsBoolean();}
  String getAbsolutePath(){return path;}boolean exists(){return present;}long length(){return present?1:0;}boolean delete(){present=false;return true;}
  File getParentFile(){return new File("parent");}boolean mkdirs(){return true;}
 }
 static class FileOutputStream extends OutputStream {FileOutputStream(File f){}public void write(int b){}public void write(byte[] b,int off,int len){}public void flush(){}}
 static class Environment {static File getExternalStorageDirectory(){File f=new File("/fixture-external");f.externalRoot=true;return f;}}
 static class App {static App getInstance(){return new App();}File getFilesDir(){return new File("/fixture-files");}Assets getAssets(){return new Assets();}}
 static class Assets {InputStream open(String path){route="assets";routePath=path;return new ByteArrayInputStream(new byte[]{1,2,3});}}
 static class ControlManager {static ControlManager get(){return new ControlManager();}String getAddress(boolean ignored){return input.has("localAddress")?input.get("localAddress").getAsString():"http://127.0.0.1:9978/";}}
 static class LOG {static void i(String ignored){}static void e(String ignored){}}
 static final LogBinding Log=new LogBinding();static class LogBinding {void e(String tag,String message){}}
 static class TextUtils {static boolean isEmpty(String s){return s==null||s.isEmpty();}}
 static class MD5 {static MessageDigest sDigest;static{try{sDigest=MessageDigest.getInstance("MD5");}catch(Exception e){throw new RuntimeException(e);}}${methods[6][1]}static String getFileMd5(File f){return "";}}
 static class FileUtils {static boolean isWeekAgo(File file){return true;}}
 static class OkHttp {static String string(String url,Object headers){return null;}}
 interface LoadConfigCallback {void success();void error(String error);}interface JarLoadCallback {void complete(boolean ok);}interface JarDownloadCallback {void complete(File file,String error);}
 boolean load(String path){loads++;return true;}
 boolean load(String key,File file){loads++;if(route.equals("unsupported")){route="file";routePath=file.path;storage=file.external?"external":"fallback";}return true;}
 void loadJarAsync(File file,JarLoadCallback callback){loads++;callback.complete(true);}
 void downloadJarAsync(String url,boolean img,File file,JarDownloadCallback callback){route=img?"image":"http";requestUrl=url;image=img;file.present=true;callback.complete(file,"");}
 File download(String url,File file){route="http";requestUrl=url;return file;}
 File create(File file){file.present=true;return file;}void close(Closeable ignored){}
 File fileForJar(String source){return new File("/fixture-cache/"+jarKey(source)+".jar");}String jarKey(String s){return MD5.string2MD5(s);}boolean exists(File f){return f!=null&&f.exists()&&f.length()>0;}Object lock(String s){return this;}
 static Pattern getPattern(String expression){return Pattern.compile(expression);}
 ${methods.slice(0,6).map(([,body])=>body).join('\n')}
 public static void main(String[] args)throws Exception{
  JsonArray result=new JsonArray();
  for(JsonElement element:JsonParser.parseString(new String(java.lang.System.in.readAllBytes(),java.nio.charset.StandardCharsets.UTF_8)).getAsJsonArray()){
   input=element.getAsJsonObject();row=new JsonObject();row.addProperty("id",input.get("id").getAsString());route="unsupported";routePath=requestUrl=storage=null;image=false;loads=0;
   try {
    if(input.has("body")){byte[] bytes=getImgJar(input.get("body").getAsString());row.addProperty("hex",HexFormat.of().formatHex(bytes));row.addProperty("bytes",bytes.length);}
    else {ArtifactRoutesOracle oracle=new ArtifactRoutesOracle();String source=input.get("source").getAsString();
     if(input.get("role").getAsString().equals("main"))oracle.loadJar(false,source,new LoadConfigCallback(){public void success(){}public void error(String error){row.addProperty("callbackError",error);}},0);
     else oracle.parseJar("fixture-key",source);
     row.addProperty("kind",route);if(requestUrl!=null)row.addProperty("requestUrl",requestUrl);if(routePath!=null)row.addProperty("path",routePath);if(storage!=null)row.addProperty("storage",storage);row.addProperty("loads",loads);
    }
   }catch(Throwable error){row.addProperty("errorType",error.getClass().getSimpleName());row.addProperty("errorMessage",error.getMessage());}
   result.add(row);
  }java.lang.System.out.println(result);
 }
}`;
    writeFileSync(join(directory, 'ArtifactRoutesOracle.java'), code);
    const base64 = join(directory, 'android/util/Base64.java');
    const annotation = join(directory, 'android/compat/annotation/UnsupportedAppUsage.java');
    const javac = built.java.replace(/java$/, 'javac');
    const compiled = spawnSync(javac, ['--release', '17', '-encoding', 'UTF-8', '-cp', built.gson, '-d', directory, base64, annotation, join(directory, 'ArtifactRoutesOracle.java')], { encoding: 'utf8', timeout: 30000 });
    if (compiled.error || compiled.status !== 0) throw new Error('Artifact routes oracle compile failed: ' + (compiled.error || compiled.stderr));
    const run = spawnSync(built.java, ['-Dfile.encoding=UTF-8', '-cp', [directory, built.gson].join(delimiter), 'ArtifactRoutesOracle'], { input: JSON.stringify(cases), encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
    if (run.error || run.status !== 0) throw new Error('Artifact routes oracle failed: ' + (run.error || run.stderr));
    return {
      scope: 'Fresh unchanged ApiConfig/JarLoader methods and original AOSP Base64 on host JVM; constructor/asset/network/loader fixture bindings, no Android storage, OkHttp or ART',
      commit: manifest.commit,
      extraction: [...methods.map(([name,body])=>({ name, sha256: sha256(body) })), { name: 'android.util.Base64', sha256: sha256(readFileSync(base64)) }],
      rows: JSON.parse(run.stdout),
    };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
