// SPDX-License-Identifier: GPL-3.0-only
// Independent instrumentation: invokes methods in the unchanged installed APK.
package com.github.tvbox.parity.parseroracle;

import android.app.Instrumentation;
import android.content.Context;
import android.os.Build;
import android.os.Bundle;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileInputStream;
import java.io.InputStream;
import java.lang.reflect.Field;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Proxy;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.Charset;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

public final class ParserInstrumentation extends Instrumentation {
    private static final Charset UTF8 = Charset.forName("UTF-8");
    private Bundle arguments;
    private final JSONObject report = new JSONObject();
    private final JSONObject privateResult = new JSONObject();
    private String phase = "start";
    private Object api;
    private Class<?> apiClass;
    private JSONObject symbols;
    private JSONObject methodNames;

    @Override public void onCreate(Bundle args) {
        super.onCreate(args);
        arguments = args == null ? new Bundle() : args;
        start();
    }

    @Override public void onStart() {
        Bundle result = new Bundle();
        int code = -1;
        try {
            Context context = getTargetContext();
            ClassLoader appLoader = context.getClassLoader();
            report.put("schemaVersion", 1);
            report.put("scope", "Original official APK ApiConfig preparation and parseJson on Android/ART; isolated fixed-byte network input; no parser replacement and no UI end-to-end claim");
            report.put("targetPackage", context.getPackageName());
            report.put("vmName", System.getProperty("java.vm.name"));
            report.put("vmVersion", System.getProperty("java.vm.version"));
            report.put("androidSdk", Build.VERSION.SDK_INT);
            report.put("androidRelease", Build.VERSION.RELEASE);
            report.put("abi", Build.CPU_ABI);
            report.put("normalizedScope", "globals and observable source fields in original insertion order; filterable optimized out by R8; host must recompute canonical JSON hashes from the private result");
            phase = "harnessSymbolBinding";
            InputStream symbolInput = getContext().getAssets().open("parser-symbol-map.json");
            byte[] symbolBytes;
            try { symbolBytes = readAll(symbolInput, 1024 * 1024); } finally { symbolInput.close(); }
            symbols = new JSONObject(new String(symbolBytes, UTF8));
            FileInputStream apkInput = new FileInputStream(context.getApplicationInfo().sourceDir);
            MessageDigest apkHash = MessageDigest.getInstance("SHA-256");
            try { byte[] buffer = new byte[8192]; int count; while ((count = apkInput.read(buffer)) >= 0) apkHash.update(buffer, 0, count); } finally { apkInput.close(); }
            StringBuilder actualApkHash = new StringBuilder();
            for (byte b : apkHash.digest()) actualApkHash.append(String.format(java.util.Locale.US, "%02x", b & 255));
            if (!symbols.getString("apkSha256").equals(actualApkHash.toString())) throw new IllegalArgumentException("Installed APK differs from statically audited symbol map");
            methodNames = symbols.getJSONObject("methods");
            report.put("targetApkSha256", actualApkHash.toString());
            report.put("symbolMapSha256", sha256(symbolBytes));
            report.put("unobservableFields", symbols.getJSONArray("optimizedOut"));
            privateResult.put("symbolMap", symbols);
            phase = "manifest";
            String manifestUrl = arguments.getString("manifestUrl");
            if (manifestUrl == null) throw new IllegalArgumentException("manifestUrl is required");
            byte[] planBytes = download(manifestUrl, 16 * 1024 * 1024);
            String manifestSha256 = sha256(planBytes);
            String expectedManifest = arguments.getString("manifestSha256");
            if (expectedManifest != null && !expectedManifest.equals(manifestSha256)) throw new IllegalArgumentException("Manifest checksum differs");
            JSONObject plan = new JSONObject(new String(planBytes, UTF8));
            if (plan.optInt("schemaVersion", 1) != 1) throw new IllegalArgumentException("Unsupported manifest schema");
            int configIndex = Integer.parseInt(arguments.getString("configIndex", "0"));
            JSONObject input = plan.getJSONArray("configs").getJSONObject(configIndex);
            String apiUrl = input.getString("apiUrl");
            String rawUrl = input.getString("rawUrl");
            String expectedRawHash = input.getString("rawSha256");
            if (!expectedRawHash.matches("[a-f0-9]{64}")) throw new IllegalArgumentException("Invalid rawSha256");
            report.put("manifestSha256", manifestSha256);
            report.put("configIndex", configIndex);
            report.put("idSha256", sha256(input.optString("id", "config-" + configIndex).getBytes(UTF8)));
            report.put("apiUrlSha256", sha256(apiUrl.getBytes(UTF8)));
            privateResult.put("input", input);
            phase = "rawDownload";
            byte[] raw = download(rawUrl, 16 * 1024 * 1024);
            if (!expectedRawHash.equals(sha256(raw))) throw new IllegalArgumentException("Raw configuration checksum differs");
            report.put("rawSha256", expectedRawHash);
            report.put("rawBytes", raw.length);

            phase = "originalConfigUrl";
            apiClass = appLoader.loadClass(symbols.getString("apiClass"));
            api = apiClass.getMethod(methodNames.getString("singleton")).invoke(null);
            String requestUrl = (String) invoke(methodNames.getString("configUrl"), new Class<?>[]{String.class}, apiUrl);
            String configKey = (String) field(apiClass, symbols.getJSONObject("apiFields").getString("configKey")).get(api);
            privateResult.put("requestUrl", requestUrl);
            privateResult.put("configKey", configKey == null ? JSONObject.NULL : configKey);
            report.put("requestUrlSha256", sha256(requestUrl.getBytes(UTF8)));
            report.put("hasConfigKey", configKey != null);
            privateResult.put("preferencesBefore", selectionPreferences(appLoader));

            // R8 inlined clanContentFix into the original fetch Runnable. Invoke
            // that original body, substituting only the fixture transport URL.
            // Its original API URL/key and every preparation operation stay intact.
            phase = "originalFetchPreparation";
            String prepared = originalFetch(appLoader, rawUrl, configKey, apiUrl);
            report.put("preparationMode", "original APK fetch Runnable; immutable hash-checked fixture transport URL; original API URL and key preserved");
            String preparedHash = sha256(prepared.getBytes(UTF8));
            report.put("configSha256", preparedHash);
            report.put("configBytes", prepared.getBytes(UTF8).length);
            privateResult.put("preparedText", prepared);
            if (input.has("configSha256") && !input.getString("configSha256").equals(preparedHash)) throw new IllegalArgumentException("Prepared configuration checksum differs");
            // This records the genuine preference-dependent live branch. It neither
            // edits the subscription nor changes Hawk to suppress original behavior.
            String liveApiUrl = privateResult.getJSONObject("preferencesBefore").optString("liveApiUrl", "");
            report.put("liveBranchEligible", liveApiUrl.isEmpty() || liveApiUrl.equals(apiUrl));
            phase = "originalParseJson";
            long parseStarted = System.currentTimeMillis();
            invoke(methodNames.getString("parseJson"), new Class<?>[]{String.class, String.class}, apiUrl, prepared);
            report.put("parseMs", System.currentTimeMillis() - parseStarted);
            report.put("accepted", true);
            phase = "snapshot";
            collectSnapshot();
            privateResult.put("preferencesAfter", selectionPreferences(appLoader));
            report.put("completed", true);
            phase = "complete";
        } catch (Throwable error) {
            code = 0;
            try {
                report.put("accepted", false);
                report.put("errorPhase", phase);
                report.put("failureKind", phase.startsWith("harness") || error instanceof ClassNotFoundException || error instanceof NoSuchMethodException || error instanceof NoSuchFieldException ? "harnessLookupFailure" : "originalOperationFailure");
                report.put("error", errorMetadata(error));
                if (api != null) collectSnapshot();
            } catch (Throwable snapshotError) {
                try { report.put("snapshotError", errorMetadata(snapshotError)); } catch (Exception ignored) { }
            }
        } finally {
            try {
                report.put("phase", phase);
                privateResult.put("report", report);
                File outputRoot = new File(getTargetContext().getExternalFilesDir(null), "parser-oracle");
                if (!outputRoot.isDirectory() && !outputRoot.mkdirs()) throw new IllegalStateException("Cannot create output directory");
                File output = new File(outputRoot, "result-" + report.optInt("configIndex", 0) + ".json");
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

    private Object invoke(String name, Class<?>[] signature, Object... values) throws Exception {
        Method method = apiClass.getDeclaredMethod(name, signature);
        method.setAccessible(true);
        return method.invoke(api, values);
    }

    private static Field field(Class<?> owner, String name) throws Exception {
        Field value = owner.getDeclaredField(name);
        value.setAccessible(true);
        return value;
    }

    private static Object getter(Object value, String method) throws Exception {
        return value.getClass().getMethod(method).invoke(value);
    }

    private void collectSnapshot() throws Exception {
        JSONArray rows = new JSONArray();
        List<?> sources = (List<?>) apiClass.getMethod(methodNames.getString("getSources")).invoke(api);
        for (Object source : sources) rows.put(sourceValue(source));
        JSONObject globals = new JSONObject();
        JSONObject globalFields = symbols.getJSONObject("apiFields");
        for (String key : new String[]{"spider","jarCache","danmaku","wallpaper"}) {
            Object value = field(apiClass, globalFields.getString(key)).get("jarCache".equals(key) ? null : api);
            globals.put(key, value == null ? JSONObject.NULL : value);
        }
        JSONObject normalized = new JSONObject().put("globals", globals).put("sites", rows);
        privateResult.put("normalized", normalized);
        privateResult.put("sourceRows", rows);
        privateResult.put("globals", globals);
        privateResult.put("flags", jsonValue(field(apiClass, globalFields.getString("flags")).get(api)));
        report.put("sourceCount", rows.length());
        report.put("sourceRowsSha256", sha256(canonical(rows).getBytes(UTF8)));
        report.put("globalsSha256", sha256(canonical(globals).getBytes(UTF8)));
        report.put("normalizedSha256", sha256(canonical(normalized).getBytes(UTF8)));
        JSONObject types = new JSONObject();
        for (int i = 0; i < rows.length(); i++) {
            String type = String.valueOf(rows.getJSONObject(i).getInt("type"));
            types.put(type, types.optInt(type, 0) + 1);
        }
        report.put("sourceTypes", types);
    }

    private JSONObject sourceValue(Object source) throws Exception {
        JSONObject value = new JSONObject();
        if (!source.getClass().getName().equals(symbols.getString("sourceClass"))) throw new IllegalStateException("Original source type differs from symbol map");
        JSONObject fields = symbols.getJSONObject("sourceFields");
        Iterator<String> keys = fields.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            Object item = field(source.getClass(), fields.getString(key)).get(source);
            if (item != null) value.put(key, jsonValue(item));
        }
        value.put("playTimeoutSeconds", getter(source, methodNames.getString("playTimeoutSeconds")));
        return value;
    }

    private JSONObject selectionPreferences(ClassLoader loader) throws Exception {
        Class<?> hawk = loader.loadClass("com.orhanobut.hawk.Hawk");
        Method get = hawk.getMethod("get", String.class, Object.class);
        JSONObject value = new JSONObject();
        JSONObject keys = symbols.getJSONObject("preferences");
        Iterator<String> iterator = keys.keys();
        while (iterator.hasNext()) { String key = iterator.next(); value.put(key, get.invoke(null, keys.getString(key), "")); }
        return value;
    }

    private String originalFetch(ClassLoader loader, String rawUrl, String configKey, String apiUrl) throws Exception {
        final CountDownLatch done = new CountDownLatch(1);
        final String[] body = new String[1];
        final String[] error = new String[1];
        Class<?> callbackClass = loader.loadClass(symbols.getString("callbackClass"));
        Object callback = Proxy.newProxyInstance(loader, new Class<?>[]{callbackClass}, new InvocationHandler() {
            @Override public Object invoke(Object proxy, Method method, Object[] params) {
                if ("a".equals(method.getName())) { body[0] = (String) params[0]; done.countDown(); }
                else if ("error".equals(method.getName())) { error[0] = (String) params[0]; done.countDown(); }
                else if ("toString".equals(method.getName())) return "ParserOracleResultCapture";
                else if ("hashCode".equals(method.getName())) return System.identityHashCode(proxy);
                else if ("equals".equals(method.getName())) return proxy == params[0];
                return null;
            }
        });
        Class<?> fetchClass = loader.loadClass(symbols.getString("fetchClass"));
        Runnable fetch = (Runnable) fetchClass.getConstructor(apiClass, String.class, String.class, String.class, callbackClass)
            .newInstance(api, rawUrl, configKey, apiUrl, callback);
        fetch.run();
        if (!done.await(60, TimeUnit.SECONDS)) throw new java.util.concurrent.TimeoutException("Original preparation callback timed out");
        if (error[0] != null) throw new IllegalStateException("Original configuration preparation failed: " + error[0]);
        if (body[0] == null) throw new IllegalStateException("Original configuration preparation returned null");
        return body[0];
    }

    private static Object jsonValue(Object value) throws Exception {
        if (value == null) return JSONObject.NULL;
        if (value instanceof List) {
            JSONArray array = new JSONArray();
            for (Object item : (List<?>) value) array.put(jsonValue(item));
            return array;
        }
        if (value instanceof Map) {
            JSONObject object = new JSONObject();
            for (Map.Entry<?,?> item : ((Map<?,?>) value).entrySet()) object.put(String.valueOf(item.getKey()), jsonValue(item.getValue()));
            return object;
        }
        if (value instanceof String || value instanceof Number || value instanceof Boolean) return value;
        throw new IllegalArgumentException("Unsupported snapshot value");
    }

    private static JSONObject errorMetadata(Throwable value) throws Exception {
        Throwable error = value;
        while (error instanceof InvocationTargetException && error.getCause() != null) error = error.getCause();
        String message = error.getMessage() == null ? "" : error.getMessage();
        return new JSONObject().put("type", error.getClass().getName())
            .put("fingerprint", sha256((error.getClass().getName() + "\n" + message).getBytes(UTF8)));
    }

    private static byte[] download(String address, int maxBytes) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection();
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(45000);
        connection.setRequestProperty("User-Agent", "TVBox-ART-Parser-Parity/1");
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
                    if (bytes.size() + count > maxBytes) throw new IllegalStateException("Input too large");
                    bytes.write(buffer, 0, count);
                }
                return bytes.toByteArray();
            } finally { stream.close(); }
        } finally { connection.disconnect(); }
    }

    private static byte[] readAll(InputStream input, int limit) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192]; int count;
        while ((count = input.read(buffer)) >= 0) {
            if (output.size() + count > limit) throw new IllegalStateException("Input too large");
            output.write(buffer, 0, count);
        }
        return output.toByteArray();
    }

    private static void write(File path, byte[] bytes) throws Exception {
        FileOutputStream output = new FileOutputStream(path);
        try { output.write(bytes); } finally { output.close(); }
    }

    private static String sha256(byte[] value) throws Exception {
        byte[] bytes = MessageDigest.getInstance("SHA-256").digest(value);
        StringBuilder result = new StringBuilder();
        for (byte b : bytes) result.append(String.format(java.util.Locale.US, "%02x", b & 255));
        return result.toString();
    }

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
