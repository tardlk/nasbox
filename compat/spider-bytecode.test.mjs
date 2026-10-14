import test from'node:test';import assert from'node:assert/strict';import{createHash}from'node:crypto';import{createSpiderRuntime,buildSpiderRuntime}from'../backend/spider-runtime/index.mjs';
const built=buildSpiderRuntime();const source=(key,api)=>({key,type:3,api,ext:'{"v":1}',jar:''});
test('native version-67 bytecode compiled by the pinned QuickJS engine executes through the original bb wrapper',async()=>{
 const r=createSpiderRuntime({built});try{
  const key='bytecode',name='J'+createHash('md5').update(key).digest('hex')+'.js';
  const compiled=await r.request({operation:'compileModule',name,text:'let config;export function __jsEvalReturn(){return {init(c){config=c},home(){return JSON.stringify({bytecode:true,config})}}}'});assert.equal(compiled.version,67);
  const bytes=Buffer.from(compiled.base64,'base64'),wrapper=Buffer.concat([Buffer.from([0,1,2,3,4]),bytes.subarray(1)]);
  await r.setModules({modules:{'https://fixture.invalid/bytecode.js':'//bb'+wrapper.toString('base64')}});
  const sp=await r.getCSP(source(key,'https://fixture.invalid/bytecode.js'));assert.equal(sp.ready,true);assert.deepEqual(JSON.parse(await r.call(sp.token,'homeContent',[true])),{bytecode:true,config:{stype:3,skey:key,ext:{v:1}}});
 }finally{await r.close();}
});
test('original DRPY imported module path accepts matching bytecode and rejects mismatched versions',async()=>{
 const r=createSpiderRuntime({built});try{
  const compiled=await r.request({operation:'compileModule',name:'https://fixture.invalid/compiled.js',text:'export const marker="compiled-import";'});
  await r.setModules({modules:{'https://fixture.invalid/compiled.js':'//DRPY'+Buffer.from(compiled.base64,'base64').toString('base64url'),'https://fixture.invalid/root.js':'import{marker}from"./compiled.js";export default{home(){return marker}}'}});
  const sp=await r.getCSP(source('drpy','https://fixture.invalid/root.js'));assert.equal(sp.ready,true);assert.equal(await r.call(sp.token,'homeContent',[true]),'compiled-import');
  const invalid=Buffer.from(compiled.base64,'base64');invalid[0]=1;await r.setModules({modules:{'https://fixture.invalid/compiled.js':'//DRPY'+invalid.toString('base64url')}});
  const bad=await r.getCSP(source('wrong-version','https://fixture.invalid/root.js'));assert.equal(bad.ready,false);
 }finally{await r.close();}
});
test('malformed bb input stays an unloaded script object and the worker can process another source',async()=>{
 const r=createSpiderRuntime({built});try{
  await r.setModules({modules:{'https://fixture.invalid/bad.js':'//bbYQ==','https://fixture.invalid/good.js':'export default{home(){return "good"}}'}});
  assert.equal((await r.getCSP(source('bad','https://fixture.invalid/bad.js'))).ready,false);const good=await r.getCSP(source('good','https://fixture.invalid/good.js'));assert.equal(await r.call(good.token,'homeContent',[true]),'good');
 }finally{await r.close();}
});
