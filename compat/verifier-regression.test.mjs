// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, delimiter } from 'node:path';
import { spawnSync } from 'node:child_process';
import { nativeToolchain } from '../backend/spider-runtime/native-bridge/toolchain.mjs';

const root = resolve(import.meta.dirname, '..');
const javaHome = process.env.TVBOX_JAVA_HOME || process.env.JAVA_HOME || join(root, '.tools/jdk17');
const enabled = existsSync(join(javaHome, 'bin/javac')) && existsSync(join(root, '.tools/native-runtime/asm-9.7.jar'));

test('constructor repair preserves NEW provenance, forwarding behavior and strict verification', { skip: !enabled, timeout: 30000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tvbox-verifier-regression-'));
  try {
    const asm = nativeToolchain().jars.find(p => /[/\\]asm-[0-9.]+\.jar$/.test(p));
    assert.ok(asm);
    writeFileSync(join(dir, 'VerifierRegression.java'), fixture);
    const run = (command, args) => {
      const result = spawnSync(command, args, { encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024 });
      assert.equal(result.error, undefined, String(result.error));
      assert.equal(result.status, 0, result.stderr + result.stdout);
      return result.stdout;
    };
    run(join(javaHome, 'bin/javac'), ['--release', '17', '-cp', asm, '-d', dir,
      join(root, 'backend/spider-runtime/native-bridge/src/tvbox/runtime/VerifiedJarRepair.java'), join(dir, 'VerifierRegression.java')]);
    assert.match(run(join(javaHome, 'bin/java'), ['-Xverify:all', '-cp', [dir, asm].join(delimiter), 'VerifierRegression', dir]), /verifier-regression-ok cases=18/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// Only locally generated fixture classes are defined and executed. Catalog
// artifacts must continue to run exclusively inside the isolated NAS probes.
const fixture = String.raw`
import java.nio.file.*;
import java.net.*;
import java.io.*;
import java.util.*;
import java.util.zip.*;
import org.objectweb.asm.*;
import tvbox.runtime.VerifiedJarRepair;

public final class VerifierRegression implements Opcodes {
 static final String P="fixture/Parent", M="fixture/Middle", C="fixture/Child", CALLER="fixture/Caller";
 static ClassWriter cls(String name,String parent){ClassWriter w=new ClassWriter(ClassWriter.COMPUTE_MAXS);w.visit(V1_6,ACC_PUBLIC,name,null,parent,null);return w;}
 static MethodVisitor method(ClassWriter w,String name,String desc){MethodVisitor m=w.visitMethod(ACC_PUBLIC|(name.equals("<init>")?0:ACC_STATIC),name,desc,null,null);m.visitCode();return m;}
 static void end(MethodVisitor m){m.visitMaxs(0,0);m.visitEnd();}
 static byte[] parent(){
  ClassWriter w=cls(P,"java/lang/Object");w.visitField(ACC_PUBLIC,"value","I",null,null).visitEnd();w.visitField(ACC_PUBLIC,"object","Ljava/lang/Object;",null,null).visitEnd();
  MethodVisitor m=method(w,"<init>","(I)V");m.visitVarInsn(ALOAD,0);m.visitMethodInsn(INVOKESPECIAL,"java/lang/Object","<init>","()V",false);m.visitVarInsn(ALOAD,0);m.visitVarInsn(ILOAD,1);m.visitFieldInsn(PUTFIELD,P,"value","I");m.visitInsn(RETURN);end(m);
  m=method(w,"<init>","(Ljava/lang/Object;J)V");m.visitVarInsn(ALOAD,0);m.visitMethodInsn(INVOKESPECIAL,"java/lang/Object","<init>","()V",false);m.visitVarInsn(ALOAD,0);m.visitVarInsn(ALOAD,1);m.visitFieldInsn(PUTFIELD,P,"object","Ljava/lang/Object;");m.visitVarInsn(ALOAD,0);m.visitVarInsn(LLOAD,2);m.visitInsn(L2I);m.visitFieldInsn(PUTFIELD,P,"value","I");m.visitInsn(RETURN);end(m);
  m=method(w,"<init>","(JD)V");m.visitVarInsn(ALOAD,0);m.visitMethodInsn(INVOKESPECIAL,"java/lang/Object","<init>","()V",false);m.visitVarInsn(ALOAD,0);m.visitVarInsn(LLOAD,1);m.visitInsn(L2I);m.visitVarInsn(DLOAD,3);m.visitInsn(D2I);m.visitInsn(IADD);m.visitFieldInsn(PUTFIELD,P,"value","I");m.visitInsn(RETURN);end(m);w.visitEnd();return w.toByteArray();
 }
 static byte[] subclass(String name,String parent,boolean forwarding,boolean custom){
  ClassWriter w=cls(name,parent);
  if(forwarding||custom){MethodVisitor m=method(w,"<init>","(I)V");m.visitVarInsn(ALOAD,0);m.visitVarInsn(ILOAD,1);m.visitMethodInsn(INVOKESPECIAL,parent,"<init>","(I)V",false);if(custom){m.visitVarInsn(ALOAD,0);m.visitIntInsn(BIPUSH,99);m.visitFieldInsn(PUTFIELD,P,"value","I");}m.visitInsn(RETURN);end(m);}
  w.visitEnd();return w.toByteArray();
 }
 static byte[] caller(String mode){
  ClassWriter w=cls(CALLER,"java/lang/Object");MethodVisitor m=method(w,"execute","()Lfixture/Parent;");
  m.visitTypeInsn(NEW,C);
  if(mode.equals("alias")){m.visitVarInsn(ASTORE,0);m.visitVarInsn(ALOAD,0);}else m.visitInsn(DUP);
  if(mode.equals("branch")){Label next=new Label();m.visitJumpInsn(GOTO,next);m.visitLabel(next);}
  if(mode.equals("nested")){m.visitTypeInsn(NEW,"java/lang/StringBuilder");m.visitInsn(DUP);m.visitLdcInsn("nested");m.visitMethodInsn(INVOKESPECIAL,"java/lang/StringBuilder","<init>","(Ljava/lang/String;)V",false);m.visitLdcInsn(9L);m.visitMethodInsn(INVOKESPECIAL,P,"<init>","(Ljava/lang/Object;J)V",false);}
  else if(mode.equals("wide")){m.visitLdcInsn(3L);m.visitLdcInsn(4D);m.visitMethodInsn(INVOKESPECIAL,P,"<init>","(JD)V",false);}
  else{m.visitIntInsn(BIPUSH,7);m.visitMethodInsn(INVOKESPECIAL,mode.equals("unrelated")?"java/lang/Integer":P,"<init>","(I)V",false);}
  if(mode.equals("alias"))m.visitVarInsn(ALOAD,0);
  m.visitInsn(ARETURN);end(m);w.visitEnd();return w.toByteArray();
 }
 static Path jar(Path dir,String mode)throws Exception{
  Path jar=dir.resolve(mode+".jar");Map<String,byte[]> entries=new LinkedHashMap<>();entries.put(P+".class",parent());entries.put(M+".class",subclass(M,P,mode.equals("forward"),false));entries.put(C+".class",subclass(C,M,mode.equals("forward"),mode.equals("custom")));entries.put(CALLER+".class",caller(mode));entries.put("assets/exact.bin",new byte[]{0,1,2,(byte)255});
  try(ZipOutputStream z=new ZipOutputStream(Files.newOutputStream(jar))){for(Map.Entry<String,byte[]> e:entries.entrySet()){z.putNextEntry(new ZipEntry(e.getKey()));z.write(e.getValue());z.closeEntry();}}return jar;
 }
 static Path superJar(Path dir,String mode)throws Exception{
  Map<String,byte[]> entries=new LinkedHashMap<>();boolean enumeration=mode.equals("super-enum");
  if(enumeration){ClassWriter p=cls(P,"java/lang/Enum");p.visit(V1_6,ACC_PUBLIC|ACC_ABSTRACT|ACC_ENUM,P,null,"java/lang/Enum",null);p.visitEnd();entries.put(P+".class",p.toByteArray());ClassWriter middle=cls(M,P);middle.visit(V1_6,ACC_PUBLIC|ACC_ABSTRACT,M,null,P,null);middle.visitEnd();entries.put(M+".class",middle.toByteArray());}
  else{entries.put(P+".class",parent());entries.put(M+".class",subclass(M,P,mode.equals("this-delegation")||mode.equals("super-direct"),mode.equals("super-custom")));}
  ClassWriter w=cls(C,M);MethodVisitor m=method(w,"<init>","()V");m.visitVarInsn(ALOAD,0);
  if(mode.equals("super-alias")){m.visitVarInsn(ASTORE,1);m.visitVarInsn(ALOAD,1);}
  if(mode.equals("super-branch")){Label next=new Label();m.visitJumpInsn(GOTO,next);m.visitLabel(next);}
  if(enumeration){m.visitLdcInsn("VALUE");m.visitInsn(ICONST_0);m.visitMethodInsn(INVOKESPECIAL,"java/lang/Enum","<init>","(Ljava/lang/String;I)V",false);}
  else{m.visitIntInsn(BIPUSH,13);String target=mode.equals("this-delegation")?C:mode.equals("super-direct")?M:mode.equals("super-unrelated")?"java/lang/Integer":P;m.visitMethodInsn(INVOKESPECIAL,target,"<init>","(I)V",false);m.visitVarInsn(ALOAD,0);m.visitInsn(DUP);m.visitFieldInsn(GETFIELD,P,"value","I");m.visitInsn(ICONST_1);m.visitInsn(IADD);m.visitFieldInsn(PUTFIELD,P,"value","I");}
  m.visitInsn(RETURN);end(m);
  if(mode.equals("this-delegation")){m=method(w,"<init>","(I)V");m.visitVarInsn(ALOAD,0);m.visitVarInsn(ILOAD,1);m.visitMethodInsn(INVOKESPECIAL,M,"<init>","(I)V",false);m.visitInsn(RETURN);end(m);}
  w.visitEnd();entries.put(C+".class",w.toByteArray());
  w=cls(CALLER,"java/lang/Object");m=method(w,"execute","()Lfixture/Parent;");m.visitTypeInsn(NEW,C);m.visitInsn(DUP);m.visitMethodInsn(INVOKESPECIAL,C,"<init>","()V",false);m.visitInsn(ARETURN);end(m);w.visitEnd();entries.put(CALLER+".class",w.toByteArray());
  Path jar=dir.resolve(mode+".jar");try(ZipOutputStream z=new ZipOutputStream(Files.newOutputStream(jar))){for(Map.Entry<String,byte[]> e:entries.entrySet()){z.putNextEntry(new ZipEntry(e.getKey()));z.write(e.getValue());z.closeEntry();}}return jar;
 }
 static Object execute(Path jar)throws Exception{try(URLClassLoader loader=new URLClassLoader(new URL[]{jar.toUri().toURL()},ClassLoader.getPlatformClassLoader())){return loader.loadClass("fixture.Caller").getMethod("execute").invoke(null);}}
 static void rejected(Path jar)throws Exception{try{execute(jar);throw new AssertionError("invalid ancestor constructor unexpectedly verified");}catch(VerifyError expected){}catch(java.lang.reflect.InvocationTargetException wrapped){if(!(wrapped.getCause() instanceof VerifyError))throw wrapped;}}
 static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
 static byte[] entry(Path jar,String name)throws Exception{try(ZipFile z=new ZipFile(jar.toFile());InputStream in=z.getInputStream(z.getEntry(name))){return in.readAllBytes();}}
 public static void main(String[] args)throws Exception{
  Path dir=Path.of(args[0]);
  for(String mode:List.of("simple","alias","nested","wide","forward")){
   Path jar=jar(dir,mode);rejected(jar);byte[] parent=entry(jar,P+".class");int n=VerifiedJarRepair.repair(jar);check(n==(mode.equals("forward")?1:3),mode+" repair count "+n);check(Arrays.equals(parent,entry(jar,P+".class")),"unaffected parent stays exact");check(Arrays.equals(new byte[]{0,1,2,(byte)255},entry(jar,"assets/exact.bin")),"resource bytes");
   Object result=execute(jar);check(result.getClass().getName().equals("fixture.Child"),"NEW type preserved");check(result.getClass().getField("value").getInt(result)==(mode.equals("nested")?9:7),mode+" ancestor side effects");if(mode.equals("nested"))check(result.getClass().getField("object").get(result).toString().equals("nested"),"nested argument ctor");check(VerifiedJarRepair.repair(jar)==0,"idempotent");
  }
  for(String mode:List.of("custom","branch","unrelated")){
   Path jar=jar(dir,mode);byte[] before=Files.readAllBytes(jar);rejected(jar);check(VerifiedJarRepair.repair(jar)==0,"ambiguous repair must fail closed: "+mode);check(Arrays.equals(before,Files.readAllBytes(jar)),"unchanged rejection "+mode);rejected(jar);
  }
  // A platform class is never modified or synthesized into the artifact.
  ClassWriter w=cls(CALLER,"java/lang/Object");MethodVisitor m=method(w,"execute","()Ljava/lang/Object;");m.visitTypeInsn(NEW,"java/util/ArrayList");m.visitInsn(DUP);m.visitMethodInsn(INVOKESPECIAL,"java/lang/Object","<init>","()V",false);m.visitInsn(ARETURN);end(m);w.visitEnd();Path external=dir.resolve("external.jar");try(ZipOutputStream z=new ZipOutputStream(Files.newOutputStream(external))){z.putNextEntry(new ZipEntry(CALLER+".class"));z.write(w.toByteArray());z.closeEntry();}check(VerifiedJarRepair.repair(external)==0,"external class unchanged");rejected(external);
  // Object initialization inside a real constructor must remain its super call.
  Path valid=jar(dir,"valid");byte[] before=entry(valid,P+".class");VerifiedJarRepair.repair(valid);check(Arrays.equals(before,entry(valid,P+".class")),"constructor this/super is not NEW provenance");
  for(String mode:List.of("super","super-alias","super-enum")){
   Path jar=superJar(dir,mode);rejected(jar);check(VerifiedJarRepair.repair(jar)==(mode.equals("super-enum")?3:2),"this initializer forwarding count "+mode);Object result=execute(jar);if(mode.equals("super-enum"))check(((Enum<?>)result).name().equals("VALUE")&&((Enum<?>)result).ordinal()==0,"enum ancestor constructor behavior");else check(result.getClass().getField("value").getInt(result)==14,"this initializer and following field initialization "+mode);check(VerifiedJarRepair.repair(jar)==0,"this repair idempotent "+mode);
  }
  for(String mode:List.of("super-custom","super-branch","super-unrelated")){
   Path jar=superJar(dir,mode);byte[] raw=Files.readAllBytes(jar);rejected(jar);check(VerifiedJarRepair.repair(jar)==0,"ambiguous this initializer must fail closed "+mode);check(Arrays.equals(raw,Files.readAllBytes(jar)),"rejected this initializer bytes "+mode);rejected(jar);
  }
  for(String mode:List.of("this-delegation","super-direct")){
   Path jar=superJar(dir,mode);byte[] raw=Files.readAllBytes(jar);check(VerifiedJarRepair.repair(jar)==0,"valid this/super delegation unchanged "+mode);check(Arrays.equals(raw,Files.readAllBytes(jar)),"valid delegation byte identity "+mode);Object result=execute(jar);check(result.getClass().getField("value").getInt(result)==14,"valid this/super behavior "+mode);
  }
  System.out.println("verifier-regression-ok cases=18");
 }
}
`;
