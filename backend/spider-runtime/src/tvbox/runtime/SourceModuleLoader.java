// SPDX-License-Identifier: GPL-3.0-only
// Selected unchanged Android FileUtils methods with explicit bounded host bindings.
package tvbox.runtime;
import android.text.TextUtils;import com.github.tvbox.osc.util.LOG;import com.github.tvbox.osc.util.MD5;import com.github.tvbox.osc.server.ControlManager;import com.google.gson.*;import org.json.JSONObject;import java.io.*;import java.util.*;import java.util.regex.*;
public final class SourceModuleLoader {
    private static final Pattern URL_JOIN = Pattern.compile("^http.*\\.(js|txt|json)", Pattern.MULTILINE | Pattern.CASE_INSENSITIVE);
 public static boolean remote=false,debug=false;
 private static long received=0;private static final long TOTAL=32L*1024*1024;
 private static final int LIMIT=6*1024*1024;
 private static int requests=0,hits=0;
 private static final Set<String> assets=Set.of("cheerio.min.js","crypto-js.js","gbk.js","模板.js","cat.js");
 private static final Set<String> charged=new HashSet<>();
 private static long retained=0;
 static class HawkConfig{static final String DEBUG_OPEN="debug_open";}
 static class Hawk{static boolean get(String name,boolean fallback){return debug;}}
 static class StringUtils{static boolean isEmpty(String value){return value==null||value.isEmpty();}}
 public static void resetBudget(){received=0;retained=0;charged.clear();}
 public static void reset(){remote=false;debug=false;requests=0;hits=0;resetBudget();}
 public static com.google.gson.JsonObject snapshot(){var value=new com.google.gson.JsonObject();value.addProperty("requests",requests);value.addProperty("cacheHits",hits);value.addProperty("receivedBytes",received);value.addProperty("moduleBytes",retained);value.addProperty("remote",remote);value.addProperty("debug",debug);return value;}
 public static String resolve(String name){String text=loadModule(name);if(text!=null){int length=text.getBytes(java.nio.charset.StandardCharsets.UTF_8).length;if(length>LIMIT)throw new IllegalStateException("MODULE_SIZE_LIMIT");if(!charged.contains(name)){if(retained+length>TOTAL)throw new IllegalStateException("MODULE_TOTAL_LIMIT");charged.add(name);retained+=length;}}return text;}
 public static boolean isAsFile(String name,String directory){return directory.equals("js/lib")&&assets.contains(name.trim());}
 public static String getAsOpen(String name){
  if(!name.startsWith("js/lib/")||!assets.contains(name.substring(7)))return "";
  try(InputStream in=SourceModuleLoader.class.getResourceAsStream("/android-assets/"+name)){if(in==null)return "";return new String(in.readNBytes(LIMIT),java.nio.charset.StandardCharsets.UTF_8);}catch(Exception e){return "";}
 }
 public static File open(String name){if(!name.matches("[a-fA-F0-9]{32}"))throw new IllegalArgumentException("Invalid module cache key");File dir=new File(tvbox.runtime.HostServices.directory,"module-cache");dir.mkdirs();return new File(dir,"qjscache_"+name+".js");}
 public static byte[] readSimple(File file)throws IOException{if(file.length()>LIMIT*2L)throw new IOException("MODULE_CACHE_LIMIT");hits++;return java.nio.file.Files.readAllBytes(file.toPath());}
 public static void recursiveDelete(File file)throws IOException{java.nio.file.Files.deleteIfExists(file.toPath());}
 public static void writeSimple(byte[] bytes,File file)throws IOException{
  if(bytes.length>LIMIT*2L)throw new IOException("MODULE_CACHE_LIMIT");var temporary=java.nio.file.Files.createTempFile(file.toPath().getParent(),"module-",".tmp");try{java.nio.file.Files.write(temporary,bytes);java.nio.file.Files.move(temporary,file.toPath(),java.nio.file.StandardCopyOption.REPLACE_EXISTING,java.nio.file.StandardCopyOption.ATOMIC_MOVE);}finally{java.nio.file.Files.deleteIfExists(temporary);}
 }
 public static String get(String url){
  if(!remote){tvbox.runtime.HostServices.log("MODULE_REMOTE_DISABLED "+url);return null;}
  try{
   java.net.URI uri=java.net.URI.create(url);if(!Set.of("http","https").contains(uri.getScheme()))throw new IOException("MODULE_PROTOCOL_UNAVAILABLE");
   if(received>=TOTAL)throw new IOException("MODULE_TOTAL_LIMIT");requests++;
   okhttp3.Request request=new okhttp3.Request.Builder().url(url).header("User-Agent","okhttp/3.15").build();
   try(okhttp3.Response response=tvbox.runtime.HostServices.client.newCall(request).execute()){
    if(response.body()==null)return null;
    try(InputStream in=response.body().byteStream()){
     byte[] bytes=in.readNBytes((int)Math.min(LIMIT,TOTAL-received)+1);received+=bytes.length;if(bytes.length>LIMIT||received>TOTAL)throw new IOException("MODULE_SIZE_LIMIT");
     // OkHttp body.string's BOM and response charset semantics, after bounded reading.
     String text=okhttp3.ResponseBody.create(response.body().contentType(),bytes).string();
     tvbox.runtime.HostServices.log("MODULE_FETCH status="+response.code()+" bytes="+bytes.length+" "+url);return text;
    }
   }
  }catch(Exception e){tvbox.runtime.HostServices.log("MODULE_FETCH_FAILED "+e.getClass().getSimpleName()+": "+e.getMessage());return null;}
 }

public static String loadModule(String name) {
        String rel = null;
        try {
            if (name.contains("gbk.js")) {
                name = "gbk.js";
            } else if (name.contains("模板.js")) {
                name = "模板.js";
            } else if (name.contains("cat.js")) {
                name = "cat.js";
            }
            LOG.i("echo-loadModule "+name);
            Matcher m = URL_JOIN.matcher(name);
            if (m.find()) {
                if (!Hawk.get(HawkConfig.DEBUG_OPEN, false)) {
                    String cache = getCache(MD5.encode(name));
                    rel= cache;
                    if (StringUtils.isEmpty(cache)) {
                        String netStr = get(name);
                        if (!TextUtils.isEmpty(netStr)) {
                            setCache(604800, MD5.encode(name), netStr);
                        }
                        rel= netStr;
                    }
                } else {
                    rel= get(name);
                }
            } else if (name.startsWith("assets://")) {
                rel= getAsOpen(name.substring(9));
            } else if (isAsFile(name, "js/lib")) {
                rel=getAsOpen("js/lib/" + name);
            } else if (name.startsWith("file://")) {
                rel=get(ControlManager.get()
                        .getAddress(true) + "file/" + name.replace("file:///", "")
                        .replace("file://", ""));
            } else if (name.startsWith("clan://localhost/")) {
                rel=get(ControlManager.get()
                        .getAddress(true) + "file/" + name.replace("clan://localhost/", ""));
            } else if (name.startsWith("clan://")) {
                String substring = name.substring(7);
                int indexOf = substring.indexOf(47);
                rel=get("http://" + substring.substring(0, indexOf) + "/file/" + substring.substring(indexOf + 1));
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
        return rel;
    }
public static String getCache(String name) {
        try {
            String code = "";
            File file = open(name);
            if (file.exists()) {
                code = new String(readSimple(file));
            }
            if (TextUtils.isEmpty(code)) {
                return "";
            }
            JsonObject asJsonObject = (new Gson().fromJson(code, JsonObject.class)).getAsJsonObject();
            if (((long) asJsonObject.get("expires").getAsInt()) <= System.currentTimeMillis() / 1000) {
                recursiveDelete(open(name));
            }
            return asJsonObject.get("data").getAsString();
        } catch (Exception e4) {
            return "";
        }
    }
public static void setCache(int time, String name, String data) {
        try {
            JSONObject jSONObject = new JSONObject();
            jSONObject.put("expires", (int) (time + (System.currentTimeMillis() / 1000)));
            jSONObject.put("data", data);
            writeSimple(jSONObject.toString().getBytes(), open(name));
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
