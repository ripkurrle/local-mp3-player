/**
 * Audio Engine with Web Audio API Integration:
 * - 5-Band Graphic Equalizer (BiquadFilterNodes)
 * - Bass Booster & Spatial Stereo Enhancement
 * - Real-Time AnalyserNode with 3 Canvas Visualizer Modes
 * - Playback rate control & smooth seek
 */

class AudioEngine {
  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'metadata';
    this.audio.crossOrigin = 'anonymous';

    this.ctx = null;
    this.sourceNode = null;
    this.analyser = null;
    this.eqFilters = [];
    this.bassBoostNode = null;
    this.stereoPanner = null;
    this.gainNode = null;

    this.isInitialized = false;
    this.currentTrack = null;
    this.visualizerMode = 'bars'; // 'bars' | 'wave' | 'circle'
    this.visualizerCanvas = null;
    this.visualizerCtx = null;
    this.animationFrameId = null;

    // Default EQ Frequencies
    this.eqBands = [
      { f: 60, type: 'lowshelf', gain: 0 },
      { f: 230, type: 'peaking', gain: 0 },
      { f: 910, type: 'peaking', gain: 0 },
      { f: 3600, type: 'peaking', gain: 0 },
      { f: 14000, type: 'highshelf', gain: 0 }
    ];

    this.presets = {
      flat: [0, 0, 0, 0, 0],
      bass: [6, 4, 1, 0, 0],
      edm: [5, 3, -1, 3, 5],
      rock: [4, 2, -2, 2, 4],
      vocal: [-2, 1, 5, 3, 1],
      acoustic: [3, 2, 0, 2, 3],
      chill: [3, 1, 0, -1, 1],
      night: [-4, -1, 1, 2, -3]
    };

    this.setupListeners();
  }

  setupListeners() {
    this.audio.addEventListener('timeupdate', () => {
      if (this.onTimeUpdate) {
        this.onTimeUpdate(this.audio.currentTime, this.audio.duration || 0);
      }
    });

    this.audio.addEventListener('ended', () => {
      if (this.onTrackEnd) this.onTrackEnd();
    });

    this.audio.addEventListener('play', () => {
      if (this.onStateChange) this.onStateChange(true);
      this.startVisualizer();
    });

    this.audio.addEventListener('pause', () => {
      if (this.onStateChange) this.onStateChange(false);
    });

    this.audio.addEventListener('error', (e) => {
      console.warn('Audio playback error:', e);
      if (this.onError) this.onError(e);
    });
  }

  initWebAudio() {
    if (this.isInitialized) return;

    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();

      this.sourceNode = this.ctx.createMediaElementSource(this.audio);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.82;

      // Create EQ filters
      let lastNode = this.sourceNode;
      this.eqFilters = this.eqBands.map((band) => {
        const filter = this.ctx.createBiquadFilter();
        filter.type = band.type;
        filter.frequency.value = band.f;
        filter.gain.value = band.gain;
        lastNode.connect(filter);
        lastNode = filter;
        return filter;
      });

      // Bass Booster node
      this.bassBoostNode = this.ctx.createBiquadFilter();
      this.bassBoostNode.type = 'lowshelf';
      this.bassBoostNode.frequency.value = 80;
      this.bassBoostNode.gain.value = 0;
      lastNode.connect(this.bassBoostNode);
      lastNode = this.bassBoostNode;

      // Master Gain Node
      this.gainNode = this.ctx.createGain();
      this.gainNode.gain.value = 1.0;
      lastNode.connect(this.gainNode);

      // Connect to Analyser and Destination
      this.gainNode.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);

      this.isInitialized = true;
    } catch (e) {
      console.warn('Web Audio API not supported or restricted:', e);
    }
  }

  resumeContext() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  async loadTrack(track) {
    this.currentTrack = track;
    let url = track.url;

    if (!url && track.fileBlob) {
      url = URL.createObjectURL(track.fileBlob);
    }

    if (!url) {
      throw new Error('Track has no valid URL or Blob');
    }

    this.audio.src = url;
    return new Promise((resolve) => {
      const onLoaded = () => {
        this.audio.removeEventListener('loadedmetadata', onLoaded);
        resolve(this.audio.duration);
      };
      this.audio.addEventListener('loadedmetadata', onLoaded);
    });
  }

  play() {
    this.initWebAudio();
    this.resumeContext();
    return this.audio.play();
  }

  pause() {
    this.audio.pause();
  }

  seek(seconds) {
    if (!isNaN(seconds) && isFinite(seconds)) {
      this.audio.currentTime = Math.max(0, Math.min(seconds, this.audio.duration || 0));
    }
  }

  setVolume(vol) {
    this.audio.volume = Math.max(0, Math.min(1, vol));
  }

  setPlaybackRate(rate) {
    this.audio.playbackRate = rate;
  }

  // --- Equalizer Controls ---

  setEqBandGain(index, gain) {
    this.initWebAudio();
    if (this.eqFilters[index]) {
      this.eqFilters[index].gain.value = gain;
      this.eqBands[index].gain = gain;
    }
  }

  applyPreset(presetName) {
    this.initWebAudio();
    const gains = this.presets[presetName] || this.presets.flat;
    gains.forEach((g, i) => {
      this.setEqBandGain(i, g);
    });
    return gains;
  }

  setBassBoost(gainDb) {
    this.initWebAudio();
    if (this.bassBoostNode) {
      this.bassBoostNode.gain.value = gainDb;
    }
  }

  // --- Visualizer ---

  bindCanvas(canvas) {
    this.visualizerCanvas = canvas;
    if (canvas) {
      this.visualizerCtx = canvas.getContext('2d');
    }
  }

  startVisualizer() {
    if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);

    const render = () => {
      if (!this.audio.paused && this.visualizerCanvas && this.visualizerCtx && this.analyser) {
        this.drawVisualizer();
      }
      this.animationFrameId = requestAnimationFrame(render);
    };
    this.animationFrameId = requestAnimationFrame(render);
  }

  drawVisualizer() {
    const canvas = this.visualizerCanvas;
    const ctx = this.visualizerCtx;
    const w = canvas.width;
    const h = canvas.height;

    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    ctx.clearRect(0, 0, w, h);

    if (this.visualizerMode === 'bars') {
      this.analyser.getByteFrequencyData(dataArray);
      const barsToDraw = 42;
      const barWidth = (w / barsToDraw) * 0.7;
      const gap = (w / barsToDraw) * 0.3;

      for (let i = 0; i < barsToDraw; i++) {
        const binIndex = Math.floor(Math.pow(i / barsToDraw, 1.4) * (bufferLength * 0.65));
        const val = dataArray[binIndex] || 0;
        const barHeight = Math.max(4, (val / 255) * h * 0.95);
        const x = i * (barWidth + gap) + gap / 2;
        const y = h - barHeight;

        // Glowing gradient
        const grad = ctx.createLinearGradient(0, y, 0, h);
        grad.addColorStop(0, '#00f2fe');
        grad.addColorStop(0.5, '#4facfe');
        grad.addColorStop(1, '#9b51e0');

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, [3, 3, 0, 0]);
        ctx.fill();

        // Mirrored bottom reflection
        ctx.fillStyle = 'rgba(0, 242, 254, 0.15)';
        ctx.beginPath();
        ctx.roundRect(x, h, barWidth, barHeight * 0.25, [0, 0, 3, 3]);
        ctx.fill();
      }
    } else if (this.visualizerMode === 'wave') {
      this.analyser.getByteTimeDomainData(dataArray);

      ctx.lineWidth = 3;
      const grad = ctx.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, '#00f2fe');
      grad.addColorStop(0.5, '#ff2a85');
      grad.addColorStop(1, '#9b51e0');
      ctx.strokeStyle = grad;
      ctx.shadowColor = '#00f2fe';
      ctx.shadowBlur = 12;

      ctx.beginPath();
      const sliceWidth = w / bufferLength;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = (v * h) / 2;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
        x += sliceWidth;
      }
      ctx.lineTo(w, h / 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
    } else if (this.visualizerMode === 'circle') {
      this.analyser.getByteFrequencyData(dataArray);
      const cx = w / 2;
      const cy = h / 2;
      const baseRadius = Math.min(cx, cy) * 0.45;
      const points = 48;

      ctx.save();
      ctx.translate(cx, cy);

      ctx.beginPath();
      for (let i = 0; i <= points; i++) {
        const idx = i % points;
        const binIndex = Math.floor((idx / points) * (bufferLength * 0.5));
        const val = dataArray[binIndex] || 0;
        const r = baseRadius + (val / 255) * (baseRadius * 0.7);
        const angle = (idx / points) * Math.PI * 2;
        const x = Math.cos(angle) * r;
        const y = Math.sin(angle) * r;

        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();

      const grad = ctx.createRadialGradient(0, 0, baseRadius * 0.6, 0, 0, baseRadius * 1.5);
      grad.addColorStop(0, 'rgba(155, 81, 224, 0.4)');
      grad.addColorStop(1, 'rgba(0, 242, 254, 0.8)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = 'rgba(0, 242, 254, 0.08)';
      ctx.fill();

      ctx.restore();
    }
  }
}

if (typeof window !== 'undefined') {
  window.AudioEngine = AudioEngine;
}
