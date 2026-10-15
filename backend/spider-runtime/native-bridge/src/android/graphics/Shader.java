// SPDX-License-Identifier: GPL-3.0-only
package android.graphics;
public class Shader {
    public enum TileMode { CLAMP, REPEAT, MIRROR, DECAL }
    public Shader() { }
    java.awt.Paint rasterPaint() { throw new UnsupportedOperationException("Unsupported host shader: " + getClass().getName()); }
}
