// Recompile pinned contracts/methods over explicit shared host bindings.
// This is a host-JVM reference probe, not Android/ART execution.
import{readFileSync,writeFileSync,mkdirSync,mkdtempSync,cpSync,readdirSync,copyFileSync}from'node:fs';
import{resolve,join,dirname,delimiter}from'node:path';import{spawnSync}from'node:child_process';
import{root,reference,verifyReference,sha256}from'./reference.mjs';import{verifyPlatformReference}from'./platform-reference.mjs';import{extractMethod}from'./oracle.mjs';
import{moduleReference}from'./module-reference.mjs';
import{jarReference}from'./jar-reference.mjs';import{jsReference,globalReference}from'./js-reference.mjs';import{buildSpiderRuntime}from'../../backend/spider-runtime/build.mjs';
function files(path){return readdirSync(path,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(join(path,e.name)):[join(path,e.name)]);}
export function buildSpiderOracle(runtime=buildSpiderRuntime()){
 const primary=verifyReference(),{extra}=verifyPlatformReference();const base=resolve(root,'.cache/compat/spider-oracle');mkdirSync(base,{recursive:true});const build=mkdtempSync(join(base,'run-')),src=join(build,'src'),classes=join(build,'classes');
 cpSync(resolve(root,'backend/spider-runtime/src'),src,{recursive:true});mkdirSync(classes);
 const originals=['app/src/main/java/com/github/catvod/crawler/Spider.java','app/src/main/java/com/github/catvod/crawler/SpiderApi.java','app/src/main/java/com/github/catvod/crawler/js/JsSpider.java','app/src/main/java/com/github/catvod/crawler/js/Req.java','app/src/main/java/com/github/catvod/crawler/js/Connect.java','quickjs/src/main/java/com/whl/quickjs/wrapper/UriUtil.java'];
 const additional=['app/src/main/java/com/github/catvod/crawler/SpiderDebug.java','app/src/main/java/com/github/catvod/crawler/js/HtmlParser.java','app/src/main/java/com/github/catvod/crawler/ProtectedInitJar.java','app/src/main/java/com/github/catvod/crawler/SpiderNull.java','app/src/main/java/com/github/catvod/crawler/js/Async.java','app/src/main/java/com/github/catvod/crawler/js/Json.java','app/src/main/java/com/github/catvod/crawler/js/Res.java','app/src/main/java/com/github/catvod/crawler/js/local.java','app/src/main/java/com/github/catvod/Proxy.java','app/src/main/java/com/github/tvbox/osc/util/MD5.java','quickjs/src/main/java/com/whl/quickjs/wrapper/JSUtils.java','quickjs/src/main/java/com/whl/quickjs/wrapper/ContextSetter.java','quickjs/src/main/java/com/whl/quickjs/wrapper/Function.java'];
 const copies=[];
 for(const[sourceBase,names]of[[reference,originals],[extra,additional]])for(const name of names){
  let source=readFileSync(resolve(sourceBase,name),'utf8');const hash=sha256(source);
  if(name.endsWith('/JsSpider.java'))source=source.replace('ctx = QuickJSContext.create();','ctx = QuickJSContext.create();\n        // Host resource bounds, applied before any module is compiled or executed.\n        ctx.setMemoryLimit(64 * 1024 * 1024);\n        ctx.setMaxStackSize(512 * 1024);');
  const target=join(src,name.split('/src/main/java/')[1]);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,source);copies.push({path:name,sha256:hash});
 }
 copyFileSync(resolve(extra,'app/src/main/assets/js/lib/net.js'),join(src,'tvbox/runtime/net.js'));
 const module=moduleReference();writeFileSync(join(src,'tvbox/runtime/SourceModuleLoader.java'),module.source);
 const jars=jarReference(),js=jsReference(),global=globalReference();writeFileSync(join(src,'tvbox/runtime/JarExecutor.java'),jars.source);writeFileSync(join(src,'tvbox/runtime/JsExecutor.java'),js.source);writeFileSync(join(src,'com/github/catvod/crawler/js/Global.java'),global.source);
 const api=readFileSync(resolve(reference,'app/src/main/java/com/github/tvbox/osc/api/ApiConfig.java'),'utf8');
 const routerPath=join(src,'tvbox/runtime/CspRouter.java');let router=readFileSync(routerPath,'utf8');router=router.replace(extractMethod(router,'public Spider getCSP('),extractMethod(api,'public Spider getCSP('));writeFileSync(routerPath,router);
 const dependencyClasspath=runtime.classpath.split(delimiter).slice(1);
 const result=spawnSync(join(runtime.javaHome,'bin/javac'),['--release','17','-encoding','UTF-8','-cp',dependencyClasspath.join(delimiter),'-d',classes,...files(src).filter(p=>p.endsWith('.java'))],{encoding:'utf8',timeout:30000,maxBuffer:1024*1024});if(result.error||result.status!==0)throw new Error('Spider oracle compilation failed: '+(result.error||result.stderr));
 for(const p of files(src).filter(p=>!p.endsWith('.java'))){const target=join(classes,p.slice(src.length+1));mkdirSync(dirname(target),{recursive:true});copyFileSync(p,target);}
 cpSync(join(runtime.build,'android-assets'),join(classes,'android-assets'),{recursive:true});
 const extraction={commit:primary.commit,copies,jarMethods:jars.extraction,jsLoaderMethods:js.extraction,globalMethods:global.extraction,moduleMethods:module.extraction,cspDispatchSha256:sha256(extractMethod(api,'public Spider getCSP(')),quickjs:runtime.native.manifest.wrapperTag,nativeCommit:runtime.native.manifest.quickjsCommit,
 scope:'Fresh pinned Spider/SpiderApi/JsSpider and loader methods on shared explicit host bindings; actual JVM class-JAR/QuickJS execution. No Android/ART, native plugin or Linux/NAS equivalence. Ordinary contract fixtures do not exercise DEX/protection; see separate DEX report.'};
 writeFileSync(join(build,'extraction.json'),JSON.stringify(extraction,null,2)+'\n');return{...runtime,build:classes,classpath:[classes,...dependencyClasspath].join(delimiter),extraction};
}
