// SPDX-License-Identifier: GPL-3.0-only
// Separate instrumentation APK. It executes the installed, unchanged upstream APK.
package com.github.tvbox.parity.oracle;

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

public final class OracleInstrumentation extends Instrumentation {
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

    @Override public void onCreate(Bundle args) {
        super.onCreate(args);
        arguments = args == null ? new Bundle() : args;
        start();
    }

    @Override public void onStart() {
        Bundle result = new Bundle();
        report = new JSONObject();
        int code = -1; // Activity.RESULT_OK, as expected by Android instrumentation.
        final List<File> jarFiles = new ArrayList<File>();
        Object loader = null;
        try {
            Context context = getTargetContext();
            ClassLoader appLoader = context.getClassLoader();
            report.put("schemaVersion", 1);
            report.put("scope", "Independent same-signature instrumentation in unchanged official APK on Android/ART; direct original JarLoader and Spider calls, not UI end-to-end parity");
            report.put("targetPackage", context.getPackageName());
            report.put("applicationUid", android.os.Process.myUid());
            report.put("applicationPid", android.os.Process.myPid());
            report.put("vmName", System.getProperty("java.vm.name"));
            report.put("vmVersion", System.getProperty("java.vm.version"));
            report.put("androidSdk", Build.VERSION.SDK_INT);
            report.put("androidRelease", Build.VERSION.RELEASE);
            report.put("abi", Build.CPU_ABI);
            String appDataPolicy = arguments.getString("appDataPolicy", "cold-process-preserve-data");
            if (!"fresh-app-data".equals(appDataPolicy) && !"cold-process-preserve-data".equals(appDataPolicy)) throw new IllegalArgumentException("Invalid application state policy");
            report.put("applicationStatePolicy", appDataPolicy);
            callTimeoutMs = Long.parseLong(arguments.getString("callTimeoutMs", "30000"));
            loadTimeoutMs = Long.parseLong(arguments.getString("loadTimeoutMs", String.valueOf(callTimeoutMs)));
            initTimeoutMs = Long.parseLong(arguments.getString("initTimeoutMs", String.valueOf(callTimeoutMs)));
            long caseTimeoutMs = Long.parseLong(arguments.getString("caseTimeoutMs", "240000"));
            for (long budget : new long[]{callTimeoutMs, loadTimeoutMs, initTimeoutMs}) if (budget < 100 || budget > 180000) throw new IllegalArgumentException("Invalid stage timeout");
            if (caseTimeoutMs < 100 || caseTimeoutMs > 3600000) throw new IllegalArgumentException("Invalid case timeout");
            caseDeadline = System.currentTimeMillis() + caseTimeoutMs;
            report.put("budgets", new JSONObject().put("caseMs", caseTimeoutMs).put("loadMs", loadTimeoutMs).put("initMs", initTimeoutMs).put("callMs", callTimeoutMs));
            phase = "symbol-binding";
            InputStream mapInput = getContext().getAssets().open("jar-loader-symbol-map.json");
            byte[] symbolBytes;
            try { symbolBytes = readAll(mapInput, 1024 * 1024); } finally { mapInput.close(); }
            symbols = new JSONObject(new String(symbolBytes, UTF8));
            String installedSha256 = fileSha256(new File(context.getApplicationInfo().sourceDir));
            if (!installedSha256.equals(symbols.getString("apkSha256"))) throw new IllegalArgumentException("Installed APK differs from audited loader map");
            report.put("targetApkSha256", installedSha256);
            report.put("symbolMapSha256", sha256(symbolBytes));
            report.put("knownVersionDifference", symbols.getString("knownVersionDifference"));

            phase = "manifest";
            String manifestUrl = arguments.getString("manifestUrl");
            if (manifestUrl == null) throw new IllegalArgumentException("manifestUrl is required");
            byte[] planBytes = download(manifestUrl, 16 * 1024 * 1024);
            String requestedPlanSha256 = arguments.getString("manifestSha256");
            if (requestedPlanSha256 != null && !requestedPlanSha256.equals(sha256(planBytes))) {
                throw new IllegalArgumentException("Manifest checksum differs");
            }
            JSONObject plan = new JSONObject(new String(planBytes, UTF8));
            if (plan.optInt("schemaVersion", 1) != 1) throw new IllegalArgumentException("Unsupported manifest schema");
            int artifactIndex = Integer.parseInt(arguments.getString("artifactIndex", "0"));
            int siteIndex = Integer.parseInt(arguments.getString("siteIndex", "0"));
            JSONObject artifact = plan.getJSONArray("artifacts").getJSONObject(artifactIndex);
            JSONObject site = artifact.getJSONArray("sites").getJSONObject(siteIndex);
            Object extObject = site.opt("ext");
            if (extObject != null && extObject != JSONObject.NULL && !(extObject instanceof String)) {
                throw new IllegalArgumentException("ext must be the final exact string");
            }
            String ext = site.optString("ext", "");
            String extSha256 = sha256(ext.getBytes(UTF8));
            if (site.has("extSha256") && !site.getString("extSha256").equals(extSha256)) {
                throw new IllegalArgumentException("Ext checksum differs");
            }
            report.put("manifestSha256", sha256(planBytes));
            report.put("artifactIndex", artifactIndex);
            report.put("siteIndex", siteIndex);
            report.put("id", safeLabel(artifact.optString("id", "artifact-" + artifactIndex)));
            report.put("siteKey", safeLabel(site.optString("key", "site-" + siteIndex)));
            report.put("api", safeLabel(site.getString("api")));
            report.put("extSha256", extSha256);
            if (artifact.has("configSha256")) report.put("configSha256", artifact.getString("configSha256"));
            if (site.has("configSha256")) report.put("configSha256", site.getString("configSha256"));
            final JSONObject contextPlan = site.optJSONObject("loaderContext");
            if (site.has("loaderContext") && contextPlan == null) throw new IllegalArgumentException("Invalid loader context object");
            final String role = contextPlan == null ? "main" : contextPlan.getString("role");
            final String signature = contextPlan == null ? "" : contextPlan.getString("signature");
            if (!"main".equals(role) && !"site".equals(role)) throw new IllegalArgumentException("Invalid loader role");
            final String sourceJar = "site".equals(role) ? signature : "";
            if (contextPlan != null && (!(site.opt("jar") instanceof String) || !sourceJar.equals(site.getString("jar")))) throw new IllegalArgumentException("Original site signature differs");
            if ("site".equals(role) && signature.length() == 0) throw new IllegalArgumentException("Missing site signature");
            JSONObject mainPlan = contextPlan == null ? null : contextPlan.optJSONObject("main");
            if (contextPlan != null && contextPlan.has("main") && mainPlan == null) throw new IllegalArgumentException("Invalid main artifact object");
            if (mainPlan != null && !"site".equals(role)) throw new IllegalArgumentException("Main role has secondary main artifact");
            final Class<?> loaderClass = appLoader.loadClass(symbols.getString("loaderClass"));
            loader = loaderClass.newInstance();
            final Object originalLoader = loader;
            final Method jarKeyMethod = declared(loaderClass, symbols.getJSONObject("methods").getString("jarKey"), String.class);
            final String loadKey = "main".equals(role) ? "main" : (String) jarKeyMethod.invoke(originalLoader, signature);
            report.put("loaderMode", role);
            report.put("jarSignatureSha256", sha256(signature.getBytes(UTF8)));
            report.put("jarLoadKey", loadKey);
            report.put("mainJarSha256", mainPlan == null ? JSONObject.NULL : mainPlan.getString("sha256"));
            report.put("mainSignatureSha256", mainPlan == null ? JSONObject.NULL : sha256(mainPlan.getString("signature").getBytes(UTF8)));
            JSONObject expectedIdentity = site.optJSONObject("expectedLoaderIdentity");
            if (site.has("expectedLoaderIdentity") && expectedIdentity == null) throw new IllegalArgumentException("Invalid planned loader identity");
            if (expectedIdentity != null) for (String field : new String[]{"loaderMode", "jarSignatureSha256", "jarLoadKey", "mainJarSha256", "mainSignatureSha256"}) {
                if (!expectedIdentity.has(field) || !expectedIdentity.get(field).equals(report.get(field))) throw new IllegalArgumentException("Loader identity differs: " + field);
            }
            report.put("jarSha256", artifact.getString("sha256"));
            File cache = new File(context.getCacheDir(), "parity-oracle");
            if (!cache.isDirectory() && !cache.mkdirs()) throw new IllegalStateException("Cannot create oracle cache");
            phase = "jar-download";
            final File jar = capturedJar(artifact, cache, "selected-", jarFiles);
            report.put("jarBytes", jar.length());
            report.put("jarBytesVerified", true);
            File mainJar = null;
            if (mainPlan != null) {
                phase = "main-download";
                mainJar = capturedJar(mainPlan, cache, "main-", jarFiles);
                report.put("mainJarBytes", mainJar.length());
                report.put("mainJarBytesVerified", true);
            }
            // Verify both frozen artifacts before either can execute.
            if (mainJar != null) {
                phase = "main-load";
                final String mainPath = mainJar.getAbsolutePath();
                JSONObject observation = new JSONObject().put("attempted", true);
                report.put("mainLoad", observation);
                long started = System.currentTimeMillis();
                Object loadedMain = within(new Callable<Object>() {
                    @Override public Object call() throws Exception {
                        return loaderClass.getMethod(symbols.getJSONObject("methods").getString("loadMain"), String.class).invoke(originalLoader, mainPath);
                    }
                }, loadTimeoutMs);
                observation.put("milliseconds", System.currentTimeMillis() - started).put("loaded", Boolean.TRUE.equals(loadedMain));
                if (!Boolean.TRUE.equals(loadedMain)) throw new IllegalStateException("MAIN_JAR_LOAD_FAILED");
            }
            phase = "site".equals(role) ? "site-load" : "load";
            if ("site".equals(role)) {
                // Match parseJar's alias assignment before original initialization.
                String[] pieces = signature.split(";md5;");
                String source = pieces.length > 1 ? pieces[0] : signature;
                Field aliases = loaderClass.getDeclaredField(symbols.getJSONObject("fields").getString("aliases"));
                aliases.setAccessible(true);
                @SuppressWarnings("unchecked") Map<String, String> values = (Map<String, String>) aliases.get(originalLoader);
                values.put((String) jarKeyMethod.invoke(originalLoader, source), loadKey);
            }
            final JSONObject selectedLoad = new JSONObject().put("attempted", true);
            report.put("selectedLoad", selectedLoad);
            long loadStarted = System.currentTimeMillis();
            Object loaded = within(new Callable<Object>() {
                @Override public Object call() throws Exception {
                    if ("main".equals(role)) return loaderClass.getMethod(symbols.getJSONObject("methods").getString("loadMain"), String.class).invoke(originalLoader, jar.getAbsolutePath());
                    return declared(loaderClass, symbols.getJSONObject("methods").getString("loadKeyed"), String.class, File.class).invoke(originalLoader, loadKey, jar);
                }
            }, loadTimeoutMs);
            report.put("loadMs", System.currentTimeMillis() - loadStarted);
            report.put("loadSuccess", Boolean.TRUE.equals(loaded));
            selectedLoad.put("milliseconds", System.currentTimeMillis() - loadStarted).put("loaded", Boolean.TRUE.equals(loaded));
            if (!Boolean.TRUE.equals(loaded)) throw new IllegalStateException("JAR_LOAD_FAILED");
            report.put("loaderState", loaderState(loaderClass, originalLoader));
            final String key = site.optString("key", "site-" + siteIndex);
            final String api = site.getString("api");
            final String finalExt = ext;
            phase = "init";
            long initStarted = System.currentTimeMillis();
            final Object spider = within(new Callable<Object>() {
                @Override public Object call() throws Exception {
                    return loaderClass.getMethod(symbols.getJSONObject("methods").getString("getSpider"), String.class, String.class, String.class, String.class)
                        .invoke(originalLoader, key, api, finalExt, sourceJar);
                }
            }, initTimeoutMs);
            report.put("initMs", System.currentTimeMillis() - initStarted);
            report.put("spiderClass", spider == null ? JSONObject.NULL : spider.getClass().getName());
            if (spider == null || spider.getClass().getName().endsWith(".SpiderNull")) throw new IllegalStateException("SPIDER_NOT_READY");
            report.put("initSuccess", true);
            report.put("loaderState", loaderState(loaderClass, originalLoader));

            JSONArray explicitCalls = site.optJSONArray("calls");
            if (explicitCalls == null) explicitCalls = artifact.optJSONArray("calls");
            if (explicitCalls != null) {
                if (explicitCalls.length() > 20) throw new IllegalArgumentException("Too many calls");
                for (int i = 0; i < explicitCalls.length(); i++) {
                    JSONObject call = explicitCalls.getJSONObject(i);
                    runCall(spider, call.getString("method"), call.optJSONArray("params"));
                }
            } else {
                String home = runCall(spider, "homeContent", new JSONArray().put(true));
                JSONObject homeJson = objectOrNull(home);
                JSONArray classes = homeJson == null ? null : homeJson.optJSONArray("class");
                if (enabled("autoCategory") && classes != null && classes.length() > 0 && !timedOut) {
                    String tid = classes.getJSONObject(0).getString("type_id");
                    String category = runCall(spider, "categoryContent", new JSONArray().put(tid).put("1").put(true).put(new JSONObject()));
                    JSONObject categoryJson = objectOrNull(category);
                    JSONArray list = categoryJson == null ? null : categoryJson.optJSONArray("list");
                    if (enabled("autoDetail") && list != null && list.length() > 0 && !timedOut) {
                        String vod = list.getJSONObject(0).getString("vod_id");
                        runCall(spider, "detailContent", new JSONArray().put(new JSONArray().put(vod)));
                    }
                }
            }
            report.put("completed", !timedOut);
            if (timedOut) code = 0;
        } catch (Throwable error) {
            code = 0;
            try { report.put("error", errorMetadata(error).put("stage", phase)); } catch (Exception ignored) { }
        } finally {
            // A timed-out native call may ignore interruption: do not race clear()/delete().
            if (!timedOut) {
                if (loader != null) try {
                    final Object finalLoader = loader;
                    within(new Callable<Object>() {
                        @Override public Object call() throws Exception {
                            finalLoader.getClass().getMethod(symbols.getJSONObject("methods").getString("clear")).invoke(finalLoader);
                            return null;
                        }
                    });
                } catch (Throwable ignored) { }
                if (!timedOut) for (File jarFile : jarFiles) jarFile.delete();
            }
            executor.shutdownNow();
            try {
                report.put("calls", publicCalls);
                report.put("timedOut", timedOut);
                File outputRoot = new File(getTargetContext().getExternalFilesDir(null), "parity-oracle");
                if (!outputRoot.isDirectory() && !outputRoot.mkdirs()) throw new IllegalStateException("Cannot create output directory");
                String name = "result-" + report.optInt("artifactIndex", 0) + "-" + report.optInt("siteIndex", 0) + ".json";
                File output = new File(outputRoot, name);
                JSONObject privateResult = new JSONObject().put("report", report).put("privateCalls", privateCalls);
                write(output, privateResult.toString().getBytes(UTF8));
                result.putString("privateResultPath", output.getAbsolutePath());
                result.putString("report", report.toString());
            } catch (Throwable error) {
                code = 0;
                result.putString("report", report.toString());
                result.putString("outputErrorType", error.getClass().getName());
            }
            finish(code, result);
        }
    }

    private boolean enabled(String name) { return !"false".equalsIgnoreCase(arguments.getString(name, "true")); }

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
            } else throw new IllegalArgumentException("Unsupported method or signature");
            Object returned = within(new Callable<Object>() {
                @Override public Object call() throws Exception { return method.invoke(spider, values); }
            });
            if (!(returned instanceof String)) throw new IllegalStateException("INVALID_RESULT");
            value = (String) returned;
            privateCall.put("value", value);
            metadata.put("response", summarize(value));
            metadata.put("success", true);
        } catch (Throwable error) {
            metadata.put("success", false);
            metadata.put("error", errorMetadata(error).put("stage", name));
            privateCall.put("error", errorMetadata(error).put("stage", name));
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
        Object parsed = new JSONTokener(value).nextValue();
        if (!(parsed instanceof JSONObject)) throw new IllegalStateException("INVALID_JSON_OBJECT");
        JSONObject json = (JSONObject) parsed;
        result.put("semanticSha256", sha256(canonical(json).getBytes(UTF8)));
        result.put("fields", json.length());
        result.put("emptyObject", json.length() == 0);
        JSONArray classes = json.optJSONArray("class");
        JSONArray list = json.optJSONArray("list");
        JSONObject filters = json.optJSONObject("filters");
        result.put("classes", classes == null ? JSONObject.NULL : classes.length());
        result.put("list", list == null ? JSONObject.NULL : list.length());
        result.put("filterGroups", filters == null ? JSONObject.NULL : filters.length());
        result.put("hasContent", classes != null && classes.length() > 0 || list != null && list.length() > 0);
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
