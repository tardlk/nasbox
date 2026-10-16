import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {parseCmsBody,createCmsRuntime,cmsRequest,cmsPlayerResult} from '../backend/cms-runtime/index.mjs';
import {createExecutableSubscriptionSession} from '../backend/spider-runtime/session.mjs';
import {recordedCmsFetch} from '../scripts/container/cms-source-probe.mjs';
const source=(type,api='https://owned.invalid/api?token=kept')=>({type,key:'cms'+type,api,ext:'',playUrl:''});
const vod={vod_id:'opaque:$id',vod_name:'A & 中文',type_id:'12oops',vod_year:'2026x',vod_pic:'x@Referer=y',vod_play_from:' a $$$b',vod_play_url:'One$https://owned.invalid/a$x#raw$$$Two$https://owned.invalid/b',vod_content:'<p>keep</p>'};
const body=JSON.stringify({class:[{type_id:'alpha',type_name:'类别'}],list:[vod],page:'2',pagecount:4,limit:'20x',total:5});
const xml='<rss><class><ty id="alpha">类别 &amp; 中文</ty></class><list page="2" pagecount="4" pagesize="20" recordcount="5"><video><id>opaque:$id</id><name><![CDATA[A & 中文]]></name><year></year><dl><dd flag="a"><![CDATA[One$https://owned.invalid/a$x#raw]]></dd><dd flag="b">Two$https://owned.invalid/b</dd></dl><des><![CDATA[<p>keep</p>]]></des><unknown>ignored</unknown></video></list></rss>';
test('CMS models and protocol authority remain tied to immutable Android source; model method bodies unchanged',()=>{
 const root='compat/reference/tvboxos-cms/',manifest=JSON.parse(readFileSync(root+'manifest.json'));assert.equal(manifest.commit,'ab11d289e09963a9daf65ca7f6b7a9a8cbe184e1');
 for(const pin of manifest.files){const name=pin.path.split('/').at(-1),raw=readFileSync(root+name);assert.equal(createHash('sha256').update(raw).digest('hex'),pin.sha256);if(name==='SourceViewModel.java')continue;
  const projected=raw.toString().split(/\n/).filter(line=>!line.trim().startsWith('import com.thoughtworks.')&&!line.trim().startsWith('@XStream')).join('\n');
  assert.equal(readFileSync('backend/cms-runtime/src/com/github/tvbox/osc/bean/'+name,'utf8').split('\n').slice(2).join('\n').trimEnd(),projected.trimEnd());
 }
});
test('CMS query builder preserves existing query, duplicates, empty f, filters and original XML search difference',()=>{
 const r=cmsRequest(source(1),'categoryContent',['alpha','2',true,{year:'2025',area:'中 国'}]);const u=new URL(r.url);
 assert.equal(u.searchParams.get('token'),'kept');assert.equal(u.searchParams.get('year'),'2025');assert.deepEqual(JSON.parse(u.searchParams.get('f')),{year:'2025',area:'中 国'});
 assert.equal(new URL(cmsRequest(source(0),'categoryContent',['a','1',false,{}]).url).searchParams.get('ac'),'videolist');
 assert.equal(new URL(cmsRequest(source(0),'searchContent',['a b&c',false]).url).searchParams.has('ac'),false);
 assert.equal(new URL(cmsRequest(source(1),'searchContent',['a b&c',true,'99']).url).searchParams.get('ac'),'detail');
 assert.equal(new URL(cmsRequest(source(1,'https://owned.invalid/?ac=old'),'detailContent',[['x','y']]).url).searchParams.getAll('ac').join(','),'old,detail');
 assert.equal(new URL(cmsRequest(source(1),'categoryContent',['x','1',true,{}]).url).searchParams.get('f'),'');
});
test('real pinned Gson mappings retain opaque IDs, null fields, full episode strings and strict integer conversion',()=>{
 const result=parseCmsBody(1,body);assert.equal(result.list[0].vod_id,'opaque:$id');assert.equal(result.list[0].type_id,0);assert.equal(result.list[0].vod_year,0);assert.equal(result.limit,0);
 assert.equal(result.list[0].vod_pic,'x@Referer=y');assert.equal(result.list[0].vod_play_from,'a$$$b');assert.equal(result.list[0].vod_play_url,vod.vod_play_url);assert.equal(result.list[0].vod_actor,null);
 const home=parseCmsBody(1,'{"class":[{"id":"alpha","name":"类别"},null,{"name":"missing id"}],"list":[]}',{home:true});assert.equal(home.class.length,1);assert.equal(home.class[0].type_id,'alpha');
 assert.throws(()=>parseCmsBody(1,'{"page":1}'),/CMS_INVALID_BODY/);assert.throws(()=>parseCmsBody(1,'<html>bad</html>'),/CMS_INVALID_BODY/);
});
test('secure XML binding preserves CDATA/entities/multiple lines and rejects malformed XML or external entities',()=>{
 const result=parseCmsBody(0,xml,{home:true});assert.equal(result.class[0].type_id,'alpha');assert.equal(result.class[0].type_name,'类别 & 中文');assert.equal(result.list[0].vod_play_from,'a$$$b');assert.equal(result.list[0].vod_play_url,vod.vod_play_url);assert.equal(result.list[0].vod_content,'<p>keep</p>');assert.equal(result.list[0].vod_year,0);
 for(const bad of ['<rss><list></rss>','<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]><rss><class><ty id="1">&x;</ty></class></rss>','<html/>'])assert.throws(()=>parseCmsBody(0,bad,{home:true}),/CMS_INVALID_BODY/);
 assert.equal(parseCmsBody(0,'<rss><list page="1" pagecount="1" pagesize="0" recordcount="0"/></rss>').list.length,0);
});
test('JSON filters retain Android duplicate label overwrite and malformed filters do not break classes',()=>{
 const home=parseCmsBody(1,JSON.stringify({class:[{type_id:'a',type_name:'A'}],filters:{a:[{key:'year',name:'年',value:[{n:'x',v:'1'},{n:'x',v:'2'}]}]}}),{home:true});assert.deepEqual(home.filters.a[0].value,[{n:'x',v:'2'}]);
 const bad=parseCmsBody(1,'{"class":[{"type_id":"a","type_name":"A"}],"filters":{"a":[{"bad":1}]}}',{home:true});assert.deepEqual(bad.filters,{});assert.equal(bad.class.length,1);
});
async function fixture(){const seen=[];const server=createServer((req,res)=>{seen.push(req.url);if(req.url.startsWith('/redirect')){res.writeHead(302,{Location:'/api'});res.end();return;}if(req.url.startsWith('/slow'))return;const u=new URL(req.url,'http://owned');if(u.pathname==='/ext'){res.end(' { "a": 1 } ');return;}if(u.pathname==='/bad'){res.writeHead(503);res.end('unavailable');return;}if(u.pathname==='/big'){res.end('x'.repeat(4096));return;}res.setHeader('Content-Type','application/json');res.end(body);});server.listen(0,'127.0.0.1');await once(server,'listening');return{url:'http://127.0.0.1:'+server.address().port,seen,close:async()=>{server.closeAllConnections();await new Promise(done=>server.close(done));}};}
test('HTTP execution, recommendations, redirects, extension cache and parser return work without media requests',async()=>{
 const f=await fixture(),runtime=createCmsRuntime();try{
  const s=source(1,f.url+'/api');s.ext=f.url.replace('127.0.0.1','localhost')+'/ext';
  assert.equal(JSON.parse(await runtime.call(s,'homeContent',[true])).class[0].type_id,'alpha');
  await runtime.call(s,'homeVideoContent',[]);await runtime.call(s,'detailContent',[['x']]);await runtime.call(s,'detailContent',[['y']]);
  assert.equal(f.seen.filter(x=>x==='/ext').length,1);assert.ok(f.seen.some(x=>new URL(x,'http://owned').searchParams.get('extend')==='{"a":1}'));
  const requests=f.seen.length;const p=JSON.parse(await runtime.call(s,'playerContent',['a','https://owned.invalid/media/file.m3u8',[]]));assert.equal(p.parse,0);assert.equal(f.seen.length,requests);
  await runtime.call(source(1,f.url+'/redirect'),'homeContent',[false]);await runtime.clear();assert.equal(runtime.getState().sourceCount,0);assert.equal(runtime.getState().extendCacheEntries,0);
 }finally{await runtime.close();await f.close();}
});
test('HTTP errors, byte budget, timeout and close are bounded and do not become successful empty results',async()=>{
 const f=await fixture(),r=createCmsRuntime({timeoutMs:100,maxBytes:1024});try{
  await assert.rejects(r.call(source(1,f.url+'/bad'),'homeContent',[true]),/CMS_HTTP_503/);await assert.rejects(r.call(source(1,f.url+'/big'),'homeContent',[true]),/CMS_RESPONSE_LIMIT/);
  await assert.rejects(r.call(source(1,f.url+'/slow'),'homeContent',[true]),/CMS_TIMEOUT/);assert.equal(r.getState().inFlight,0);
  const pending=r.call(source(1,f.url+'/slow'),'homeContent',[true]);await r.close();await assert.rejects(pending);assert.equal(r.getState().inFlight,0);await assert.rejects(r.call(source(1,f.url+'/api'),'homeContent',[true]),/CMS_CLOSED/);
 }finally{await r.close();await f.close();}
});
test('CMS player honors source playUrl and cannot claim pages are decoded media',()=>{
 assert.equal(cmsPlayerResult(source(1),'a','https://owned.invalid/media/file.m3u8').parse,0);assert.equal(cmsPlayerResult({...source(1),playUrl:' https://parse.invalid/?url= '},'a','https://owned.invalid/media/file.m3u8').parse,1);
 assert.equal(cmsPlayerResult(source(0),'a','https://owned.invalid/watch/123').parse,1);assert.equal(cmsPlayerResult(source(0),'a','opaque$id').url,'opaque$id');
});
test('frozen HTTP replay rejects modified bytes and different requests, retaining HTTP error bodies',async()=>{
 const bytes=Buffer.from('blocked'),url='https://owned.invalid/api';const r={request:{url,method:'GET'},finalUrl:url,status:403,contentType:'text/plain',bodyBase64:bytes.toString('base64'),bodyBytes:bytes.length,bodySha256:createHash('sha256').update(bytes).digest('hex'),redirects:[]};
 const f=recordedCmsFetch([r]);const response=await f(url,{method:'GET'});assert.equal(response.status,403);assert.equal(await response.text(),'blocked');assert.deepEqual(f.state(),{expected:1,consumed:1});
 assert.throws(()=>recordedCmsFetch([{...r,bodyBase64:Buffer.from('changed').toString('base64')}] ),/CHECKSUM/);await assert.rejects(recordedCmsFetch([r])(url+'?other=1',{method:'GET'}),/MISMATCH/);
});
test('subscription dispatch reaches actual CMS methods, preserves source selection and clears CMS caches on reimport',async()=>{
 const f=await fixture();const session=await createExecutableSubscriptionSession({fetchText:async()=>JSON.stringify({sites:[source(1,f.url+'/api'),source(0,f.url+'/xml')]}),cmsOptions:{timeoutMs:1000}});
 try{assert.equal((await session.load({apiUrl:'https://owned.invalid/config'})).ok,true);const result=await session.call('cms1','homeContent',[true]);assert.equal(result.spider.kind,'cms-json');assert.equal(JSON.parse(result.value).list.length,1);assert.equal((await session.getState()).runtime.jar.spiderCount,0);assert.equal((await session.getState()).cms.sourceCount,1);await session.load({apiUrl:'https://owned.invalid/config'});assert.equal((await session.getState()).cms.sourceCount,0);}
 finally{await session.close();await f.close();}
});
