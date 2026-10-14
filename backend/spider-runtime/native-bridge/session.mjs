// SPDX-License-Identifier: GPL-3.0-only
import{mkdtempSync,mkdirSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join,resolve}from'node:path';
/** Native plugins can own arbitrary threads. A JAR reset replaces the whole JVM. */
export function createNativeSession(options,createWorker,RuntimeError){
 const owned=!options.dataDir,directory=options.dataDir?resolve(options.dataDir):mkdtempSync(join(tmpdir(),'tvbox-native-runtime-'));mkdirSync(directory,{recursive:true,mode:0o700});
 const workerOptions={...options,dataDir:directory};let worker;
 try{worker=createWorker(workerOptions);}catch(error){if(owned)rmSync(directory,{recursive:true,force:true});throw error;}
 let generation=1,closed=false,closing,queue=Promise.resolve(),previousStderr='';const settings=[];
 function query(spec){
  if(closed)return Promise.reject(new Error('Spider runtime is closed'));
  let captured;try{const json=JSON.stringify(spec);if(Buffer.byteLength(json)>(options.maxBytes??8*1024*1024))throw new Error('Spider request exceeds size limit');captured=JSON.parse(json);}catch(error){return Promise.reject(error);}
  const action=async()=>{
   if(captured.operation==='clear'&&captured.kind==='jar'){
    previousStderr=(previousStderr+worker.getDiagnostics().stderr).slice(-16384);
    await worker.close();worker=createWorker(workerOptions);generation++;
    for(const setting of settings)await worker.request(setting);
    return{ok:true,value:await worker.getState()};
   }
   if(captured.operation==='call'){
    const prefix='native-'+generation+':';if(typeof captured.token!=='string'||!captured.token.startsWith(prefix))return{ok:false,errorType:'java.lang.IllegalStateException',message:'Unknown or cleared Spider token'};
    captured.token=captured.token.slice(prefix.length);
   }
   const result=await worker.query(captured);
   if(result.ok){
    if(['host','modules','registerJar'].includes(captured.operation))settings.push(captured);
    if(captured.operation==='get')result.value.token='native-'+generation+':'+result.value.token;
   }return result;
  };
  const pending=queue.then(action);queue=pending.catch(()=>{});return pending;
 }
 async function request(spec){const result=await query(spec);if(!result.ok)throw new RuntimeError(result);return result.value;}
 return{
  scope:worker.scope,dataDirectory:directory,query,request,
  getDiagnostics:()=>({stderr:(previousStderr+worker.getDiagnostics().stderr).slice(-16384),generation}),
  getCSP:source=>request({operation:'get',source}),loadMain:path=>request({operation:'loadMain',path:resolve(path)}),
  registerJar:(signature,path)=>request({operation:'registerJar',signature,path:resolve(path)}),setModules:options=>request({operation:'modules',...options}),
  call:(token,method,args=[])=>request({operation:'call',token,method,args}),clear:kind=>request({operation:'clear',kind}),getState:()=>request({operation:'state'}),
  close(){closing||=(async()=>{closed=true;await queue;try{await worker.close();}finally{if(owned)rmSync(directory,{recursive:true,force:true});}})();return closing;},
 };
}
