// SPDX-License-Identifier: GPL-3.0-only
// Test-only host binding derived from backend HostServices. The production
// runtime/image is unchanged. Only explicitly registered code/rule GET bytes
// are frozen; other HTTP requests retain the original live client behavior.
package tvbox.runtime;
import com.google.gson.*;
import okhttp3.*;
import java.io.File;
import java.io.IOException;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

public final class HostServices {
 public static File directory;
 public static String packageName="com.github.tvbox.osc.jun";
 public static String localAddress="http://127.0.0.1:9978/",remoteAddress="http://127.0.0.1:9978/";
 public static boolean addressUnavailable=false,networkDisabled=false;
 public static String jarInitPolicy="android";
 public static final JsonArray logs=new JsonArray();
 private static volatile Map<String,Fixture> fixtures=Map.of();
 private record Fixture(int status,Headers headers,byte[] body){}
 private static String digest(String value){
  try{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));}
  catch(Exception e){throw new IllegalStateException(e);}
 }
 public static final OkHttpClient client=new OkHttpClient.Builder().addInterceptor(chain->{
  Request request=chain.request();String key=request.method()+" "+request.url();
  Fixture fixture=fixtures.get(key);
  if(fixture!=null){
   log("JS_FIXTURE_HIT urlSha256="+digest(request.url().toString())+" status="+fixture.status+" bytes="+fixture.body.length);
   String contentType=fixture.headers.get("Content-Type");MediaType mediaType=contentType==null?null:MediaType.parse(contentType);
   return new Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(fixture.status).message("Frozen code/rule response")
    .headers(fixture.headers).body(ResponseBody.create(mediaType,fixture.body)).build();
  }
  if(networkDisabled)throw new IOException("HOST_NETWORK_DISABLED");
  log("JS_LIVE_HTTP method="+request.method()+" urlSha256="+digest(request.url().toString()));
  return chain.proceed(request);
 }).connectTimeout(20,TimeUnit.SECONDS).readTimeout(20,TimeUnit.SECONDS).writeTimeout(20,TimeUnit.SECONDS).build();
 public static String address(boolean local){if(addressUnavailable)throw new UnsupportedOperationException("Unbound control address");return local?localAddress:remoteAddress;}
 public static synchronized void log(String message){if(logs.size()>=128)logs.remove(0);logs.add(message);}
 public static void configure(JsonObject object){
  if(object.has("jarInitPolicy")){String policy=object.get("jarInitPolicy").getAsString();if(!policy.equals("android")&&!policy.equals("declared"))throw new IllegalArgumentException("Unknown JAR init policy");jarInitPolicy=policy;}
  if(object.has("networkDisabled"))networkDisabled=object.get("networkDisabled").getAsBoolean();
  if(object.has("packageName"))packageName=object.get("packageName").getAsString();
  if(object.has("localAddress"))localAddress=object.get("localAddress").getAsString();
  if(object.has("remoteAddress"))remoteAddress=object.get("remoteAddress").getAsString();
  if(object.has("addressUnavailable"))addressUnavailable=object.get("addressUnavailable").getAsBoolean();
  if(object.has("httpFixtures")){
   JsonArray inputs=object.getAsJsonArray("httpFixtures");
   if(inputs.size()>128)throw new IllegalArgumentException("JS_FIXTURE_COUNT_LIMIT");
   Map<String,Fixture> next=new LinkedHashMap<>();long total=0;
   for(JsonElement input:inputs){
    JsonObject row=input.getAsJsonObject();HttpUrl url=HttpUrl.get(row.get("url").getAsString());
    String method=row.has("method")?row.get("method").getAsString():"GET";
    if(!method.equals("GET"))throw new IllegalArgumentException("JS_FIXTURE_ONLY_CODE_RULE_GET");
    int status=row.has("status")?row.get("status").getAsInt():200;
    if(status<200||status>=300)throw new IllegalArgumentException("JS_FIXTURE_UNSUCCESSFUL_INPUT");
    byte[] body=Base64.getDecoder().decode(row.get("bodyBase64").getAsString());total+=body.length;
    if(body.length>6*1024*1024||total>32L*1024*1024)throw new IllegalArgumentException("JS_FIXTURE_SIZE_LIMIT");
    Headers.Builder headers=new Headers.Builder();
    if(row.has("headers"))for(var entry:row.getAsJsonObject("headers").entrySet())headers.add(entry.getKey(),entry.getValue().getAsString());
    String key=method+" "+url;
    if(next.putIfAbsent(key,new Fixture(status,headers.build(),body))!=null)throw new IllegalArgumentException("JS_FIXTURE_DUPLICATE");
   }
   fixtures=Collections.unmodifiableMap(next);
  }
 }
 public static void close(){client.dispatcher().executorService().shutdownNow();client.connectionPool().evictAll();fixtures=Map.of();}
}
