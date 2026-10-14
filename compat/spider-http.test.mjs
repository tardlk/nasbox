import test from'node:test';import assert from'node:assert/strict';import{createServer}from'node:http';import{once}from'node:events';
import{createSpiderRuntime,buildSpiderRuntime}from'../backend/spider-runtime/index.mjs';
const built=buildSpiderRuntime();
async function fixture(){let active=0,maximum=0;const server=createServer(async(req,res)=>{
 const chunks=[];for await(const chunk of req)chunks.push(chunk);const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/delay'){active++;maximum=Math.max(maximum,active);await new Promise(r=>setTimeout(r,80+Number(url.searchParams.get('i'))%3*20));active--;res.end(JSON.stringify({index:Number(url.searchParams.get('i'))}));return;}
 if(url.pathname==='/gbk'){res.setHeader('Content-Type','text/plain; charset=GBK');res.end(Buffer.from('d6d0cec4','hex'));return;}
 if(url.pathname==='/bom'){res.setHeader('Content-Type','text/plain; charset=UTF-8');res.end(Buffer.concat([Buffer.from([239,187,191]),Buffer.from('bom')]));return;}
 if(url.pathname==='/bytes'){res.setHeader('Content-Type','application/octet-stream');res.end(Buffer.from([0,128,255]));return;}
 if(url.pathname==='/json'){res.end('{"value":1e3}');return;}if(url.pathname==='/array'){res.end('[1,2]');return;}if(url.pathname==='/scalar'){res.end('123');return;}if(url.pathname==='/error'){res.statusCode=500;res.end('{"code":500}');return;}
 res.setHeader('Content-Type','application/json');res.end(JSON.stringify({method:req.method,body:Buffer.concat(chunks).toString('utf8'),contentType:req.headers['content-type']||'',x:req.headers['x-fixture']||''}));
 });server.listen(0,'127.0.0.1');await once(server,'listening');return{base:`http://127.0.0.1:${server.address().port}`,maximum:()=>maximum,close:async()=>{server.closeAllConnections();await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}};
}
test('SpiderApi multiReq uses real pinned OkHttp for JSON, forms, headers, HTTP error bodies and charset/BOM',async()=>{
 const http=await fixture(),r=createSpiderRuntime({built});try{
  const requests=[{url:http.base+'/json'},{url:http.base+'/array'},{url:http.base+'/scalar'},{url:http.base+'/error'},{url:http.base+'/gbk'},{url:http.base+'/bom'},
   {url:http.base+'/record',method:'POST',data:{a:1}},
   {url:http.base+'/record',method:'post',postType:'form',data:{a:'a b',c:'中文'},headers:{'X-Fixture':'header'}},
   {url:http.base+'/record',method:'POST',postType:'form',data:{a:null}},
   {url:http.base+'/record',method:'PUT',data:'ignored'},
   {url:http.base+'/record',headers:{'X-Fixture':null}},null,3];
  const values=JSON.parse(await r.request({operation:'api',method:'multiReq',args:[requests]}));
  assert.equal(values.length,11);assert.deepEqual(values.slice(0,6),[{value:1000},[1,2],'123',{code:500},'中文','bom']);
  assert.equal(values[6].method,'POST');assert.equal(values[6].body,'{"a":1}');assert.equal(values[6].contentType,'');
  assert.equal(values[7].body,'a=a%20b&c=%E4%B8%AD%E6%96%87');assert.equal(values[7].x,'header');assert.equal(values[7].contentType,'application/x-www-form-urlencoded');
  assert.equal(values[8],'');assert.equal(values[9].method,'GET');assert.equal(values[9].body,'');assert.equal(values[10].x,'');
 }finally{await r.close();await http.close();}
});
test('SpiderApi multiReq preserves input order while limiting its actual worker pool to six',async()=>{
 const http=await fixture(),r=createSpiderRuntime({built});try{
  const input=Array.from({length:13},(_,i)=>({url:http.base+'/delay?i='+i}));const output=JSON.parse(await r.request({operation:'api',method:'multiReq',args:[input]}));
  assert.deepEqual(output.map(v=>v.index),Array.from({length:13},(_,i)=>i));assert.equal(http.maximum(),6);
 }finally{await r.close();await http.close();}
});
test('QuickJS synchronous HTTP bindings execute real GET/POST and original signed-byte/Base64 buffer modes',async()=>{
 const http=await fixture(),r=createSpiderRuntime({built});try{
  await r.setModules({modules:{'https://fixture.invalid/http.js':`export default {action(value){const p=JSON.parse(value);return JSON.stringify(_http(p.url,p.options||{}));}}`}});
  const sp=await r.getCSP({key:'http',type:3,api:'https://fixture.invalid/http.js',ext:'',jar:''});
  const request=async(path,options={})=>JSON.parse(await r.call(sp.token,'action',[JSON.stringify({url:http.base+path,options})]));
  assert.equal((await request('/json')).content,'{"value":1e3}');assert.deepEqual((await request('/bytes',{buffer:1})).content,[0,-128,-1]);assert.equal((await request('/bytes',{buffer:2})).content,'AID/');
  const post=JSON.parse((await request('/record',{method:'post',postType:'json',data:{value:1},headers:{'X-Fixture':'js'}})).content);
  assert.equal(post.method,'POST');assert.equal(post.body,'{"value":1}');assert.equal(post.x,'js');
 }finally{await r.close();await http.close();}
});
