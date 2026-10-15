// SPDX-License-Identifier: GPL-3.0-only
// Explicit provisioning only. Reuse verified existing files; never install globally.
import{existsSync,readFileSync,mkdirSync,mkdtempSync,writeFileSync,renameSync,rmSync}from'node:fs';import{join,dirname,resolve}from'node:path';import{fileURLToPath}from'node:url';import{createHash}from'node:crypto';import{spawnSync}from'node:child_process';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../..'),digest=(bytes,kind)=>createHash(kind).update(bytes).digest('hex');

/** Verify the complete archive before extracting exactly one bounded member. */
export function extractPinnedDependency(bytes,dependency,directory){
 const source=dependency.archive||dependency;
 if(bytes.length!==source.bytes||digest(bytes,'sha256')!==source.sha256||digest(bytes,'sha1')!==source.upstreamSha1)throw new Error('Dependency download checksum differs: '+dependency.filename);
 if(!dependency.archive)return bytes;
 if(dependency.archive.entry!=='classes.jar'||!Number.isSafeInteger(dependency.bytes)||dependency.bytes<=0||dependency.bytes>16*1024*1024)throw new Error('Unsupported pinned archive member');
 const temporary=mkdtempSync(join(directory,'.aar-extract-'));
 try{
  const archive=join(temporary,'dependency.aar');writeFileSync(archive,bytes,{flag:'wx',mode:0o600});
  // Never extract an archive tree or use member names supplied by the archive.
  const result=spawnSync('unzip',['-p',archive,'classes.jar'],{maxBuffer:dependency.bytes+1,timeout:30000});
  if(result.error||result.status!==0||result.stdout.length!==dependency.bytes||digest(result.stdout,'sha256')!==dependency.sha256||digest(result.stdout,'sha1')!==dependency.sha1)throw new Error('Extracted dependency checksum differs: '+dependency.filename);
  return result.stdout;
 }finally{rmSync(temporary,{recursive:true,force:true});}
}

export async function provisionNativeRuntime({directory=process.env.TVBOX_NATIVE_LIB_DIR||join(root,'.tools/native-runtime'),manifest=JSON.parse(readFileSync(join(here,'runtime.json')))}={}){
mkdirSync(directory,{recursive:true});
for(const dependency of manifest.dependencies){const path=join(directory,dependency.filename);
 if(existsSync(path)){if(digest(readFileSync(path),'sha256')!==dependency.sha256)throw new Error('Existing dependency checksum differs: '+path);console.log('Reused '+dependency.filename);continue;}
 const response=await fetch(dependency.url,{signal:AbortSignal.timeout(60000)});if(!response.ok){await response.body?.cancel();throw new Error('Dependency HTTP '+response.status);}
 const source=dependency.archive||dependency,chunks=[];let total=0;for await(const chunk of response.body){total+=chunk.length;if(total>source.bytes)throw new Error('Dependency size differs');chunks.push(Buffer.from(chunk));}const bytes=extractPinnedDependency(Buffer.concat(chunks),dependency,directory);
 const stage=path+'.download-'+process.pid;try{writeFileSync(stage,bytes,{flag:'wx'});renameSync(stage,path);}finally{rmSync(stage,{force:true});}console.log('Installed '+dependency.filename);
}
return{directory,dependencies:manifest.dependencies.length,bytes:manifest.dependencies.reduce((sum,d)=>sum+d.bytes,0),services:[],autostart:[]};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await provisionNativeRuntime()));
