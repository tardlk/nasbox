// SPDX-License-Identifier: GPL-3.0-only
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,existsSync,mkdirSync,mkdtempSync,renameSync,writeFileSync,rmSync} from 'node:fs';
import {resolve,dirname,join,delimiter,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const HERE=dirname(fileURLToPath(import.meta.url)),ROOT=resolve(HERE,'../..'),sha=b=>createHash('sha256').update(b).digest('hex');
const files=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(join(dir,e.name)):[join(dir,e.name)]).sort();
export function buildCmsParser(){
 const home=process.env.TVBOX_JAVA_HOME||process.env.JAVA_HOME||join(ROOT,'.tools/jdk17');
 const gson=process.env.TVBOX_GSON_JAR||join(ROOT,'.tools/lib/gson-2.10.1.jar');
 const pin=JSON.parse(readFileSync(join(ROOT,'backend/config-core/runtime.json'))).gson.sha256;if(sha(readFileSync(gson))!==pin)throw new Error('CMS_GSON_CHECKSUM');
 const sources=files(join(HERE,'src')).filter(p=>p.endsWith('.java'));
 const fingerprint=sha(JSON.stringify({javaRelease:17,gson:pin,sources:sources.map(p=>[relative(HERE,p),sha(readFileSync(p))])}));
 const build=join(ROOT,'.cache/backend/cms-runtime',fingerprint);
 if(!existsSync(join(build,'complete'))){
  if(process.env.TVBOX_PREBUILT_ONLY==='1')throw new Error('CMS_PREBUILT_MISSING');mkdirSync(dirname(build),{recursive:true});const stage=mkdtempSync(join(dirname(build),'build-'));
  try{const r=spawnSync(join(home,'bin/javac'),['--release','17','-encoding','UTF-8','-cp',gson,'-d',stage,...sources],{encoding:'utf8',timeout:30000,maxBuffer:1024*1024});if(r.error||r.status!==0)throw new Error('CMS_COMPILE_FAILED '+(r.error||r.stderr));writeFileSync(join(stage,'complete'),fingerprint);renameSync(stage,build);}finally{rmSync(stage,{recursive:true,force:true});}
 }
 return {java:join(home,'bin/java'),gson,build,fingerprint};
}
export function parseCmsBody(type,text,{home=false,built=buildCmsParser()}={}){
 const r=spawnSync(built.java,['-Xmx128m','-Dfile.encoding=UTF-8','-cp',[built.build,built.gson].join(delimiter),'tvbox.cms.CmsParser'],{input:JSON.stringify({type,text,home}),encoding:'utf8',timeout:10000,maxBuffer:12*1024*1024});
 if(r.error||r.status!==0)throw Object.assign(new Error('CMS_PARSER_PROCESS_FAILED'),{code:r.error?.code==='ETIMEDOUT'?'CMS_TIMEOUT':'CMS_PARSER_PROCESS_FAILED'});
 let result;try{result=JSON.parse(r.stdout);}catch{throw new Error('CMS_PARSER_PROTOCOL');}
 if(!result.ok)throw Object.assign(new Error('CMS_INVALID_BODY'),{code:'CMS_INVALID_BODY',errorType:result.errorType});return result.value;
}
