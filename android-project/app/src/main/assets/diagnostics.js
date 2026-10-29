/**
 * Aura Mobile MP3 Player - Runtime Audio Diagnostics & Engine Monitor
 * Provides high-precision telemetry, persistent logging, buffer tracking,
 * overnight heartbeat monitoring, and automatic stall/error detection.
 */

class AuraDiagnostics {
  constructor() {
    this.storageKey = 'aura_diagnostic_logs_v1';
    this.maxMemoryLogs = 300;
    this.logs = [];
    this.activeFilter = 'all';
    this.heartbeatIntervalId = null;
    this.lastRecordedCurrentTime = -1;
    this.lastProgressTimestamp = Date.now();
    this.stalledCount = 0;
    this.audioEngineRef = null;
    this.appRef = null;
    this.uiUpdateIntervalId = null;
    this.sessionStartTime = Date.now();

    this.loadPersistedLogs();
    this.setupGlobalErrorHooks();
    this.setupPageLifecycleHooks();

    this.log('SYSTEM', 'INFO', 'Aura Diagnostics Engine initialized');
  }

  bind(app, audioEngine) {
    this.appRef = app;
    this.audioEngineRef = audioEngine;
    this.startHeartbeat();
  }

  // --- Persistence & Storage ---

  loadPersistedLogs() {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          this.logs = parsed.slice(-this.maxMemoryLogs);
        }
      }
    } catch (e) {
      console.warn('[Diagnostics] Could not read stored logs:', e);
      this.logs = [];
    }
  }

  saveLogsDebounced() {
    if (this._saveTimeout) return;
    this._saveTimeout = setTimeout(() => {
      this._saveTimeout = null;
      try {
        localStorage.setItem(this.storageKey, JSON.stringify(this.logs.slice(-this.maxMemoryLogs)));
      } catch (e) {
        // LocalStorage quota may be reached, trim older half
        try {
          this.logs = this.logs.slice(-Math.floor(this.maxMemoryLogs / 2));
          localStorage.setItem(this.storageKey, JSON.stringify(this.logs));
        } catch (ignored) {}
      }
    }, 1200);
  }

  clearLogs() {
    this.logs = [];
    try {
      localStorage.removeItem(this.storageKey);
    } catch (e) {}
    this.log('SYSTEM', 'INFO', 'Diagnostic log history cleared by user');
    this.renderLogList();
  }

  // --- Logging Core ---

  log(category, level, message, details = {}) {
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0] + '.' + String(now.getMilliseconds()).padStart(3, '0');
    
    // Automatically attach active playback snapshot if not provided
    const snapshot = details.snapshot || this.getQuickSnapshot();

    const entry = {
      id: Date.now() + Math.random(),
      time: timeStr,
      iso: now.toISOString(),
      category: category.toUpperCase(), // 'AUDIO' | 'STREAM' | 'SYSTEM' | 'POWER' | 'WATCHDOG'
      level: level.toUpperCase(),       // 'INFO' | 'WARN' | 'ERROR' | 'HEARTBEAT'
      message,
      details,
      snapshot
    };

    this.logs.push(entry);
    if (this.logs.length > this.maxMemoryLogs) {
      this.logs.shift();
    }

    // Mirror to standard browser console with distinct styling
    const consolePrefix = `[AuraDiag][${entry.category}][${entry.level}]`;
    if (level === 'ERROR') {
      console.error(consolePrefix, message, details);
    } else if (level === 'WARN') {
      console.warn(consolePrefix, message, details);
    } else {
      console.log(consolePrefix, message);
    }

    // Forward to Android Firebase Crashlytics if native bridge is active
    if (window.AndroidBridge) {
      try {
        if (typeof window.AndroidBridge.logCrashlytics === 'function') {
          window.AndroidBridge.logCrashlytics(`[${entry.category}][${entry.level}] ${message}`);
        }
        if (level === 'ERROR' && typeof window.AndroidBridge.recordNonFatal === 'function') {
          const stack = (details && details.error) ? details.error : (new Error().stack || '');
          window.AndroidBridge.recordNonFatal(category, message, stack);
        }
      } catch (bridgeErr) {
        // Native bridge forwarding error ignored
      }
    }

    this.saveLogsDebounced();

    // If modal is currently visible, update the UI live
    if (this.isModalOpen()) {
      this.appendLogToUI(entry);
    }

    return entry;
  }

  info(category, message, details) {
    return this.log(category, 'INFO', message, details);
  }

  warn(category, message, details) {
    return this.log(category, 'WARN', message, details);
  }

  error(category, message, details) {
    return this.log(category, 'ERROR', message, details);
  }

  heartbeat(message, details) {
    return this.log('AUDIO', 'HEARTBEAT', message, details);
  }

  // --- Telemetry & Snapshots ---

  getQuickSnapshot() {
    const audio = this.audioEngineRef ? this.audioEngineRef.audio : null;
    const ctx = this.audioEngineRef ? this.audioEngineRef.ctx : null;
    const track = (this.appRef && this.appRef.currentTrack) ? this.appRef.currentTrack : null;

    let currentTime = 0;
    let duration = 0;
    let paused = true;
    let ended = false;
    let readyState = 0;
    let networkState = 0;
    let bufferedSec = 0;

    if (audio) {
      currentTime = audio.currentTime || 0;
      duration = audio.duration || (track ? track.duration : 0) || 0;
      paused = audio.paused;
      ended = audio.ended;
      readyState = audio.readyState;
      networkState = audio.networkState;

      try {
        if (audio.buffered && audio.buffered.length > 0) {
          for (let i = 0; i < audio.buffered.length; i++) {
            if (audio.buffered.start(i) <= currentTime && currentTime <= audio.buffered.end(i)) {
              bufferedSec = Math.max(0, audio.buffered.end(i) - currentTime);
              break;
            }
          }
        }
      } catch (e) {}
    }

    return {
      trackTitle: track ? track.title : 'None',
      currentTime: Math.round(currentTime * 10) / 10,
      duration: Math.round(duration * 10) / 10,
      posFormatted: this.formatTime(currentTime),
      durFormatted: this.formatTime(duration),
      paused,
      ended,
      readyState,
      networkState,
      bufferedSec: Math.round(bufferedSec),
      ctxState: ctx ? ctx.state : 'uninitialized',
      visibility: typeof document !== 'undefined' ? document.visibilityState : 'unknown'
    };
  }

  getDetailedDiagnostics() {
    const audio = this.audioEngineRef ? this.audioEngineRef.audio : null;
    const ctx = this.audioEngineRef ? this.audioEngineRef.ctx : null;
    const track = (this.appRef && this.appRef.currentTrack) ? this.appRef.currentTrack : null;

    const readyStateMap = {
      0: '0 (HAVE_NOTHING)',
      1: '1 (HAVE_METADATA)',
      2: '2 (HAVE_CURRENT_DATA)',
      3: '3 (HAVE_FUTURE_DATA)',
      4: '4 (HAVE_ENOUGH_DATA)'
    };

    const networkStateMap = {
      0: '0 (NETWORK_EMPTY)',
      1: '1 (NETWORK_IDLE)',
      2: '2 (NETWORK_LOADING)',
      3: '3 (NETWORK_NO_SOURCE)'
    };

    // Buffer range analysis
    let bufferDetails = 'No buffer data';
    let bufferedRangesList = [];
    let bufferedAhead = 0;
    if (audio && audio.buffered && audio.buffered.length > 0) {
      const parts = [];
      const cur = audio.currentTime || 0;
      for (let i = 0; i < audio.buffered.length; i++) {
        const start = audio.buffered.start(i);
        const end = audio.buffered.end(i);
        parts.push(`[${this.formatTime(start)} - ${this.formatTime(end)}]`);
        bufferedRangesList.push({ start, end });
        if (start <= cur && cur <= end) {
          bufferedAhead = end - cur;
        }
      }
      bufferDetails = parts.join(', ');
    }

    // Memory usage
    let heapUsedMB = 'N/A';
    let heapTotalMB = 'N/A';
    if (window.performance && window.performance.memory) {
      heapUsedMB = (window.performance.memory.usedJSHeapSize / (1024 * 1024)).toFixed(1);
      heapTotalMB = (window.performance.memory.totalJSHeapSize / (1024 * 1024)).toFixed(1);
    }

    // Native Bridge info
    let nativeInfo = null;
    if (window.AndroidBridge && typeof window.AndroidBridge.getDiagnosticInfo === 'function') {
      try {
        const raw = window.AndroidBridge.getDiagnosticInfo();
        nativeInfo = JSON.parse(raw);
      } catch (e) {
        nativeInfo = { error: e.message };
      }
    }

    return {
      timestamp: new Date().toISOString(),
      uptimeSec: Math.floor((Date.now() - this.sessionStartTime) / 1000),
      track: {
        title: track ? track.title : 'No Track Loaded',
        artist: track ? track.artist : 'N/A',
        format: track ? track.format : 'N/A',
        durationSec: track ? track.duration : (audio ? audio.duration : 0),
        durationFormatted: this.formatTime((track && track.duration) ? track.duration : (audio ? audio.duration : 0)),
        isStreamUrl: !!(audio && audio.src && audio.src.includes('/local-media')),
        isBlobUrl: !!(audio && audio.src && audio.src.startsWith('blob:'))
      },
      audioElement: {
        src: audio ? this.sanitizeSrc(audio.src) : 'null',
        currentTimeSec: audio ? audio.currentTime : 0,
        currentTimeFormatted: this.formatTime(audio ? audio.currentTime : 0),
        paused: audio ? audio.paused : true,
        ended: audio ? audio.ended : false,
        playbackRate: audio ? audio.playbackRate : 1.0,
        volume: audio ? audio.volume : 1.0,
        muted: audio ? audio.muted : false,
        readyState: audio ? (readyStateMap[audio.readyState] || audio.readyState) : 'N/A',
        networkState: audio ? (networkStateMap[audio.networkState] || audio.networkState) : 'N/A',
        bufferedAheadSec: Math.round(bufferedAhead * 10) / 10,
        bufferedRanges: bufferDetails,
        error: audio && audio.error ? {
          code: audio.error.code,
          codeName: this.getErrorCodeName(audio.error.code),
          message: audio.error.message || 'None'
        } : null
      },
      webAudio: {
        ctxState: ctx ? ctx.state : 'uninitialized',
        sampleRate: ctx ? ctx.sampleRate : 'N/A',
        hasSourceNode: !!(this.audioEngineRef && this.audioEngineRef.sourceNode),
        hasKeepAlive: !!(this.audioEngineRef && this.audioEngineRef._keepAliveNode)
      },
      system: {
        visibility: typeof document !== 'undefined' ? document.visibilityState : 'unknown',
        onLine: typeof navigator !== 'undefined' ? navigator.onLine : true,
        heapUsedMB,
        heapTotalMB,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown'
      },
      native: nativeInfo
    };
  }

  getErrorCodeName(code) {
    switch (code) {
      case 1: return 'MEDIA_ERR_ABORTED (1)';
      case 2: return 'MEDIA_ERR_NETWORK (2)';
      case 3: return 'MEDIA_ERR_DECODE (3)';
      case 4: return 'MEDIA_ERR_SRC_NOT_SUPPORTED (4)';
      default: return `UNKNOWN_ERROR (${code})`;
    }
  }

  sanitizeSrc(src) {
    if (!src) return 'empty';
    if (src.startsWith('blob:')) return 'blob:URL[in-memory]';
    if (src.includes('/local-media')) {
      const idx = src.indexOf('/local-media');
      return src.substring(idx, Math.min(src.length, idx + 80)) + '...';
    }
    return src.length > 80 ? src.substring(0, 80) + '...' : src;
  }

  // --- Overnight Heartbeat & Watchdog ---

  startHeartbeat() {
    if (this.heartbeatIntervalId) clearInterval(this.heartbeatIntervalId);
    
    // Heartbeat fires every 45 seconds
    this.heartbeatIntervalId = setInterval(() => {
      this.checkHeartbeatAndWatchdog();
    }, 45000);

    // Initial check
    setTimeout(() => this.checkHeartbeatAndWatchdog(), 2000);
  }

  stopHeartbeat() {
    if (this.heartbeatIntervalId) {
      clearInterval(this.heartbeatIntervalId);
      this.heartbeatIntervalId = null;
    }
  }

  checkHeartbeatAndWatchdog() {
    if (!this.audioEngineRef || !this.audioEngineRef.audio) return;
    const audio = this.audioEngineRef.audio;
    const isPlaying = this.appRef ? this.appRef.isPlaying : (!audio.paused && !audio.ended);

    const cur = audio.currentTime || 0;
    const dur = audio.duration || (this.appRef && this.appRef.currentTrack ? this.appRef.currentTrack.duration : 0) || 0;

    // 1. If actively playing, log periodic heartbeat
    if (isPlaying && !audio.paused) {
      const snap = this.getQuickSnapshot();
      this.heartbeat(
        `Playback Heartbeat: ${snap.posFormatted} / ${snap.durFormatted} | bufferAhead=+${snap.bufferedSec}s | readyState=${snap.readyState} | vis=${snap.visibility}`,
        { snapshot: snap }
      );
    }

    // 2. Watchdog: Stagnation Detection
    // If the player state thinks it's playing, but currentTime has not advanced over 45s
    if (isPlaying && !audio.paused && !this.appRef.isScrubbing) {
      if (this.lastRecordedCurrentTime > 0 && Math.abs(cur - this.lastRecordedCurrentTime) < 0.5) {
        this.stalledCount++;
        this.warn(
          'WATCHDOG',
          `PLAYBACK STALL DETECTED! Position stuck at ${this.formatTime(cur)} for ${this.stalledCount * 45}s. ReadyState: ${audio.readyState}, NetworkState: ${audio.networkState}.`,
          { currentTime: cur, stalledCount: this.stalledCount }
        );

        // Attempt non-destructive auto-recovery if stalled for > 90s
        if (this.stalledCount >= 2) {
          this.attemptWatchdogRecovery();
        }
      } else {
        this.stalledCount = 0;
      }
    } else {
      this.stalledCount = 0;
    }

    this.lastRecordedCurrentTime = cur;

    // 3. Web Audio Context Health
    if (this.audioEngineRef.ctx && this.audioEngineRef.ctx.state === 'suspended' && isPlaying) {
      this.warn('AUDIO', 'AudioContext became suspended while actively playing! Resuming...');
      this.audioEngineRef.resumeContext().catch(() => {});
    }
  }

  attemptWatchdogRecovery() {
    this.warn('WATCHDOG', 'Initiating automated playback nudge & buffer recovery...');
    if (!this.audioEngineRef || !this.audioEngineRef.audio) return;
    const audio = this.audioEngineRef.audio;
    try {
      this.audioEngineRef.resumeContext();
      // Nudge audio forward slightly or trigger play
      if (audio.paused) {
        audio.play().catch(e => this.error('WATCHDOG', `Recovery audio.play() failed: ${e.message}`));
      } else {
        // Small nudge to unstick Chromium demuxer
        audio.currentTime = audio.currentTime + 0.1;
      }
    } catch (err) {
      this.error('WATCHDOG', `Recovery attempt error: ${err.message}`);
    }
  }

  // --- Global Lifecycle & Error Hooks ---

  setupGlobalErrorHooks() {
    window.addEventListener('error', (event) => {
      this.error('SYSTEM', `Uncaught Window Error: ${event.message} at ${event.filename}:${event.lineno}`, {
        error: event.error ? event.error.stack : null
      });
    });

    window.addEventListener('unhandledrejection', (event) => {
      this.error('SYSTEM', `Unhandled Promise Rejection: ${event.reason}`, {
        reason: event.reason
      });
    });
  }

  setupPageLifecycleHooks() {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        const state = document.visibilityState;
        this.info('POWER', `document.visibilitychange -> ${state.toUpperCase()}`);
      });
    }

    window.addEventListener('pagehide', (e) => {
      this.warn('POWER', `window.pagehide event fired (persisted: ${e.persisted})`);
    });

    window.addEventListener('pageshow', (e) => {
      this.info('POWER', `window.pageshow event fired (persisted: ${e.persisted})`);
    });

    window.addEventListener('online', () => {
      this.info('SYSTEM', 'Device network status: ONLINE');
    });

    window.addEventListener('offline', () => {
      this.warn('SYSTEM', 'Device network status: OFFLINE');
    });
  }

  // --- Full Diagnostic Report Exporter ---

  generateFullReport() {
    const diag = this.getDetailedDiagnostics();
    const now = new Date().toLocaleString();

    let text = `====================================================\n`;
    text += `         AURA MUSIC PLAYER - DIAGNOSTIC REPORT      \n`;
    text += `Generated: ${now}\n`;
    text += `Uptime: ${this.formatDuration(diag.uptimeSec)}\n`;
    text += `====================================================\n\n`;

    text += `[CURRENT TRACK]\n`;
    text += `Title:    ${diag.track.title}\n`;
    text += `Artist:   ${diag.track.artist}\n`;
    text += `Format:   ${diag.track.format}\n`;
    text += `Duration: ${diag.track.durationFormatted} (${diag.track.durationSec}s)\n`;
    text += `Storage:  ${diag.track.isBlobUrl ? 'In-Memory Blob URL' : (diag.track.isStreamUrl ? 'Android SAF /local-media Stream' : 'Direct URL')}\n\n`;

    text += `[AUDIO ENGINE STATUS]\n`;
    text += `Current Position: ${diag.audioElement.currentTimeFormatted} (${diag.audioElement.currentTimeSec}s)\n`;
    text += `Playback State:   ${diag.audioElement.paused ? 'PAUSED' : 'PLAYING'} (Ended: ${diag.audioElement.ended})\n`;
    text += `ReadyState:       ${diag.audioElement.readyState}\n`;
    text += `NetworkState:     ${diag.audioElement.networkState}\n`;
    text += `Buffered Ahead:   +${diag.audioElement.bufferedAheadSec}s\n`;
    text += `Buffered Ranges:  ${diag.audioElement.bufferedRanges}\n`;
    text += `Playback Rate:    ${diag.audioElement.playbackRate}x\n`;
    if (diag.audioElement.error) {
      text += `LAST ERROR:       ${diag.audioElement.error.codeName} - ${diag.audioElement.error.message}\n`;
    }
    text += `\n`;

    text += `[WEB AUDIO & CONTEXT]\n`;
    text += `Context State:    ${diag.webAudio.ctxState.toUpperCase()}\n`;
    text += `Sample Rate:      ${diag.webAudio.sampleRate} Hz\n`;
    text += `Keep-Alive Loop:  ${diag.webAudio.hasKeepAlive ? 'ACTIVE' : 'INACTIVE'}\n\n`;

    text += `[POWER & ENVIRONMENT]\n`;
    text += `Visibility:       ${diag.system.visibility.toUpperCase()}\n`;
    text += `Memory (Heap):    ${diag.system.heapUsedMB} MB / ${diag.system.heapTotalMB} MB\n`;
    
    if (diag.native) {
      text += `\n[ANDROID NATIVE STATUS]\n`;
      text += `Android OS:       ${diag.native.androidVersion || 'N/A'}\n`;
      text += `Activity WakeLock:${diag.native.isActivityWakeLockHeld ? ' HELD (CPU awake)' : ' RELEASED'}\n`;
      text += `Service WakeLock: ${diag.native.isServiceWakeLockHeld ? ' HELD (CPU awake)' : ' RELEASED'}\n`;
      text += `Foreground Service:${diag.native.isForegroundRunning ? ' RUNNING (Active)' : ' STOPPED'}\n`;
      text += `Battery Opts:     ${diag.native.isIgnoringBatteryOptimizations ? ' UNRESTRICTED (Whitelisted)' : ' OPTIMIZED (WARNING: OS may kill background audio!)'}\n`;
      text += `Device Idle (Doze):${diag.native.isDeviceIdleMode ? ' ACTIVE (Doze mode)' : ' FALSE'}\n`;
      text += `Power Save Mode:  ${diag.native.isPowerSaveMode ? ' ON' : ' OFF'}\n`;
      if (diag.native.batteryLevel !== undefined) {
        text += `Battery Level:    ${diag.native.batteryLevel}% (${diag.native.isCharging ? 'Charging' : 'Discharging'})\n`;
      }
      if (diag.native.availMemoryMB !== undefined) {
        text += `Avail RAM:        ${diag.native.availMemoryMB} MB / ${diag.native.totalMemoryMB} MB (LowRAM: ${diag.native.lowMemory})\n`;
      }
    }

    text += `\n====================================================\n`;
    text += `           RECENT EVENT LOGS (Last ${Math.min(80, this.logs.length)})\n`;
    text += `====================================================\n`;

    const recent = this.logs.slice(-80);
    recent.forEach((item) => {
      text += `[${item.time}] [${item.level.padEnd(5)}] [${item.category}] ${item.message}\n`;
      if (item.details && Object.keys(item.details).length > 0 && item.level === 'ERROR') {
        try {
          text += `    Details: ${JSON.stringify(item.details)}\n`;
        } catch (ignored) {}
      }
    });

    return text;
  }

  async saveReportToUserLocation() {
    const report = this.generateFullReport();
    const d = new Date();
    const dateStr = d.getFullYear() +
      String(d.getMonth() + 1).padStart(2, '0') +
      String(d.getDate()).padStart(2, '0') + '_' +
      String(d.getHours()).padStart(2, '0') +
      String(d.getMinutes()).padStart(2, '0') +
      String(d.getSeconds()).padStart(2, '0');
    const filename = `aura-diagnostic-report-${dateStr}.txt`;

    // 1. Android Native Storage Access Framework (SAF)
    if (window.AndroidBridge && typeof window.AndroidBridge.saveDiagnosticReport === 'function') {
      window.AndroidBridge.saveDiagnosticReport(report, filename);
      this.info('SYSTEM', `Launched native file saver for ${filename}`);
      return { success: true, method: 'android_saf' };
    }

    // 2. Modern Browser File System Access API
    if (typeof window.showSaveFilePicker === 'function') {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [{
            description: 'Text Document (*.txt)',
            accept: { 'text/plain': ['.txt'] }
          }]
        });
        const writable = await handle.createWritable();
        await writable.write(report);
        await writable.close();
        this.info('SYSTEM', `Diagnostic report saved to ${filename} via FileSystemAccess`);
        return { success: true, method: 'file_picker' };
      } catch (err) {
        if (err.name === 'AbortError') {
          return { success: false, aborted: true };
        }
        console.warn('showSaveFilePicker failed, trying blob download:', err);
      }
    }

    // 3. Browser Blob download fallback
    try {
      const blob = new Blob([report], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      this.info('SYSTEM', `Diagnostic report downloaded as ${filename}`);
      return { success: true, method: 'download' };
    } catch (e) {
      console.error('Failed to save diagnostic report:', e);
      // Last-resort fallback: copy to clipboard
      await this.copyReportToClipboard();
      return { success: true, method: 'clipboard' };
    }
  }

  async copyReportToClipboard() {
    const report = this.generateFullReport();
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(report);
        return true;
      }
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = report;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    } catch (e) {
      console.warn('Clipboard write failed:', e);
      return false;
    }
  }

  // --- UI Integration ---

  isModalOpen() {
    const modal = document.getElementById('diagnostics-modal');
    return modal && (modal.classList.contains('open') || modal.classList.contains('active'));
  }

  openModal() {
    const modal = document.getElementById('diagnostics-modal');
    if (!modal) return;
    modal.classList.add('open');
    modal.classList.add('active');
    this.updateModalMetrics();
    this.renderLogList();

    if (!modal._hasBackdropClick) {
      modal._hasBackdropClick = true;
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          this.closeModal();
        }
      });
    }

    if (this.uiUpdateIntervalId) clearInterval(this.uiUpdateIntervalId);
    this.uiUpdateIntervalId = setInterval(() => {
      if (this.isModalOpen()) {
        this.updateModalMetrics();
      } else {
        clearInterval(this.uiUpdateIntervalId);
        this.uiUpdateIntervalId = null;
      }
    }, 1000);
  }

  closeModal() {
    const modal = document.getElementById('diagnostics-modal');
    if (modal) {
      modal.classList.remove('open');
      modal.classList.remove('active');
    }
    if (this.uiUpdateIntervalId) {
      clearInterval(this.uiUpdateIntervalId);
      this.uiUpdateIntervalId = null;
    }
  }

  updateModalMetrics() {
    const diag = this.getDetailedDiagnostics();

    // Overall Status Pill
    const statusPill = document.getElementById('diag-status-pill');
    if (statusPill) {
      const isPaused = diag.audioElement.paused;
      const isEnded = diag.audioElement.ended;
      const hasError = !!diag.audioElement.error;

      if (hasError) {
        statusPill.textContent = 'ERROR';
        statusPill.className = 'diag-status-badge badge-error';
      } else if (this.stalledCount > 0) {
        statusPill.textContent = 'STALLED';
        statusPill.className = 'diag-status-badge badge-warning';
      } else if (isEnded) {
        statusPill.textContent = 'ENDED';
        statusPill.className = 'diag-status-badge badge-neutral';
      } else if (!isPaused) {
        statusPill.textContent = 'PLAYING';
        statusPill.className = 'diag-status-badge badge-success';
      } else {
        statusPill.textContent = 'PAUSED';
        statusPill.className = 'diag-status-badge badge-neutral';
      }
    }

    // Card 1: Playback State
    const elTrackTitle = document.getElementById('diag-track-title');
    const elPlayState = document.getElementById('diag-playback-state');
    const elCurDur = document.getElementById('diag-cur-dur');
    if (elTrackTitle) elTrackTitle.textContent = diag.track.title;
    if (elPlayState) elPlayState.textContent = diag.audioElement.paused ? 'PAUSED' : 'PLAYING';
    if (elCurDur) elCurDur.textContent = `${diag.audioElement.currentTimeFormatted} / ${diag.track.durationFormatted}`;

    // Card 2: Stream & Buffer
    const elReady = document.getElementById('diag-ready-state');
    const elNet = document.getElementById('diag-net-state');
    const elBufferAhead = document.getElementById('diag-buffer-ahead');
    if (elReady) elReady.textContent = diag.audioElement.readyState;
    if (elNet) elNet.textContent = diag.audioElement.networkState;
    if (elBufferAhead) elBufferAhead.textContent = `+${diag.audioElement.bufferedAheadSec}s (${diag.audioElement.bufferedRanges.substring(0, 32)}...)`;

    // Card 3: Web Audio & Memory
    const elCtx = document.getElementById('diag-ctx-state');
    const elHeap = document.getElementById('diag-heap-used');
    if (elCtx) elCtx.textContent = `${diag.webAudio.ctxState.toUpperCase()} (${diag.webAudio.sampleRate}Hz)`;
    if (elHeap) elHeap.textContent = `${diag.system.heapUsedMB} MB / ${diag.system.heapTotalMB} MB`;

    // Card 4: Power & Background System
    const elVis = document.getElementById('diag-visibility');
    const elWakeLock = document.getElementById('diag-wakelock');
    const elBatteryOpt = document.getElementById('diag-battery-opt');
    const btnFixBattery = document.getElementById('diag-btn-fix-battery');

    if (elVis) elVis.textContent = diag.system.visibility.toUpperCase();
    
    const elCrashlytics = document.getElementById('diag-crashlytics-status');
    if (elCrashlytics) {
      if (diag.native && diag.native.crashlyticsAvailable) {
        elCrashlytics.textContent = 'CRASHLYTICS ACTIVE';
        elCrashlytics.style.color = 'var(--cyan-bright)';
      } else if (window.AndroidBridge && typeof window.AndroidBridge.isCrashlyticsAvailable === 'function') {
        const avail = window.AndroidBridge.isCrashlyticsAvailable();
        elCrashlytics.textContent = avail ? 'CRASHLYTICS ACTIVE' : 'CRASHLYTICS READY';
        elCrashlytics.style.color = avail ? 'var(--cyan-bright)' : 'var(--text-muted)';
      } else {
        elCrashlytics.textContent = 'BROWSER (NO CRASHLYTICS)';
        elCrashlytics.style.color = 'var(--text-muted)';
      }
    }

    if (diag.native) {
      if (elWakeLock) {
        elWakeLock.textContent = diag.native.isActivityWakeLockHeld ? 'HELD' : 'None';
      }
      if (elBatteryOpt) {
        const isOpt = diag.native.isIgnoringBatteryOptimizations;
        elBatteryOpt.textContent = isOpt ? 'UNRESTRICTED' : 'OPTIMIZED (Risks sleep)';
        elBatteryOpt.style.color = isOpt ? 'var(--cyan-bright)' : '#ff5577';
        if (btnFixBattery) {
          btnFixBattery.style.display = isOpt ? 'none' : 'inline-flex';
        }
      }
    } else {
      if (elWakeLock) elWakeLock.textContent = 'Browser';
      if (elBatteryOpt) elBatteryOpt.textContent = 'Web Browser Standard';
      if (btnFixBattery) btnFixBattery.style.display = 'none';
    }
  }

  triggerCrashlyticsTest(forceFatal = true) {
    if (forceFatal) {
      this.warn('SYSTEM', 'Triggering fatal Test Crash (RuntimeException) per Firebase documentation...');
      if (window.AndroidBridge && typeof window.AndroidBridge.testCrashlyticsCrash === 'function') {
        window.AndroidBridge.testCrashlyticsCrash();
        return true;
      }
    } else {
      this.info('SYSTEM', 'Triggering manual Crashlytics non-fatal test exception...');
      if (window.AndroidBridge && typeof window.AndroidBridge.testCrashlyticsNonFatal === 'function') {
        window.AndroidBridge.testCrashlyticsNonFatal();
        return true;
      }
    }
    this.warn('SYSTEM', 'Crashlytics test called outside native Android app');
    return false;
  }

  renderLogList() {
    const container = document.getElementById('diag-log-container');
    if (!container) return;

    let filtered = this.logs;
    if (this.activeFilter === 'errors') {
      filtered = this.logs.filter(l => l.level === 'ERROR' || l.level === 'WARN');
    } else if (this.activeFilter === 'audio') {
      filtered = this.logs.filter(l => l.category === 'AUDIO' || l.category === 'STREAM');
    } else if (this.activeFilter === 'heartbeat') {
      filtered = this.logs.filter(l => l.level === 'HEARTBEAT');
    } else if (this.activeFilter === 'power') {
      filtered = this.logs.filter(l => l.category === 'POWER' || l.category === 'SYSTEM');
    }

    if (filtered.length === 0) {
      container.innerHTML = '<div class="diag-empty-logs">No diagnostic logs found for this filter.</div>';
      return;
    }

    const html = filtered.map(item => this.createLogItemHTML(item)).join('');
    container.innerHTML = html;
    container.scrollTop = container.scrollHeight;
  }

  appendLogToUI(item) {
    const container = document.getElementById('diag-log-container');
    if (!container) return;

    // Check if item matches active filter
    if (this.activeFilter === 'errors' && item.level !== 'ERROR' && item.level !== 'WARN') return;
    if (this.activeFilter === 'audio' && item.category !== 'AUDIO' && item.category !== 'STREAM') return;
    if (this.activeFilter === 'heartbeat' && item.level !== 'HEARTBEAT') return;
    if (this.activeFilter === 'power' && item.category !== 'POWER' && item.category !== 'SYSTEM') return;

    const div = document.createElement('div');
    div.innerHTML = this.createLogItemHTML(item);
    container.appendChild(div.firstElementChild);

    // Auto-scroll to bottom
    container.scrollTop = container.scrollHeight;
  }

  createLogItemHTML(item) {
    const levelClass = item.level.toLowerCase();
    const isError = item.level === 'ERROR';
    const isWarn = item.level === 'WARN';
    const isHeartbeat = item.level === 'HEARTBEAT';

    let badgeClass = 'badge-info';
    if (isError) badgeClass = 'badge-error';
    else if (isWarn) badgeClass = 'badge-warning';
    else if (isHeartbeat) badgeClass = 'badge-heartbeat';

    const escapedMsg = this.escapeHTML(item.message);
    const hasDetails = item.details && Object.keys(item.details).length > 0;

    return `
      <div class="diag-log-row log-${levelClass}">
        <span class="diag-log-time">${item.time}</span>
        <span class="diag-log-badge ${badgeClass}">${item.level}</span>
        <span class="diag-log-cat">[${item.category}]</span>
        <span class="diag-log-msg">${escapedMsg}</span>
        ${hasDetails ? `<div class="diag-log-meta">${this.escapeHTML(JSON.stringify(item.details))}</div>` : ''}
      </div>
    `;
  }

  // --- Helpers ---

  formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    const totalSeconds = Math.floor(seconds);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    if (h > 0) {
      return `${h}:${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
    }
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  formatDuration(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h}h ${m}m ${s}s`;
  }

  escapeHTML(str) {
    if (!str) return '';
    return String(str).replace(/[&<>'"]/g, tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag));
  }
}

// Global Diagnostics Instance
window.auraDiagnostics = new AuraDiagnostics();
