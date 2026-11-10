package cd.dprnk.t6print;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Starts receiving receipts when the T6 is switched on, if the app is set up for it. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;
        Prefs prefs = new Prefs(context);
        if (prefs.autoStart() && prefs.refreshToken() != null && prefs.printerAddress() != null) {
            PrintStationService.start(context);
        }
    }
}
