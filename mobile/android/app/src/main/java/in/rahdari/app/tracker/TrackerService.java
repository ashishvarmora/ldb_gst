package in.rahdari.app.tracker;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Driver location sharing that does not depend on the WebView (v7, 26 Nov 2026).
 *
 * The earlier path (the community background-geolocation plugin) delivered each
 * fix to JavaScript, and the page posted it. When the driver swiped the app
 * away, or the phone restarted, the page was gone and so was the tracking. This
 * service gets fixes from Google's fused provider and posts them to
 * /api/driver/&lt;token&gt;/location itself, in the same JSON the page sends, so:
 *
 *   - screen off / phone locked / another app open: keeps running (foreground
 *     service of type location, with the ongoing notification Android requires)
 *   - app swiped away: keeps running (stopWithTask=false in the manifest)
 *   - killed by the system: restarted (START_STICKY, state in SharedPreferences)
 *   - phone restarted or app updated: restarted by BootReceiver if it was on
 *
 * Fixes queue on the phone when there is no network and go out when it returns.
 * The server answering 410/404 (link stopped or ended) switches it off for good.
 */
public class TrackerService extends Service {

    static final String PREFS = "rahdari_tracker";
    static final String CHANNEL = "rahdari_tracking";
    static final int NOTIFICATION_ID = 4107;
    static final String ACTION_STOP = "in.rahdari.app.tracker.STOP";

    /** Ask the fused provider for a fix this often while moving. */
    private static final long FIX_EVERY_MS = 20_000;
    /** Queue a fix when the truck moved this far, or when this long passed (keeps "Live"). */
    private static final float MOVE_METERS = 50;
    private static final long KEEP_ALIVE_MS = 60_000;
    /** Post the queue (or an empty heartbeat) this often. The server takes one post per 8 s. */
    private static final long POST_EVERY_MS = 30_000;
    private static final int BATCH = 50;
    private static final int QUEUE_MAX = 600;

    /** The latest state, for TrackerPlugin.status() and the page's live tiles. */
    static volatile Location lastFix;
    static volatile long lastSentAt;
    static volatile int queued;
    static volatile String lastError;

    private FusedLocationProviderClient fused;
    private LocationCallback callback;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService net = Executors.newSingleThreadExecutor();
    private final JSONArray queue = new JSONArray();
    private Location lastQueued;
    private boolean consentSent;
    private boolean posting;
    private long lastPostAttempt;
    private PowerManager.WakeLock wakeLock;

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static boolean isOn(Context c) {
        return prefs(c).getBoolean("on", false) && prefs(c).getString("url", null) != null;
    }

    /** Starts (or re-starts) the service as a foreground service. */
    static void launch(Context c) {
        Intent i = new Intent(c, TrackerService.class);
        ContextCompat.startForegroundService(c, i);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        fused = LocationServices.getFusedLocationProviderClient(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopSharing(true);
            return START_NOT_STICKY;
        }
        if (!isOn(this)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        startInForeground();
        restoreQueue();
        startUpdates();
        handler.removeCallbacks(postLoop);
        handler.postDelayed(postLoop, 3_000);
        return START_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // Swiping the app away must not stop sharing; the service keeps running on its own.
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(postLoop);
        if (fused != null && callback != null) fused.removeLocationUpdates(callback);
        releaseWakeLock();
        saveQueue();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    /* ------------------------------------------------------------------ */

    private void startInForeground() {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Location sharing", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Shown while your location is shared with the truck owner");
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        SharedPreferences p = prefs(this);
        String label = p.getString("label", "this trip");
        String owner = p.getString("owner", "the owner");
        String page = p.getString("page", "https://rahdari.in");

        Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse(page)).setPackage(getPackageName());
        PendingIntent openPi = PendingIntent.getActivity(this, 1, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Intent stop = new Intent(this, TrackerService.class).setAction(ACTION_STOP);
        PendingIntent stopPi = PendingIntent.getService(this, 2, stop, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification n = new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle("Location sharing ON - " + label)
            .setContentText("Shared with " + owner + ". Tap to open, or Stop.")
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setContentIntent(openPi)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Stop", stopPi)
            .build();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        } else {
            startForeground(NOTIFICATION_ID, n);
        }
    }

    private void startUpdates() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED
            && ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            lastError = "no-permission";
            return;
        }
        if (callback != null) fused.removeLocationUpdates(callback);
        callback = new LocationCallback() {
            @Override
            public void onLocationResult(LocationResult result) {
                for (Location l : result.getLocations()) onFix(l);
            }
        };
        LocationRequest req = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, FIX_EVERY_MS)
            .setMinUpdateIntervalMillis(10_000)
            .setWaitForAccurateLocation(false)
            .build();
        try {
            fused.requestLocationUpdates(req, callback, Looper.getMainLooper());
            lastError = null;
        } catch (SecurityException e) {
            lastError = "no-permission";
        }
    }

    private void onFix(Location l) {
        lastFix = l;
        boolean moved = lastQueued == null || l.distanceTo(lastQueued) >= MOVE_METERS;
        boolean stale = lastQueued == null || l.getTime() - lastQueued.getTime() >= KEEP_ALIVE_MS;
        if (!moved && !stale) return;
        try {
            JSONObject pt = new JSONObject();
            pt.put("lat", l.getLatitude());
            pt.put("lng", l.getLongitude());
            if (l.hasAccuracy()) pt.put("accuracy", l.getAccuracy());
            if (l.hasSpeed()) pt.put("speed", l.getSpeed()); // m/s, as the page sends it
            if (l.hasBearing()) pt.put("heading", l.getBearing());
            pt.put("t", l.getTime());
            if (queue.length() >= QUEUE_MAX) queue.remove(0);
            queue.put(pt);
            queued = queue.length();
            lastQueued = l;
            // Timers can be held back in deep sleep; location callbacks still arrive, so post from here too.
            if (System.currentTimeMillis() - lastPostAttempt >= POST_EVERY_MS) flush();
        } catch (Exception ignored) {
            // A fix that cannot be serialised is skipped, never fatal.
        }
    }

    private final Runnable postLoop = new Runnable() {
        @Override
        public void run() {
            flush();
            handler.postDelayed(this, POST_EVERY_MS);
        }
    };

    private void flush() {
        if (posting) return;
        lastPostAttempt = System.currentTimeMillis();
        final String url = prefs(this).getString("url", null);
        if (url == null) return;
        final JSONArray batch = new JSONArray();
        for (int i = 0; i < Math.min(BATCH, queue.length()); i++) batch.put(queue.opt(i));
        final int count = batch.length();
        posting = true;
        acquireWakeLock();
        net.execute(() -> {
            int code = -1;
            try {
                JSONObject body = new JSONObject();
                body.put("points", batch);
                if (!consentSent) body.put("consent", true);
                code = postJson(url, body);
            } catch (Exception e) {
                lastError = "network";
            }
            final int status = code;
            handler.post(() -> {
                posting = false;
                releaseWakeLock();
                if (status >= 200 && status < 300) {
                    consentSent = true;
                    for (int i = 0; i < count && queue.length() > 0; i++) queue.remove(0);
                    queued = queue.length();
                    lastSentAt = System.currentTimeMillis();
                    lastError = null;
                    saveQueue();
                } else if (status == 410 || status == 404) {
                    // The owner stopped the link, or a one-time link ended: stop for good.
                    lastError = "link-stopped";
                    stopSharing(false);
                } else if (status > 0) {
                    lastError = "server-" + status;
                }
            });
        });
    }

    static int postJson(String url, JSONObject body) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setRequestMethod("POST");
        c.setConnectTimeout(15_000);
        c.setReadTimeout(20_000);
        c.setDoOutput(true);
        c.setRequestProperty("Content-Type", "application/json");
        c.setRequestProperty("Cache-Control", "no-store");
        byte[] data = body.toString().getBytes(StandardCharsets.UTF_8);
        try (OutputStream os = c.getOutputStream()) {
            os.write(data);
        }
        int code = c.getResponseCode();
        c.disconnect();
        return code;
    }

    /** Off: tell the server (best effort), forget the state, drop the notification. */
    void stopSharing(boolean tellServer) {
        final String url = prefs(this).getString("url", null);
        prefs(this).edit().putBoolean("on", false).remove("queue").apply();
        while (queue.length() > 0) queue.remove(0);
        queued = 0;
        if (tellServer && url != null) {
            net.execute(() -> {
                try {
                    JSONObject body = new JSONObject();
                    body.put("points", new JSONArray());
                    body.put("stop", true);
                    postJson(url, body);
                } catch (Exception ignored) {
                    // The server marks the driver silent on its own if this never arrives.
                }
            });
        }
        stopForeground(true);
        stopSelf();
    }

    private void restoreQueue() {
        if (queue.length() > 0) return;
        try {
            JSONArray saved = new JSONArray(prefs(this).getString("queue", "[]"));
            for (int i = 0; i < saved.length(); i++) queue.put(saved.get(i));
            queued = queue.length();
        } catch (Exception ignored) {
            // A corrupt saved queue is dropped.
        }
    }

    private void saveQueue() {
        prefs(this).edit().putString("queue", queue.toString()).apply();
    }

    private void acquireWakeLock() {
        try {
            if (wakeLock == null) {
                PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "rahdari:post");
            }
            if (!wakeLock.isHeld()) wakeLock.acquire(30_000);
        } catch (Exception ignored) {
            // Posting still runs without it; only a deep-dozing phone may delay it.
        }
    }

    private void releaseWakeLock() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        } catch (Exception ignored) {
            // Already released.
        }
    }
}
