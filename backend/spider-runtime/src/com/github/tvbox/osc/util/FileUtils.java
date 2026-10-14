// SPDX-License-Identifier: GPL-3.0-only
package com.github.tvbox.osc.util;
import java.nio.file.*;import java.net.URI;import java.nio.charset.StandardCharsets;import java.util.*;
/** Registered module/local-file boundary; not Android FileUtils network/assets cache. */
public final class FileUtils {
 private static final Map<String,String> modules=new HashMap<>();
 private static final Map<String,byte[]> compiled=new HashMap<>();
 public static Path moduleRoot;
 public static void register(String name,String content){modules.put(name,content);}
 public static String loadModule(String name){
  if(modules.containsKey(name))return modules.get(name);
  try{
   if(name.equals("net.js"))return new String(FileUtils.class.getResourceAsStream("/tvbox/runtime/net.js").readAllBytes(),StandardCharsets.UTF_8);
   if(moduleRoot==null)return "";
   Path path=name.startsWith("file:")?Paths.get(URI.create(name)):moduleRoot.resolve(name);
   path=path.toRealPath();if(!path.startsWith(moduleRoot.toRealPath()))throw new IllegalArgumentException("Module outside configured root");
   if(Files.size(path)>6*1024*1024)throw new IllegalArgumentException("Module exceeds size limit");
   return Files.readString(path,StandardCharsets.UTF_8);
  }catch(Exception e){return "";}
 }
 public static void setCacheByte(String name,byte[] bytes){compiled.put(name,bytes.clone());}
 public static void clear(){modules.clear();compiled.clear();moduleRoot=null;}
}
