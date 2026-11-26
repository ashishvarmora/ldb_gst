package in.rahdari.app.tracker;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Phone restarted, or the app was updated: if the driver had sharing ON, start
 * it again without anyone opening the app. Android allows a location
 * foreground service to start from BOOT_COMPLETED when the app holds
 * background location; if the system still refuses, the driver's next app
 * open restarts it (the page asks TrackerPlugin for status on load).
 */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent == null ? null : intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action)
            && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
            && !"android.intent.action.QUICKBOOT_POWERON".equals(action)) {
            return;
        }
        if (!TrackerService.isOn(context)) return;
        try {
            TrackerService.launch(context);
        } catch (Exception ignored) {
            // Background start refused on this phone/OS: picked up on the next app open.
        }
    }
}
