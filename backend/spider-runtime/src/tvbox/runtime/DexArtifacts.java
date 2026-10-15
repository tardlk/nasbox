// SPDX-License-Identifier: GPL-3.0-only
package tvbox.runtime;
import java.io.*;
import java.net.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.zip.*;
/** Bounded DEX translation on the worker JVM. This does not implement ART or JNI. */
public final class DexArtifacts {
 private static final int LIMIT=64*1024*1024, TOTAL=96*1024*1024, ENTRIES=8192;
 private static URLClassLoader converter;
 private static String hash(byte[] b)throws Exception{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(b));}
 private static byte[] read(InputStream in)throws IOException{byte[] b=in.readNBytes(LIMIT+1);if(b.length>LIMIT)throw new IOException("ARTIFACT_SIZE_LIMIT");return b;}
 private static boolean dex(byte[] b){return b.length>=3&&b[0]=='d'&&b[1]=='e'&&b[2]=='x';}
 private static Map<String,byte[]> entries(Path path)throws IOException{
  Map<String,byte[]> result=new LinkedHashMap<>();long total=0;
  try(ZipFile zip=new ZipFile(path.toFile())){Enumeration<? extends ZipEntry> en=zip.entries();int count=0;
   while(en.hasMoreElements()){ZipEntry e=en.nextElement();if(++count>ENTRIES)throw new IOException("ARTIFACT_ENTRY_LIMIT");String n=e.getName();
    if(n.startsWith("/")||n.contains("\\")||Arrays.asList(n.split("/")).contains(".."))throw new IOException("INVALID_ENTRY_NAME");
    if(e.isDirectory())continue;
    if(result.containsKey(n))throw new IOException("DUPLICATE_ENTRY");
    String lower=n.toLowerCase(Locale.ROOT);if((lower.endsWith(".dll")||lower.endsWith(".dylib")||lower.endsWith(".so")&&!NativeHooks.enabled()))throw new IOException("NATIVE_PLUGIN_UNAVAILABLE");
    byte[] bytes;try(InputStream in=zip.getInputStream(e)){bytes=read(in);}total+=bytes.length;if(total>TOTAL)throw new IOException("ARTIFACT_EXPANSION_LIMIT");result.put(n,bytes);
   }
  }return result;
 }
 public static synchronized Path prepare(Path path)throws Exception{
  RuntimeCache.initialize();
  if(Files.size(path)>LIMIT)throw new IOException("ARTIFACT_SIZE_LIMIT");
  byte[] original=Files.readAllBytes(path);Map<String,byte[]> input=dex(original)?new LinkedHashMap<>(Map.of("classes.dex",original)):entries(path);
  boolean hasDex=input.keySet().stream().anyMatch(n->n.endsWith(".dex"));
  if(!hasDex){if(input.keySet().stream().noneMatch(n->n.endsWith(".class")))throw new IOException("NO_EXECUTABLE_CLASSES");return path;}
  String cp=System.getProperty("tvbox.dex.classpath","");if(cp.isEmpty())throw new IOException("DEX_CONVERTER_UNAVAILABLE");
  String key=hash((hash(original)+System.getProperty("tvbox.dex.fingerprint","")+System.getProperty("tvbox.native.fingerprint","")+"dex-artifacts-v2").getBytes(java.nio.charset.StandardCharsets.UTF_8));
  Path dir=HostServices.directory.toPath().toRealPath().resolve("dex-cache");Files.createDirectories(dir);Path target=dir.resolve(key+".jar"),digest=dir.resolve(key+".sha256");
  if(Files.isRegularFile(target,LinkOption.NOFOLLOW_LINKS)&&Files.isRegularFile(digest,LinkOption.NOFOLLOW_LINKS)&&Files.size(digest)==64&&Files.size(target)<=TOTAL&&hash(Files.readAllBytes(target)).equals(Files.readString(digest))){RuntimeCache.pinDex(target);return target;}
  Path stage=RuntimeCache.createWorkspace();
  try{
   if(converter==null){String[] paths=cp.split(java.util.regex.Pattern.quote(File.pathSeparator));URL[] urls=new URL[paths.length];for(int i=0;i<paths.length;i++)urls[i]=Path.of(paths[i]).toUri().toURL();converter=new URLClassLoader(urls,ClassLoader.getPlatformClassLoader());}
   Class<?> type=converter.loadClass("com.googlecode.d2j.dex.Dex2jar");Map<String,byte[]> output=new LinkedHashMap<>();long total=0;
   for(Map.Entry<String,byte[]> e:input.entrySet())if(e.getKey().endsWith(".dex")){
    byte[] bytes=e.getValue();if(bytes.length<112||!dex(bytes))throw new IOException("INVALID_DEX_HEADER");Path converted=stage.resolve("part.jar");
    try{Object translator=type.getMethod("from",byte[].class).invoke(null,(Object)bytes);type.getMethod("to",Path.class).invoke(translator,converted);}catch(java.lang.reflect.InvocationTargetException ex){throw new IOException("DEX_CONVERSION_FAILED",ex.getCause());}
    if(NativeHooks.enabled()){Path raw=stage.resolve("repair.dex");Files.write(raw,bytes);try{NativeHooks.repair(raw,converted);}finally{Files.deleteIfExists(raw);}}
    for(Map.Entry<String,byte[]> cls:entries(converted).entrySet())if(cls.getKey().endsWith(".class")){if(output.putIfAbsent(cls.getKey(),cls.getValue())!=null)throw new IOException("DUPLICATE_DEX_CLASS");total+=cls.getValue().length;}
    Files.delete(converted);
   }
   if(output.isEmpty())throw new IOException("DEX_NO_CLASSES");
   for(Map.Entry<String,byte[]> e:input.entrySet()){
    String name=e.getKey(),upper=name.toUpperCase(Locale.ROOT);if(name.endsWith(".dex")||name.endsWith(".class")||(upper.startsWith("META-INF/")&&(upper.endsWith(".SF")||upper.endsWith(".RSA")||upper.endsWith(".DSA")||upper.endsWith(".EC"))))continue;
    output.put(name,e.getValue());total+=e.getValue().length;
   }
   if(total>TOTAL||output.size()>ENTRIES)throw new IOException("CONVERTED_ARTIFACT_LIMIT");
   Path jar=stage.resolve("merged.jar");try(ZipOutputStream zip=new ZipOutputStream(Files.newOutputStream(jar))){for(Map.Entry<String,byte[]> e:output.entrySet()){zip.putNextEntry(new ZipEntry(e.getKey()));zip.write(e.getValue());zip.closeEntry();}}
   String sum=hash(Files.readAllBytes(jar));RuntimeCache.writeDex(jar,target,sum);return target;
  }finally{try(var walk=Files.walk(stage)){for(Path p:walk.sorted(Comparator.reverseOrder()).toList())Files.deleteIfExists(p);}}
 }
 public static synchronized void baksmali(Path source,Path target)throws Exception{
  if(converter==null)throw new IllegalStateException("DEX converter not initialized");Class<?> type=converter.loadClass("com.googlecode.d2j.smali.Baksmali");Object parser=type.getMethod("from",java.io.File.class).invoke(null,source.toFile());type.getMethod("to",Path.class).invoke(parser,target);
 }
 public static synchronized void close()throws IOException{if(converter!=null){converter.close();converter=null;}}
}
