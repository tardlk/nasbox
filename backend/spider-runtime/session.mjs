// SPDX-License-Identifier: GPL-3.0-only
import{createSpiderRuntime}from'./index.mjs';
import{createFullSubscriptionLoader}from'../subscription/full-loader.mjs';
import{RuntimeCleanup}from'../subscription/runtime-cleanup.mjs';
/** Subscription → lazy type=3 getCSP → real class-JAR/QuickJS invocation.
 * Artifacts/modules are explicitly supplied. Remote code retrieval is not implicit.
 */
export async function createExecutableSubscriptionSession(options={}){
 const owned=!options.runtime;
 const runtime=options.runtime||createSpiderRuntime({dataDir:options.runtimeDataDir});
 const cleanup=new RuntimeCleanup(),tracked=new Set();let mainSignature,closed=false,queue=Promise.resolve(),closing;
 let loader;
 try{loader=createFullSubscriptionLoader({...options,runtimeCleanup:cleanup,beforeRuntimeClear:()=>runtime.request({operation:'resetKeys'})});}
 catch(error){if(owned)await runtime.close();throw error;}
 try{if(options.modules||options.moduleRoot)await runtime.setModules({modules:options.modules,root:options.moduleRoot});}
 catch(error){try{await loader.close();}finally{if(owned)await runtime.close();}throw error;}
 const serialize=action=>{if(closed)return Promise.reject(new Error('Executable subscription session is closed'));const result=queue.then(action);queue=result.catch(()=>{});return result;};
 function track(kind){if(tracked.has(kind))return;tracked.add(kind);cleanup.register(kind,{clear:async()=>{await runtime.clear(kind);tracked.delete(kind);if(kind==='jar')mainSignature=undefined;}});}
 const artifact=signature=>{
  const path=options.artifacts?.[signature]||options.artifacts?.[signature.split(';md5;')[0]];
  if(!path)throw new Error('Unresolved JAR artifact; provide an explicit artifact mapping');return path;
 };
 async function resolveSpider(key){
  const config=await loader.getConfig();const source=config.sites.find(s=>s.key===key);if(!source)throw new Error('Source key does not exist');
  const kind=await runtime.request({operation:'route',api:source.api});
  if(kind==='py')return runtime.getCSP(source);
  track(kind);
  if(source.jar)await runtime.registerJar(source.jar,artifact(source.jar));
  else if(kind==='jar'&&config.globals.spider&&mainSignature!==config.globals.spider){
   const loaded=await runtime.loadMain(artifact(config.globals.spider));if(!loaded.loaded)throw new Error('Global JVM class-JAR could not be initialized');mainSignature=config.globals.spider;
  }
  return runtime.getCSP(source);
 }
 return{
  scope:'config-state + lazy host-jvm-class-jar/quickjs-source',
  load:options=>serialize(()=>loader.load(options)),
  getCSP:key=>serialize(()=>resolveSpider(key)),
  call:(key,method,args=[])=>serialize(async()=>{const spider=await resolveSpider(key);return{spider,value:await runtime.call(spider.token,method,args)};}),
  getConfig:()=>serialize(()=>loader.getConfig()),
  getState:()=>serialize(async()=>({subscription:await loader.getState(),runtime:await runtime.getState()})),
  close(){closing||=(async()=>{closed=true;await queue;try{await loader.close();}finally{if(owned)await runtime.close();}})();return closing;},
 };
}
