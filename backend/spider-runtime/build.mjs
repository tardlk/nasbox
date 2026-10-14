// SPDX-License-Identifier: GPL-3.0-only
import{readFileSync,readdirSync,existsSync,mkdirSync,mkdtempSync,writeFileSync,copyFileSync,renameSync,rmSync}from'node:fs';
import{resolve,dirname,join,delimiter}from'node:path';import{fileURLToPath}from'node:url';import{createHash}from'node:crypto';import{spawnSync}from'node:child_process';
import{buildConfigCore}from'../config-core/index.mjs';import{buildQuickJS}from'./native/build.mjs';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../..');const sha256=b=>createHash('sha256').update(b).digest('hex');
function files(path){return readdirSync(path,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(join(path,e.name)):[join(path,e.name)]).sort();}
export function buildSpiderRuntime(){
 const config=buildConfigCore(),runtime=JSON.parse(readFileSync(join(here,'runtime.json'),'utf8'));
 const jars=Object.entries(runtime.dependencies).map(([name,item])=>{const path=join(process.env.TVBOX_SPIDER_LIB_DIR||join(root,'.tools/lib'),item.filename);if(!existsSync(path)||sha256(readFileSync(path))!==item.sha256)throw new Error('Spider dependency missing/checksum differs: '+name);return path;});
 const javaHome=process.env.TVBOX_JAVA_HOME||process.env.JAVA_HOME||resolve(root,'.tools/jdk17');
 const native=buildQuickJS(javaHome);const sourceFiles=files(join(here,'src'));
 const fingerprint=sha256(JSON.stringify({runtime,config:config.build,native:native.fingerprint,sources:sourceFiles.map(p=>[p,sha256(readFileSync(p))])}));
 const build=join(root,'.cache/backend/spider-runtime',fingerprint);
 if(!existsSync(join(build,'complete'))){mkdirSync(dirname(build),{recursive:true});const staging=mkdtempSync(join(dirname(build),'build-'));
 try{
  const javac=existsSync(join(javaHome,'bin/javac'))?join(javaHome,'bin/javac'):'javac';
  const r=spawnSync(javac,['--release','17','-encoding','UTF-8','-cp',[config.build,config.gson,...jars].join(delimiter),'-d',staging,...sourceFiles.filter(p=>p.endsWith('.java'))],{encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
  if(r.error||r.status!==0)throw new Error('Spider compile failed: '+(r.error||r.stderr));
  for(const path of sourceFiles.filter(p=>!p.endsWith('.java'))){const target=join(staging,path.slice(join(here,'src').length+1));mkdirSync(dirname(target),{recursive:true});copyFileSync(path,target);}
  writeFileSync(join(staging,'complete'),fingerprint);try{renameSync(staging,build);}catch(error){if(!existsSync(join(build,'complete')))throw error;}
 }finally{rmSync(staging,{recursive:true,force:true});}}
 return{java:config.java,build,classpath:[build,config.build,config.gson,...jars].join(delimiter),library:native.library,javaHome,native};
}
