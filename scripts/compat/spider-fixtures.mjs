import{readdirSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync,existsSync}from'node:fs';import{resolve,join}from'node:path';import{spawnSync}from'node:child_process';import{buildSpiderRuntime}from'../../backend/spider-runtime/build.mjs';import{root}from'./reference.mjs';
function files(path){return readdirSync(path,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(join(path,e.name)):[join(path,e.name)]);}
export function buildSpiderFixtures(built=buildSpiderRuntime()){
 const base=resolve(root,'.cache/compat/spider-fixtures');mkdirSync(base,{recursive:true});const build=mkdtempSync(join(base,'run-'));const classes=join(build,'classes');mkdirSync(classes);
 const compile=spawnSync(join(built.javaHome,'bin/javac'),['--release','17','-encoding','UTF-8','-cp',built.classpath,'-d',classes,...files(resolve(root,'compat/spiders/java')).filter(p=>p.endsWith('.java'))],{encoding:'utf8',timeout:30000});if(compile.status!==0)throw new Error(compile.stderr);
 mkdirSync(join(classes,'assets'));writeFileSync(join(classes,'assets/value.txt'),'fixture-resource');const jar=join(build,'fixture.jar');
 const pack=spawnSync(join(built.javaHome,'bin/jar'),['--create','--file',jar,'-C',classes,'.'],{encoding:'utf8',timeout:30000});if(pack.status!==0)throw new Error(pack.stderr);
 const modules=Object.fromEntries(files(resolve(root,'compat/spiders/js')).map(path=>['https://fixture.invalid/'+path.split('/').at(-1),readFileSync(path,'utf8')]));
 return{jar,modules,build,built};
}
