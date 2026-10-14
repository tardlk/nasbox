// SPDX-License-Identifier: GPL-3.0-only
package tvbox.runtime;
import java.nio.file.*;import java.net.*;
/** Optional profile boundary; the ordinary runtime never loads native dependencies. */
public final class NativeHooks {
 public static boolean enabled(){return Boolean.getBoolean("tvbox.native.enabled");}
 private static Object invoke(String method,Class<?>[] types,Object...args)throws Exception{
  try{return Class.forName("tvbox.runtime.NativeHost").getMethod(method,types).invoke(null,args);}catch(java.lang.reflect.InvocationTargetException e){Throwable cause=e.getCause();if(cause instanceof Exception)throw (Exception)cause;if(cause instanceof Error)throw (Error)cause;throw new RuntimeException(cause);}
 }
 public static URL[] outer(Path path)throws Exception{Path jar=DexArtifacts.prepare(path);return enabled()?(URL[])invoke("outer",new Class<?>[]{Path.class},jar):new URL[]{jar.toUri().toURL()};}
 public static void bind(ClassLoader loader)throws Exception{if(enabled())invoke("bind",new Class<?>[]{ClassLoader.class},loader);}
 public static void afterInit(ClassLoader loader)throws Exception{if(enabled())invoke("afterInit",new Class<?>[]{ClassLoader.class},loader);}
 public static void beforeClose(ClassLoader loader)throws java.io.IOException{if(enabled())try{invoke("beforeClose",new Class<?>[]{ClassLoader.class},loader);}catch(Exception e){throw new java.io.IOException("Native listener cleanup failed",e);}}
 public static void unbind(ClassLoader loader)throws java.io.IOException{if(enabled())try{invoke("unbind",new Class<?>[]{ClassLoader.class},loader);}catch(Exception e){throw new java.io.IOException("Native cleanup failed",e);}}
 public static Path resolve(Path path)throws Exception{return enabled()?(Path)invoke("resolve",new Class<?>[]{Path.class},path):path;}
 public static URL[] payload(Path path)throws Exception{return enabled()?(URL[])invoke("payload",new Class<?>[]{Path.class},path):new URL[]{path.toUri().toURL()};}
 public static void register(ClassLoader loader)throws Exception{if(enabled())invoke("register",new Class<?>[]{ClassLoader.class},loader);}
 public static void repair(Path source,Path jar)throws Exception{if(enabled())invoke("repair",new Class<?>[]{Path.class,Path.class},source,jar);}
 public static com.google.gson.JsonObject snapshot()throws Exception{if(enabled())return (com.google.gson.JsonObject)invoke("snapshot",new Class<?>[0]);var value=new com.google.gson.JsonObject();value.addProperty("enabled",false);return value;}
 public static Object probe()throws Exception{if(!enabled())throw new IllegalStateException("NATIVE_PROFILE_REQUIRED");return invoke("probe",new Class<?>[0]);}
 public static Object probe(String backend,int bits)throws Exception{if(!enabled())throw new IllegalStateException("NATIVE_PROFILE_REQUIRED");return invoke("probe",new Class<?>[]{String.class,int.class},backend,bits);}
 public static void close()throws Exception{if(enabled())invoke("close",new Class<?>[0]);}
}
