// SPDX-License-Identifier: GPL-3.0-only
import{readFileSync,readdirSync,mkdirSync,mkdtempSync,writeFileSync,copyFileSync,existsSync,renameSync,rmSync}from'node:fs';import{resolve,dirname,join,delimiter}from'node:path';import{fileURLToPath}from'node:url';import{createHash}from'node:crypto';import{spawnSync}from'node:child_process';import{nativeToolchain}from'./toolchain.mjs';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../..'),hash=b=>createHash('sha256').update(b).digest('hex');
const files=p=>readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(join(p,e.name)):[join(p,e.name)]).sort();
export function buildNativeProfile(base){
 const tool=nativeToolchain(),manifest=JSON.parse(readFileSync(join(here,'source-manifest.json'),'utf8'));
 for(const item of manifest.files)if(hash(readFileSync(join(root,item.path)))!==item.sha256)throw new Error('WinBox native reference checksum differs: '+item.path);
 const local=files(join(here,'src')),overrides=new Set(local.map(p=>p.slice(join(here,'src').length+1))),fingerprint=hash(JSON.stringify({base:base.build,tool:tool.manifest,manifest,builder:hash(readFileSync(fileURLToPath(import.meta.url))),local:local.map(p=>[p,hash(readFileSync(p))])})),build=join(root,'.cache/backend/native-profile',fingerprint);
 const cp=[base.classpath,...tool.jars,join(root,'.tools/lib/bcprov-jdk18on-1.78.1.jar')].join(delimiter);
 if(!existsSync(join(build,'complete'))){mkdirSync(dirname(build),{recursive:true});const stage=mkdtempSync(join(dirname(build),'build-')),src=join(stage,'source'),classes=join(stage,'classes');mkdirSync(src);mkdirSync(classes);const sources=[];
 try{
  for(const item of manifest.files){const original=join(root,item.path);let relative;
   if(item.path.includes('/native-bridge/com/'))relative=item.path.split('/native-bridge/')[1];
   else if(item.path.includes('/jvm/tools/'))relative=item.path.split('/tools/')[1];
   else{relative=item.path.split('/stubs-src/')[1];if(['dalvik/system/BaseDexClassLoader.java','dalvik/system/DexClassLoader.java'].includes(relative)||relative.startsWith('shell-shim/')||relative.startsWith('com/github/catvod/spider/')||relative.startsWith('org/json/')||relative.startsWith('com/github/catvod/crawler/')||relative==='com/github/catvod/Proxy.java')continue;}
   if(overrides.has(relative))continue;
   let source=readFileSync(original,'utf8');
   // Android owns LayoutParams on ViewGroup, not View. The original stub's
   // inherited nested class changes descriptors and fails real payload verification.
   if(relative==='android/view/View.java'){
    const start=source.indexOf('    /** 布局参数基类 */');
    if(start<0)throw new Error('View layout patch location differs');
    source=source.slice(0,start)+'}\n';
    source=source.replace(/\bLayoutParams\b/g,'ViewGroup.LayoutParams');
   }
   if(relative==='android/view/ViewGroup.java'){
    const view=readFileSync(join(root,'resources/jvm/stubs-src/android/view/View.java'),'utf8');
    const params=view.slice(view.indexOf('    /** 布局参数基类 */'),view.lastIndexOf('}'));
    source=source.slice(0,source.lastIndexOf('}'))+params+'}\n';
   }
   if(relative==='android/widget/LinearLayout.java')source=source.replace('extends android.view.ViewGroup.LayoutParams','extends android.view.ViewGroup.MarginLayoutParams');
   if(relative==='android/content/Context.java')source=source.replace('new File(System.getProperty("java.io.tmpdir"), "tvbox-win")','new File(System.getProperty("tvbox.native.data"))').replace('return "com.github.tvbox.osc";','return tvbox.runtime.HostServices.packageName;').replace('SharedPreferences.Mem.get(name == null ? "default" : name)','tvbox.runtime.NativePreferences.get(name == null ? "default" : name)');
   if(relative==='android/content/res/AssetManager.java')source=source.replace('ClassLoader cl = getClass().getClassLoader();','ClassLoader cl = com.github.tvbox.osc.base.App.getInstance().getClassLoader();');
   if(relative==='dalvik/system/PathClassLoader.java')source=source.replace(/ClassLoader parent\)\s*\{/g,'ClassLoader parent) throws java.io.IOException {');
   if(relative.endsWith('/BridgeFileSystem.java')){
    const start=source.indexOf('        if (!normalized.matches('),end=source.indexOf('        try {',start);
    if(start<0||end<0)throw new Error('Native filesystem patch location differs');
    source=source.slice(0,start)+`        if (normalized.startsWith("//") || normalized.matches("^/?[a-zA-Z]:/.*")) return DENIED;
        if (sandbox == null || !normalized.startsWith("/")) return null;
        // Only explicit host data paths share storage. Other POSIX paths stay in rootfs.
        String sandboxPath=sandbox.toPath().toAbsolutePath().normalize().toString();
        boolean explicit=normalized.equals(sandboxPath)||normalized.startsWith(sandboxPath+"/");
        if (!explicit && (normalized.startsWith("/data/data/") || normalized.startsWith("/data/user/"))) return null;
        String parent=sandbox.toPath().toAbsolutePath().normalize().getParent().toString();
        if (!normalized.equals(parent) && !normalized.startsWith(parent+"/")) return null;
`+source.slice(end);
   }
   if(relative==='JarRewriter.java'){
    source=source.replace('extra.split(";")','extra.split(java.util.regex.Pattern.quote(java.io.File.pathSeparator))');
    source=source.replace('reader.accept(new ClassVisitor(Opcodes.ASM9, writer) {\n        }, readerFlag);',`reader.accept(new ClassVisitor(Opcodes.ASM9, writer) {
         public org.objectweb.asm.MethodVisitor visitMethod(int access,String name,String descriptor,String signature,String[] exceptions){
          return new org.objectweb.asm.MethodVisitor(Opcodes.ASM9,super.visitMethod(access,name,descriptor,signature,exceptions)){
           private int allocated;
           public void visitTypeInsn(int opcode,String type){if(opcode==Opcodes.NEW && type.equals("java/net/ServerSocket")){allocated++;type="tvbox/runtime/NativeResources$OwnedServerSocket";}super.visitTypeInsn(opcode,type);}
           public void visitMethodInsn(int opcode,String owner,String name,String descriptor,boolean itf){
            if(opcode==Opcodes.INVOKESPECIAL && owner.equals("java/net/ServerSocket") && name.equals("<init>") && allocated>0){allocated--;owner="tvbox/runtime/NativeResources$OwnedServerSocket";}
            super.visitMethodInsn(opcode,owner,name,descriptor,itf);
            if(name.equals("createServerSocket") && descriptor.endsWith(")Ljava/net/ServerSocket;"))super.visitMethodInsn(Opcodes.INVOKESTATIC,"tvbox/runtime/NativeResources","track","(Ljava/net/ServerSocket;)Ljava/net/ServerSocket;",false);
           }
          };
         }
        }, readerFlag);`);
   }
   if(relative==='android/preference/PreferenceManager.java')source=source.replace('SharedPreferences.Mem.get("default")','context.getSharedPreferences("default",0)');
   if(relative.endsWith('/BridgeARM32Emulator.java')){
    source=source.replace('new RegistrationKey(fd, target)','new RegistrationKey(fd, ((CounterFile)target).state)').replace('new Registration(target, mask','new Registration((CounterFile)target, mask').replace('final AndroidFileIO file;','final CounterFile file;').replace('Registration(AndroidFileIO file,','Registration(CounterFile file,');
    const a=source.indexOf('                boolean readable = file instanceof CounterFile'),b=source.indexOf('                if ((mask & 1)',a);if(a<0||b<0)throw new Error('ARM32 eventfd patch location differs');
    source=source.slice(0,a)+'                boolean readable=file.canRead(),writable=file.state.value!=CounterFile.MAX;\n                long readNow=file.state.readEpoch,writeNow=file.state.writeEpoch;\n'+source.slice(b);
   }
   if(relative.endsWith('/NativeBridge.java')){
    const a=source.indexOf('        // ★★ 2026-09-28（实测'),b=source.indexOf('        File src = new File(key);',a);
    if(a<0||b<0)throw new Error('Native payload policy patch location differs');
    source=source.slice(0,a)+source.slice(b);
    source=source.replace('PAYLOAD_LIBS.put(key, "文件不存在");','throw new UnsatisfiedLinkError("Native payload not found: "+key); /*').replace('载荷库文件不存在（跳过装载）: " + key);\n            return;','载荷库文件不存在（跳过装载）: " + key);\n            return; */');
    source=source.replace('            warnNullGuardResult(className, method, r);','            tvbox.runtime.NativeHost.observed(className,method,r);\n            warnNullGuardResult(className, method, r);');
   }
   if(relative.endsWith('/DexJarRepair.java')){const a=source.indexOf('    private static boolean baksmali('),b=source.indexOf('\n    /** class#',a);source=source.slice(0,a)+`    private static boolean baksmali(File dex, File outDir, String javaExe, String d2jCp) {try{tvbox.runtime.DexArtifacts.baksmali(dex.toPath(),outDir.toPath());return true;}catch(Throwable e){throw new IllegalStateException("In-process baksmali failed",e);}}\n`+source.slice(b);}
   const target=join(src,relative);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,source);sources.push(target);
  }
  for(const path of local.filter(p=>p.endsWith('.java'))){const target=join(src,path.slice(join(here,'src').length+1));mkdirSync(dirname(target),{recursive:true});copyFileSync(path,target);sources.push(target);}
  const r=spawnSync(join(base.javaHome,'bin/javac'),['--release','17','-encoding','UTF-8','-cp',cp,'-d',classes,...sources],{encoding:'utf8',timeout:60000,maxBuffer:2*1024*1024});if(r.error||r.status!==0)throw new Error('Native profile compile failed: '+(r.error||r.stderr));
  writeFileSync(join(classes,'complete'),fingerprint);try{renameSync(classes,build);}catch(e){if(!existsSync(join(build,'complete')))throw e;}
 }finally{rmSync(stage,{recursive:true,force:true});}}
 return{...base,build,classpath:[build,cp].join(delimiter),nativeToolchain:tool,fingerprint};
}
