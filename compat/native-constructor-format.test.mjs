// SPDX-License-Identifier: GPL-3.0-only
// Self-owned class bytes only. A DEX native constructor must not become a no-op.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join,resolve,delimiter} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

test('JVM rejects a native constructor before execution while an ordinary constructor preserves its side effect', {timeout:30000}, async t=>{
 const directory=await mkdtemp(join(tmpdir(),'tvbox-native-constructor-format-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const root=resolve(import.meta.dirname,'..'),javaHome=process.env.TVBOX_JAVA_HOME||process.env.JAVA_HOME||join(root,'.tools/jdk17');
 const manifest=JSON.parse(await readFile(join(root,'backend/spider-runtime/native-bridge/runtime.json'),'utf8'));
 const pin=manifest.dependencies.find(row=>/^asm-[0-9.]+\.jar$/.test(row.filename));assert.ok(pin);
 const asm=join(process.env.TVBOX_NATIVE_LIB_DIR||join(root,'.tools/native-runtime'),pin.filename);
 assert.equal(createHash('sha256').update(await readFile(asm)).digest('hex'),pin.sha256);
 await writeFile(join(directory,'OwnedNativeConstructor.java'),fixture);
 const run=(program,args)=>{
  const result=spawnSync(join(javaHome,'bin',program),args,{encoding:'utf8',timeout:20000,maxBuffer:1024*1024});
  assert.equal(result.error,undefined,String(result.error));assert.equal(result.status,0,result.stderr+result.stdout);return result.stdout;
 };
 run('javac',['--release','17','-cp',asm,'-d',directory,join(directory,'OwnedNativeConstructor.java')]);
 assert.match(run('java',['-Xverify:all','-cp',directory+delimiter+asm,'OwnedNativeConstructor']),/native-constructor-contract-ok/);
});

const fixture=String.raw`
import org.objectweb.asm.*;
public final class OwnedNativeConstructor {
 static byte[] bytes(boolean nativeConstructor){
  ClassWriter writer=new ClassWriter(ClassWriter.COMPUTE_MAXS);
  writer.visit(Opcodes.V1_8,Opcodes.ACC_PUBLIC,"fixture/NativeConstructor",null,"java/lang/Object",null);
  writer.visitField(Opcodes.ACC_PUBLIC,"initialized","I",null,null).visitEnd();
  MethodVisitor method=writer.visitMethod(Opcodes.ACC_PUBLIC|(nativeConstructor?Opcodes.ACC_NATIVE:0),"<init>","()V",null,null);
  if(!nativeConstructor){
   method.visitCode();method.visitVarInsn(Opcodes.ALOAD,0);method.visitMethodInsn(Opcodes.INVOKESPECIAL,"java/lang/Object","<init>","()V",false);
   method.visitVarInsn(Opcodes.ALOAD,0);method.visitIntInsn(Opcodes.BIPUSH,37);method.visitFieldInsn(Opcodes.PUTFIELD,"fixture/NativeConstructor","initialized","I");
   method.visitInsn(Opcodes.RETURN);method.visitMaxs(0,0);
  }
  method.visitEnd();writer.visitEnd();return writer.toByteArray();
 }
 static final class OwnLoader extends ClassLoader{Class<?> own(byte[] bytes){return defineClass(null,bytes,0,bytes.length);}}
 public static void main(String[] args)throws Exception{
  try{new OwnLoader().own(bytes(true));throw new AssertionError("Native constructor was silently accepted");}
  catch(ClassFormatError expected){
   String message=expected.getMessage();
   if(!message.contains("<init>")||!message.contains("illegal modifiers")||!message.contains("0x101"))throw expected;
  }
  Class<?> type=new OwnLoader().own(bytes(false));Object receiver=type.getConstructor().newInstance();
  if(type.getField("initialized").getInt(receiver)!=37)throw new AssertionError("Constructor state was lost");
  System.out.println("native-constructor-contract-ok");
 }
}
`;
