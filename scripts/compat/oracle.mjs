// Execute selected unchanged upstream methods with upstream Gson, not a JS mock.
// Generated Java/reference snapshots retain their upstream licensing.
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync } from 'node:fs';
import { resolve, delimiter } from 'node:path';
import { spawnSync } from 'node:child_process';
import { root, reference, verifyReference, sha256 } from './reference.mjs';
import { copyPlatformReference } from './platform-reference.mjs';
import { stateReference } from './state-reference.mjs';
import { vodReference } from './vod-reference.mjs';

export function extractMethod(source, signature) {
  const start = source.indexOf(signature);
  if (start < 0 || source.indexOf(signature, start + 1) >= 0) throw new Error(`Missing/ambiguous method: ${signature}`);
  const opening = source.indexOf('{', start);
  let depth = 1, state = 'code', escaped = false;
  for (let i = opening + 1; i < source.length; i++) {
    const c = source[i], n = source[i + 1];
    if (state === 'line') { if (c === '\n') state = 'code'; continue; }
    if (state === 'block') { if (c === '*' && n === '/') { state = 'code'; i++; } continue; }
    if (state === 'string' || state === 'char') {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if ((state === 'string' && c === '"') || (state === 'char' && c === "'")) state = 'code';
      continue;
    }
    if (c === '/' && n === '/') { state = 'line'; i++; }
    else if (c === '/' && n === '*') { state = 'block'; i++; }
    else if (c === '"') state = 'string';
    else if (c === "'") state = 'char';
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`Unclosed method: ${signature}`);
}

function command(name) {
  const home = process.env.TVBOX_JAVA_HOME || resolve(root, '.tools/jdk17');
  const path = resolve(home, 'bin', name);
  return existsSync(path) ? path : name;
}

export function buildOracle() {
  const manifest = verifyReference();
  const base = resolve(root, '.cache/compat/oracle'); mkdirSync(base, { recursive: true });
  const build = mkdtempSync(resolve(base, 'run-'));
  const platform = copyPlatformReference(build);
  const read = path => readFileSync(resolve(reference, path), 'utf8');
  const apiPath = 'app/src/main/java/com/github/tvbox/osc/api/ApiConfig.java';
  const defaultPath = 'app/src/main/java/com/github/tvbox/osc/util/DefaultConfig.java';
  const uriPath = 'quickjs/src/main/java/com/whl/quickjs/wrapper/UriUtil.java';
  const api = read(apiPath), defaults = read(defaultPath);
  const methods = [
    'public static String safeJsonString(',
    'public static int safeJsonInt(',
    'public static ArrayList<String> safeJsonStringList(',
  ].map(signature => extractMethod(defaults, signature));
  const firstSite = api.indexOf('SourceBean firstSite = null;');
  const nextBlock = api.indexOf('if (sourceBeanList != null && sourceBeanList.size() > 0)', firstSite);
  if (firstSite < 0 || nextBlock < firstSite) throw new Error('Upstream site loop markers changed');
  const siteLoop = api.slice(firstSite, nextBlock);
  const trim = extractMethod(api, 'private String trimJsonObject(');
  const fix = extractMethod(api, 'String fixContentPath(');
  const clan = extractMethod(api, 'String clanToAddress(');
  const configUrl = extractMethod(api, 'private String configUrl(');
  const decode = extractMethod(api, 'public static String FindResult(');
  const collection = extractMethod(api, 'private ArrayList<String> parseApiCollection(');
  const clanContentFix = extractMethod(api, 'String clanContentFix(');
  const historySource = readFileSync(resolve(platform.extra, platform.additional.files[0].path), 'utf8');
  const historyMethods = ['public static String buildApiLine(', 'public static String getApiLineName(', 'public static String getApiLineUrl(']
    .map(signature => extractMethod(historySource, signature));
  const extraRead = name => readFileSync(resolve(platform.extra, `app/src/main/java/com/github/tvbox/osc/util/${name}.java`), 'utf8');
  const state = stateReference(api, historySource, extraRead('MD5'), extraRead('FileUtils'), build);
  const vod = vodReference(api);
  const proxy = extractMethod(defaults, 'public static String checkReplaceProxy(');
  // Uri operations not used by fixContentPath are excluded; resolve and its
  // private helpers remain byte-for-byte upstream Java.
  let uri = read(uriPath);
  uri = uri.replace(extractMethod(uri, 'public static Uri resolveToUri('), '');
  uri = uri.replace(extractMethod(uri, 'public static Uri removeQueryParameter('), '');
  uri = uri.replace('package com.whl.quickjs.wrapper;', '')
    .replace('import android.net.Uri;', '').replace('import android.text.TextUtils;', '');
  const source = `// Generated from TVBoxOS ${manifest.commit}. GPL-3.0; see reference LICENSE.
import com.google.gson.*;
import com.github.tvbox.osc.bean.SourceBean;
import java.util.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.regex.*;
import android.util.Base64;
import com.github.tvbox.osc.util.AES;

class TextUtils { static boolean isEmpty(CharSequence s) { return s == null || s.length() == 0; } }
class LOG { static void i(String ignored) {} }
class ControlManager {
  static final ControlManager INSTANCE = new ControlManager();
  static String address = "http://127.0.0.1:9978/";
  static ControlManager get() { return INSTANCE; }
  String getAddress(boolean local) { return address; }
}
class DefaultConfig { ${[...methods,proxy].join('\n')} }
class HistoryHelper { private static final String API_LINE_SPLIT = "\\t"; ${[...historyMethods,...state.historyMethods].join('\n')} }
${state.classes}
${vod.source}

public class AndroidOracle {
  private final Gson gson = new Gson();
  private final LinkedHashMap<String, SourceBean> sourceBeanList = new LinkedHashMap<>();
  private String TempKey = null;
  private VodOracle vod = new VodOracle();
  private static Pattern getPattern(String pattern) { return Pattern.compile(pattern); }
  ${trim}
  ${fix}
  ${clan}
  ${configUrl}
  ${decode}
  ${collection}
  ${clanContentFix}
  ${state.methods}
  private JsonArray snapshot() {
    JsonArray result = new JsonArray();
    for (SourceBean bean : sourceBeanList.values()) {
      JsonObject value = gson.toJsonTree(bean).getAsJsonObject();
      value.add("playUrl", value.remove("playerUrl"));
      value.add("click", value.remove("clickSelector"));
      value.addProperty("playTimeoutSeconds", bean.getPlayTimeoutSeconds());
      result.add(value);
    }
    return result;
  }
  private JsonArray sites(String text) {
    sourceBeanList.clear();
    JsonObject infoJson = gson.fromJson(text, JsonObject.class);
    ${siteLoop}
    return snapshot();
  }
  private JsonElement run(JsonObject request) throws Throwable {
    String operation = request.get("operation").getAsString();
    String text = request.has("text") && !request.get("text").isJsonNull() ? request.get("text").getAsString() : null;
    if (request.has("localAddress")) ControlManager.address = request.get("localAddress").getAsString();
    ${state.dispatch}
    if(operation.equals("vod"))return vod.run(request.has("url")?request.get("url").getAsString():"",text);
    if(operation.equals("vodState"))return vod.snapshot();
    if(operation.equals("vodSearch"))return vod.searchSources();
    if(operation.equals("vodSource"))return vod.source(request.get("key").getAsString());
    if (operation.equals("sites")) return sites(text);
    if (operation.equals("json")) return gson.fromJson(text, JsonElement.class);
    if (operation.equals("trim")) return new JsonPrimitive(trimJsonObject(text));
    if (request.has("localAddress")) ControlManager.address = request.get("localAddress").getAsString();
    if (operation.equals("url")) {
      JsonObject value = new JsonObject();
      value.addProperty("url", configUrl(request.get("url").getAsString()));
      value.add("key", TempKey == null ? JsonNull.INSTANCE : new JsonPrimitive(TempKey));
      return value;
    }
    if (operation.equals("decode")) {
      String key = request.has("key") && !request.get("key").isJsonNull() ? request.get("key").getAsString() : null;
      String value = FindResult(text, key);
      return value == null ? JsonNull.INSTANCE : new JsonPrimitive(value);
    }
    if (operation.equals("collection")) return gson.toJsonTree(parseApiCollection(text));
    if (operation.equals("clanFix")) return new JsonPrimitive(clanContentFix(clanToAddress(request.get("url").getAsString()), text));
    if (operation.equals("fix")) {
      if (request.has("localAddress")) ControlManager.address = request.get("localAddress").getAsString();
      return new JsonPrimitive(fixContentPath(request.get("url").getAsString(), text));
    }
    if (operation.equals("safe")) {
      JsonObject object = gson.fromJson(text, JsonObject.class);
      String key = request.has("key") ? request.get("key").getAsString() : "value";
      JsonObject result = new JsonObject();
      result.addProperty("string", DefaultConfig.safeJsonString(object, key, "fallback"));
      result.addProperty("int", DefaultConfig.safeJsonInt(object, key, 17));
      result.add("list", gson.toJsonTree(DefaultConfig.safeJsonStringList(object, key)));
      return result;
    }
    throw new IllegalArgumentException("Unknown operation: " + operation);
  }
  public static void main(String[] args) throws Exception {
    java.security.Security.addProvider(new org.bouncycastle.jce.provider.BouncyCastleProvider());
    Hawk.restore(new JsonObject());
    AndroidOracle oracle = new AndroidOracle();
    BufferedReader input = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
    String line;
    while ((line = input.readLine()) != null) {
      JsonObject response = new JsonObject();
      try {
        JsonElement value = oracle.run(JsonParser.parseString(line).getAsJsonObject());
        response.addProperty("ok", true); response.add("value", value == null ? JsonNull.INSTANCE : value);
      } catch (Throwable error) {
        response.addProperty("ok", false); response.addProperty("errorType", error.getClass().getName());
        response.add("partialSites", oracle.snapshot());
      }
      System.out.println(response.toString());
    }
  }
}
`;
  const bean = read('app/src/main/java/com/github/tvbox/osc/bean/SourceBean.java');
  writeFileSync(resolve(build, 'AndroidOracle.java'), source);
  writeFileSync(resolve(build, 'SourceBean.java'), bean);
  writeFileSync(resolve(build, 'UriUtil.java'), uri);
  writeFileSync(resolve(build, 'AES.java'), read('app/src/main/java/com/github/tvbox/osc/util/AES.java'));
  const parseBean = readFileSync(resolve(platform.extra, 'app/src/main/java/com/github/tvbox/osc/bean/ParseBean.java'), 'utf8')
    .replace('package com.github.tvbox.osc.bean;', '').replace('import com.github.tvbox.osc.util.DefaultConfig;', '');
  writeFileSync(resolve(build, 'ParseBean.java'), parseBean);
  const gson = process.env.TVBOX_GSON_JAR || resolve(root, '.tools/lib/gson-2.10.1.jar');
  if (!existsSync(gson)) throw new Error('Gson 2.10.1 missing; see docs/linux/environment.md');
  const integrity = JSON.parse(readFileSync(resolve(root, 'compat/toolchain-integrity.json'), 'utf8'));
  if (sha256(readFileSync(gson)) !== integrity.gson.sha256) throw new Error('Gson jar checksum differs from baseline');
  const bc = process.env.TVBOX_BC_JAR || resolve(root, '.tools/lib/bcprov-jdk18on-1.78.1.jar');
  if (!existsSync(bc) || sha256(readFileSync(bc)) !== integrity.bouncyCastle.sha256) throw new Error('Bouncy Castle missing or checksum differs');
  const compile = spawnSync(command('javac'), ['-encoding', 'UTF-8', '-cp', [gson, bc].join(delimiter), '-d', build,
    resolve(build, 'AndroidOracle.java'), resolve(build, 'SourceBean.java'), resolve(build, 'UriUtil.java'), resolve(build, 'AES.java'), resolve(build, 'ParseBean.java'), ...platform.sources], { encoding: 'utf8' });
  if (compile.error || compile.status !== 0) throw new Error(`Oracle compile failed: ${compile.error || compile.stderr}`);
  const extraction = { commit: manifest.commit, siteLoop: { source: apiPath, sha256: sha256(siteLoop) },
    defaultMethods: methods.map((body, i) => ({ source: defaultPath, index: i, sha256: sha256(body) })),
    platformTag: platform.manifest.tag, cryptoProvider: 'Desktop Bouncy Castle 1.78.1, not Android provider',
    extendedMethods: [configUrl, decode, collection, clanContentFix, ...historyMethods].map(body => sha256(body)),
    stateMethods: state.originals.map(body => sha256(body)),
    vodPrefix: { sha256: sha256(vod.prefix), helpers: vod.helpers.map(body => sha256(body)), boundary: 'Before live/hosts/proxy/rules/doh/ads processing; selected reset adapter only' },
    loadScope: 'Original loadConfig with synchronous planned transport, temporary files/Hawk adapters, and source-fields parser substitute; no full ApiConfig or Android async execution',
    scope: 'Host-JVM execution of unchanged selected source methods plus fixed AOSP helpers. Not a full Android/ART execution.' };
  writeFileSync(resolve(build, 'extraction.json'), JSON.stringify(extraction, null, 2) + '\n');
  return { build, gson, bc, java: command('java'), extraction };
}

export function queryOracle(requests, built = buildOracle()) {
  const child = spawnSync(built.java, ['-Dfile.encoding=UTF-8', '-cp', [built.build, built.gson, built.bc].join(delimiter), 'AndroidOracle'], {
    input: requests.map(request => JSON.stringify(request)).join('\n') + '\n', encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024, timeout: 30000,
  });
  if (child.error || child.status !== 0) throw new Error(`Oracle execution failed: ${child.error || child.stderr}`);
  const result = child.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  if (result.length !== requests.length) throw new Error('Oracle result count differs');
  return result;
}
