// SPDX-License-Identifier: GPL-3.0-only
package android.graphics;

/**
 * Minimal headless superclass for the host TextPaint binding. The Android API
 * artifact contains throwing SDK constructors, not an executable Paint runtime.
 * This adapter only supplies construction and the observed virtual descriptor.
 */
public class Paint {
    public Paint() {
    }

    public Paint(int flags) {
    }

    public Paint(Paint paint) {
        if (paint == null) throw new NullPointerException("paint");
    }

    /** A subclass may supply metrics; this host has no Android font renderer. */
    public float measureText(String text) {
        throw new UnsupportedOperationException("Android Paint font metrics are unavailable in the headless host");
    }
}
