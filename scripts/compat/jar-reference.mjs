// Original lifecycle/cache methods; class-loading and artifact resolution are host boundaries.
import {readFileSync}from'node:fs';
import{resolve}from'node:path';
import{root,reference,verifyReference,sha256}from'./reference.mjs';
import{verifyPlatformReference}from'./platform-reference.mjs';
import{extractMethod}from'./oracle.mjs';
export function jarReference(){
 verifyReference();const{extra}=verifyPlatformReference();
 const source=readFileSync(resolve(reference,'app/src/main/java/com/github/catvod/crawler/JarLoader.java'),'utf8');
 const md5=readFileSync(resolve(extra,'app/src/main/java/com/github/tvbox/osc/util/MD5.java'),'utf8');
 const signatures=['public Spider getSpider(','public void clear(','public void setRecentJarKey(','public void loadLiveJar(',
 'private boolean invokeInit(','private void invokeProxy(','private void invokeDanmaku(','public void searchDanmuUi(','public boolean hasDanmuSearchUi(',
 'public JSONObject jsonExt(','public JSONObject jsonExtMix(','public Object[] proxyInvoke(','private Object[] proxyInvoke(',
 'private DexClassLoader requireRecentLoader(','private Class<?> loadParserClass(','private String jarKey(','private String realKey(',
 'private String className(','private void injectProxyPort(','private int getServerPort('];
 const originals=signatures.map(s=>extractMethod(source,s));
 const methods=originals.map(m=>m.replaceAll('DexClassLoader','JvmJarClassLoader'));
 const adapters=readFileSync(resolve(root,'scripts/compat/jar-adapters.java.txt'),'utf8');
 const code=`// SPDX-License-Identifier: GPL-3.0-only\n// Original TVBoxOS methods, explicit JVM/translated-DEX bindings; see NOTICE.md.\npackage tvbox.runtime;\nimport com.github.catvod.crawler.*;\nimport com.github.tvbox.osc.base.App;\nimport com.github.tvbox.osc.server.ControlManager;\nimport android.content.Context;\nimport java.io.*;\nimport java.lang.reflect.*;\nimport java.nio.file.*;\nimport java.util.*;\nimport java.util.concurrent.ConcurrentHashMap;\nimport org.json.JSONObject;\npublic final class JarExecutor {\n${adapters}\n${methods.join('\n')}\nstatic class MD5 {static final java.security.MessageDigest sDigest;static{try{sDigest=java.security.MessageDigest.getInstance("MD5");}catch(Exception e){throw new RuntimeException(e);}}${extractMethod(md5,'public static String string2MD5(')}}\n}\n`;
 return{source:code.replace(/[ \t]+$/gm,''),extraction:signatures.map((signature,i)=>({signature,sha256:sha256(originals[i])}))};
}
