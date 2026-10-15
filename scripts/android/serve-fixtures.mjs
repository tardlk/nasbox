// SPDX-License-Identifier: GPL-3.0-only
// Loopback-only fixture server with an explicit immutable route map.
import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const [captureArg,fixtureArg,portArg='18765']=process.argv.slice(2);
if(!captureArg||!fixtureArg)throw Error('Usage: node serve-fixtures.mjs CAPTURE_DIR FIXTURE_DIR [PORT]');
const capture=resolve(captureArg),fixture=resolve(fixtureArg),plan=JSON.parse(await readFile(resolve(fixture,'oracle-plan.json'),'utf8')),files=new Map();
for(const name of ['oracle-plan.json','product-config.json'])files.set('/'+name,{path:resolve(fixture,name),type:'application/json'});
for(const artifact of plan.artifacts){
 files.set('/artifacts/'+artifact.sha256+'.jar',{path:resolve(capture,artifact.jarPath),type:'application/java-archive',sha256:artifact.sha256});
 for(const site of artifact.sites){
  const main=site.loaderContext?.main;
  if(main)files.set('/artifacts/'+main.sha256+'.jar',{path:resolve(capture,main.jarPath),type:'application/java-archive',sha256:main.sha256});
 }
}
try{
 const routes=JSON.parse(await readFile(resolve(fixture,'parse-routes-private.json'),'utf8'));
 files.set('/parse-plan.json',{path:resolve(fixture,'parse-plan.json'),type:'application/json'});
 for(const route of routes)files.set(route.route,{path:route.path,type:'application/octet-stream',sha256:route.sha256});
}catch(error){if(error.code!=='ENOENT')throw error;}
const counts={};
const server=createServer(async(req,res)=>{
 const entry=files.get(req.url);if(req.method!=='GET'||!entry){res.writeHead(404).end();return;}
 try{const bytes=await readFile(entry.path);if(entry.sha256&&createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw Error('Fixture hash mismatch');counts[req.url]=(counts[req.url]||0)+1;res.writeHead(200,{'Content-Type':entry.type,'Content-Length':bytes.length,'Cache-Control':'no-store'}).end(bytes);}
 catch{res.writeHead(500).end();}
});
server.listen(Number(portArg),'127.0.0.1',()=>console.log(JSON.stringify({port:server.address().port,loopback:true,routes:files.size})));
async function close(){server.closeAllConnections();await new Promise(done=>server.close(done));await writeFile(resolve(fixture,'server-counts.json'),JSON.stringify(counts,null,2)+'\n');}
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{close().then(()=>process.exit(0),()=>process.exit(1));});
