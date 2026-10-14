// SPDX-License-Identifier: GPL-3.0-only
package dalvik.system;
public class DexClassLoader extends BaseDexClassLoader {
 public DexClassLoader(String path,String optimized,String libraries,ClassLoader parent)throws java.io.IOException{super(path,optimized==null?null:new java.io.File(optimized),libraries,parent);}
}
