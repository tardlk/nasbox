// SPDX-License-Identifier: GPL-3.0-only
package tvbox.runtime;
import java.net.URLClassLoader;import java.nio.file.Path;
/** Parent-first JVM loader; DEX is translated before opening the archive. */
public final class JvmJarClassLoader extends URLClassLoader {
 public JvmJarClassLoader(Path path)throws Exception{super(NativeHooks.outer(path),JvmJarClassLoader.class.getClassLoader());try{NativeHooks.bind(this);}catch(Exception e){close();throw e;}}
 public void close()throws java.io.IOException{try{NativeHooks.beforeClose(this);dalvik.system.BaseDexClassLoader.closeChildren(this);}finally{try{super.close();}finally{NativeHooks.unbind(this);}}}
}
