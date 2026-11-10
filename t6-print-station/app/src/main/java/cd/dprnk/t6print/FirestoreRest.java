package cd.dprnk.t6print;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.net.URLEncoder;
import java.util.concurrent.TimeUnit;

import okhttp3.FormBody;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;

/**
 * Firebase Authentication and Cloud Firestore over their REST APIs — the same
 * project and database as the DPRNK web app, with the officer account the T6
 * is signed in with.
 */
public final class FirestoreRest {
    /** A write refused because the document changed meanwhile (another T6 took the job). */
    public static final class PreconditionFailed extends IOException {
        PreconditionFailed(String m) { super(m); }
    }

    private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");
    private static final OkHttpClient HTTP = new OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(25, TimeUnit.SECONDS)
            .writeTimeout(25, TimeUnit.SECONDS)
            .build();

    private final String apiKey;
    private final String projectId;
    private final String databaseId;
    private final Prefs prefs;
    private String idToken;
    private long idTokenExpiresAt;

    public FirestoreRest(Context ctx) {
        apiKey = ctx.getString(R.string.firebase_api_key);
        projectId = ctx.getString(R.string.firebase_project_id);
        databaseId = ctx.getString(R.string.firebase_database_id);
        prefs = new Prefs(ctx);
    }

    /** Sign in with e-mail and password; returns { refreshToken, localId, email }. */
    public static JSONObject signIn(Context ctx, String email, String password) throws IOException, JSONException {
        String key = ctx.getString(R.string.firebase_api_key);
        JSONObject body = new JSONObject()
                .put("email", email)
                .put("password", password)
                .put("returnSecureToken", true);
        Request req = new Request.Builder()
                .url("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=" + enc(key))
                .post(RequestBody.create(body.toString(), JSON))
                .build();
        return new JSONObject(call(req));
    }

    /** A valid ID token, refreshed from the saved refresh token when needed. */
    public synchronized String token() throws IOException, JSONException {
        if (idToken != null && System.currentTimeMillis() < idTokenExpiresAt - 60_000) return idToken;
        String refresh = prefs.refreshToken();
        if (refresh == null) throw new IOException("Aucun compte connecté");
        Request req = new Request.Builder()
                .url("https://securetoken.googleapis.com/v1/token?key=" + enc(apiKey))
                .post(new FormBody.Builder()
                        .add("grant_type", "refresh_token")
                        .add("refresh_token", refresh)
                        .build())
                .build();
        JSONObject r = new JSONObject(call(req));
        idToken = r.getString("id_token");
        idTokenExpiresAt = System.currentTimeMillis() + 1000L * Long.parseLong(r.optString("expires_in", "3600"));
        String newRefresh = r.optString("refresh_token", null);
        if (newRefresh != null && !newRefresh.equals(refresh)) prefs.updateRefreshToken(newRefresh);
        return idToken;
    }

    private String documentsUrl() {
        return "https://firestore.googleapis.com/v1/projects/" + projectId + "/databases/" + databaseId + "/documents";
    }

    /**
     * Update the given fields of a document (created if missing, unless a
     * precondition is given). `path` is "collection/id" or a full document name.
     */
    public void patch(String path, JSONObject fields, String[] mask, String requireUpdateTime)
            throws IOException, JSONException {
        String url = path.startsWith("projects/")
                ? "https://firestore.googleapis.com/v1/" + path
                : documentsUrl() + "/" + path;
        StringBuilder q = new StringBuilder();
        for (String m : mask) q.append(q.length() == 0 ? '?' : '&').append("updateMask.fieldPaths=").append(enc(m));
        if (requireUpdateTime != null) {
            q.append(q.length() == 0 ? '?' : '&').append("currentDocument.updateTime=").append(enc(requireUpdateTime));
        }
        JSONObject body = new JSONObject().put("fields", fields);
        Request req = new Request.Builder()
                .url(url + q)
                .header("Authorization", "Bearer " + token())
                .patch(RequestBody.create(body.toString(), JSON))
                .build();
        call(req);
    }

    /** Run a structured query on the documents root; returns the matching documents. */
    public JSONArray query(JSONObject structuredQuery) throws IOException, JSONException {
        JSONObject body = new JSONObject().put("structuredQuery", structuredQuery);
        Request req = new Request.Builder()
                .url(documentsUrl() + ":runQuery")
                .header("Authorization", "Bearer " + token())
                .post(RequestBody.create(body.toString(), JSON))
                .build();
        JSONArray rows = new JSONArray(call(req));
        JSONArray docs = new JSONArray();
        for (int i = 0; i < rows.length(); i++) {
            JSONObject d = rows.getJSONObject(i).optJSONObject("document");
            if (d != null) docs.put(d);
        }
        return docs;
    }

    private static String call(Request req) throws IOException {
        try (Response res = HTTP.newCall(req).execute()) {
            ResponseBody b = res.body();
            String text = b == null ? "" : b.string();
            if (res.isSuccessful()) return text;
            String message = text;
            try {
                JSONObject err = new JSONObject(text).optJSONObject("error");
                if (err != null) message = err.optString("status", "") + " " + err.optString("message", "");
            } catch (JSONException ignored) {
                // not JSON
            }
            if (message.contains("FAILED_PRECONDITION")) throw new PreconditionFailed(message);
            if (message.contains("INVALID_PASSWORD") || message.contains("EMAIL_NOT_FOUND")
                    || message.contains("INVALID_LOGIN_CREDENTIALS")) {
                throw new IOException("E-mail ou mot de passe incorrect");
            }
            if (res.code() == 403) throw new IOException("Accès refusé (compte sans accès au portail DPRNK ?)");
            throw new IOException("HTTP " + res.code() + " — " + message.trim());
        }
    }

    private static String enc(String s) {
        try {
            return URLEncoder.encode(s, "UTF-8");
        } catch (Exception e) {
            return s;
        }
    }

    /* ---- Firestore values ---------------------------------------------- */

    public static JSONObject str(String s) throws JSONException {
        return new JSONObject().put("stringValue", s == null ? "" : s);
    }

    public static JSONObject num(long n) throws JSONException {
        return new JSONObject().put("integerValue", String.valueOf(n));
    }

    public static String getStr(JSONObject fields, String key) {
        JSONObject v = fields == null ? null : fields.optJSONObject(key);
        return v == null ? null : v.optString("stringValue", null);
    }

    public static boolean getBool(JSONObject fields, String key) {
        JSONObject v = fields == null ? null : fields.optJSONObject(key);
        return v != null && v.optBoolean("booleanValue", false);
    }

    public static long getInt(JSONObject fields, String key, long dflt) {
        JSONObject v = fields == null ? null : fields.optJSONObject(key);
        if (v == null) return dflt;
        if (v.has("integerValue")) {
            try {
                return Long.parseLong(v.optString("integerValue"));
            } catch (NumberFormatException e) {
                return dflt;
            }
        }
        if (v.has("doubleValue")) return (long) v.optDouble("doubleValue", dflt);
        return dflt;
    }
}
