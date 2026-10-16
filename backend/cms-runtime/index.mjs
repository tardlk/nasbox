// SPDX-License-Identifier: GPL-3.0-only
// SourceViewModel type0/1 HTTP protocol; bounded transport is an explicit host.
import {parseCmsBody} from './parser.mjs';
import {mediaPattern} from './media-pattern.mjs';
export {buildCmsParser,parseCmsBody} from './parser.mjs';
const text=v=>typeof v==='string';
const check=(ok,code)=>{if(!ok)throw Object.assign(new Error(code),{code});};
export function cmsSource(source){
 check(source&&[0,1].includes(source.type)&&text(source.key)&&text(source.api),'CMS_SOURCE_SCHEMA');
 const url=new URL(source.api);check(['http:','https:'].includes(url.protocol),'CMS_HTTP_REQUIRED');return source;
}
export function cmsPlayerResult(source,flag,id){
 check(text(flag)&&text(id),'CMS_ARGUMENTS');let path='';try{path=new URL(id).pathname;}catch{}
 const playUrl=String(source.playUrl??source.playerUrl??'').trim();return {key:id,parse:path&&mediaPattern.test(id)&&!playUrl?0:1,url:id,playUrl,flag};
}
/** OkGo appends encoded form parameters, retaining existing query fields. */
export function cmsRequest(source,method,args=[],{extend}={}){
 cmsSource(source);check(Array.isArray(args),'CMS_ARGUMENTS');const params=new Map(),ac=source.type===0?'videolist':'detail';
 if(method==='homeContent')check(args.length===1&&typeof args[0]==='boolean','CMS_ARGUMENTS');
 else if(method==='categoryContent'){
  check(args.length===4&&text(args[0])&&text(args[1])&&typeof args[2]==='boolean'&&args[3]&&typeof args[3]==='object'&&!Array.isArray(args[3]),'CMS_ARGUMENTS');
  params.set('ac',ac);params.set('t',args[0]);params.set('pg',args[1]);
  for(const[k,v]of Object.entries(args[3])){check(text(v),'CMS_ARGUMENTS');params.set(k,v);}params.set('f',Object.keys(args[3]).length?JSON.stringify(args[3]):'');
 }else if(method==='detailContent'){
  check(args.length===1&&Array.isArray(args[0])&&args[0].length>0&&args[0].every(text),'CMS_ARGUMENTS');params.set('ac',ac);params.set('ids',args[0].join(','));if(extend)params.set('extend',extend);
 }else if(method==='searchContent'){
  check([2,3].includes(args.length)&&text(args[0])&&typeof args[1]==='boolean'&&(args.length===2||text(args[2])),'CMS_ARGUMENTS');params.set('wd',args[0]);if(source.type===1)params.set('ac','detail');
 }else throw Object.assign(new Error('CMS_METHOD_UNSUPPORTED'),{code:'CMS_METHOD_UNSUPPORTED'});
 const base=new URL(source.api).href.split('#')[0],encoded=new URLSearchParams(params).toString();
 return {url:encoded?base+(base.includes('?')?'&':'?')+encoded:base,method:'GET',headers:{'User-Agent':'okhttp/3.12.11'},params:Object.fromEntries(params)};
}
/** Only owns HTTP and small source caches; does not load a JS/JAR engine. */
export function createCmsRuntime({fetchImpl=fetch,timeoutMs=20000,maxBytes=6*1024*1024,maxRedirects=5,onResponse=()=>{},parser=parseCmsBody}={}){
 for(const[k,v]of Object.entries({timeoutMs,maxBytes,maxRedirects}))check(Number.isSafeInteger(v)&&v>0&&v<=(k==='maxBytes'?32*1024*1024:k==='timeoutMs'?300000:10),'CMS_LIMIT');
 let closed=false,generation=0;const pending=new Set(),extendsCache=new Map(),homes=new Map();
 async function request(input,purpose){
  check(!closed,'CMS_CLOSED');const controller=new AbortController();pending.add(controller);const timer=setTimeout(()=>controller.abort(),timeoutMs);let url=input.url;const redirects=[];
  try{for(let hop=0;;hop++){
   const response=await fetchImpl(url,{method:'GET',headers:input.headers,signal:controller.signal,redirect:'manual'});
   if([301,302,303,307,308].includes(response.status)){const location=response.headers.get('location');await response.body?.cancel();check(location&&hop<maxRedirects,'CMS_REDIRECT_LIMIT');const next=new URL(location,url);check(['http:','https:'].includes(next.protocol),'CMS_HTTP_REQUIRED');redirects.push({status:response.status,from:url,to:next.href});url=next.href;continue;}
   const chunks=[];let count=0;try{if(response.body)for await(const chunk of response.body){count+=chunk.length;check(count<=maxBytes,'CMS_RESPONSE_LIMIT');chunks.push(Buffer.from(chunk));}}finally{if(count>maxBytes)await response.body?.cancel().catch(()=>{});}
   const bytes=Buffer.concat(chunks),contentType=response.headers.get('content-type')||'';let encoding=/charset\s*=\s*["']?([^;\s"']+)/i.exec(contentType)?.[1]||'utf-8';
   if(bytes[0]===0xff&&bytes[1]===0xfe)encoding='utf-16le';else if(bytes[0]===0xfe&&bytes[1]===0xff)encoding='utf-16be';else if(bytes[0]===0xef&&bytes[1]===0xbb&&bytes[2]===0xbf)encoding='utf-8';
   let decoded;try{decoded=new TextDecoder(encoding).decode(bytes);}catch{throw Object.assign(new Error('CMS_CHARSET_UNSUPPORTED'),{code:'CMS_CHARSET_UNSUPPORTED'});}
   await onResponse({purpose,request:input,finalUrl:url,status:response.status,contentType,bytes,text:decoded,redirects});
   check(response.status>=200&&response.status<300,'CMS_HTTP_'+response.status);return decoded;
  }}catch(error){if(controller.signal.aborted)throw Object.assign(new Error('CMS_TIMEOUT'),{code:'CMS_TIMEOUT'});throw error;}
  finally{clearTimeout(timer);pending.delete(controller);}
 }
 async function resolvedExtend(source){
  const ext=source.ext||'';if(!ext.startsWith('http'))return ext;
  if(ext.startsWith('http://127.0.0.1'))throw Object.assign(new Error('CMS_LOCAL_EXT_UNBOUND'),{code:'CMS_LOCAL_EXT_UNBOUND'});
  if(extendsCache.has(ext))return extendsCache.get(ext);
  try{let value=await request({url:ext,headers:{'User-Agent':'okhttp/3.12.11'},method:'GET'},'detail-extend');if(!value)return value;value=value.trim();try{value=JSON.stringify(JSON.parse(value));}catch{}if(value.length>2500)value=ext;extendsCache.set(ext,value);return value;}catch{return ext;}
 }
 return {
  descriptor(source){cmsSource(source);return {kind:source.type===0?'cms-xml':'cms-json',ready:true,siteKey:source.key,readyScope:'Validated configuration; HTTP/business not tested by this descriptor'};},
  async call(source,method,args=[]){
   cmsSource(source);check(!closed,'CMS_CLOSED');const before=generation;
   if(method==='playerContent'){check(args.length===3&&Array.isArray(args[2])&&args[2].every(text),'CMS_ARGUMENTS');return JSON.stringify(cmsPlayerResult(source,args[0],args[1]));}
   if(method==='homeVideoContent'){
    check(args.length===0,'CMS_ARGUMENTS');const home=homes.get(source.key)||JSON.parse(await this.call(source,'homeContent',[true]));const ids=home.list.map(v=>v.vod_id).filter(text);if(!ids.length)return JSON.stringify({list:[]});
    const body=await request(cmsRequest(source,'detailContent',[ids]),'home-recommendations');check(before===generation&&!closed,'CMS_SOURCE_CLEARED');return JSON.stringify(parser(source.type,body));
   }
   const extend=method==='detailContent'?await resolvedExtend(source):undefined;
   check(before===generation&&!closed,'CMS_SOURCE_CLEARED');
   const body=await request(cmsRequest(source,method,args,{extend}),method);check(before===generation&&!closed,'CMS_SOURCE_CLEARED');const value=parser(source.type,body,{home:method==='homeContent'});
   if(method==='homeContent')homes.set(source.key,value);return JSON.stringify(value);
  },
  async clear(){generation++;for(const c of pending)c.abort();homes.clear();extendsCache.clear();},
  getState:()=>({kind:'cms-http',generation,sourceCount:homes.size,extendCacheEntries:extendsCache.size,inFlight:pending.size,closed}),
  async close(){if(closed)return;closed=true;generation++;for(const c of pending)c.abort();homes.clear();extendsCache.clear();}
 };
}
