// SPDX-License-Identifier: GPL-3.0-only
package android.graphics;
public class LinearGradient extends Shader {
    private final java.awt.LinearGradientPaint paint;
    public LinearGradient(float x0, float y0, float x1, float y1, int color0, int color1, TileMode tile) {
        this(x0, y0, x1, y1, new int[]{color0, color1}, null, tile);
    }
    public LinearGradient(float x0, float y0, float x1, float y1, int[] colors, float[] positions, TileMode tile) {
        Path.finite(x0, y0, x1, y1);
        if (tile == null || colors == null) throw new NullPointerException();
        if (tile == TileMode.DECAL) throw new UnsupportedOperationException("DECAL gradient tile mode");
        if (colors.length < 2 || positions != null && positions.length != colors.length) throw new IllegalArgumentException("Gradient color positions differ");
        float[] stops = positions == null ? new float[colors.length] : positions.clone();
        java.awt.Color[] values = new java.awt.Color[colors.length];
        for (int i = 0; i < colors.length; i++) { values[i] = new java.awt.Color(colors[i], true); if (positions == null) stops[i] = (float) i / (colors.length - 1); }
        // Java2D requires distinct stops. Unsupported duplicate/unsorted stops
        // fail explicitly instead of silently changing a hard color boundary.
        java.awt.MultipleGradientPaint.CycleMethod cycle = tile == TileMode.CLAMP ? java.awt.MultipleGradientPaint.CycleMethod.NO_CYCLE : tile == TileMode.REPEAT ? java.awt.MultipleGradientPaint.CycleMethod.REPEAT : java.awt.MultipleGradientPaint.CycleMethod.REFLECT;
        paint = new java.awt.LinearGradientPaint(x0, y0, x1, y1, stops, values, cycle);
    }
    @Override java.awt.Paint rasterPaint() { return paint; }
}
