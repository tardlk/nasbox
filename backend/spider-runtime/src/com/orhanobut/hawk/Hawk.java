// SPDX-License-Identifier: GPL-3.0-only
package com.orhanobut.hawk;
import java.nio.file.*;import java.util.*;import com.google.gson.*;
/** Versioned string store for original js.local. Not Android Hawk encryption. */
public final class Hawk {
 private static final Map<String,String> values=new LinkedHashMap<>();
 public static synchronized void restore()throws Exception{
  Path path=tvbox.runtime.HostServices.directory.toPath().resolve("js-local.json");values.clear();
  if(!Files.exists(path))return;if(Files.size(path)>1024*1024)throw new IllegalArgumentException("JS local state too large");
  JsonObject data=JsonParser.parseString(Files.readString(path)).getAsJsonObject();if(data.get("version").getAsInt()!=1)throw new IllegalArgumentException("Unsupported JS local state");
  for(Map.Entry<String,JsonElement> e:data.getAsJsonObject("values").entrySet())values.put(e.getKey(),e.getValue().getAsString());
 }
 @SuppressWarnings("unchecked") public static synchronized <T>T get(String key,T fallback){return values.containsKey(key)?(T)values.get(key):fallback;}
 public static synchronized <T>boolean put(String key,T value){if(value!=null&&!(value instanceof String))throw new UnsupportedOperationException("Only string JS local values are bound");if(value==null)values.remove(key);else values.put(key,(String)value);save();return true;}
 public static synchronized boolean delete(String key){values.remove(key);save();return true;}
 private static void save(){
  try{
   JsonObject data=new JsonObject();data.addProperty("version",1);data.add("values",new Gson().toJsonTree(values));byte[] bytes=data.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8);
   if(bytes.length>1024*1024)throw new IllegalArgumentException("JS local state too large");
   Path directory=tvbox.runtime.HostServices.directory.toPath();Path temporary=Files.createTempFile(directory,"local-",".tmp");
   try{Files.write(temporary,bytes);Files.move(temporary,directory.resolve("js-local.json"),StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE);}finally{Files.deleteIfExists(temporary);}
  }catch(Exception e){throw new IllegalStateException("JS local persistence failed",e);}
 }
}
