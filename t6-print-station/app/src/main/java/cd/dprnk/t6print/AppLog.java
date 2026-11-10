package cd.dprnk.t6print;

import java.text.SimpleDateFormat;
import java.util.ArrayDeque;
import java.util.Date;
import java.util.Locale;

/** The last lines of activity, shown on the app's screen. */
public final class AppLog {
    private static final int MAX = 80;
    private static final ArrayDeque<String> LINES = new ArrayDeque<>();
    private static volatile String status = "Arrêté";

    private AppLog() {}

    public static synchronized void add(String message) {
        String time = new SimpleDateFormat("HH:mm:ss", Locale.FRANCE).format(new Date());
        LINES.addFirst(time + "  " + message);
        while (LINES.size() > MAX) LINES.removeLast();
        android.util.Log.i("T6Print", message);
    }

    public static synchronized String text() {
        StringBuilder sb = new StringBuilder();
        for (String l : LINES) sb.append(l).append('\n');
        return sb.toString();
    }

    public static void setStatus(String s) {
        status = s;
    }

    public static String status() {
        return status;
    }
}
