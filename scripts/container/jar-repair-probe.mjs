// SPDX-License-Identifier: GPL-3.0-only
// Fixed captured inputs. Provider bodies/URLs/native diagnostics are never saved.
import {readFile,writeFile,mkdir,mkdtemp,rm,realpath} from 'node:fs/promises';
import {resolve,dirname,join,relative,isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createSpiderRuntime} from '../../backend/spider-runtime/index.mjs';
import {classifyFailure,summarizeResponse,summarizeNativeState} from './jar-matrix-probe.mjs';
import {extractMissingSymbols} from './jar-failure-diagnostics.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function probeJarRepair(artifact,{inputRoot,jarInitPolicy='android',backend='dynarmic',timeoutMs=90000,home=true,category=true}={}) {
 const root=await realpath(inputRoot),path=await realpath(resolve(root,artifact.jarPath)),rel=relative(root,path);
 if(isAbsolute(rel)||rel==='..'||rel.startsWith('../'))throw Error('INPUT_PATH');
 const bytes=await readFile(path);if(sha(bytes)!==artifact.sha256)throw Error('INPUT_CHECKSUM');
 const directory=await mkdtemp(join(tmpdir(),'tvbox-jar-repair-'));
 let stderr='';const runtime=createSpiderRuntime({nativeBridge:true,nativeBackend:backend,timeoutMs,dataDir:join(directory,'runtime'),onStderr:chunk=>{stderr=(stderr+chunk).slice(-1024*1024);}});
 const report={id:artifact.sha256,input:{sha256:artifact.sha256,bytes:bytes.length},policy:jarInitPolicy,backend,sourceInputScope:artifact.sourceInputScope||'caller-provided fixed manifest',rows:[],cleanup:{}};
 let workerPid;
 try {
  await runtime.request({operation:'host',jarInitPolicy});
  const load=await runtime.loadMain(path);report.load={loaded:load.loaded};
  if(load.failure)report.load.error=classifyFailure(new Error(load.failure));
  const state=await runtime.request({operation:'nativeState'});workerPid=state.workerPid;report.native=summarizeNativeState(state);
  if(load.loaded)for(const source of artifact.sites.slice(0,3)) {
   const row={api:/^[\w.$]+$/.test(source.api)?source.api:'sha256:'+sha(source.api),sourceKeySha256:sha(String(source.key)),extSha256:sha(String(source.ext||''))};report.rows.push(row);
   try {
    const spider=await runtime.getCSP({...source,jar:''});row.ready=spider.ready;row.className=spider.className;
    if(source.probeSkipHome)row.homeSkipped=String(source.probeSkipHome);
    if(home&&spider.ready&&!source.probeSkipHome){
     const result=summarizeResponse(await runtime.call(spider.token,'homeContent',[true]));row.home=result.metadata;
     if(category&&!source.probeSkipCategory){
      const item=result.json.class?.find(c=>c&&['string','number'].includes(typeof c.type_id));
      if(item)try{row.category=summarizeResponse(await runtime.call(spider.token,'categoryContent',[String(item.type_id),'1',true,{}])).metadata;}
      catch(error){row.categoryError=classifyFailure(error);}
     }
    }
   }catch(error){row.error=classifyFailure(error);}
  }
  report.nativeAfter=summarizeNativeState(await runtime.request({operation:'nativeState'}));
 }catch(error){report.error=classifyFailure(error);}
 finally {
  try{await runtime.close();report.cleanup.closed=true;}catch(error){report.cleanup.closed=false;report.cleanup.error=classifyFailure(error);}
  const diagnostics=runtime.getDiagnostics();report.cleanup.exitCode=diagnostics.exitCode;report.cleanup.exitSignal=diagnostics.exitSignal;
  if(workerPid){try{process.kill(workerPid,0);report.cleanup.workerExited=false;}catch(error){report.cleanup.workerExited=error.code==='ESRCH';}}
  report.evidence=extractMissingSymbols(stderr);
  await rm(directory,{recursive:true,force:true});report.cleanup.temporaryDataRemoved=true;
 }
 report.observations={ready:report.rows.filter(r=>r.ready).length,homeJson:report.rows.filter(r=>r.home).length,homesWithContent:report.rows.filter(r=>r.home?.hasContent).length,categoriesWithContent:report.rows.filter(r=>r.category?.hasContent).length};
 return report;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [manifestPath,id,output,jarInitPolicy='android',backend='dynarmic']=process.argv.slice(2);
 if(!manifestPath||!id||!output)throw Error('Usage: node jar-repair-probe.mjs MANIFEST SHA OUTPUT [android|declared] [dynarmic|unicorn2]');
 const manifest=JSON.parse(await readFile(manifestPath,'utf8')),artifact=manifest.artifacts.find(a=>a.id===id||a.id.startsWith(id));
 if(!artifact)throw Error('INPUT_SCHEMA');
 const report=await probeJarRepair(artifact,{inputRoot:manifest.inputRoot||dirname(resolve(manifestPath)),jarInitPolicy,backend});
 await mkdir(dirname(resolve(output)),{recursive:true});await writeFile(resolve(output),JSON.stringify(report,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({id:report.id,loaded:report.load?.loaded,observations:report.observations,cleanup:report.cleanup}));
 if(!report.cleanup.closed||!report.cleanup.workerExited)process.exitCode=1;
}
