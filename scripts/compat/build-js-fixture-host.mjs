// SPDX-License-Identifier: GPL-3.0-only
// Compile a portable Java17 test binding with the existing JDK; no downloads.
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, existsSync, mkdtempSync, readdirSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { join, resolve, dirname, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildSpiderRuntime } from '../../backend/spider-runtime/build.mjs';
const SELF=fileURLToPath(import.meta.url),ROOT=resolve(dirname(SELF),'../..');
const sha=value=>createHash('sha256').update(value).digest('hex');
const list=directory=>readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?list(join(directory,entry.name)):[join(directory,entry.name)]).sort();
export function buildJSFixtureHost({built=buildSpiderRuntime(),outputRoot=join(ROOT,'.cache/js-business/fixture-host')}={}){
 const source=join(ROOT,'scripts/compat/js-fixture-host/tvbox/runtime/HostServices.java');
 const sourceSha256=sha(readFileSync(source)),fingerprint=sha(JSON.stringify({sourceSha256,classpath:built.classpath}));
 const output=join(outputRoot,fingerprint);mkdirSync(outputRoot,{recursive:true});
 if(!existsSync(join(output,'binding.json'))){
  const stage=mkdtempSync(join(outputRoot,'build-'));
  try{
   const result=spawnSync(join(built.javaHome,'bin/javac'),['--release','17','-encoding','UTF-8','-cp',built.classpath,'-d',stage,source],{encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
   if(result.error||result.status!==0)throw new Error('JS fixture host compilation failed: '+(result.error||result.stderr));
   const files=list(stage).map(path=>({path:path.slice(stage.length+1),bytes:readFileSync(path).length,sha256:sha(readFileSync(path))}));
   writeFileSync(join(stage,'binding.json'),JSON.stringify({schemaVersion:1,scope:'Test-only frozen code/rule GET host binding; original production image unchanged; unmatched business HTTP remains live unless networkDisabled',sourceSha256,files},null,2)+'\n');
   renameSync(stage,output);
  }finally{rmSync(stage,{recursive:true,force:true});}
 }
 const manifest=JSON.parse(readFileSync(join(output,'binding.json'),'utf8'));
 if(manifest.sourceSha256!==sourceSha256||manifest.files.some(pin=>sha(readFileSync(join(output,pin.path)))!==pin.sha256))throw new Error('JS fixture host checksum differs');
 return {directory:output,manifest,built:{...built,classpath:[output,built.classpath].join(delimiter)}};
}
if(process.argv[1]&&resolve(process.argv[1])===SELF){const result=buildJSFixtureHost();console.log(JSON.stringify({directory:result.directory,manifest:result.manifest}));}
