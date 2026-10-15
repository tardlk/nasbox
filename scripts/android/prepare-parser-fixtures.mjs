// SPDX-License-Identifier: GPL-3.0-only
// Capture original response byte routes, preserving the original configured URL.
import{readFile,writeFile,mkdir}from'node:fs/promises';import{resolve}from'node:path';import{createHash}from'node:crypto';
const [captureArg,fixtureArg,base='http://10.0.2.2:18765']=process.argv.slice(2);if(!captureArg||!fixtureArg)throw Error('Usage: node prepare-parser-fixtures.mjs CAPTURE_DIR FIXTURE_DIR [BASE]');
const capture=resolve(captureArg),fixture=resolve(fixtureArg),inventory=JSON.parse(await readFile(resolve(capture,'inventory.json'),'utf8')),configs=[],routes=[];
const sha=b=>createHash('sha256').update(b).digest('hex');
for(const name of ['饭太硬','嗷呜','王二小','夏夏影视','宝盒2线','天神']){
 const entry=inventory.entries.find(e=>e.publicName===name);if(!entry)throw Error('Capture missing');
 const response=entry.responses[0],path=resolve(capture,'captures',entry.id,response.file),bytes=await readFile(path);if(sha(bytes)!==response.sha256)throw Error('Raw capture differs');
 const route='/raw/'+entry.id+'.bin';routes.push({route,path,sha256:response.sha256});
 configs.push({id:entry.id,publicName:name,apiUrl:entry.selectedUrl||entry.attempts[0].apiUrl,rawUrl:base+route,rawSha256:response.sha256});
}
await mkdir(fixture,{recursive:true});await writeFile(resolve(fixture,'parse-plan.json'),JSON.stringify({schemaVersion:1,configs},null,2)+'\n',{mode:0o600});
await writeFile(resolve(fixture,'parse-routes-private.json'),JSON.stringify(routes,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify({configs:configs.length,planSha256:sha(await readFile(resolve(fixture,'parse-plan.json')))}));
