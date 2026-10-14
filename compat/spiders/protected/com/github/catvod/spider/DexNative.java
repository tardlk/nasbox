package com.github.catvod.spider;
import android.content.Context;import dalvik.system.DexClassLoader;
import java.io.*;import javax.crypto.Cipher;import javax.crypto.spec.*;
/** Owned synthetic AES payload, no proprietary protection code or native emulation. */
public class DexNative {
 public static Object getLoader(Object context)throws Exception{
  Context c=(Context)context;byte[] key="fixture-key-1234".getBytes("UTF-8");
  Cipher cipher=Cipher.getInstance("AES/CBC/PKCS5Padding");cipher.init(Cipher.DECRYPT_MODE,new SecretKeySpec(key,"AES"),new IvParameterSpec(key));
  ByteArrayOutputStream bytes=new ByteArrayOutputStream();try(InputStream in=DexNative.class.getResourceAsStream("/assets/payload.guard")){byte[] b=new byte[4096];int n;while((n=in.read(b))!=-1)bytes.write(b,0,n);}
  File path=new File(c.getFilesDir(),"fixture-payload.dex");try(FileOutputStream out=new FileOutputStream(path)){out.write(cipher.doFinal(bytes.toByteArray()));}
  return new DexClassLoader(path.getPath(),c.getCacheDir().getPath(),null,DexNative.class.getClassLoader());
 }
}
