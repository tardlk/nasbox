// SPDX-License-Identifier: GPL-3.0-only
import{spawn}from'node:child_process';import{resolve,dirname}from'node:path';import{fileURLToPath}from'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),[command='doctor',...args]=process.argv.slice(2),scripts={doctor:'scripts/container/doctor.mjs',config:'backend/config-core/cli.mjs',subscription:'backend/subscription/cli.mjs',spider:'backend/spider-runtime/cli.mjs',session:'backend/spider-runtime/subscription-cli.mjs','native-source-probe':'scripts/compat/native-source-probe.mjs'};
if(command==='help'||command==='--help'){console.log('tvbox-core doctor | config (JSON-lines stdin) | subscription [--config] URL | session --url URL --source KEY --method METHOD [--native] | spider --native --jar FILE --api CSP --method METHOD --args JSON | native-source-probe URL REPORT');process.exit(0);}
if(!scripts[command])throw new Error('Unknown command: '+command);
if(['subscription','spider','session'].includes(command)&&!args.includes('--data'))args.push('--data',resolve(process.env.TVBOX_DATA_DIR||'/data',command));
const child=spawn(process.execPath,[resolve(root,scripts[command]),...args],{stdio:'inherit'});let signaled;
for(const signal of['SIGTERM','SIGINT'])process.on(signal,()=>{signaled=signal;child.kill(signal);});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});child.on('exit',(code,signal)=>{process.exitCode=code??(signaled==='SIGINT'||signal==='SIGINT'?130:143);});
