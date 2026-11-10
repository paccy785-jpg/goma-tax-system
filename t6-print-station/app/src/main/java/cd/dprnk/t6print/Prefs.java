package cd.dprnk.t6print;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.provider.Settings;

/** What the app remembers between launches. The password is never stored. */
public final class Prefs {
    private final SharedPreferences sp;
    private final Context ctx;

    public Prefs(Context context) {
        ctx = context.getApplicationContext();
        sp = ctx.getSharedPreferences("t6print", Context.MODE_PRIVATE);
    }

    public String refreshToken() { return sp.getString("refreshToken", null); }
    public String uid() { return sp.getString("uid", null); }
    public String email() { return sp.getString("email", null); }

    public void saveAccount(String refreshToken, String uid, String email) {
        sp.edit().putString("refreshToken", refreshToken).putString("uid", uid).putString("email", email).apply();
    }

    public void updateRefreshToken(String refreshToken) {
        sp.edit().putString("refreshToken", refreshToken).apply();
    }

    public void clearAccount() {
        sp.edit().remove("refreshToken").remove("uid").remove("email").apply();
    }

    public String stationName() {
        String n = sp.getString("stationName", null);
        return n == null || n.trim().isEmpty() ? Build.MODEL : n.trim();
    }
    public void setStationName(String n) { sp.edit().putString("stationName", n).apply(); }

    /** This T6's id in Firestore — stable for the device. */
    public String stationId() {
        String id = Settings.Secure.getString(ctx.getContentResolver(), Settings.Secure.ANDROID_ID);
        if (id == null || id.isEmpty()) id = "inconnu";
        return "t6-" + id;
    }

    public String printerAddress() { return sp.getString("printerAddress", null); }
    public String printerName() { return sp.getString("printerName", ""); }
    public void setPrinter(String address, String name) {
        sp.edit().putString("printerAddress", address).putString("printerName", name).apply();
    }

    public int paperMm() { return sp.getInt("paperMm", 58); }
    public void setPaperMm(int mm) { sp.edit().putInt("paperMm", mm).apply(); }

    /** Paper width in printer dots: 384 for 58 mm, 576 for 80 mm (203 dpi). */
    public int paperDots() { return paperMm() >= 80 ? 576 : 384; }

    public boolean autoStart() { return sp.getBoolean("autoStart", true); }
    public void setAutoStart(boolean b) { sp.edit().putBoolean("autoStart", b).apply(); }
}
