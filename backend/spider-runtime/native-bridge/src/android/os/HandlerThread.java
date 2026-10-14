// SPDX-License-Identifier: GPL-3.0-only
package android.os;
public class HandlerThread extends Thread {
 private Looper looper;public HandlerThread(String name){super(name);setDaemon(true);}public HandlerThread(String name,int priority){this(name);}
 protected void onLooperPrepared(){}
 public void run(){Looper.prepare();synchronized(this){looper=Looper.myLooper();notifyAll();}onLooperPrepared();Looper.loop();}
 public synchronized Looper getLooper(){while(isAlive()&&looper==null)try{wait();}catch(InterruptedException e){Thread.currentThread().interrupt();return null;}return looper;}
 public boolean quit(){Looper l=getLooper();if(l==null)return false;l.quit();return true;}public boolean quitSafely(){Looper l=getLooper();if(l==null)return false;l.quitSafely();return true;}
 public int getThreadId(){return (int)getId();}
}
