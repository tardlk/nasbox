// SPDX-License-Identifier: GPL-3.0-only
package tvbox.runtime;
import com.google.gson.*;
import okhttp3.OkHttpClient;
import java.io.File;
import java.util.concurrent.TimeUnit;
/** One explicit host per worker. No Android service or listener is created. */
public final class HostServices {
 public static File directory;
 public static String packageName="com.github.tvbox.osc.jun";
 public static String localAddress="http://127.0.0.1:9978/", remoteAddress="http://127.0.0.1:9978/";
 public static boolean addressUnavailable=false;
 public static final JsonArray logs=new JsonArray();
 public static final OkHttpClient client=new OkHttpClient.Builder().connectTimeout(20,TimeUnit.SECONDS).readTimeout(20,TimeUnit.SECONDS).writeTimeout(20,TimeUnit.SECONDS).build();
 public static String address(boolean local){if(addressUnavailable)throw new UnsupportedOperationException("Unbound control address");return local?localAddress:remoteAddress;}
 public static synchronized void log(String message){if(logs.size()>=128)logs.remove(0);logs.add(message);}
 public static void configure(JsonObject object){
  if(object.has("packageName"))packageName=object.get("packageName").getAsString();
  if(object.has("localAddress"))localAddress=object.get("localAddress").getAsString();
  if(object.has("remoteAddress"))remoteAddress=object.get("remoteAddress").getAsString();
  if(object.has("addressUnavailable"))addressUnavailable=object.get("addressUnavailable").getAsBoolean();
 }
 public static void close(){client.dispatcher().executorService().shutdownNow();client.connectionPool().evictAll();}
}
