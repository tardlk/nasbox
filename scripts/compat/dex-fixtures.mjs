// Test-only JVM -> DEX round trips using the dx jar already in the pinned bundle.
import {readFileSync,writeFileSync,mkdirSync,readdirSync,cpSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';import {spawnSync} from 'node:child_process';
import {createCipheriv} from 'node:crypto';
import {buildSpiderFixtures} from './spider-fixtures.mjs';import {root} from './reference.mjs';
import {dexToolchain} from '../../backend/spider-runtime/dex/toolchain.mjs';
const files=p=>readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(join(p,e.name)):[join(p,e.name)]);
export function buildDexFixtures(){
 const f=buildSpiderFixtures(),tool=dexToolchain({required:true});
 function command(exe,args){const r=spawnSync(exe,args,{encoding:'utf8',timeout:30000,maxBuffer:1024*1024});if(r.error||r.status!==0)throw new Error(String(r.error||r.stderr));}
 function dex(input,path){command(f.built.java,['-Xmx256m','-cp',tool.classpath,'com.android.dx.command.Main','--dex','--output='+path,input]);return path;}
 function jar(name,entries){const dir=join(f.build,name+'-entries');mkdirSync(dir);for(const[n,v]of Object.entries(entries)){const p=join(dir,n);mkdirSync(resolve(p,'..'),{recursive:true});writeFileSync(p,v);}const path=join(f.build,name);command(join(f.built.javaHome,'bin/jar'),['--create','--file',path,'-C',dir,'.']);return path;}
 const raw=dex(f.jar,join(f.build,'raw.dex')),rawBytes=readFileSync(raw);
 const archive=jar('android.jar',{'classes.dex':rawBytes,'assets/value.txt':'fixture-resource','META-INF/OLD.SF':'stale'});
 const disguised=join(f.build,'payload.jpg');cpSync(archive,disguised);
 const one=join(f.build,'split-one'),two=join(f.build,'split-two');mkdirSync(one);mkdirSync(two);
 for(const path of files(join(f.build,'classes')).filter(p=>p.endsWith('.class'))){const relative=path.slice(join(f.build,'classes').length+1),dest=join(path.endsWith('/Contract.class')?two:one,relative);mkdirSync(resolve(dest,'..'),{recursive:true});cpSync(path,dest);}
 const multi=jar('multi.jar',{'classes.dex':readFileSync(dex(one,join(f.build,'one.dex'))),'classes2.dex':readFileSync(dex(two,join(f.build,'two.dex'))),'assets/value.txt':'fixture-resource'});
 const payloadClasses=join(f.build,'payload-classes');mkdirSync(payloadClasses);
 command(join(f.built.javaHome,'bin/javac'),['--release','8','-cp',f.built.classpath,'-d',payloadClasses,...files(resolve(root,'compat/spiders/payload')).filter(p=>p.endsWith('.java'))]);
 const payload=readFileSync(dex(payloadClasses,join(f.build,'payload.dex'))),key=Buffer.from('fixture-key-1234'),cipher=createCipheriv('aes-128-cbc',key,key),encrypted=Buffer.concat([cipher.update(payload),cipher.final()]);
 function guarded(name,whitelist='not.this.package',native=false){
  const src=join(f.build,name+'-src'),classes=join(f.build,name+'-classes');cpSync(resolve(root,'compat/spiders/protected'),src,{recursive:true});mkdirSync(classes);
  const init=join(src,'com/github/catvod/spider/Init.java');writeFileSync(init,readFileSync(init,'utf8').replace('WHITELIST',whitelist));
  if(native)writeFileSync(join(src,'com/github/catvod/spider/DexNative.java'),'package com.github.catvod.spider;public class DexNative {public static native Object getLoader(Object context);}');
  command(join(f.built.javaHome,'bin/javac'),['--release','8','-cp',f.built.classpath,'-d',classes,...files(src).filter(p=>p.endsWith('.java'))]);
  const raw=dex(classes,join(f.build,name+'.dex'));return{raw,jar:jar(name+'.jar',{'classes.dex':readFileSync(raw),'assets/payload.guard':encrypted})};
 }
 const protectedFixture=guarded('protected'),nativeFixture=guarded('native','not.this.package',true),plainWhitelist=guarded('whitelisted','other, com.github.tvbox.osc.jun');
 const aesKey=Buffer.from('1234123412341234'),c=createCipheriv('aes-128-cbc',aesKey,aesKey),whitelist=Buffer.concat([c.update('com.github.tvbox.osc.jun'),c.final()]).toString('base64');
 const encryptedWhitelist=guarded('encrypted-whitelist',whitelist);
 return{...f,tool,raw,archive,disguised,multi,protectedFixture,nativeFixture,plainWhitelist,encryptedWhitelist,pack:jar,cleanup(){rmSync(f.build,{recursive:true,force:true});}};
}
