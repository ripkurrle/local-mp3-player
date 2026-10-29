package com.aura.musicplayerlocal;

import android.Manifest;
import android.app.ActivityManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.Log;
import android.view.ViewGroup;
import android.view.WindowManager;

import com.google.firebase.FirebaseApp;
import com.google.firebase.crashlytics.FirebaseCrashlytics;
import android.webkit.JavascriptInterface;
import android.webkit.JsResult;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.appcompat.app.AlertDialog;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.documentfile.provider.DocumentFile;
import androidx.webkit.WebViewAssetLoader;

import org.json.JSONArray;
import org.json.JSONObject;

import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.os.ParcelFileDescriptor;
import android.util.Base64;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.RandomAccessFile;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.ByteBuffer;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

public class MainActivity extends AppCompatActivity {

    private static final int PERMISSION_REQ_CODE = 101;
    private static final int FILE_CHOOSER_REQ_CODE = 202;
    private static final int FOLDER_CHOOSER_REQ_CODE = 303;
    private static final int DIRECT_FILES_REQ_CODE = 404;
    private static final int SAVE_DIAGNOSTIC_REPORT_REQ_CODE = 505;

    private String pendingDiagnosticReportContent = null;

    public static final String ACTION_PREV = "com.aura.musicplayerlocal.ACTION_PREV";
    public static final String ACTION_TOGGLE = "com.aura.musicplayerlocal.ACTION_TOGGLE";
    public static final String ACTION_NEXT = "com.aura.musicplayerlocal.ACTION_NEXT";
    private static final String CHANNEL_ID = "aura_playback_channel";
    private static final int NOTIFICATION_ID = 1001;

    private volatile boolean isCurrentlyPlaying = false;
    private boolean isActivityResumed = false;
    private PowerManager.WakeLock activityWakeLock;

    private static final List<String> nativeLogs = Collections.synchronizedList(new ArrayList<>());

    public static class JavaScriptException extends Exception {
        public JavaScriptException(String message, String jsStackTrace) {
            super(message);
            if (jsStackTrace != null && !jsStackTrace.isEmpty()) {
                String[] lines = jsStackTrace.split("\n");
                List<StackTraceElement> elements = new ArrayList<>();
                for (String line : lines) {
                    String trimmed = line.trim();
                    if (trimmed.startsWith("at ")) trimmed = trimmed.substring(3).trim();
                    elements.add(new StackTraceElement("JavaScript", trimmed, "webview", 1));
                }
                if (!elements.isEmpty()) {
                    setStackTrace(elements.toArray(new StackTraceElement[0]));
                }
            }
        }
    }

    public static void logNativeEvent(String tag, String message) {
        try {
            String time = new SimpleDateFormat("HH:mm:ss.SSS", Locale.ROOT).format(new Date());
            String entry = "[" + time + "] " + tag + ": " + message;
            Log.d(tag, message);
            synchronized (nativeLogs) {
                if (nativeLogs.size() >= 120) {
                    nativeLogs.remove(0);
                }
                nativeLogs.add(entry);
            }
            try {
                FirebaseCrashlytics.getInstance().log(tag + ": " + message);
            } catch (Throwable ignored) {}
        } catch (Exception ignored) {}
    }

    public static JSONArray getRecentNativeLogsJson() {
        JSONArray arr = new JSONArray();
        synchronized (nativeLogs) {
            for (String l : nativeLogs) {
                arr.put(l);
            }
        }
        return arr;
    }

    private synchronized void acquirePlaybackWakeLock() {
        if (activityWakeLock == null) {
            try {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (pm != null) {
                    activityWakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "AuraPlayer:ActivityPlaybackWakeLock");
                    activityWakeLock.setReferenceCounted(false);
                }
            } catch (Exception e) {
                Log.e("AuraPlayer", "Error creating activity WakeLock", e);
            }
        }
        if (activityWakeLock != null && !activityWakeLock.isHeld()) {
            activityWakeLock.acquire();
            Log.d("AuraPlayer", "Activity Playback WakeLock acquired (screen can dim/turn off, CPU remains awake)");
            logNativeEvent("WakeLock", "Activity Playback WakeLock acquired");
        }
    }

    private synchronized void releasePlaybackWakeLock() {
        if (activityWakeLock != null && activityWakeLock.isHeld()) {
            activityWakeLock.release();
            Log.d("AuraPlayer", "Activity Playback WakeLock released");
            logNativeEvent("WakeLock", "Activity Playback WakeLock released");
        }
    }

    private final BroadcastReceiver screenReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (intent == null || intent.getAction() == null) return;
            String action = intent.getAction();
            logNativeEvent("PowerReceiver", "System event: " + action + ", isCurrentlyPlaying=" + isCurrentlyPlaying);
            if (Intent.ACTION_SCREEN_OFF.equals(action) ||
                PowerManager.ACTION_DEVICE_IDLE_MODE_CHANGED.equals(action)) {
                Log.d("AuraPlayer", "System sleep/idle event (" + action + ") received. isCurrentlyPlaying=" + isCurrentlyPlaying);
                if (!isCurrentlyPlaying) {
                    Log.d("AuraPlayer", "App put to sleep while inactive. Immediately dismissing notification.");
                    dismissNotification();
                } else {
                    // While music is playing, the screen can dim and turn off, but music continues uninterrupted!
                    acquirePlaybackWakeLock();
                }
            }
        }
    };

    private static final Set<String> ALLOWABLE_AUDIO_EXTENSIONS = new HashSet<>(Arrays.asList(
        "mp3", "wav", "ogg", "m4a", "flac", "aac", "weba", "opus", "wma", "mid", "midi", "ape", "aiff", "alac"
    ));

    private WebView webView;
    private ValueCallback<Uri[]> uploadMessage;
    private final Map<String, String> fileUriMap = Collections.synchronizedMap(new HashMap<>());

    private final BroadcastReceiver mediaReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (intent == null || intent.getAction() == null) return;
            String action = intent.getAction();

            // Briefly hold a partial wake lock so the CPU processes the playback action even if device was idle
            try {
                PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
                if (pm != null) {
                    PowerManager.WakeLock wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "AuraPlayer:MediaActionWakeLock");
                    wl.acquire(3000);
                }
            } catch (Exception ignored) {}

            if (ACTION_PREV.equals(action)) {
                if (webView != null) {
                    webView.post(() -> webView.evaluateJavascript("if (window.auraApp) { window.auraApp.playPrev(); }", null));
                }
            } else if (ACTION_TOGGLE.equals(action)) {
                if (webView != null) {
                    webView.post(() -> webView.evaluateJavascript("if (window.auraApp) { window.auraApp.togglePlayPause(); }", null));
                }
            } else if (ACTION_NEXT.equals(action)) {
                if (webView != null) {
                    webView.post(() -> webView.evaluateJavascript("if (window.auraApp) { window.auraApp.playNext(); }", null));
                }
            }
        }
    };

    public class AndroidBridge {
        @JavascriptInterface
        public void openFolderPicker() {
            runOnUiThread(() -> {
                try {
                    Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
                    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION |
                                    Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION |
                                    Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
                    startActivityForResult(intent, FOLDER_CHOOSER_REQ_CODE);
                } catch (Exception e) {
                    Log.e("AuraPlayer", "Cannot start folder picker", e);
                    Toast.makeText(MainActivity.this, "Cannot open folder picker", Toast.LENGTH_SHORT).show();
                }
            });
        }

        @JavascriptInterface
        public void openFilePicker() {
            runOnUiThread(() -> {
                try {
                    Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("audio/*");
                    intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION |
                                    Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
                    startActivityForResult(intent, DIRECT_FILES_REQ_CODE);
                } catch (Exception e) {
                    Log.e("AuraPlayer", "Cannot start document picker", e);
                    Toast.makeText(MainActivity.this, "Cannot open file picker", Toast.LENGTH_SHORT).show();
                }
            });
        }

        @JavascriptInterface
        public boolean isNativeApp() {
            return true;
        }

        @JavascriptInterface
        public String getDiagnosticInfo() {
            try {
                JSONObject obj = new JSONObject();
                obj.put("isNativeApp", true);
                obj.put("isCurrentlyPlaying", isCurrentlyPlaying);
                obj.put("isActivityWakeLockHeld", (activityWakeLock != null && activityWakeLock.isHeld()));
                obj.put("isServiceWakeLockHeld", PlaybackService.isWakeLockHeld());
                obj.put("isForegroundRunning", PlaybackService.isRunning());

                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (pm != null) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        obj.put("isIgnoringBatteryOptimizations", pm.isIgnoringBatteryOptimizations(getPackageName()));
                        obj.put("isDeviceIdleMode", pm.isDeviceIdleMode());
                        obj.put("isPowerSaveMode", pm.isPowerSaveMode());
                    } else {
                        obj.put("isIgnoringBatteryOptimizations", true);
                        obj.put("isDeviceIdleMode", false);
                        obj.put("isPowerSaveMode", false);
                    }
                }

                // Memory info
                ActivityManager am = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
                if (am != null) {
                    ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
                    am.getMemoryInfo(mi);
                    obj.put("availMemoryMB", mi.availMem / (1024 * 1024));
                    obj.put("totalMemoryMB", mi.totalMem / (1024 * 1024));
                    obj.put("lowMemory", mi.lowMemory);
                }

                // Battery info
                IntentFilter ifilter = new IntentFilter(Intent.ACTION_BATTERY_CHANGED);
                Intent batteryStatus = registerReceiver(null, ifilter);
                if (batteryStatus != null) {
                    int level = batteryStatus.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
                    int scale = batteryStatus.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
                    int status = batteryStatus.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
                    boolean isCharging = (status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL);
                    obj.put("batteryLevel", (int) ((level / (float) scale) * 100));
                    obj.put("isCharging", isCharging);
                }

                obj.put("androidVersion", Build.VERSION.RELEASE + " (API " + Build.VERSION.SDK_INT + ")");
                obj.put("nativeLogs", getRecentNativeLogsJson());
                obj.put("crashlyticsAvailable", isCrashlyticsAvailableInternal());

                return obj.toString();
            } catch (Exception e) {
                Log.e("AuraPlayer", "Error collecting diagnostic info", e);
                return "{}";
            }
        }

        private boolean isCrashlyticsAvailableInternal() {
            try {
                FirebaseCrashlytics.getInstance().setCustomKey("crashlytics_probe", true);
                return true;
            } catch (Throwable t) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean isCrashlyticsAvailable() {
            return isCrashlyticsAvailableInternal();
        }

        @JavascriptInterface
        public void logCrashlytics(String message) {
            try {
                if (message != null) {
                    FirebaseCrashlytics.getInstance().log(message);
                    logNativeEvent("Crashlytics", message);
                }
            } catch (Throwable t) {
                Log.w("AuraPlayer", "Error logging to Crashlytics", t);
            }
        }

        @JavascriptInterface
        public void setCrashlyticsCustomKey(String key, String value) {
            try {
                if (key != null && value != null) {
                    FirebaseCrashlytics.getInstance().setCustomKey(key, value);
                }
            } catch (Throwable t) {
                Log.w("AuraPlayer", "Error setting Crashlytics key", t);
            }
        }

        @JavascriptInterface
        public void recordNonFatal(String tag, String message, String stackTrace) {
            try {
                FirebaseCrashlytics crashlytics = FirebaseCrashlytics.getInstance();
                crashlytics.setCustomKey("non_fatal_tag", tag != null ? tag : "unknown");
                crashlytics.setCustomKey("non_fatal_msg", message != null ? message : "");
                JavaScriptException jsEx = new JavaScriptException((tag != null ? tag : "JS") + ": " + (message != null ? message : "NonFatal"), stackTrace);
                crashlytics.recordException(jsEx);
                logNativeEvent("Crashlytics-NonFatal", (tag != null ? tag : "JS") + ": " + (message != null ? message : ""));
            } catch (Throwable t) {
                Log.w("AuraPlayer", "Error recording non-fatal to Crashlytics", t);
            }
        }

        @JavascriptInterface
        public void testCrashlyticsNonFatal() {
            try {
                FirebaseCrashlytics crashlytics = FirebaseCrashlytics.getInstance();
                crashlytics.log("User triggered manual non-fatal test exception from Diagnostics UI");
                crashlytics.setCustomKey("test_event", true);
                crashlytics.recordException(new RuntimeException("Aura Music Player: Manual test non-fatal exception from UI"));
                logNativeEvent("Crashlytics-Test", "Test non-fatal exception recorded to Firebase");
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "Crashlytics: Test non-fatal event recorded!", Toast.LENGTH_SHORT).show());
            } catch (Throwable t) {
                Log.e("AuraPlayer", "Failed to record test non-fatal", t);
            }
        }

        @JavascriptInterface
        public void testCrashlyticsCrash() {
            try {
                FirebaseCrashlytics.getInstance().log("Forcing test crash per Firebase guide");
            } catch (Throwable ignored) {}
            // Per official Firebase guide: force a crash using RuntimeException on the Main Looper
            new Handler(Looper.getMainLooper()).post(() -> {
                throw new RuntimeException("Test Crash"); // Force a crash
            });
        }

        @JavascriptInterface
        public void saveDiagnosticReport(String reportContent, String suggestedFilename) {
            pendingDiagnosticReportContent = reportContent;
            runOnUiThread(() -> {
                try {
                    Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("text/plain");
                    String fileName = (suggestedFilename != null && !suggestedFilename.isEmpty())
                            ? suggestedFilename
                            : "aura-diagnostic-report-" + new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.ROOT).format(new Date()) + ".txt";
                    intent.putExtra(Intent.EXTRA_TITLE, fileName);
                    startActivityForResult(intent, SAVE_DIAGNOSTIC_REPORT_REQ_CODE);
                } catch (Exception e) {
                    Log.e("AuraPlayer", "Error launching ACTION_CREATE_DOCUMENT for report", e);
                    Toast.makeText(MainActivity.this, "Cannot open file save dialog: " + e.getMessage(), Toast.LENGTH_SHORT).show();
                    pendingDiagnosticReportContent = null;
                }
            });
        }

        @JavascriptInterface
        public void requestIgnoreBatteryOptimizations() {
            runOnUiThread(() -> {
                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                        if (pm != null && !pm.isIgnoringBatteryOptimizations(getPackageName())) {
                            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                            intent.setData(Uri.parse("package:" + getPackageName()));
                            startActivity(intent);
                        } else {
                            Toast.makeText(MainActivity.this, "Aura already has Unrestricted battery usage", Toast.LENGTH_SHORT).show();
                        }
                    }
                } catch (Exception e) {
                    Log.e("AuraPlayer", "Error opening battery optimization request", e);
                    try {
                        Intent intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                        startActivity(intent);
                    } catch (Exception ex) {
                        Toast.makeText(MainActivity.this, "Open Android Settings -> Apps -> Aura -> Battery -> Unrestricted", Toast.LENGTH_LONG).show();
                    }
                }
            });
        }

        @JavascriptInterface
        public void updateNotification(String title, String artist, String album, boolean isPlaying) {
            runOnUiThread(() -> {
                isCurrentlyPlaying = isPlaying;
                if (!isPlaying) {
                    dismissNotification();
                } else {
                    showOrUpdateNotification(title, artist, album, true);
                }
            });
        }

        @JavascriptInterface
        public void hideNotification() {
            runOnUiThread(() -> {
                isCurrentlyPlaying = false;
                dismissNotification();
            });
        }

        @JavascriptInterface
        public String getContentUriForFilename(String fileName) {
            if (fileName == null) return null;
            String uri = fileUriMap.get(fileName);
            if (uri != null) return uri;
            return fileUriMap.get(cleanFileName(fileName));
        }

        @JavascriptInterface
        public String transcodeBlobBase64(String base64Data, String fileName) {
            if (base64Data == null || base64Data.isEmpty()) return null;
            File tempInput = null;
            try {
                int comma = base64Data.indexOf(',');
                String raw = (comma != -1) ? base64Data.substring(comma + 1) : base64Data;
                byte[] bytes = Base64.decode(raw, Base64.DEFAULT);

                String safeName = (fileName != null) ? fileName.replaceAll("[^a-zA-Z0-9_\\-\\.]", "_") : "upload";
                tempInput = new File(getCacheDir(), "input_" + System.currentTimeMillis() + "_" + safeName);
                try (FileOutputStream fos = new FileOutputStream(tempInput)) {
                    fos.write(bytes);
                }

                String cacheKey = "transcoded_blob_" + Math.abs(safeName.hashCode()) + "_" + bytes.length + ".wav";
                File cachedFile = new File(getCacheDir(), cacheKey);
                if (cachedFile.exists() && cachedFile.length() > 44) {
                    return "https://appassets.androidplatform.net/local-media?cached=" + cachedFile.getName();
                }

                MediaExtractor extractor = new MediaExtractor();
                extractor.setDataSource(tempInput.getAbsolutePath());
                int audioTrack = -1;
                MediaFormat format = null;
                String mime = null;

                for (int i = 0; i < extractor.getTrackCount(); i++) {
                    MediaFormat f = extractor.getTrackFormat(i);
                    String m = f.getString(MediaFormat.KEY_MIME);
                    if (m != null && m.startsWith("audio/")) {
                        audioTrack = i;
                        format = f;
                        mime = m;
                        break;
                    }
                }

                if (audioTrack != -1 && mime != null) {
                    boolean success = decodeAudioToWav(extractor, audioTrack, format, mime, cachedFile);
                    extractor.release();
                    if (success && cachedFile.exists() && cachedFile.length() > 44) {
                        return "https://appassets.androidplatform.net/local-media?cached=" + cachedFile.getName();
                    }
                } else {
                    extractor.release();
                }
            } catch (Exception e) {
                Log.e("AuraPlayer", "Error transcoding blob base64", e);
            } finally {
                if (tempInput != null && tempInput.exists()) {
                    tempInput.delete();
                }
            }
            return null;
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        try {
            FirebaseApp.initializeApp(this);
            FirebaseCrashlytics crashlytics = FirebaseCrashlytics.getInstance();
            crashlytics.setCrashlyticsCollectionEnabled(true);
            crashlytics.setCustomKey("app_version", "1.0.0");
            crashlytics.setCustomKey("device_model", Build.MANUFACTURER + " " + Build.MODEL);
            crashlytics.setCustomKey("android_api", Build.VERSION.SDK_INT);
            crashlytics.sendUnsentReports();
            crashlytics.log("Aura MainActivity initialized");
        } catch (Throwable t) {
            Log.w("AuraPlayer", "Firebase Crashlytics init note: " + t.getMessage());
        }

        // Enable edge-to-edge full screen
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            getWindow().getAttributes().layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }

        setFullScreenImmersive();

        webView = new WebView(this);
        webView.setLayoutParams(new ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));
        setContentView(webView);

        setupWebView();
        checkStoragePermissions();
        createNotificationChannel();

        IntentFilter filter = new IntentFilter();
        filter.addAction(ACTION_PREV);
        filter.addAction(ACTION_TOGGLE);
        filter.addAction(ACTION_NEXT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.registerReceiver(this, mediaReceiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(mediaReceiver, filter);
        }

        IntentFilter screenFilter = new IntentFilter();
        screenFilter.addAction(Intent.ACTION_SCREEN_OFF);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            screenFilter.addAction(PowerManager.ACTION_DEVICE_IDLE_MODE_CHANGED);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.registerReceiver(this, screenReceiver, screenFilter, ContextCompat.RECEIVER_EXPORTED);
        } else {
            registerReceiver(screenReceiver, screenFilter);
        }

        // Load the local HTML5 MP3 player app via secure WebViewAssetLoader
        webView.loadUrl("https://appassets.androidplatform.net/assets/index.html");
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            setFullScreenImmersive();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        isActivityResumed = true;
        setFullScreenImmersive();
        if (!isCurrentlyPlaying) {
            dismissNotification();
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        isActivityResumed = false;
        if (!isCurrentlyPlaying) {
            dismissNotification();
        }
    }

    @Override
    protected void onStop() {
        super.onStop();
        isActivityResumed = false;
        if (!isCurrentlyPlaying) {
            Log.d("AuraPlayer", "App stopped/backgrounded while inactive. Dismissing notification.");
            dismissNotification();
        }
    }

    @Override
    public void onTrimMemory(int level) {
        super.onTrimMemory(level);
        if (!isCurrentlyPlaying) {
            dismissNotification();
        }
    }

    private void setFullScreenImmersive() {
        WindowInsetsControllerCompat controller =
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        if (controller != null) {
            // Hide the system status bar and navigation bar so they never overlap the app UI
            controller.hide(WindowInsetsCompat.Type.systemBars());
            controller.setSystemBarsBehavior(
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            );
        }
    }

    private void setupWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        // Bridge to allow JavaScript to invoke native folder selection
        webView.addJavascriptInterface(new AndroidBridge(), "AndroidBridge");

        final WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
            .build();

        // Stream local assets securely with full fetch/audio streaming support
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if ("appassets.androidplatform.net".equals(url.getHost())) {
                    String path = url.getPath();
                    if ("/local-media".equals(path)) {
                        String cachedParam = url.getQueryParameter("cached");
                        if (cachedParam != null && !cachedParam.isEmpty()) {
                            File cachedFile = new File(getCacheDir(), cachedParam);
                            if (cachedFile.exists() && cachedFile.length() > 0) {
                                return serveFileWithRanges(request, cachedFile, "audio/wav");
                            }
                        }

                        String uriStr = url.getQueryParameter("uri");
                        String extParam = url.getQueryParameter("ext");
                        if (uriStr != null) {
                            try {
                                Uri contentUri = Uri.parse(uriStr);
                                String rawMime = getContentResolver().getType(contentUri);
                                String mime = normalizeAudioMimeType(rawMime, extParam, uriStr);

                                ParcelFileDescriptor pfd = getContentResolver().openFileDescriptor(contentUri, "r");
                                if (pfd != null) {
                                    String ext = (extParam != null) ? extParam.toLowerCase(Locale.ROOT) : "";
                                    boolean isStandardBrowserFormat =
                                        ext.equals("mp3") || ext.equals("wav") || ext.equals("flac") ||
                                        ext.equals("ogg") || ext.equals("opus") || ext.equals("weba") || ext.equals("aac");

                                    // Only run MediaCodec transcode check for non-browser formats (e.g. E-AC-3 in M4A, AC-3, ALAC)
                                    // This prevents MediaExtractor from reading and corrupting the file offset of standard MP3/FLAC/WAV files!
                                    if (!isStandardBrowserFormat) {
                                        File transcodedFile = getOrCreateTranscodedFile(contentUri, pfd, extParam, uriStr);
                                        if (transcodedFile != null && transcodedFile.exists() && transcodedFile.length() > 0) {
                                            pfd.close();
                                            return serveFileWithRanges(request, transcodedFile, "audio/wav");
                                        }
                                    }

                                    long totalLength = pfd.getStatSize();
                                    if (totalLength <= 0) {
                                        try {
                                            FileInputStream tempFis = new FileInputStream(pfd.getFileDescriptor());
                                            totalLength = tempFis.getChannel().size();
                                        } catch (Exception ignored) {}
                                    }

                                    Map<String, String> reqHeaders = request.getRequestHeaders();
                                    String rangeHeader = null;
                                    if (reqHeaders != null) {
                                        rangeHeader = reqHeaders.get("Range");
                                        if (rangeHeader == null) rangeHeader = reqHeaders.get("range");
                                    }

                                    long start = 0;
                                    long end = (totalLength > 0) ? (totalLength - 1) : -1;
                                    boolean isRange = false;

                                    if (rangeHeader != null && rangeHeader.startsWith("bytes=")) {
                                        String rangeSpec = rangeHeader.substring(6).trim();
                                        int dash = rangeSpec.indexOf('-');
                                        if (dash == 0 && totalLength > 0) {
                                            // Suffix range: bytes=-500
                                            try {
                                                long suffix = Long.parseLong(rangeSpec.substring(1));
                                                start = Math.max(0, totalLength - suffix);
                                                end = totalLength - 1;
                                                isRange = true;
                                            } catch (NumberFormatException ignored) {}
                                        } else if (dash > 0) {
                                            try {
                                                start = Long.parseLong(rangeSpec.substring(0, dash));
                                                String endStr = rangeSpec.substring(dash + 1).trim();
                                                if (!endStr.isEmpty()) {
                                                    end = Long.parseLong(endStr);
                                                }
                                                if (totalLength > 0 && end >= totalLength) {
                                                    end = totalLength - 1;
                                                }
                                                isRange = true;
                                            } catch (NumberFormatException ignored) {}
                                        }
                                    }

                                    if (start < 0) start = 0;
                                    if (totalLength > 0 && start >= totalLength) {
                                        Map<String, String> errHeaders = new HashMap<>();
                                        errHeaders.put("Access-Control-Allow-Origin", "*");
                                        errHeaders.put("Content-Range", "bytes */" + totalLength);
                                        pfd.close();
                                        return new WebResourceResponse(mime, null, 416, "Range Not Satisfiable", errHeaders, new ByteArrayInputStream(new byte[0]));
                                    }

                                    long contentLength = (end >= start) ? (end - start + 1) : totalLength;
                                    FileInputStream fis = new FileInputStream(pfd.getFileDescriptor());
                                    try {
                                        fis.getChannel().position(start);
                                    } catch (Exception seekErr) {
                                        Log.w("AuraPlayer", "FileChannel position failed for start " + start + ", falling back to skip: " + seekErr.getMessage());
                                        long toSkip = start;
                                        while (toSkip > 0) {
                                            long s = fis.skip(toSkip);
                                            if (s <= 0) break;
                                            toSkip -= s;
                                        }
                                    }

                                    InputStream stream = new BoundedInputStream(
                                        fis,
                                        (contentLength > 0 ? contentLength : Long.MAX_VALUE),
                                        pfd,
                                        (isRange ? start : 0)
                                    );

                                    Map<String, String> respHeaders = new HashMap<>();
                                    respHeaders.put("Access-Control-Allow-Origin", "*");
                                    respHeaders.put("Accept-Ranges", "bytes");

                                    if (isRange && totalLength > 0) {
                                        respHeaders.put("Content-Range", "bytes " + start + "-" + end + "/" + totalLength);
                                        respHeaders.put("Content-Length", String.valueOf(contentLength));
                                        return new WebResourceResponse(mime, null, 206, "Partial Content", respHeaders, stream);
                                    } else {
                                        if (totalLength > 0) {
                                            respHeaders.put("Content-Length", String.valueOf(totalLength));
                                        }
                                        return new WebResourceResponse(mime, null, 200, "OK", respHeaders, stream);
                                    }
                                } else {
                                    InputStream is = getContentResolver().openInputStream(contentUri);
                                    Map<String, String> headers = new HashMap<>();
                                    headers.put("Access-Control-Allow-Origin", "*");
                                    headers.put("Accept-Ranges", "bytes");
                                    return new WebResourceResponse(mime, null, 200, "OK", headers, is);
                                }
                            } catch (Exception e) {
                                Log.e("AuraPlayer", "Error opening local-media: " + uriStr, e);
                            }
                        }
                    } else if ("/local-media-art".equals(path)) {
                        String uriStr = url.getQueryParameter("uri");
                        if (uriStr != null) {
                            MediaMetadataRetriever mmr = new MediaMetadataRetriever();
                            try {
                                Uri contentUri = Uri.parse(uriStr);
                                mmr.setDataSource(MainActivity.this, contentUri);
                                byte[] art = mmr.getEmbeddedPicture();
                                if (art != null && art.length > 0) {
                                    ByteArrayInputStream bais = new ByteArrayInputStream(art);
                                    Map<String, String> headers = new HashMap<>();
                                    headers.put("Access-Control-Allow-Origin", "*");
                                    headers.put("Cache-Control", "max-age=86400");
                                    return new WebResourceResponse("image/jpeg", null, 200, "OK", headers, bais);
                                }
                            } catch (Exception ignored) {
                            } finally {
                                try {
                                    mmr.release();
                                } catch (Exception ignored) {}
                            }
                        }
                    }
                }
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            @SuppressWarnings("deprecation")
            public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
                return assetLoader.shouldInterceptRequest(Uri.parse(url));
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                    .setTitle("Aura Music Player")
                    .setMessage(message)
                    .setPositiveButton(android.R.string.ok, (dialog, which) -> result.confirm())
                    .setOnCancelListener(dialog -> result.cancel())
                    .show();
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                    .setTitle("Aura Music Player")
                    .setMessage(message)
                    .setPositiveButton(android.R.string.ok, (dialog, which) -> result.confirm())
                    .setNegativeButton(android.R.string.cancel, (dialog, which) -> result.cancel())
                    .setOnCancelListener(dialog -> result.cancel())
                    .show();
                return true;
            }

            // Support native file picker (<input type="file">)
            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback, FileChooserParams fileChooserParams) {
                if (uploadMessage != null) {
                    uploadMessage.onReceiveValue(null);
                    uploadMessage = null;
                }
                uploadMessage = filePathCallback;

                // Check if the input specifically requested a directory / folder
                boolean isFolder = false;
                String[] acceptTypes = fileChooserParams.getAcceptTypes();
                if (acceptTypes != null) {
                    for (String t : acceptTypes) {
                        if (t != null && (t.contains("directory") || t.contains("folder"))) {
                            isFolder = true;
                            break;
                        }
                    }
                }

                if (isFolder) {
                    try {
                        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
                        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION |
                                        Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
                        startActivityForResult(intent, FOLDER_CHOOSER_REQ_CODE);
                        return true;
                    } catch (Exception e) {
                        Log.e("AuraPlayer", "Cannot start folder picker from onShowFileChooser", e);
                    }
                }

                Intent intent = fileChooserParams.createIntent();
                try {
                    startActivityForResult(intent, FILE_CHOOSER_REQ_CODE);
                } catch (Exception e) {
                    uploadMessage = null;
                    Toast.makeText(MainActivity.this, "Cannot open file picker", Toast.LENGTH_SHORT).show();
                    return false;
                }
                return true;
            }
        });
    }

    private void checkStoragePermissions() {
        List<String> perms = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            // Android 13+
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_MEDIA_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                perms.add(Manifest.permission.READ_MEDIA_AUDIO);
            }
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                perms.add(Manifest.permission.POST_NOTIFICATIONS);
            }
        } else {
            // Android 12 and below
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                perms.add(Manifest.permission.READ_EXTERNAL_STORAGE);
            }
        }
        if (!perms.isEmpty()) {
            ActivityCompat.requestPermissions(this, perms.toArray(new String[0]), PERMISSION_REQ_CODE);
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, @Nullable Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        if (requestCode == FILE_CHOOSER_REQ_CODE) {
            if (uploadMessage == null) return;

            Uri[] results = null;
            if (resultCode == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    int count = data.getClipData().getItemCount();
                    results = new Uri[count];
                    for (int i = 0; i < count; i++) {
                        results[i] = data.getClipData().getItemAt(i).getUri();
                    }
                } else if (data.getData() != null) {
                    results = new Uri[]{data.getData()};
                }
            }
            if (results != null) {
                for (Uri uri : results) {
                    try {
                        String name = getFileNameFromUri(uri);
                        if (name != null) {
                            fileUriMap.put(name, uri.toString());
                            fileUriMap.put(cleanFileName(name), uri.toString());
                        }
                    } catch (Exception ignored) {}
                }
            }

            uploadMessage.onReceiveValue(results);
            uploadMessage = null;
        } else if (requestCode == FOLDER_CHOOSER_REQ_CODE) {
            if (uploadMessage != null) {
                try {
                    uploadMessage.onReceiveValue(null);
                } catch (Exception ignored) {}
                uploadMessage = null;
            }
            if (resultCode == RESULT_OK && data != null) {
                Uri treeUri = data.getData();
                if (treeUri != null) {
                    try {
                        int takeFlags = data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                        if (takeFlags == 0) {
                            takeFlags = Intent.FLAG_GRANT_READ_URI_PERMISSION;
                        }
                        getContentResolver().takePersistableUriPermission(treeUri, takeFlags);
                    } catch (Exception e) {
                        Log.w("AuraPlayer", "takePersistableUriPermission failed", e);
                    }
                    processSelectedFolder(treeUri);
                }
            }
        } else if (requestCode == DIRECT_FILES_REQ_CODE) {
            if (uploadMessage != null) {
                try {
                    uploadMessage.onReceiveValue(null);
                } catch (Exception ignored) {}
                uploadMessage = null;
            }
            if (resultCode == RESULT_OK && data != null) {
                List<Uri> uris = new ArrayList<>();
                if (data.getClipData() != null) {
                    int count = data.getClipData().getItemCount();
                    for (int i = 0; i < count; i++) {
                        Uri u = data.getClipData().getItemAt(i).getUri();
                        if (u != null) uris.add(u);
                    }
                } else if (data.getData() != null) {
                    uris.add(data.getData());
                }

                int takeFlags = data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                if (takeFlags == 0) {
                    takeFlags = Intent.FLAG_GRANT_READ_URI_PERMISSION;
                }
                for (Uri uri : uris) {
                    try {
                        getContentResolver().takePersistableUriPermission(uri, takeFlags);
                    } catch (Exception e) {
                        Log.w("AuraPlayer", "takePersistableUriPermission failed for " + uri, e);
                    }
                }

                processDirectUris(uris);
            }
        } else if (requestCode == SAVE_DIAGNOSTIC_REPORT_REQ_CODE) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                Uri destUri = data.getData();
                if (pendingDiagnosticReportContent != null) {
                    try (java.io.OutputStream os = getContentResolver().openOutputStream(destUri)) {
                        if (os != null) {
                            os.write(pendingDiagnosticReportContent.getBytes(java.nio.charset.StandardCharsets.UTF_8));
                            os.flush();
                            Toast.makeText(this, "Diagnostic report saved to file!", Toast.LENGTH_SHORT).show();
                            if (webView != null) {
                                webView.post(() -> webView.evaluateJavascript("if (window.auraApp) { window.auraApp.showToast('Diagnostic report saved to file!'); }", null));
                            }
                        }
                    } catch (Exception e) {
                        Log.e("AuraPlayer", "Failed to write diagnostic report", e);
                        Toast.makeText(this, "Failed to write report: " + e.getMessage(), Toast.LENGTH_LONG).show();
                    } finally {
                        pendingDiagnosticReportContent = null;
                    }
                }
            } else {
                pendingDiagnosticReportContent = null;
            }
        }
    }

    private void processDirectUris(List<Uri> uris) {
        if (uris == null || uris.isEmpty()) return;
        Toast.makeText(this, "Indexing " + uris.size() + " audio file(s)...", Toast.LENGTH_SHORT).show();

        new Thread(() -> {
            JSONArray jsonArray = new JSONArray();

            for (Uri uri : uris) {
                try {
                    String fileName = getFileNameFromUri(uri);
                    if (fileName == null) fileName = "Unknown Track";

                    String extension = "";
                    int dotIdx = fileName.lastIndexOf('.');
                    if (dotIdx > 0 && dotIdx < fileName.length() - 1) {
                        extension = fileName.substring(dotIdx + 1).toUpperCase(Locale.ROOT);
                    }

                    String title = cleanFileName(fileName);
                    String artist = "Unknown Artist";
                    if (title.contains(" - ")) {
                        String[] parts = title.split(" - ", 2);
                        if (parts.length == 2) {
                            artist = parts[0].trim();
                            title = parts[1].trim();
                        }
                    }

                    String album = "Local Music";
                    String year = "";
                    String genre = "Music";
                    long durationMs = 0;
                    long fileSize = 0;

                    try {
                        ParcelFileDescriptor pfd = getContentResolver().openFileDescriptor(uri, "r");
                        if (pfd != null) {
                            fileSize = pfd.getStatSize();
                            pfd.close();
                        }
                    } catch (Exception ignored) {}

                    MediaMetadataRetriever mmr = null;
                    try {
                        mmr = new MediaMetadataRetriever();
                        mmr.setDataSource(this, uri);
                        String metaTitle = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE);
                        String metaArtist = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST);
                        String metaAlbum = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUM);
                        String metaYear = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_YEAR);
                        String metaGenre = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_GENRE);
                        String metaDuration = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);

                        if (metaTitle != null && !metaTitle.trim().isEmpty()) title = metaTitle.trim();
                        if (metaArtist != null && !metaArtist.trim().isEmpty()) artist = metaArtist.trim();
                        if (metaAlbum != null && !metaAlbum.trim().isEmpty()) album = metaAlbum.trim();
                        if (metaYear != null && !metaYear.trim().isEmpty()) year = metaYear.trim();
                        if (metaGenre != null && !metaGenre.trim().isEmpty()) genre = metaGenre.trim();
                        if (metaDuration != null) {
                            try {
                                durationMs = Long.parseLong(metaDuration);
                            } catch (NumberFormatException ignored) {}
                        }
                    } catch (Exception ignored) {
                    } finally {
                        if (mmr != null) {
                            try {
                                mmr.release();
                            } catch (Exception ignored) {}
                        }
                    }

                    String uriStr = uri.toString();
                    fileUriMap.put(fileName, uriStr);
                    fileUriMap.put(cleanFileName(fileName), uriStr);
                    String encodedUri = URLEncoder.encode(uriStr, "UTF-8");
                    String extParam = extension.isEmpty() ? "audio" : extension.toLowerCase(Locale.ROOT);

                    JSONObject obj = new JSONObject();
                    obj.put("id", "direct_" + System.currentTimeMillis() + "_" + Math.abs(uri.hashCode()));
                    obj.put("title", title);
                    obj.put("artist", artist);
                    obj.put("album", album);
                    obj.put("year", year);
                    obj.put("genre", genre);
                    obj.put("format", extension.isEmpty() ? "AUDIO" : extension);
                    obj.put("size", fileSize);
                    obj.put("duration", durationMs / 1000.0);
                    obj.put("url", "https://appassets.androidplatform.net/local-media?uri=" + encodedUri + "&ext=" + extParam);
                    obj.put("pictureUrl", "https://appassets.androidplatform.net/local-media-art?uri=" + encodedUri);
                    obj.put("contentUri", uriStr);
                    obj.put("isFavorite", false);
                    obj.put("playCount", 0);
                    obj.put("addedAt", System.currentTimeMillis());

                    jsonArray.put(obj);
                } catch (Exception e) {
                    Log.e("AuraPlayer", "Error processing direct file URI: " + uri, e);
                }
            }

            final String jsonString = jsonArray.toString();
            final int count = jsonArray.length();

            runOnUiThread(() -> {
                String safeJson = jsonString.replace("\u2028", "\\u2028").replace("\u2029", "\\u2029");
                String js = "if (window.onNativeFolderImported) window.onNativeFolderImported(" + safeJson + ");";
                webView.evaluateJavascript(js, null);
                Toast.makeText(this, "Loaded " + count + " track(s) directly from storage (0 bytes DB duplicate)!", Toast.LENGTH_SHORT).show();
            });
        }).start();
    }

    private void processSelectedFolder(Uri treeUri) {
        Toast.makeText(this, "Scanning folder for music...", Toast.LENGTH_SHORT).show();
        webView.evaluateJavascript("if (window.onFolderScanStart) window.onFolderScanStart();", null);

        new Thread(() -> {
            DocumentFile rootDir = DocumentFile.fromTreeUri(this, treeUri);
            if (rootDir == null) {
                runOnUiThread(() -> Toast.makeText(this, "Unable to access folder", Toast.LENGTH_SHORT).show());
                return;
            }

            List<DocumentFile> audioFiles = new ArrayList<>();
            scanDirectoryRecursively(rootDir, audioFiles, 0);

            if (audioFiles.isEmpty()) {
                runOnUiThread(() -> {
                    Toast.makeText(this, "No allowable music files found in folder", Toast.LENGTH_LONG).show();
                    webView.evaluateJavascript("if (window.onFolderScanEnd) window.onFolderScanEnd(0);", null);
                });
                return;
            }

            JSONArray jsonArray = new JSONArray();

            for (DocumentFile file : audioFiles) {
                try {
                    JSONObject obj = new JSONObject();
                    String fileName = file.getName();
                    if (fileName == null) fileName = "Unknown Track";

                    String extension = "";
                    int dotIdx = fileName.lastIndexOf('.');
                    if (dotIdx > 0 && dotIdx < fileName.length() - 1) {
                        extension = fileName.substring(dotIdx + 1).toUpperCase(Locale.ROOT);
                    }

                    String title = cleanFileName(fileName);
                    String artist = "Unknown Artist";
                    if (title.contains(" - ")) {
                        String[] parts = title.split(" - ", 2);
                        if (parts.length == 2) {
                            artist = parts[0].trim();
                            title = parts[1].trim();
                        }
                    }

                    String album = "Local Music";
                    String year = "";
                    String genre = "Music";
                    long durationMs = 0;

                    MediaMetadataRetriever mmr = null;
                    try {
                        mmr = new MediaMetadataRetriever();
                        mmr.setDataSource(this, file.getUri());
                        String metaTitle = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE);
                        String metaArtist = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST);
                        String metaAlbum = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUM);
                        String metaYear = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_YEAR);
                        String metaGenre = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_GENRE);
                        String metaDuration = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);

                        if (metaTitle != null && !metaTitle.trim().isEmpty()) title = metaTitle.trim();
                        if (metaArtist != null && !metaArtist.trim().isEmpty()) artist = metaArtist.trim();
                        if (metaAlbum != null && !metaAlbum.trim().isEmpty()) album = metaAlbum.trim();
                        if (metaYear != null && !metaYear.trim().isEmpty()) year = metaYear.trim();
                        if (metaGenre != null && !metaGenre.trim().isEmpty()) genre = metaGenre.trim();
                        if (metaDuration != null) {
                            try {
                                durationMs = Long.parseLong(metaDuration);
                            } catch (NumberFormatException ignored) {}
                        }
                    } catch (Exception ignored) {
                    } finally {
                        if (mmr != null) {
                            try {
                                mmr.release();
                            } catch (Exception ignored) {}
                        }
                    }

                    String uriStr = file.getUri().toString();
                    fileUriMap.put(fileName, uriStr);
                    fileUriMap.put(cleanFileName(fileName), uriStr);
                    String encodedUri = URLEncoder.encode(uriStr, "UTF-8");
                    String extParam = extension.isEmpty() ? "audio" : extension.toLowerCase(Locale.ROOT);

                    obj.put("id", "folder_" + System.currentTimeMillis() + "_" + Math.abs(file.getUri().hashCode()));
                    obj.put("title", title);
                    obj.put("artist", artist);
                    obj.put("album", album);
                    obj.put("year", year);
                    obj.put("genre", genre);
                    obj.put("format", extension.isEmpty() ? "AUDIO" : extension);
                    obj.put("size", file.length());
                    obj.put("duration", durationMs / 1000.0);
                    obj.put("url", "https://appassets.androidplatform.net/local-media?uri=" + encodedUri + "&ext=" + extParam);
                    obj.put("pictureUrl", "https://appassets.androidplatform.net/local-media-art?uri=" + encodedUri);
                    obj.put("contentUri", uriStr);
                    obj.put("isFavorite", false);
                    obj.put("playCount", 0);
                    obj.put("addedAt", System.currentTimeMillis());

                    jsonArray.put(obj);
                } catch (Exception e) {
                    Log.e("AuraPlayer", "Error preparing track metadata: " + file.getName(), e);
                }
            }

            final String jsonString = jsonArray.toString();
            final int count = jsonArray.length();

            runOnUiThread(() -> {
                String safeJson = jsonString.replace("\u2028", "\\u2028").replace("\u2029", "\\u2029");
                String js = "if (window.onNativeFolderImported) window.onNativeFolderImported(" + safeJson + ");";
                webView.evaluateJavascript(js, null);
                Toast.makeText(this, "Imported " + count + " music file(s) from folder!", Toast.LENGTH_SHORT).show();
            });
        }).start();
    }

    private void scanDirectoryRecursively(DocumentFile dir, List<DocumentFile> audioFiles, int depth) {
        if (depth > 25) return;
        DocumentFile[] files = null;
        try {
            files = dir.listFiles();
        } catch (Exception e) {
            Log.w("AuraPlayer", "Failed to list files in " + dir.getName(), e);
        }
        if (files == null) return;
        for (DocumentFile file : files) {
            if (file.isDirectory()) {
                scanDirectoryRecursively(file, audioFiles, depth + 1);
            } else if (!file.isDirectory() && isAllowableAudioFile(file.getName(), file.getType())) {
                audioFiles.add(file);
            }
        }
    }

    private boolean isAllowableAudioFile(String name, String mimeType) {
        if (name != null) {
            int dot = name.lastIndexOf('.');
            if (dot >= 0 && dot < name.length() - 1) {
                String ext = name.substring(dot + 1).toLowerCase(Locale.ROOT);
                if (ALLOWABLE_AUDIO_EXTENSIONS.contains(ext)) {
                    return true;
                }
            }
        }
        if (mimeType != null && (mimeType.startsWith("audio/") || mimeType.equals("application/ogg") || mimeType.equals("application/x-flac"))) {
            return true;
        }
        return false;
    }

    private String cleanFileName(String name) {
        if (name == null) return "Unknown Track";
        int dot = name.lastIndexOf('.');
        String clean = (dot > 0) ? name.substring(0, dot) : name;
        clean = clean.replaceFirst("^\\s*\\d+[\\s\\.\\-_]+", "");
        clean = clean.replace('_', ' ');
        return clean.trim();
    }

    private String normalizeAudioMimeType(String mime, String extParam, String uriString) {
        if (mime != null) {
            String lower = mime.toLowerCase(Locale.ROOT).trim();
            if (lower.equals("audio/m4a") || lower.equals("audio/x-m4a") || lower.equals("audio/mp4a-latm")) {
                return "audio/mp4";
            }
            if (lower.equals("audio/aac") || lower.equals("audio/x-aac") || lower.equals("audio/aacp")) {
                return "audio/aac";
            }
            if (lower.equals("audio/mp3")) return "audio/mpeg";
            if (lower.equals("audio/x-wav") || lower.equals("audio/wave")) return "audio/wav";
            if (lower.equals("audio/x-flac") || lower.equals("application/x-flac")) return "audio/flac";
            if (lower.equals("application/ogg")) return "audio/ogg";
            if (lower.equals("audio/webm") || lower.equals("video/webm")) return "audio/webm";
            if (lower.startsWith("audio/")) return lower;
        }

        if (extParam != null && !extParam.isEmpty()) {
            String ext = extParam.toLowerCase(Locale.ROOT).trim();
            if (ext.equals("m4a")) return "audio/mp4";
            if (ext.equals("aac")) return "audio/aac";
            if (ext.equals("mp3")) return "audio/mpeg";
            if (ext.equals("wav")) return "audio/wav";
            if (ext.equals("flac")) return "audio/flac";
            if (ext.equals("ogg")) return "audio/ogg";
            if (ext.equals("opus")) return "audio/ogg";
            if (ext.equals("weba") || ext.equals("webm")) return "audio/webm";
        }

        if (uriString != null) {
            try {
                String decoded = URLDecoder.decode(uriString, "UTF-8").toLowerCase(Locale.ROOT);
                if (decoded.contains(".m4a")) return "audio/mp4";
                if (decoded.contains(".aac")) return "audio/aac";
                if (decoded.contains(".mp3")) return "audio/mpeg";
                if (decoded.contains(".wav")) return "audio/wav";
                if (decoded.contains(".flac")) return "audio/flac";
                if (decoded.contains(".ogg") || decoded.contains(".opus")) return "audio/ogg";
                if (decoded.contains(".weba") || decoded.contains(".webm")) return "audio/webm";
            } catch (Exception ignored) {}
        }

        return guessAudioMimeType(uriString != null ? uriString : "");
    }

    private String guessAudioMimeType(String uriString) {
        String lower = uriString.toLowerCase(Locale.ROOT);
        try {
            lower = URLDecoder.decode(lower, "UTF-8");
        } catch (Exception ignored) {}
        if (lower.contains(".mp3")) return "audio/mpeg";
        if (lower.contains(".wav")) return "audio/wav";
        if (lower.contains(".ogg") || lower.contains(".opus")) return "audio/ogg";
        if (lower.contains(".flac")) return "audio/flac";
        if (lower.contains(".m4a")) return "audio/mp4";
        if (lower.contains(".aac")) return "audio/aac";
        if (lower.contains(".weba") || lower.contains(".webm")) return "audio/webm";
        return "audio/mpeg";
    }

    private static class BoundedInputStream extends InputStream {
        private final InputStream in;
        private final ParcelFileDescriptor pfd;
        private long remaining;
        private long pendingSkip;

        public BoundedInputStream(InputStream in, long limit, ParcelFileDescriptor pfd, long rangeStartOffset) {
            this.in = in;
            this.remaining = limit;
            this.pfd = pfd;
            this.pendingSkip = Math.max(0, rangeStartOffset);
        }

        public BoundedInputStream(InputStream in, long limit, ParcelFileDescriptor pfd) {
            this(in, limit, pfd, 0);
        }

        @Override
        public int read() throws IOException {
            pendingSkip = 0;
            if (remaining <= 0) return -1;
            try {
                int b = in.read();
                if (b != -1) {
                    remaining--;
                } else {
                    MainActivity.logNativeEvent("Stream", "BoundedInputStream reached stream EOF (remaining=" + remaining + ")");
                    remaining = 0;
                }
                return b;
            } catch (IOException e) {
                MainActivity.logNativeEvent("Stream", "BoundedInputStream read() IOException: " + e.getMessage() + " (remaining=" + remaining + ")");
                throw e;
            }
        }

        @Override
        public int read(byte[] b, int off, int len) throws IOException {
            pendingSkip = 0;
            if (remaining <= 0) return -1;
            int toRead = (int) Math.min(len, Math.min(remaining, Integer.MAX_VALUE));
            try {
                int bytesRead = in.read(b, off, toRead);
                if (bytesRead != -1) {
                    remaining -= bytesRead;
                } else {
                    MainActivity.logNativeEvent("Stream", "BoundedInputStream reached stream EOF (remaining=" + remaining + ")");
                    remaining = 0;
                }
                return bytesRead;
            } catch (IOException e) {
                MainActivity.logNativeEvent("Stream", "BoundedInputStream read(byte[]) IOException: " + e.getMessage() + " (remaining=" + remaining + ")");
                throw e;
            }
        }

        @Override
        public long skip(long n) throws IOException {
            if (n <= 0) return 0;
            // Absorb Chromium's SkipToRequestedRange call that repeats the Range start offset
            if (pendingSkip > 0) {
                long consumed = Math.min(n, pendingSkip);
                pendingSkip -= consumed;
                long extra = n - consumed;
                if (extra > 0 && remaining > 0) {
                    long toSkip = Math.min(extra, remaining);
                    long skipped = in.skip(toSkip);
                    if (skipped > 0) {
                        remaining -= skipped;
                        return consumed + skipped;
                    }
                }
                return consumed;
            }
            if (remaining <= 0) return 0;
            long toSkip = Math.min(n, remaining);
            long skipped = in.skip(toSkip);
            if (skipped > 0) {
                remaining -= skipped;
            }
            return skipped;
        }

        @Override
        public int available() throws IOException {
            // Returning 0 is standard for custom Range streams in WebView to prevent Chromium's
            // VerifyRequestedRange from rejecting byte ranges against available()
            return 0;
        }

        @Override
        public void close() throws IOException {
            try {
                in.close();
            } finally {
                if (pfd != null) {
                    try {
                        pfd.close();
                    } catch (Exception ignored) {}
                }
            }
        }
    }

    private File getOrCreateTranscodedFile(Uri contentUri, ParcelFileDescriptor pfd, String extParam, String uriStr) {
        if (pfd == null) return null;
        String ext = (extParam != null) ? extParam.toLowerCase(Locale.ROOT) : "";
        boolean isM4A = ext.equals("m4a") || (uriStr != null && uriStr.toLowerCase(Locale.ROOT).contains(".m4a"));

        String cacheName = "transcoded_" + Math.abs(contentUri.toString().hashCode()) + "_" + pfd.getStatSize() + ".wav";
        File cachedFile = new File(getCacheDir(), cacheName);
        if (cachedFile.exists() && cachedFile.length() > 44) {
            return cachedFile;
        }

        MediaExtractor extractor = new MediaExtractor();
        try {
            extractor.setDataSource(pfd.getFileDescriptor());
            int audioTrack = -1;
            MediaFormat format = null;
            String mime = null;

            for (int i = 0; i < extractor.getTrackCount(); i++) {
                MediaFormat f = extractor.getTrackFormat(i);
                String m = f.getString(MediaFormat.KEY_MIME);
                if (m != null && m.startsWith("audio/")) {
                    audioTrack = i;
                    format = f;
                    mime = m;
                    break;
                }
            }

            if (audioTrack == -1 || mime == null) {
                extractor.release();
                return null;
            }

            boolean isNativeBrowserSupported =
                mime.equalsIgnoreCase("audio/mp4a-latm") ||
                mime.equalsIgnoreCase("audio/mpeg") ||
                mime.equalsIgnoreCase("audio/flac") ||
                mime.equalsIgnoreCase("audio/vorbis") ||
                mime.equalsIgnoreCase("audio/opus") ||
                mime.equalsIgnoreCase("audio/wav") ||
                mime.equalsIgnoreCase("audio/x-wav");

            if (isNativeBrowserSupported && !isM4A_Unsupported(mime, isM4A)) {
                extractor.release();
                return null;
            }

            Log.d("AuraPlayer", "Detected non-browser audio format (" + mime + ") in " + uriStr + ". Transcoding to WAV with MediaCodec...");
            boolean success = decodeAudioToWav(extractor, audioTrack, format, mime, cachedFile);
            extractor.release();
            if (success && cachedFile.exists() && cachedFile.length() > 44) {
                return cachedFile;
            }
        } catch (Exception e) {
            Log.e("AuraPlayer", "Error checking/transcoding audio for " + uriStr, e);
            try { extractor.release(); } catch (Exception ignored) {}
        }
        return null;
    }

    private boolean isM4A_Unsupported(String mime, boolean isM4A) {
        if (!isM4A) return false;
        String lower = mime.toLowerCase(Locale.ROOT);
        return lower.contains("eac3") || lower.contains("ac3") || lower.contains("alac");
    }

    private boolean decodeAudioToWav(MediaExtractor extractor, int trackIndex, MediaFormat inputFormat, String mimeType, File outputFile) {
        MediaCodec codec = null;
        FileOutputStream fos = null;
        File tempFile = null;
        try {
            extractor.selectTrack(trackIndex);
            codec = MediaCodec.createDecoderByType(mimeType);
            codec.configure(inputFormat, null, null, 0);
            codec.start();

            tempFile = new File(outputFile.getAbsolutePath() + ".tmp");
            if (tempFile.exists()) tempFile.delete();
            fos = new FileOutputStream(tempFile);

            // Write 44-byte placeholder for WAV header
            byte[] placeholder = new byte[44];
            fos.write(placeholder);

            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
            boolean sawInputEOS = false;
            boolean sawOutputEOS = false;
            long totalPcmBytes = 0;

            int sampleRate = inputFormat.containsKey(MediaFormat.KEY_SAMPLE_RATE) ? inputFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE) : 44100;
            int channelCount = inputFormat.containsKey(MediaFormat.KEY_CHANNEL_COUNT) ? inputFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT) : 2;

            long kTimeOutUs = 10000;
            int noProgressCount = 0;

            while (!sawOutputEOS && noProgressCount < 300) {
                boolean didWork = false;

                if (!sawInputEOS) {
                    int inputBufIndex = codec.dequeueInputBuffer(kTimeOutUs);
                    if (inputBufIndex >= 0) {
                        ByteBuffer dstBuf = (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP)
                            ? codec.getInputBuffer(inputBufIndex)
                            : codec.getInputBuffers()[inputBufIndex];

                        int sampleSize = extractor.readSampleData(dstBuf, 0);
                        if (sampleSize < 0) {
                            sawInputEOS = true;
                            codec.queueInputBuffer(inputBufIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                        } else {
                            long presentationTimeUs = extractor.getSampleTime();
                            codec.queueInputBuffer(inputBufIndex, 0, sampleSize, presentationTimeUs, 0);
                            extractor.advance();
                        }
                        didWork = true;
                    }
                }

                int outputBufIndex = codec.dequeueOutputBuffer(info, kTimeOutUs);
                if (outputBufIndex >= 0) {
                    ByteBuffer buf = (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP)
                        ? codec.getOutputBuffer(outputBufIndex)
                        : codec.getOutputBuffers()[outputBufIndex];

                    if (info.size > 0 && buf != null) {
                        buf.position(info.offset);
                        buf.limit(info.offset + info.size);
                        byte[] chunk = new byte[info.size];
                        buf.get(chunk);
                        fos.write(chunk);
                        totalPcmBytes += info.size;
                    }

                    codec.releaseOutputBuffer(outputBufIndex, false);
                    didWork = true;

                    if ((info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
                        sawOutputEOS = true;
                    }
                } else if (outputBufIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    MediaFormat outFormat = codec.getOutputFormat();
                    if (outFormat.containsKey(MediaFormat.KEY_SAMPLE_RATE)) {
                        sampleRate = outFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE);
                    }
                    if (outFormat.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) {
                        channelCount = outFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT);
                    }
                    didWork = true;
                } else if (outputBufIndex == MediaCodec.INFO_OUTPUT_BUFFERS_CHANGED) {
                    didWork = true;
                }

                if (!didWork) {
                    noProgressCount++;
                } else {
                    noProgressCount = 0;
                }
            }

            fos.flush();
            fos.close();
            fos = null;

            if (totalPcmBytes <= 0) {
                if (tempFile != null && tempFile.exists()) tempFile.delete();
                return false;
            }

            RandomAccessFile raf = new RandomAccessFile(tempFile, "rw");
            raf.seek(0);
            byte[] wavHeader = buildWavHeader(totalPcmBytes, sampleRate, channelCount, 16);
            raf.write(wavHeader);
            raf.close();

            if (outputFile.exists()) outputFile.delete();
            boolean renamed = tempFile.renameTo(outputFile);
            Log.d("AuraPlayer", "Successfully decoded " + mimeType + " to WAV: " + outputFile.getName() + " (" + totalPcmBytes + " PCM bytes, " + sampleRate + "Hz, " + channelCount + "ch, renamed=" + renamed + ")");
            return true;
        } catch (Exception e) {
            Log.e("AuraPlayer", "Error decoding audio with MediaCodec for mime: " + mimeType, e);
            if (tempFile != null && tempFile.exists()) tempFile.delete();
            return false;
        } finally {
            if (fos != null) {
                try { fos.close(); } catch (Exception ignored) {}
            }
            if (codec != null) {
                try {
                    codec.stop();
                    codec.release();
                } catch (Exception ignored) {}
            }
        }
    }

    private byte[] buildWavHeader(long totalAudioLen, int sampleRate, int channels, int bitsPerSample) {
        long totalDataLen = totalAudioLen + 36;
        long byteRate = (long) sampleRate * channels * (bitsPerSample / 8);
        int blockAlign = channels * (bitsPerSample / 8);

        byte[] header = new byte[44];
        header[0] = 'R'; header[1] = 'I'; header[2] = 'F'; header[3] = 'F';
        header[4] = (byte) (totalDataLen & 0xff);
        header[5] = (byte) ((totalDataLen >> 8) & 0xff);
        header[6] = (byte) ((totalDataLen >> 16) & 0xff);
        header[7] = (byte) ((totalDataLen >> 24) & 0xff);
        header[8] = 'W'; header[9] = 'A'; header[10] = 'V'; header[11] = 'E';
        header[12] = 'f'; header[13] = 'm'; header[14] = 't'; header[15] = ' ';
        header[16] = 16; header[17] = 0; header[18] = 0; header[19] = 0;
        header[20] = 1; header[21] = 0;
        header[22] = (byte) channels;
        header[23] = (byte) (channels >> 8);
        header[24] = (byte) (sampleRate & 0xff);
        header[25] = (byte) ((sampleRate >> 8) & 0xff);
        header[26] = (byte) ((sampleRate >> 16) & 0xff);
        header[27] = (byte) ((sampleRate >> 24) & 0xff);
        header[28] = (byte) (byteRate & 0xff);
        header[29] = (byte) ((byteRate >> 8) & 0xff);
        header[30] = (byte) ((byteRate >> 16) & 0xff);
        header[31] = (byte) ((byteRate >> 24) & 0xff);
        header[32] = (byte) blockAlign;
        header[33] = (byte) (blockAlign >> 8);
        header[34] = (byte) bitsPerSample;
        header[35] = 0;
        header[36] = 'd'; header[37] = 'a'; header[38] = 't'; header[39] = 'a';
        header[40] = (byte) (totalAudioLen & 0xff);
        header[41] = (byte) ((totalAudioLen >> 8) & 0xff);
        header[42] = (byte) ((totalAudioLen >> 16) & 0xff);
        header[43] = (byte) ((totalAudioLen >> 24) & 0xff);
        return header;
    }

    private WebResourceResponse serveFileWithRanges(WebResourceRequest request, File file, String mimeType) {
        try {
            long totalLength = file.length();
            Map<String, String> reqHeaders = request.getRequestHeaders();
            String rangeHeader = null;
            if (reqHeaders != null) {
                rangeHeader = reqHeaders.get("Range");
                if (rangeHeader == null) rangeHeader = reqHeaders.get("range");
            }

            long start = 0;
            long end = (totalLength > 0) ? (totalLength - 1) : -1;
            boolean isRange = false;

            if (rangeHeader != null && rangeHeader.startsWith("bytes=") && totalLength > 0) {
                String rangeSpec = rangeHeader.substring(6).trim();
                int dash = rangeSpec.indexOf('-');
                if (dash == 0) {
                    try {
                        long suffix = Long.parseLong(rangeSpec.substring(1));
                        start = Math.max(0, totalLength - suffix);
                        end = totalLength - 1;
                        isRange = true;
                    } catch (NumberFormatException ignored) {}
                } else if (dash > 0) {
                    try {
                        start = Long.parseLong(rangeSpec.substring(0, dash));
                        String endStr = rangeSpec.substring(dash + 1).trim();
                        if (!endStr.isEmpty()) {
                            end = Long.parseLong(endStr);
                        }
                        if (end >= totalLength) {
                            end = totalLength - 1;
                        }
                        isRange = true;
                    } catch (NumberFormatException ignored) {}
                }
            }

            if (start < 0) start = 0;
            if (totalLength > 0 && start >= totalLength) {
                Map<String, String> errHeaders = new HashMap<>();
                errHeaders.put("Access-Control-Allow-Origin", "*");
                errHeaders.put("Content-Range", "bytes */" + totalLength);
                return new WebResourceResponse(mimeType, null, 416, "Range Not Satisfiable", errHeaders, new ByteArrayInputStream(new byte[0]));
            }

            long contentLength = (end >= start) ? (end - start + 1) : totalLength;
            FileInputStream fis = new FileInputStream(file);
            if (start > 0) {
                fis.getChannel().position(start);
            }

            InputStream stream = (isRange && end >= start && totalLength > 0)
                ? new BoundedInputStream(fis, contentLength, null, start)
                : fis;

            Map<String, String> respHeaders = new HashMap<>();
            respHeaders.put("Access-Control-Allow-Origin", "*");
            respHeaders.put("Accept-Ranges", "bytes");

            if (isRange && totalLength > 0) {
                respHeaders.put("Content-Range", "bytes " + start + "-" + end + "/" + totalLength);
                respHeaders.put("Content-Length", String.valueOf(contentLength));
                return new WebResourceResponse(mimeType, null, 206, "Partial Content", respHeaders, stream);
            } else {
                if (totalLength > 0) {
                    respHeaders.put("Content-Length", String.valueOf(totalLength));
                }
                return new WebResourceResponse(mimeType, null, 200, "OK", respHeaders, stream);
            }
        } catch (Exception e) {
            Log.e("AuraPlayer", "Error serving file with ranges: " + file.getName(), e);
            return null;
        }
    }

    private String getFileNameFromUri(Uri uri) {
        if (uri == null) return null;
        String fileName = null;
        if ("content".equals(uri.getScheme())) {
            try (android.database.Cursor cursor = getContentResolver().query(uri, new String[]{android.provider.OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) {
                    int nameIdx = cursor.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME);
                    if (nameIdx >= 0) {
                        fileName = cursor.getString(nameIdx);
                    }
                }
            } catch (Exception ignored) {}
        }
        if (fileName == null) {
            String path = uri.getPath();
            if (path != null) {
                int cut = path.lastIndexOf('/');
                if (cut != -1) {
                    fileName = path.substring(cut + 1);
                }
            }
        }
        return fileName;
    }

    @Override
    protected void onDestroy() {
        isActivityResumed = false;
        isCurrentlyPlaying = false;
        releasePlaybackWakeLock();
        try {
            unregisterReceiver(mediaReceiver);
        } catch (Exception ignored) {}
        try {
            unregisterReceiver(screenReceiver);
        } catch (Exception ignored) {}
        dismissNotification();
        super.onDestroy();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Music Playback",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Media controls for Aura Music Player");
            channel.setShowBadge(false);
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    public void showOrUpdateNotification(String title, String artist, String album, boolean isPlaying) {
        this.isCurrentlyPlaying = isPlaying;

        if (isPlaying) {
            acquirePlaybackWakeLock();
        } else {
            releasePlaybackWakeLock();
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                return;
            }
        }

        try {
            Intent openAppIntent = new Intent(this, MainActivity.class);
            openAppIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent contentPendingIntent = PendingIntent.getActivity(
                this,
                0,
                openAppIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );

            Intent prevIntent = new Intent(ACTION_PREV).setPackage(getPackageName());
            PendingIntent prevPendingIntent = PendingIntent.getBroadcast(
                this,
                1,
                prevIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );

            Intent toggleIntent = new Intent(ACTION_TOGGLE).setPackage(getPackageName());
            PendingIntent togglePendingIntent = PendingIntent.getBroadcast(
                this,
                2,
                toggleIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );

            Intent nextIntent = new Intent(ACTION_NEXT).setPackage(getPackageName());
            PendingIntent nextPendingIntent = PendingIntent.getBroadcast(
                this,
                3,
                nextIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );

            String trackTitle = (title != null && !title.trim().isEmpty()) ? title : "Aura Music Player";
            String trackSubtext = (artist != null && !artist.trim().isEmpty()) ? artist : "Playing local music";
            if (album != null && !album.trim().isEmpty() && !album.equals("Single") && !album.equals("Unknown")) {
                trackSubtext += " • " + album;
            }

            int playPauseIcon = isPlaying ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play;
            String playPauseText = isPlaying ? "Pause" : "Play";

            NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(trackTitle)
                .setContentText(trackSubtext)
                .setContentIntent(contentPendingIntent)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(isPlaying)
                .setOnlyAlertOnce(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .addAction(android.R.drawable.ic_media_previous, "Previous", prevPendingIntent)
                .addAction(playPauseIcon, playPauseText, togglePendingIntent)
                .addAction(android.R.drawable.ic_media_next, "Next", nextPendingIntent);

            Notification notification = builder.build();
            NotificationManagerCompat notificationManager = NotificationManagerCompat.from(this);
            notificationManager.notify(NOTIFICATION_ID, notification);

            // Maintain Foreground Service so Android never suspends the audio engine when screen turns off
            try {
                Intent serviceIntent = new Intent(this, PlaybackService.class);
                serviceIntent.setAction(PlaybackService.ACTION_START);
                serviceIntent.putExtra(PlaybackService.EXTRA_NOTIFICATION, notification);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    startForegroundService(serviceIntent);
                } else {
                    startService(serviceIntent);
                }
            } catch (Exception e) {
                Log.e("AuraPlayer", "Error updating PlaybackService", e);
            }
        } catch (Exception e) {
            Log.e("AuraPlayer", "Error posting playback notification", e);
        }
    }

    public void dismissNotification() {
        try {
            isCurrentlyPlaying = false;
            releasePlaybackWakeLock();

            // Stop Foreground Service
            try {
                Intent stopService = new Intent(this, PlaybackService.class);
                stopService.setAction(PlaybackService.ACTION_STOP);
                startService(stopService);
            } catch (Exception e) {
                Log.e("AuraPlayer", "Error stopping PlaybackService", e);
            }

            NotificationManagerCompat notificationManager = NotificationManagerCompat.from(this);
            notificationManager.cancel(NOTIFICATION_ID);
        } catch (Exception e) {
            Log.e("AuraPlayer", "Error dismissing notification", e);
        }
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}

