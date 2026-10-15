// SPDX-License-Identifier: GPL-3.0-only
import{spawn}from'node:child_process';import{createInterface}from'node:readline';
import{mkdtempSync,mkdirSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join,resolve}from'node:path';
import{buildSpiderRuntime}from'./build.mjs';
import{buildNativeProfile}from'./native-bridge/build.mjs';
import{createNativeSession}from'./native-bridge/session.mjs';
import{dexToolchain}from'./dex/toolchain.mjs';
import{acquireDirectoryLease}from'./directory-lease.mjs';
export{buildSpiderRuntime}from'./build.mjs';
export class SpiderRuntimeError extends Error{
 constructor(result){super(result.message||`Spider call failed: ${result.errorType}`);this.name='SpiderRuntimeError';this.errorType=result.errorType;}
}
/** Serialized JVM/QuickJS session. Always close in finally. No player or server. */
export function createSpiderRuntime(options={}){return options.nativeBridge?createNativeSession(options,createWorker,SpiderRuntimeError):createWorker(options);}
function createWorker({built=buildSpiderRuntime(),timeoutMs=10000,maxBytes=8*1024*1024,dataDir,dex=dexToolchain(),nativeBridge=false,nativeBackend='dynarmic',onStderr,cacheMaxBytes=256*1024*1024}={}){
 if(!Number.isSafeInteger(cacheMaxBytes)||cacheMaxBytes<=0)throw new Error('Runtime cache limit must be positive');
 if(!Number.isFinite(timeoutMs)||timeoutMs<=0)throw new Error('Runtime timeout must be positive');
 if(nativeBridge&&!['dynarmic','unicorn2'].includes(nativeBackend))throw new Error('Unsupported native backend');
 if(nativeBridge)built=buildNativeProfile(built);
 const owned=!dataDir;const directory=dataDir?resolve(dataDir):mkdtempSync(join(tmpdir(),'tvbox-spider-'));mkdirSync(directory,{recursive:true,mode:0o700});
 const nativeFlags=nativeBridge?['-Xmx768m','-Dtvbox.native.enabled=true','-Dtvbox.native.fingerprint='+built.fingerprint,'-Dtvbox.native.backend='+nativeBackend,'-Dtvbox.native.data='+join(directory,'android'),'-Dtvbox.spiderCacheDir='+join(directory,'android'),'-Djava.io.tmpdir='+join(directory,'tmp'),...['java.lang','java.lang.reflect','java.lang.invoke','java.util','java.util.concurrent','java.io','java.net','java.nio','java.security','java.text','sun.net.www.protocol.jar'].map(p=>'--add-opens=java.base/'+p+'=ALL-UNNAMED')]:['-Xmx256m'];
 mkdirSync(join(directory,'tmp'),{recursive:true});if(nativeBridge)mkdirSync(join(directory,'android'),{recursive:true});
 let child,lines,lease,exitCode,exitSignal,resolveExit;
 const pending=new Map();let nextId=0,closed=false,failure,stderr='';
 const exit=new Promise(done=>{resolveExit=done;});
 const boot=(async()=>{
  lease=await acquireDirectoryLease(directory);
  child=spawn(built.java,[...nativeFlags,'-Dtvbox.cache.workspace='+tmpdir(),'-Dtvbox.owner.pid='+process.pid,'-Dtvbox.cache.maxBytes='+cacheMaxBytes,'-Djava.io.tmpdir='+join(directory,'tmp'),...(dex?['-Dtvbox.dex.classpath='+dex.classpath,'-Dtvbox.dex.fingerprint='+dex.fingerprint]:[]),'-Dfile.encoding=UTF-8','-cp',built.classpath,'tvbox.runtime.SpiderWorker',built.library,directory],{stdio:['pipe','pipe','pipe']});
  lines=createInterface({input:child.stdout});
  child.once('close',(code,signal)=>{exitCode=code;exitSignal=signal;resolveExit();});
  child.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-16384);if(onStderr)try{onStderr(chunk.toString());}catch(error){fail(error);}});child.on('error',fail);child.stdin.on('error',fail);
  child.on('close',(code,signal)=>{if(!closed||pending.size)fail(new Error(`Spider worker exited (${code??signal}): ${stderr}`));lines.close();});
  lines.on('line',line=>{try{
   if(Buffer.byteLength(line)>maxBytes)throw new Error('Spider response exceeds size limit');
   const{id,...result}=JSON.parse(line);const item=pending.get(id);if(!item||typeof result.ok!=='boolean')throw new Error('Invalid Spider worker response');
   clearTimeout(item.timer);pending.delete(id);item.resolve(result);
  }catch(error){fail(error);}});
 })();boot.catch(error=>{fail(error);if(!child)resolveExit();});
 function fail(error){failure||=error;for(const item of pending.values()){clearTimeout(item.timer);item.reject(failure);}pending.clear();if(child&&!child.killed)child.kill('SIGKILL');}
 async function query(request){
  await boot;lease.assertAlive();
  if(closed||failure)return Promise.reject(failure||new Error('Spider runtime is closed'));
  const id=++nextId;let line;try{line=JSON.stringify({...request,id})+'\n';if(Buffer.byteLength(line)>maxBytes)throw new Error('Spider request exceeds size limit');}catch(error){return Promise.reject(error);}
  return new Promise((res,rej)=>{const timer=setTimeout(()=>fail(new Error('Spider worker timed out')),timeoutMs);pending.set(id,{resolve:res,reject:rej,timer});child.stdin.write(line,error=>{if(error)fail(error);});});
 }
 async function request(spec){const result=await query(spec);if(!result.ok)throw new SpiderRuntimeError(result);return result.value;}
 let closing;
 return{
  get workerPid(){return child?.pid;},scope:nativeBridge?'host-jvm/dex/unidbg-arm/headless-android':'host-jvm-class-jar/dex-translation/quickjs-source',dataDirectory:directory,query,request,getDiagnostics:()=>({stderr,exitCode,exitSignal}),
  getCSP:source=>request({operation:'get',source}),
  loadMain:path=>request({operation:'loadMain',path:resolve(path)}),
  registerJar:(signature,path)=>request({operation:'registerJar',signature,path:resolve(path)}),
  setModules:options=>request({operation:'modules',...options}),
  call:(token,method,args=[])=>request({operation:'call',token,method,args}),
  clear:(kind,options={})=>request({...options,operation:'clear',kind}),
  getState:()=>request({operation:'state'}),
  close(){
   closing||=(async()=>{
    closed=true;try{await boot;}catch{}if(child)child.stdin.end();const timer=setTimeout(()=>fail(new Error('Spider worker shutdown timed out')),timeoutMs);
    try{await exit;if(!failure&&exitCode!==0)throw new Error(`Spider worker shutdown failed (${exitCode??exitSignal??'unknown'}): ${stderr}`);}
    finally{clearTimeout(timer);if(lease)await lease.close();if(owned)rmSync(directory,{recursive:true,force:true});}
   })();return closing;
  },
 };
}
