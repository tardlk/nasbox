// SPDX-License-Identifier: GPL-3.0-only
import{readFileSync,readdirSync,mkdirSync,mkdtempSync,existsSync,renameSync,rmSync,writeFileSync}from'node:fs';
import{dirname,resolve,join}from'node:path';import{fileURLToPath}from'node:url';import{spawnSync}from'node:child_process';import{createHash}from'node:crypto';
const here=dirname(fileURLToPath(import.meta.url)),vendor=join(here,'vendor'),root=resolve(here,'../../..');
const sha256=b=>createHash('sha256').update(b).digest('hex');
export function verifyNativeSources(){const manifest=JSON.parse(readFileSync(join(vendor,'manifest.json'),'utf8'));for(const f of manifest.files)if(sha256(readFileSync(join(vendor,f.path)))!==f.sha256)throw new Error('QuickJS source checksum differs: '+f.path);return manifest;}
export function buildQuickJS(javaHome){
 const manifest=verifyNativeSources();if(!['darwin','linux'].includes(process.platform))throw new Error('QuickJS native build supports macOS/Linux only');
 const cc=process.env.CC||'clang',cxx=process.env.CXX||'clang++';
 const fingerprint=sha256(JSON.stringify({manifest,cc,cxx,javaHome,platform:process.platform,arch:process.arch,buildScript:readFileSync(fileURLToPath(import.meta.url),'utf8')}));
 const build=join(root,'.cache/backend/spider-native',fingerprint),library=join(build,process.platform==='darwin'?'libquickjs-java-wrapper.dylib':'libquickjs-java-wrapper.so');
 if(existsSync(join(build,'complete')))return{library,fingerprint,manifest};
 if(process.env.TVBOX_PREBUILT_ONLY==='1')throw new Error('Prebuilt QuickJS runtime missing; rebuild the image');
 mkdirSync(dirname(build),{recursive:true});const staging=mkdtempSync(join(dirname(build),'build-'));
 const run=(command,args)=>{const r=spawnSync(command,args,{encoding:'utf8',timeout:60000,maxBuffer:1024*1024});if(r.error||r.status!==0)throw new Error('QuickJS native compile failed: '+(r.error||r.stderr));};
 try{
  const include=['-I'+join(javaHome,'include'),'-I'+join(javaHome,'include',process.platform==='darwin'?'darwin':'linux')];
  const sources=['cutils.c','libbf.c','libregexp.c','libunicode.c','quickjs.c'].map(n=>join(vendor,'quickjs',n));
  const objects=[];
  for(const source of sources){const object=join(staging,source.split('/').at(-1)+'.o');run(cc,['-O1','-fPIC','-std=gnu11','-D_GNU_SOURCE','-DCONFIG_BIGNUM','-DCONFIG_VERSION="'+manifest.quickjsVersion+'"','-c',source,'-o',object]);objects.push(object);}
  for(const source of readdirSync(join(vendor,'cpp')).filter(n=>n.endsWith('.cpp')).map(n=>join(vendor,'cpp',n))){const object=join(staging,source.split('/').at(-1)+'.o');run(cxx,['-O1','-fPIC','-std=c++11',...include,'-c',source,'-o',object]);objects.push(object);}
  run(cxx,[process.platform==='darwin'?'-dynamiclib':'-shared',...objects,'-lm','-lpthread','-o',join(staging,library.split('/').at(-1))]);
  for(const object of objects)rmSync(object);writeFileSync(join(staging,'complete'),fingerprint);
  try{renameSync(staging,build);}catch(error){if(!existsSync(join(build,'complete')))throw error;}
 }finally{rmSync(staging,{recursive:true,force:true});}
 return{library,fingerprint,manifest};
}
