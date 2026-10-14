// SPDX-License-Identifier: GPL-3.0-only
import test from'node:test';import assert from'node:assert/strict';import{mkdtempSync,mkdirSync,symlinkSync,unlinkSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join,resolve}from'node:path';import{spawnSync}from'node:child_process';import{buildConfigCore}from'../backend/config-core/index.mjs';import{prepareContainerRuntime}from'../scripts/container/build.mjs';import{doctor}from'../scripts/container/doctor.mjs';
const root=resolve(import.meta.dirname,'..');
test('prebuilt config loads with a JRE-only Java home and fails closed when outputs are missing',()=>{
 const folder=mkdtempSync(join(tmpdir(),'tvbox-jre-test-')),bin=join(folder,'bin'),home=process.env.TVBOX_JAVA_HOME||process.env.JAVA_HOME||join(root,'.tools/jdk17');mkdirSync(bin);symlinkSync(join(home,'bin/java'),join(bin,'java'));symlinkSync(join(home,'bin/javac'),join(bin,'javac'));let built;
 const run=code=>spawnSync(process.execPath,['--input-type=module','-e',code],{cwd:root,encoding:'utf8',timeout:30000,env:{...process.env,TVBOX_JAVA_HOME:folder,TVBOX_PREBUILT_ONLY:'1'}});
 const old=process.env.TVBOX_JAVA_HOME;try{
  process.env.TVBOX_JAVA_HOME=folder;built=buildConfigCore();unlinkSync(join(bin,'javac'));
  let r=run(`import{createConfigCore}from'./backend/config-core/index.mjs';const c=createConfigCore();try{console.log(JSON.stringify(await c.parseSites('{sites:[{key:"jre",type:3,api:"csp_Test"}]}')));}finally{await c.close();}`);assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout)[0].key,'jre');
  unlinkSync(join(built.build,'complete'));r=run(`import{buildConfigCore}from'./backend/config-core/index.mjs';buildConfigCore();`);assert.notEqual(r.status,0);assert.match(r.stderr,/Prebuilt config runtime missing/);
 }finally{if(old===undefined)delete process.env.TVBOX_JAVA_HOME;else process.env.TVBOX_JAVA_HOME=old;if(built)rmSync(built.build,{recursive:true,force:true});rmSync(folder,{recursive:true,force:true});}
});
test('container doctor runs offline with prebuilt outputs and no compiler on PATH',{skip:process.env.TVBOX_TEST_NATIVE!=='1',timeout:120000},async()=>{
 prepareContainerRuntime();const result=spawnSync(process.execPath,['scripts/container/doctor.mjs'],{cwd:root,encoding:'utf8',timeout:90000,env:{...process.env,TVBOX_PREBUILT_ONLY:'1',TVBOX_EXPECT_PLATFORM:process.platform+'-'+process.arch,PATH:'/nonexistent'}});assert.equal(result.status,0,result.stderr);const report=JSON.parse(result.stdout);assert.equal(report.ok,true);assert.equal(report.dex.resource,'offline-dex-resource');assert.deepEqual(report.arm.map(x=>x.value),[42,42,43]);assert.equal(report.lifecycle.workerReplaced,true);
 await assert.rejects(doctor({expectedPlatform:'definitely-wrong-platform'}),/Container platform differs/);
});
