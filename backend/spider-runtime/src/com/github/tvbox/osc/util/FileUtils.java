// SPDX-License-Identifier: GPL-3.0-only
package com.github.tvbox.osc.util;
import java.nio.file.*;import java.net.URI;import java.nio.charset.StandardCharsets;import java.util.*;
/** Registered module/local-file boundary; not Android FileUtils network/assets cache. */
public final class FileUtils {
 private static final Map<String,String> modules=new HashMap<>();
 private static final Map<String,byte[]> compiled=new HashMap<>();
 public static Path moduleRoot;
 public static boolean androidModules=false;
 public static void register(String name,String content){modules.put(name,content);}
 public static String loadModule(String name){
  if(modules.containsKey(name))return modules.get(name);
  try{
   if(name.equals("net.js")){try(java.io.InputStream in=FileUtils.class.getResourceAsStream("/tvbox/runtime/net.js")){return new String(in.readAllBytes(),StandardCharsets.UTF_8);}}
   if(androidModules)return tvbox.runtime.SourceModuleLoader.resolve(name);
   if(moduleRoot==null)return "";
   Path path=name.startsWith("file:")?Paths.get(URI.create(name)):moduleRoot.resolve(name);
   path=path.toRealPath();if(!path.startsWith(moduleRoot.toRealPath()))throw new IllegalArgumentException("Module outside configured root");
   if(Files.size(path)>6*1024*1024)throw new IllegalArgumentException("Module exceeds size limit");
   return Files.readString(path,StandardCharsets.UTF_8);
  }catch(Exception e){if(androidModules)tvbox.runtime.HostServices.log("MODULE_LOAD_FAILED "+e.getClass().getSimpleName()+": "+e.getMessage());return "";}
 }
 public static void setCacheByte(String name,byte[] bytes){compiled.put(name,bytes.clone());}
 public static void clear(){modules.clear();compiled.clear();moduleRoot=null;androidModules=false;tvbox.runtime.SourceModuleLoader.reset();}
}
