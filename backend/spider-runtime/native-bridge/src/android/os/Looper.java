// SPDX-License-Identifier: GPL-3.0-only
package android.os;
import java.util.*;import java.util.concurrent.*;import java.util.concurrent.atomic.AtomicLong;
/** Headless host message queue. Real dispatch/cancellation; not an Android UI thread. */
public final class Looper {
 private static final ThreadLocal<Looper> CURRENT=new ThreadLocal<>();
 private static final Set<Looper> ALL=Collections.newSetFromMap(new ConcurrentHashMap<>());
 private static final AtomicLong SEQUENCE=new AtomicLong();
 private static final Looper MAIN=main();
 final DelayQueue<Entry> queue=new DelayQueue<>();private final Thread thread;private final ClassLoader owner;private volatile boolean quit,safe;
 private Looper(Thread thread,ClassLoader owner){this.thread=thread;this.owner=owner;ALL.add(this);}
 private static Looper main(){final Looper[] box=new Looper[1];Thread t=new Thread(()->{CURRENT.set(box[0]);box[0].dispatch();},"tvbox-native-main");t.setDaemon(true);box[0]=new Looper(t,null);t.start();return box[0];}
 public static Looper getMainLooper(){return MAIN;}
 public static Looper myLooper(){return CURRENT.get();}
 public static void prepare(){if(CURRENT.get()!=null)throw new RuntimeException("Only one Looper per thread");CURRENT.set(new Looper(Thread.currentThread(),Thread.currentThread().getContextClassLoader()));}
 public static void prepareMainLooper(){throw new IllegalStateException("Host main looper already prepared");}
 public static void loop(){Looper l=myLooper();if(l==null)throw new RuntimeException("No Looper prepared");l.dispatch();}
 public Thread getThread(){return thread;}
 public boolean isCurrentThread(){return thread==Thread.currentThread();}
 public void quit(){stop(false);}
 public void quitSafely(){stop(true);}
 private void stop(boolean safely){safe=safely;quit=true;if(safely)queue.removeIf(e->e.when>SystemClock.uptimeMillis());else queue.clear();thread.interrupt();}
 boolean enqueue(Message m,long when,boolean front){if(quit)return false;m.when=when;queue.add(new Entry(m,front?0:when,front?-SEQUENCE.incrementAndGet():SEQUENCE.incrementAndGet()));return true;}
 private void dispatch(){try{while(!quit||safe&&!queue.isEmpty()){try{Entry e=queue.take();e.message.target.dispatchMessage(e.message);}catch(InterruptedException e){if(!quit)continue;}catch(Throwable e){e.printStackTrace(System.err);}}}finally{ALL.remove(this);CURRENT.remove();}}
 static boolean descendant(ClassLoader cl,ClassLoader root){for(;cl!=null;cl=cl.getParent())if(cl==root)return true;return false;}
 public static void cancelOwned(ClassLoader root){if(root==null)return;for(Looper l:new ArrayList<>(ALL)){l.queue.removeIf(e->descendant(e.message.target.owner,root));if(l!=MAIN&&descendant(l.owner,root))l.quit();}}
 static final class Entry implements Delayed{final Message message;final long when,sequence;Entry(Message m,long when,long seq){message=m;this.when=when;sequence=seq;}public long getDelay(TimeUnit unit){return unit.convert(when-SystemClock.uptimeMillis(),TimeUnit.MILLISECONDS);}public int compareTo(Delayed other){Entry e=(Entry)other;int value=Long.compare(when,e.when);return value==0?Long.compare(sequence,e.sequence):value;}}
}
