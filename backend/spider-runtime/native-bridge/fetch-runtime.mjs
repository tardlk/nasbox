// SPDX-License-Identifier: GPL-3.0-only
// Explicit provisioning only. Reuse verified existing files; never install globally.
import{existsSync,readFileSync,mkdirSync,writeFileSync,renameSync,rmSync}from'node:fs';import{join,dirname,resolve}from'node:path';import{fileURLToPath}from'node:url';import{createHash}from'node:crypto';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../..'),directory=process.env.TVBOX_NATIVE_LIB_DIR||join(root,'.tools/native-runtime');
const manifest=JSON.parse(readFileSync(join(here,'runtime.json'))),digest=(bytes,kind)=>createHash(kind).update(bytes).digest('hex');mkdirSync(directory,{recursive:true});
for(const dependency of manifest.dependencies){const path=join(directory,dependency.filename);
 if(existsSync(path)){if(digest(readFileSync(path),'sha256')!==dependency.sha256)throw new Error('Existing dependency checksum differs: '+path);console.log('Reused '+dependency.filename);continue;}
 const response=await fetch(dependency.url,{signal:AbortSignal.timeout(60000)});if(!response.ok){await response.body?.cancel();throw new Error('Dependency HTTP '+response.status);}
 const chunks=[];let total=0;for await(const chunk of response.body){total+=chunk.length;if(total>dependency.bytes)throw new Error('Dependency size differs');chunks.push(Buffer.from(chunk));}const bytes=Buffer.concat(chunks);
 if(bytes.length!==dependency.bytes||digest(bytes,'sha256')!==dependency.sha256||digest(bytes,'sha1')!==dependency.upstreamSha1)throw new Error('Dependency checksum differs: '+dependency.filename);
 const stage=path+'.download-'+process.pid;try{writeFileSync(stage,bytes,{flag:'wx'});renameSync(stage,path);}finally{rmSync(stage,{force:true});}console.log('Installed '+dependency.filename);
}
console.log(JSON.stringify({directory,dependencies:manifest.dependencies.length,bytes:manifest.dependencies.reduce((sum,d)=>sum+d.bytes,0),services:[],autostart:[]}));
