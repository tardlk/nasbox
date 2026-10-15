// SPDX-License-Identifier: GPL-3.0-only
// Fresh unchanged Android control-flow methods; filesystem/network/executor bindings are explicit fixtures.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { reference, verifyReference, sha256 } from './reference.mjs';
import { verifyPlatformReference } from './platform-reference.mjs';
import { extractMethod } from './oracle.mjs';
import { buildConfigCore } from '../../backend/config-core/index.mjs';

export function runJarPolicyOracle(cases) {
  verifyReference(); const { extra } = verifyPlatformReference();
  const api = readFileSync(join(reference, 'app/src/main/java/com/github/tvbox/osc/api/ApiConfig.java'), 'utf8');
  const jar = readFileSync(join(reference, 'app/src/main/java/com/github/catvod/crawler/JarLoader.java'), 'utf8');
  const files = readFileSync(join(extra, 'app/src/main/java/com/github/tvbox/osc/util/FileUtils.java'), 'utf8');
  const md5 = readFileSync(join(extra, 'app/src/main/java/com/github/tvbox/osc/util/MD5.java'), 'utf8');
  const methods = [extractMethod(api, 'private void loadJar(boolean useCache,'), extractMethod(jar, 'public void parseJar('), extractMethod(files, 'public static boolean isWeekAgo('), extractMethod(md5, 'public static String string2MD5(')];
  const built = buildConfigCore(), directory = mkdtempSync(join(tmpdir(), 'tvbox-jar-oracle-'));
  const code = `// SPDX-License-Identifier: GPL-3.0-only
import java.io.*;import java.nio.file.*;import java.security.*;import java.util.*;import com.google.gson.*;
public class JarPolicyOracle {
 static long clock;static JsonObject input;static File folder;static int downloads,loads;static String outcome;
 String jarCache;final JarPolicyOracle jarLoader=this;static final int LOAD_JAR_MAX_RETRY=1;
 Map<String,Object> loaders=new HashMap<>();Map<String,String> aliases=new HashMap<>();
 static class System {static long currentTimeMillis(){return clock;}}
 static class App {static App getInstance(){return new App();}File getFilesDir(){return folder;}}
 static class LOG {static void i(String s){}static void e(String s){}}
 static class TextUtils {static boolean isEmpty(String s){return s==null||s.isEmpty();}}
 static final LogBinding Log=new LogBinding();static class LogBinding {void e(String tag,String message){}}
 static class MD5 {static MessageDigest sDigest;static{try{sDigest=MessageDigest.getInstance("MD5");}catch(Exception e){throw new RuntimeException(e);}}${methods[3]}static String getFileMd5(File f){try{return HexFormat.of().formatHex(MessageDigest.getInstance("MD5").digest(Files.readAllBytes(f.toPath())));}catch(Exception e){return "";}}}
 static class FileUtils {${methods[2]}}
 static class OkHttp {static String string(String url,Object h){return input.has("remoteMd5")?input.get("remoteMd5").getAsString():null;}}
 interface LoadConfigCallback {void success();void error(String error);}interface JarLoadCallback {void complete(boolean ok);}interface JarDownloadCallback {void complete(File file,String error);}
 boolean load(String path){loads++;return true;}boolean load(String key,File file){loads++;return true;}
 void loadJarAsync(File file,JarLoadCallback callback){loads++;callback.complete(true);}
 void downloadJarAsync(String url,boolean img,File file,JarDownloadCallback callback){downloads++;try{file.getParentFile().mkdirs();Files.writeString(file.toPath(),"new");file.setLastModified(clock);callback.complete(file,"");}catch(Exception e){throw new RuntimeException(e);}}
 File download(String url,File file){downloads++;try{file.getParentFile().mkdirs();Files.writeString(file.toPath(),"new");return file;}catch(Exception e){throw new RuntimeException(e);}}
 File copyAsset(String url,File file){return file;}File local(String path){return new File(path);}String clanToAddress(String path){return path;}
 File fileForJar(String source){return new File(folder,"jar/"+jarKey(source)+".jar");}String jarKey(String s){return MD5.string2MD5(s);}boolean exists(File f){return f.exists()&&f.length()>0;}Object lock(String s){return this;}
 ${methods[0]}
 ${methods[1]}
 public static void main(String[] args)throws Exception{
  folder=new File(args[0]);JsonArray result=new JsonArray();
  for(JsonElement element:JsonParser.parseString(new String(java.lang.System.in.readAllBytes(),java.nio.charset.StandardCharsets.UTF_8)).getAsJsonArray()){
   input=element.getAsJsonObject();clock=input.get("now").getAsLong();downloads=loads=0;outcome="";
   JarPolicyOracle oracle=new JarPolicyOracle();oracle.jarCache=input.get("jarCache").getAsString();String signature=input.get("signature").getAsString();String role=input.get("role").getAsString();String source=signature.split(";md5;")[0];
   File cache=new File(folder,(role.equals("main")?"csp/":"jar/")+MD5.string2MD5(source)+".jar");cache.getParentFile().mkdirs();Files.deleteIfExists(cache.toPath());
   if(input.get("cached").getAsBoolean()){Files.writeString(cache.toPath(),"old");cache.setLastModified(input.get("downloadedAt").getAsLong());}
   if(role.equals("main"))oracle.loadJar(input.get("useCache").getAsBoolean(),signature,new LoadConfigCallback(){public void success(){outcome="success";}public void error(String error){outcome=error;}},0);
   else {oracle.parseJar(MD5.string2MD5(signature),signature);outcome=loads>0?"success":"unloaded";}
   JsonObject row=new JsonObject();row.addProperty("id",input.get("id").getAsString());row.addProperty("cacheKey",MD5.string2MD5(source));row.addProperty("origin",downloads>0?"download":"cache");row.addProperty("downloads",downloads);row.addProperty("loads",loads);row.addProperty("outcome",outcome);result.add(row);
  }java.lang.System.out.println(result);
 }
}`;
  try {
    writeFileSync(join(directory, 'JarPolicyOracle.java'), code);
    const javac = built.java.replace(/java$/, 'javac');
    const compiled = spawnSync(javac, ['--release', '17', '-cp', built.gson, '-d', directory, join(directory, 'JarPolicyOracle.java')], { encoding: 'utf8', timeout: 30000 });
    if (compiled.status !== 0) throw new Error(compiled.stderr);
    const run = spawnSync(built.java, ['-cp', [directory, built.gson].join(delimiter), 'JarPolicyOracle', directory], { input: JSON.stringify(cases), encoding: 'utf8', timeout: 30000 });
    if (run.status !== 0) throw new Error(run.stderr);
    return { scope: 'Unchanged ApiConfig.loadJar/JarLoader.parseJar/FileUtils.isWeekAgo on fresh JVM fixture bindings; successful loader/network paths only; no ART', extraction: methods.map(sha256), rows: JSON.parse(run.stdout) };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
