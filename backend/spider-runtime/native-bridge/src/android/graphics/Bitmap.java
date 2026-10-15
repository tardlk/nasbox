// SPDX-License-Identifier: GPL-3.0-only
package android.graphics;

import java.awt.image.BufferedImage;
import java.io.IOException;
import java.io.OutputStream;
import javax.imageio.ImageIO;

/** Bounded host ARGB raster. Java2D/ImageIO output is not Android Skia parity. */
public final class Bitmap {
    public enum Config { ALPHA_8, RGB_565, ARGB_4444, ARGB_8888, RGBA_F16, HARDWARE }
    public enum CompressFormat { JPEG, PNG, WEBP, WEBP_LOSSY, WEBP_LOSSLESS }
    private BufferedImage image;
    private boolean recycled;
    private Bitmap(int width, int height) { image = new BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB); }
    public static Bitmap createBitmap(int width, int height, Config config) {
        if (width <= 0 || height <= 0) throw new IllegalArgumentException("Bitmap dimensions must be positive");
        if ((long) width * height > 16L * 1024 * 1024) throw new IllegalArgumentException("Host bitmap exceeds 64 MiB pixel limit");
        if (config == null) throw new NullPointerException("config");
        if (config != Config.ARGB_8888) throw new UnsupportedOperationException("Host bitmap config: " + config);
        return new Bitmap(width, height);
    }
    BufferedImage raster() { if (recycled) throw new IllegalStateException("Bitmap is recycled"); return image; }
    public int getWidth() { return raster().getWidth(); }
    public int getHeight() { return raster().getHeight(); }
    public Config getConfig() { raster(); return Config.ARGB_8888; }
    public boolean isMutable() { return !recycled; }
    public boolean isRecycled() { return recycled; }
    public void recycle() { if (!recycled) { image.flush(); image = null; recycled = true; } }
    public int getPixel(int x, int y) { checkPoint(x, y); return image.getRGB(x, y); }
    public void setPixel(int x, int y, int color) { checkPoint(x, y); image.setRGB(x, y, color); }
    private void checkPoint(int x, int y) { BufferedImage value = raster(); if (x < 0 || y < 0 || x >= value.getWidth() || y >= value.getHeight()) throw new IllegalArgumentException("Pixel is outside bitmap"); }
    public void eraseColor(int color) { BufferedImage value = raster(); int[] row = new int[value.getWidth()]; java.util.Arrays.fill(row, color); for (int y = 0; y < value.getHeight(); y++) value.setRGB(0, y, row.length, 1, row, 0, row.length); }
    public boolean compress(CompressFormat format, int quality, OutputStream stream) {
        BufferedImage value = raster();
        if (format == null || stream == null) throw new NullPointerException();
        if (quality < 0 || quality > 100) throw new IllegalArgumentException("quality must be 0..100");
        if (format != CompressFormat.PNG) throw new UnsupportedOperationException("Host compression format: " + format);
        // ImageIO otherwise creates disk caches outside the owned worker data.
        try (javax.imageio.stream.MemoryCacheImageOutputStream output = new javax.imageio.stream.MemoryCacheImageOutputStream(stream)) {
            boolean written = ImageIO.write(value, "png", output); output.flush(); return written;
        } catch (IOException error) { return false; }
    }
}
