// SPDX-License-Identifier: GPL-3.0-only
package android.graphics;

/** Host raster paint state. Fonts/rasterization are Java2D, not Android Skia. */
public class Paint {
    public static final int ANTI_ALIAS_FLAG = 1;
    public enum Style { FILL, STROKE, FILL_AND_STROKE }
    public enum Cap { BUTT, ROUND, SQUARE }
    public enum Join { MITER, ROUND, BEVEL }
    public enum Align { LEFT, CENTER, RIGHT }
    public static class FontMetrics { public float top, ascent, descent, bottom, leading; }
    private int color = 0xff000000, flags;
    private boolean antiAlias;
    private float width, textSize = 16, miter = 4;
    private Style style = Style.FILL;
    private Cap cap = Cap.BUTT;
    private Join join = Join.MITER;
    private Align align = Align.LEFT;
    private Shader shader;
    private Typeface typeface = Typeface.DEFAULT;
    public Paint() { }
    public Paint(int flags) { setFlags(flags); }
    public Paint(Paint paint) {
        if (paint == null) throw new NullPointerException("paint");
        color = paint.getColor(); flags = paint.getFlags(); width = paint.getStrokeWidth(); textSize = paint.getTextSize(); miter = paint.miter;
        antiAlias = paint.isAntiAlias();
        style = paint.rasterStyle(); cap = paint.cap; join = paint.join; align = paint.getTextAlign(); shader = paint.getShader(); typeface = paint.getTypeface();
    }
    public void setColor(int color) { this.color = color; }
    public int getColor() { return color; }
    public void setAlpha(int alpha) { if (alpha < 0 || alpha > 255) throw new IllegalArgumentException("alpha must be 0..255"); setColor(getColor() & 0xffffff | alpha << 24); }
    public int getAlpha() { return getColor() >>> 24; }
    public void setStyle(Style style) { if (style == null) throw new NullPointerException("style"); writeRasterStyle(style); }
    protected void writeRasterStyle(Style style) { this.style = style; }
    protected Style readRasterStyle() { return style; }
    public void setStrokeWidth(float width) { Path.finite(width); if (width < 0) throw new IllegalArgumentException("Negative stroke width"); this.width = width; }
    public float getStrokeWidth() { return readRasterStrokeWidth(); }
    protected float readRasterStrokeWidth() { return width; }
    public void setStrokeMiter(float miter) { Path.finite(miter); if (miter <= 0) throw new IllegalArgumentException("Invalid miter"); this.miter = miter; }
    public void setStrokeCap(Cap cap) { if (cap == null) throw new NullPointerException("cap"); this.cap = cap; }
    public void setStrokeJoin(Join join) { if (join == null) throw new NullPointerException("join"); this.join = join; }
    public void setTextSize(float size) { Path.finite(size); if (size < 0) throw new IllegalArgumentException("Negative text size"); textSize = size; }
    public float getTextSize() { return textSize; }
    public void setTextAlign(Align align) { if (align == null) throw new NullPointerException("align"); this.align = align; }
    public Align getTextAlign() { return align; }
    public void setAntiAlias(boolean value) { flags = value ? flags | ANTI_ALIAS_FLAG : flags & ~ANTI_ALIAS_FLAG; antiAlias = value; }
    public boolean isAntiAlias() { return antiAlias; }
    public void setFlags(int flags) { this.flags = flags; antiAlias = (flags & ANTI_ALIAS_FLAG) != 0; }
    public int getFlags() { return flags; }
    public Shader setShader(Shader shader) { this.shader = shader; return shader; }
    public Shader getShader() { return shader; }
    // Build-time ASM renames this to the real Android return descriptor while
    // retaining legacy TextPaint.setTypeface(Typeface):void unchanged.
    public Typeface setTypefaceForRaster(Typeface typeface) { writeRasterTypeface(typeface); return typeface; }
    protected void writeRasterTypeface(Typeface typeface) { this.typeface = typeface; }
    public Typeface getTypeface() { return typeface; }
    java.awt.Font rasterFont() {
        Typeface face = getTypeface();
        if (face == null) face = Typeface.DEFAULT;
        String token = face.toString();
        String family;
        if (token.startsWith("Typeface(monospace,")) family = java.awt.Font.MONOSPACED;
        else if (token.startsWith("Typeface(serif,")) family = java.awt.Font.SERIF;
        else if (token.startsWith("Typeface(default,") || token.startsWith("Typeface(default-bold,") || token.startsWith("Typeface(sans-serif,") || token.startsWith("Typeface(,")) family = java.awt.Font.SANS_SERIF;
        else throw new UnsupportedOperationException("Custom Android typeface has no host font mapping");
        return new java.awt.Font(family, face.getStyle(), 1).deriveFont(getTextSize());
    }
    public FontMetrics getFontMetrics() { FontMetrics result = new FontMetrics(); getFontMetrics(result); return result; }
    public float getFontMetrics(FontMetrics result) {
        java.awt.font.LineMetrics metrics = rasterFont().getLineMetrics("Hg", new java.awt.font.FontRenderContext(null, isAntiAlias(), true));
        if (result != null) { result.ascent = -metrics.getAscent(); result.top = result.ascent; result.descent = metrics.getDescent(); result.bottom = result.descent; result.leading = metrics.getLeading(); }
        return metrics.getHeight();
    }
    Style rasterStyle() { return readRasterStyle(); }
    java.awt.BasicStroke rasterStroke() { return new java.awt.BasicStroke(getStrokeWidth() == 0 ? 1 : getStrokeWidth(), cap == Cap.ROUND ? java.awt.BasicStroke.CAP_ROUND : cap == Cap.SQUARE ? java.awt.BasicStroke.CAP_SQUARE : java.awt.BasicStroke.CAP_BUTT, join == Join.ROUND ? java.awt.BasicStroke.JOIN_ROUND : join == Join.BEVEL ? java.awt.BasicStroke.JOIN_BEVEL : java.awt.BasicStroke.JOIN_MITER, miter); }
    /** Do not label host font metrics as Android's exact measurement contract. */
    public float measureText(String text) {
        throw new UnsupportedOperationException("Android Paint font metrics are unavailable in the headless host");
    }
}
