// SPDX-License-Identifier: GPL-3.0-only
// Owned Java/ASM fixtures only. No remote/provider artifact or ARM code executes.
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,delimiter} from 'node:path';
import {spawnSync} from 'node:child_process';
import {buildSpiderRuntime} from '../backend/spider-runtime/build.mjs';
import {buildNativeProfile} from '../backend/spider-runtime/native-bridge/build.mjs';

const enabled=process.env.TVBOX_TEST_NATIVE==='1';
let directory,built;
function run(executable,args,timeout=60000){
 const result=spawnSync(executable,args,{encoding:'utf8',timeout,maxBuffer:2*1024*1024});
 assert.equal(result.error,undefined,String(result.error));assert.equal(result.status,0,result.stderr+'\n'+result.stdout);
 return result.stdout;
}
function setup(){
 if(built)return;
 built=buildNativeProfile(buildSpiderRuntime());directory=mkdtempSync(join(tmpdir(),'tvbox-opaque-native-'));
 writeFileSync(join(directory,'OpaqueNativeProbe.java'),fixture);
 run(join(built.javaHome,'bin/javac'),['--release','17','-encoding','UTF-8','-cp',built.classpath,'-d',directory,join(directory,'OpaqueNativeProbe.java')]);
}
function probe(mode){setup();return run(built.java,['-Xverify:all','-Dtvbox.native.enabled=true','-cp',directory+delimiter+built.classpath,'OpaqueNativeProbe',directory,mode]);}
after(()=>{if(directory)rmSync(directory,{recursive:true,force:true});});

test('native scan preserves opaque .class resources and exposes a real class format failure on demand',{skip:!enabled,timeout:120000},()=>{
 assert.match(probe('opaque'),/opaque-class-preserved/);
});
test('valid static native methods beside opaque resources remain detected and patched',{skip:!enabled,timeout:120000},()=>{
 assert.match(probe('native'),/native-class-patched/);
});
test('readable library-name loads retain strict failures while native-only declarations stay untouched',{skip:!enabled,timeout:120000},()=>{
 assert.match(probe('unsupported'),/unsupported-native-rejected/);
});
test('opaque classification does not hide corrupt archives or readable-class path violations',{skip:!enabled,timeout:120000},()=>{
 assert.match(probe('io'),/archive-and-path-errors-preserved/);
});

const fixture=String.raw`
import java.io.*;import java.nio.file.*;import java.net.*;import java.lang.reflect.*;import java.util.*;import java.util.jar.*;import org.objectweb.asm.*;import tvbox.runtime.*;
public final class OpaqueNativeProbe {
 static final byte[] OPAQUE={1,2,3,4,5};
 static final byte[] TRUNCATED={(byte)0xca,(byte)0xfe,(byte)0xba,(byte)0xbe,0,0,0,52,0,3,1,0};
 static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
 static byte[] ordinary(String owner,int nativeAccess,boolean namedLoad){
  ClassWriter writer=new ClassWriter(0);writer.visit(Opcodes.V1_8,Opcodes.ACC_PUBLIC,owner,null,"java/lang/Object",null);
  MethodVisitor constructor=writer.visitMethod(Opcodes.ACC_PUBLIC,"<init>","()V",null,null);constructor.visitCode();constructor.visitVarInsn(Opcodes.ALOAD,0);constructor.visitMethodInsn(Opcodes.INVOKESPECIAL,"java/lang/Object","<init>","()V",false);constructor.visitInsn(Opcodes.RETURN);constructor.visitMaxs(1,1);constructor.visitEnd();
  if(nativeAccess!=0)writer.visitMethod(Opcodes.ACC_PUBLIC|Opcodes.ACC_NATIVE|nativeAccess,"value","()I",null,null).visitEnd();
  if(namedLoad){MethodVisitor method=writer.visitMethod(Opcodes.ACC_PUBLIC|Opcodes.ACC_STATIC,"load","()V",null,null);method.visitCode();method.visitLdcInsn("fixture-missing-library");method.visitMethodInsn(Opcodes.INVOKESTATIC,"java/lang/System","loadLibrary","(Ljava/lang/String;)V",false);method.visitInsn(Opcodes.RETURN);method.visitMaxs(1,0);method.visitEnd();}
  MethodVisitor plain=writer.visitMethod(Opcodes.ACC_PUBLIC|Opcodes.ACC_STATIC,"plain","()Ljava/lang/String;",null,null);plain.visitCode();plain.visitLdcInsn("untouched");plain.visitInsn(Opcodes.ARETURN);plain.visitMaxs(1,0);plain.visitEnd();writer.visitEnd();return writer.toByteArray();
 }
 static Path jar(Path root,String name,Map<String,byte[]> entries)throws Exception{
  Path path=root.resolve(name);try(JarOutputStream jar=new JarOutputStream(Files.newOutputStream(path))){for(var entry:entries.entrySet()){jar.putNextEntry(new JarEntry(entry.getKey()));jar.write(entry.getValue());jar.closeEntry();}}return path;
 }
 static void expectOpaque(Path input)throws Exception{
  try(URLClassLoader loader=new URLClassLoader(new URL[]{input.toUri().toURL()},OpaqueNativeProbe.class.getClassLoader())){
   try{Class.forName("fixture.Opaque",false,loader);throw new AssertionError("opaque entry falsely became a class");}catch(ClassFormatError expected){}
   try(InputStream in=loader.getResourceAsStream("fixture/Opaque.class")){check(Arrays.equals(OPAQUE,in.readAllBytes()),"opaque resource bytes");}
  }
 }
 public static void main(String[] args)throws Exception{
  Path root=Files.createTempDirectory(Path.of(args[0]),"case-");HostServices.directory=root.toFile();HostServices.networkDisabled=true;System.setProperty("tvbox.native.data",root.resolve("android").toString());
  try{
   if(args[1].equals("opaque")){
    check(!VerifiedJarRepair.isReadableClass(OPAQUE),"opaque classification");check(!VerifiedJarRepair.isReadableClass(TRUNCATED),"truncated classification");
    byte[] normal=ordinary("fixture/Plain",0,false);check(VerifiedJarRepair.isReadableClass(normal),"readable classification");
    Path input=jar(root,"opaque.jar",Map.of("fixture/Opaque.class",OPAQUE,"fixture/Truncated.class",TRUNCATED,"fixture/Plain.class",normal));byte[] before=Files.readAllBytes(input);
    check(!DynamicNativeSupport.needsBridge(input),"opaque resource did not request native bridge");expectOpaque(input);check(Arrays.equals(before,Files.readAllBytes(input)),"input archive changed");System.out.println("opaque-class-preserved");
   }else if(args[1].equals("native")){
    byte[] nativeClass=ordinary("fixture/Native",Opcodes.ACC_STATIC,false);
    byte[] pathLoader=ordinary("fixture/PathLoader",0,true);
    // Replace loadLibrary with the supported load(String) in this owned class.
    ClassReader pathReader=new ClassReader(pathLoader);ClassWriter pathWriter=new ClassWriter(0);pathReader.accept(new ClassVisitor(Opcodes.ASM9,pathWriter){public MethodVisitor visitMethod(int access,String name,String desc,String sig,String[]exceptions){return new MethodVisitor(Opcodes.ASM9,super.visitMethod(access,name,desc,sig,exceptions)){public void visitMethodInsn(int op,String owner,String name,String desc,boolean itf){super.visitMethodInsn(op,owner,name.equals("loadLibrary")?"load":name,desc,itf);}};}},0);pathLoader=pathWriter.toByteArray();
    Path input=jar(root,"native.jar",Map.of("fixture/Opaque.class",OPAQUE,"fixture/Truncated.class",TRUNCATED,"fixture/Native.class",nativeClass,"fixture/PathLoader.class",pathLoader));byte[] before=Files.readAllBytes(input);
    check(DynamicNativeSupport.needsBridge(input),"valid native detection");Path work=root.resolve("native/work");
    try(URLClassLoader resolver=new URLClassLoader(new URL[]{input.toUri().toURL()},OpaqueNativeProbe.class.getClassLoader())){
     Path patched=DynamicNativeSupport.prepare(input,work,resolver);check(Files.isRegularFile(patched.resolve("fixture/Native.class")),"native patch missing");
     try(URLClassLoader loader=new URLClassLoader(new URL[]{patched.toUri().toURL(),input.toUri().toURL()},OpaqueNativeProbe.class.getClassLoader())){
      Class<?> type=Class.forName("fixture.Native",false,loader);check(!Modifier.isNative(type.getMethod("value").getModifiers()),"native method was skipped");check(type.getMethod("plain").invoke(null).equals("untouched"),"ordinary method changed");
     }
    }finally{NativeHost.close();DynamicNativeSupport.close();}
    expectOpaque(input);check(Arrays.equals(before,Files.readAllBytes(input)),"native input archive changed");
    if(Files.isDirectory(work))try(var paths=Files.list(work)){check(paths.noneMatch(path->path.getFileName().toString().startsWith("dynamic-")),"temporary patch retained");}System.out.println("native-class-patched");
   }else if(args[1].equals("unsupported")){
    // ACC_FINAL is only a nonzero marker here: no ACC_STATIC means instance native.
    for(boolean namedLoad:new boolean[]{false,true}){
     Path input=jar(root,namedLoad?"named.jar":"instance.jar",Map.of("fixture/Opaque.class",OPAQUE,"fixture/Native.class",ordinary("fixture/Native",namedLoad?Opcodes.ACC_STATIC:Opcodes.ACC_FINAL,namedLoad)));
     if(!namedLoad){check(!DynamicNativeSupport.needsBridge(input),"native declaration alone requested a bridge");continue;}
     check(DynamicNativeSupport.needsBridge(input),"library-name load was skipped");
     try(URLClassLoader resolver=new URLClassLoader(new URL[]{input.toUri().toURL()},OpaqueNativeProbe.class.getClassLoader())){
      try{DynamicNativeSupport.prepare(input,root.resolve("native/work"),resolver);throw new AssertionError("unsupported native falsely accepted");}catch(IOException expected){check(expected.getMessage().startsWith("DYNAMIC_NATIVE_UNSUPPORTED:"),"unsupported native error changed");}
     }
    }System.out.println("unsupported-native-rejected");
   }else if(args[1].equals("io")){
    Path invalid=root.resolve("invalid.jar");Files.write(invalid,OPAQUE);try{DynamicNativeSupport.needsBridge(invalid);throw new AssertionError("corrupt ZIP ignored");}catch(java.util.zip.ZipException expected){}
    Path mismatched=jar(root,"mismatch.jar",Map.of("wrong/Name.class",ordinary("fixture/Native",Opcodes.ACC_STATIC,false)));
    try{DynamicNativeSupport.needsBridge(mismatched);throw new AssertionError("readable class path ignored");}catch(IOException expected){check(expected.getMessage().equals("DYNAMIC_NATIVE_CLASS_PATH"),"class path error changed");}
    System.out.println("archive-and-path-errors-preserved");
   }else throw new AssertionError("unknown test mode");
  }finally{HostServices.close();}
 }
}
`;
