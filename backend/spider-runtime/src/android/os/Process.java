// SPDX-License-Identifier: GPL-3.0-only
package android.os;
public final class Process {
 public static int myPid(){return Math.toIntExact(ProcessHandle.current().pid());}
 public static void killProcess(int pid){throw new UnsupportedOperationException("Android killProcess is unavailable");}
}
