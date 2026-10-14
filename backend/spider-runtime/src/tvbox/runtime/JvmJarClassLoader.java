// SPDX-License-Identifier: GPL-3.0-only
package tvbox.runtime;
import java.net.URLClassLoader;import java.nio.file.Path;
/** Parent-first JVM loader; DEX is translated before opening the archive. */
public final class JvmJarClassLoader extends URLClassLoader {
 public JvmJarClassLoader(Path path)throws Exception{super(new java.net.URL[]{DexArtifacts.prepare(path).toUri().toURL()},JvmJarClassLoader.class.getClassLoader());}
 public void close()throws java.io.IOException{try{dalvik.system.BaseDexClassLoader.closeChildren(this);}finally{super.close();}}
}
