// SPDX-License-Identifier: GPL-3.0-only
package tvbox.runtime;
import java.net.*;import java.io.*;import java.util.*;
/** Real plugin listeners, tracked at translated construction/factory call sites. */
public final class NativeResources {
 private static final Map<ServerSocket,ClassLoader> listeners=new IdentityHashMap<>();
 public static synchronized ServerSocket track(ServerSocket socket){
  ClassLoader owner=StackWalker.getInstance(StackWalker.Option.RETAIN_CLASS_REFERENCE).walk(frames->frames.map(f->f.getDeclaringClass().getClassLoader()).filter(cl->cl instanceof java.net.URLClassLoader).findFirst().orElse(Thread.currentThread().getContextClassLoader()));
  listeners.put(socket,owner);return socket;
 }
 public static synchronized int count(){listeners.entrySet().removeIf(e->e.getKey().isClosed());return listeners.size();}
 private static boolean owned(ClassLoader loader,ClassLoader root){for(;loader!=null;loader=loader.getParent())if(loader==root)return true;return false;}
 public static void closeOwned(ClassLoader root)throws IOException{
  if(root==null)return;IOException failure=null;
  synchronized(NativeResources.class){for(var it=listeners.entrySet().iterator();it.hasNext();){var e=it.next();if(owned(e.getValue(),root)){try{e.getKey().close();}catch(IOException ex){failure=ex;}it.remove();}}}
  // Closing accept sockets lets plugin listener finally blocks run before URL loaders close.
  long deadline=System.nanoTime()+500_000_000L;
  for(Thread thread:Thread.getAllStackTraces().keySet())if(thread!=Thread.currentThread()&&owned(thread.getContextClassLoader(),root)){
   thread.interrupt();long remaining=deadline-System.nanoTime();if(remaining>0)try{thread.join(Math.max(1,remaining/1_000_000));}catch(InterruptedException e){Thread.currentThread().interrupt();break;}
  }
  if(failure!=null)throw failure;
 }
 public static final class OwnedServerSocket extends ServerSocket {
  public OwnedServerSocket()throws IOException{super();track(this);}public OwnedServerSocket(int port)throws IOException{super(port);track(this);}
  public OwnedServerSocket(int port,int backlog)throws IOException{super(port,backlog);track(this);}public OwnedServerSocket(int port,int backlog,InetAddress address)throws IOException{super(port,backlog,address);track(this);}
 }
}
