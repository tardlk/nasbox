// SPDX-License-Identifier: GPL-3.0-only
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { buildConfigCore } from '../config-core/index.mjs';
export class CacheLeaseError extends Error { constructor(code) { super(code); this.name='CacheLeaseError'; this.code=code; } }
/** One small JRE helper, no network listener. Its stdin closes if its Node owner dies. */
export async function acquireDirectoryLease(directory) {
  const built=buildConfigCore();
  const child=spawn(built.java,['-Xms8m','-Xmx16m','-cp',built.build,'tvbox.config.DirectoryLease',directory],{stdio:['pipe','pipe','pipe']});
  const lines=createInterface({input:child.stdout});let status, failure, closed=false;
  const waiters=[];
  const next=()=>new Promise((resolve,reject)=>{if(failure)reject(failure);else waiters.push({resolve,reject});});
  function fail(error){failure||=error;for(const w of waiters.splice(0))w.reject(failure);}
  lines.on('line',line=>{status=line;const item=waiters.shift();if(item)item.resolve(line);else fail(new CacheLeaseError('INVALID_CACHE_LEASE_PROTOCOL'));});
  child.on('error',fail);child.stdin.on('error',fail);child.stderr.on('data',()=>{});
  const exit=new Promise(done=>child.once('close',()=>{closed=true;lines.close();fail(new CacheLeaseError('CACHE_LEASE_EXITED'));done();}));
  const timer=setTimeout(()=>{fail(new CacheLeaseError('CACHE_LEASE_TIMEOUT'));child.kill('SIGKILL');},5000);
  try {
    const ready=await next();
    if(ready!=='READY')throw new CacheLeaseError(ready==='BUSY'?'CACHE_ALREADY_OWNED':ready==='IN_USE'?'CACHE_STILL_IN_USE':'CACHE_LEASE_FAILED');
  } catch(error) { child.stdin.end();if(!closed)child.kill('SIGKILL');await exit;throw error; }
  finally {clearTimeout(timer);}
  let closing;
  return {pid:child.pid,guard:directory+'/.users',
    assertAlive(){if(closed||failure)throw new CacheLeaseError('CACHE_LEASE_LOST');},
    close(){closing||=(async()=>{
      if(closed)throw new CacheLeaseError('CACHE_LEASE_LOST');
      const result=next();child.stdin.end('close\n');
      const deadline=setTimeout(()=>{fail(new CacheLeaseError('CACHE_LEASE_TIMEOUT'));child.kill('SIGKILL');},5000);
      try {const reply=await result;await exit;if(reply!=='CLOSED')throw new CacheLeaseError('CACHE_STILL_IN_USE');}
      finally{clearTimeout(deadline);}
    })();return closing;}
  };
}
