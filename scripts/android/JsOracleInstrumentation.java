// SPDX-License-Identifier: GPL-3.0-only
// Independent JS instrumentation in the unchanged official APK; exact static input mapping only.
package com.github.tvbox.parity.jsoracle;

import android.app.Instrumentation;
import android.content.Context;
import android.os.Build;
import android.os.Bundle;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Field;
import java.lang.reflect.Proxy;
import java.lang.reflect.InvocationHandler;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.Charset;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

public final class JsOracleInstrumentation extends Instrumentation {
    private static final Charset UTF8 = Charset.forName("UTF-8");
    private static final int MAX_BYTES = 128 * 1024 * 1024;
    private Bundle arguments;
    private JSONObject report;
    private final JSONArray privateCalls = new JSONArray();
    private final JSONArray publicCalls = new JSONArray();
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private long callTimeoutMs = 30000;
    private long loadTimeoutMs = 30000;
    private long initTimeoutMs = 30000;
    private long caseDeadline = Long.MAX_VALUE;
    private boolean timedOut;
    private String phase = "start";
    private JSONObject symbols;
    private Class<?> baseSpiderClass;
    private String discoveryStep;

    @Override public void onCreate(Bundle args) {
        super.onCreate(args);
        arguments = args == null ? new Bundle() : args;
        start();
    }

    private final Map<String, byte[]> fixtureBodies = new HashMap<String, byte[]>();
    private final Map<String, JSONObject> fixtureMetadata = new HashMap<String, JSONObject>();
    private final Map<String, Integer> fixtureHits = new HashMap<String, Integer>();
    private final List<Field> patchedFields = new ArrayList<Field>();
    private final List<Object> previousClients = new ArrayList<Object>();
    private final Map<File, byte[]> previousCache = new HashMap<File, byte[]>();
    private final JSONArray moduleObservations = new JSONArray();
    private long fixtureBytes;
    private final JSONArray networkObservations = new JSONArray();

    @Override public void onStart() {
        Bundle result = new Bundle();report = new JSONObject();int code = -1;Object loader = null;
        try {
            final Context context = getTargetContext();final ClassLoader appLoader = context.getClassLoader();
            callTimeoutMs = Long.parseLong(arguments.getString("callTimeoutMs", "12000"));
            loadTimeoutMs = Long.parseLong(arguments.getString("initTimeoutMs", "90000"));
            long caseTimeoutMs = Long.parseLong(arguments.getString("caseTimeoutMs", "300000"));
            for (long budget : new long[]{callTimeoutMs, loadTimeoutMs, caseTimeoutMs}) if (budget < 100 || budget > 3600000) throw new IllegalArgumentException("Invalid timeout");
            caseDeadline = System.currentTimeMillis() + caseTimeoutMs;
            report.put("schemaVersion", 1).put("scope", "Original official JsLoader and JsSpider on Android/ART; frozen static modules/GET fixtures, other business HTTP live; no media execution")
                .put("applicationUid", android.os.Process.myUid()).put("applicationPid", android.os.Process.myPid()).put("targetPackage", context.getPackageName())
                .put("androidSdk", Build.VERSION.SDK_INT).put("abi", Build.CPU_ABI).put("vmName", System.getProperty("java.vm.name"))
                .put("applicationStatePolicy", arguments.getString("appDataPolicy", "fresh-app-data"))
                .put("budgets", new JSONObject().put("caseMs", caseTimeoutMs).put("initMs", loadTimeoutMs).put("callMs", callTimeoutMs));
            phase = "symbol-binding";
            InputStream symbolInput = getContext().getAssets().open("js-symbol-map.json");byte[] symbolBytes;
            try { symbolBytes = readAll(symbolInput, 1024 * 1024); } finally { symbolInput.close(); }
            symbols = new JSONObject(new String(symbolBytes, UTF8));
            String installed = fileSha256(new File(context.getApplicationInfo().sourceDir));
            if (!installed.equals(symbols.getString("apkSha256"))) throw new IllegalArgumentException("Installed APK differs from audited symbols");
            report.put("targetApkSha256", installed).put("symbolMapSha256", sha256(symbolBytes));
            phase = "manifest";
            String manifestUrl = arguments.getString("manifestUrl");if (manifestUrl == null) throw new IllegalArgumentException("Manifest URL required");
            byte[] planBytes = download(manifestUrl, 16 * 1024 * 1024);
            if (!sha256(planBytes).equals(arguments.getString("manifestSha256"))) throw new IllegalArgumentException("Manifest checksum differs");
            JSONObject plan = new JSONObject(new String(planBytes, UTF8));
            if (plan.getInt("schemaVersion") != 1) throw new IllegalArgumentException("Unsupported plan schema");
            int sourceIndex = Integer.parseInt(arguments.getString("sourceIndex", "0"));
            JSONObject source = plan.getJSONArray("sources").getJSONObject(sourceIndex);
            if (source.optInt("type", -1) != 3 || !(source.opt("api") instanceof String) || !(source.opt("key") instanceof String)
                || !(source.opt("ext") instanceof String)) throw new IllegalArgumentException("Exact type/key/api/ext source required");
            if (source.optString("jar", "").length() > 0) throw new IllegalArgumentException("HELPER_JAR_OUT_OF_SCOPE");
            report.put("manifestSha256", sha256(planBytes)).put("sourceIndex", sourceIndex).put("sourceSha256", sha256(canonical(source).getBytes(UTF8)))
                .put("siteKey", safeLabel(source.getString("key"))).put("api", safeLabel(source.getString("api")))
                .put("extSha256", sha256(source.getString("ext").getBytes(UTF8)));
            phase = "application-config-initialization";
            // Original ApiConfig construction synchronously clears loader caches
            // and installs local defaults. Perform it before creating our source,
            // as product configuration precedes getCSP; otherwise its first lazy
            // network access can cancel the newly created original JsSpider.
            appLoader.loadClass(symbols.getString("configClass")).getMethod(symbols.getJSONObject("methods").getString("configSingleton")).invoke(null);
            report.put("applicationConfigContext", "Original audited ApiConfig singleton initialized synchronously before original JsLoader; local default config only; source is passed unchanged directly and no subscription/JAR loading is requested");
            phase = "static-fixtures";
            JSONArray modules = plan.getJSONArray("modules");
            for (int i = 0; i < modules.length(); i++) {
                JSONObject module = modules.getJSONObject(i);byte[] bytes = frozenBytes(manifestUrl, module);
                String name = module.getString("url");
                if (!(name.startsWith("http://") || name.startsWith("https://"))) throw new IllegalArgumentException("Only captured HTTP modules supported");
                // Cache key/file resolution is delegated to the audited original APK.
                String key = (String) appLoader.loadClass(symbols.getString("md5Class")).getMethod(symbols.getJSONObject("methods").getString("md5"), String.class).invoke(null, name);
                File cache = (File) appLoader.loadClass(symbols.getString("fileClass")).getMethod(symbols.getJSONObject("methods").getString("cacheFile"), String.class).invoke(null, key);
                String root = context.getExternalCacheDir() == null ? context.getCacheDir().getCanonicalPath() : context.getExternalCacheDir().getCanonicalPath();
                if (!cache.getCanonicalPath().startsWith(root + File.separator)) throw new IllegalArgumentException("Module cache outside target cache");
                if (!previousCache.containsKey(cache)) previousCache.put(cache, cache.exists() ? readFile(cache, 16 * 1024 * 1024) : null);
                JSONObject cached = new JSONObject().put("expires", System.currentTimeMillis() / 1000 + 3600).put("data", new String(bytes, UTF8));
                if (!cache.getParentFile().isDirectory() && !cache.getParentFile().mkdirs()) throw new IllegalStateException("Cannot create cache parent");
                write(cache, cached.toString().getBytes(UTF8));
                moduleObservations.put(new JSONObject().put("urlSha256", sha256(name.getBytes(UTF8))).put("sha256", sha256(bytes)).put("bytes", bytes.length));
            }
            JSONObject http = plan.getJSONObject("http");if (!"frozen".equals(http.getString("mode"))) throw new IllegalArgumentException("Static fixture mode required");
            JSONArray fixtures = http.getJSONArray("fixtures");
            Class<?> urlClass = appLoader.loadClass("okhttp3.HttpUrl");
            for (int i = 0; i < fixtures.length(); i++) {
                JSONObject fixture = fixtures.getJSONObject(i);
                if (!"GET".equals(fixture.getString("method"))) throw new IllegalArgumentException("Only exact static GET fixture supported");
                String url = String.valueOf(urlClass.getMethod("parse", String.class).invoke(null, fixture.getString("url")));
                byte[] bytes = frozenBytes(manifestUrl, fixture);
                if (fixtureBodies.containsKey(url) && !sha256(fixtureBodies.get(url)).equals(sha256(bytes))) throw new IllegalArgumentException("Conflicting static URL fixture");
                fixtureBodies.put(url, bytes);fixtureMetadata.put(url, fixture);fixtureHits.put(url, 0);
            }
            installHTTP(appLoader);
            // Verify original module resolution sees the exact frozen source text.
            for (int i = 0; i < modules.length(); i++) {
                JSONObject module = modules.getJSONObject(i);
                String resolved = (String) appLoader.loadClass(symbols.getString("fileClass")).getMethod(symbols.getJSONObject("methods").getString("loadModule"), String.class).invoke(null, module.getString("url"));
                if (resolved == null || !sha256(resolved.getBytes(UTF8)).equals(module.getString("sha256"))) throw new IllegalArgumentException("Original module loader resolved different bytes");
            }
            report.put("modules", moduleObservations).put("staticFixtureCount", fixtureBodies.size()).put("moduleBytesVerified", true)
                .put("httpMappingScope", "Exact captured GET URL to original bytes; original URLs/key/ext unchanged; all unmatched business requests proceed normally; no SSL policy changed");
            baseSpiderClass = appLoader.loadClass("com.github.catvod.crawler.Spider");
            final Class<?> loaderClass = appLoader.loadClass(symbols.getString("loaderClass"));loader = loaderClass.newInstance();
            final Object originalLoader = loader;final JSONObject selected = source;
            phase = "init";long started = System.currentTimeMillis();
            final Object spider = within(new Callable<Object>() { @Override public Object call() throws Exception {
                return loaderClass.getMethod("getSpider", String.class, String.class, String.class, String.class)
                    .invoke(originalLoader, selected.getString("key"), selected.getString("api"), selected.getString("ext"), "");
            } }, loadTimeoutMs);
            report.put("initMs", System.currentTimeMillis() - started).put("spiderClass", spider == null ? JSONObject.NULL : spider.getClass().getName());
            boolean ready = spider != null && spider.getClass().getName().equals(symbols.getString("spiderClass"));
            if (ready) { Field object = spider.getClass().getDeclaredField(symbols.getString("jsObjectField"));object.setAccessible(true);ready = object.get(spider) != null; }
            report.put("initSuccess", ready).put("loadSuccess", ready);
            if (!ready) throw new IllegalStateException("JS_SPIDER_NOT_READY");
            JSONArray calls = selected.optJSONArray("calls");
            if (calls != null) {
                if (calls.length() > 20) throw new IllegalArgumentException("Too many calls");
                for (int i = 0; i < calls.length() && !timedOut; i++) {
                    JSONObject call = calls.getJSONObject(i);discoveryStep = call.optString("discoveryStep", call.optJSONObject("metadata") == null ? null : call.getJSONObject("metadata").optString("discoveryStep", null));
                    runCall(spider, call.getString("method"), call.optJSONArray("params"));discoveryStep = null;
                }
            } else discoverBusiness(spider, selected.optString("businessSearchKeyword", plan.optString("businessSearchKeyword", "")));
            report.put("completed", !timedOut);if (timedOut) code = 0;
        } catch (Throwable error) { code = 0;try { report.put("error", errorMetadata(error).put("stage", phase)); } catch (Exception ignored) {} }
        finally {
            boolean cleaned = false;
            if (!timedOut) {
                try { if (loader != null) { final Object finalLoader = loader;within(new Callable<Object>() { @Override public Object call() throws Exception { finalLoader.getClass().getMethod("clear").invoke(finalLoader);return null; } }); } } catch (Throwable ignored) {}
                if (!timedOut) try {
                    for (int i = patchedFields.size() - 1; i >= 0; i--) patchedFields.get(i).set(null, previousClients.get(i));
                    for (Map.Entry<File, byte[]> cache : previousCache.entrySet()) { if (cache.getValue() == null) cache.getKey().delete();else write(cache.getKey(), cache.getValue()); }
                    cleaned = true;
                } catch (Throwable ignored) {}
            }
            executor.shutdownNow();
            try {
                JSONArray hits = new JSONArray();for (String url : fixtureHits.keySet()) hits.put(new JSONObject().put("urlSha256", sha256(url.getBytes(UTF8))).put("hits", fixtureHits.get(url)));
                report.put("staticFixtureHits", hits).put("unmappedHTTP", networkObservations).put("calls", publicCalls).put("timedOut", timedOut).put("cleanup", new JSONObject().put("restoredFixturesAndCaches", cleaned).put("forceStopRequired", timedOut));
                File root = new File(getTargetContext().getExternalFilesDir(null), "parity-js-oracle");if (!root.isDirectory() && !root.mkdirs()) throw new IllegalStateException("Cannot create result directory");
                File output = new File(root, "result-" + report.optInt("sourceIndex", 0) + ".json");
                write(output, new JSONObject().put("report", report).put("privateCalls", privateCalls).toString().getBytes(UTF8));
                result.putString("privateResultPath", output.getAbsolutePath());result.putString("report", report.toString());
            } catch (Throwable error) { code = 0;result.putString("report", report.toString());result.putString("outputErrorType", error.getClass().getName()); }
            finish(code, result);
        }
    }

    private byte[] frozenBytes(String manifestUrl, JSONObject entry) throws Exception {
        String path = entry.getString("path");
        if (!path.matches("[A-Za-z0-9_./-]+") || path.startsWith("/") || path.contains("..")) throw new IllegalArgumentException("Invalid frozen path");
        String url = new URL(new URL(manifestUrl), path).toString();
        byte[] bytes = download(url, 16 * 1024 * 1024);fixtureBytes += bytes.length;
        if (fixtureBytes > 128 * 1024 * 1024 || !sha256(bytes).equals(entry.getString("sha256")) || bytes.length != entry.getLong("bytes")) throw new IllegalArgumentException("Frozen input hash/size differs");
        return bytes;
    }

    private void installHTTP(final ClassLoader loader) throws Exception {
        final Class<?> interceptor = loader.loadClass("okhttp3.Interceptor"), chainClass = loader.loadClass("okhttp3.Interceptor$Chain");
        final Class<?> requestClass = loader.loadClass("okhttp3.Request"), responseBody = loader.loadClass("okhttp3.ResponseBody"), mediaType = loader.loadClass("okhttp3.MediaType");
        final Object proxy = Proxy.newProxyInstance(loader, new Class<?>[]{interceptor}, new InvocationHandler() { @Override public Object invoke(Object self, Method method, Object[] args) throws Throwable {
            if (method.getDeclaringClass() == Object.class) {
                if ("equals".equals(method.getName())) return self == args[0];if ("hashCode".equals(method.getName())) return System.identityHashCode(self);return "FrozenStaticInputInterceptor";
            }
            Object chain = args[0], request = chainClass.getMethod("request").invoke(chain);
            String url = String.valueOf(requestClass.getMethod("url").invoke(request));String verb = (String) requestClass.getMethod("method").invoke(request);
            if (!"GET".equals(verb) || !fixtureBodies.containsKey(url)) {
                JSONObject observation = new JSONObject().put("urlSha256", sha256(url.getBytes(UTF8))).put("method", verb);
                try {
                    Object response = chainClass.getMethod("proceed", requestClass).invoke(chain, request);
                    Class<?> responseClass = loader.loadClass("okhttp3.Response");observation.put("status", responseClass.getMethod("code").invoke(response));
                    Object body = responseClass.getMethod("body").invoke(response);
                    if (body != null) observation.put("declaredBytes", responseBody.getMethod("contentLength").invoke(body));
                    return response;
                } catch (InvocationTargetException error) { observation.put("error", errorMetadata(error));throw error.getCause(); }
                finally { synchronized (networkObservations) { networkObservations.put(observation); } }
            }
            JSONObject fixture = fixtureMetadata.get(url);synchronized (fixtureHits) { fixtureHits.put(url, fixtureHits.get(url) + 1); }
            Object builder = loader.loadClass("okhttp3.Response$Builder").newInstance();Class<?> builderClass = builder.getClass();
            builderClass.getMethod("request", requestClass).invoke(builder, request);
            Class<?> protocol = loader.loadClass("okhttp3.Protocol");builderClass.getMethod("protocol", protocol).invoke(builder, protocol.getField("HTTP_1_1").get(null));
            builderClass.getMethod("code", int.class).invoke(builder, fixture.getInt("status"));builderClass.getMethod("message", String.class).invoke(builder, "Frozen static input");
            JSONObject headers = fixture.optJSONObject("headers");String contentType = "application/octet-stream";
            if (headers != null) { Iterator<String> names = headers.keys();while (names.hasNext()) { String name = names.next();if ("content-type".equalsIgnoreCase(name)) contentType = headers.getString(name);builderClass.getMethod("addHeader", String.class, String.class).invoke(builder, name, headers.getString(name)); } }
            Object type = mediaType.getMethod("parse", String.class).invoke(null, contentType);
            Object body = responseBody.getMethod("create", mediaType, byte[].class).invoke(null, type, fixtureBodies.get(url));
            builderClass.getMethod("body", responseBody).invoke(builder, body);return builderClass.getMethod("build").invoke(builder);
        } });
        JSONArray fields = symbols.getJSONArray("clientFields");Class<?> clientClass = loader.loadClass("okhttp3.OkHttpClient");
        for (int i = 0; i < fields.length(); i++) {
            JSONObject fieldPlan = fields.getJSONObject(i);Class<?> owner = loader.loadClass(fieldPlan.getString("class"));
            if (fieldPlan.has("initialize")) owner.getMethod(fieldPlan.getString("initialize")).invoke(null);
            Field field = owner.getDeclaredField(fieldPlan.getString("field"));field.setAccessible(true);Object previous = field.get(null);
            if (previous == null || !clientClass.isInstance(previous)) throw new IllegalStateException("Audited HTTP client unavailable");
            Object builder = clientClass.getMethod("newBuilder").invoke(previous);
            builder.getClass().getMethod("addInterceptor", interceptor).invoke(builder, proxy);
            Object replacement = builder.getClass().getMethod("build").invoke(builder);patchedFields.add(field);previousClients.add(previous);field.set(null, replacement);
        }
    }

    private static byte[] readFile(File file, int limit) throws Exception {
        InputStream input = new FileInputStream(file);try { return readAll(input, limit); } finally { input.close(); }
    }
    private boolean enabled(String name) { return !"false".equalsIgnoreCase(arguments.getString(name, "true")); }

    // Every parameter comes from this source's ART responses, or an explicit test word.
    // The exact calls/values stay private and are replayed verbatim on NAS.
    private void discoverBusiness(Object spider, String keyword) throws Exception {
        JSONObject home = objectOrNull(businessCall(spider, "home", "homeContent", new JSONArray().put(true)));
        if (timedOut) return;
        JSONObject videos = objectOrNull(businessCall(spider, "home-video", "homeVideoContent", new JSONArray()));
        if (timedOut) return;
        JSONArray classes = home == null ? null : home.optJSONArray("class");
        JSONObject category = null;
        if (classes != null && classes.length() > 0 && classes.optJSONObject(0) != null && classes.optJSONObject(0).has("type_id")) {
            String tid = classes.getJSONObject(0).getString("type_id");
            category = objectOrNull(businessCall(spider, "category-page1", "categoryContent", new JSONArray().put(tid).put("1").put(true).put(new JSONObject())));
            if (timedOut) return;
            businessCall(spider, "category-page2", "categoryContent", new JSONArray().put(tid).put("2").put(true).put(new JSONObject()));
            if (timedOut) return;
            JSONObject filterValues = filterValues(home, tid);
            if (filterValues.length() > 0) businessCall(spider, "category-filter", "categoryContent", new JSONArray().put(tid).put("1").put(true).put(filterValues));
            else skipBusiness("category-filter", "categoryContent", "no-derived-filter-values");
        } else {
            for (String step : new String[]{"category-page1", "category-page2", "category-filter"}) skipBusiness(step, "categoryContent", "no-derived-category");
        }
        if (timedOut) return;
        JSONObject item = firstVideo(category, videos, home);
        JSONObject detail = null;
        if (item != null && item.has("vod_id")) detail = objectOrNull(businessCall(spider, "detail", "detailContent", new JSONArray().put(new JSONArray().put(item.getString("vod_id")))));
        else skipBusiness("detail", "detailContent", "no-derived-video-id");
        if (timedOut) return;
        if (keyword.trim().length() == 0 && item != null) keyword = item.optString("vod_name", "").trim();
        JSONObject search = null, searchPage = null;
        if (keyword.length() > 0) {
            search = objectOrNull(businessCall(spider, "search", "searchContent", new JSONArray().put(keyword).put(false)));
            if (timedOut) return;
            searchPage = objectOrNull(businessCall(spider, "search-page1", "searchContent", new JSONArray().put(keyword).put(false).put("1")));
        } else {
            skipBusiness("search", "searchContent", "no-derived-search-keyword");
            skipBusiness("search-page1", "searchContent", "no-derived-search-keyword");
        }
        if (timedOut) return;
        // A separate search-derived detail also tests IDs produced by search.
        JSONObject searched = firstVideo(search, searchPage);
        JSONObject searchedDetail = null;
        if (searched != null && searched.has("vod_id")) searchedDetail = objectOrNull(businessCall(spider, "search-detail", "detailContent", new JSONArray().put(new JSONArray().put(searched.getString("vod_id")))));
        else skipBusiness("search-detail", "detailContent", "no-derived-search-video-id");
        if (timedOut) return;
        JSONArray player = playerParameters(detail);
        if (player == null) player = playerParameters(searchedDetail);
        if (player != null) businessCall(spider, "player", "playerContent", player);
        else skipBusiness("player", "playerContent", "no-derived-playback-entry");
    }

    private String businessCall(Object spider, String step, String method, JSONArray params) throws Exception {
        discoveryStep = step;
        try { return runCall(spider, method, params); } finally { discoveryStep = null; }
    }

    private void skipBusiness(String step, String method, String reason) throws Exception {
        JSONArray params = new JSONArray();
        JSONObject metadata = new JSONObject().put("method", method).put("paramsSha256", sha256(canonical(params).getBytes(UTF8)))
            .put("discoveryStep", step).put("status", "not-tested").put("reason", reason).put("success", false).put("elapsedMs", 0);
        privateCalls.put(new JSONObject().put("method", method).put("params", params).put("metadata", metadata));
        publicCalls.put(metadata);
    }

    private static JSONObject firstVideo(JSONObject... responses) {
        for (JSONObject response : responses) {
            JSONArray list = response == null ? null : response.optJSONArray("list");
            if (list != null) for (int i = 0; i < list.length(); i++) {
                JSONObject item = list.optJSONObject(i);
                if (item != null && item.optString("vod_id", "").length() > 0) return item;
            }
        }
        return null;
    }

    private static JSONObject filterValues(JSONObject home, String tid) throws Exception {
        JSONObject values = new JSONObject(), filters = home == null ? null : home.optJSONObject("filters");
        JSONArray groups = filters == null ? null : filters.optJSONArray(tid);
        if (groups != null) for (int i = 0; i < groups.length(); i++) {
            JSONObject group = groups.optJSONObject(i);
            if (group == null || group.optString("key", "").length() == 0) continue;
            JSONArray options = group.optJSONArray("value");
            if (options == null) continue;
            for (int j = 0; j < options.length(); j++) {
                JSONObject option = options.optJSONObject(j);
                if (option != null && option.has("v") && option.optString("v", "").length() > 0) {
                    values.put(group.getString("key"), option.getString("v"));
                    break;
                }
            }
        }
        return values;
    }

    private static JSONArray playerParameters(JSONObject detail) throws Exception {
        JSONArray list = detail == null ? null : detail.optJSONArray("list");
        if (list == null) return null;
        for (int itemIndex = 0; itemIndex < list.length(); itemIndex++) {
            JSONObject item = list.optJSONObject(itemIndex);
            if (item == null) continue;
            String[] flags = item.optString("vod_play_from", "").split("\\$\\$\\$", -1);
            String[] groups = item.optString("vod_play_url", "").split("\\$\\$\\$", -1);
            for (int i = 0; i < flags.length && i < groups.length; i++) {
                if (flags[i].length() == 0) continue;
                for (String episode : groups[i].split("#", -1)) {
                    int separator = episode.indexOf('$');
                    if (separator >= 0 && separator < episode.length() - 1) return new JSONArray().put(flags[i]).put(episode.substring(separator + 1)).put(new JSONArray());
                }
            }
        }
        return null;
    }

    private Object within(Callable<Object> operation) throws Exception {
        return within(operation, callTimeoutMs);
    }

    private Object within(Callable<Object> operation, long timeoutMs) throws Exception {
        long remaining = caseDeadline - System.currentTimeMillis();
        if (remaining <= 0) { timedOut = true; throw new TimeoutException("Case deadline exceeded"); }
        Future<Object> future = executor.submit(operation);
        try { return future.get(Math.min(timeoutMs, remaining), TimeUnit.MILLISECONDS); }
        catch (TimeoutException error) {
            timedOut = true;
            future.cancel(true);
            throw error;
        }
    }

    private String runCall(final Object spider, final String name, JSONArray suppliedParams) throws Exception {
        if (timedOut) throw new IllegalStateException("Previous call timed out");
        phase = name;
        final JSONArray params = suppliedParams == null ? new JSONArray() : suppliedParams;
        JSONObject metadata = new JSONObject();
        metadata.put("method", name);
        if (discoveryStep != null) metadata.put("discoveryStep", discoveryStep);
        metadata.put("paramsSha256", sha256(canonical(params).getBytes(UTF8)));
        JSONObject privateCall = new JSONObject().put("method", name).put("params", params);
        long started = System.currentTimeMillis();
        String value = null;
        try {
            final Method method;
            final Object[] values;
            if ("homeContent".equals(name)) {
                method = spider.getClass().getMethod(name, boolean.class);
                values = new Object[]{params.getBoolean(0)};
            } else if ("homeVideoContent".equals(name)) {
                method = spider.getClass().getMethod(name);
                values = new Object[]{};
            } else if ("categoryContent".equals(name)) {
                method = spider.getClass().getMethod(name, String.class, String.class, boolean.class, HashMap.class);
                JSONObject object = params.getJSONObject(3);
                HashMap<String, String> filters = new HashMap<String, String>();
                Iterator<String> keys = object.keys();
                while (keys.hasNext()) { String key = keys.next(); filters.put(key, object.getString(key)); }
                values = new Object[]{params.getString(0), params.getString(1), params.getBoolean(2), filters};
            } else if ("detailContent".equals(name)) {
                method = spider.getClass().getMethod(name, List.class);
                JSONArray array = params.getJSONArray(0);
                List<String> ids = new ArrayList<String>();
                for (int i = 0; i < array.length(); i++) ids.add(array.getString(i));
                values = new Object[]{ids};
            } else if ("searchContent".equals(name) && params.length() == 2) {
                method = spider.getClass().getMethod(name, String.class, boolean.class);
                values = new Object[]{params.getString(0), params.getBoolean(1)};
            } else if ("searchContent".equals(name) && params.length() == 3) {
                method = spider.getClass().getMethod(name, String.class, boolean.class, String.class);
                values = new Object[]{params.getString(0), params.getBoolean(1), params.getString(2)};
            } else if ("playerContent".equals(name)) {
                method = spider.getClass().getMethod(name, String.class, String.class, List.class);
                JSONArray array = params.getJSONArray(2);
                List<String> flags = new ArrayList<String>();
                for (int i = 0; i < array.length(); i++) flags.add(array.getString(i));
                values = new Object[]{params.getString(0), params.getString(1), flags};
            } else throw new IllegalArgumentException("Unsupported method or signature");
            boolean inherited = method.getDeclaringClass() == baseSpiderClass;
            boolean delegates = inherited && "searchContent".equals(name) && params.length() == 3;
            if (delegates) inherited = spider.getClass().getMethod(name, String.class, boolean.class).getDeclaringClass() == baseSpiderClass;
            metadata.put("methodProvenance", new JSONObject().put("declaringClass", method.getDeclaringClass().getName())
                .put("baseSpiderClass", baseSpiderClass.getName()).put("inheritedBaseDefault", inherited).put("baseDelegatingOverload", delegates && !inherited));
            Object returned = within(new Callable<Object>() {
                @Override public Object call() throws Exception { return method.invoke(spider, values); }
            });
            if (!(returned instanceof String)) {
                privateCall.put("value", returned == null ? JSONObject.NULL : String.valueOf(returned));
                metadata.put("success", false).put("status", "invalid-json").put("resultType", returned == null ? "null" : returned.getClass().getName());
                return null;
            }
            value = (String) returned;
            privateCall.put("value", value);
            JSONObject response = summarize(value);
            metadata.put("response", response);
            boolean valid = response.optBoolean("jsonValid", false);
            boolean empty = value.trim().length() == 0;
            metadata.put("success", (valid || empty) && !inherited);
            metadata.put("status", inherited ? "not-implemented" : empty ? "empty" : !valid ? "invalid-json" : response.optBoolean("hasContent", false) ? "nonempty" : "empty");
        } catch (Throwable error) {
            metadata.put("success", false);
            JSONObject failure = errorMetadata(error).put("stage", name);
            String type = failure.optString("type", "");
            metadata.put("status", timedOut ? "timeout" : type.matches(".*(UnknownHost|ConnectException|SSL|Socket|HttpRetry).*?") ? "network" : "failed");
            metadata.put("error", failure);
            privateCall.put("error", failure);
        } finally {
            metadata.put("elapsedMs", System.currentTimeMillis() - started);
            privateCall.put("metadata", metadata);
            privateCalls.put(privateCall);
            publicCalls.put(metadata);
            Bundle progress = new Bundle();
            progress.putString("call", metadata.toString());
            sendStatus(0, progress);
        }
        return value;
    }

    private static JSONObject summarize(String value) throws Exception {
        JSONObject result = new JSONObject();
        result.put("bytes", value.getBytes(UTF8).length);
        result.put("sha256", sha256(value.getBytes(UTF8)));
        Object parsed;
        try { parsed = new JSONTokener(value).nextValue(); }
        catch (Exception error) { return result.put("jsonValid", false); }
        if (!(parsed instanceof JSONObject)) return result.put("jsonValid", false);
        JSONObject json = (JSONObject) parsed;
        result.put("jsonValid", true);
        result.put("semanticSha256", sha256(canonical(json).getBytes(UTF8)));
        result.put("fields", json.length());
        result.put("emptyObject", json.length() == 0);
        JSONArray classes = json.optJSONArray("class");
        JSONArray list = json.optJSONArray("list");
        JSONObject filters = json.optJSONObject("filters");
        result.put("classes", classes == null ? JSONObject.NULL : classes.length());
        result.put("list", list == null ? JSONObject.NULL : list.length());
        result.put("filterGroups", filters == null ? JSONObject.NULL : filters.length());
        result.put("hasContent", classes != null && classes.length() > 0 || list != null && list.length() > 0 || json.optString("url", "").length() > 0);
        result.put("playbackUrlPresent", json.optString("url", "").length() > 0);
        for (String field : new String[]{"class", "filters"}) {
            if (json.has(field)) result.put(field + "Sha256", sha256(canonical(json.get(field)).getBytes(UTF8)));
        }
        return result;
    }

    private static JSONObject objectOrNull(String value) {
        try { return value == null ? null : new JSONObject(value); } catch (Exception ignored) { return null; }
    }

    private static JSONObject errorMetadata(Throwable value) throws Exception {
        Throwable error = value;
        while ((error instanceof InvocationTargetException || error instanceof java.util.concurrent.ExecutionException) && error.getCause() != null) error = error.getCause();
        String message = error.getMessage() == null ? "" : error.getMessage();
        return new JSONObject().put("type", error.getClass().getName())
            .put("fingerprint", sha256((error.getClass().getName() + "\n" + message).getBytes(UTF8)));
    }

    private static Method declared(Class<?> type, String name, Class<?>... parameters) throws Exception {
        Method method = type.getDeclaredMethod(name, parameters);
        method.setAccessible(true);
        return method;
    }

    private JSONObject loaderState(Class<?> type, Object loader) throws Exception {
        JSONObject fields = symbols.getJSONObject("fields"), result = new JSONObject();
        for (String name : new String[]{"loaders", "aliases", "siteJarKeys"}) {
            Field field = type.getDeclaredField(fields.getString(name));
            field.setAccessible(true);
            Map<?, ?> values = (Map<?, ?>) field.get(loader);
            result.put(name + "Count", values.size());
            if ("loaders".equals(name)) {
                List<String> keys = new ArrayList<String>();
                for (Object key : values.keySet()) keys.add(sha256(String.valueOf(key).getBytes(UTF8)));
                Collections.sort(keys);
                result.put("loaderKeysSha256", new JSONArray(keys));
            }
        }
        Field recent = type.getDeclaredField(fields.getString("recent"));
        recent.setAccessible(true);
        return result.put("recentKeySha256", sha256(String.valueOf(recent.get(loader)).getBytes(UTF8)));
    }

    private File capturedJar(JSONObject input, File cache, String prefix, List<File> owned) throws Exception {
        String expected = input.getString("sha256");
        if (!expected.matches("[a-f0-9]{64}")) throw new IllegalArgumentException("Invalid JAR hash");
        byte[] bytes = download(input.getString("jarUrl"), MAX_BYTES);
        if (!expected.equals(sha256(bytes))) throw new IllegalArgumentException("JAR checksum differs");
        File file = new File(cache, prefix + expected + ".jar");
        if (file.exists() && !file.delete()) throw new IllegalStateException("Cannot replace oracle cache");
        owned.add(file);
        write(file, bytes);
        if (!file.setReadOnly()) throw new IllegalStateException("Cannot protect oracle cache");
        return file;
    }

    private static byte[] readAll(InputStream stream, int maxBytes) throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int count;
        while ((count = stream.read(buffer)) >= 0) {
            if (bytes.size() + count > maxBytes) throw new IllegalArgumentException("Input too large");
            bytes.write(buffer, 0, count);
        }
        return bytes.toByteArray();
    }

    private static String fileSha256(File path) throws Exception {
        FileInputStream stream = new FileInputStream(path);
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try { byte[] buffer = new byte[8192]; int count; while ((count = stream.read(buffer)) >= 0) digest.update(buffer, 0, count); }
        finally { stream.close(); }
        return hex(digest.digest());
    }

    private byte[] download(String address, int maxBytes) throws Exception {
        long remaining = caseDeadline - System.currentTimeMillis();
        if (remaining <= 0) { timedOut = true; throw new TimeoutException("Case deadline exceeded"); }
        HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection();
        connection.setConnectTimeout((int) Math.min(15000, remaining));
        connection.setReadTimeout((int) Math.min(45000, remaining));
        connection.setRequestProperty("User-Agent", "TVBox-ART-Parity/1");
        connection.setInstanceFollowRedirects(true);
        try {
            if (connection.getResponseCode() != 200) throw new IllegalStateException("HTTP fetch failed");
            if (connection.getContentLength() > maxBytes) throw new IllegalStateException("Input too large");
            InputStream stream = connection.getInputStream();
            try {
                ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                byte[] buffer = new byte[8192];
                int count;
                while ((count = stream.read(buffer)) >= 0) {
                    if (System.currentTimeMillis() >= caseDeadline) { timedOut = true; throw new TimeoutException("Case deadline exceeded"); }
                    if (bytes.size() + count > maxBytes) throw new IllegalStateException("Input too large");
                    bytes.write(buffer, 0, count);
                }
                return bytes.toByteArray();
            } finally { stream.close(); }
        } finally { connection.disconnect(); }
    }

    private static void write(File path, byte[] bytes) throws Exception {
        FileOutputStream output = new FileOutputStream(path);
        try { output.write(bytes); } finally { output.close(); }
    }

    private static String sha256(byte[] value) throws Exception {
        return hex(MessageDigest.getInstance("SHA-256").digest(value));
    }

    private static String hex(byte[] bytes) {
        StringBuilder result = new StringBuilder();
        for (byte b : bytes) result.append(String.format(java.util.Locale.US, "%02x", b & 255));
        return result.toString();
    }

    private static String safeLabel(String value) throws Exception {
        if (value.length() > 160 || value.matches("(?is).*(https?:|://|[?=&\\r\\n]|bearer\\s|token[:\\s]).*")) return "sha256:" + sha256(value.getBytes(UTF8));
        return value;
    }

    // Keys sorted recursively. Host runner recomputes hashes with JS JSON.stringify
    // from private responses before making parity claims across JSON implementations.
    private static String canonical(Object value) throws Exception {
        if (value == null || value == JSONObject.NULL) return "null";
        if (value instanceof JSONObject) {
            JSONObject object = (JSONObject) value;
            List<String> keys = new ArrayList<String>();
            Iterator<String> iterator = object.keys();
            while (iterator.hasNext()) keys.add(iterator.next());
            Collections.sort(keys);
            StringBuilder result = new StringBuilder("{");
            for (int i = 0; i < keys.size(); i++) {
                if (i > 0) result.append(',');
                String key = keys.get(i);
                result.append(JSONObject.quote(key)).append(':').append(canonical(object.get(key)));
            }
            return result.append('}').toString();
        }
        if (value instanceof JSONArray) {
            JSONArray array = (JSONArray) value;
            StringBuilder result = new StringBuilder("[");
            for (int i = 0; i < array.length(); i++) {
                if (i > 0) result.append(',');
                result.append(canonical(array.get(i)));
            }
            return result.append(']').toString();
        }
        if (value instanceof String) return JSONObject.quote((String) value);
        if (value instanceof Number) return JSONObject.numberToString((Number) value);
        return String.valueOf(value);
    }
}
