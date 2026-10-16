// SPDX-License-Identifier: GPL-3.0-only
import{resolve,dirname}from'node:path';import{fileURLToPath}from'node:url';import{spawnSync}from'node:child_process';
import{createConfigCore}from'../../backend/config-core/index.mjs';import{createSpiderRuntime}from'../../backend/spider-runtime/index.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
import { parseCmsBody } from '../../backend/cms-runtime/parser.mjs';
export async function doctor({expectedPlatform=process.env.TVBOX_EXPECT_PLATFORM||'linux-x64'}={}){
 const host=process.platform+'-'+process.arch;if(host!==expectedPlatform)throw new Error('Container platform differs: expected '+expectedPlatform+', actual '+host);
 const report={ok:false,platform:process.platform,architecture:process.arch,node:process.version,scope:'Offline synthetic config/QuickJS/DEX and actual ARM machine-code probes; no Android parity or real-source certification'};
 const cmsJSON=parseCmsBody(1,'{"class":[{"type_id":"a","type_name":"CMS"}],"list":[]}',{home:true});
 const cmsXML=parseCmsBody(0,'<rss><class><ty id="alpha">CMS</ty></class><list page="1" pagecount="1" pagesize="0" recordcount="0"/></rss>',{home:true});
 if(cmsJSON.class[0].type_id!=='a'||cmsXML.class[0].type_id!=='alpha')throw new Error('CMS parser smoke differs');
 report.cms={json:true,xml:true,scope:'Offline parser fixtures only; real HTTP/source validation separate'};
 const core=createConfigCore();try{const sites=await core.parseSites('{sites:[{key:"fixture",type:3,api:"csp_ContainerSmoke"}]}');if(sites.length!==1||sites[0].key!=='fixture')throw new Error('Config smoke differs');report.config={sites:sites.length};}finally{await core.close();}
 const runtime=createSpiderRuntime({nativeBridge:true,timeoutMs:45000});try{
  await runtime.setModules({modules:{'https://fixture.invalid/smoke.js':'export default {init(){},home(){return JSON.stringify({class:[{type_id:"fixture",type_name:"QuickJS"}],answer:6*7});}};'}});
  const js=await runtime.getCSP({key:'js',type:3,api:'https://fixture.invalid/smoke.js',ext:'',jar:''});const jsHome=JSON.parse(await runtime.call(js.token,'homeContent',[true]));if(!js.ready||jsHome.answer!==42)throw new Error('QuickJS smoke differs');report.quickjs={ready:true,answer:jsHome.answer};
  const loaded=await runtime.loadMain(resolve(root,'.cache/container/smoke-dex.jar'));if(!loaded.loaded)throw new Error('DEX smoke initialization failed: '+loaded.failure);
  const spider=await runtime.getCSP({key:'dex',type:3,api:'csp_ContainerSmoke',ext:'',jar:''});const home=JSON.parse(await runtime.call(spider.token,'homeContent',[true]));if(!spider.ready||home.resource!=='offline-dex-resource')throw new Error('DEX smoke result differs');report.dex={ready:true,classes:home.class.length,resource:home.resource};
  report.arm=[];for(const[backend,bits,value]of[['unicorn2',64,42],['dynarmic',64,42],['unicorn2',32,43]]){const probe=await runtime.request({operation:'nativeProbe',backend,bits});if(probe.value!==value||!probe.backend.toLowerCase().includes(backend))throw new Error('ARM probe differs: '+JSON.stringify(probe));report.arm.push(probe);}
  const before=await runtime.request({operation:'nativeState'});await runtime.clear('jar');const after=await runtime.request({operation:'nativeState'});if(before.workerPid===after.workerPid||after.listeners!==0||after.dexLoaders!==0)throw new Error('Worker replacement/cleanup differs');
  try{await runtime.call(js.token,'homeContent',[true]);throw new Error('Stale Spider token accepted');}catch(e){if(!e.message.includes('cleared Spider token'))throw e;}report.lifecycle={workerReplaced:true,oldTokensRejected:true,listeners:after.listeners,dexLoaders:after.dexLoaders};
 }finally{await runtime.close();}
 const version=spawnSync(resolve(process.env.TVBOX_JAVA_HOME||process.env.JAVA_HOME||joinJavaHome(), 'bin/java'),['-version'],{encoding:'utf8',timeout:10000});if(version.error||version.status!==0)throw new Error('Java version probe failed');report.java=version.stderr.split('\n')[0];report.ok=true;return report;
}
function joinJavaHome(){return resolve(root,'.tools/jdk17');}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{console.log(JSON.stringify(await doctor()));}catch(error){console.error(error.stack);process.exitCode=1;}}
