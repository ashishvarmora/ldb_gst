package in.rahdari.app.tracker;

import android.Manifest;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * window.Capacitor.Plugins.RahdariTracker - the page's handle on TrackerService.
 *
 *   start({ url, page, label, owner })  asks for location if needed, then runs the service
 *   stop()                              stops it and tells the server
 *   status()                            running + every setting that can break background sharing
 *   fixBackground() / fixBattery() / fixNotifications() / fixAutostart() / fixGps()
 *                                       one tap to the right system screen for each
 */
@CapacitorPlugin(
    name = "RahdariTracker",
    permissions = {
        @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }),
        @Permission(alias = "background", strings = { Manifest.permission.ACCESS_BACKGROUND_LOCATION }),
    }
)
public class TrackerPlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !url.startsWith("https://")) {
            call.reject("bad-url");
            return;
        }
        TrackerService.prefs(getContext())
            .edit()
            .putString("url", url)
            .putString("page", call.getString("page", "https://rahdari.in"))
            .putString("label", call.getString("label", "this trip"))
            .putString("owner", call.getString("owner", "the owner"))
            .apply();
        if (getPermissionState("location") != PermissionState.GRANTED) {
            requestPermissionForAlias("location", call, "afterLocation");
            return;
        }
        run(call);
    }

    @PermissionCallback
    private void afterLocation(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            call.reject("denied");
            return;
        }
        run(call);
    }

    private void run(PluginCall call) {
        TrackerService.prefs(getContext()).edit().putBoolean("on", true).apply();
        try {
            TrackerService.launch(getContext());
        } catch (Exception e) {
            call.reject("failed", e);
            return;
        }
        call.resolve(statusObject());
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Intent i = new Intent(getContext(), TrackerService.class).setAction(TrackerService.ACTION_STOP);
        try {
            getContext().startService(i);
        } catch (Exception e) {
            // Service not running: just clear the flag.
            TrackerService.prefs(getContext()).edit().putBoolean("on", false).apply();
        }
        call.resolve();
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(statusObject());
    }

    private JSObject statusObject() {
        Context c = getContext();
        JSObject o = new JSObject();
        o.put("on", TrackerService.isOn(c));
        o.put("location", granted(Manifest.permission.ACCESS_FINE_LOCATION) || granted(Manifest.permission.ACCESS_COARSE_LOCATION));
        o.put("precise", granted(Manifest.permission.ACCESS_FINE_LOCATION));
        o.put("background", Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || granted(Manifest.permission.ACCESS_BACKGROUND_LOCATION));
        o.put("notifications", NotificationManagerCompat.from(c).areNotificationsEnabled());
        PowerManager pm = (PowerManager) c.getSystemService(Context.POWER_SERVICE);
        o.put("battery", Build.VERSION.SDK_INT < Build.VERSION_CODES.M || (pm != null && pm.isIgnoringBatteryOptimizations(c.getPackageName())));
        LocationManager lm = (LocationManager) c.getSystemService(Context.LOCATION_SERVICE);
        o.put("gps", lm != null && (lm.isProviderEnabled(LocationManager.GPS_PROVIDER) || lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)));
        o.put("autostartBrand", autostartBrand());
        o.put("lastSentAt", TrackerService.lastSentAt);
        o.put("queued", TrackerService.queued);
        o.put("error", TrackerService.lastError);
        Location f = TrackerService.lastFix;
        if (f != null) {
            JSObject fix = new JSObject();
            fix.put("lat", f.getLatitude());
            fix.put("lng", f.getLongitude());
            fix.put("accuracy", f.hasAccuracy() ? f.getAccuracy() : null);
            fix.put("speed", f.hasSpeed() ? f.getSpeed() : null);
            fix.put("t", f.getTime());
            o.put("fix", fix);
        }
        return o;
    }

    private boolean granted(String perm) {
        return ContextCompat.checkSelfPermission(getContext(), perm) == PackageManager.PERMISSION_GRANTED;
    }

    /** "Allow all the time": Android 10 can ask in a dialog; 11+ only allows it from the app's settings page. */
    @PluginMethod
    public void fixBackground(PluginCall call) {
        if (Build.VERSION.SDK_INT == Build.VERSION_CODES.Q) {
            requestPermissionForAlias("background", call, "afterBackground");
            return;
        }
        openAppDetails();
        call.resolve();
    }

    @PermissionCallback
    private void afterBackground(PluginCall call) {
        call.resolve(statusObject());
    }

    /** Battery "Unrestricted": the system dialog asks once; settings list as fallback. */
    @PluginMethod
    public void fixBattery(PluginCall call) {
        Context c = getContext();
        try {
            Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + c.getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            c.startActivity(i);
        } catch (Exception e) {
            try {
                Intent i = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                c.startActivity(i);
            } catch (Exception e2) {
                openAppDetails();
            }
        }
        call.resolve();
    }

    @PluginMethod
    public void fixNotifications(PluginCall call) {
        Context c = getContext();
        try {
            Intent i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, c.getPackageName());
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            c.startActivity(i);
        } catch (Exception e) {
            openAppDetails();
        }
        call.resolve();
    }

    @PluginMethod
    public void fixGps(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
        } catch (Exception e) {
            openAppDetails();
        }
        call.resolve();
    }

    /** The OEM "Autostart" screen on the brands that kill background apps; app details elsewhere. */
    @PluginMethod
    public void fixAutostart(PluginCall call) {
        String[][] screens = {
            { "com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity" },
            { "com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity" },
            { "com.coloros.safecenter", "com.coloros.safecenter.startupapp.StartupAppListActivity" },
            { "com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity" },
            { "com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity" },
            { "com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.BgStartUpManager" },
            { "com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity" },
            { "com.oneplus.security", "com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity" },
            { "com.samsung.android.lool", "com.samsung.android.sm.ui.battery.BatteryActivity" },
        };
        Context c = getContext();
        for (String[] s : screens) {
            try {
                Intent i = new Intent().setComponent(new ComponentName(s[0], s[1])).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                c.startActivity(i);
                call.resolve();
                return;
            } catch (Exception ignored) {
                // Not this brand's screen; try the next.
            }
        }
        openAppDetails();
        call.resolve();
    }

    private String autostartBrand() {
        String m = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.toLowerCase();
        if (m.contains("xiaomi") || m.contains("redmi") || m.contains("poco")) return "xiaomi";
        if (m.contains("oppo") || m.contains("realme") || m.contains("oneplus")) return "oppo";
        if (m.contains("vivo") || m.contains("iqoo")) return "vivo";
        if (m.contains("huawei") || m.contains("honor")) return "huawei";
        if (m.contains("samsung")) return "samsung";
        return "";
    }

    private void openAppDetails() {
        Context c = getContext();
        try {
            Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + c.getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            c.startActivity(i);
        } catch (Exception ignored) {
            // Nothing else to open.
        }
    }
}
