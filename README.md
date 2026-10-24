# Aura — Local MP3 Mobile Player

A high-fidelity, cyber-luxury mobile audio player engineered to play local MP3, WAV, M4A, FLAC, AAC, and OGG files stored directly on the user's mobile device or computer.

---

## ✨ Features

- **📱 Mobile-First Cyber-Luxury Interface**:
  - Native phone shell with simulated Dynamic Island, audio indicators, and edge-to-edge full-screen toggle.
  - Glassmorphic translucent cards, neon cyan/violet glow effects, and smooth 60fps micro-interactions.
- **📂 Local Storage & Offline Persistence**:
  - **Pick Audio Files**: Select individual or multiple `.mp3`, `.wav`, `.m4a`, `.flac`, `.ogg` files.
  - **Open Music Folder**: Import entire local folders at once using `webkitdirectory`.
  - **IndexedDB Storage**: Stored tracks persist across page reloads and browser sessions without needing to re-pick files every time!
  - **PWA (Progressive Web App)**: Installable directly on iOS Safari ("Add to Home Screen") and Android Chrome ("Install App") for 100% offline playback.
- **🏷️ Pure JavaScript ID3 Tag Parser**:
  - Decodes ID3v1, ID3v2.2, ID3v2.3, and ID3v2.4 headers and frames (`TIT2`, `TPE1`, `TALB`, `TYER`, `TCON`).
  - **APIC Cover Art Extraction**: Automatically extracts embedded album artwork from MP3s.
  - **Procedural Album Artwork Generator**: Generates vibrant dynamic canvas covers for tracks without embedded images.
- **🎚️ 5-Band Studio Equalizer & Audio FX**:
  - Web Audio API DSP pipeline with 5 frequency bands (60Hz, 230Hz, 910Hz, 3.6kHz, 14kHz).
  - Presets: *Flat, Bass Boost, EDM / Club, Rock, Vocal Boost, Acoustic, Chill Lo-Fi, Night Mode*.
  - Independent **Bass Resonator** booster dial.
- **📊 Real-time Canvas Visualizer**:
  - 3 switchable visualizer modes:
    - `BARS`: Mirrored neon frequency bars with reflections.
    - `WAVE`: Glowing oscilloscope waveform.
    - `CIRCLE`: Pulsing radial soundwave around the vinyl center.
- **💿 Dual Player Interface**:
  - **Docked Mini Player**: Floating at the bottom with spinning vinyl thumbnail, quick play/pause/skip, and top progress line.
  - **Full-Screen Now Playing Sheet**: Swipe up to expand or pull down to minimize. Features realistic rotating turntable disc, smooth scrubber, speed control (`0.5x` to `2.0x`), and sleep timer.
- **💤 Sleep Timer**:
  - Set countdown for 15, 30, 45, or 60 minutes with gentle auto-stop.
- **📱 Mobile System Integration**:
  - **Media Session API**: Displays title, artist, album, and artwork on mobile lock screen & notification shade with hardware lock screen playback controls.

---

## 🚀 Running the App

The application is served locally via Python's built-in HTTP server:

```bash
cd /home/user1/.gemini/antigravity-ide/scratch/local-mp3-player
python3 -m http.server 8080
```

Open your browser at:
```
http://localhost:8080/index.html
```

Or on your local mobile phone connected to the same Wi-Fi network:
```
http://<YOUR_COMPUTER_IP>:8080/index.html
```

---

## 📁 File Structure

```
local-mp3-player/
├── index.html            # Main mobile viewport layout and modal sheets
├── style.css             # Cyber-luxury design system & responsive styling
├── app.js                # Core app controller, gestures, and UI logic
├── audio-engine.js       # Web Audio API graph, 5-band EQ, and canvas visualizer
├── id3-parser.js         # Pure JS ID3v1 & ID3v2 parser + APIC artwork extractor
├── db.js                 # IndexedDB storage engine for offline persistence
├── manifest.json         # PWA installation manifest
├── sw.js                 # Service worker for offline asset caching
└── assets/
    ├── icon-192.png      # High-res PWA app icon (192x192)
    ├── icon-512.png      # High-res PWA app icon (512x512)
    └── sample-tracks/    # 3 preloaded high-fidelity demo tracks
        ├── Midnight_Drive.wav
        ├── Celestial_Echoes.wav
        └── Golden_Hour_Lofi.wav
```
