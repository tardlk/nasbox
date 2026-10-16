// SPDX-License-Identifier: GPL-3.0-only
// Offline end-to-end HTTP fixtures through the packaged production session.
import {createServer} from 'node:http';
import {once} from 'node:events';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createExecutableSubscriptionSession} from '../../backend/spider-runtime/session.mjs';
export async function cmsDoctor(){
 const seen=[];const server=createServer((request,response)=>{
  const u=new URL(request.url,'http://fixture');seen.push({kind:u.pathname,ac:u.searchParams.get('ac'),t:u.searchParams.get('t'),f:u.searchParams.get('f'),year:u.searchParams.get('year')});
  if(u.pathname==='/xml'){response.setHeader('Content-Type','application/xml');response.end('<rss><class><ty id="alpha">XML</ty></class><list page="1" pagecount="2" pagesize="1" recordcount="2"><video><id>x$1</id><name><![CDATA[XML & 内容]]></name><dl><dd flag="owned"><![CDATA[第一集$https://media.invalid/owned/one.m3u8]]></dd></dl></video></list></rss>');}
  else{response.setHeader('Content-Type','application/json');response.end(JSON.stringify({class:[{type_id:'alpha',type_name:'JSON'}],filters:{alpha:[{key:'year',name:'年',value:[{n:'2026',v:'2026'}]}]},page:1,pagecount:2,limit:1,total:2,list:[{vod_id:'j$1',vod_name:'JSON & 内容',vod_play_from:'owned',vod_play_url:'第一集$https://media.invalid/owned/one.m3u8'}]}));}
 });server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 const sources=[{key:'owned-json',type:1,api:base+'/json',ext:'',playUrl:''},{key:'owned-xml',type:0,api:base+'/xml',ext:'',playUrl:''}];
 const session=await createExecutableSubscriptionSession({fetchText:async()=>JSON.stringify({sites:sources})});const cases=[];
 try{if(!(await session.load({apiUrl:'https://fixture.invalid/config'})).ok)throw new Error('CMS_DOCTOR_IMPORT');
  for(const source of sources){const result=[];for(const[method,args]of[['homeContent',[true]],['homeVideoContent',[]],['categoryContent',['alpha','2',true,{year:'2026'}]],['searchContent',['中文',false]],['detailContent',[['opaque$id']]],['playerContent',['owned','https://media.invalid/owned/one.m3u8',[]]]]){
    const value=JSON.parse((await session.call(source.key,method,args)).value);if(method==='playerContent'?value.parse!==0:value.list.length!==1)throw new Error('CMS_DOCTOR_METHOD');result.push(method);
   }cases.push({type:source.type,methods:result});
  }
  if(!seen.some(r=>r.kind==='/xml'&&r.ac===null)||!seen.some(r=>r.kind==='/json'&&r.ac==='detail')||!seen.some(r=>r.t==='alpha'&&r.year==='2026'&&JSON.parse(r.f).year==='2026'))throw new Error('CMS_DOCTOR_REQUEST');
  const before=await session.getState();if(before.runtime.jar.spiderCount||before.runtime.js.spiderCount)throw new Error('CMS_DOCTOR_SCRIPT_ROUTING');
  await session.load({apiUrl:'https://fixture.invalid/config'});if((await session.getState()).cms.sourceCount!==0)throw new Error('CMS_DOCTOR_CLEAR');
 }finally{await session.close();server.closeAllConnections();await new Promise(done=>server.close(done));}
 return {ok:true,scope:'Offline owned HTTP fixtures; actual subscription dispatch, parsers, request parameters, player metadata and cleanup; no media request',cases,requestCount:seen.length,cleanup:{closed:true,httpStopped:true}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))try{console.log(JSON.stringify(await cmsDoctor()));}catch(error){console.error(JSON.stringify({code:'CMS_DOCTOR_FAILED',errorType:error.name}));process.exitCode=1;}
