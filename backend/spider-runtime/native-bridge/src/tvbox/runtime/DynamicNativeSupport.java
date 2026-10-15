// SPDX-License-Identifier: GPL-3.0-only
package tvbox.runtime;

import com.winbox.nativebridge.NativeBridge;
import com.winbox.nativebridge.NativeBridgeMain;
import com.winbox.nativebridge.NativePatcher;
import com.winbox.nativebridge.PosixFile;
import java.io.*;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Modifier;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.jar.*;
import org.objectweb.asm.*;

/** Libraries materialized by Java code still execute in the ARM bridge, never the host JVM. */
public final class DynamicNativeSupport {
 private static final String BRIDGE="com/winbox/nativebridge/NativeBridge",SELF="tvbox/runtime/DynamicNativeSupport";
 private static final int LIMIT=64*1024*1024;
 private static final Object GATE=bridgeGate();
 private static Path ownedRoot,workDirectory,patchedDirectory,libraryDirectory;
 private static byte[] guardDigest;
 private static final Set<String> loaded=new HashSet<>();
 private DynamicNativeSupport(){}

 private static Object bridgeGate(){
  try{var field=NativeBridge.class.getDeclaredField("LOCK");int modifiers=field.getModifiers();
   if(field.getType()!=Object.class||!Modifier.isStatic(modifiers)||!Modifier.isFinal(modifiers))throw new IllegalStateException("DYNAMIC_NATIVE_BRIDGE_GATE_TYPE");
   field.setAccessible(true);Object value=field.get(null);if(value==null)throw new IllegalStateException("DYNAMIC_NATIVE_BRIDGE_GATE_NULL");return value;
  }catch(ReflectiveOperationException failure){throw new ExceptionInInitializerError(failure);}
 }
 /** The bridge invokes Java callbacks while holding this reentrant monitor.
  * Always acquire it before touching dynamic-loader state, including shutdown.
  * A separate helper-class monitor would invert that order in JNI callbacks.
  */
 public static Object gate(){return GATE;}

 private static boolean loadCall(String owner,String name){return (owner.equals("java/lang/System")||owner.equals("java/lang/Runtime"))&&(name.equals("load")||name.equals("loadLibrary")||name.equals("loadLibrary0"));}
 private static byte[] read(InputStream input)throws IOException{byte[] bytes=input.readNBytes(LIMIT+1);if(bytes.length>LIMIT)throw new IOException("DYNAMIC_NATIVE_SIZE_LIMIT");return bytes;}
 private static void validClass(String entry,String name)throws IOException{
  if(name.startsWith("/")||name.contains("\\")||Arrays.asList(name.split("/")).contains("..")||!entry.equals(name+".class"))throw new IOException("DYNAMIC_NATIVE_CLASS_PATH");
 }
 private record Target(String name,Set<String> natives,Set<String> instanceNatives,boolean loads,String unsupported){}
 private static List<Target> targets(Path jar,boolean strict)throws IOException{
  List<Target> result=new ArrayList<>();int count=0;
  try(JarFile archive=new JarFile(jar.toFile())){var entries=archive.entries();while(entries.hasMoreElements()){
   JarEntry entry=entries.nextElement();if(++count>8192)throw new IOException("DYNAMIC_NATIVE_ENTRY_LIMIT");if(entry.isDirectory()||!entry.getName().endsWith(".class"))continue;
   byte[] data;try(InputStream input=archive.getInputStream(entry)){data=read(input);}
   // A .class suffix may name an encrypted resource or malformed decoy. Only
   // ASM-unreadable entries are excluded from analysis; the original archive
   // remains intact, so requesting that class still fails in the JVM. Size,
   // I/O, class-path and supported-native checks stay outside this classifier.
   if(!VerifiedJarRepair.isReadableClass(data))continue;
   ClassReader reader=new ClassReader(data);validClass(entry.getName(),reader.getClassName());
   Set<String> natives=new HashSet<>(),instanceNatives=new HashSet<>();boolean[] load={false};String[] unsupported={null};
   reader.accept(new ClassVisitor(Opcodes.ASM9){
    public MethodVisitor visitMethod(int access,String name,String descriptor,String signature,String[] exceptions){
     if((access&Opcodes.ACC_NATIVE)!=0){if((access&Opcodes.ACC_STATIC)==0)instanceNatives.add(name+descriptor);else natives.add(name+descriptor);}
     return new MethodVisitor(Opcodes.ASM9){public void visitMethodInsn(int opcode,String owner,String name,String descriptor,boolean itf){
      if(loadCall(owner,name)){load[0]=true;if(!name.equals("load")||!descriptor.equals("(Ljava/lang/String;)V")||(opcode!=Opcodes.INVOKESTATIC&&opcode!=Opcodes.INVOKEVIRTUAL))unsupported[0]="library-name load";}
     }};
    }
   },ClassReader.SKIP_DEBUG|ClassReader.SKIP_FRAMES);
   if(load[0]||!natives.isEmpty())result.add(new Target(reader.getClassName(),natives,instanceNatives,load[0],unsupported[0]));
  }}
  // A native declaration alone does not load a library. Bundled SDK classes
  // with unused instance JNI methods must not reject an otherwise Java JAR.
  // Without an actual System/Runtime library-load instruction, leave every
  // method untouched: invoking an unresolved native still fails in the JVM.
  if(result.stream().noneMatch(Target::loads))return List.of();
  if(strict)for(Target target:result)if(target.unsupported()!=null)throw new IOException("DYNAMIC_NATIVE_UNSUPPORTED: "+target.unsupported());
  return result;
 }
 public static boolean needsBridge(Path jar)throws IOException{return !targets(jar,false).isEmpty();}
 private static Path directory(Path path)throws IOException{
  Path normalized=path.toAbsolutePath().normalize(),declared=HostServices.directory.toPath().toAbsolutePath().normalize();
  if(normalized.startsWith(declared))normalized=ownedRoot.resolve(declared.relativize(normalized));
  if(!normalized.startsWith(ownedRoot))throw new IOException("DYNAMIC_NATIVE_OUTSIDE_ROOT");
  Path current=ownedRoot;for(Path part:ownedRoot.relativize(normalized)){current=current.resolve(part);if(Files.isSymbolicLink(current))throw new IOException("DYNAMIC_NATIVE_SYMLINK");if(!Files.exists(current,LinkOption.NOFOLLOW_LINKS))Files.createDirectory(current);if(!Files.isDirectory(current,LinkOption.NOFOLLOW_LINKS))throw new IOException("DYNAMIC_NATIVE_DIRECTORY");}
  return current.toRealPath();
 }
 public static Path prepare(Path jar,Path work,ClassLoader resolver)throws Exception{
  synchronized(GATE){return prepareLocked(jar,work,resolver);}
 }
 private static Path prepareLocked(Path jar,Path work,ClassLoader resolver)throws Exception{
  if(workDirectory!=null)throw new IllegalStateException("DYNAMIC_NATIVE_ALREADY_PREPARED");
  List<Target> targets=targets(jar,true);if(targets.isEmpty())throw new IOException("DYNAMIC_NATIVE_NO_TARGETS");
  ownedRoot=HostServices.directory.toPath().toRealPath();workDirectory=directory(work);
  try{
   patchedDirectory=Files.createTempDirectory(workDirectory,"dynamic-patched-");libraryDirectory=Files.createTempDirectory(workDirectory,"dynamic-so-");
   // The reference patcher scans every native declaration. Feed it only the
   // selected classes, while retaining the original JAR for actual class and
   // resource loading. Instance-only SDK classes are not patch targets.
   Path scan=Files.createTempFile(workDirectory,"dynamic-scan-",".jar");int patched;
   try(JarFile archive=new JarFile(jar.toFile())){
    try(JarOutputStream output=new JarOutputStream(Files.newOutputStream(scan))){for(Target target:targets){
     String name=target.name()+".class";JarEntry entry=archive.getJarEntry(name);if(entry==null)throw new IOException("DYNAMIC_NATIVE_TARGET_MISSING");
     output.putNextEntry(new JarEntry(name));try(InputStream input=archive.getInputStream(entry)){
      byte[] bytes=read(input);
      if(!target.instanceNatives().isEmpty()){
       // This scan-only copy is never a class-loading source. Remove instance
       // declarations from the static-only patcher's plan, then restore their
       // complete original declarations into the verified output below.
       ClassWriter scanWriter=new ClassWriter(0);new ClassReader(bytes).accept(new ClassVisitor(Opcodes.ASM9,scanWriter){
        public MethodVisitor visitMethod(int access,String method,String descriptor,String signature,String[] exceptions){
         return target.instanceNatives().contains(method+descriptor)?null:super.visitMethod(access,method,descriptor,signature,exceptions);
        }
       },0);bytes=scanWriter.toByteArray();
      }
      output.write(bytes);
     }output.closeEntry();
    }}
    patched=NativePatcher.patchDynamic(scan.toFile(),patchedDirectory.toFile(),resolver);
   }finally{Files.deleteIfExists(scan);}
   if(patched!=targets.size())throw new IOException("DYNAMIC_NATIVE_PATCH_INCOMPLETE");
   for(Target target:targets){Path path=patchedDirectory.resolve(target.name()+".class");if(!Files.isRegularFile(path,LinkOption.NOFOLLOW_LINKS))throw new IOException("DYNAMIC_NATIVE_PATCH_MISSING");
    byte[] original;try(JarFile archive=new JarFile(jar.toFile());InputStream input=archive.getInputStream(archive.getJarEntry(target.name()+".class"))){original=read(input);}
    ClassReader reader=new ClassReader(Files.readAllBytes(path));ClassWriter writer=new ClassWriter(reader,0);Set<String> found=new HashSet<>(),restored=new HashSet<>();boolean[] unsafe={false};
    reader.accept(new ClassVisitor(Opcodes.ASM9,writer){
     public MethodVisitor visitMethod(int access,String name,String descriptor,String signature,String[] exceptions){
      if(target.instanceNatives().contains(name+descriptor))return null;
      if((access&Opcodes.ACC_NATIVE)!=0)unsafe[0]=true;if(target.natives().contains(name+descriptor))found.add(name+descriptor);
      return new MethodVisitor(Opcodes.ASM9,super.visitMethod(access,name,descriptor,signature,exceptions)){
       public void visitMethodInsn(int opcode,String owner,String name,String descriptor,boolean itf){
        if(loadCall(owner,name))unsafe[0]=true;
        if(owner.equals(BRIDGE)&&name.equals("bridgeLoadDynamic")&&descriptor.equals("(Ljava/lang/String;)V")){owner=SELF;name="load";}
        if(owner.equals(BRIDGE)&&name.equals("clinitRun")&&descriptor.equals("(Ljava/lang/Class;)V")){owner=SELF;name="clinit";}
        super.visitMethodInsn(opcode,owner,name,descriptor,itf);
       }
      };
     }
     public void visitEnd(){
      // The bridge supports static JNI calls. Preserve instance declarations
      // exactly, including annotations; never turn them into static-style
      // forwarding stubs or successful empty bodies.
      new ClassReader(original).accept(new ClassVisitor(Opcodes.ASM9){
       public MethodVisitor visitMethod(int access,String name,String descriptor,String signature,String[] exceptions){
        if(!target.instanceNatives().contains(name+descriptor))return null;
        if((access&Opcodes.ACC_NATIVE)==0||(access&Opcodes.ACC_STATIC)!=0)throw new IllegalStateException("DYNAMIC_NATIVE_INSTANCE_CONTRACT");
        restored.add(name+descriptor);return writer.visitMethod(access,name,descriptor,signature,exceptions);
       }
      },ClassReader.SKIP_DEBUG|ClassReader.SKIP_FRAMES);
      super.visitEnd();
     }
    },0);
    if(unsafe[0]||!found.equals(target.natives())||!restored.equals(target.instanceNatives()))throw new IOException("DYNAMIC_NATIVE_PATCH_UNSAFE");Files.write(path,writer.toByteArray());
   }
   NativeBridgeMain.arm(jar.toFile(),workDirectory.toFile(),resolver);return patchedDirectory;
  }catch(Exception|Error failure){close();throw failure;}
 }
 public static void bind(Path jar,Path work,ClassLoader resolver)throws IOException{
  synchronized(GATE){if(workDirectory==null||!work.toRealPath().equals(workDirectory))throw new IOException("DYNAMIC_NATIVE_NOT_PREPARED");NativeBridgeMain.arm(jar.toFile(),workDirectory.toFile(),resolver);}
 }
 /** Reflection cannot turn failed class initialization into a successful load. */
 public static void clinit(Class<?> owner)throws Throwable{
  synchronized(GATE){var body=owner.getDeclaredMethod("tvboxClinit");body.setAccessible(true);try{body.invoke(null);}catch(InvocationTargetException failure){throw failure.getCause();}}
 }
 public static void load(String path){synchronized(GATE){loadLocked(path);}}
 private static void loadLocked(String path){
  try{
   if(ownedRoot==null||workDirectory==null)throw new IOException("DYNAMIC_NATIVE_NOT_PREPARED");
   if(path==null||!Path.of(path).isAbsolute())throw new IOException("DYNAMIC_NATIVE_ABSOLUTE_PATH_REQUIRED");
   Path source=PosixFile.resolveHost(path).toPath().toRealPath();
   if(!source.startsWith(ownedRoot)||!Files.isRegularFile(source,LinkOption.NOFOLLOW_LINKS))throw new IOException("DYNAMIC_NATIVE_OUTSIDE_ROOT");
   byte[] bytes;try(InputStream input=Files.newInputStream(source,LinkOption.NOFOLLOW_LINKS)){bytes=read(input);}
   if(bytes.length<52||bytes[0]!=0x7f||bytes[1]!='E'||bytes[2]!='L'||bytes[3]!='F'||bytes[5]!=1||bytes[6]!=1)throw new IOException("DYNAMIC_NATIVE_INVALID_ELF");
   int machine=(bytes[18]&255)|((bytes[19]&255)<<8),type=(bytes[16]&255)|((bytes[17]&255)<<8);
   if(type!=3||!(bytes[4]==1&&machine==40||bytes[4]==2&&machine==183&&bytes.length>=64))throw new IOException("DYNAMIC_NATIVE_UNSUPPORTED_ELF");
   byte[] digest=MessageDigest.getInstance("SHA-256").digest(bytes);String key=HexFormat.of().formatHex(digest);if(loaded.contains(key))return;
   Path snapshot=libraryDirectory.resolve(key+".so");Files.write(snapshot,bytes,StandardOpenOption.CREATE_NEW);
   if(guardDigest==null){NativeBridge.bridgeLoadDynamic(snapshot.toString());guardDigest=digest;}
   else NativeBridge.bridgeLoadEmbedded(snapshot.toString());
   loaded.add(key);
  }catch(IOException|RuntimeException|java.security.GeneralSecurityException failure){UnsatisfiedLinkError error=new UnsatisfiedLinkError("DYNAMIC_NATIVE_LOAD_FAILED: "+failure.getMessage());error.initCause(failure);throw error;}
 }
 private static void delete(Path directory)throws IOException{if(directory==null||!Files.exists(directory,LinkOption.NOFOLLOW_LINKS))return;try(var paths=Files.walk(directory)){for(Path path:paths.sorted(Comparator.reverseOrder()).toList())Files.deleteIfExists(path);}}
 public static void close()throws IOException{
  synchronized(GATE){try{delete(patchedDirectory);delete(libraryDirectory);}finally{ownedRoot=workDirectory=patchedDirectory=libraryDirectory=null;guardDigest=null;loaded.clear();}}
 }
}
