// SPDX-License-Identifier: GPL-3.0-only
import{mkdirSync,mkdtempSync,writeFileSync,rmSync}from'node:fs';import{join,resolve,dirname}from'node:path';import{fileURLToPath}from'node:url';import{spawnSync}from'node:child_process';
import{buildSpiderRuntime}from'../../backend/spider-runtime/build.mjs';import{buildNativeProfile}from'../../backend/spider-runtime/native-bridge/build.mjs';import{dexToolchain}from'../../backend/spider-runtime/dex/toolchain.mjs';
import { buildCmsParser } from '../../backend/cms-runtime/parser.mjs';
export function prepareContainerRuntime(){
 buildCmsParser();
 const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),built=buildSpiderRuntime();buildNativeProfile(built);const dex=dexToolchain({required:true}),directory=join(root,'.cache/container');mkdirSync(directory,{recursive:true});const stage=mkdtempSync(join(directory,'build-'));
 const run=(command,args)=>{const r=spawnSync(command,args,{encoding:'utf8',timeout:60000,maxBuffer:2*1024*1024});if(r.error||r.status!==0)throw new Error('Container preparation failed: '+(r.error||r.stderr));};
 try{
  const classes=join(stage,'classes');mkdirSync(classes);run(join(built.javaHome,'bin/javac'),['--release','8','-encoding','UTF-8','-cp',built.classpath,'-d',classes,...['Init','ContainerSmoke'].map(name=>join(root,'docker/fixtures/com/github/catvod/spider',name+'.java'))]);
  const entries=join(stage,'archive');mkdirSync(join(entries,'assets'),{recursive:true});writeFileSync(join(entries,'assets/container.txt'),'offline-dex-resource');
  run(built.java,['-cp',dex.classpath,'com.android.dx.command.Main','--dex','--output='+join(entries,'classes.dex'),classes]);
  run(join(built.javaHome,'bin/jar'),['--create','--file',join(directory,'smoke-dex.jar'),'-C',entries,'.']);
  return{platform:process.platform,architecture:process.arch,fixture:'.cache/container/smoke-dex.jar'};
 }finally{rmSync(stage,{recursive:true,force:true});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(prepareContainerRuntime()));
