// SPDX-License-Identifier: GPL-3.0-only
package dalvik.system;
import java.io.*;import java.net.*;import java.nio.file.*;import java.util.*;
/** Host translation boundary, not Android's BaseDexClassLoader implementation. */
public class BaseDexClassLoader extends URLClassLoader {
 private static final Set<BaseDexClassLoader> owned=Collections.newSetFromMap(new IdentityHashMap<>());
 public BaseDexClassLoader(String path,File optimized,String libraries,ClassLoader parent)throws IOException{
  super(urls(path,libraries),parent);synchronized(owned){owned.add(this);}try{tvbox.runtime.NativeHooks.register(this);}catch(Exception e){close();throw new IOException(e);}
 }
 private static URL[] urls(String paths,String libraries)throws IOException{
  if(!tvbox.runtime.NativeHooks.enabled()&&libraries!=null&&!libraries.isEmpty())throw new IOException("NATIVE_LIBRARY_PATH_UNAVAILABLE");
  String[] parts=paths.split(java.util.regex.Pattern.quote(File.pathSeparator));java.util.List<URL> urls=new java.util.ArrayList<>();
  try{for(String part:parts){Path path=tvbox.runtime.NativeHooks.resolve(Path.of(part));Path jar=tvbox.runtime.DexArtifacts.prepare(path);urls.addAll(Arrays.asList(tvbox.runtime.NativeHooks.payload(jar)));}return urls.toArray(new URL[0]);}catch(Exception e){throw new IOException("DEX_CLASSLOADER_FAILED: "+e.getMessage(),e);}
 }
 public void close()throws IOException{try{closeChildren(this);}finally{try{super.close();}finally{synchronized(owned){owned.remove(this);}}}}
 public static void closeChildren(ClassLoader parent)throws IOException{List<BaseDexClassLoader> copy;synchronized(owned){copy=new ArrayList<>(owned);}IOException failure=null;for(BaseDexClassLoader child:copy)if(child.getParent()==parent)try{child.close();}catch(IOException e){failure=e;}if(failure!=null)throw failure;}
 public static int ownedCount(){synchronized(owned){return owned.size();}}
 public static void closeAll()throws IOException{List<BaseDexClassLoader> copy;synchronized(owned){copy=new ArrayList<>(owned);}IOException failure=null;for(BaseDexClassLoader child:copy)try{child.close();}catch(IOException e){failure=e;}if(failure!=null)throw failure;}
}
