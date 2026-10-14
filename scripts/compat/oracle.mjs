// Execute selected unchanged upstream methods with upstream Gson, not a JS mock.
// Generated Java/reference snapshots retain their upstream licensing.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, delimiter } from 'node:path';
import { spawnSync } from 'node:child_process';
import { root, reference, verifyReference, sha256 } from './reference.mjs';

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
  const build = resolve(root, '.cache/compat/oracle'); mkdirSync(build, { recursive: true });
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

class TextUtils { static boolean isEmpty(CharSequence s) { return s == null || s.length() == 0; } }
class LOG { static void i(String ignored) {} }
class ControlManager {
  static final ControlManager INSTANCE = new ControlManager();
  static String address = "http://127.0.0.1:9978/";
  static ControlManager get() { return INSTANCE; }
  String getAddress(boolean local) { return address; }
}
class DefaultConfig { ${methods.join('\n')} }

public class AndroidOracle {
  private final Gson gson = new Gson();
  private final LinkedHashMap<String, SourceBean> sourceBeanList = new LinkedHashMap<>();
  ${trim}
  ${fix}
  ${clan}
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
  private JsonElement run(JsonObject request) {
    String operation = request.get("operation").getAsString();
    String text = request.has("text") && !request.get("text").isJsonNull() ? request.get("text").getAsString() : null;
    if (operation.equals("sites")) return sites(text);
    if (operation.equals("json")) return gson.fromJson(text, JsonElement.class);
    if (operation.equals("trim")) return new JsonPrimitive(trimJsonObject(text));
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
  const gson = process.env.TVBOX_GSON_JAR || resolve(root, '.tools/lib/gson-2.10.1.jar');
  if (!existsSync(gson)) throw new Error('Gson 2.10.1 missing; see docs/linux/environment.md');
  const integrity = JSON.parse(readFileSync(resolve(root, 'compat/toolchain-integrity.json'), 'utf8'));
  if (sha256(readFileSync(gson)) !== integrity.gson.sha256) throw new Error('Gson jar checksum differs from baseline');
  const compile = spawnSync(command('javac'), ['-encoding', 'UTF-8', '-cp', gson, '-d', build,
    resolve(build, 'AndroidOracle.java'), resolve(build, 'SourceBean.java'), resolve(build, 'UriUtil.java')], { encoding: 'utf8' });
  if (compile.error || compile.status !== 0) throw new Error(`Oracle compile failed: ${compile.error || compile.stderr}`);
  const extraction = { commit: manifest.commit, siteLoop: { source: apiPath, sha256: sha256(siteLoop) },
    defaultMethods: methods.map((body, i) => ({ source: defaultPath, index: i, sha256: sha256(body) })),
    scope: 'Host-JVM execution of unchanged selected source methods. Not a full Android/ART execution.' };
  writeFileSync(resolve(build, 'extraction.json'), JSON.stringify(extraction, null, 2) + '\n');
  return { build, gson, java: command('java'), extraction };
}

export function queryOracle(requests, built = buildOracle()) {
  const child = spawnSync(built.java, ['-cp', [built.build, built.gson].join(delimiter), 'AndroidOracle'], {
    input: requests.map(request => JSON.stringify(request)).join('\n') + '\n', encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024, timeout: 30000,
  });
  if (child.error || child.status !== 0) throw new Error(`Oracle execution failed: ${child.error || child.stderr}`);
  const result = child.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  if (result.length !== requests.length) throw new Error('Oracle result count differs');
  return result;
}
