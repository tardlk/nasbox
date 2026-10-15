// SPDX-License-Identifier: GPL-3.0-only
// Build a fixed-byte ART/NAS test plan without executing subscribed code.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const sha=value=>createHash('sha256').update(value).digest('hex');
const [captureArg,outputArg,baseArg='http://10.0.2.2:18765']=process.argv.slice(2);
if(!captureArg||!outputArg)throw Error('Usage: node prepare-fixtures.mjs CAPTURE_DIR OUTPUT_DIR [EMULATOR_BASE]');
const capture=resolve(captureArg),output=resolve(outputArg),read=async file=>JSON.parse(await readFile(resolve(capture,file),'utf8'));
const priority=await read('android-priority.json'),manifest=await read('input-manifest.json'),artifacts=[];
for(const sample of priority.samples){
 const artifact=manifest.artifacts.find(a=>a.sha256===sample.sha256),sites=[];
 if(!artifact)throw Error('Priority input missing');
 const bytes=await readFile(resolve(capture,artifact.jarPath));if(sha(bytes)!==sample.sha256)throw Error('Priority input hash differs');
 for(const candidate of sample.candidates){
  const reference=candidate.references[0],config=await read('captures/'+reference.captureId+'/config.json');
  const site=config.sites.find(s=>s.key===reference.siteKey&&s.api===candidate.api);
  if(!site)throw Error('Captured site missing');
  const ext=site.ext||'';if(typeof ext!=='string')throw Error('Config parser must normalize ext first');
  sites.push({key:site.key,api:site.api,ext,extSha256:sha(ext),type:3,jar:'',configSha256:sha(await readFile(resolve(capture,'captures/'+reference.captureId+'/config.json'))),captureId:reference.captureId});
 }
 artifacts.push({id:sample.sha256,sha256:sample.sha256,jarPath:sample.jarPath,jarUrl:baseArg+'/artifacts/'+sample.sha256+'.jar',family:sample.family,sites});
}
const plan={schemaVersion:1,artifacts};
await mkdir(output,{recursive:true});
await writeFile(resolve(output,'oracle-plan.json'),JSON.stringify(plan,null,2)+'\n',{mode:0o600});
const first=artifacts.find(a=>a.sites.some(s=>s.key==='Aid')),site=first.sites.find(s=>s.key==='Aid');
const config={spider:first.jarUrl,sites:[{key:site.key,name:'Fixed captured Aid fixture',api:site.api,type:3,ext:site.ext,searchable:1,quickSearch:1,filterable:1}]};
await writeFile(resolve(output,'product-config.json'),JSON.stringify(config)+'\n',{mode:0o600});
const pins={schemaVersion:1,planSha256:sha(await readFile(resolve(output,'oracle-plan.json'))),productConfigSha256:sha(await readFile(resolve(output,'product-config.json'))),transform:'Controlled one-site product fixture from normalized original source. Only JAR URL points to the local hash-checked capture; exact API/key/ext preserved. Not the original subscription body.',artifacts:artifacts.map(a=>({sha256:a.sha256,sites:a.sites.map(s=>({key:s.key,api:s.api,extSha256:s.extSha256,configSha256:s.configSha256}))}))};
await writeFile(resolve(output,'fixture-pins.json'),JSON.stringify(pins,null,2)+'\n');
console.log(JSON.stringify({artifacts:artifacts.length,sites:artifacts.reduce((n,a)=>n+a.sites.length,0),planSha256:pins.planSha256}));
