# ==============================================================================
# Aura Music Player - ProGuard / R8 Obfuscation & Optimization Rules
# ==============================================================================

# 1. Preserve JavaScript Interface methods (CRITICAL for WebView <-> Native Bridge)
# If R8 renames methods annotated with @JavascriptInterface, calls from web
# JavaScript (e.g. window.AndroidBridge.playNext()) will fail with TypeError.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Explicitly preserve the AndroidBridge interface methods and constructors
-keepclassmembers class com.aura.musicplayerlocal.MainActivity$AndroidBridge {
    public <methods>;
}

# 2. Preserve Native Foreground Service & Activities
-keep public class com.aura.musicplayerlocal.MainActivity extends androidx.appcompat.app.AppCompatActivity
-keep public class com.aura.musicplayerlocal.PlaybackService extends android.app.Service {
    public static boolean isRunning();
    public static boolean isWakeLockHeld();
}

# 3. Preserve Stack Trace Attributes for Firebase Crashlytics De-obfuscation
# Retains line numbers, source file names, and annotations so Firebase Crashlytics
# can automatically re-trace and de-obfuscate release crashes.
-keepattributes SourceFile,LineNumberTable,*Annotation*,Signature,InnerClasses,EnclosingMethod

# 4. Standard AndroidX and WebKit handling
-dontwarn okio.**
-dontwarn javax.annotation.**

