package cd.dprnk.t6print;

import android.graphics.Bitmap;

import java.io.ByteArrayOutputStream;

/** ESC/POS commands: the receipt picture as raster bands, then a paper feed. */
public final class EscPos {
    private EscPos() {}

    public static byte[] receipt(Bitmap bmp, int feedLines) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.write(0x1B);
        out.write(0x40); // ESC @ — initialise
        int w = bmp.getWidth();
        int h = bmp.getHeight();
        int bytesPerRow = (w + 7) / 8;
        int[] row = new int[w];
        // Bands of at most 128 rows, so small printer buffers keep up.
        for (int top = 0; top < h; top += 128) {
            int band = Math.min(128, h - top);
            out.write(0x1D);
            out.write(0x76);
            out.write(0x30);
            out.write(0x00); // GS v 0, normal size
            out.write(bytesPerRow & 0xFF);
            out.write((bytesPerRow >> 8) & 0xFF);
            out.write(band & 0xFF);
            out.write((band >> 8) & 0xFF);
            for (int y = top; y < top + band; y++) {
                bmp.getPixels(row, 0, w, 0, y, w, 1);
                for (int bx = 0; bx < bytesPerRow; bx++) {
                    int b = 0;
                    for (int bit = 0; bit < 8; bit++) {
                        int x = bx * 8 + bit;
                        if (x < w && isDark(row[x])) b |= 0x80 >> bit;
                    }
                    out.write(b);
                }
            }
        }
        out.write(0x1B);
        out.write(0x64);
        out.write(Math.max(0, Math.min(feedLines, 10))); // ESC d n — feed n lines
        return out.toByteArray();
    }

    private static boolean isDark(int argb) {
        int a = (argb >>> 24) & 0xFF;
        if (a < 128) return false;
        int r = (argb >> 16) & 0xFF;
        int g = (argb >> 8) & 0xFF;
        int b = argb & 0xFF;
        return (r * 299 + g * 587 + b * 114) / 1000 < 150;
    }
}
