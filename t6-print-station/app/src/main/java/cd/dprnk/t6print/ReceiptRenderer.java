package cd.dprnk.t6print;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.text.Layout;
import android.text.StaticLayout;
import android.text.TextPaint;

import java.util.ArrayList;
import java.util.List;

/**
 * Lays a receipt out for the paper width and draws it as a black-and-white
 * picture — printed as an image, so accents (é, è, ç…) and any font size come
 * out exactly, whatever character sets the printer knows.
 */
public final class ReceiptRenderer {
    private interface Block {
        int height();
        void draw(Canvas c, int top);
    }

    private ReceiptRenderer() {}

    public static Bitmap render(List<ReceiptLine> lines, int widthDots) {
        final int margin = Math.max(6, widthDots / 48);
        final int contentW = widthDots - 2 * margin;
        final float normal = Math.round(widthDots * 0.0625f); // 24 dots on 58 mm
        final float large = Math.round(normal * 1.6f);
        final int gap = Math.round(normal * 0.35f);

        Typeface regular = Typeface.create(Typeface.SANS_SERIF, Typeface.NORMAL);
        Typeface boldFace = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD);

        List<Block> blocks = new ArrayList<>();
        for (ReceiptLine l : lines) {
            switch (l.kind) {
                case "rule":
                    blocks.add(new Block() {
                        public int height() { return Math.round(normal); }
                        public void draw(Canvas c, int top) {
                            Paint p = new Paint();
                            p.setColor(Color.BLACK);
                            p.setStrokeWidth(2);
                            int y = top + Math.round(normal / 2);
                            int dash = Math.max(6, widthDots / 48);
                            for (int x = margin; x < widthDots - margin; x += dash * 2) {
                                c.drawLine(x, y, Math.min(x + dash, widthDots - margin), y, p);
                            }
                        }
                    });
                    break;
                case "space":
                    blocks.add(new Block() {
                        public int height() { return Math.round(normal); }
                        public void draw(Canvas c, int top) {}
                    });
                    break;
                case "pair": {
                    TextPaint lp = paint(regular, normal);
                    TextPaint vp = paint(boldFace, normal);
                    float lw = lp.measureText(l.label);
                    float vw = vp.measureText(l.value);
                    if (lw + vw + normal <= contentW) {
                        // Label on the left, value on the right of the same line.
                        final float lineH = lineHeight(vp);
                        blocks.add(new Block() {
                            public int height() { return Math.round(lineH) + gap / 2; }
                            public void draw(Canvas c, int top) {
                                float base = top - vp.ascent();
                                c.drawText(l.label, margin, base, lp);
                                c.drawText(l.value, widthDots - margin - vw, base, vp);
                            }
                        });
                    } else {
                        // The value under its label, across the whole width.
                        blocks.add(textBlock(l.label, lp, Layout.Alignment.ALIGN_NORMAL, contentW, margin, 0));
                        blocks.add(textBlock(l.value, vp, Layout.Alignment.ALIGN_NORMAL, contentW, margin, gap / 2));
                    }
                    break;
                }
                default: {
                    TextPaint tp = paint(l.bold ? boldFace : regular, l.size >= 2 ? large : normal);
                    Layout.Alignment a = "center".equals(l.align)
                            ? Layout.Alignment.ALIGN_CENTER
                            : "right".equals(l.align) ? Layout.Alignment.ALIGN_OPPOSITE : Layout.Alignment.ALIGN_NORMAL;
                    blocks.add(textBlock(l.text, tp, a, contentW, margin, gap / 2));
                }
            }
        }

        int height = margin;
        for (Block b : blocks) height += b.height();
        height += margin;

        Bitmap bmp = Bitmap.createBitmap(widthDots, Math.max(height, 1), Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bmp);
        canvas.drawColor(Color.WHITE);
        int y = margin;
        for (Block b : blocks) {
            b.draw(canvas, y);
            y += b.height();
        }
        return bmp;
    }

    private static TextPaint paint(Typeface face, float size) {
        TextPaint p = new TextPaint(Paint.ANTI_ALIAS_FLAG);
        p.setColor(Color.BLACK);
        p.setTypeface(face);
        p.setTextSize(size);
        return p;
    }

    private static float lineHeight(Paint p) {
        Paint.FontMetrics fm = p.getFontMetrics();
        return fm.descent - fm.ascent;
    }

    private static Block textBlock(String text, TextPaint p, Layout.Alignment a, int width, int left, int after) {
        final StaticLayout layout = StaticLayout.Builder
                .obtain(text == null ? "" : text, 0, text == null ? 0 : text.length(), p, width)
                .setAlignment(a)
                .setIncludePad(false)
                .build();
        return new Block() {
            public int height() { return layout.getHeight() + after; }
            public void draw(Canvas c, int top) {
                c.save();
                c.translate(left, top);
                layout.draw(c);
                c.restore();
            }
        };
    }
}
