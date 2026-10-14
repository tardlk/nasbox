// SPDX-License-Identifier: GPL-3.0-only
// Original TVBoxOS methods, explicit JVM class-JAR bindings; see NOTICE.md.
package tvbox.runtime;
import com.github.catvod.crawler.*;
import com.github.tvbox.osc.base.App;
import com.github.tvbox.osc.server.ControlManager;
import android.content.Context;
import java.io.*;
import java.lang.reflect.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import org.json.JSONObject;
public final class JarExecutor {
 private static final String TAG="JarLoader",MAIN_KEY="main";
 private final ConcurrentHashMap<String,JvmJarClassLoader> loaders=new ConcurrentHashMap<>();
 private final ConcurrentHashMap<String,Method> proxyMethods=new ConcurrentHashMap<>(),danmuClickMethods=new ConcurrentHashMap<>(),danmuLongClickMethods=new ConcurrentHashMap<>();
 private final ConcurrentHashMap<String,Spider> spiders=new ConcurrentHashMap<>();
 private final ConcurrentHashMap<String,Object> locks=new ConcurrentHashMap<>();
 private final ConcurrentHashMap<String,String> siteJarKeys=new ConcurrentHashMap<>(),aliases=new ConcurrentHashMap<>();
 private final Map<String,Path> artifacts=new HashMap<>();
 private volatile String recent=MAIN_KEY;
 private final ProtectedInitJar protectedInitJar=new ProtectedInitJar();
 static class TextUtils{static boolean isEmpty(CharSequence s){return s==null||s.length()==0;}}
 static class Log{static void i(String tag,String message){HostServices.log(message);}static void e(String tag,String message){HostServices.log(message);}}
 static class RemoteServer{static int serverPort=9978;}
 // Only ordinary JVM class JARs are admitted by the artifact boundary. Android
 // protected/DEX/native jars are rejected there, before init is considered.
 static class ProtectedInitJar{boolean check(String path){return false;}boolean init(Class<?> c){throw new UnsupportedOperationException("Protected Android initialization unavailable");}}
 public void register(String signature,Path file)throws IOException{
  if(!Files.isRegularFile(file))throw new FileNotFoundException("JAR artifact missing");
  artifacts.put(signature,file.toAbsolutePath());
 }
 public boolean loadMain(Path file)throws Exception{
  register("",file);boolean success=load(MAIN_KEY,file.toFile());if(success)recent=MAIN_KEY;return success;
 }
 public void parseJar(String key,String signature){
  if(TextUtils.isEmpty(key)||TextUtils.isEmpty(signature)||loaders.containsKey(key))return;
  Path file=artifacts.get(signature);
  if(file==null)throw new IllegalStateException("Unresolved JAR artifact");
  String[] texts=signature.split(";md5;");aliases.put(jarKey(texts[0]),key);
  load(key,file.toFile());
 }
 private boolean load(String key,File file){
  if(Thread.interrupted()||!file.isFile())return false;
  if(loaders.containsKey(key))return true;
  JvmJarClassLoader loader=null;
  try{
   loader=new JvmJarClassLoader(file.toPath());
   if(!invokeInit(loader,file.getAbsolutePath())){loader.close();return false;}
   invokeProxy(key,loader);invokeDanmaku(key,loader);injectProxyPort(loader);loaders.put(key,loader);return true;
  }catch(Throwable e){try{if(loader!=null)loader.close();}catch(Exception ignored){}HostServices.log("JAR loading failed: "+e.getClass().getName());return false;}
 }
 public void close()throws IOException{
  List<JvmJarClassLoader> owned=new ArrayList<>(loaders.values());
  clear();IOException failure=null;
  for(JvmJarClassLoader loader:owned)try{loader.close();}catch(IOException e){failure=e;}
  if(failure!=null)throw failure;
 }
 public com.google.gson.JsonObject snapshot(){
  com.google.gson.Gson gson=new com.google.gson.Gson();com.google.gson.JsonObject value=new com.google.gson.JsonObject();
  value.addProperty("recent",recent);value.addProperty("spiderCount",spiders.size());value.addProperty("loaderCount",loaders.size());
  value.add("siteJarKeys",gson.toJsonTree(new TreeMap<>(siteJarKeys)));value.add("aliases",gson.toJsonTree(new TreeMap<>(aliases)));return value;
 }

public Spider getSpider(String key, String api, String ext, String jar) {
        key = key == null ? "" : key;
        api = api == null ? "" : api;
        ext = ext == null ? "" : ext;
        jar = jar == null ? "" : jar;
        if (TextUtils.isEmpty(api)) return new SpiderNull();

        String jaKey = TextUtils.isEmpty(jar) ? MAIN_KEY : jarKey(jar);
        String spKey = jaKey + key;
        recent = jaKey;
        siteJarKeys.put(key, jaKey);
        injectProxyPort(loaders.get(jaKey));

        Spider cached = spiders.get(spKey);
        if (cached != null) {
            Log.i(TAG, "getSpider cached key=" + spKey);
            return cached;
        }

        try {
            if (!MAIN_KEY.equals(jaKey)) parseJar(jaKey, jar);
            JvmJarClassLoader loader = loaders.get(jaKey);
            if (loader == null) return new SpiderNull();
            Spider spider = (Spider) loader.loadClass("com.github.catvod.spider." + className(api)).newInstance();
            spider.siteKey = key;
            spider.initApi(new SpiderApi());
            spider.init(App.getInstance(), ext);
            spiders.put(spKey, spider);
            Log.i(TAG, "getSpider success key=" + spKey);
            return spider;
        } catch (Throwable e) {
            Log.i(TAG, "getSpider error key=" + spKey + ", msg=" + e.getMessage());
            e.printStackTrace();
            return new SpiderNull();
        }
    }
public void clear() {
        for (Spider spider : spiders.values()) {
            try {
                spider.destroy();
            } catch (Throwable ignored) {
            }
        }
        loaders.clear();
        proxyMethods.clear();
        danmuClickMethods.clear();
        danmuLongClickMethods.clear();
        spiders.clear();
        locks.clear();
        siteJarKeys.clear();
        aliases.clear();
        recent = MAIN_KEY;
    }
public void setRecentJarKey(String key) {
        if (TextUtils.isEmpty(key)) return;
        recent = realKey(key);
        injectProxyPort(loaders.get(recent));
    }
public void loadLiveJar(String jar) {
        String key = jarKey(jar);
        parseJar(key, jar);
        setRecentJarKey(key);
    }
private boolean invokeInit(JvmJarClassLoader loader, String jar) {
        boolean protectedJar = false;
        try {
            Class<?> clz = loader.loadClass("com.github.catvod.spider.Init");
            protectedJar = protectedInitJar.check(jar);
            if (protectedJar) {
                Log.i(TAG, "echo-load initProtectedJar file=" + jar);
                return protectedInitJar.init(clz);
            } else {
                Method method = clz.getMethod("init", Context.class);
                method.invoke(null, App.getInstance());
            }
        } catch (Throwable e) {
            e.printStackTrace();
        }
        return !protectedJar;
    }
private void invokeProxy(String key, JvmJarClassLoader loader) {
        try {
            Class<?> clz = loader.loadClass("com.github.catvod.spider.Proxy");
            Method method = clz.getMethod("proxy", Map.class);
            proxyMethods.put(key, method);
        } catch (Throwable e) {
            e.printStackTrace();
        }
    }
private void invokeDanmaku(String key, JvmJarClassLoader loader) {
        try {
            Class<?> clz = loader.loadClass("com.github.catvod.spider.Danmaku");
            try {
                danmuClickMethods.put(key, clz.getMethod("onClick", String.class, String.class));
            } catch (Throwable ignored) {
            }
            try {
                danmuLongClickMethods.put(key, clz.getMethod("onLongClick", String.class, String.class));
            } catch (Throwable ignored) {
            }
        } catch (Throwable ignored) {
        }
    }
public void searchDanmuUi(String name, String episode, boolean longClick) {
        try {
            ConcurrentHashMap<String, Method> methods = longClick ? danmuLongClickMethods : danmuClickMethods;
            Method method = methods.get(recent);
            if (method == null) method = methods.get("main");
            if (method == null) return;
            method.invoke(null, name, episode);
        } catch (Throwable e) {
            e.printStackTrace();
        }
    }
public boolean hasDanmuSearchUi() {
        return danmuClickMethods.containsKey(recent) || danmuLongClickMethods.containsKey(recent);
    }
public JSONObject jsonExt(String key, LinkedHashMap<String, String> jxs, String url) {
        try {
            Class<?> clz = loadParserClass("com.github.catvod.parser.Json" + key);
            Method method = clz.getMethod("parse", LinkedHashMap.class, String.class);
            return (JSONObject) method.invoke(null, jxs, url);
        } catch (Throwable e) {
            e.printStackTrace();
            return null;
        }
    }
public JSONObject jsonExtMix(String flag, String key, String name, LinkedHashMap<String, HashMap<String, String>> jxs, String url) {
        try {
            Class<?> clz = loadParserClass("com.github.catvod.parser.Mix" + key);
            Method method = clz.getMethod("parse", LinkedHashMap.class, String.class, String.class, String.class);
            return (JSONObject) method.invoke(null, jxs, name, flag, url);
        } catch (Throwable e) {
            e.printStackTrace();
            return null;
        }
    }
public Object[] proxyInvoke(Map<String, String> params) {
        String siteKey = params == null ? null : params.get("siteKey");
        if (!TextUtils.isEmpty(siteKey)) {
            Object[] result = proxyInvoke(proxyMethods.get(siteJarKeys.get(siteKey)), params);
            if (result != null) return result;
        }
        Object[] result = proxyInvoke(proxyMethods.get(recent), params);
        if (result != null) return result;
        for (Map.Entry<String, Method> entry : proxyMethods.entrySet()) {
            if (entry.getKey().equals(recent)) continue;
            result = proxyInvoke(entry.getValue(), params);
            if (result != null) return result;
        }
        return null;
    }
private Object[] proxyInvoke(Method method, Map<String, String> params) {
        try {
            return method == null ? null : (Object[]) method.invoke(null, params);
        } catch (Throwable e) {
            e.printStackTrace();
            return null;
        }
    }
private JvmJarClassLoader requireRecentLoader() {
        JvmJarClassLoader loader = loaders.get(recent);
        if (loader == null) loader = loaders.get(MAIN_KEY);
        if (loader == null) throw new IllegalStateException("No jar loaded for recent key: " + recent);
        return loader;
    }
private Class<?> loadParserClass(String name) throws ClassNotFoundException {
        JvmJarClassLoader loader = loaders.get(recent);
        if (loader != null) {
            try {
                return loader.loadClass(name);
            } catch (ClassNotFoundException ignored) {
            }
        }
        loader = loaders.get(MAIN_KEY);
        if (loader != null) return loader.loadClass(name);
        throw new ClassNotFoundException(name);
    }
private String jarKey(String jar) {
        String key = MD5.string2MD5(jar == null ? "" : jar);
        return TextUtils.isEmpty(key) ? MAIN_KEY : key;
    }
private String realKey(String key) {
        String alias = aliases.get(key);
        return TextUtils.isEmpty(alias) ? key : alias;
    }
private String className(String api) {
        return api.contains("csp_") ? api.split("csp_")[1] : api;
    }
private void injectProxyPort(JvmJarClassLoader loader) {
        com.github.catvod.Proxy.set(getServerPort());
        if (loader == null) return;
        try {
            Class<?> proxy = loader.loadClass("com.github.catvod.Proxy");
            Method set = proxy.getMethod("set", int.class);
            set.invoke(null, getServerPort());
        } catch (Throwable ignored) {
        }
    }
private int getServerPort() {
        try {
            String address = ControlManager.get().getAddress(true);
            if (address != null && address.startsWith("http://127.0.0.1:")) {
                String baseUrl = address.endsWith("/") ? address.substring(0, address.length() - 1) : address;
                return Integer.parseInt(baseUrl.substring(baseUrl.lastIndexOf(":") + 1));
            }
        } catch (Throwable ignored) {
        }
        return RemoteServer.serverPort;
    }
static class MD5 {static final java.security.MessageDigest sDigest;static{try{sDigest=java.security.MessageDigest.getInstance("MD5");}catch(Exception e){throw new RuntimeException(e);}}public static String string2MD5(String inStr) {
        if (sDigest == null) {
            Log.e("MD5", "MD5信息摘要初始化失败");
            return null;
        } else if (TextUtils.isEmpty(inStr)) {
            Log.e("MD5", "参数strSource不能为空");
            return null;
        }
        char[] charArray = inStr.toCharArray();
        byte[] byteArray = new byte[charArray.length];

        for (int i = 0; i < charArray.length; i++)
            byteArray[i] = (byte) charArray[i];
        byte[] md5Bytes = sDigest.digest(byteArray);
        StringBuilder hexValue = new StringBuilder();
        for (byte md5Byte : md5Bytes) {
            int val = ((int) md5Byte) & 0xff;
            if (val < 16)
                hexValue.append("0");
            hexValue.append(Integer.toHexString(val));
        }
        return hexValue.toString();

    }}
}
