// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildSpiderRuntime } from '../backend/spider-runtime/build.mjs';
import { buildNativeProfile } from '../backend/spider-runtime/native-bridge/build.mjs';

test('native close waits for ARM32 payload calls without blocking cross-VM latch callbacks', { skip: process.env.TVBOX_TEST_NATIVE !== '1', timeout: 60000 }, () => {
 const built = buildNativeProfile(buildSpiderRuntime()), dir = mkdtempSync(join(tmpdir(), 'tvbox-native-quiescence-'));
 try {
  mkdirSync(join(dir, 'root')); writeFileSync(join(dir, 'owned.so'), armLibrary());
  writeFileSync(join(dir, 'NativeQuiescence.java'), fixture);
  const run = (exe, args) => { const r = spawnSync(exe, args, { encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024 }); assert.equal(r.error, undefined, String(r.error)); assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout; };
  run(join(built.javaHome, 'bin/javac'), ['--release', '17', '-cp', built.classpath, '-d', dir, join(dir, 'NativeQuiescence.java')]);
  assert.match(run(built.java, ['-Xverify:all', '-Dtvbox.native.enabled=true', '-cp', dir + ':' + built.classpath, 'NativeQuiescence', join(dir, 'root'), join(dir, 'owned.so')]), /native-quiescence-ok/);
 } finally { rmSync(dir, { recursive: true, force: true }); }
});

// Owned minimal ELF32; no provider code or native compiler is needed.
function armLibrary() {
 const b = Buffer.alloc(0x1200), strings = Buffer.from('\0Java_fixture_Payload_value\0JNI_OnLoad\0');
 const u16 = (o, v) => b.writeUInt16LE(v, o), u32 = (o, v) => b.writeUInt32LE(v, o);
 b.set([127, 69, 76, 70, 1, 1, 1]);
 u16(16, 3); u16(18, 40); u32(20, 1); u32(28, 52); u32(32, 0x1080); u32(36, 0x05000200); u16(40, 52); u16(42, 32); u16(44, 2); u16(46, 40); u16(48, 7); u16(50, 6);
 [1, 0, 0, 0, b.length, b.length, 5, 4096].forEach((v, i) => u32(52 + 4 * i, v));
 [2, 0x300, 0x300, 0x300, 48, 48, 4, 4].forEach((v, i) => u32(84 + 4 * i, v)); b.set(strings, 0x200);
 function symbol(o, name, address, size) { u32(o, name); u32(o + 4, address); u32(o + 8, size); b[o + 12] = 0x12; u16(o + 14, 1); }
 symbol(0x290, 1, 0x1000, 8); symbol(0x2a0, strings.indexOf('JNI_OnLoad'), 0x1010, 12);
 [1, 3, 1, 0, 2, 0].forEach((v, i) => u32(0x2c0 + 4 * i, v));
 [[4, 0x2c0], [5, 0x200], [6, 0x280], [10, strings.length], [11, 16], [0, 0]].forEach(([tag, v], i) => { u32(0x300 + 8 * i, tag); u32(0x304 + 8 * i, v); });
 const names = Buffer.from('\0.text\0.dynsym\0.dynstr\0.hash\0.dynamic\0.shstrtab\0'); b.set(names, 0x380);
 function section(i, name, type, flags, offset, size, link, info, align, width) { [names.indexOf(name), type, flags, flags & 2 ? offset : 0, offset, size, link, info, align, width].forEach((v, j) => u32(0x1080 + i * 40 + j * 4, v)); }
 section(1, '.text', 1, 6, 0x1000, 0x20, 0, 0, 4, 0); section(2, '.dynsym', 11, 2, 0x280, 48, 3, 1, 4, 16); section(3, '.dynstr', 3, 2, 0x200, strings.length, 0, 0, 1, 0); section(4, '.hash', 5, 2, 0x2c0, 24, 2, 0, 4, 4); section(5, '.dynamic', 6, 2, 0x300, 48, 3, 0, 4, 8); section(6, '.shstrtab', 3, 0, 0x380, names.length, 0, 0, 1, 0);
 [0xe3a0002a, 0xe12fff1e].forEach((v, i) => u32(0x1000 + 4 * i, v)); [0xe3000006, 0xe3400001, 0xe12fff1e].forEach((v, i) => u32(0x1010 + 4 * i, v)); return b;
}

const fixture = String.raw`
import tvbox.runtime.*;import com.winbox.nativebridge.*;import com.github.unidbg.arm.backend.*;
import java.nio.file.*;import java.lang.reflect.*;import java.util.*;import java.util.concurrent.*;import java.util.concurrent.atomic.*;
public final class NativeQuiescence {
 static Object field(String name)throws Exception{Field f=NativeBridge.class.getDeclaredField(name);f.setAccessible(true);return f.get(null);}
 static void set(String name,Object value)throws Exception{Field f=NativeBridge.class.getDeclaredField(name);f.setAccessible(true);f.set(null,value);}
 static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
 static void waiting(Thread thread)throws Exception{long end=System.nanoTime()+TimeUnit.SECONDS.toNanos(3);while(System.nanoTime()<end){if(thread.getState()==Thread.State.TIMED_WAITING)return;Thread.sleep(1);}throw new AssertionError("close did not wait for active call");}
 public static void main(String[] args)throws Exception{
  HostServices.directory=Path.of(args[0]).toFile();HostServices.networkDisabled=true;System.setProperty("tvbox.native.data",Path.of(args[0],"android").toString());Object guard=field("LOCK"),payload=field("PAYLOAD_LOCK");check(guard!=payload,"separate VM locks required for cross-thread latch");
  for(Method method:NativeBridge.class.getDeclaredMethods())if(Set.of("init","initWithSo","ensureInit","ensurePayloadVm","payloadLoad").contains(method.getName()))check(Modifier.isSynchronized(method.getModifiers()),"reference initialization monitor preserved");
  NativeLifecycle.open();
  // A close deadline must leave the running emulator untouched and allow its
  // child callback to finish; rejection is explicit rather than forced destroy.
  NativeLifecycle.enter();try{NativeLifecycle.quiesce(20);throw new AssertionError("deadline accepted active native call");}catch(java.io.IOException expected){check(expected.getMessage().startsWith("NATIVE_BRIDGE_STILL_EXECUTING:"),"deadline diagnostic");}finally{NativeLifecycle.leave();}
  BridgeARM32Emulator emulator=new BridgeARM32Emulator("owned.payload.quiescence",Path.of(args[0],"guest").toFile(),Collections.singletonList(new Unicorn2Factory(true)));
  var vm=emulator.createDalvikVM();vm.loadLibrary(Path.of(args[1]).toFile(),true).callJNI_OnLoad(emulator);set("payloadEmulator",emulator);set("payloadVm",vm);
  check(NativeBridge.invokePayload("fixture/Payload","value","()I",new Object[0]).equals(42),"real ARM32 fixture returns 42");
  CountDownLatch guardEntered=new CountDownLatch(1),payloadDone=new CountDownLatch(1);AtomicReference<Throwable> failure=new AtomicReference<>();AtomicBoolean closed=new AtomicBoolean();
  Thread guardCall=new Thread(()->{NativeLifecycle.enter();try{synchronized(guard){guardEntered.countDown();check(payloadDone.await(5,TimeUnit.SECONDS),"cross-VM callback blocked by close");}}catch(Throwable error){failure.set(error);}finally{NativeLifecycle.leave();}},"owned-guard-awaiting-payload");
  Thread closer=new Thread(()->{try{NativeHost.close();closed.set(true);}catch(Throwable error){failure.set(error);}},"owned-native-closer");
  Thread payloadCall=new Thread(()->{try{check(NativeBridge.invokePayload("fixture/Payload","value","()I",new Object[0]).equals(42),"payload callback completes during quiescence");}catch(Throwable error){failure.set(error);}finally{payloadDone.countDown();}},"owned-payload-native");
  guardCall.setDaemon(true);closer.setDaemon(true);payloadCall.setDaemon(true);guardCall.start();check(guardEntered.await(3,TimeUnit.SECONDS),"guard started");closer.start();waiting(closer);check(!closed.get(),"close waits before destroying native VM");payloadCall.start();
  payloadCall.join(5000);guardCall.join(5000);closer.join(7000);check(!payloadCall.isAlive()&&!guardCall.isAlive()&&!closer.isAlive(),"cross-VM close deadlock");if(failure.get()!=null)throw new AssertionError("concurrent native shutdown",failure.get());check(closed.get(),"close completed after all native calls");check(field("payloadVm")==null&&field("payloadEmulator")==null,"payload resources cleared");
  try{NativeBridge.invokePayload("fixture/Payload","value","()I",new Object[0]);throw new AssertionError("closed native bridge revived");}catch(IllegalStateException expected){check(expected.getMessage().equals("NATIVE_BRIDGE_CLOSED"),"closed bridge diagnostic");}
  NativeHost.close();HostServices.close();System.out.println("native-quiescence-ok");
 }
}
`;
