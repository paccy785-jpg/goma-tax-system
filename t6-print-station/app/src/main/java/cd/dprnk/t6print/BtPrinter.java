package cd.dprnk.t6print;

import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;

import java.io.IOException;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * The T6's built-in printer, reached the way the T6 exposes it: as a paired
 * Bluetooth printer ("VirtualBtPrinter") taking ESC/POS over the serial profile.
 */
@SuppressLint("MissingPermission")
public final class BtPrinter {
    private static final UUID SPP = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");

    public static final class Device {
        public final String name;
        public final String address;
        Device(String name, String address) {
            this.name = name;
            this.address = address;
        }
        @Override public String toString() {
            return name + "  (" + address + ")";
        }
    }

    private BtPrinter() {}

    /** Paired devices, printers first. */
    public static List<Device> paired() {
        List<Device> printers = new ArrayList<>();
        List<Device> others = new ArrayList<>();
        BluetoothAdapter ad = BluetoothAdapter.getDefaultAdapter();
        if (ad == null) return printers;
        Set<BluetoothDevice> bonded;
        try {
            bonded = ad.getBondedDevices();
        } catch (SecurityException e) {
            return printers;
        }
        if (bonded == null) return printers;
        for (BluetoothDevice d : bonded) {
            String n = d.getName() == null ? "?" : d.getName();
            Device dev = new Device(n, d.getAddress());
            String low = n.toLowerCase();
            if (low.contains("print") || low.contains("inner") || low.contains("virtual")) printers.add(dev);
            else others.add(dev);
        }
        printers.addAll(others);
        return printers;
    }

    public static synchronized void print(String address, byte[] data) throws IOException {
        if (address == null || address.isEmpty()) throw new IOException("Aucune imprimante choisie dans l’application");
        BluetoothAdapter ad = BluetoothAdapter.getDefaultAdapter();
        if (ad == null) throw new IOException("Bluetooth indisponible sur cet appareil");
        if (!ad.isEnabled()) throw new IOException("Bluetooth désactivé sur le T6");
        BluetoothSocket sock = null;
        try {
            BluetoothDevice dev = ad.getRemoteDevice(address);
            try {
                ad.cancelDiscovery();
            } catch (SecurityException ignored) {
                // not needed for an already paired device
            }
            try {
                sock = dev.createRfcommSocketToServiceRecord(SPP);
                sock.connect();
            } catch (IOException first) {
                closeQuietly(sock);
                sock = dev.createInsecureRfcommSocketToServiceRecord(SPP);
                sock.connect();
            }
            OutputStream out = sock.getOutputStream();
            for (int i = 0; i < data.length; i += 1024) {
                out.write(data, i, Math.min(1024, data.length - i));
                out.flush();
                sleep(15);
            }
            sleep(600); // let the printer take in the last bytes before closing
        } catch (SecurityException e) {
            throw new IOException("Autorisation Bluetooth refusée — ouvrez l’application et autorisez « Appareils à proximité »");
        } finally {
            closeQuietly(sock);
        }
    }

    private static void closeQuietly(BluetoothSocket s) {
        if (s == null) return;
        try {
            s.close();
        } catch (IOException ignored) {
            // already closed
        }
    }

    private static void sleep(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
