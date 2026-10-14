package com.notesprintifier.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;

/**
 * Notes Printifier — offline Android wrapper.
 *
 * The entire website (static export) is bundled in assets/www and served over
 * the synthetic https origin appassets.androidplatform.net. Using an https
 * origin (instead of file://) keeps fetch(), Web Workers, WASM and blob:
 * downloads behaving exactly like the real website. Everything runs 100%
 * locally — no server, no uploads.
 */
public class MainActivity extends Activity {

    static final String HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + HOST + "/index.html";
    private static final int REQ_FILE_CHOOSER = 1001;

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#0B0A10"));
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportZoom(false);
        s.setDisplayZoomControls(false);
        s.setMediaPlaybackRequiresUserGesture(true);

        webView.addJavascriptInterface(new DownloadBridge(this), "AndroidBridge");
        webView.setWebViewClient(new LocalContentClient());
        webView.setWebChromeClient(new ChromeClient());
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);

        setContentView(webView);

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(START_URL);
        }
    }

    /** Serves assets/www over the synthetic https origin. */
    private class LocalContentClient extends WebViewClient {

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            if (url == null || !HOST.equals(url.getHost())) return null;
            String path = url.getPath();
            if (path == null || path.length() == 0) path = "/index.html";
            if (path.contains("..")) return null; // block path traversal
            try {
                InputStream in = getAssets().open("www" + path);
                String mime = guessMime(path);
                boolean textual = mime.startsWith("text/") || mime.contains("javascript")
                        || mime.contains("json") || mime.contains("svg");
                WebResourceResponse resp = new WebResourceResponse(mime, textual ? "utf-8" : null, in);
                Map<String, String> headers = new HashMap<>();
                headers.put("Access-Control-Allow-Origin", "*");
                resp.setResponseHeaders(headers);
                return resp;
            } catch (IOException e) {
                // 404 — the site tolerates missing paths (e.g. /api/* stats).
                return null;
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            if (HOST.equals(url.getHost())) return false; // keep local traffic in-app
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, url));
            } catch (Exception ignored) {
            }
            return true;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            // Injected AFTER the page loads; the capture-phase click listener
            // sits above React's handlers, so patched <a download> links win.
            view.evaluateJavascript(INJECT_JS, null);
            super.onPageFinished(view, url);
        }
    }

    private static String guessMime(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "text/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".webmanifest")) return "application/manifest+json";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".webp")) return "image/webp";
        if (p.endsWith(".gif")) return "image/gif";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".ico")) return "image/x-icon";
        if (p.endsWith(".wasm")) return "application/wasm";
        if (p.endsWith(".pdf")) return "application/pdf";
        if (p.endsWith(".ttf")) return "font/ttf";
        if (p.endsWith(".otf")) return "font/otf";
        if (p.endsWith(".woff")) return "font/woff";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".txt")) return "text/plain";
        return "application/octet-stream";
    }

    /** PDF file picker for <input type="file"> (must be explicit in WebView). */
    private class ChromeClient extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                         FileChooserParams params) {
            if (filePathCallback != null) filePathCallback.onReceiveValue(null);
            filePathCallback = callback;
            Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("application/pdf");
            intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            try {
                startActivityForResult(
                        Intent.createChooser(intent, "Select lecture PDF"), REQ_FILE_CHOOSER);
            } catch (Exception e) {
                filePathCallback = null;
                Toast.makeText(MainActivity.this, "No file picker available", Toast.LENGTH_SHORT).show();
                return false;
            }
            return true;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE_CHOOSER && filePathCallback != null) {
            Uri[] results = null;
            if (resultCode == RESULT_OK && data != null) {
                ArrayList<Uri> uris = new ArrayList<>();
                ClipData clip = data.getClipData();
                if (clip != null) {
                    for (int i = 0; i < clip.getItemCount(); i++) {
                        uris.add(clip.getItemAt(i).getUri());
                    }
                } else if (data.getData() != null) {
                    uris.add(data.getData());
                }
                if (!uris.isEmpty()) results = uris.toArray(new Uri[0]);
            }
            ValueCallback<Uri[]> cb = filePathCallback;
            filePathCallback = null;
            cb.onReceiveValue(results);
        } else {
            super.onActivityResult(requestCode, resultCode, data);
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null) webView.saveState(outState);
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    /**
     * Patches every <a download> click: instead of relying on WebView's
     * (missing) download manager, the file is fetched as a blob, handed to the
     * Android bridge as base64 and written to the phone's Downloads folder.
     * Also intercepts the footer's APK link ("already using the app").
     */
    private static final String INJECT_JS =
        "(function(){"
        + "if(window.__npBridge)return;window.__npBridge=true;"
        + "document.addEventListener('click',function(e){"
        + "var el=e.target;"
        + "while(el&&el!==document&&el.tagName!=='A'){el=el.parentNode;}"
        + "if(!el||el===document)return;"
        + "var href=el.getAttribute('href');"
        + "if(!href)return;"
        + "if(href.indexOf('/printifier')>-1){"
        + "e.preventDefault();window.AndroidBridge.toast('You are already using the Android app!');return;}"
        + "var dl=el.getAttribute('download');"
        + "var isBlob=href.indexOf('blob:')===0;"
        + "if(dl===null&&!isBlob)return;"
        + "e.preventDefault();e.stopPropagation();"
        + "fetch(href).then(function(r){if(!r.ok)throw new Error('http '+r.status);return r.blob();})"
        + ".then(function(b){"
        + "var fr=new FileReader();"
        + "fr.onloadend=function(){"
        + "var name=(dl&&dl.length)?dl:(href.split('/').pop()||'download.pdf');"
        + "if(name.indexOf('.')<0)name=name+'.pdf';"
        + "var data=String(fr.result);"
        + "window.AndroidBridge.saveBase64(name,data.substring(data.indexOf(',')+1),b.type||'application/octet-stream');"
        + "};"
        + "fr.onerror=function(){window.AndroidBridge.toast('Download failed. Please try again.');};"
        + "fr.readAsDataURL(b);})"
        + ".catch(function(){window.AndroidBridge.toast('Download failed. Please try again.');});"
        + "},true);"
        + "})();";
}
