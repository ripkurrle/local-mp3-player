# Packaging Aura as an Android App (.APK)

This directory contains a complete, ready-to-build native **Android Studio Project** for the Aura Music Player.

---

## 📱 Option 1: Build APK with Android Studio (Recommended)

1. Open **Android Studio**.
2. Select **Open an Existing Project** and choose the `android-project/` folder.
3. Let Gradle sync dependencies.
4. Go to **Build** → **Build Bundle(s) / APK(s)** → **Build APK(s)**.
5. Once compiled, Android Studio will present a notification: **`locate`** your `app-debug.apk`.
6. Transfer this `.apk` to your Android device via USB, Drive, or WhatsApp, and tap **Install**!

> **How it works:**
> The native wrapper uses an optimized Android `WebView` that loads all assets directly from `file:///android_asset/index.html`. It requests native audio storage permissions (`READ_MEDIA_AUDIO` / `READ_EXTERNAL_STORAGE`) and hooks `<input type="file">` directly into Android's native file picker (`DocumentsProvider`).

---

## ⚡ Option 2: Instant PWA Install (No Android Studio or SDK Needed!)

Because Aura is already configured as a **Progressive Web App (PWA)** with a Service Worker (`sw.js`) and Web App Manifest (`manifest.json`):

1. Start the local server:
   ```bash
   cd ..
   python3 -m http.server 8080
   ```
2. On your Android phone, connect to the same Wi-Fi network and open Chrome:
   ```
   http://<YOUR_COMPUTER_IP>:8080/index.html
   ```
3. Tap the **three dots menu (⋮)** in Chrome and select **"Add to Home screen"** or **"Install App"**.
4. Android's **WebAPK** service will automatically mint and install a standalone native APK with the Aura icon and full-screen window on your device!

---

## 🔄 Updating Web Assets in Android Project

Whenever you make changes to `index.html`, `style.css`, or `app.js` in the root folder, run:

```bash
python3 sync_to_android.py
```

This will automatically refresh the files inside `android-project/app/src/main/assets/`.
