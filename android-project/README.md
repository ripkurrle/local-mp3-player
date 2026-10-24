# Packaging Aura as an Android App (.APK)

This directory contains a complete, ready-to-build native **Android Studio Project** for the Aura Music Player.

---

## 📱 Option 1: Build APK with Android Studio (Recommended)

### Steps to Build:
1. Open **Android Studio**.
2. Select **Open an Existing Project** and make sure to select the **`android-project/`** folder (NOT the parent folder).
3. Wait for the initial Gradle sync to finish (watch the bottom status bar: "Gradle sync in progress...").
4. Go to **Build** → **Build Bundle(s) / APK(s)** → **Build APK(s)**.
5. Once compiled, click **`locate`** in the bottom-right popup to find your `app-debug.apk`.

### ⚠️ If "Build APK" is Greyed Out:
1. **Wrong Folder Opened**: Ensure you opened `local-mp3-player/android-project/`, not `local-mp3-player/`. The root folder opened in Android Studio must contain `settings.gradle`.
2. **Trigger Gradle Sync**: Click **File** → **Sync Project with Gradle Files** (or the Elephant icon with blue arrow in the top toolbar). Android Studio will not allow building until the sync succeeds.
3. **Check the Build/Sync Tool Window**: Open the **"Build"** tab at the bottom to see if Gradle reported any missing SDKs. If prompted with *"Install missing platform(s) and sync project"*, click the link.
4. **Select 'app' Configuration**: Ensure the dropdown next to the Green Run button in the top toolbar says **`app`**, not *"Edit Configurations"*.

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
