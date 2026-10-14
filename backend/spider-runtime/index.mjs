// SPDX-License-Identifier: GPL-3.0-only
import{spawn}from'node:child_process';import{createInterface}from'node:readline';
import{mkdtempSync,mkdirSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join,resolve}from'node:path';
import{buildSpiderRuntime}from'./build.mjs';
import{dexToolchain}from'./dex/toolchain.mjs';
export{buildSpiderRuntime}from'./build.mjs';
export class SpiderRuntimeError extends Error{
 constructor(result){super(result.message||`Spider call failed: ${result.errorType}`);this.name='SpiderRuntimeError';this.errorType=result.errorType;}
}
/** Serialized JVM/QuickJS session. Always close in finally. No player or server. */
export function createSpiderRuntime({built=buildSpiderRuntime(),timeoutMs=10000,maxBytes=8*1024*1024,dataDir,dex=dexToolchain()}={}){
 const owned=!dataDir;const directory=dataDir?resolve(dataDir):mkdtempSync(join(tmpdir(),'tvbox-spider-'));mkdirSync(directory,{recursive:true,mode:0o700});
 const child=spawn(built.java,['-Xmx256m',...(dex?['-Dtvbox.dex.classpath='+dex.classpath,'-Dtvbox.dex.fingerprint='+dex.fingerprint]:[]),'-Dfile.encoding=UTF-8','-cp',built.classpath,'tvbox.runtime.SpiderWorker',built.library,directory],{stdio:['pipe','pipe','pipe']});
 const lines=createInterface({input:child.stdout}),pending=new Map();let nextId=0,closed=false,failure,stderr='';
 let exitCode;const exit=new Promise(done=>child.once('close',code=>{exitCode=code;done();}));
 function fail(error){failure||=error;for(const item of pending.values()){clearTimeout(item.timer);item.reject(failure);}pending.clear();if(!child.killed)child.kill('SIGKILL');}
 child.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-4096);});child.on('error',fail);child.stdin.on('error',fail);
 child.on('close',(code,signal)=>{if(!closed||pending.size)fail(new Error(`Spider worker exited (${code??signal}): ${stderr}`));lines.close();});
 lines.on('line',line=>{try{
  if(Buffer.byteLength(line)>maxBytes)throw new Error('Spider response exceeds size limit');
  const{id,...result}=JSON.parse(line);const item=pending.get(id);if(!item||typeof result.ok!=='boolean')throw new Error('Invalid Spider worker response');
  clearTimeout(item.timer);pending.delete(id);item.resolve(result);
 }catch(error){fail(error);}});
 function query(request){
  if(closed||failure)return Promise.reject(failure||new Error('Spider runtime is closed'));
  const id=++nextId;let line;try{line=JSON.stringify({...request,id})+'\n';if(Buffer.byteLength(line)>maxBytes)throw new Error('Spider request exceeds size limit');}catch(error){return Promise.reject(error);}
  return new Promise((res,rej)=>{const timer=setTimeout(()=>fail(new Error('Spider worker timed out')),timeoutMs);pending.set(id,{resolve:res,reject:rej,timer});child.stdin.write(line,error=>{if(error)fail(error);});});
 }
 async function request(spec){const result=await query(spec);if(!result.ok)throw new SpiderRuntimeError(result);return result.value;}
 let closing;
 return{
  scope:'host-jvm-class-jar/dex-translation/quickjs-source',dataDirectory:directory,query,request,
  getCSP:source=>request({operation:'get',source}),
  loadMain:path=>request({operation:'loadMain',path:resolve(path)}),
  registerJar:(signature,path)=>request({operation:'registerJar',signature,path:resolve(path)}),
  setModules:options=>request({operation:'modules',...options}),
  call:(token,method,args=[])=>request({operation:'call',token,method,args}),
  clear:kind=>request({operation:'clear',kind}),
  getState:()=>request({operation:'state'}),
  close(){
   closing||=(async()=>{
    closed=true;child.stdin.end();const timer=setTimeout(()=>fail(new Error('Spider worker shutdown timed out')),timeoutMs);
    try{await exit;if(!failure&&exitCode!==0)throw new Error(`Spider worker shutdown failed (${exitCode}): ${stderr}`);}
    finally{clearTimeout(timer);if(owned)rmSync(directory,{recursive:true,force:true});}
   })();return closing;
  },
 };
}
