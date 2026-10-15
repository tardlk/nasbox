// SPDX-License-Identifier: GPL-3.0-only
import{readFileSync,readdirSync,mkdirSync,mkdtempSync,writeFileSync,copyFileSync,existsSync,renameSync,rmSync}from'node:fs';import{resolve,dirname,join,delimiter}from'node:path';import{fileURLToPath}from'node:url';import{createHash}from'node:crypto';import{spawnSync}from'node:child_process';import{nativeToolchain}from'./toolchain.mjs';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../..'),hash=b=>createHash('sha256').update(b).digest('hex');
const files=p=>readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(join(p,e.name)):[join(p,e.name)]).sort();
function bridgeGate(source){
 const unique=(text)=>{const i=source.indexOf(text);if(i<0||source.indexOf(text,i+text.length)>=0)throw new Error('Native bridge gate patch location differs: '+text);return i;};
 // Keep separate VM locks: the guard may wait for a Java thread whose payload
 // native call must run concurrently. Lifecycle tracking only excludes close.
 const signatures=[
  'static synchronized void ensureInit() throws Exception',
  'public static synchronized void init(File jar, File workDir, ClassLoader resolver) throws Exception',
  'private static synchronized void initWithSo(File jar, File workDir, ClassLoader resolver, File dynamicSo) throws Exception',
  'public static Object invoke(String className, String method, String desc, Object[] args)',
  'public static Object invokePayload(String className, String method, String desc, Object[] args)',
  'private static synchronized String payloadLibsSummary()',
  'private static synchronized void payloadLoad(String path) throws Exception',
  'private static synchronized void ensurePayloadVm() throws Exception',
 ];
 for(const signature of signatures){
  const start=unique(signature+' {'),open=start+signature.length+1;let depth=1,state='code',end=-1;
  for(let i=open+1;i<source.length;i++){
   const c=source[i],n=source[i+1];
   if(state==='line'){if(c==='\n')state='code';continue;}
   if(state==='block'){if(c==='*'&&n==='/'){state='code';i++;}continue;}
   if(state==='string'||state==='char'){if(c==='\\')i++;else if(c===(state==='string'?'"':"'"))state='code';continue;}
   if(c==='/'&&n==='/'){state='line';i++;}else if(c==='/'&&n==='*'){state='block';i++;}
   else if(c==='"')state='string';else if(c==="'")state='char';
   else if(c==='{')depth++;else if(c==='}'&&--depth===0){end=i;break;}
  }
  if(end<0)throw new Error('Native bridge gate method end differs: '+signature);
  source=source.slice(0,open+1)+' tvbox.runtime.NativeLifecycle.enter(); try {'+source.slice(open+1,end)+'} finally { tvbox.runtime.NativeLifecycle.leave(); } '+source.slice(end);
 }
 const initialized='        if (inited) return;';unique(initialized);source=source.replace(initialized,initialized+'\n        if (lazyJar == null || lazyWork == null || lazyResolver == null) throw new IllegalStateException("NATIVE_BRIDGE_CLOSED");');
 return source;
}
function patchPaintAbi(javaHome,classes,classpath,stage){
 // Java source cannot express both legacy TextPaint's void setter and the real
 // Android Paint return descriptor. JVM method descriptors include return types.
 const helper=join(stage,'PaintAbiPatch.java');
 writeFileSync(helper,`import java.nio.file.*;import org.objectweb.asm.*;
public class PaintAbiPatch {
 public static void main(String[] args)throws Exception {
  Path path=Path.of(args[0]);byte[] bytes=Files.readAllBytes(path);ClassReader reader=new ClassReader(bytes);ClassWriter writer=new ClassWriter(0);int[] found={0};
  reader.accept(new ClassVisitor(Opcodes.ASM9,writer){public MethodVisitor visitMethod(int access,String name,String desc,String signature,String[] exceptions){
   if(name.equals("setTypefaceForRaster")){if(!desc.equals("(Landroid/graphics/Typeface;)Landroid/graphics/Typeface;"))throw new IllegalStateException("Paint ABI source descriptor differs");found[0]++;name="setTypeface";}
   else if(name.equals("setTypeface"))throw new IllegalStateException("Unexpected preexisting Paint setter");
   return super.visitMethod(access,name,desc,signature,exceptions);
  }},0);
  if(found[0]!=1)throw new IllegalStateException("Paint ABI patch expected exactly one method");
  Files.write(path,writer.toByteArray());
 }
}`);
 const run=(command,args)=>{const result=spawnSync(join(javaHome,'bin',command),args,{encoding:'utf8',timeout:30000,maxBuffer:1024*1024});if(result.error||result.status!==0)throw new Error('Paint ABI patch failed: '+(result.error||result.stderr));};
 run('javac',['--release','17','-cp',classpath,'-d',stage,helper]);
 run('java',['-Xverify:all','-cp',[stage,classpath].join(delimiter),'PaintAbiPatch',join(classes,'android/graphics/Paint.class')]);
}
export function buildNativeProfile(base){
 const tool=nativeToolchain(),manifest=JSON.parse(readFileSync(join(here,'source-manifest.json'),'utf8'));
 for(const item of manifest.files)if(hash(readFileSync(join(root,item.path)))!==item.sha256)throw new Error('WinBox native reference checksum differs: '+item.path);
 const local=files(join(here,'src')),overrides=new Set(local.map(p=>p.slice(join(here,'src').length+1))),fingerprint=hash(JSON.stringify({base:base.build,tool:tool.manifest,manifest,builder:hash(readFileSync(fileURLToPath(import.meta.url))),local:local.map(p=>[p,hash(readFileSync(p))])})),build=join(root,'.cache/backend/native-profile',fingerprint);
 const cp=[base.classpath,...tool.jars,join(root,'.tools/lib/bcprov-jdk18on-1.78.1.jar')].join(delimiter);
 if(!existsSync(join(build,'complete'))){if(process.env.TVBOX_PREBUILT_ONLY==='1')throw new Error('Prebuilt native profile missing; rebuild the image');mkdirSync(dirname(build),{recursive:true});const stage=mkdtempSync(join(dirname(build),'build-')),src=join(stage,'source'),classes=join(stage,'classes');mkdirSync(src);mkdirSync(classes);const sources=[];
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
    source=bridgeGate(source);
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
  patchPaintAbi(base.javaHome,classes,cp,stage);
  writeFileSync(join(classes,'complete'),fingerprint);try{renameSync(classes,build);}catch(e){if(!existsSync(join(build,'complete')))throw e;}
 }finally{rmSync(stage,{recursive:true,force:true});}}
 return{...base,build,classpath:[build,cp].join(delimiter),nativeToolchain:tool,fingerprint};
}
