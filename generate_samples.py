import wave
import struct
import math
import os

sample_rate = 44100

def make_track(filename, duration, synth_fn):
    num_samples = int(duration * sample_rate)
    with wave.open(filename, 'w') as wav_file:
        wav_file.setnchannels(2)  # Stereo
        wav_file.setsampwidth(2)  # 16-bit
        wav_file.setframerate(sample_rate)
        
        frames = bytearray()
        for i in range(num_samples):
            t = i / sample_rate
            left, right = synth_fn(t, duration)
            
            # Master limiter & fade in/out
            fade_time = 0.5
            fade = 1.0
            if t < fade_time:
                fade = t / fade_time
            elif t > duration - fade_time:
                fade = (duration - t) / fade_time
                
            left = max(-0.95, min(0.95, left * fade))
            right = max(-0.95, min(0.95, right * fade))
            
            val_l = int(left * 32767)
            val_r = int(right * 32767)
            
            frames += struct.pack('<hh', val_l, val_r)
            
        wav_file.writeframes(frames)
    print(f"Generated {filename} ({duration}s)")

# Track 1: Synthwave Midnight Drive
def synth_synthwave(t, dur):
    bpm = 110
    beat = t * (bpm / 60.0)
    
    # Bassline (A1, F1, C2, G1)
    chords = [55.0, 43.65, 65.4, 49.0] # A1, F1, C2, G1
    chord_idx = int(beat / 4) % len(chords)
    bass_freq = chords[chord_idx]
    
    bass_sub = math.sin(2 * math.pi * bass_freq * t) * 0.45
    bass_grit = (math.sin(2 * math.pi * bass_freq * 2 * t) * 0.2) * (1 - (beat % 1) * 0.5)
    bass = bass_sub + bass_grit
    
    # Arp synth (16th notes)
    arp_notes = [bass_freq * 4, bass_freq * 4 * 1.25, bass_freq * 4 * 1.5, bass_freq * 4 * 1.8]
    arp_idx = int(beat * 4) % 4
    arp_freq = arp_notes[arp_idx]
    env = math.exp(-6 * (beat * 4 % 1))
    arp = (math.sin(2 * math.pi * arp_freq * t) + 0.3 * math.sin(2 * math.pi * arp_freq * 2 * t)) * env * 0.25
    
    # Kick drum on 1, 2, 3, 4
    kick_t = beat % 1
    kick_env = math.exp(-14 * kick_t)
    kick_pitch = 140 * math.exp(-35 * kick_t) + 45
    kick = math.sin(2 * math.pi * kick_pitch * kick_t) * kick_env * 0.6
    
    # Snare on 2 and 4
    snare_t = (beat - 1) % 2
    snare = 0
    if snare_t < 0.25 and beat >= 1:
        snare_env = math.exp(-18 * snare_t)
        noise = (math.sin(t * 12345.67) % 1.0 - 0.5) * 2
        snare = (math.sin(2 * math.pi * 180 * snare_t) * 0.3 + noise * 0.7) * snare_env * 0.4
        
    left = bass * 0.7 + arp * 0.9 + kick + snare * 0.8
    right = bass * 0.7 + arp * 0.7 + kick + snare * 0.8
    return left, right

# Track 2: Celestial Echoes (Ambient Dream)
def synth_ambient(t, dur):
    # Ethereal pad chords (C maj9 -> F maj7)
    cycle = (t / 6.0) % 2.0
    if cycle < 1.0:
        freqs = [261.63, 329.63, 392.00, 493.88, 587.33] # C4, E4, G4, B4, D5
    else:
        freqs = [174.61, 261.63, 329.63, 392.00, 523.25] # F3, C4, E4, G4, C5
        
    pad_l = 0
    pad_r = 0
    for i, f in enumerate(freqs):
        detune = 1.0 + (i * 0.0018)
        lfo = 0.8 + 0.2 * math.sin(2 * math.pi * (0.2 + i * 0.05) * t)
        s1 = math.sin(2 * math.pi * f * t)
        s2 = math.sin(2 * math.pi * f * detune * t + 0.4)
        pad_l += s1 * 0.12 * lfo
        pad_r += s2 * 0.12 * lfo
        
    # Shimmer bells
    bell_time = t % 1.5
    bell_env = math.exp(-5 * bell_time)
    bell_freq = 1046.50 if (int(t / 1.5) % 2 == 0) else 1318.51
    bell = (math.sin(2 * math.pi * bell_freq * t) + 0.4 * math.sin(2 * math.pi * bell_freq * 2.75 * t)) * bell_env * 0.15
    
    return pad_l + bell * 0.8, pad_r + bell * 0.4

# Track 3: Golden Hour (Lo-Fi Chill)
def synth_lofi(t, dur):
    bpm = 80
    beat = t * (bpm / 60.0)
    
    # Warm jazzy Rhodes chord progression
    # Dm9 (D3, F3, A3, C4, E4) -> G13 (G2, F3, B3, E4) -> Cmaj9 -> A7b13
    chord_idx = int(beat / 4) % 4
    chord_bases = [
        [146.83, 174.61, 220.00, 261.63, 329.63], # Dm9
        [98.00, 174.61, 246.94, 329.63],          # G13
        [130.81, 164.81, 196.00, 246.94, 293.66], # Cmaj9
        [110.00, 174.61, 220.00, 277.18, 329.63]  # A7b13
    ]
    cur_notes = chord_bases[chord_idx]
    chord_t = beat % 4
    chord_env = math.exp(-0.7 * chord_t)
    
    ch_l = 0
    ch_r = 0
    for i, n in enumerate(cur_notes):
        # gentle vibrato
        vib = 1.0 + 0.003 * math.sin(2 * math.pi * 5.0 * t)
        tone = math.sin(2 * math.pi * n * vib * t) * (1.0 / (i + 1)**0.6)
        pan = (i / len(cur_notes)) - 0.5
        ch_l += tone * (0.5 - pan * 0.3)
        ch_r += tone * (0.5 + pan * 0.3)
        
    rhodes_l = ch_l * chord_env * 0.3
    rhodes_r = ch_r * chord_env * 0.3
    
    # Sub kick on 1 and 2.5
    kick_t = (beat % 2.0)
    kick = 0
    if kick_t < 0.35:
        kick = math.sin(2 * math.pi * 55 * math.exp(-12 * kick_t) * kick_t) * math.exp(-10 * kick_t) * 0.5
        
    # Vinyl crackle hiss
    crackle = ((math.sin(t * 89231.2) % 1.0) - 0.5) * 0.02
    
    return rhodes_l + kick * 0.7 + crackle, rhodes_r + kick * 0.7 + crackle

out_dir = "/home/user1/.gemini/antigravity-ide/scratch/local-mp3-player/assets/sample-tracks"
make_track(os.path.join(out_dir, "Midnight_Drive.wav"), 16.0, synth_synthwave)
make_track(os.path.join(out_dir, "Celestial_Echoes.wav"), 18.0, synth_ambient)
make_track(os.path.join(out_dir, "Golden_Hour_Lofi.wav"), 16.0, synth_lofi)
