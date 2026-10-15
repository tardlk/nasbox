// SPDX-License-Identifier: GPL-3.0-only
// Entirely owned Java and ARM machine-code fixtures; no captured provider runs on the host.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildSpiderRuntime } from '../backend/spider-runtime/build.mjs';
import { buildNativeProfile } from '../backend/spider-runtime/native-bridge/build.mjs';

const enabled = process.env.TVBOX_TEST_NATIVE === '1';
let built, directory, jar, helper;
function run(executable, args, timeout = 30000) {
 const result = spawnSync(executable, args, { encoding: 'utf8', timeout, maxBuffer: 2 * 1024 * 1024 });
 assert.equal(result.error, undefined, String(result.error)); assert.equal(result.status, 0, result.stderr + '\n' + result.stdout);
 return result.stdout;
}
// Minimal ELF32/ARM shared object: two exported, real ARM functions; no system dependencies.
function armLibrary() {
 const bytes = Buffer.alloc(0x1200), strings = Buffer.from('\0Java_com_github_catvod_spider_Dynamic_value\0JNI_OnLoad\0');
 bytes.set([0x7f, 69, 76, 70, 1, 1, 1]);
 const u16 = (offset, value) => bytes.writeUInt16LE(value, offset), u32 = (offset, value) => bytes.writeUInt32LE(value, offset);
 u16(16, 3); u16(18, 40); u32(20, 1); u32(28, 52); u32(32, 0x1080); u32(36, 0x05000200); u16(40, 52); u16(42, 32); u16(44, 2); u16(46, 40); u16(48, 7); u16(50, 6);
 // PT_LOAD and PT_DYNAMIC; all virtual offsets equal file offsets.
 [1, 0, 0, 0, bytes.length, bytes.length, 5, 4096].forEach((value, index) => u32(52 + 4 * index, value));
 [2, 0x300, 0x300, 0x300, 48, 48, 4, 4].forEach((value, index) => u32(84 + 4 * index, value));
 bytes.set(strings, 0x200);
 function symbol(offset, name, address, size) { u32(offset, name); u32(offset + 4, address); u32(offset + 8, size); bytes[offset + 12] = 0x12; u16(offset + 14, 1); }
 symbol(0x290, 1, 0x1000, 8); symbol(0x2a0, strings.indexOf('JNI_OnLoad'), 0x1010, 12);
 [1, 3, 1, 0, 2, 0].forEach((value, index) => u32(0x2c0 + 4 * index, value));
 [[4, 0x2c0], [5, 0x200], [6, 0x280], [10, strings.length], [11, 16], [0, 0]].forEach(([tag, value], index) => { u32(0x300 + 8 * index, tag); u32(0x304 + 8 * index, value); });
 const sectionNames = Buffer.from('\0.text\0.dynsym\0.dynstr\0.hash\0.dynamic\0.shstrtab\0'); bytes.set(sectionNames, 0x380);
 function section(index, name, type, flags, offset, size, link, info, alignment, entrySize) {
  [sectionNames.indexOf(name), type, flags, flags & 2 ? offset : 0, offset, size, link, info, alignment, entrySize].forEach((value, field) => u32(0x1080 + index * 40 + field * 4, value));
 }
 section(1, '.text', 1, 6, 0x1000, 0x20, 0, 0, 4, 0);
 section(2, '.dynsym', 11, 2, 0x280, 48, 3, 1, 4, 16);
 section(3, '.dynstr', 3, 2, 0x200, strings.length, 0, 0, 1, 0);
 section(4, '.hash', 5, 2, 0x2c0, 24, 2, 0, 4, 4);
 section(5, '.dynamic', 6, 2, 0x300, 48, 3, 0, 4, 8);
 section(6, '.shstrtab', 3, 0, 0x380, sectionNames.length, 0, 0, 1, 0);
 // value(): mov r0,#42; bx lr. JNI_OnLoad(): return JNI_VERSION_1_6.
 [0xe3a0002a, 0xe12fff1e].forEach((value, index) => u32(0x1000 + 4 * index, value));
 [0xe3000006, 0xe3400001, 0xe12fff1e].forEach((value, index) => u32(0x1010 + 4 * index, value));
 return bytes;
}
function setup() {
 if (built) return;
 built = buildNativeProfile(buildSpiderRuntime()); directory = mkdtempSync(join(tmpdir(), 'tvbox-dynamic-native-'));
 const source = join(directory, 'Dynamic.java'), classes = join(directory, 'classes'); mkdirSync(classes);
 writeFileSync(source, `package com.github.catvod.spider; public class Dynamic {
 static {String path=System.getProperty("owned.arm.path");if(Boolean.getBoolean("owned.runtime"))Runtime.getRuntime().load(path);else System.load(path);if(Boolean.getBoolean("owned.fail"))throw new IllegalStateException("owned-init-failure");}
 public static native int value(); public static String plain(){return "untouched";}
}`);
 run(join(built.javaHome, 'bin/javac'), ['--release', '8', '-d', classes, source]);
 jar = join(directory, 'dynamic.jar'); run(join(built.javaHome, 'bin/jar'), ['--create', '--file', jar, '-C', classes, '.']);
 helper = join(directory, 'DynamicProbe.java');
 writeFileSync(helper, `import java.nio.file.*;import java.net.*;import java.lang.reflect.*;import java.util.concurrent.*;import java.util.concurrent.atomic.*;import java.lang.management.*;import tvbox.runtime.*;
class DynamicProbe {
 static void concurrent(Class<?> type,String path)throws Exception {
  var field=com.winbox.nativebridge.NativeBridge.class.getDeclaredField("LOCK");field.setAccessible(true);Object gate=field.get(null);
  if(DynamicNativeSupport.gate()!=gate)throw new AssertionError("bridge monitor identity");
  for(Method method:DynamicNativeSupport.class.getDeclaredMethods())if(Modifier.isSynchronized(method.getModifiers()))throw new AssertionError("helper class monitor reintroduced");
  CountDownLatch acquired=new CountDownLatch(1),callback=new CountDownLatch(1);AtomicReference<Throwable> failure=new AtomicReference<>();
  Thread nativeCallback=new Thread(()->{synchronized(gate){try{
   acquired.countDown();if(!callback.await(5,TimeUnit.SECONDS))throw new AssertionError("callback deadline");
   DynamicNativeSupport.load(path);if(!type.getMethod("value").invoke(null).equals(42))throw new AssertionError("native callback result");
   NativeHost.close();
  }catch(Throwable error){failure.compareAndSet(null,error);}}},"owned-native-callback");
  Thread loading=new Thread(()->{try{
   DynamicNativeSupport.load(path+".second");throw new AssertionError("load after close succeeded");
  }catch(UnsatisfiedLinkError expected){if(!expected.getMessage().contains("DYNAMIC_NATIVE_NOT_PREPARED"))failure.compareAndSet(null,expected);}
  catch(Throwable error){failure.compareAndSet(null,error);}},"owned-dynamic-loader");
  nativeCallback.setDaemon(true);loading.setDaemon(true);nativeCallback.start();if(!acquired.await(5,TimeUnit.SECONDS))throw new AssertionError("bridge gate deadline");loading.start();
  long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(5);boolean blocked=false;ThreadMXBean threads=ManagementFactory.getThreadMXBean();
  while(System.nanoTime()<deadline){ThreadInfo info=threads.getThreadInfo(loading.getId());if(info!=null&&info.getThreadState()==Thread.State.BLOCKED&&info.getLockOwnerId()==nativeCallback.getId()&&info.getLockInfo().getIdentityHashCode()==System.identityHashCode(gate)){blocked=true;break;}Thread.sleep(2);}
  callback.countDown();nativeCallback.join(5000);loading.join(5000);
  if(!blocked||nativeCallback.isAlive()||loading.isAlive())throw new AssertionError("dynamic load / JNI callback / close deadlock");
  if(failure.get()!=null)throw new AssertionError("concurrent bridge failure",failure.get());
 }
 public static void main(String[] args)throws Exception {
  Path root=Path.of(args[1]);Files.createDirectories(root);HostServices.directory=root.toFile();HostServices.networkDisabled=true;
  Path work=root.resolve("native/work");System.setProperty("tvbox.native.data",root.resolve("android").toString());
  Path input=Path.of(args[0]);if(!DynamicNativeSupport.needsBridge(input))throw new AssertionError("dynamic detection");
  try(URLClassLoader resolver=new URLClassLoader(new URL[]{input.toUri().toURL()},DynamicProbe.class.getClassLoader())) {
   if(args[3].equals("unsupported")){
    try{DynamicNativeSupport.prepare(input,work,resolver);throw new AssertionError("unsupported native path accepted");}
    catch(java.io.IOException expected){if(!expected.getMessage().startsWith("DYNAMIC_NATIVE_UNSUPPORTED:"))throw expected;}
    System.out.println("dynamic-unsupported-rejected");return;
   }
   Path patched=DynamicNativeSupport.prepare(input,work,resolver);
   try(URLClassLoader loader=new URLClassLoader(new URL[]{patched.toUri().toURL(),input.toUri().toURL()},DynamicProbe.class.getClassLoader())) {
    DynamicNativeSupport.bind(input,work,loader);System.setProperty("owned.arm.path",args[2]);
    if(args[3].equals("success")||args[3].equals("concurrent")){
     Class<?> type=Class.forName("com.github.catvod.spider.Dynamic",true,loader);
     if(!type.getMethod("value").invoke(null).equals(42))throw new AssertionError("real ARM JNI result");
     if(!type.getMethod("plain").invoke(null).equals("untouched"))throw new AssertionError("plain method");
     DynamicNativeSupport.load(args[2]);if(!type.getMethod("value").invoke(null).equals(42))throw new AssertionError("repeat load");
     if(args[3].equals("concurrent"))concurrent(type,args[2]);
     System.out.println("dynamic-arm-jni-ok");
    } else {
     Throwable failure=null;try{Class.forName("com.github.catvod.spider.Dynamic",true,loader);}catch(Throwable error){failure=error;}
     if(failure==null)throw new AssertionError("initialization falsely succeeded");
     String evidence="";for(Throwable error=failure;error!=null;error=error.getCause())evidence+=error.toString()+"\\n";
     if(!evidence.contains(args[3]))throw new AssertionError(evidence);
     try{Class.forName("com.github.catvod.spider.Dynamic",true,loader);throw new AssertionError("erroneous class revived");}catch(NoClassDefFoundError expected){}
     System.out.println("dynamic-failure-preserved");
    }
   }
  }finally{NativeHost.close();DynamicNativeSupport.close();HostServices.close();}
  if(Files.isDirectory(work))try(var files=Files.list(work)){if(files.anyMatch(path->path.getFileName().toString().startsWith("dynamic-")))throw new AssertionError("retained dynamic files");}
 }
}`);
}
after(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });
function probe(mode, options = {}) {
 setup(); const root = join(directory, 'runtime-' + String(Math.random()).slice(2)); mkdirSync(root);
 let path = join(root, 'android', 'cache', '.owned-arm'); mkdirSync(join(root, 'android', 'cache'), { recursive: true });
 if (options.outside) { const outside = join(directory, 'outside.so'); writeFileSync(outside, armLibrary()); if (options.symlink) symlinkSync(outside, path); else path = outside; }
 else writeFileSync(path, options.invalid ? Buffer.from('owned non-ELF fixture') : armLibrary());
 if (mode === 'concurrent') { const second = armLibrary(); second.writeUInt32LE(0xe3a0002b, 0x1000); writeFileSync(path + '.second', second); }
 return run(built.java, ['-Xmx512m', '-Dtvbox.native.enabled=true', ...(options.runtime ? ['-Downed.runtime=true'] : []), ...(options.fail ? ['-Downed.fail=true'] : []), '-cp', built.classpath, helper, options.input ?? jar, root, path, mode], 60000);
}

test('dynamic System.load executes owned ARM JNI and preserves ordinary Java methods', { skip: !enabled, timeout: 90000 }, () => {
 assert.match(probe('success'), /dynamic-arm-jni-ok/);
});
test('dynamic Runtime.load executes the same owned ARM JNI', { skip: !enabled, timeout: 90000 }, () => {
 assert.match(probe('success', { runtime: true }), /dynamic-arm-jni-ok/);
});
test('dynamic clinit preserves original failure after a real successful ARM load', { skip: !enabled, timeout: 90000 }, () => {
 assert.match(probe('owned-init-failure', { fail: true }), /dynamic-failure-preserved/);
});
test('dynamic load, a bridge callback and close share one reentrant gate without lock inversion', { skip: !enabled, timeout: 90000 }, () => {
 assert.match(probe('concurrent'), /dynamic-arm-jni-ok/);
});
for (const [name, options, expected] of [
 ['invalid ELF', { invalid: true }, 'DYNAMIC_NATIVE_INVALID_ELF'],
 ['outside worker root', { outside: true }, 'DYNAMIC_NATIVE_OUTSIDE_ROOT'],
 ['symlink escaping worker root', { outside: true, symlink: true }, 'DYNAMIC_NATIVE_OUTSIDE_ROOT'],
]) test('dynamic load rejects ' + name + ' without pretending initialization succeeded', { skip: !enabled, timeout: 90000 }, () => {
 assert.match(probe(expected, options), /dynamic-failure-preserved/);
});
for (const [name, body] of [
 ['library names', 'static {System.loadLibrary("owned-missing-library");} public static native int value();'],
]) test('unsupported dynamic ' + name + ' remain explicit failures', { skip: !enabled, timeout: 90000 }, () => {
 setup(); const staging = mkdtempSync(join(directory, 'unsupported-')), source = join(staging, 'Dynamic.java'), classes = join(staging, 'classes'); mkdirSync(classes);
 writeFileSync(source, 'package com.github.catvod.spider;public class Dynamic {' + body + '}');
 run(join(built.javaHome, 'bin/javac'), ['--release', '8', '-d', classes, source]);
 const input = join(staging, 'unsupported.jar'); run(join(built.javaHome, 'bin/jar'), ['--create', '--file', input, '-C', classes, '.']);
 assert.match(probe('unsupported', { input }), /dynamic-unsupported-rejected/);
});
