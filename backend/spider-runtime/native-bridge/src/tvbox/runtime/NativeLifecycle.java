// SPDX-License-Identifier: GPL-3.0-only
package tvbox.runtime;

import java.io.IOException;
import java.util.concurrent.TimeUnit;

/** Excludes emulator destruction while preserving parallel guard/payload VMs.
 * Waiting does not close admission: a guard JNI call may await a new Java
 * thread's payload call. Only an observed zero count closes admission atomically.
 * A deadline failure leaves the emulator alive for the owning worker to exit.
 */
public final class NativeLifecycle {
    private static int active;
    private static boolean closed;
    private NativeLifecycle() { }
    public static synchronized void enter() {
        if (closed) throw new IllegalStateException("NATIVE_BRIDGE_CLOSED");
        active++;
    }
    public static synchronized void leave() {
        if (active <= 0) throw new IllegalStateException("NATIVE_LIFECYCLE_UNBALANCED");
        if (--active == 0) NativeLifecycle.class.notifyAll();
    }
    public static synchronized void open() {
        if (active != 0) throw new IllegalStateException("NATIVE_BRIDGE_STILL_ACTIVE");
        closed = false;
    }
    public static void quiesce() throws IOException { quiesce(5000); }
    public static synchronized void quiesce(long timeoutMs) throws IOException {
        if (timeoutMs <= 0 || timeoutMs > 60000) throw new IllegalArgumentException("Invalid native close deadline");
        long deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMs);
        while (active != 0) {
            long remaining = deadline - System.nanoTime();
            if (remaining <= 0) throw new IOException("NATIVE_BRIDGE_STILL_EXECUTING: " + active);
            try { TimeUnit.NANOSECONDS.timedWait(NativeLifecycle.class, remaining); }
            catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                throw new IOException("NATIVE_BRIDGE_CLOSE_INTERRUPTED", interrupted);
            }
        }
        closed = true;
    }
}
