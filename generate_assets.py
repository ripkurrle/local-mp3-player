import math
import os
from PIL import Image, ImageDraw, ImageFilter

assets_dir = "/home/user1/.gemini/antigravity-ide/scratch/local-mp3-player/assets"
os.makedirs(assets_dir, exist_ok=True)
tracks_dir = os.path.join(assets_dir, "sample-tracks")
os.makedirs(tracks_dir, exist_ok=True)

def create_gradient_radial(size, center_color, edge_color):
    img = Image.new("RGBA", (size, size), edge_color)
    draw = ImageDraw.Draw(img)
    cx, cy = size // 2, size // 2
    max_r = size // 2
    for r in range(max_r, 0, -2):
        factor = r / max_r
        # Interpolate
        col = (
            int(center_color[0] * (1 - factor) + edge_color[0] * factor),
            int(center_color[1] * (1 - factor) + edge_color[1] * factor),
            int(center_color[2] * (1 - factor) + edge_color[2] * factor),
            255
        )
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=col)
    return img

def create_app_icon(size):
    img = Image.new("RGBA", (size, size), (10, 13, 20, 255))
    draw = ImageDraw.Draw(img)
    
    # Outer glowing border / squircle
    pad = int(size * 0.08)
    draw.rounded_rectangle([pad, pad, size - pad, size - pad], radius=int(size * 0.22), fill=(18, 24, 38, 255), outline=(0, 242, 254, 180), width=int(size * 0.02))
    
    # Center Vinyl Record disc
    cx, cy = size // 2, size // 2
    vr = int(size * 0.32)
    draw.ellipse([cx - vr, cy - vr, cx + vr, cy + vr], fill=(12, 14, 20, 255), outline=(40, 50, 70, 255), width=int(size * 0.015))
    
    # Grooves
    for gr in [0.26, 0.22, 0.18]:
        r = int(size * gr)
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(30, 42, 60, 160), width=1)
        
    # Center glowing gradient hub
    hr = int(size * 0.12)
    draw.ellipse([cx - hr, cy - hr, cx + hr, cy + hr], fill=(155, 81, 224, 255), outline=(0, 242, 254, 255), width=int(size * 0.015))
    
    # Dynamic sound waves crossing
    num_bars = 7
    bar_w = int(size * 0.04)
    spacing = int(size * 0.065)
    start_x = cx - (num_bars // 2) * spacing
    heights = [0.15, 0.28, 0.42, 0.55, 0.44, 0.26, 0.14]
    
    for i in range(num_bars):
        bx = start_x + i * spacing
        bh = int(size * heights[i])
        # Cyan to purple gradient color
        t = i / (num_bars - 1)
        r_c = int(0 * (1 - t) + 155 * t)
        g_c = int(242 * (1 - t) + 81 * t)
        b_c = int(254 * (1 - t) + 224 * t)
        
        draw.rounded_rectangle([bx - bar_w // 2, cy - bh // 2, bx + bar_w // 2, cy + bh // 2], radius=bar_w // 2, fill=(r_c, g_c, b_c, 240))
        
    # Center spindle hole
    sr = int(size * 0.035)
    draw.ellipse([cx - sr, cy - sr, cx + sr, cy + sr], fill=(10, 13, 20, 255), outline=(0, 242, 254, 255), width=2)
    
    return img

# Generate icons
icon192 = create_app_icon(192)
icon192.save(os.path.join(assets_dir, "icon-192.png"))

icon512 = create_app_icon(512)
icon512.save(os.path.join(assets_dir, "icon-512.png"))

# Generate 3 Album Covers (500x500)
# 1. Midnight Drive (Retro Synthwave neon grid)
def make_synthwave_cover():
    size = 500
    img = Image.new("RGB", (size, size), (12, 8, 28))
    draw = ImageDraw.Draw(img)
    # Sunset gradient top
    for y in range(260):
        t = y / 260
        r = int(30 * (1 - t) + 255 * t)
        g = int(10 * (1 - t) + 40 * t)
        b = int(60 * (1 - t) + 140 * t)
        draw.line([(0, y), (size, y)], fill=(r, g, b))
    # Glowing sun
    cx, cy = 250, 240
    sun_r = 90
    draw.ellipse([cx - sun_r, cy - sun_r, cx + sun_r, cy + sun_r], fill=(255, 210, 60))
    # Sun horizontal cut bars
    for sy in range(cy - 20, cy + sun_r, 14):
        draw.line([(cx - sun_r, sy), (cx + sun_r, sy)], fill=(180, 20, 100), width=4)
        
    # Perspective Grid floor
    horizon = 260
    draw.rectangle([0, horizon, size, size], fill=(10, 5, 25))
    # Vertical converging lines
    for i in range(-12, 13):
        start_x = cx + i * 20
        end_x = cx + i * 70
        draw.line([(start_x, horizon), (end_x, size)], fill=(0, 242, 254), width=2)
    # Horizontal grid lines with perspective spacing
    curr_y = horizon + 8
    step = 4
    while curr_y < size:
        draw.line([(0, curr_y), (size, curr_y)], fill=(255, 0, 128), width=2)
        step = int(step * 1.35)
        curr_y += step
        
    return img

# 2. Celestial Echoes (Nebula Space)
def make_ambient_cover():
    size = 500
    img = Image.new("RGB", (size, size), (5, 8, 20))
    draw = ImageDraw.Draw(img)
    
    # Glowing nebula clouds
    for _ in range(80):
        nx = int(250 + math.sin(_ * 0.4) * 140)
        ny = int(250 + math.cos(_ * 0.3) * 120)
        nr = int(40 + (_ % 30) * 3)
        col = (
            int(30 + math.sin(_) * 25),
            int(160 + math.cos(_) * 80),
            int(220 + math.sin(_*2) * 35)
        )
        draw.ellipse([nx - nr, ny - nr, nx + nr, ny + nr], outline=col, width=2)
        
    # Star field
    import random
    random.seed(42)
    for _ in range(120):
        sx = random.randint(10, 490)
        sy = random.randint(10, 490)
        sr = random.choice([1, 1, 2, 3])
        brightness = random.randint(180, 255)
        draw.ellipse([sx, sy, sx + sr, sy + sr], fill=(brightness, brightness, 255))
        
    # Cosmic geometry rings
    cx, cy = 250, 250
    for r in [80, 120, 160]:
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(120, 220, 255), width=2)
    draw.polygon([(cx, cy - 70), (cx + 60, cy + 50), (cx - 60, cy + 50)], outline=(255, 120, 220), width=3)
    return img

# 3. Golden Hour (Lo-Fi Warm Sunset)
def make_lofi_cover():
    size = 500
    img = Image.new("RGB", (size, size), (25, 18, 24))
    draw = ImageDraw.Draw(img)
    # Warm amber / terracotta gradient
    for y in range(size):
        t = y / size
        r = int(255 * (1 - t * 0.4))
        g = int(140 * (1 - t * 0.6))
        b = int(70 * (1 - t * 0.8))
        draw.line([(0, y), (size, y)], fill=(r, g, b))
        
    # Giant warm sun
    cx, cy = 250, 200
    sr = 110
    draw.ellipse([cx - sr, cy - sr, cx + sr, cy + sr], fill=(255, 235, 160))
    
    # Mountain silhouettes
    draw.polygon([(0, 360), (120, 260), (280, 370), (0, 370)], fill=(80, 35, 45))
    draw.polygon([(180, 380), (340, 240), (500, 380), (180, 380)], fill=(50, 20, 35))
    draw.polygon([(0, 400), (220, 320), (500, 400), (500, 500), (0, 500)], fill=(28, 12, 22))
    
    # Minimalist birds
    for bx, by in [(160, 120), (190, 105), (230, 115), (260, 95)]:
        draw.arc([bx - 12, by - 6, bx, by + 6], 180, 360, fill=(40, 20, 25), width=2)
        draw.arc([bx, by - 6, bx + 12, by + 6], 180, 360, fill=(40, 20, 25), width=2)
        
    return img

make_synthwave_cover().save(os.path.join(tracks_dir, "midnight_drive_cover.jpg"), quality=92)
make_ambient_cover().save(os.path.join(tracks_dir, "celestial_echoes_cover.jpg"), quality=92)
make_lofi_cover().save(os.path.join(tracks_dir, "golden_hour_cover.jpg"), quality=92)

print("Assets and covers generated successfully!")
