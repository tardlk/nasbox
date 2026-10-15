// SPDX-License-Identifier: GPL-3.0-only
package android.graphics;
public class RectF {
    public float left, top, right, bottom;
    public RectF() { }
    public RectF(float left, float top, float right, float bottom) { set(left, top, right, bottom); }
    public RectF(RectF value) { if (value == null) throw new NullPointerException("rect"); set(value.left, value.top, value.right, value.bottom); }
    public void set(float left, float top, float right, float bottom) { this.left = left; this.top = top; this.right = right; this.bottom = bottom; }
    public float width() { return right - left; }
    public float height() { return bottom - top; }
    public float centerX() { return (left + right) / 2; }
    public float centerY() { return (top + bottom) / 2; }
    public boolean isEmpty() { return left >= right || top >= bottom; }
}
