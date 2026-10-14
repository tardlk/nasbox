import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { root, reference } from '../scripts/compat/reference.mjs';
import { extractMethod } from '../scripts/compat/oracle.mjs';
import { buildFullOracle, queryFullOracle } from '../scripts/compat/full-oracle.mjs';
import { fullCases } from '../scripts/compat/full-cases.mjs';
import { createConfigCore, ConfigParseError } from '../backend/config-core/index.mjs';
import { createFullSubscriptionLoader } from '../backend/subscription/full-loader.mjs';
import { RuntimeCleanup } from '../backend/subscription/runtime-cleanup.mjs';
import { FileSubscriptionStore, MemorySubscriptionStore } from '../backend/subscription/store.mjs';

const frozen=JSON.parse(readFileSync(resolve(root,'compat/fixtures/full-observations.json'),'utf8'));

test('full parser matches 85 frozen original-source state/query results in one ordered session', async()=>{
  assert.deepEqual(frozen.cases.map(({id,request})=>({id,request})),fullCases);
  const core=createConfigCore();
  try{const actual=await Promise.all(frozen.cases.map(c=>core.query(c.request)));
    for(const[i,c]of frozen.cases.entries())assert.deepEqual(actual[i],c.expected,c.id);
  }finally{await core.close();}
});

test('fresh pinned full source probe still matches all frozen results',()=>{
  const actual=queryFullOracle(fullCases.map(c=>c.request),buildFullOracle());
  for(const[i,c]of frozen.cases.entries())assert.deepEqual(actual[i],c.expected,c.id);
});

test('committed full parser preserves every extracted original method body',()=>{
  const runtime=readFileSync(resolve(root,'backend/config-core/src/tvbox/config/FullConfig.java'),'utf8');
  const original=readFileSync(resolve(reference,'app/src/main/java/com/github/tvbox/osc/api/ApiConfig.java'),'utf8');
  for(const {signature}of frozen.extraction.methods){
    const hostSignature=signature.replace('public static String getLiveGroupIndexKey','public String getLiveGroupIndexKey').replace('public static int getLiveGroupIndex','public int getLiveGroupIndex');
    const expected=extractMethod(original,signature).replace('public static String getLiveGroupIndexKey','public String getLiveGroupIndexKey').replace('public static int getLiveGroupIndex','public int getLiveGroupIndex');
    assert.equal(extractMethod(runtime,hostSignature),expected,signature);
  }
});

test('host state distinguishes missing fields, partial failures and unresolved external effects',async()=>{
 const core=createConfigCore();
 try{
  const first=await core.parseFull('{sites:[],hosts:["a=b"],rules:[{host:"a",rule:["yes"]}],ads:["extra.invalid"],lives:[{api:"http://live.invalid/a.py"}]}');
  assert.equal(first.hosts.a,'b');assert.deepEqual(first.rules.rules.a,[['yes']]);
  assert.deepEqual(first.effects.filter(e=>!e.completed).map(e=>e.operation),['py.getSpider','http.reset']);
  assert.deepEqual(first.liveChannels,[]); // Unbound init is thrown and swallowed at original boundary.
  const second=await core.parseFull('{sites:[]}');
  assert.deepEqual(second.hosts,{});assert.deepEqual(second.rules.rules.a,[['yes']]);assert.ok(second.ads.includes('extra.invalid'));
  await assert.rejects(core.parseFull('{sites:[],hosts:["partial=yes",null]}'),e=>{
    assert.ok(e instanceof ConfigParseError);assert.equal(e.partialConfig.hosts.partial,'yes');
    // setDnsList has not executed yet, retaining the preceding host-map reference.
    assert.deepEqual(e.partialConfig.dnsHosts,{});return true;
  });
 }finally{await core.close();}
});

test('live channel merging keeps first metadata and adds only distinct URLs',async()=>{
 const core=createConfigCore();
 try{
  const result=await core.query({operation:'full',action:'lives',text:JSON.stringify([{group:'新闻_pw',channels:[
   {name:'台1',ua:'first',urls:['http://a$A','http://b']}, {name:'台1',ua:'second',urls:['http://a$duplicate','http://c$C']},
  ]}])});
  const group=result.value.config.liveChannels[0],channel=group.liveChannelItems[0];
  assert.equal(group.groupPassword,'pw');assert.equal(channel.channelUa,'first');
  assert.deepEqual(channel.channelUrls,['http://a','http://b','http://c']);assert.deepEqual(channel.channelSourceNames,['A','源2','C']);assert.equal(channel.channelNum,1);
 }finally{await core.close();}
});

test('ordered executor cleanup stops parsing on failure and disposes all remaining resources on shutdown',async()=>{
 const cleanup=new RuntimeCleanup(),calls=[];let fail=true;
 cleanup.register('jar',{clear:async()=>{calls.push('jar');}});
 cleanup.register('py',{clear:async()=>{calls.push('py');if(fail)throw new Error('controlled failure');}});
 cleanup.register('js',{clear:async()=>{calls.push('js');}});
 const core=createConfigCore(),loader=createFullSubscriptionLoader({core,runtimeCleanup:cleanup,fetchText:async()=>'{sites:[{key:"new",type:3,api:"x"}]}'});
 try{
  await core.parseFull('{sites:[{key:"old",type:3,api:"x"}]}');
  await core.query({operation:'full',action:'seedRuntime'});
  const failed=await loader.load({apiUrl:'http://config.invalid/a'});
  assert.equal(failed.ok,false);assert.deepEqual(calls,['jar','py']);
  const partial=await loader.getConfig();assert.equal(partial.sites[0].key,'old');assert.deepEqual(partial.runtimeKeys,{play:'old-play',py:'',livePy:'',liveSpider:'',liveGlobalSpider:'',warmedSearch:['old-search']});
  fail=false;
  const accepted=await loader.load();assert.equal(accepted.ok,true);assert.deepEqual(calls,['jar','py','py','js']);
  assert.deepEqual((await loader.getConfig()).runtimeKeys.warmedSearch,[]);
  cleanup.register('js',{clear:async()=>{calls.push('shutdown');}});
 }finally{fail=false;await loader.close();await core.close();}
 assert.equal(calls.at(-1),'shutdown');
});

test('cleanup shutdown attempts all resources and reports failures',async()=>{
 const cleanup=new RuntimeCleanup(),calls=[];
 cleanup.register('jar',{clear:async()=>{calls.push('jar');throw new Error('failure');}});
 cleanup.register('py',{clear:async()=>{calls.push('py');}});
 await assert.rejects(cleanup.close(),AggregateError);assert.deepEqual(calls,['jar','py']);
 await assert.rejects(cleanup.clearForImport(),/closed/);assert.throws(()=>cleanup.register('js',{clear(){}}),/closed/);
});

test('full loader cache restart restores typed live/DOH preferences and the expanded configuration',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'tvbox-full-'));
 const payload=JSON.stringify({sites:[{key:'a',type:3,api:'csp_A'}],lives:[{url:'http://live.invalid/list',playerType:'01',timeout:11,header:{'User-Agent':'test'}}],hosts:['a=1.2.3.4'],rules:[{host:'a',rule:['yes']}],doh:[{name:'d',url:'https://dns.invalid/query'}],ads:['custom.invalid']});
 let fetches=0;
 const first=createFullSubscriptionLoader({store:new FileSubscriptionStore(directory),fetchText:async()=>{fetches++;return payload;}});
 let before;
 try{assert.equal((await first.load({apiUrl:'http://config.invalid/box'})).ok,true);before=await first.getConfig();}
 finally{await first.close();}
 const second=createFullSubscriptionLoader({store:new FileSubscriptionStore(directory),fetchText:async()=>{throw new Error('must use cache');}});
 try{
  assert.equal((await second.load({useCache:true})).ok,true);const after=await second.getConfig();
  assert.deepEqual(after,before);assert.equal(fetches,1);assert.equal((await second.getState()).livePlayType,'01');assert.equal((await second.getState()).liveConnectTimeout,2);
 }finally{await second.close();rmSync(directory,{recursive:true,force:true});}
});

test('full loader follows collection and fresh parse failures preserve earlier cache',async()=>{
 const store=new MemorySubscriptionStore();let count=0;
 const loader=createFullSubscriptionLoader({store,fetchText:async url=>{
  count++;if(url==='http://config.invalid/collection')return '{urls:[{name:"child",url:"http://config.invalid/child"}]}';
  if(count<=2)return '{sites:[],hosts:["a=b"],rules:[]}';
  return '{sites:[],hosts:["partial=new",null]}';
 }});
 try{
  assert.equal((await loader.load({apiUrl:'http://config.invalid/collection'})).ok,true);
  const before=await store.listCache();assert.equal(Object.keys(before).length,2);
  assert.equal((await loader.load()).message,'配置解析失败');assert.deepEqual(await store.listCache(),before);
  assert.deepEqual((await loader.getConfig()).hosts,{partial:'new'});
 }finally{await loader.close();}
});

test('full loader failed startup closes its owned worker without leaving cleanup resources',async()=>{
 const calls=[];const cleanup=new RuntimeCleanup();cleanup.register('jar',{clear:async()=>calls.push('closed')});
 const loader=createFullSubscriptionLoader({runtimeCleanup:cleanup,store:{readState:async()=>{throw new Error('state failure');}}});
 try{await assert.rejects(loader.load(),/state failure/);}finally{await loader.close();}
 assert.deepEqual(calls,['closed']);
});
