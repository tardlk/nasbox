// SPDX-License-Identifier: GPL-3.0-only
package tvbox.runtime;
import java.net.URLClassLoader;
import java.nio.file.Path;
import java.util.zip.ZipFile;
/** JVM class JARs only. This is not a DEX interpreter or an Android classloader. */
public final class JvmJarClassLoader extends URLClassLoader {
 public JvmJarClassLoader(Path path)throws Exception{
  super(new java.net.URL[]{path.toUri().toURL()},JvmJarClassLoader.class.getClassLoader());
  try(ZipFile jar=new ZipFile(path.toFile())){
   if(jar.stream().anyMatch(e->e.getName().endsWith(".dex")||e.getName().endsWith(".so")||e.getName().endsWith(".dll")||e.getName().endsWith(".dylib")))throw new UnsupportedOperationException("DEX/native artifacts are not implemented");
   boolean hasClass=jar.stream().anyMatch(e->e.getName().endsWith(".class"));
   if(!hasClass)throw new UnsupportedOperationException(jar.getEntry("classes.dex")!=null?"DEX execution is not implemented":"No JVM classes in JAR");
  }catch(Exception e){close();throw e;}
 }
}
