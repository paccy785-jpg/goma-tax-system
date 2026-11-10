package cd.dprnk.t6print;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Runs in the background on the T6: reports the station as online, watches for
 * print jobs addressed to it, prints each one on the built-in printer and
 * reports the result back to the DPRNK app.
 */
public class PrintStationService extends Service {
    private static final String CHANNEL = "print_station";
    private static final int NOTIF_ID = 6;
    private static final long POLL_MS = 2500;
    private static final long HEARTBEAT_MS = 30_000;
    /** A job left waiting longer than this (T6 off for hours) is not printed any more. */
    private static final long MAX_JOB_AGE_MS = 12L * 60 * 60 * 1000;
    public static final String VERSION = "1.0.0";

    private static volatile boolean running;
    private Thread worker;
    private PowerManager.WakeLock wakeLock;

    public static boolean isRunning() {
        return running;
    }

    public static void start(Context ctx) {
        Intent i = new Intent(ctx, PrintStationService.class);
        if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i);
        else ctx.startService(i);
    }

    public static void stop(Context ctx) {
        ctx.stopService(new Intent(ctx, PrintStationService.class));
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        startForeground(NOTIF_ID, notification("En attente des reçus à imprimer"));
        if (worker == null || !worker.isAlive()) {
            running = true;
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "t6print:station");
            wakeLock.acquire();
            worker = new Thread(this::loop, "print-station");
            worker.start();
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        if (worker != null) worker.interrupt();
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        AppLog.setStatus("Arrêté");
        AppLog.add("Réception des reçus arrêtée");
        super.onDestroy();
    }

    private void loop() {
        Prefs prefs = new Prefs(this);
        FirestoreRest fs = new FirestoreRest(this);
        long lastBeat = 0;
        long backoff = POLL_MS;
        AppLog.add("Réception des reçus démarrée — " + prefs.stationName());
        while (running) {
            try {
                long now = System.currentTimeMillis();
                if (now - lastBeat > HEARTBEAT_MS) {
                    heartbeat(fs, prefs);
                    lastBeat = now;
                    AppLog.setStatus("En ligne — en attente des reçus");
                }
                for (Job job : pendingJobs(fs, prefs)) {
                    process(fs, prefs, job);
                }
                backoff = POLL_MS;
            } catch (Exception e) {
                AppLog.setStatus("Hors ligne — nouvelle tentative…");
                AppLog.add("Erreur : " + e.getMessage());
                backoff = Math.min(backoff * 2, 30_000);
                lastBeat = 0;
            }
            try {
                Thread.sleep(backoff);
            } catch (InterruptedException e) {
                break;
            }
        }
    }

    /** printStations/{id}: this T6, online now. */
    private void heartbeat(FirestoreRest fs, Prefs prefs) throws Exception {
        JSONObject f = new JSONObject()
                .put("name", FirestoreRest.str(prefs.stationName()))
                .put("model", FirestoreRest.str(Build.MODEL))
                .put("printerName", FirestoreRest.str(prefs.printerName()))
                .put("paperMm", FirestoreRest.num(prefs.paperMm()))
                .put("lastSeenAt", FirestoreRest.str(iso(System.currentTimeMillis())))
                .put("appVersion", FirestoreRest.str(VERSION));
        fs.patch("printStations/" + prefs.stationId(), f,
                new String[] {"name", "model", "printerName", "paperMm", "lastSeenAt", "appVersion"}, null);
    }

    private static final class Job {
        String name;
        String updateTime;
        String title;
        String createdAt;
        List<ReceiptLine> lines;
    }

    /** printJobs for this station still pending, oldest first. */
    private List<Job> pendingJobs(FirestoreRest fs, Prefs prefs) throws Exception {
        JSONObject q = new JSONObject()
                .put("from", new JSONArray().put(new JSONObject().put("collectionId", "printJobs")))
                .put("where", new JSONObject().put("compositeFilter", new JSONObject()
                        .put("op", "AND")
                        .put("filters", new JSONArray()
                                .put(eq("stationId", prefs.stationId()))
                                .put(eq("status", "pending")))))
                .put("limit", 20);
        JSONArray docs = fs.query(q);
        List<Job> jobs = new ArrayList<>();
        for (int i = 0; i < docs.length(); i++) {
            JSONObject d = docs.getJSONObject(i);
            JSONObject fields = d.optJSONObject("fields");
            Job j = new Job();
            j.name = d.getString("name");
            j.updateTime = d.optString("updateTime", null);
            j.title = FirestoreRest.getStr(fields, "title");
            j.createdAt = FirestoreRest.getStr(fields, "createdAt");
            j.lines = ReceiptLine.fromFirestore(fields);
            jobs.add(j);
        }
        Collections.sort(jobs, (a, b) -> String.valueOf(a.createdAt).compareTo(String.valueOf(b.createdAt)));
        return jobs;
    }

    private static JSONObject eq(String field, String value) throws Exception {
        return new JSONObject().put("fieldFilter", new JSONObject()
                .put("field", new JSONObject().put("fieldPath", field))
                .put("op", "EQUAL")
                .put("value", FirestoreRest.str(value)));
    }

    private void process(FirestoreRest fs, Prefs prefs, Job job) throws Exception {
        String title = job.title == null ? "Reçu" : job.title;
        String now = iso(System.currentTimeMillis());

        // Too old to print now: report it instead of printing a stale receipt.
        long created = parseIso(job.createdAt);
        if (created > 0 && System.currentTimeMillis() - created > MAX_JOB_AGE_MS) {
            fs.patch(job.name, new JSONObject()
                    .put("status", FirestoreRest.str("failed"))
                    .put("error", FirestoreRest.str("Expiré — le T6 était hors ligne trop longtemps")),
                    new String[] {"status", "error"}, null);
            AppLog.add(title + " : expiré, non imprimé");
            return;
        }

        // Take the job — only if nobody else changed it meanwhile.
        try {
            fs.patch(job.name, new JSONObject()
                    .put("status", FirestoreRest.str("printing"))
                    .put("claimedAt", FirestoreRest.str(now))
                    .put("claimedBy", FirestoreRest.str(prefs.stationId())),
                    new String[] {"status", "claimedAt", "claimedBy"}, job.updateTime);
        } catch (FirestoreRest.PreconditionFailed taken) {
            return;
        }

        AppLog.add("Impression : " + title);
        updateNotification("Impression : " + title);
        try {
            Bitmap bmp = ReceiptRenderer.render(job.lines, prefs.paperDots());
            BtPrinter.print(prefs.printerAddress(), EscPos.receipt(bmp, 4));
            bmp.recycle();
            fs.patch(job.name, new JSONObject()
                    .put("status", FirestoreRest.str("printed"))
                    .put("printedAt", FirestoreRest.str(iso(System.currentTimeMillis()))),
                    new String[] {"status", "printedAt"}, null);
            AppLog.add("Imprimé : " + title);
        } catch (Exception e) {
            String why = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
            fs.patch(job.name, new JSONObject()
                    .put("status", FirestoreRest.str("failed"))
                    .put("error", FirestoreRest.str(why)),
                    new String[] {"status", "error"}, null);
            AppLog.add("Échec : " + title + " — " + why);
        } finally {
            updateNotification("En attente des reçus à imprimer");
        }
    }

    /* ---- notification ---------------------------------------------------- */

    private Notification notification(String text) {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Impression des reçus",
                    NotificationManager.IMPORTANCE_LOW));
        }
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(this, CHANNEL)
                : new Notification.Builder(this);
        return b.setContentTitle("T6 Print Station")
                .setContentText(text)
                .setSmallIcon(R.drawable.ic_print)
                .setContentIntent(open)
                .setOngoing(true)
                .build();
    }

    private void updateNotification(String text) {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        nm.notify(NOTIF_ID, notification(text));
    }

    /* ---- dates (ISO 8601 UTC, like the web app's new Date().toISOString()) - */

    static String iso(long ms) {
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        f.setTimeZone(TimeZone.getTimeZone("UTC"));
        return f.format(new Date(ms));
    }

    static long parseIso(String s) {
        if (s == null) return 0;
        try {
            SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
            f.setTimeZone(TimeZone.getTimeZone("UTC"));
            Date d = f.parse(s);
            return d == null ? 0 : d.getTime();
        } catch (Exception e) {
            return 0;
        }
    }
}
