// SPDX-License-Identifier: GPL-3.0-only
// Own classloader fixtures + pinned source method; never loads captured JAR classes.
package com.github.tvbox.parity.fixed;

import android.app.Instrumentation;
import android.content.Context;
import android.os.Build;
import android.os.Bundle;
import dalvik.system.DexClassLoader;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.nio.charset.Charset;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;

public final class FixedMethodInstrumentation extends Instrumentation {
    private static final Charset UTF8 = Charset.forName("UTF-8");
    private static final String DEX_NATIVE = "com.github.catvod.spider.DexNative";
    private static final String FIXTURE_INIT = "com.github.tvbox.parity.fixture.Init";
    private Bundle arguments;

    @Override public void onCreate(Bundle args) {
        super.onCreate(args);
        arguments = args == null ? new Bundle() : args;
        start();
    }

    @Override public void onStart() {
        final JSONObject report = new JSONObject();
        final List<File> temporary = new ArrayList<File>();
        File work = null;
        int resultCode = -1;
        try {
            Context target = getTargetContext();
            ClassLoader targetLoader = target.getClassLoader();
            byte[] planBytes = asset("fixed-method-plan.json", 1024 * 1024);
            JSONObject plan = new JSONObject(new String(planBytes, UTF8));
            require(plan.getInt("schemaVersion") == 1, "plan schema");
            String requestedPlan = arguments.getString("planSha256");
            require(requestedPlan != null && requestedPlan.equals(sha(planBytes)), "requested plan hash");
            String apkSha = fileSha(new File(target.getApplicationInfo().sourceDir));
            require(apkSha.equals(plan.getString("targetApkSha256")), "installed target APK hash");
            require(target.getPackageName().equals(plan.getString("targetPackage")), "target package");
            report.put("schemaVersion", 1);
            report.put("scope", "Real Android/ART: checksum-pinned fixed-source bindDexLoader with owned isolated DEX classes, versus the unchanged installed official APK private method. Captured JAR inputs are scanned as bytes only; no captured class or native code is executed.");
            report.put("planSha256", sha(planBytes));
            report.put("targetApkSha256", apkSha);
            report.put("instrumentationApkSha256", fileSha(new File(getContext().getApplicationInfo().sourceDir)));
            report.put("source", plan.getJSONObject("source"));
            report.put("officialMethodEvidence", plan.getJSONObject("officialMethodEvidence"));
            report.put("applicationPid", android.os.Process.myPid());
            report.put("applicationUid", android.os.Process.myUid());
            report.put("androidSdk", Build.VERSION.SDK_INT);
            report.put("androidRelease", Build.VERSION.RELEASE);
            report.put("abi", Build.CPU_ABI);
            report.put("vmName", System.getProperty("java.vm.name"));
            report.put("vmVersion", System.getProperty("java.vm.version"));
            report.put("applicationStatePolicy", "cold-process-preserve-data");
            android.app.Application targetApplication = (android.app.Application) target.getApplicationContext();
            require(targetApplication != null && targetApplication.getClass().getName().equals("com.github.tvbox.osc.base.App"), "actual official Application instance");
            require(targetApplication.getClass().getClassLoader() == targetLoader
                && targetApplication.getPackageName().equals(target.getPackageName())
                && targetApplication.getApplicationInfo().uid == android.os.Process.myUid(), "target App classloader/package/UID binding");
            com.github.tvbox.parity.fixed.binding.App.bind(targetApplication);
            report.put("fixedAppBinding", "Namespace bridge to the unchanged target process Application instance; original App.getInstance was removed by R8.");
            report.put("targetApplication", new JSONObject().put("class", targetApplication.getClass().getName())
                .put("packageName", targetApplication.getPackageName()).put("uid", targetApplication.getApplicationInfo().uid)
                .put("classloaderMatchesTarget", true).put("sameInstanceForBothMethodPaths", true));
            require(absent(targetLoader, DEX_NATIVE), "target DexNative absent before own fixtures");
            report.put("targetDexNativeAbsentBefore", true);

            Class<?> officialClass = targetLoader.loadClass(plan.getString("officialClass"));
            Constructor<?> constructor = officialClass.getDeclaredConstructor();
            constructor.setAccessible(true);
            Object official = constructor.newInstance();
            Object fixed = new FixedProtectedInitJar();
            Method officialBind = declared(officialClass, "bindDexLoader", Class.class, Object.class);
            Method fixedBind = declared(FixedProtectedInitJar.class, "bindDexLoader", Class.class, Object.class);
            Method officialScan = declared(officialClass, "scan", String.class, String.class);
            Method fixedScan = declared(FixedProtectedInitJar.class, "scan", String.class, String.class);
            work = new File(target.getCodeCacheDir(), "fixed-method-" + android.os.Process.myPid() + "-" + System.nanoTime());
            require(work.mkdirs(), "create owned probe directory");
            JSONArray bindings = new JSONArray();
            JSONArray cases = plan.getJSONArray("cases");
            for (int index = 0; index < cases.length(); index++) {
                JSONObject spec = cases.getJSONObject(index);
                String id = spec.getString("id");
                require(id.matches("[a-z-]+"), "own case id");
                byte[] fixtureBytes = asset(spec.getString("asset"), 1024 * 1024);
                require(sha(fixtureBytes).equals(spec.getString("sha256")), "owned fixture hash");
                File jar = new File(work, id + ".jar");
                write(jar, fixtureBytes); temporary.add(jar);
                File optimized = new File(work, id + "-optimized");
                require(optimized.mkdirs(), "create owned optimization directory");
                DexClassLoader loader = new DexClassLoader(jar.getAbsolutePath(), optimized.getAbsolutePath(), null, targetLoader);
                Class<?> initClass = loader.loadClass(FIXTURE_INIT);
                require(initClass.getClassLoader() == loader, "owned Init classloader isolation");
                Object init = spec.getBoolean("nullInit") ? null : initClass.newInstance();
                if (spec.getBoolean("hasDexNative")) {
                    Class<?> nativeClass = loader.loadClass(DEX_NATIVE);
                    require(nativeClass.getClassLoader() == loader, "owned DexNative classloader isolation");
                    Field value = nativeClass.getDeclaredField("value");
                    value.set(null, spec.getBoolean("returnLoader") ? loader : null);
                } else require(absent(loader, DEX_NATIVE), "missing fixture DexNative");
                boolean pinnedResult = (Boolean) fixedBind.invoke(fixed, initClass, init);
                boolean fixedFieldBound = loaderFieldBound(initClass, init, loader);
                boolean fixedContextMatches = !spec.getBoolean("hasDexNative") || loader.loadClass(DEX_NATIVE).getField("lastContext").get(null) == targetApplication;
                clearLoaderFields(initClass, init);
                if (spec.getBoolean("hasDexNative")) loader.loadClass(DEX_NATIVE).getField("lastContext").set(null, null);
                boolean officialResult = (Boolean) officialBind.invoke(official, initClass, init);
                boolean officialFieldBound = loaderFieldBound(initClass, init, loader);
                boolean officialContextMatches = !spec.getBoolean("hasDexNative") || loader.loadClass(DEX_NATIVE).getField("lastContext").get(null) == targetApplication;
                boolean expectedPinned = spec.getBoolean("expectedFixed");
                boolean expectedOfficial = spec.getBoolean("expectedOfficial");
                JSONObject row = new JSONObject().put("id", id).put("fixtureSha256", spec.getString("sha256"))
                    .put("fixed", pinnedResult).put("official", officialResult)
                    .put("expectedFixed", expectedPinned).put("expectedOfficial", expectedOfficial)
                    .put("fixedFieldBound", fixedFieldBound).put("officialFieldBound", officialFieldBound)
                    .put("fixedContextMatchesTargetApplication", fixedContextMatches).put("officialContextMatchesTargetApplication", officialContextMatches)
                    .put("classloaderIsolated", true).put("nativeExecuted", false)
                    .put("pass", pinnedResult == expectedPinned && officialResult == expectedOfficial
                        && fixedFieldBound == spec.getBoolean("expectedFieldBound")
                        && officialFieldBound == spec.getBoolean("expectedFieldBound") && fixedContextMatches && officialContextMatches);
                bindings.put(row);
            }
            report.put("bindings", bindings);
            require(absent(targetLoader, DEX_NATIVE), "target DexNative absent after fixtures");
            report.put("targetDexNativeAbsentAfter", true);
            JSONArray scans = new JSONArray();
            String inputDirectory = arguments.getString("scanDirectory");
            require(inputDirectory != null, "scanDirectory is required");
            File root = new File(inputDirectory).getCanonicalFile();
            File expectedScanRoot = new File(target.getFilesDir(), "fixed-method-inputs-" + sha(planBytes).substring(0, 12)).getCanonicalFile();
            require(root.equals(expectedScanRoot), "scan task internal directory identity");
            report.put("scanDirectory", new JSONObject().put("canonicalPathSha256", sha(root.getAbsolutePath().getBytes(UTF8)))
                .put("exists", root.exists()).put("directory", root.isDirectory()).put("readable", root.canRead()).put("searchable", root.canExecute())
                .put("targetInternalFilesDirectory", true));
            JSONArray scanInputChecks = new JSONArray();
            report.put("scanInputChecks", scanInputChecks);
            report.put("scans", scans);
            JSONArray inputs = plan.getJSONArray("scanInputs");
            for (int index = 0; index < inputs.length(); index++) {
                JSONObject input = inputs.getJSONObject(index);
                String digest = input.getString("sha256");
                require(digest.matches("[a-f0-9]{64}"), "scan digest");
                File jar = new File(root, digest + ".jar");
                require(jar.getCanonicalFile().getParentFile().equals(root), "scan path containment");
                JSONObject inputCheck = new JSONObject().put("jarSha256", digest).put("exists", jar.exists()).put("file", jar.isFile())
                    .put("readable", jar.canRead()).put("expectedBytes", input.getLong("bytes")).put("actualBytes", jar.length());
                scanInputChecks.put(inputCheck);
                require(jar.isFile(), "scan input file unavailable");
                require(jar.canRead(), "scan input file unreadable");
                require(jar.length() == input.getLong("bytes"), "scan input size mismatch");
                String actualSha256 = fileSha(jar); inputCheck.put("actualSha256", actualSha256);
                require(actualSha256.equals(digest), "scan input hash mismatch");
                boolean pinnedResult = (Boolean) fixedScan.invoke(null, jar.getAbsolutePath(), target.getPackageName());
                boolean officialResult = (Boolean) officialScan.invoke(null, jar.getAbsolutePath(), target.getPackageName());
                scans.put(new JSONObject().put("jarSha256", digest).put("bytes", jar.length())
                    .put("fixedProtected", pinnedResult).put("officialProtected", officialResult)
                    .put("classLoaded", false).put("pass", pinnedResult && officialResult));
            }
            report.put("scans", scans);
            boolean passed = bindings.length() == 5 && scans.length() == 3;
            for (int index = 0; index < bindings.length(); index++) passed &= bindings.getJSONObject(index).getBoolean("pass");
            for (int index = 0; index < scans.length(); index++) passed &= scans.getJSONObject(index).getBoolean("pass");
            report.put("completed", true);
            report.put("passed", passed);
            if (!passed) resultCode = 0;
        } catch (Throwable error) {
            resultCode = 0;
            try {
                while (error instanceof InvocationTargetException && ((InvocationTargetException) error).getCause() != null) error = ((InvocationTargetException) error).getCause();
                report.put("completed", false).put("passed", false)
                    .put("error", new JSONObject().put("type", error.getClass().getName()).put("fingerprint", sha(String.valueOf(error.getMessage()).getBytes(UTF8))));
            } catch (Exception ignored) { }
        } finally {
            boolean removed = work == null || removeTree(work);
            try { report.put("cleanup", new JSONObject().put("ownedTemporaryFilesRemoved", removed)
                .put("capturedInputsUnmodified", true).put("artifactClassesLoaded", false).put("thirdPartyNativeExecuted", false)); } catch (Exception ignored) { }
        }
        Bundle output = new Bundle();
        output.putString("report", report.toString());
        try {
            File resultRoot = new File(getTargetContext().getExternalFilesDir(null), "fixed-method-probe");
            require(resultRoot.isDirectory() || resultRoot.mkdirs(), "result directory");
            File result = new File(resultRoot, "result.json");
            write(result, (report.toString() + "\n").getBytes(UTF8));
            output.putString("resultPath", result.getAbsolutePath());
        } catch (Throwable error) { output.putString("writeFailureType", error.getClass().getName()); resultCode = 0; }
        finish(resultCode, output);
    }

    private byte[] asset(String name, int maxBytes) throws Exception {
        require(name.matches("(?:fixtures/[a-z-]+[.]jar|fixed-method-plan[.]json)"), "asset name");
        InputStream input = getContext().getAssets().open(name);
        try { return readAll(input, maxBytes); } finally { input.close(); }
    }
    private static byte[] readAll(InputStream input, int maxBytes) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream(); byte[] buffer = new byte[8192]; int length;
        while ((length = input.read(buffer)) != -1) { if (output.size() + length > maxBytes) throw new IllegalArgumentException("size limit"); output.write(buffer, 0, length); }
        return output.toByteArray();
    }
    private static String fileSha(File path) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256"); InputStream input = new FileInputStream(path);
        try { byte[] buffer = new byte[8192]; int length; long size = 0; while ((length = input.read(buffer)) != -1) { size += length; require(size <= 128L * 1024 * 1024, "file size"); digest.update(buffer, 0, length); } }
        finally { input.close(); } return hex(digest.digest());
    }
    private static String sha(byte[] bytes) throws Exception { return hex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
    private static String hex(byte[] bytes) { StringBuilder result = new StringBuilder(); for (byte value : bytes) result.append(String.format("%02x", value & 255)); return result.toString(); }
    private static void write(File path, byte[] bytes) throws Exception { FileOutputStream output = new FileOutputStream(path); try { output.write(bytes); } finally { output.close(); } }
    private static Method declared(Class<?> type, String name, Class<?>... parameters) throws Exception { Method method = type.getDeclaredMethod(name, parameters); method.setAccessible(true); return method; }
    private static boolean absent(ClassLoader loader, String name) throws Exception { try { loader.loadClass(name); return false; } catch (ClassNotFoundException expected) { return true; } }
    private static boolean loaderFieldBound(Class<?> type, Object init, DexClassLoader expected) throws Exception {
        if (init == null) return false;
        for (Class<?> cursor = type; cursor != null; cursor = cursor.getSuperclass()) for (Field field : cursor.getDeclaredFields()) {
            if (java.lang.reflect.Modifier.isStatic(field.getModifiers()) || !DexClassLoader.class.isAssignableFrom(field.getType())) continue;
            field.setAccessible(true); if (field.get(init) == expected) return true;
        }
        return false;
    }
    private static void clearLoaderFields(Class<?> type, Object init) throws Exception {
        if (init == null) return;
        for (Class<?> cursor = type; cursor != null; cursor = cursor.getSuperclass()) for (Field field : cursor.getDeclaredFields()) {
            if (java.lang.reflect.Modifier.isStatic(field.getModifiers()) || !DexClassLoader.class.isAssignableFrom(field.getType())) continue;
            field.setAccessible(true); field.set(init, null);
        }
    }
    private static boolean removeTree(File file) { boolean result = true; File[] children = file.listFiles(); if (children != null) for (File child : children) result &= removeTree(child); return file.delete() && result; }
    private static void require(boolean condition, String operation) { if (!condition) throw new IllegalArgumentException("Fixed probe input differs: " + operation); }
}
