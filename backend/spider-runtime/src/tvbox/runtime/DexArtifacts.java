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
 private static boolean zeroTypeMerge(Throwable failure){
  for(Throwable cause=failure;cause!=null;cause=cause.getCause())if("Can't merge L and Z".equals(cause.getMessage())||"Can't merge Z and L".equals(cause.getMessage()))
   for(StackTraceElement frame:cause.getStackTrace())if(frame.getClassName().equals("com.googlecode.dex2jar.ir.TypeClass")&&frame.getMethodName().equals("merge"))return true;
  return false;
 }
 private static Object field(Object value,String name)throws ReflectiveOperationException{return value.getClass().getField(name).get(value);}
 /** Split a proven-zero branch value from its boolean SSA type, without changing its bits.
  * Only an edge with one predecessor can establish this fact. Handler entries and
  * switch/jump joins are counted too, so an unrelated nonzero path is never changed.
  * Reflection keeps the optional converter out of the worker's application loader.
  */
 private static Object zeroBranchReader(byte[] bytes)throws Exception{
  Class<?> readerType=converter.loadClass("com.googlecode.d2j.reader.DexFileReader"),baseType=converter.loadClass("com.googlecode.d2j.reader.BaseDexFileReader"),visitorType=converter.loadClass("com.googlecode.d2j.visitors.DexFileVisitor"),nodeType=converter.loadClass("com.googlecode.d2j.node.DexFileNode"),opType=converter.loadClass("com.googlecode.d2j.reader.Op");
  Object reader=readerType.getConstructor(byte[].class).newInstance((Object)bytes),node=nodeType.getConstructor().newInstance();
  readerType.getMethod("accept",visitorType,int.class).invoke(reader,node,readerType.getField("SKIP_DEBUG").getInt(null));
  List<?> classes=(List<?>)field(node,"clzs");int changed=0;
  for(Object cls:classes){List<?> methods=(List<?>)field(cls,"methods");if(methods==null)continue;
   for(Object method:methods){Object code=field(method,"codeNode");if(code==null)continue;List<?> stmts=(List<?>)field(code,"stmts");
    Map<Object,Integer> labels=new IdentityHashMap<>();List<Set<Integer>> incoming=new ArrayList<>(stmts.size());
    for(int i=0;i<stmts.size();i++){incoming.add(new HashSet<>());Object stmt=stmts.get(i);if(stmt.getClass().getSimpleName().equals("DexLabelStmtNode"))labels.put(field(stmt,"label"),i);}
    for(int i=0;i<stmts.size();i++){Object stmt=stmts.get(i);Enum<?> op=(Enum<?>)field(stmt,"op");String name=op==null?"":op.name();
     if(i+1<stmts.size()&&!name.startsWith("GOTO")&&!name.startsWith("RETURN")&&!name.equals("THROW"))incoming.get(i+1).add(i);
     if(stmt.getClass().getSimpleName().equals("JumpStmtNode"))incoming.get(labels.get(field(stmt,"label"))).add(i);
     if(name.equals("PACKED_SWITCH")||name.equals("SPARSE_SWITCH"))for(Object label:(Object[])field(stmt,"labels"))incoming.get(labels.get(label)).add(i);
    }
    List<?> tries=(List<?>)field(code,"tryStmts");if(tries!=null)for(Object entry:tries)for(Object handler:(Object[])field(entry,"handler"))incoming.get(labels.get(handler)).add(-1);
    Map<Integer,Integer> insert=new HashMap<>();
    for(int i=0;i<stmts.size();i++){Object stmt=stmts.get(i);Enum<?> op=(Enum<?>)field(stmt,"op");if(op==null)continue;String name=op.name();
     if(name.equals("IF_EQZ")||name.equals("IF_NEZ")){int target=name.equals("IF_EQZ")?labels.get(field(stmt,"label")):i+1;
      int other=name.equals("IF_EQZ")?i+1:labels.get(field(stmt,"label"));
      if(target!=other&&target<stmts.size()&&incoming.get(target).equals(Set.of(i)))insert.put(target,(Integer)field(stmt,"a"));
     }
    }
    if(insert.isEmpty())continue;
    var constant=converter.loadClass("com.googlecode.d2j.node.insn.ConstStmtNode").getConstructor(opType,int.class,Object.class);Object zero=opType.getField("CONST_4").get(null);List<Object> refined=new ArrayList<>(stmts.size()+insert.size());
    for(int i=0;i<stmts.size();i++){Object stmt=stmts.get(i);Integer register=insert.get(i);boolean label=stmt.getClass().getSimpleName().equals("DexLabelStmtNode");
     if(register!=null&&!label)refined.add(constant.newInstance(zero,register,0));refined.add(stmt);if(register!=null&&label)refined.add(constant.newInstance(zero,register,0));
    }
    code.getClass().getField("stmts").set(code,refined);changed+=insert.size();
   }
  }
  if(changed==0)return null;
  return java.lang.reflect.Proxy.newProxyInstance(converter,new Class<?>[]{baseType},(proxy,method,args)->{
   if(method.getName().equals("accept")){
    if(args.length==3){Object cls=classes.get((Integer)args[1]);cls.getClass().getMethod("accept",visitorType).invoke(cls,args[0]);}
    else nodeType.getMethod("accept",visitorType).invoke(node,args[0]);return null;
   }
   return method.invoke(reader,args);
  });
 }
 private static void translate(Class<?> type,byte[] bytes,Path converted)throws Exception{
  try{Object translator=type.getMethod("from",byte[].class).invoke(null,(Object)bytes);type.getMethod("to",Path.class).invoke(translator,converted);}
  catch(java.lang.reflect.InvocationTargetException original){
   if(!zeroTypeMerge(original.getCause()))throw new IOException("DEX_CONVERSION_FAILED",original.getCause());
   try{Object reader=zeroBranchReader(bytes);if(reader==null)throw new IOException("DEX_ZERO_BRANCH_NOT_PROVEN");
    Object translator=type.getMethod("from",converter.loadClass("com.googlecode.d2j.reader.BaseDexFileReader")).invoke(null,reader);type.getMethod("to",Path.class).invoke(translator,converted);
   }catch(Exception retry){Throwable cause=retry instanceof java.lang.reflect.InvocationTargetException?retry.getCause():retry;cause.addSuppressed(original.getCause());throw new IOException("DEX_CONVERSION_FAILED",cause);}
  }
 }
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
  String key=hash((hash(original)+System.getProperty("tvbox.dex.fingerprint","")+System.getProperty("tvbox.native.fingerprint","")+"dex-artifacts-v3-zero-branch").getBytes(java.nio.charset.StandardCharsets.UTF_8));
  Path dir=HostServices.directory.toPath().toRealPath().resolve("dex-cache");Files.createDirectories(dir);Path target=dir.resolve(key+".jar"),digest=dir.resolve(key+".sha256");
  if(Files.isRegularFile(target,LinkOption.NOFOLLOW_LINKS)&&Files.isRegularFile(digest,LinkOption.NOFOLLOW_LINKS)&&Files.size(digest)==64&&Files.size(target)<=TOTAL&&hash(Files.readAllBytes(target)).equals(Files.readString(digest))){RuntimeCache.pinDex(target);return target;}
  Path stage=RuntimeCache.createWorkspace();
  try{
   if(converter==null){String[] paths=cp.split(java.util.regex.Pattern.quote(File.pathSeparator));URL[] urls=new URL[paths.length];for(int i=0;i<paths.length;i++)urls[i]=Path.of(paths[i]).toUri().toURL();converter=new URLClassLoader(urls,ClassLoader.getPlatformClassLoader());}
   Class<?> type=converter.loadClass("com.googlecode.d2j.dex.Dex2jar");Map<String,byte[]> output=new LinkedHashMap<>();long total=0;
   for(Map.Entry<String,byte[]> e:input.entrySet())if(e.getKey().endsWith(".dex")){
    byte[] bytes=e.getValue();if(bytes.length<112||!dex(bytes))throw new IOException("INVALID_DEX_HEADER");Path converted=stage.resolve("part.jar");
    translate(type,bytes,converted);
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
