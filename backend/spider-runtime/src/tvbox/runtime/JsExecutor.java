// SPDX-License-Identifier: GPL-3.0-only
package tvbox.runtime;
import com.github.catvod.crawler.*;import com.github.catvod.crawler.js.JsSpider;import com.github.tvbox.osc.base.App;import com.github.tvbox.osc.util.MD5;import com.github.tvbox.osc.util.LOG;import java.util.*;import java.util.concurrent.*;import java.nio.file.*;
public final class JsExecutor {
 private static final ConcurrentHashMap<String,Spider> spiders=new ConcurrentHashMap<>();
 private static final ConcurrentHashMap<String,Class<?>> classes=new ConcurrentHashMap<>();
 private final Map<String,Path> artifacts=new HashMap<>();
 private final List<JvmJarClassLoader> owned=new ArrayList<>();
 private volatile String recentKey="";
 static class Log{static void i(String tag,String value){HostServices.log(value);}}
 public void register(String signature,Path path){artifacts.put(signature,path.toAbsolutePath());}
 private Class<?> loadJarInternal(String jar,String md5,String key){
  if(classes.containsKey(key))return classes.get(key);
  Path path=artifacts.get(jar);if(path==null)throw new IllegalStateException("Unresolved JS API class-JAR");
  try{
   JvmJarClassLoader loader=new JvmJarClassLoader(path);owned.add(loader);Class<?> type;
   try{type=loader.loadClass("com.github.catvod.js.Function");type.getDeclaredConstructor(com.whl.quickjs.wrapper.QuickJSContext.class);}
   catch(ReflectiveOperationException e){type=loader.loadClass("com.github.catvod.js.Method");type.getDeclaredConstructor(com.whl.quickjs.wrapper.QuickJSContext.class);}
   classes.put(key,type);return type;
  }catch(Exception e){HostServices.log("JS API class loading failed: "+e.getClass().getName());return null;}
 }
 public void close()throws Exception{
  List<Spider> previous=new ArrayList<>(spiders.values());
  clear();com.github.catvod.crawler.js.Global.closeAll();
  for(Spider spider:previous)if(spider instanceof JsSpider){
   java.lang.reflect.Field field=JsSpider.class.getDeclaredField("executor");field.setAccessible(true);
   ExecutorService executor=(ExecutorService)field.get(spider);if(!executor.awaitTermination(3,TimeUnit.SECONDS))throw new IllegalStateException("QuickJS executor did not stop");
  }
  Exception failure=null;for(JvmJarClassLoader loader:owned)try{loader.close();}catch(Exception e){failure=e;}owned.clear();if(failure!=null)throw failure;
 }
 public boolean ready(Spider spider)throws Exception{
  if(!(spider instanceof JsSpider))return false;
  java.lang.reflect.Field field=JsSpider.class.getDeclaredField("jsObject");field.setAccessible(true);java.lang.reflect.Field state=JsSpider.class.getDeclaredField("destroyed");state.setAccessible(true);return field.get(spider)!=null&&!((java.util.concurrent.atomic.AtomicBoolean)state.get(spider)).get();
 }
 public com.google.gson.JsonObject snapshot(){com.google.gson.JsonObject result=new com.google.gson.JsonObject();result.addProperty("recentKey",recentKey);result.addProperty("spiderCount",spiders.size());result.addProperty("apiClassCount",classes.size());return result;}

public synchronized Spider getSpider(String key, String api, String ext, String jar) {
        recentKey = key;
        if (spiders.containsKey(key)){
            Log.i("JSLoader", "echo-getSpider cached "+key);
            return spiders.get(key);
        }
        Class<?> classLoader = null;
        if (!jar.isEmpty()) {
            String[] urls = jar.split(";md5;");
            String jarUrl = urls[0];
            String jarKey = MD5.string2MD5(jarUrl);
            String jarMd5 = urls.length > 1 ? urls[1].trim() : "";
            classLoader = loadJarInternal(jarUrl, jarMd5, jarKey);
        }
        try {
            Log.i("JSLoader", "echo-getSpider load");
            Spider sp = new JsSpider(key, api, classLoader);
            sp.siteKey = key;
            sp.init(App.getInstance(), ext);
            spiders.put(key, sp);
            return sp;
        } catch (Throwable th) {
            LOG.i("echo-getSpider-error "+th.getMessage());
        }
        return new SpiderNull();
    }
public synchronized void clear() {
        for (Spider spider : spiders.values()) {
            spider.cancelByTag();
            spider.destroy();
        }
        spiders.clear();
        classes.clear();
        recentKey = "";
    }
public Object[] proxyInvoke(Map<String, String> params) {
        try {
            Spider proxyFun = spiders.get(recentKey);
            if (proxyFun != null) {
                return proxyFun.proxyLocal(params);
            }
        } catch (Throwable th) {
        }
        return null;
    }
public static void stopAll() {
        for (Spider spider : spiders.values()){
            spider.cancelByTag();
        }
    }
}
