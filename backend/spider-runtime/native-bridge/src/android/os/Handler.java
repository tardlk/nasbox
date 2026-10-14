// SPDX-License-Identifier: GPL-3.0-only
package android.os;
public class Handler {
 public interface Callback{boolean handleMessage(Message message);}
 final ClassLoader owner=Thread.currentThread().getContextClassLoader();private final Looper looper;private final Callback callback;
 public Handler(){this(Looper.myLooper()==null?Looper.getMainLooper():Looper.myLooper(),null);}
 public Handler(Looper looper){this(looper,null);}public Handler(Callback callback){this(Looper.myLooper()==null?Looper.getMainLooper():Looper.myLooper(),callback);}
 public Handler(Looper looper,Callback callback){if(looper==null)throw new NullPointerException("looper");this.looper=looper;this.callback=callback;}
 public Looper getLooper(){return looper;}
 public boolean post(Runnable run){return postDelayed(run,0);}public boolean postDelayed(Runnable run,long delay){if(run==null)return false;return sendMessageDelayed(Message.obtain(this,run),delay);}
 public boolean postAtTime(Runnable run,long when){return sendMessageAtTime(Message.obtain(this,run),when);}
 public boolean postAtTime(Runnable run,Object token,long when){Message m=Message.obtain(this,run);m.obj=token;return sendMessageAtTime(m,when);}
 public boolean postAtFrontOfQueue(Runnable run){return sendMessageAtFrontOfQueue(Message.obtain(this,run));}
 public void handleMessage(Message message){}
 public void dispatchMessage(Message message){ClassLoader prior=Thread.currentThread().getContextClassLoader();try{Thread.currentThread().setContextClassLoader(owner);if(message.callback!=null)message.callback.run();else if(callback==null||!callback.handleMessage(message))handleMessage(message);}finally{Thread.currentThread().setContextClassLoader(prior);}}
 public final boolean sendMessage(Message m){return sendMessageDelayed(m,0);}public final boolean sendMessageDelayed(Message m,long delay){return sendMessageAtTime(m,SystemClock.uptimeMillis()+Math.max(0,delay));}
 public boolean sendMessageAtTime(Message m,long when){if(m==null)return false;m.target=this;return looper.enqueue(m,when,false);}
 public final boolean sendMessageAtFrontOfQueue(Message m){if(m==null)return false;m.target=this;return looper.enqueue(m,0,true);}
 public final boolean sendEmptyMessage(int what){return sendMessage(Message.obtain(this,what));}public final boolean sendEmptyMessageDelayed(int what,long delay){return sendMessageDelayed(Message.obtain(this,what),delay);}public final boolean sendEmptyMessageAtTime(int what,long when){return sendMessageAtTime(Message.obtain(this,what),when);}
 public void removeCallbacks(Runnable run){looper.queue.removeIf(e->e.message.target==this&&e.message.callback==run);}public void removeCallbacks(Runnable run,Object token){looper.queue.removeIf(e->e.message.target==this&&e.message.callback==run&&e.message.obj==token);}
 public final void removeMessages(int what){looper.queue.removeIf(e->e.message.target==this&&e.message.what==what);}public final void removeMessages(int what,Object object){looper.queue.removeIf(e->e.message.target==this&&e.message.what==what&&e.message.obj==object);}
 public final void removeCallbacksAndMessages(Object token){looper.queue.removeIf(e->e.message.target==this&&(token==null||e.message.obj==token));}
 public final boolean hasMessages(int what){return looper.queue.stream().anyMatch(e->e.message.target==this&&e.message.what==what);}public final boolean hasCallbacks(Runnable callback){return looper.queue.stream().anyMatch(e->e.message.target==this&&e.message.callback==callback);}
 public final Message obtainMessage(){return Message.obtain(this);}public final Message obtainMessage(int what){return Message.obtain(this,what);}public final Message obtainMessage(int what,Object object){return Message.obtain(this,what,object);}public final Message obtainMessage(int what,int a,int b){return Message.obtain(this,what,a,b);}public final Message obtainMessage(int what,int a,int b,Object object){return Message.obtain(this,what,a,b,object);}
 public static boolean isMainThread(){return Looper.myLooper()==Looper.getMainLooper();}
}
