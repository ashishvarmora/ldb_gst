package in.rahdari.app;

import android.app.Dialog;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.os.Message;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

/**
 * The whole app is https://rahdari.in in a WebView (see capacitor.config.json).
 * Two things a browser does that a bare WebView does not are added here:
 *
 *  1. Downloads. The CSV exports and receipts are plain links with a
 *     Content-Disposition header; a WebView ignores them unless told what to do.
 *     They go to the system Downloads folder, carrying the session cookie so the
 *     server knows whose export it is.
 *
 *  2. Popups. Razorpay's checkout opens some payment methods (netbanking,
 *     wallets) with window.open and reports back to the page through
 *     window.opener. A WebView without multi-window support either drops that
 *     popup or replaces the page with it, and the payment never settles in the
 *     app. Script-opened windows therefore get a real child WebView in a
 *     full-screen dialog; a link the user tapped with target=_blank (Telegram,
 *     WhatsApp, maps) still leaves for the right app or the browser.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        WebView webView = getBridge().getWebView();
        WebSettings settings = webView.getSettings();
        settings.setSupportMultipleWindows(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);

        webView.setDownloadListener(this::download);
        // Extends Capacitor's own client, so file pickers and permission prompts keep working.
        webView.setWebChromeClient(new PopupChromeClient());
    }

    private void download(String url, String userAgent, String contentDisposition, String mimeType, long length) {
        Uri uri = Uri.parse(url);
        String scheme = uri.getScheme();
        if (!"https".equals(scheme) && !"http".equals(scheme)) {
            Toast.makeText(this, "This file can't be saved from the app.", Toast.LENGTH_LONG).show();
            return;
        }

        String fileName = URLUtil.guessFileName(url, contentDisposition, mimeType);
        DownloadManager.Request request = new DownloadManager.Request(uri)
            .setMimeType(mimeType)
            .addRequestHeader("Cookie", CookieManager.getInstance().getCookie(url))
            .addRequestHeader("User-Agent", userAgent)
            .setTitle(fileName)
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);

        DownloadManager manager = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
        if (manager == null) return;
        manager.enqueue(request);
        Toast.makeText(this, "Downloading " + fileName, Toast.LENGTH_SHORT).show();
    }

    /** Opens a URL in whatever app claims it - the browser, Telegram, a UPI app. */
    private void openOutside(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "No app on this phone can open that link.", Toast.LENGTH_LONG).show();
        }
    }

    private static boolean isOurs(Uri uri) {
        String host = uri.getHost();
        return host != null && (host.equals("rahdari.in") || host.endsWith(".rahdari.in"));
    }

    private class PopupChromeClient extends BridgeWebChromeClient {

        PopupChromeClient() {
            super(getBridge());
        }

        @Override
        public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
            WebView.HitTestResult hit = view.getHitTestResult();
            int type = hit.getType();
            String extra = hit.getExtra();

            // A tapped target=_blank link: hand it to the system, as a browser tab would.
            if (extra != null
                && (type == WebView.HitTestResult.SRC_ANCHOR_TYPE
                    || type == WebView.HitTestResult.SRC_IMAGE_ANCHOR_TYPE)) {
                Uri uri = Uri.parse(extra);
                if (isOurs(uri)) view.loadUrl(extra);
                else openOutside(uri);
                return false;
            }

            // window.open from script (Razorpay): a child WebView that keeps window.opener.
            WebView popup = new WebView(MainActivity.this);
            WebSettings popupSettings = popup.getSettings();
            popupSettings.setJavaScriptEnabled(true);
            popupSettings.setDomStorageEnabled(true);
            popupSettings.setSupportMultipleWindows(false);
            popupSettings.setUserAgentString(view.getSettings().getUserAgentString());
            CookieManager.getInstance().setAcceptThirdPartyCookies(popup, true);

            Dialog dialog = new Dialog(MainActivity.this, android.R.style.Theme_DeviceDefault_Light_NoActionBar);
            dialog.setContentView(popup);
            if (dialog.getWindow() != null) {
                dialog.getWindow().setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
            }
            dialog.setOnDismissListener(d -> popup.destroy());

            popup.setWebViewClient(new WebViewClient() {
                @Override
                public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) {
                    Uri uri = request.getUrl();
                    String scheme = uri.getScheme();
                    // Bank and Razorpay pages stay in the popup; upi://, intent:// and
                    // the like belong to the payment apps.
                    if ("https".equals(scheme) || "http".equals(scheme)) return false;
                    if ("intent".equals(scheme)) {
                        try {
                            startActivity(Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME));
                        } catch (Exception e) {
                            Toast.makeText(MainActivity.this, "That payment app isn't installed.", Toast.LENGTH_LONG).show();
                        }
                        return true;
                    }
                    openOutside(uri);
                    return true;
                }
            });
            popup.setWebChromeClient(new android.webkit.WebChromeClient() {
                @Override
                public void onCloseWindow(WebView window) {
                    dialog.dismiss();
                }
            });

            dialog.show();

            WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
            transport.setWebView(popup);
            resultMsg.sendToTarget();
            return true;
        }
    }
}
