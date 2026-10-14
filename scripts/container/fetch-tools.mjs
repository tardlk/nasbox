// SPDX-License-Identifier: GPL-3.0-only
import{readFileSync,existsSync,mkdirSync,writeFileSync,renameSync,rmSync,mkdtempSync}from'node:fs';import{join,dirname,resolve}from'node:path';import{fileURLToPath}from'node:url';import{tmpdir}from'node:os';import{createHash}from'node:crypto';import{spawnSync}from'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),read=p=>JSON.parse(readFileSync(join(root,p))),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function fetchBytes(url,{limit,sha256}){
 const response=await fetch(url,{signal:AbortSignal.timeout(60000)});if(!response.ok){await response.body?.cancel();throw new Error('Tool download HTTP '+response.status);}
 const chunks=[];let total=0;for await(const chunk of response.body){total+=chunk.length;if(total>limit)throw new Error('Tool download size limit');chunks.push(Buffer.from(chunk));}
 const bytes=Buffer.concat(chunks);if(sha(bytes)!==sha256)throw new Error('Tool checksum differs: '+new URL(url).pathname);return bytes;
}
function writeVerified(path,bytes){mkdirSync(dirname(path),{recursive:true});const stage=path+'.download-'+process.pid;try{writeFileSync(stage,bytes,{flag:'wx'});renameSync(stage,path);}finally{rmSync(stage,{force:true});}}
export async function provisionTools(){
 const config=read('backend/config-core/runtime.json'),spider=read('backend/spider-runtime/runtime.json');const core=[{...config.gson,filename:'gson-2.10.1.jar'},{...config.bouncyCastle,filename:'bcprov-jdk18on-1.78.1.jar'},...Object.values(spider.dependencies)];
 for(const item of core){const path=join(root,'.tools/lib',item.filename);if(existsSync(path)){if(sha(readFileSync(path))!==item.sha256)throw new Error('Existing tool checksum differs: '+item.filename);continue;}writeVerified(path,await fetchBytes(item.url,{limit:item.bytes||64*1024*1024,sha256:item.sha256}));}
 const dex=read('backend/spider-runtime/dex/toolchain.json'),base=join(root,'.tools/dex2jar-v2.4');let missing=false;
 for(const item of dex.files){const path=join(base,item.path);if(!existsSync(path)){missing=true;continue;}if(sha(readFileSync(path))!==item.sha256)throw new Error('Existing DEX tool checksum differs: '+item.path);}
 if(missing){const temporary=mkdtempSync(join(tmpdir(),'tvbox-tools-'));try{
  const archive=join(temporary,'dex.zip');writeFileSync(archive,await fetchBytes(dex.archiveUrl,{limit:dex.archiveBytes,sha256:dex.archiveSha256}));
  // Extract only pinned archive members, never a whole untrusted path tree.
  for(const item of dex.files){const path=join(base,item.path);if(existsSync(path))continue;const r=spawnSync('unzip',['-p',archive,'dex-tools-v2.4/'+item.path],{maxBuffer:64*1024*1024});if(r.error||r.status!==0||r.stdout.length!==item.bytes||sha(r.stdout)!==item.sha256)throw new Error('Pinned DEX extraction failed: '+item.path);writeVerified(path,r.stdout);}
 }finally{rmSync(temporary,{recursive:true,force:true});}}
 await import('../../backend/spider-runtime/native-bridge/fetch-runtime.mjs');
 return{coreJars:core.length,dexFiles:dex.files.length};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await provisionTools()));
