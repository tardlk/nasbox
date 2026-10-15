// SPDX-License-Identifier: GPL-3.0-only
package android.graphics;
public class Path {
    private final java.awt.geom.Path2D.Float path = new java.awt.geom.Path2D.Float();
    public Path() { }
    public Path(Path other) { if (other == null) throw new NullPointerException("path"); path.append(other.path, false); }
    public void moveTo(float x, float y) { finite(x, y); path.moveTo(x, y); }
    public void lineTo(float x, float y) { finite(x, y); ensureStart(); path.lineTo(x, y); }
    public void quadTo(float x1, float y1, float x2, float y2) { finite(x1, y1, x2, y2); ensureStart(); path.quadTo(x1, y1, x2, y2); }
    public void cubicTo(float x1, float y1, float x2, float y2, float x3, float y3) { finite(x1, y1, x2, y2, x3, y3); ensureStart(); path.curveTo(x1, y1, x2, y2, x3, y3); }
    public void close() { if (path.getCurrentPoint() != null) path.closePath(); }
    public void reset() { path.reset(); }
    public void rewind() { path.reset(); }
    public boolean isEmpty() { return path.getCurrentPoint() == null; }
    private void ensureStart() { if (path.getCurrentPoint() == null) path.moveTo(0, 0); }
    java.awt.Shape shape() { return path; }
    static void finite(float... values) { for (float value : values) if (!Float.isFinite(value)) throw new IllegalArgumentException("Non-finite graphics coordinate"); }
}
