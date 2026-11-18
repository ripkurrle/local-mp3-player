import os
import shutil

src_dir = "/home/user1/.gemini/antigravity-ide/scratch/local-mp3-player"
dest_dirs = [
    os.path.join(src_dir, "android-project/app/src/main/assets"),
    "/home/user1/AndroidStudioProjects/AuraMusicPlayer/app/src/main/assets",
    "/home/user1/AndroidStudioProjects/local-mp3-player/android-project/app/src/main/assets"
]

files_to_copy = [
    "index.html",
    "style.css",
    "app.js",
    "audio-engine.js",
    "diagnostics.js",
    "db.js",
    "id3-parser.js",
    "manifest.json",
    "sw.js",
    "favicon.svg"
]

for dest_assets in dest_dirs:
    if not os.path.exists(dest_assets):
        continue
    for f in files_to_copy:
        src_path = os.path.join(src_dir, f)
        dest_path = os.path.join(dest_assets, f)
        shutil.copy2(src_path, dest_path)
    
    # Copy assets folder (icons, sample-tracks)
    src_assets = os.path.join(src_dir, "assets")
    dest_sub_assets = os.path.join(dest_assets, "assets")
    if os.path.exists(dest_sub_assets):
        shutil.rmtree(dest_sub_assets)
    shutil.copytree(src_assets, dest_sub_assets)
    print(f"Synced web assets -> {dest_assets}")

# Synchronize root files in /home/user1/AndroidStudioProjects/local-mp3-player
asp_root = "/home/user1/AndroidStudioProjects/local-mp3-player"
if os.path.exists(asp_root):
    for f in files_to_copy:
        src_path = os.path.join(src_dir, f)
        dest_path = os.path.join(asp_root, f)
        if os.path.exists(src_path):
            shutil.copy2(src_path, dest_path)
    src_assets = os.path.join(src_dir, "assets")
    dest_assets = os.path.join(asp_root, "assets")
    if os.path.exists(dest_assets):
        shutil.rmtree(dest_assets)
    shutil.copytree(src_assets, dest_assets)
    shutil.copy2(os.path.join(src_dir, "sync_to_android.py"), os.path.join(asp_root, "sync_to_android.py"))
    print(f"Synced root repository files -> {asp_root}")

# Synchronize MainActivity.java across all Android copies
src_java = os.path.join(src_dir, "android-project/app/src/main/java/com/aura/musicplayerlocal/MainActivity.java")
java_dests = [
    "/home/user1/AndroidStudioProjects/AuraMusicPlayer/app/src/main/java/com/aura/musicplayerlocal/MainActivity.java",
    "/home/user1/AndroidStudioProjects/local-mp3-player/android-project/app/src/main/java/com/aura/musicplayerlocal/MainActivity.java"
]
for jd in java_dests:
    if os.path.exists(os.path.dirname(jd)):
        shutil.copy2(src_java, jd)
        print(f"Synced MainActivity.java -> {jd}")

# Synchronize PlaybackService.java across all Android copies
src_service = os.path.join(src_dir, "android-project/app/src/main/java/com/aura/musicplayerlocal/PlaybackService.java")
service_dests = [
    "/home/user1/AndroidStudioProjects/AuraMusicPlayer/app/src/main/java/com/aura/musicplayerlocal/PlaybackService.java",
    "/home/user1/AndroidStudioProjects/local-mp3-player/android-project/app/src/main/java/com/aura/musicplayerlocal/PlaybackService.java"
]
for sd in service_dests:
    if os.path.exists(os.path.dirname(sd)):
        shutil.copy2(src_service, sd)
        print(f"Synced PlaybackService.java -> {sd}")

# Synchronize AndroidManifest.xml across all Android copies
src_manifest = os.path.join(src_dir, "android-project/app/src/main/AndroidManifest.xml")
manifest_dests = [
    "/home/user1/AndroidStudioProjects/AuraMusicPlayer/app/src/main/AndroidManifest.xml",
    "/home/user1/AndroidStudioProjects/local-mp3-player/android-project/app/src/main/AndroidManifest.xml"
]
for md in manifest_dests:
    if os.path.exists(os.path.dirname(md)):
        shutil.copy2(src_manifest, md)
        print(f"Synced AndroidManifest.xml -> {md}")

# Synchronize res/values/styles.xml across all Android copies
src_styles = os.path.join(src_dir, "android-project/app/src/main/res/values/styles.xml")
styles_dests = [
    "/home/user1/AndroidStudioProjects/AuraMusicPlayer/app/src/main/res/values/styles.xml",
    "/home/user1/AndroidStudioProjects/local-mp3-player/android-project/app/src/main/res/values/styles.xml"
]
for std in styles_dests:
    if os.path.exists(os.path.dirname(std)):
        shutil.copy2(src_styles, std)
        print(f"Synced styles.xml -> {std}")

# Synchronize build.gradle across all Android copies
src_top_gradle = os.path.join(src_dir, "android-project/build.gradle")
top_gradle_dests = [
    "/home/user1/AndroidStudioProjects/AuraMusicPlayer/build.gradle",
    "/home/user1/AndroidStudioProjects/local-mp3-player/android-project/build.gradle"
]
for gd in top_gradle_dests:
    if os.path.exists(os.path.dirname(gd)):
        shutil.copy2(src_top_gradle, gd)
        print(f"Synced build.gradle -> {gd}")

# Synchronize app/build.gradle across all Android copies
src_app_gradle = os.path.join(src_dir, "android-project/app/build.gradle")
app_gradle_dests = [
    "/home/user1/AndroidStudioProjects/AuraMusicPlayer/app/build.gradle",
    "/home/user1/AndroidStudioProjects/local-mp3-player/android-project/app/build.gradle"
]
for ad in app_gradle_dests:
    if os.path.exists(os.path.dirname(ad)):
        shutil.copy2(src_app_gradle, ad)
        print(f"Synced app/build.gradle -> {ad}")

# Synchronize app/proguard-rules.pro across all Android copies
src_proguard = os.path.join(src_dir, "android-project/app/proguard-rules.pro")
proguard_dests = [
    "/home/user1/AndroidStudioProjects/AuraMusicPlayer/app/proguard-rules.pro",
    "/home/user1/AndroidStudioProjects/local-mp3-player/android-project/app/proguard-rules.pro"
]
for pd in proguard_dests:
    if os.path.exists(os.path.dirname(pd)):
        shutil.copy2(src_proguard, pd)
        print(f"Synced app/proguard-rules.pro -> {pd}")

# Synchronize app/google-services.json across all Android copies
src_gs = os.path.join(src_dir, "android-project/app/google-services.json")
gs_dests = [
    "/home/user1/AndroidStudioProjects/AuraMusicPlayer/app/google-services.json",
    "/home/user1/AndroidStudioProjects/local-mp3-player/android-project/app/google-services.json"
]
for gsd in gs_dests:
    if os.path.exists(os.path.dirname(gsd)):
        shutil.copy2(src_gs, gsd)
        print(f"Synced google-services.json -> {gsd}")

# Synchronize .gitignore across repositories
src_gitignore = os.path.join(src_dir, ".gitignore")
gitignore_dests = [
    "/home/user1/AndroidStudioProjects/local-mp3-player/.gitignore",
    "/home/user1/AndroidStudioProjects/AuraMusicPlayer/.gitignore"
]
for gid in gitignore_dests:
    if os.path.exists(os.path.dirname(gid)):
        shutil.copy2(src_gitignore, gid)
        print(f"Synced .gitignore -> {gid}")

# Synchronize gradle.properties across all Android copies
src_props = os.path.join(src_dir, "android-project/gradle.properties")
props_dests = [
    "/home/user1/AndroidStudioProjects/AuraMusicPlayer/gradle.properties",
    "/home/user1/AndroidStudioProjects/local-mp3-player/android-project/gradle.properties"
]
for prd in props_dests:
    if os.path.exists(os.path.dirname(prd)):
        shutil.copy2(src_props, prd)
        print(f"Synced gradle.properties -> {prd}")

# Synchronize res/mipmap launcher icons across Android copies
src_res = os.path.join(src_dir, "android-project/app/src/main/res")
res_dests = [
    "/home/user1/AndroidStudioProjects/AuraMusicPlayer/app/src/main/res",
    "/home/user1/AndroidStudioProjects/local-mp3-player/android-project/app/src/main/res"
]
for rd in res_dests:
    if os.path.exists(rd):
        for density in ["mipmap-mdpi", "mipmap-hdpi", "mipmap-xhdpi", "mipmap-xxhdpi", "mipmap-xxxhdpi"]:
            s_folder = os.path.join(src_res, density)
            d_folder = os.path.join(rd, density)
            if os.path.exists(s_folder):
                os.makedirs(d_folder, exist_ok=True)
                s_icon = os.path.join(s_folder, "ic_launcher.png")
                d_icon = os.path.join(d_folder, "ic_launcher.png")
                if os.path.exists(s_icon):
                    shutil.copy2(s_icon, d_icon)
                    print(f"Synced {density}/ic_launcher.png -> {d_icon}")



