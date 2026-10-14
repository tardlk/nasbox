// SPDX-License-Identifier: GPL-3.0-only
package tvbox.runtime;
import java.nio.file.*;import java.net.*;import java.util.*;import java.util.jar.*;import java.lang.reflect.*;
import com.winbox.nativebridge.*;import com.github.tvbox.osc.base.App;
/** One native artifact per worker. All conversion, patches and guest files remain worker-owned. */
public final class NativeHost {
 private static Path owner;private static ClassLoader root,payloadLoader;private static int loaderCalls,spiderCalls;private static String lastSpider;private static int nullSpiderCalls;private static final Map<String,Integer> spiderTypes=new LinkedHashMap<>();
 private static boolean nativeJar(Path path)throws Exception{try(JarFile jar=new JarFile(path.toFile())){return jar.stream().anyMatch(e->e.getName().endsWith(".so"));}}
 public static URL[] outer(Path jar)throws Exception{
  if(owner!=null&&!owner.equals(jar))throw new IllegalStateException("NATIVE_WORKER_SINGLE_ARTIFACT");
  if(!nativeJar(jar))return new URL[]{jar.toUri().toURL()};owner=jar;
  Path directory=HostServices.directory.toPath().resolve("native"),work=directory.resolve("work"),patched=directory.resolve("patched");Files.createDirectories(work);Files.createDirectories(patched);
  System.setProperty("tvbox.d2j.cache",HostServices.directory.toPath().resolve("dex-cache").toString());
  java.security.Security.addProvider(new org.bouncycastle.jce.provider.BouncyCastleProvider());
  try(URLClassLoader resolver=new URLClassLoader(new URL[]{jar.toUri().toURL()},NativeHost.class.getClassLoader())){
   HostServices.log(NativeBridgeMain.prepare(jar.toFile(),work.toFile(),patched.toFile(),resolver));
  }catch(Throwable error){close();throw new IllegalStateException("NATIVE_PREPARE_FAILED: "+error,error);}
  return new URL[]{patched.toUri().toURL(),jar.toUri().toURL()};
 }
 public static void bind(ClassLoader loader)throws Exception{
  if(owner==null)return;root=loader;App.getInstance().setClassLoader(loader);android.app.ActivityThread.setCurrentApplication(App.getInstance());Thread.currentThread().setContextClassLoader(loader);
  NativeBridgeMain.rebind(owner.toFile(),HostServices.directory.toPath().resolve("native/work").toFile(),loader);
 }
 public static void observed(String className,String method,Object result){if(method.equals("getLoader")){loaderCalls++;if(result instanceof ClassLoader)payloadLoader=(ClassLoader)result;}if(method.equals("getSpider")){spiderCalls++;lastSpider=result==null?null:result.getClass().getName();if(lastSpider==null)nullSpiderCalls++;else spiderTypes.merge(lastSpider,1,Integer::sum);}}
 public static void afterInit(ClassLoader loader){if(root!=loader)return;boolean expected=NativeBridge.plan().values().stream().anyMatch(m->m.keySet().stream().anyMatch(k->k.startsWith("getLoader(")));HostServices.log("NATIVE_INIT loaderCalls="+loaderCalls+" loader="+(payloadLoader==null?"null":payloadLoader.getClass().getName()));if(expected&&(loaderCalls==0||payloadLoader==null))throw new IllegalStateException("NATIVE_GET_LOADER_NOT_READY");}
 public static void beforeClose(ClassLoader loader)throws Exception{if(root==loader){android.os.Looper.cancelOwned(root);NativeResources.closeOwned(root);}}
 public static void unbind(ClassLoader loader)throws Exception{if(root==loader)close();}
 public static Path resolve(Path path){if(Files.isRegularFile(path))return path;java.io.File file=PosixFile.resolveHost(path.toString());return file==null?path:file.toPath();}
 public static URL[] payload(Path jar)throws Exception{java.io.File patched=NativeBridgeMain.patchRuntimeJar(jar.toFile());if(patched==null&&NativeBridgeMain.hasNativeMethods(jar.toFile()))throw new java.io.IOException("NATIVE_PAYLOAD_PATCH_FAILED");return patched==null?new URL[]{jar.toUri().toURL()}:new URL[]{patched.toURI().toURL(),jar.toUri().toURL()};}
 public static void register(ClassLoader loader){NativeBridge.registerExtraLoader(loader);}
 public static void repair(Path source,Path jar)throws Exception{int fixed=DexJarRepair.repair(source.toFile(),jar.toFile(),"",System.getProperty("tvbox.dex.classpath"));if(fixed<0)throw new IllegalStateException("DEX_REPAIR_UNAVAILABLE");HostServices.log("DEX_REPAIR fixed="+fixed);Path framed=Files.createTempFile(jar.getParent(),"frames-",".jar");try{Class.forName("JarRewriter").getMethod("main",String[].class).invoke(null,(Object)new String[]{jar.toString(),framed.toString(),System.getProperty("java.class.path")});Files.move(framed,jar,StandardCopyOption.REPLACE_EXISTING);}finally{Files.deleteIfExists(framed);}}
 public static com.google.gson.JsonObject snapshot(){var value=new com.google.gson.JsonObject();value.addProperty("enabled",true);value.addProperty("workerPid",ProcessHandle.current().pid());value.addProperty("owner",owner==null?null:owner.getFileName().toString());value.addProperty("report",NativeBridge.report());value.addProperty("payload",NativeBridge.payloadReport());value.addProperty("loaderCalls",loaderCalls);value.addProperty("payloadLoader",payloadLoader==null?null:payloadLoader.getClass().getName());value.addProperty("spiderCalls",spiderCalls);value.addProperty("nullSpiderCalls",nullSpiderCalls);value.add("spiderTypes",new com.google.gson.Gson().toJsonTree(spiderTypes));value.addProperty("lastSpider",lastSpider);try{Field e=NativeBridge.class.getDeclaredField("emulator");e.setAccessible(true);Object emulator=e.get(null);value.addProperty("backend",emulator==null?null:((com.github.unidbg.AndroidEmulator)emulator).getBackend().getClass().getName());Field ex=NativeBridge.class.getDeclaredField("EXTRA_LOADERS");ex.setAccessible(true);value.addProperty("extraLoaders",((Collection<?>)ex.get(null)).size());value.addProperty("dexLoaders",dalvik.system.BaseDexClassLoader.ownedCount());value.addProperty("listeners",NativeResources.count());}catch(Exception e){throw new IllegalStateException(e);}return value;}
 public static Object probe()throws Exception{return probe("unicorn2",64).get("value").getAsInt();}
 public static com.google.gson.JsonObject probe(String backend,int bits)throws Exception{
  if(!Set.of("unicorn2","dynarmic").contains(backend)||(bits!=32&&bits!=64)||(bits==32&&!backend.equals("unicorn2")))throw new IllegalArgumentException("Unsupported ARM probe backend/architecture");
  var root=HostServices.directory.toPath().resolve("probe-"+bits+"-"+backend).toFile();
  com.github.unidbg.arm.backend.BackendFactory factory=backend.equals("unicorn2")?new com.github.unidbg.arm.backend.Unicorn2Factory(true):new com.github.unidbg.arm.backend.DynarmicFactory(true);
  try(com.github.unidbg.AndroidEmulator emu=bits==64?com.github.unidbg.linux.android.AndroidEmulatorBuilder.for64Bit().setRootDir(root).addBackendFactory(factory).build():new BridgeARM32Emulator("tvbox.probe",root,Collections.singletonList(factory))){
   long address=0x10000000L;emu.getBackend().mem_map(address,4096,7);
   emu.getBackend().mem_write(address,bits==64?new byte[]{0x40,0x05,(byte)0x80,0x52,(byte)0xc0,0x03,0x5f,(byte)0xd6}:new byte[]{0x2b,0x00,(byte)0xa0,(byte)0xe3,0x1e,(byte)0xff,0x2f,(byte)0xe1});
   var result=new com.google.gson.JsonObject();result.addProperty("value",emu.eFunc(address).intValue());result.addProperty("bits",bits);result.addProperty("backend",emu.getBackend().getClass().getName());return result;
  }
 }
 public static void close()throws Exception{
  beforeClose(root);dalvik.system.BaseDexClassLoader.closeAll();PosixFile.setRootfs(null);Exception failure=null;for(String name:new String[]{"payloadEmulator","emulator"}){Field f=NativeBridge.class.getDeclaredField(name);f.setAccessible(true);Object value=f.get(null);try{if(value instanceof java.io.Closeable)((java.io.Closeable)value).close();}catch(Exception e){failure=e;}finally{f.set(null,null);}}
  for(String name:new String[]{"vm","module","payloadVm","lazyJar","lazyWork","lazyResolver"}){Field f=NativeBridge.class.getDeclaredField(name);f.setAccessible(true);f.set(null,null);}
  for(String name:new String[]{"inited","payloadInShell"}){Field f=NativeBridge.class.getDeclaredField(name);f.setAccessible(true);f.setBoolean(null,false);}
  for(String name:new String[]{"CLASSES","PLAN","WRAPPED","PAYLOAD_LIBS","PAYLOAD_INIT_FAILURES","EXTRA_LOADERS"}){Field f=NativeBridge.class.getDeclaredField(name);f.setAccessible(true);Object v=f.get(null);if(v instanceof Map)((Map<?,?>)v).clear();else if(v instanceof Collection)((Collection<?>)v).clear();}
  for(String name:new String[]{"report","payloadReport","soName"}){Field f=NativeBridge.class.getDeclaredField(name);f.setAccessible(true);f.set(null,"");}
  Field digest=NativeBridge.class.getDeclaredField("outerSoDigest");digest.setAccessible(true);digest.set(null,null);NativePreferences.releaseListeners();
  Field hosts=EnvJni.class.getDeclaredField("HOST_BY_VM");hosts.setAccessible(true);((Map<?,?>)hosts.get(null)).clear();EnvJni.setHostLoader(null);owner=null;root=null;payloadLoader=null;loaderCalls=spiderCalls=nullSpiderCalls=0;spiderTypes.clear();lastSpider=null;App.getInstance().setClassLoader(null);Thread.currentThread().setContextClassLoader(NativeHost.class.getClassLoader());if(failure!=null)throw failure;
 }
}
