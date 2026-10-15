// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {buildDexFixtures} from '../scripts/compat/dex-fixtures.mjs';
import {createSpiderRuntime} from '../backend/spider-runtime/index.mjs';

test('explicit declared policy runs the actual ordinary init; Android default and protected-loader rules remain distinct', {timeout:60000}, async () => {
 const fixture=buildDexFixtures(),directory=join(fixture.build,'ordinary-restart');mkdirSync(directory);
 const src=join(directory,'source'),classes=join(directory,'classes');mkdirSync(src);mkdirSync(classes);
 const init=`package com.github.catvod.spider;public class Init {public static boolean initialized;public static void init(android.content.Context c){initialized=true;}public static void restart(){android.os.Process.killProcess(android.os.Process.myPid());}}`;
 const spider=`package com.github.catvod.spider;public class Policy extends com.github.catvod.crawler.Spider {public String action(String arg){return Boolean.toString(Init.initialized);}}`;
 writeFileSync(join(src,'Init.java'),init);writeFileSync(join(src,'Policy.java'),spider);
 const run=(cmd,args)=>{const r=spawnSync(cmd,args,{encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stderr);};
 try {
  run(join(fixture.built.javaHome,'bin/javac'),['--release','8','-cp',fixture.built.classpath,'-d',classes,join(src,'Init.java'),join(src,'Policy.java')]);
  const dex=join(directory,'ordinary.dex');run(fixture.built.java,['-cp',fixture.tool.classpath,'com.android.dx.command.Main','--dex','--output='+dex,classes]);
  const jar=fixture.pack('ordinary-restart.jar',{'classes.dex':readFileSync(dex)});
  for (const policy of ['android','declared']) {
   const r=createSpiderRuntime();
   try {
    await r.request({operation:'host',jarInitPolicy:policy,networkDisabled:true});
    assert.equal(await r.request({operation:'scanProtection',path:jar}),true,'original heuristic sees restart killProcess');
    const loaded=await r.loadMain(jar);assert.equal(loaded.loaded,policy==='declared');
    if(policy==='declared'){
     const s=await r.getCSP({key:'p',api:'csp_Policy',type:3,ext:'',jar:''});assert.equal(s.ready,true);
     assert.equal(await r.call(s.token,'action',['initialized']),'true','declared init actually runs');
    } else assert.equal(loaded.failure,'PROTECTED_INIT_UNBOUND');
   } finally {await r.close();}
  }
  const r=createSpiderRuntime();
  try {
   await assert.rejects(r.request({operation:'host',jarInitPolicy:'invented'}),/Unknown JAR init policy/);
   await r.request({operation:'host',jarInitPolicy:'declared',networkDisabled:true});
   assert.equal((await r.loadMain(fixture.nativeFixture.jar)).loaded,false,'a real shell cannot fall back to direct init');
   assert.equal((await r.loadMain(fixture.protectedFixture.jar)).loaded,true,'working protected binding still executes unchanged');
  } finally {await r.close();}
 } finally {fixture.cleanup();}
});
