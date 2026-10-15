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

test('constructor repair preserves opaque class entries and excludes them from ancestry proofs', { skip: !enabled, timeout: 30000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tvbox-verifier-class-format-'));
  try {
    const asm = nativeToolchain().jars.find(p => /[/\\]asm-[0-9.]+\.jar$/.test(p));
    assert.ok(asm);
    writeFileSync(join(dir, 'VerifierClassFormat.java'), fixture);
    const run = (command, args) => {
      const result = spawnSync(command, args, { encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024 });
      assert.equal(result.error, undefined, String(result.error));
      assert.equal(result.status, 0, result.stderr + result.stdout);
      return result.stdout;
    };
    run(join(javaHome, 'bin/javac'), ['--release', '17', '-cp', asm, '-d', dir,
      join(root, 'backend/spider-runtime/native-bridge/src/tvbox/runtime/VerifiedJarRepair.java'), join(dir, 'VerifierClassFormat.java')]);
    assert.match(run(join(javaHome, 'bin/java'), ['-Xverify:all', '-cp', [dir, asm].join(delimiter), 'VerifierClassFormat', dir]), /verifier-class-format-ok cases=16/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// Catalog bytes are never defined or executed here. Every byte is locally
// generated; malformed classes must remain rejected by the real JVM verifier.
const fixture = String.raw`
import java.nio.file.*;
import java.net.*;
import java.io.*;
import java.util.*;
import java.util.zip.*;
import org.objectweb.asm.*;
import tvbox.runtime.VerifiedJarRepair;

public final class VerifierClassFormat implements Opcodes {
 static final String P="fixture/Parent",M="fixture/Middle",C="fixture/Child",CALLER="fixture/Caller",OPAQUE="fixture/Opaque";
 static ClassWriter cls(String name,String parent){ClassWriter w=new ClassWriter(ClassWriter.COMPUTE_MAXS);w.visit(V1_6,ACC_PUBLIC,name,null,parent,null);return w;}
 static void end(MethodVisitor m){m.visitMaxs(0,0);m.visitEnd();}
 static byte[] parent(){ClassWriter w=cls(P,"java/lang/Object");w.visitField(ACC_PUBLIC,"value","I",null,null).visitEnd();MethodVisitor m=w.visitMethod(ACC_PUBLIC,"<init>","(I)V",null,null);m.visitCode();m.visitVarInsn(ALOAD,0);m.visitMethodInsn(INVOKESPECIAL,"java/lang/Object","<init>","()V",false);m.visitVarInsn(ALOAD,0);m.visitVarInsn(ILOAD,1);m.visitFieldInsn(PUTFIELD,P,"value","I");m.visitInsn(RETURN);end(m);w.visitEnd();return w.toByteArray();}
 static byte[] empty(String name,String parent){ClassWriter w=cls(name,parent);w.visitEnd();return w.toByteArray();}
 static byte[] caller(){ClassWriter w=cls(CALLER,"java/lang/Object");MethodVisitor m=w.visitMethod(ACC_PUBLIC|ACC_STATIC,"execute","()Ljava/lang/Object;",null,null);m.visitCode();m.visitTypeInsn(NEW,C);m.visitInsn(DUP);m.visitIntInsn(BIPUSH,7);m.visitMethodInsn(INVOKESPECIAL,P,"<init>","(I)V",false);m.visitInsn(ARETURN);end(m);w.visitEnd();return w.toByteArray();}
 static byte[] ordinary(String name){ClassWriter w=cls(name,"java/lang/Object");MethodVisitor m=w.visitMethod(ACC_PUBLIC|ACC_STATIC,"execute","()V",null,null);m.visitCode();m.visitInsn(RETURN);end(m);w.visitEnd();return w.toByteArray();}
 static int u2(byte[] b,int p){return(b[p]&255)<<8|(b[p+1]&255);}
 static int u4(byte[] b,int p){return(u2(b,p)<<16)|u2(b,p+2);}
 static int skipMembers(byte[] b,int p){int count=u2(b,p);p+=2;for(int i=0;i<count;i++){int n=u2(b,p+6);p+=8;for(int j=0;j<n;j++){int length=u4(b,p+2);p+=6+length;}}return p;}
 static byte[] invalidOpcode(byte[] original){byte[] b=original.clone();ClassReader reader=new ClassReader(b);int p=reader.header+8+2*u2(b,reader.header+6);p=skipMembers(b,p);int methods=u2(b,p);p+=2;for(int i=0;i<methods;i++){int attrs=u2(b,p+6);p+=8;for(int j=0;j<attrs;j++){String name=reader.readUTF8(p,new char[reader.getMaxStringLength()]);int length=u4(b,p+2);if(name.equals("Code")){b[p+14]=(byte)255;return b;}p+=6+length;}}throw new AssertionError("No fixture code");}
 static byte[] opaque(String mode,String name){byte[] b=ordinary(name);switch(mode){case "short":return new byte[]{1,2,3};case "magic":b[0]=0;return b;case "future":b[6]=0x7f;b[7]=(byte)255;return b;case "constant":b[10]=0;return b;case "class-index":int h=new ClassReader(b).header;b[h+2]=0x21;b[h+3]=0;return b;case "opcode":return invalidOpcode(b);default:throw new AssertionError(mode);}}
 static Map<String,byte[]> entries(){Map<String,byte[]> e=new LinkedHashMap<>();e.put(P+".class",parent());e.put(M+".class",empty(M,P));e.put(C+".class",empty(C,M));e.put(CALLER+".class",caller());e.put("assets/exact.bin",new byte[]{0,1,2,(byte)255});return e;}
 static Path jar(Path dir,String name,Map<String,byte[]> entries)throws Exception{Path path=dir.resolve(name+".jar");try(ZipOutputStream z=new ZipOutputStream(Files.newOutputStream(path))){for(Map.Entry<String,byte[]> e:entries.entrySet()){ZipEntry entry=new ZipEntry(e.getKey());entry.setTime(1700000000000L);z.putNextEntry(entry);z.write(e.getValue());z.closeEntry();}}return path;}
 static byte[] entry(Path path,String name)throws Exception{try(ZipFile z=new ZipFile(path.toFile());InputStream in=z.getInputStream(z.getEntry(name))){return in.readAllBytes();}}
 static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
 static void opaqueRejected(Path jar,String name)throws Exception{try(URLClassLoader loader=new URLClassLoader(new URL[]{jar.toUri().toURL()},ClassLoader.getPlatformClassLoader())){try{Class<?> c=loader.loadClass(name.replace('/','.'));c.getDeclaredMethods();throw new AssertionError("Opaque fixture unexpectedly accepted: "+name);}catch(ClassFormatError|VerifyError expected){}}}
 static void repairedExecutes(Path jar)throws Exception{try(URLClassLoader loader=new URLClassLoader(new URL[]{jar.toUri().toURL()},ClassLoader.getPlatformClassLoader())){Object result=loader.loadClass("fixture.Caller").getMethod("execute").invoke(null);check(result.getClass().getName().equals("fixture.Child"),"Allocated type retained");check(result.getClass().getField("value").getInt(result)==7,"Ancestor side effect retained");}}
 public static void main(String[] args)throws Exception{
  Path dir=Path.of(args[0]);int cases=0;
  for(String mode:List.of("short","magic","future","constant","class-index","opcode")){
   byte[] opaque=opaque(mode,OPAQUE);check(!VerifiedJarRepair.isReadableClass(opaque),"Opaque classification: "+mode);
   Path only=jar(dir,"only-"+mode,Map.of(OPAQUE+".class",opaque));byte[] raw=Files.readAllBytes(only);check(VerifiedJarRepair.repair(only)==0,"Opaque-only count: "+mode);check(Arrays.equals(raw,Files.readAllBytes(only)),"Opaque-only archive identity: "+mode);opaqueRejected(only,OPAQUE);cases++;
   Map<String,byte[]> entries=entries();entries.put(OPAQUE+".class",opaque);Path mixed=jar(dir,"mixed-"+mode,entries);check(VerifiedJarRepair.isReadableClass(entries.get(CALLER+".class")),"Parsing does not assert verification");check(VerifiedJarRepair.repair(mixed)==3,"Readable methods still repaired: "+mode);check(Arrays.equals(opaque,entry(mixed,OPAQUE+".class")),"Opaque entry identity: "+mode);check(Arrays.equals(entries.get(P+".class"),entry(mixed,P+".class")),"Unchanged parent identity: "+mode);check(Arrays.equals(entries.get("assets/exact.bin"),entry(mixed,"assets/exact.bin")),"Resource identity: "+mode);repairedExecutes(mixed);opaqueRejected(mixed,OPAQUE);check(VerifiedJarRepair.repair(mixed)==0,"Idempotent with opaque entry: "+mode);cases++;
  }
  for(String mode:List.of("future","opcode")){
   Map<String,byte[]> entries=entries();byte[] bad=mode.equals("opcode")?invalidOpcode(parent()):opaque(mode,P);entries.put(P+".class",bad);Path path=jar(dir,"bad-ancestor-"+mode,entries);byte[] raw=Files.readAllBytes(path);check(VerifiedJarRepair.repair(path)==0,"Opaque ancestor must not prove forwarding: "+mode);check(Arrays.equals(raw,Files.readAllBytes(path)),"No speculative repair through opaque ancestor: "+mode);opaqueRejected(path,P);cases++;
  }
  Map<String,byte[]> aliases=entries();aliases.put("assets/Alias.class",aliases.get(P+".class"));Path alias=jar(dir,"alias-with-canonical",aliases);check(VerifiedJarRepair.repair(alias)==3,"Canonical repair works with alias resource");check(Arrays.equals(aliases.get("assets/Alias.class"),entry(alias,"assets/Alias.class")),"Alias resource identity");repairedExecutes(alias);cases++;
  aliases=entries();aliases.put("assets/Alias.class",aliases.remove(P+".class"));Path noCanonical=jar(dir,"alias-without-canonical",aliases);byte[] raw=Files.readAllBytes(noCanonical);check(VerifiedJarRepair.repair(noCanonical)==0,"Resource alias cannot establish hierarchy");check(Arrays.equals(raw,Files.readAllBytes(noCanonical)),"No nonexistent canonical entry synthesized");cases++;
  System.out.println("verifier-class-format-ok cases="+cases);
 }
}
`;
