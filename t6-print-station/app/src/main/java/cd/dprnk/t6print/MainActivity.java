package cd.dprnk.t6print;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.View;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.RadioGroup;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/** Set-up screen: account, printer, paper width, start / stop, activity log. */
public class MainActivity extends Activity {
    private Prefs prefs;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private List<BtPrinter.Device> devices = new ArrayList<>();

    private View signInBox, signedInBox;
    private EditText email, password, stationName;
    private TextView signedInAs, status, log;
    private Spinner printer;
    private Button startStop;

    private final Runnable refresh = new Runnable() {
        @Override public void run() {
            boolean on = PrintStationService.isRunning();
            startStop.setText(on ? "Arrêter la réception des reçus" : "Démarrer la réception des reçus");
            status.setText("État : " + AppLog.status());
            log.setText(AppLog.text());
            ui.postDelayed(this, 1000);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        prefs = new Prefs(this);

        signInBox = findViewById(R.id.signInBox);
        signedInBox = findViewById(R.id.signedInBox);
        email = findViewById(R.id.email);
        password = findViewById(R.id.password);
        signedInAs = findViewById(R.id.signedInAs);
        stationName = findViewById(R.id.stationName);
        printer = findViewById(R.id.printer);
        status = findViewById(R.id.status);
        log = findViewById(R.id.log);
        startStop = findViewById(R.id.startStop);

        askPermissions();
        showAccount();

        stationName.setText(prefs.stationName());
        stationName.addTextChangedListener(new TextWatcher() {
            public void beforeTextChanged(CharSequence s, int a, int b, int c) {}
            public void onTextChanged(CharSequence s, int a, int b, int c) {}
            public void afterTextChanged(Editable s) { prefs.setStationName(s.toString()); }
        });

        RadioGroup paper = findViewById(R.id.paper);
        paper.check(prefs.paperMm() >= 80 ? R.id.paper80 : R.id.paper58);
        paper.setOnCheckedChangeListener((g, id) -> prefs.setPaperMm(id == R.id.paper80 ? 80 : 58));

        CheckBox auto = findViewById(R.id.autoStart);
        auto.setChecked(prefs.autoStart());
        auto.setOnCheckedChangeListener((b, on) -> prefs.setAutoStart(on));

        findViewById(R.id.signIn).setOnClickListener(v -> signIn());
        findViewById(R.id.signOut).setOnClickListener(v -> {
            PrintStationService.stop(this);
            prefs.clearAccount();
            showAccount();
        });
        findViewById(R.id.testPrint).setOnClickListener(v -> testPrint());
        startStop.setOnClickListener(v -> {
            if (PrintStationService.isRunning()) {
                PrintStationService.stop(this);
            } else if (prefs.refreshToken() == null) {
                toast("Connectez-vous d’abord avec un compte DPRNK.");
            } else if (prefs.printerAddress() == null) {
                toast("Choisissez d’abord l’imprimante.");
            } else {
                PrintStationService.start(this);
            }
        });
    }

    @Override
    protected void onResume() {
        super.onResume();
        loadPrinters();
        ui.post(refresh);
    }

    @Override
    protected void onPause() {
        super.onPause();
        ui.removeCallbacks(refresh);
    }

    private void askPermissions() {
        List<String> need = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= 31
                && checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
            need.add(Manifest.permission.BLUETOOTH_CONNECT);
        }
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            need.add(Manifest.permission.POST_NOTIFICATIONS);
        }
        if (!need.isEmpty()) requestPermissions(need.toArray(new String[0]), 1);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        loadPrinters();
    }

    private void showAccount() {
        boolean signedIn = prefs.refreshToken() != null;
        signInBox.setVisibility(signedIn ? View.GONE : View.VISIBLE);
        signedInBox.setVisibility(signedIn ? View.VISIBLE : View.GONE);
        if (signedIn) signedInAs.setText("Connecté : " + prefs.email());
    }

    private void signIn() {
        final String e = email.getText().toString().trim();
        final String p = password.getText().toString();
        if (e.isEmpty() || p.isEmpty()) {
            toast("Saisissez l’e-mail et le mot de passe.");
            return;
        }
        toast("Connexion…");
        new Thread(() -> {
            try {
                JSONObject r = FirestoreRest.signIn(this, e, p);
                prefs.saveAccount(r.getString("refreshToken"), r.getString("localId"), r.optString("email", e));
                AppLog.add("Connecté : " + e);
                ui.post(() -> {
                    password.setText("");
                    showAccount();
                    toast("Connecté.");
                });
            } catch (Exception ex) {
                ui.post(() -> toast("Connexion impossible : " + ex.getMessage()));
            }
        }).start();
    }

    private void loadPrinters() {
        devices = BtPrinter.paired();
        List<String> labels = new ArrayList<>();
        for (BtPrinter.Device d : devices) labels.add(d.toString());
        if (labels.isEmpty()) labels.add("Aucun appareil Bluetooth associé");
        ArrayAdapter<String> ad = new ArrayAdapter<>(this, android.R.layout.simple_spinner_item, labels);
        ad.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        printer.setAdapter(ad);

        // Keep the printer chosen before; else pick the T6's virtual printer.
        int pick = -1;
        String saved = prefs.printerAddress();
        for (int i = 0; i < devices.size(); i++) {
            if (devices.get(i).address.equals(saved)) pick = i;
        }
        if (pick < 0) {
            for (int i = 0; i < devices.size(); i++) {
                if (devices.get(i).name.toLowerCase().contains("virtualbtprinter")) pick = i;
            }
        }
        if (pick < 0 && !devices.isEmpty()) pick = 0;
        if (pick >= 0) {
            printer.setSelection(pick);
            prefs.setPrinter(devices.get(pick).address, devices.get(pick).name);
        }
        printer.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            public void onItemSelected(AdapterView<?> parent, View v, int position, long id) {
                if (position < devices.size()) {
                    prefs.setPrinter(devices.get(position).address, devices.get(position).name);
                }
            }
            public void onNothingSelected(AdapterView<?> parent) {}
        });
    }

    private void testPrint() {
        toast("Impression de la page de test…");
        new Thread(() -> {
            try {
                List<ReceiptLine> lines = new ArrayList<>();
                lines.add(ReceiptLine.text("RÉPUBLIQUE DÉMOCRATIQUE DU CONGO", "center", true, 1));
                lines.add(ReceiptLine.text("DPRNK — Page de test", "center", true, 2));
                lines.add(ReceiptLine.rule());
                lines.add(ReceiptLine.pair("Imprimante", prefs.printerName(), true));
                lines.add(ReceiptLine.pair("Papier", prefs.paperMm() + " mm", true));
                lines.add(ReceiptLine.pair("T6", prefs.stationName(), true));
                lines.add(ReceiptLine.text("Accents : é è à ç ô — 1 234,50 $", "left", false, 1));
                lines.add(ReceiptLine.rule());
                lines.add(ReceiptLine.text("Si cette page est lisible, le T6 est prêt.", "center", false, 1));
                Bitmap bmp = ReceiptRenderer.render(lines, prefs.paperDots());
                BtPrinter.print(prefs.printerAddress(), EscPos.receipt(bmp, 4));
                AppLog.add("Page de test imprimée");
                ui.post(() -> toast("Page de test imprimée."));
            } catch (Exception ex) {
                AppLog.add("Page de test : " + ex.getMessage());
                ui.post(() -> toast("Impression impossible : " + ex.getMessage()));
            }
        }).start();
    }

    private void toast(String s) {
        Toast.makeText(this, s, Toast.LENGTH_LONG).show();
    }
}
