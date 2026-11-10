package cd.dprnk.t6print;

/**
 * A minimal reader for SVG path data with absolute commands (M, L, H, V, Q, Z),
 * enough for the "DF" seal of the Département des Finances. Pure Java, so it
 * can be tested off the device.
 */
public final class SvgPath {
    /** Receives the outline, e.g. an android.graphics.Path. */
    public interface Sink {
        void moveTo(float x, float y);
        void lineTo(float x, float y);
        void quadTo(float x1, float y1, float x, float y);
        void close();
    }

    private SvgPath() {}

    public static void parse(String d, Sink sink) {
        final int n = d.length();
        int i = 0;
        char cmd = 0;
        float cx = 0, cy = 0, sx = 0, sy = 0;
        float[] num = new float[1];
        while (i < n) {
            char ch = d.charAt(i);
            if (Character.isWhitespace(ch) || ch == ',') {
                i++;
                continue;
            }
            if (Character.isLetter(ch) && ch != 'e' && ch != 'E') {
                cmd = ch;
                i++;
                if (cmd == 'Z' || cmd == 'z') {
                    sink.close();
                    cx = sx;
                    cy = sy;
                }
                continue;
            }
            // Numbers follow the current command; a repeated command is implicit
            // (after M the following pairs are L, as in SVG).
            switch (cmd) {
                case 'M': {
                    i = read(d, i, num); float x = num[0];
                    i = read(d, i, num); float y = num[0];
                    sink.moveTo(x, y);
                    cx = sx = x;
                    cy = sy = y;
                    cmd = 'L';
                    break;
                }
                case 'L': {
                    i = read(d, i, num); float x = num[0];
                    i = read(d, i, num); float y = num[0];
                    sink.lineTo(x, y);
                    cx = x;
                    cy = y;
                    break;
                }
                case 'H': {
                    i = read(d, i, num);
                    cx = num[0];
                    sink.lineTo(cx, cy);
                    break;
                }
                case 'V': {
                    i = read(d, i, num);
                    cy = num[0];
                    sink.lineTo(cx, cy);
                    break;
                }
                case 'Q': {
                    i = read(d, i, num); float x1 = num[0];
                    i = read(d, i, num); float y1 = num[0];
                    i = read(d, i, num); float x = num[0];
                    i = read(d, i, num); float y = num[0];
                    sink.quadTo(x1, y1, x, y);
                    cx = x;
                    cy = y;
                    break;
                }
                default:
                    throw new IllegalArgumentException("Unsupported path command '" + cmd + "' at " + i);
            }
        }
    }

    /** Reads one number starting at i (skipping separators); returns the index after it. */
    private static int read(String d, int i, float[] out) {
        final int n = d.length();
        while (i < n && (Character.isWhitespace(d.charAt(i)) || d.charAt(i) == ',')) i++;
        int start = i;
        if (i < n && (d.charAt(i) == '-' || d.charAt(i) == '+')) i++;
        boolean dot = false;
        while (i < n) {
            char c = d.charAt(i);
            if (c >= '0' && c <= '9') {
                i++;
            } else if (c == '.' && !dot) {
                dot = true;
                i++;
            } else {
                break;
            }
        }
        if (i < n && (d.charAt(i) == 'e' || d.charAt(i) == 'E')) {
            int j = i + 1;
            if (j < n && (d.charAt(j) == '-' || d.charAt(j) == '+')) j++;
            if (j < n && Character.isDigit(d.charAt(j))) {
                i = j;
                while (i < n && Character.isDigit(d.charAt(i))) i++;
            }
        }
        if (start == i) throw new IllegalArgumentException("Number expected at " + start);
        out[0] = Float.parseFloat(d.substring(start, i));
        return i;
    }
}
