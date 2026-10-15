// SPDX-License-Identifier: GPL-3.0-only
package tvbox.runtime;
import java.io.*;
import java.nio.channels.*;
import java.nio.file.*;
import java.nio.file.attribute.*;
import java.util.*;
import com.google.gson.JsonObject;
/** Aggregate persistent DEX/module cache only. Converter workspace and plugin files are separate. */
public final class RuntimeCache {
 private static Path root;
 private static long limit;
 private static Path workspace;
 private static String workspacePrefix;
 private static long evicted,rejected;
 private static final Set<String> pinned=new HashSet<>();
 private static final Map<Path,FileChannel> guards=new HashMap<>();
 private static final List<FileLock> locks=new ArrayList<>();
 private record Entry(String key,List<Path> files,long bytes,long accessed,boolean dex){}
 public static synchronized void initialize()throws IOException {
  if(root!=null)return;
  long configured=Long.getLong("tvbox.cache.maxBytes",256L*1024*1024);
  if(configured<=0)throw new IOException("INVALID_RUNTIME_CACHE_LIMIT");
  root=HostServices.directory.toPath().toAbsolutePath().normalize();limit=configured;
  Files.createDirectories(root);root=root.toRealPath();holdGuard(root.resolve(".users"));
  for(String name:List.of("dex-cache","module-cache")){
   Path dir=root.resolve(name);Files.createDirectories(dir);
   if(Files.isSymbolicLink(dir))throw new IOException("RUNTIME_CACHE_SYMLINK");
   try(var entries=Files.list(dir)){for(Path path:entries.toList()){
    String filename=path.getFileName().toString();
    if(filename.matches("\\.incoming-[a-f0-9-]+\\.(jar|sha256|js)")||filename.matches("module-[0-9]+\\.tmp"))Files.deleteIfExists(path);
    // Old converters staged inside the persistent cache. Delete only owned named trees.
    if(name.equals("dex-cache")&&filename.matches("convert-[0-9]+")&&Files.isDirectory(path,LinkOption.NOFOLLOW_LINKS))deleteTree(path);
   }}
  }
  Path temporary=root.resolve("tmp");Files.createDirectories(temporary);
  if(Files.isSymbolicLink(temporary))throw new IOException("RUNTIME_CACHE_SYMLINK");
  try(var entries=Files.list(temporary)){for(Path path:entries.toList())if(path.getFileName().toString().matches("tvbox-convert-[0-9]+")&&Files.isDirectory(path,LinkOption.NOFOLLOW_LINKS))deleteTree(path);}
  workspace=Path.of(System.getProperty("tvbox.cache.workspace",temporary.toString()));Files.createDirectories(workspace);workspace=workspace.toRealPath();
  workspacePrefix="tvbox-convert-"+UUID.nameUUIDFromBytes(root.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8))+"-";
  try(var entries=Files.list(workspace)){for(Path path:entries.toList())if(path.getFileName().toString().matches(java.util.regex.Pattern.quote(workspacePrefix)+"[0-9]+")&&Files.isDirectory(path,LinkOption.NOFOLLOW_LINKS))deleteTree(path);}
  reserve(0,null);
 }
 public static synchronized Path createWorkspace()throws IOException {initialize();return Files.createTempDirectory(workspace,workspacePrefix);}
 private static void deleteTree(Path path)throws IOException {try(var walk=Files.walk(path)){for(Path file:walk.sorted(Comparator.reverseOrder()).toList())Files.deleteIfExists(file);}}
 public static synchronized void holdGuard(Path path)throws IOException {
  Path normalized=path.toAbsolutePath().normalize();if(Files.isSymbolicLink(normalized))throw new IOException("CACHE_GUARD_SYMLINK");if(!Files.exists(normalized,LinkOption.NOFOLLOW_LINKS))try{Files.createFile(normalized);}catch(FileAlreadyExistsException ignored){}normalized=normalized.toRealPath();if(guards.containsKey(normalized))return;
  FileChannel channel=FileChannel.open(normalized,StandardOpenOption.CREATE,StandardOpenOption.READ,StandardOpenOption.WRITE,LinkOption.NOFOLLOW_LINKS);
  try{FileLock lock=channel.lock(0,Long.MAX_VALUE,true);guards.put(normalized,channel);locks.add(lock);}catch(IOException|RuntimeException e){channel.close();throw e;}
 }
 private static List<Entry> entries()throws IOException {
  Map<String,List<Path>> grouped=new HashMap<>();
  for(String name:List.of("dex-cache","module-cache")){
   try(var stream=Files.list(root.resolve(name))){for(Path path:stream.toList()){
    String file=path.getFileName().toString(),key;
    if(name.equals("dex-cache")&&file.matches("[a-f0-9]{64}\\.(jar|sha256)"))key="dex:"+file.substring(0,64);
    else if(name.equals("module-cache")&&file.matches("qjscache_[a-fA-F0-9]{32}\\.js"))key="module:"+file;
    else continue;
    grouped.computeIfAbsent(key,k->new ArrayList<>()).add(path);
   }}
  }
  List<Entry> result=new ArrayList<>();
  for(var group:grouped.entrySet()){
   long bytes=0,accessed=0;
   for(Path path:group.getValue()){var attr=Files.readAttributes(path,BasicFileAttributes.class,LinkOption.NOFOLLOW_LINKS);bytes+=attr.size();accessed=Math.max(accessed,attr.lastModifiedTime().toMillis());}
   result.add(new Entry(group.getKey(),group.getValue(),bytes,accessed,group.getKey().startsWith("dex:")));
  }
  return result;
 }
 private static void reserve(long extra,String protect)throws IOException {
  List<Entry> all=entries();long total=all.stream().mapToLong(Entry::bytes).sum();
  List<Entry> victims=new ArrayList<>();
  for(Entry entry:all.stream().sorted(Comparator.comparingLong(Entry::accessed).thenComparing(Entry::key)).toList()){
   if(total+extra<=limit)break;
   if(entry.key.equals(protect)||pinned.contains(entry.key))continue;
   victims.add(entry);total-=entry.bytes;
  }
  if(total+extra>limit){rejected++;throw new IOException("RUNTIME_CACHE_QUOTA");}
  for(Entry entry:victims){for(Path path:entry.files)Files.deleteIfExists(path);evicted++;}
 }
 public static synchronized void pinDex(Path path)throws IOException {
  initialize();if(!path.getParent().equals(root.resolve("dex-cache")))throw new IOException("INVALID_DEX_CACHE_PATH");
  String name=path.getFileName().toString();if(!name.matches("[a-f0-9]{64}\\.jar"))throw new IOException("INVALID_DEX_CACHE_PATH");
  pinned.add("dex:"+name.substring(0,64));touch(path.resolveSibling(name.substring(0,64)+".sha256"));
 }
 public static synchronized void touch(Path path)throws IOException {if(Files.isSymbolicLink(path))throw new IOException("RUNTIME_CACHE_SYMLINK");Files.setLastModifiedTime(path,FileTime.fromMillis(System.currentTimeMillis()));}
 public static synchronized void writeDex(Path source,Path target,String digest)throws IOException {
  initialize();target=target.getParent().toRealPath().resolve(target.getFileName());String filename=target.getFileName().toString();
  if(!target.getParent().equals(root.resolve("dex-cache"))||!filename.matches("[a-f0-9]{64}\\.jar")||!digest.matches("[a-f0-9]{64}"))throw new IOException("INVALID_DEX_CACHE_PATH");
  String key="dex:"+filename.substring(0,64);
  if(pinned.contains(key))throw new IOException("PINNED_DEX_CACHE_CORRUPT");
  long bytes=Files.size(source);if(bytes>96L*1024*1024)throw new IOException("CONVERTED_ARTIFACT_LIMIT");
  reserve(bytes+64,key);
  Path jar=target.getParent().resolve(".incoming-"+UUID.randomUUID()+".jar"),stamp=target.getParent().resolve(".incoming-"+UUID.randomUUID()+".sha256");
  try{
   Files.copy(source,jar);Files.writeString(stamp,digest,StandardOpenOption.CREATE_NEW);
   Files.move(jar,target,StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE);
   Files.move(stamp,target.resolveSibling(filename.substring(0,64)+".sha256"),StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE);
  }finally{Files.deleteIfExists(jar);Files.deleteIfExists(stamp);}
  pinDex(target);
 }
 public static synchronized void writeModule(byte[] bytes,Path target)throws IOException {
  initialize();target=target.getParent().toRealPath().resolve(target.getFileName());String filename=target.getFileName().toString();
  if(!target.getParent().equals(root.resolve("module-cache"))||!filename.matches("qjscache_[a-fA-F0-9]{32}\\.js"))throw new IOException("INVALID_MODULE_CACHE_PATH");
  reserve(bytes.length,"module:"+filename);
  Path staging=target.getParent().resolve(".incoming-"+UUID.randomUUID()+".js");
  try{Files.write(staging,bytes,StandardOpenOption.CREATE_NEW);Files.move(staging,target,StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE);}finally{Files.deleteIfExists(staging);}
 }
 public static synchronized JsonObject snapshot()throws IOException {
  initialize();JsonObject value=new JsonObject();List<Entry> all=entries();
  value.addProperty("maxBytes",limit);value.addProperty("bytes",all.stream().mapToLong(Entry::bytes).sum());
  value.addProperty("dexBytes",all.stream().filter(Entry::dex).mapToLong(Entry::bytes).sum());
  value.addProperty("moduleBytes",all.stream().filter(e->!e.dex).mapToLong(Entry::bytes).sum());
  value.addProperty("entries",all.size());value.addProperty("pinnedDexEntries",pinned.size());value.addProperty("evictedEntries",evicted);value.addProperty("rejectedWrites",rejected);
  return value;
 }
 public static synchronized void close()throws IOException {
  IOException error=null;for(FileLock lock:locks)try{lock.release();}catch(IOException e){error=e;}
  for(FileChannel channel:guards.values())try{channel.close();}catch(IOException e){error=e;}
  locks.clear();guards.clear();pinned.clear();root=null;if(error!=null)throw error;
 }
}
