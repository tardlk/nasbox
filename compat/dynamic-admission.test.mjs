// SPDX-License-Identifier: GPL-3.0-only
// Owned JVM fixtures only. Unresolved instance JNI remains an explicit JVM failure.
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,delimiter} from 'node:path';
import {spawnSync} from 'node:child_process';
import {buildSpiderRuntime} from '../backend/spider-runtime/build.mjs';
import {buildNativeProfile} from '../backend/spider-runtime/native-bridge/build.mjs';
let built,directory;
const enabled=process.env.TVBOX_TEST_NATIVE==='1';
function run(executable,args){const r=spawnSync(executable,args,{encoding:'utf8',timeout:60000,maxBuffer:2*1024*1024});assert.equal(r.error,undefined,String(r.error));assert.equal(r.status,0,r.stderr+'\n'+r.stdout);return r.stdout;}
function probe(mode){
 if(!built){built=buildNativeProfile(buildSpiderRuntime());directory=mkdtempSync(join(tmpdir(),'tvbox-dynamic-admission-'));writeFileSync(join(directory,'AdmissionProbe.java'),fixture);run(join(built.javaHome,'bin/javac'),['--release','17','-cp',built.classpath,'-d',directory,join(directory,'AdmissionProbe.java')]);}
 return run(built.java,['-Xverify:all','-Dtvbox.native.enabled=true','-cp',directory+delimiter+built.classpath,'AdmissionProbe',directory,mode]);
}
after(()=>{if(directory)rmSync(directory,{recursive:true,force:true});});
test('native declarations without a library load do not reject a Java artifact and still fail if invoked',{skip:!enabled,timeout:120000},()=>assert.match(probe('native-only'),/native-only-unresolved/));
test('unused instance JNI in SDK classes does not reject an independent load hook',{skip:!enabled,timeout:120000},()=>assert.match(probe('sdk'),/instance-sdk-left-original/));
test('mixed native classes patch static calls while retaining real instance native failure',{skip:!enabled,timeout:120000},()=>assert.match(probe('mixed'),/mixed-instance-native-preserved/));
const fixture=String.raw`
import java.nio.file.*;import java.net.*;import java.lang.reflect.*;import java.util.*;import java.util.jar.*;import org.objectweb.asm.*;import tvbox.runtime.*;
public final class AdmissionProbe{
 static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
 static byte[] type(String name,boolean statik,boolean instance,boolean load){
  ClassWriter w=new ClassWriter(0);w.visit(Opcodes.V1_8,Opcodes.ACC_PUBLIC,name,null,"java/lang/Object",null);
  MethodVisitor m=w.visitMethod(Opcodes.ACC_PUBLIC,"<init>","()V",null,null);m.visitCode();m.visitVarInsn(Opcodes.ALOAD,0);m.visitMethodInsn(Opcodes.INVOKESPECIAL,"java/lang/Object","<init>","()V",false);m.visitInsn(Opcodes.RETURN);m.visitMaxs(1,1);m.visitEnd();
  if(statik)w.visitMethod(Opcodes.ACC_PUBLIC|Opcodes.ACC_STATIC|Opcodes.ACC_NATIVE,"staticValue","()I",null,null).visitEnd();
  if(instance){m=w.visitMethod(Opcodes.ACC_PUBLIC|Opcodes.ACC_NATIVE,"instanceValue","()I",null,null);m.visitAnnotation("Lfixture/Marker;",true).visitEnd();m.visitEnd();}
  if(load){m=w.visitMethod(Opcodes.ACC_PUBLIC|Opcodes.ACC_STATIC,"loadUnused","(Ljava/lang/String;)V",null,null);m.visitCode();m.visitVarInsn(Opcodes.ALOAD,0);m.visitMethodInsn(Opcodes.INVOKESTATIC,"java/lang/System","load","(Ljava/lang/String;)V",false);m.visitInsn(Opcodes.RETURN);m.visitMaxs(1,1);m.visitEnd();}
  m=w.visitMethod(Opcodes.ACC_PUBLIC|Opcodes.ACC_STATIC,"plain","()Ljava/lang/String;",null,null);m.visitCode();m.visitLdcInsn("ordinary-ok");m.visitInsn(Opcodes.ARETURN);m.visitMaxs(1,0);m.visitEnd();w.visitEnd();return w.toByteArray();
 }
 static Path jar(Path root,Map<String,byte[]> entries)throws Exception{Path p=root.resolve("fixture.jar");try(JarOutputStream out=new JarOutputStream(Files.newOutputStream(p))){for(var e:entries.entrySet()){out.putNextEntry(new JarEntry(e.getKey()));out.write(e.getValue());out.closeEntry();}}return p;}
 static void unresolved(Class<?> type,String method,boolean statik)throws Exception{
  Method m=type.getMethod(method);check(Modifier.isNative(m.getModifiers()),"original native flag lost");
  try{m.invoke(statik?null:type.getConstructor().newInstance());throw new AssertionError("unresolved native falsely succeeded");}catch(InvocationTargetException expected){check(expected.getCause() instanceof UnsatisfiedLinkError,"native failure changed: "+expected.getCause());}
 }
 public static void main(String[] args)throws Exception{
  Path root=Files.createTempDirectory(Path.of(args[0]),"case-");HostServices.directory=root.toFile();HostServices.networkDisabled=true;System.setProperty("tvbox.native.data",root.resolve("android").toString());
  try{
   if(args[1].equals("native-only")){
    Path input=jar(root,Map.of("fixture/Ordinary.class",type("fixture/Ordinary",true,true,false)));byte[] before=Files.readAllBytes(input);
    check(!DynamicNativeSupport.needsBridge(input),"native-only artifact claimed a library load");URL[] urls=NativeHost.outer(input);check(urls.length==1&&urls[0].equals(input.toUri().toURL()),"native-only classpath changed");
    try(URLClassLoader loader=new URLClassLoader(urls,AdmissionProbe.class.getClassLoader())){Class<?> c=Class.forName("fixture.Ordinary",true,loader);check(c.getMethod("plain").invoke(null).equals("ordinary-ok"),"ordinary code blocked");unresolved(c,"staticValue",true);unresolved(c,"instanceValue",false);}
    check(Arrays.equals(before,Files.readAllBytes(input)),"native-only input bytes changed");System.out.println("native-only-unresolved");
   }else{
    boolean mixed=args[1].equals("mixed");
    Map<String,byte[]> entries=new LinkedHashMap<>();entries.put("fixture/Loader.class",type("fixture/Loader",mixed,mixed,true));
    if(!mixed)entries.put("fixture/UnusedSdk.class",type("fixture/UnusedSdk",false,true,false));
    Path input=jar(root,entries);byte[] before=Files.readAllBytes(input);check(DynamicNativeSupport.needsBridge(input),"real load hook missing");URL[] urls=NativeHost.outer(input);
    check(urls.length==2,"dynamic patch classpath missing");Path patched=Path.of(urls[0].toURI());check(Files.isRegularFile(patched.resolve("fixture/Loader.class")),"load class not patched");
    if(!mixed)check(!Files.exists(patched.resolve("fixture/UnusedSdk.class")),"instance-only SDK was patched");
    try(URLClassLoader loader=new URLClassLoader(urls,AdmissionProbe.class.getClassLoader())){
     Class<?> c=Class.forName("fixture.Loader",true,loader);check(c.getMethod("plain").invoke(null).equals("ordinary-ok"),"plain code changed");
     if(mixed){check(!Modifier.isNative(c.getMethod("staticValue").getModifiers()),"static native was skipped");unresolved(c,"instanceValue",false);}
     else unresolved(Class.forName("fixture.UnusedSdk",true,loader),"instanceValue",false);
    }
    check(Arrays.equals(before,Files.readAllBytes(input)),"dynamic original archive changed");NativeHost.close();
    Path work=root.resolve("native/work");if(Files.isDirectory(work))try(var paths=Files.list(work)){check(paths.noneMatch(p->p.getFileName().toString().startsWith("dynamic-")),"dynamic temporary inputs retained");}
    System.out.println(mixed?"mixed-instance-native-preserved":"instance-sdk-left-original");
   }
  }finally{NativeHost.close();HostServices.close();}
 }
}
`;
