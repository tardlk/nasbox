package com.github.catvod.spider;
import android.content.Context;import dalvik.system.DexClassLoader;
public class Init {
 private static final Init INSTANCE=new Init();
 public Context c;public DexClassLoader loader;
 public static int normalCalls;public static boolean names,proxy;
 public static Init get(){return INSTANCE;}
 public static void init(Context context){System.setProperty("fixture.whitelist","WHITELIST");normalCalls++;}
 public static void protectionMarker(){android.os.Process.killProcess(android.os.Process.myPid());}
 public static void replaceCloudDiskNames(){names=true;}
 public static void startGoProxy(Context context){proxy=context==INSTANCE.c;}
}
