import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createSpiderRuntime } from '../backend/spider-runtime/index.mjs';
import { buildJSFixtureHost } from '../scripts/compat/build-js-fixture-host.mjs';

test('frozen original URL ext reaches real QuickJS without contacting the server; unmatched network fails closed',async()=>{
 const calls=[];const server=createServer((request,response)=>{calls.push(request.url);response.end('live-unexpected');});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const url='http://127.0.0.1:'+server.address().port+'/rule.js';
 const binding=buildJSFixtureHost(),runtime=createSpiderRuntime({built:binding.built});
 try{
  await runtime.request({operation:'host',networkDisabled:true,httpFixtures:[{url,method:'GET',status:200,headers:{'Content-Type':'text/plain'},bodyBase64:Buffer.from('固定规则').toString('base64')}]});
  await runtime.setModules({modules:{'https://fixture.invalid/script.js':'export default {init(ext){this.ext=ext},home(){return JSON.stringify({ext:this.ext,value:_http(this.ext,{}).content,unmapped:_http(this.ext+"?new=1",{}).content})}}'}});
  const spider=await runtime.getCSP({key:'original',type:3,api:'https://fixture.invalid/script.js',ext:url,jar:''});
  assert.equal(spider.ready,true);
  assert.deepEqual(JSON.parse(await runtime.call(spider.token,'homeContent',[true])),{ext:url,value:'固定规则',unmapped:''});
  assert.equal(calls.length,0);
  assert.ok((await runtime.request({operation:'logs'})).some(value=>value.startsWith('JS_FIXTURE_HIT')));
 }finally{await runtime.close();server.closeAllConnections();await new Promise(done=>server.close(done));}
});

test('test binding preserves live unmatched HTTP and never substitutes frozen GET bytes for POST',async()=>{
 const calls=[];const server=createServer((request,response)=>{calls.push(request.method);response.end(request.method+':live');});
 server.listen(0,'127.0.0.1');await once(server,'listening');const url='http://127.0.0.1:'+server.address().port+'/rule';
 const runtime=createSpiderRuntime({built:buildJSFixtureHost().built});
 try{
  await runtime.request({operation:'host',httpFixtures:[{url,status:200,headers:{},bodyBase64:Buffer.from('frozen').toString('base64')}]});
  await runtime.setModules({modules:{'https://fixture.invalid/test.js':`export default {home(){return JSON.stringify({get:_http(${JSON.stringify(url)},{}).content,post:_http(${JSON.stringify(url)},{method:'post',body:'x'}).content})}}`}});
  const spider=await runtime.getCSP({key:'http',type:3,api:'https://fixture.invalid/test.js',ext:'',jar:''});
  assert.deepEqual(JSON.parse(await runtime.call(spider.token,'homeContent',[true])),{get:'frozen',post:'POST:live'});
  assert.deepEqual(calls,['POST']);
 }finally{await runtime.close();server.closeAllConnections();await new Promise(done=>server.close(done));}
});

test('frozen input adapter rejects failed responses and duplicate normalized URLs before JS execution',async()=>{
 const runtime=createSpiderRuntime({built:buildJSFixtureHost().built});
 const fixture={url:'https://fixture.invalid/a',bodyBase64:'eA==',headers:{}};
 try{
  await assert.rejects(runtime.request({operation:'host',httpFixtures:[{...fixture,status:404}]}),/JS_FIXTURE_UNSUCCESSFUL_INPUT/);
  await assert.rejects(runtime.request({operation:'host',httpFixtures:[fixture,fixture]}),/JS_FIXTURE_DUPLICATE/);
  await assert.rejects(runtime.request({operation:'host',httpFixtures:[{...fixture,method:'POST'}]}),/JS_FIXTURE_ONLY_CODE_RULE_GET/);
 }finally{await runtime.close();}
});
