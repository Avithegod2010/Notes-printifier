package com.notesprintifier.app;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * Bridge exposed to the web app as window.AndroidBridge.
 * saveBase64() writes downloaded PDFs into the phone's Downloads/Printifier
 * folder (MediaStore on Android 10+, app folder on older versions) and offers
 * to open the file with the system PDF viewer.
 */
public class DownloadBridge {

    private final Activity activity;

    public DownloadBridge(Activity activity) {
        this.activity = activity;
    }

    /**
     * The file name arrives from JS — never trust it with paths.
     * Strips separators, "..", control chars and length so it can only ever
     * create a plain file inside the destination folder.
     */
    private static String sanitizeName(String raw) {
        if (raw == null) return "printified.pdf";
        String name = raw.replace('/', '_')
                .replace('\\', '_')
                .replaceAll("\\.\\.+", "_")
                .replaceAll("[\\x00-\\x1f\\x7f]", "")
                .trim();
        if (name.startsWith(".")) name = "_" + name;
        if (name.isEmpty()) return "printified.pdf";
        if (name.length() > 120) name = name.substring(name.length() - 120);
        return name;
    }

    @JavascriptInterface
    public void saveBase64(final String name, final String base64, final String mime) {
        final String safeName = sanitizeName(name);
        try {
            byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
            final String savedTo;
            final Uri uriForViewer;

            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues cv = new ContentValues();
                cv.put(MediaStore.MediaColumns.DISPLAY_NAME, safeName);
                cv.put(MediaStore.MediaColumns.MIME_TYPE,
                        mime == null || mime.length() == 0 ? "application/octet-stream" : mime);
                cv.put(MediaStore.MediaColumns.RELATIVE_PATH,
                        Environment.DIRECTORY_DOWNLOADS + "/Printifier");
                Uri uri = activity.getContentResolver()
                        .insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                if (uri == null) throw new IllegalStateException("Could not create the file");
                OutputStream os = activity.getContentResolver().openOutputStream(uri);
                if (os == null) throw new IllegalStateException("Could not open the file");
                try {
                    os.write(bytes);
                } finally {
                    os.close();
                }
                savedTo = "Downloads/Printifier/" + safeName;
                uriForViewer = uri;
            } else {
                File dir = new File(activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS),
                        "Printifier");
                if (!dir.exists()) dir.mkdirs();
                File f = new File(dir, safeName);
                FileOutputStream os = new FileOutputStream(f);
                try {
                    os.write(bytes);
                } finally {
                    os.close();
                }
                savedTo = f.getAbsolutePath();
                uriForViewer = null;
            }

            toast("Saved " + safeName + " to " + savedTo);

            if (uriForViewer != null) {
                try {
                    Intent view = new Intent(Intent.ACTION_VIEW);
                    view.setDataAndType(uriForViewer,
                            mime == null || mime.length() == 0 ? "application/pdf" : mime);
                    view.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                            | Intent.FLAG_ACTIVITY_NEW_TASK);
                    activity.startActivity(view);
                } catch (Exception ignored) {
                    // no PDF viewer installed — the toast already confirms the save
                }
            }
        } catch (final Exception e) {
            toast("Download failed: " + e.getMessage());
        }
    }

    @JavascriptInterface
    public void toast(final String msg) {
        new Handler(Looper.getMainLooper()).post(new Runnable() {
            @Override
            public void run() {
                Toast.makeText(activity, msg, Toast.LENGTH_LONG).show();
            }
        });
    }
}
