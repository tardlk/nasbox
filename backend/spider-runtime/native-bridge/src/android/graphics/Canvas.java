// SPDX-License-Identifier: GPL-3.0-only
package android.graphics;

import java.awt.AlphaComposite;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.Shape;
import java.awt.geom.*;

/** Actual headless host rasterization for observed logo drawing operations. */
public class Canvas {
    private final Bitmap bitmap;
    public Canvas() { throw new UnsupportedOperationException("Host Canvas requires a raster bitmap"); }
    public Canvas(Bitmap bitmap) { if (bitmap == null) throw new NullPointerException("bitmap"); bitmap.raster(); this.bitmap = bitmap; }
    public int getWidth() { return bitmap.getWidth(); }
    public int getHeight() { return bitmap.getHeight(); }
    private Graphics2D graphics(Paint paint) {
        if (paint == null) throw new NullPointerException("paint");
        Graphics2D graphics = bitmap.raster().createGraphics();
        try {
            graphics.setRenderingHint(RenderingHints.KEY_ANTIALIASING, paint.isAntiAlias() ? RenderingHints.VALUE_ANTIALIAS_ON : RenderingHints.VALUE_ANTIALIAS_OFF);
            graphics.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, paint.isAntiAlias() ? RenderingHints.VALUE_TEXT_ANTIALIAS_ON : RenderingHints.VALUE_TEXT_ANTIALIAS_OFF);
            Shader shader = paint.getShader();
            graphics.setComposite(AlphaComposite.getInstance(AlphaComposite.SRC_OVER, shader == null ? 1f : paint.getAlpha() / 255f));
            graphics.setPaint(shader == null ? new java.awt.Color(paint.getColor(), true) : shader.rasterPaint());
            graphics.setStroke(paint.rasterStroke());
            return graphics;
        } catch (RuntimeException | Error error) { graphics.dispose(); throw error; }
    }
    private void draw(Shape shape, Paint paint, boolean line) {
        Graphics2D graphics = graphics(paint);
        try {
            if (line || paint.rasterStyle() == Paint.Style.STROKE) graphics.draw(shape);
            else { graphics.fill(shape); if (paint.rasterStyle() == Paint.Style.FILL_AND_STROKE) graphics.draw(shape); }
        } finally { graphics.dispose(); }
    }
    public void drawColor(int color) { Paint paint = new Paint(); paint.setColor(color); drawRect(0, 0, getWidth(), getHeight(), paint); }
    public void drawRect(float left, float top, float right, float bottom, Paint paint) { Path.finite(left, top, right, bottom); draw(new Rectangle2D.Float(left, top, right - left, bottom - top), paint, false); }
    public void drawRect(RectF rect, Paint paint) { if (rect == null) throw new NullPointerException("rect"); drawRect(rect.left, rect.top, rect.right, rect.bottom, paint); }
    public void drawRoundRect(RectF rect, float rx, float ry, Paint paint) { if (rect == null) throw new NullPointerException("rect"); Path.finite(rect.left, rect.top, rect.right, rect.bottom, rx, ry); if (rx < 0 || ry < 0) throw new IllegalArgumentException("Negative corner radius"); draw(new RoundRectangle2D.Float(rect.left, rect.top, rect.width(), rect.height(), rx * 2, ry * 2), paint, false); }
    public void drawCircle(float x, float y, float radius, Paint paint) { Path.finite(x, y, radius); if (radius < 0) throw new IllegalArgumentException("Negative circle radius"); draw(new Ellipse2D.Float(x - radius, y - radius, radius * 2, radius * 2), paint, false); }
    public void drawOval(RectF oval, Paint paint) { if (oval == null) throw new NullPointerException("oval"); Path.finite(oval.left, oval.top, oval.right, oval.bottom); draw(new Ellipse2D.Float(oval.left, oval.top, oval.width(), oval.height()), paint, false); }
    public void drawLine(float x1, float y1, float x2, float y2, Paint paint) { Path.finite(x1, y1, x2, y2); draw(new Line2D.Float(x1, y1, x2, y2), paint, true); }
    public void drawArc(RectF oval, float startAngle, float sweepAngle, boolean useCenter, Paint paint) { if (oval == null) throw new NullPointerException("oval"); Path.finite(oval.left, oval.top, oval.right, oval.bottom, startAngle, sweepAngle); draw(new Arc2D.Float(oval.left, oval.top, oval.width(), oval.height(), -startAngle, -sweepAngle, useCenter ? Arc2D.PIE : Arc2D.OPEN), paint, false); }
    public void drawPath(Path path, Paint paint) { if (path == null) throw new NullPointerException("path"); draw(path.shape(), paint, false); }
    public void drawText(String text, float x, float y, Paint paint) {
        if (text == null || paint == null) throw new NullPointerException(); Path.finite(x, y);
        Graphics2D graphics = graphics(paint);
        try {
            java.awt.Font font = paint.rasterFont();
            java.awt.font.GlyphVector glyphs = font.createGlyphVector(graphics.getFontRenderContext(), text);
            float width = (float) glyphs.getLogicalBounds().getWidth();
            if (paint.getTextAlign() == Paint.Align.CENTER) x -= width / 2; else if (paint.getTextAlign() == Paint.Align.RIGHT) x -= width;
            Shape shape = glyphs.getOutline(x, y);
            if (paint.rasterStyle() != Paint.Style.STROKE) graphics.fill(shape);
            if (paint.rasterStyle() != Paint.Style.FILL) graphics.draw(shape);
        } finally { graphics.dispose(); }
    }
}
