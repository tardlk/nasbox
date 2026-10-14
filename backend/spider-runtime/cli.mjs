// SPDX-License-Identifier: GPL-3.0-only
import{resolve,dirname}from'node:path';import{pathToFileURL}from'node:url';import{createSpiderRuntime}from'./index.mjs';
const args=process.argv.slice(2),options={};for(let i=0;i<args.length;i++){
 if(args[i]==='--native'){options.native=true;continue;}
 if(!['--jar','--js','--api','--method','--args','--ext','--key','--data','--backend','--timeout'].includes(args[i]))throw new Error('Unknown Spider option');
 const key=args[i].slice(2),value=args[++i];if(value===undefined)throw new Error('Missing Spider option value');options[key]=value;
}
if(!!options.jar===!!options.js)throw new Error('Provide exactly one --jar or --js file');
if(!options.method)throw new Error('Provide --method');if(options.jar&&!options.api)throw new Error('JAR requires --api');
const runtime=createSpiderRuntime({dataDir:options.data,nativeBridge:!!options.native,nativeBackend:options.backend||'dynarmic',timeoutMs:options.timeout?Number(options.timeout):options.native?45000:10000});
try{
 if(options.jar){const loaded=await runtime.loadMain(options.jar);if(!loaded.loaded)throw new Error('JAR could not be initialized: '+JSON.stringify(loaded.logs));}
 if(options.js)await runtime.setModules({root:dirname(resolve(options.js))});
 const source={key:options.key||'local',type:3,api:options.js?pathToFileURL(resolve(options.js)).href:options.api,ext:options.ext||'',jar:''};
 const spider=await runtime.getCSP(source);const result=await runtime.call(spider.token,options.method,JSON.parse(options.args||'[]'));
 console.log(JSON.stringify({scope:runtime.scope,ready:spider.ready,kind:spider.kind,value:result}));if(!spider.ready)process.exitCode=1;
}finally{await runtime.close();}
