// SPDX-License-Identifier: GPL-3.0-only
import test from'node:test';import assert from'node:assert/strict';
import{mkdtempSync,rmSync,readFileSync,writeFileSync,mkdirSync}from'node:fs';import{tmpdir}from'node:os';import{join,resolve,delimiter}from'node:path';import{spawnSync}from'node:child_process';import{createHash}from'node:crypto';
import{buildSpiderRuntime,createSpiderRuntime}from'../backend/spider-runtime/index.mjs';import{buildNativeProfile}from'../backend/spider-runtime/native-bridge/build.mjs';
const root=resolve(import.meta.dirname,'..'),enabled=process.env.TVBOX_TEST_NATIVE==='1';
test('WinBox native reference source pins remain unchanged',()=>{const m=JSON.parse(readFileSync(join(root,'backend/spider-runtime/native-bridge/source-manifest.json')));for(const f of m.files)assert.equal(createHash('sha256').update(readFileSync(join(root,f.path))).digest('hex'),f.sha256,f.path);});
test('optional ARM/JNI profile: host contracts, syscall execution, storage, cleanup',{skip:!enabled,timeout:120000},async()=>{
 const b=buildNativeProfile(buildSpiderRuntime()),dir=mkdtempSync(join(tmpdir(),'tvbox-native-test-'));mkdirSync(join(dir,'tmp'));const cp=[dir,b.classpath].join(delimiter);
 function run(exe,args,timeout=25000){const r=spawnSync(exe,args,{cwd:dir,encoding:'utf8',timeout,maxBuffer:2*1024*1024});assert.equal(r.error,undefined,String(r.error));assert.equal(r.status,0,r.stderr);return r.stdout;}
 try{
  writeFileSync(join(dir,'NativeHostProbe.java'),readFileSync(join(root,'compat/fixtures/native-host-probe.java.txt')));
  mkdirSync(join(dir,'plugin'));writeFileSync(join(dir,'PluginSockets.java'),readFileSync(join(root,'compat/fixtures/native-sockets.java.txt')));
  run(join(b.javaHome,'bin/javac'),['--release','8','-d',join(dir,'plugin'),join(dir,'PluginSockets.java')]);
  run(join(b.javaHome,'bin/jar'),['--create','--file',join(dir,'plugin.jar'),'-C',join(dir,'plugin'),'.']);
  run(b.java,['-cp',b.classpath,'JarRewriter',join(dir,'plugin.jar'),join(dir,'rewritten.jar'),b.classpath]);
  const sources=['ArmEventfdProbe','ArmSignalProbe','SQLiteProbe'].map(n=>join(root,'tests/fixtures/jvm-native',n+'.java'));
  // POSIX variant of the pinned WinBox filesystem fixture exercises real symlinks.
  let fs=readFileSync(join(root,'tests/fixtures/jvm-native/BridgeFileSystemProbe.java'),'utf8').replace("if (File.separatorChar == '\\\\')",'if (true)');
  fs=fs.replace('"/" + directory,','directory,').replace('"/" + directory.replace','directory.replace');
  const a=fs.indexOf('                Process mklink ='),z=fs.indexOf('                try { check(fs.open(new File(link',a);
  fs=fs.slice(0,a)+'                Files.createSymbolicLink(link.toPath(),external.toPath());\n'+fs.slice(z);
  fs=fs.replace('        System.out.println("bridge-files-ok");',`        System.setProperty("tvbox.spiderCacheDir","/data/android");
        try (BridgeARM32Emulator guest = new BridgeARM32Emulator("fixture.docker-paths",new File(args[0],"docker-rootfs"),Collections.singletonList(new Unicorn2Factory(true)))) {
            check(guest.getFileSystem().mkdir("/data/data/fixture/files",0700),"Android guest /data/data is not a host /data mount");
            check(new File(guest.getFileSystem().getRootDir(),"data/data/fixture/files").isDirectory(),"guest storage stays in owned rootfs");
        }
        System.out.println("bridge-files-ok");`);writeFileSync(join(dir,'BridgeFileSystemProbe.java'),fs);
  run(join(b.javaHome,'bin/javac'),['--release','17','-cp',b.classpath,'-d',dir,join(dir,'NativeHostProbe.java'),join(dir,'BridgeFileSystemProbe.java'),...sources]);
  const flags=['-Dtvbox.native.enabled=true','-Dtvbox.native.data='+join(dir,'android'),'-Djava.io.tmpdir='+join(dir,'tmp'),'-cp',cp];
  assert.match(run(b.java,[...flags,'NativeHostProbe',dir]),/native-host-ok/);assert.match(run(b.java,[...flags,'NativeHostProbe',dir,'restore']),/native-preferences-restored/);
  for(const name of ['ArmSignalProbe','ArmEventfdProbe','BridgeFileSystemProbe','SQLiteProbe']){const data=join(dir,name);mkdirSync(data);assert.match(run(b.java,[...flags,name,data],40000),/-ok/);}
  const worker=createSpiderRuntime({nativeBridge:true,timeoutMs:15000});try{assert.equal(await worker.request({operation:'nativeProbe'}),42);const initial=await worker.request({operation:'nativeState'});assert.equal(initial.extraLoaders,0);await worker.setModules({modules:{'https://fixture.invalid/reset.js':'export default {init(){},home(){return \"{\\\"class\\\":[]}\";}};'}});const source={key:'reset',type:3,api:'https://fixture.invalid/reset.js',ext:'',jar:''};const before=await worker.getCSP(source);await worker.clear('jar');const cleared=await worker.request({operation:'nativeState'});assert.notEqual(initial.workerPid,cleared.workerPid);assert.equal(cleared.listeners,0);const after=await worker.getCSP(source);assert.equal(after.ready,true);assert.notEqual(before.token,after.token);await assert.rejects(worker.call(before.token,'homeContent',[true]),/cleared Spider token/);assert.equal(await worker.call(after.token,'homeContent',[true]),'{"class":[]}');}finally{const start=Date.now();await worker.close();assert.ok(Date.now()-start<5000,'worker exits after cleanup');}
 }finally{rmSync(dir,{recursive:true,force:true});}
});
