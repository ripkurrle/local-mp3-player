import os
import shutil

src_dir = "/home/user1/.gemini/antigravity-ide/scratch/local-mp3-player"
dest_assets = os.path.join(src_dir, "android-project/app/src/main/assets")

files_to_copy = [
    "index.html",
    "style.css",
    "app.js",
    "audio-engine.js",
    "db.js",
    "id3-parser.js",
    "manifest.json",
    "sw.js"
]

for f in files_to_copy:
    src_path = os.path.join(src_dir, f)
    dest_path = os.path.join(dest_assets, f)
    shutil.copy2(src_path, dest_path)
    print(f"Copied {f} -> {dest_path}")

# Copy assets folder (icons, sample-tracks)
src_assets = os.path.join(src_dir, "assets")
dest_sub_assets = os.path.join(dest_assets, "assets")
if os.path.exists(dest_sub_assets):
    shutil.rmtree(dest_sub_assets)
shutil.copytree(src_assets, dest_sub_assets)
print("Copied assets directory to Android assets.")
