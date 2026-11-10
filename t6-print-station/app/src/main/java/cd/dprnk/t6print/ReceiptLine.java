package cd.dprnk.t6print;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/** One line of a receipt, as the web app sends it (see printService.ts). */
public final class ReceiptLine {
    public String kind = "text"; // text | pair | rule | space | seal (the DF logo)
    public String text = "";
    public String label = "";
    public String value = "";
    public String align = "left"; // left | center | right
    public boolean bold;
    public int size = 1; // 1 normal, 2 large

    public static ReceiptLine text(String t, String align, boolean bold, int size) {
        ReceiptLine l = new ReceiptLine();
        l.kind = "text";
        l.text = t;
        l.align = align;
        l.bold = bold;
        l.size = size;
        return l;
    }

    public static ReceiptLine pair(String label, String value, boolean bold) {
        ReceiptLine l = new ReceiptLine();
        l.kind = "pair";
        l.label = label;
        l.value = value;
        l.bold = bold;
        return l;
    }

    public static ReceiptLine rule() {
        ReceiptLine l = new ReceiptLine();
        l.kind = "rule";
        return l;
    }

    public static ReceiptLine space() {
        ReceiptLine l = new ReceiptLine();
        l.kind = "space";
        return l;
    }

    /** The `lines` array field of a print job document. */
    public static List<ReceiptLine> fromFirestore(JSONObject fields) {
        List<ReceiptLine> out = new ArrayList<>();
        JSONObject lines = fields == null ? null : fields.optJSONObject("lines");
        JSONObject arr = lines == null ? null : lines.optJSONObject("arrayValue");
        JSONArray values = arr == null ? null : arr.optJSONArray("values");
        if (values == null) return out;
        for (int i = 0; i < values.length(); i++) {
            JSONObject mv = values.optJSONObject(i);
            JSONObject map = mv == null ? null : mv.optJSONObject("mapValue");
            JSONObject f = map == null ? null : map.optJSONObject("fields");
            if (f == null) continue;
            ReceiptLine l = new ReceiptLine();
            String k = FirestoreRest.getStr(f, "k");
            l.kind = k == null ? "text" : k;
            l.text = nz(FirestoreRest.getStr(f, "text"));
            l.label = nz(FirestoreRest.getStr(f, "label"));
            l.value = nz(FirestoreRest.getStr(f, "value"));
            String a = FirestoreRest.getStr(f, "align");
            l.align = a == null ? "left" : a;
            l.bold = FirestoreRest.getBool(f, "bold");
            l.size = (int) FirestoreRest.getInt(f, "size", 1);
            out.add(l);
        }
        return out;
    }

    private static String nz(String s) {
        return s == null ? "" : s;
    }
}
