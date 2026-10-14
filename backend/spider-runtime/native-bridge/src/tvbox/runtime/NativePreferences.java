// SPDX-License-Identifier: GPL-3.0-only
package tvbox.runtime;
import android.content.SharedPreferences;
import com.google.gson.*;
import java.util.*;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
/** Worker-scoped, typed preferences. apply persists synchronously on this host. */
public final class NativePreferences implements SharedPreferences {
 private static final Map<String,NativePreferences> stores=new HashMap<>();
 private final Map<String,Object> data=new HashMap<>();
 private final Set<OnSharedPreferenceChangeListener> listeners=Collections.newSetFromMap(new WeakHashMap<>());
 private final Path file;
 public static synchronized SharedPreferences get(String name){return stores.computeIfAbsent(name,NativePreferences::new);}
 public static synchronized void releaseListeners(){for(var store:stores.values())synchronized(store){store.listeners.clear();}}
 private NativePreferences(String name){
  try{
   String key=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(name.getBytes(StandardCharsets.UTF_8)));
   file=HostServices.directory.toPath().resolve("android/preferences/"+key+".json");
   if(Files.exists(file)){
    if(Files.size(file)>4*1024*1024)throw new IllegalStateException("PREFERENCE_SIZE_LIMIT");
    for(var e:JsonParser.parseString(Files.readString(file)).getAsJsonObject().entrySet()){
     JsonObject item=e.getValue().getAsJsonObject();JsonElement v=item.get("value");Object value;
     switch(item.get("type").getAsString()){
      case "string":value=v.getAsString();break;case "int":value=v.getAsInt();break;case "long":value=v.getAsLong();break;
      case "float":value=v.getAsFloat();break;case "boolean":value=v.getAsBoolean();break;
      case "set":Set<String> set=new HashSet<>();for(JsonElement x:v.getAsJsonArray())set.add(x.getAsString());value=set;break;
      default:throw new IllegalStateException("Unknown preference type");
     }data.put(e.getKey(),value);
    }
   }
  }catch(Exception e){throw new IllegalStateException("Preference restore failed",e);}
 }
 private boolean persist(){Path stage=null;try{
  JsonObject json=new JsonObject();for(var e:data.entrySet()){
   Object value=e.getValue();JsonObject item=new JsonObject();String type=value instanceof String?"string":value instanceof Integer?"int":value instanceof Long?"long":value instanceof Float?"float":value instanceof Boolean?"boolean":"set";
   item.addProperty("type",type);item.add("value",new Gson().toJsonTree(value));json.add(e.getKey(),item);
  }
  byte[] bytes=json.toString().getBytes(StandardCharsets.UTF_8);if(bytes.length>4*1024*1024)throw new IllegalStateException("PREFERENCE_SIZE_LIMIT");
  Files.createDirectories(file.getParent());stage=Files.createTempFile(file.getParent(),"prefs-",".json");Files.write(stage,bytes);Files.move(stage,file,StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE);return true;
 }catch(Exception e){HostServices.log("Preference persist failed: "+e);return false;}finally{if(stage!=null)try{Files.deleteIfExists(stage);}catch(Exception ignored){}}}
 private Object copy(Object value){return value instanceof Set?new HashSet<>((Set<?>)value):value;}
 public synchronized Map<String,?> getAll(){Map<String,Object> result=new HashMap<>();for(var e:data.entrySet())result.put(e.getKey(),copy(e.getValue()));return result;}
 public synchronized String getString(String key,String fallback){return data.containsKey(key)?(String)data.get(key):fallback;}
 @SuppressWarnings("unchecked") public synchronized Set<String> getStringSet(String key,Set<String> fallback){return data.containsKey(key)?new HashSet<>((Set<String>)data.get(key)):fallback;}
 public synchronized int getInt(String key,int fallback){return data.containsKey(key)?(Integer)data.get(key):fallback;}
 public synchronized long getLong(String key,long fallback){return data.containsKey(key)?(Long)data.get(key):fallback;}
 public synchronized float getFloat(String key,float fallback){return data.containsKey(key)?(Float)data.get(key):fallback;}
 public synchronized boolean getBoolean(String key,boolean fallback){return data.containsKey(key)?(Boolean)data.get(key):fallback;}
 public synchronized boolean contains(String key){return data.containsKey(key);}
 public synchronized void registerOnSharedPreferenceChangeListener(OnSharedPreferenceChangeListener l){listeners.add(l);}
 public synchronized void unregisterOnSharedPreferenceChangeListener(OnSharedPreferenceChangeListener l){listeners.remove(l);}
 public Editor edit(){return new Editor(){
  private final Map<String,Object> updates=new HashMap<>();private boolean clear;
  private synchronized Editor put(String key,Object value){updates.put(key,copy(value));return this;}
  public Editor putString(String key,String value){return put(key,value);}public Editor putStringSet(String key,Set<String> value){return put(key,value);}
  public Editor putInt(String key,int value){return put(key,value);}public Editor putLong(String key,long value){return put(key,value);}
  public Editor putFloat(String key,float value){return put(key,value);}public Editor putBoolean(String key,boolean value){return put(key,value);}
  public Editor remove(String key){return put(key,null);}public synchronized Editor clear(){clear=true;return this;}
  public void apply(){commit();}
  public boolean commit(){Set<String> changed=new HashSet<>();List<OnSharedPreferenceChangeListener> notify;boolean result;
   synchronized(this){synchronized(NativePreferences.this){
    // Android's clear removes the map without per-key listener notifications.
    if(clear)data.clear();for(var e:updates.entrySet()){
     Object old=data.get(e.getKey());if(e.getValue()==null){if(data.containsKey(e.getKey())){data.remove(e.getKey());changed.add(e.getKey());}}
     else if(!Objects.equals(old,e.getValue())){data.put(e.getKey(),e.getValue());changed.add(e.getKey());}
    }updates.clear();clear=false;result=persist();notify=new ArrayList<>(listeners);
   }}for(String key:changed)for(var l:notify)l.onSharedPreferenceChanged(NativePreferences.this,key);return result;
  }
 };}
}
