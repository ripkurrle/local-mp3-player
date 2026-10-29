/**
 * Aura Mobile MP3 Player - Main Controller
 * Handles local file imports, IndexedDB persistence, playback queue, UI views,
 * touch gestures, Media Session API, sleep timer, and search/filter.
 */

class AuraApp {
  constructor() {
    this.audioEngine = new AudioEngine();
    this.tracks = [];
    this.filteredTracks = [];
    this.currentTrack = null;
    this.currentIndex = -1;
    this.isPlaying = false;
    this.isShuffled = false;
    this.loopMode = 'library'; // 'track' | 'album' | 'playlist' | 'library' | 'none'
    this.currentContext = { type: 'library', name: 'Library Songs', tracks: [] };
    this.currentFilter = 'all';
    this.searchQuery = '';
    this.activeView = 'tracks';
    this.playbackRate = 1.0;
    this.sleepTimer = null;
    this.sleepTimerEnd = null;
    this.sleepTimerInterval = null;
    this.isScrubbing = false;
    this.scrubTargetTime = 0;

    this.init();
  }

  async init() {
    this.cacheDOMElements();
    this.bindEvents();
    this.audioEngine.bindCanvas(this.dom.visualizerCanvas);

    // Audio Engine callbacks
    this.audioEngine.onTimeUpdate = (cur, dur) => this.handleTimeUpdate(cur, dur);
    this.audioEngine.onTrackEnd = () => this.handleTrackEnd();
    this.audioEngine.onStateChange = (playing) => this.handleStateChange(playing);
    this.audioEngine.onError = (e) => this.handlePlaybackError(e);

    // Initialize Diagnostics Engine
    if (window.auraDiagnostics) {
      window.auraDiagnostics.bind(this, this.audioEngine);
    }

    // Load persisted tracks from IndexedDB
    try {
      const stored = await auraDB.getAllTracks();
      if (stored && stored.length > 0) {
        this.tracks = stored;
        this.updateLibraryUI();
        this.prefetchSampleBlobs();
      } else {
        // Automatically load demo sample tracks for first-time instant gratification!
        await this.loadDefaultDemoTracks();
      }
    } catch (e) {
      console.warn('Could not read IndexedDB:', e);
      await this.loadDefaultDemoTracks();
    }

    // Native Android Folder Picker bridge callbacks
    window.onFolderScanStart = () => {
      this.showToast('Scanning folder recursively for music...');
    };

    window.onNativeFolderImported = async (newTracks) => {
      if (!newTracks || newTracks.length === 0) {
        this.showToast('No allowable music files found in folder.');
        return;
      }

      // Filter duplicates by track ID or URL
      const existingIds = new Set(this.tracks.map(t => t.id));
      const existingUrls = new Set(this.tracks.map(t => t.url || t.contentUri || ''));
      const toAdd = newTracks.filter(t => !existingIds.has(t.id) && !existingUrls.has(t.url));

      if (toAdd.length > 0) {
        await auraDB.saveTracks(toAdd);
        this.tracks = [...this.tracks, ...toAdd];
        this.updateLibraryUI();
        this.showToast(`Imported ${toAdd.length} music track(s)!`);

        // Auto-play first imported track if idle
        if (!this.currentTrack && this.tracks.length > 0) {
          this.playTrack(0);
        }
      } else {
        this.showToast('All tracks from this folder are already imported.');
      }
    };

    this.setupMediaSession();

    // Auto-dismiss notification if document/app becomes hidden while genuinely not actively playing
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && !this.isPlaying && (!this.audioEngine || !this.audioEngine.isChangingTrack) && window.AndroidBridge && typeof window.AndroidBridge.hideNotification === 'function') {
        try {
          window.AndroidBridge.hideNotification();
        } catch (e) {}
      }
    });
  }

  cacheDOMElements() {
    this.dom = {
      // Views & navigation
      navButtons: document.querySelectorAll('.nav-item-btn'),
      viewSections: document.querySelectorAll('.view-section'),
      
      // Header
      libraryStat: document.querySelector('.library-stat'),
      searchBar: document.getElementById('search-input'),
      searchClear: document.getElementById('search-clear'),
      filterChips: document.querySelectorAll('.filter-chip'),
      importBtn: document.getElementById('import-trigger-btn'),
      
      // Tracks View
      tracksList: document.getElementById('tracks-container'),
      emptyState: document.getElementById('empty-library-state'),
      tracksCountBadge: document.getElementById('tracks-count-badge'),

      // Albums & Artists Views
      albumsGrid: document.getElementById('albums-grid'),
      artistsList: document.getElementById('artists-list'),

      // Playlists View
      playlistsList: document.getElementById('playlists-list'),
      createPlaylistBtn: document.getElementById('create-playlist-btn'),

      // Equalizer
      eqSliders: document.querySelectorAll('.eq-vertical-slider'),
      eqPresetChips: document.querySelectorAll('.preset-chip'),
      bassSlider: document.getElementById('bass-boost-slider'),
      bassValLabel: document.getElementById('bass-val-label'),

      // Mini Player
      miniPlayer: document.getElementById('mini-player'),
      miniThumb: document.getElementById('mini-thumb-spinning'),
      miniCoverImg: document.getElementById('mini-cover-img'),
      miniTitle: document.getElementById('mini-title'),
      miniArtist: document.getElementById('mini-artist'),
      miniPrevBtn: document.getElementById('mini-prev-btn'),
      miniPlayBtn: document.getElementById('mini-play-btn'),
      miniNextBtn: document.getElementById('mini-next-btn'),
      miniProgress: document.getElementById('mini-progress-fill'),

      // Full-screen Sheet Player
      playerSheet: document.getElementById('player-sheet-modal'),
      sheetDragHandle: document.getElementById('sheet-drag-handle'),
      sheetCloseBtn: document.getElementById('sheet-close-btn'),
      vinylWrapper: document.getElementById('vinyl-disc-wrapper'),
      vinylCoverImg: document.getElementById('vinyl-cover-img'),
      visualizerCanvas: document.getElementById('visualizer-canvas'),
      vizModeToggle: document.getElementById('viz-mode-toggle'),
      sheetTitle: document.getElementById('sheet-title'),
      sheetArtist: document.getElementById('sheet-artist'),
      sheetFavBtn: document.getElementById('sheet-fav-btn'),

      // Scrubber
      scrubBar: document.getElementById('scrub-bar'),
      scrubProgress: document.getElementById('scrub-progress'),
      timeCurrent: document.getElementById('time-current'),
      timeTotal: document.getElementById('time-total'),

      // Player Controls
      btnShuffle: document.getElementById('btn-shuffle'),
      btnPrev: document.getElementById('btn-prev'),
      btnSeekBack: document.getElementById('btn-seek-back'),
      btnMainPlay: document.getElementById('btn-main-play'),
      btnSeekFwd: document.getElementById('btn-seek-fwd'),
      btnNext: document.getElementById('btn-next'),
      btnRepeat: document.getElementById('btn-repeat'),

      // Quick Nudge Buttons & Feedback
      nudgeBack10: document.getElementById('nudge-back-10'),
      nudgeFwd10: document.getElementById('nudge-fwd-10'),
      skipFeedbackBubble: document.getElementById('skip-feedback-bubble'),
      skipFeedbackIcon: document.getElementById('skip-feedback-icon'),
      skipFeedbackText: document.getElementById('skip-feedback-text'),

      // Loop Mode Controls & Badge
      sheetLoopBadge: document.getElementById('sheet-loop-badge'),
      sheetLoopText: document.getElementById('sheet-loop-text'),
      sheetLoopIcon: document.getElementById('sheet-loop-icon'),
      miniLoopBtn: document.getElementById('mini-loop-btn'),

      // Secondary Actions
      btnSpeed: document.getElementById('btn-speed'),
      btnTimer: document.getElementById('btn-timer'),
      btnInfo: document.getElementById('btn-info'),
      btnEqShortcut: document.getElementById('btn-eq-shortcut'),
      btnOpenDiagnostics: document.getElementById('btn-open-diagnostics'),
      btnSecDiagnostics: document.getElementById('btn-sec-diagnostics'),
      eqDiagnosticsCard: document.getElementById('eq-diagnostics-card'),

      // Modals
      importModal: document.getElementById('import-modal'),
      timerModal: document.getElementById('timer-modal'),
      infoModal: document.getElementById('info-modal'),
      diagnosticsModal: document.getElementById('diagnostics-modal'),
      diagCloseBtn: document.getElementById('diag-close-btn'),
      diagSaveReportBtn: document.getElementById('diag-save-report-btn') || document.getElementById('diag-copy-report-btn'),
      diagCrashlyticsTestBtn: document.getElementById('diag-crashlytics-test-btn'),
      diagClearLogsBtn: document.getElementById('diag-clear-logs-btn'),
      diagNudgeBtn: document.getElementById('diag-nudge-btn'),
      diagBtnFixBattery: document.getElementById('diag-btn-fix-battery'),
      diagFilterChips: document.querySelectorAll('.diag-filter-chip'),
      playlistModal: document.getElementById('playlist-modal'),
      loopModal: document.getElementById('loop-modal'),
      loopOptCards: document.querySelectorAll('.loop-opt-card'),
      loopAlbumTitle: document.getElementById('loop-album-title'),
      loopAlbumDesc: document.getElementById('loop-album-desc'),
      loopPlTitle: document.getElementById('loop-pl-title'),
      loopPlDesc: document.getElementById('loop-pl-desc'),
      confirmModal: document.getElementById('confirm-modal'),
      playlistDetailModal: document.getElementById('playlist-detail-modal'),
      playlistAddSongsModal: document.getElementById('playlist-add-songs-modal'),
      trackAddToPlaylistModal: document.getElementById('track-add-to-playlist-modal'),

      // Hidden file inputs
      fileInputFiles: document.getElementById('file-input-files'),
      fileInputFolder: document.getElementById('file-input-folder'),

      // Frame Desktop Toggle
      deviceViewport: document.getElementById('device-viewport'),
      toggleDesktopFrameBtn: document.getElementById('toggle-desktop-frame'),

      // Toast
      toast: document.getElementById('toast-notice')
    };

    // Fallback error handlers for player covers
    if (this.dom.miniCoverImg) {
      this.dom.miniCoverImg.onerror = () => {
        this.dom.miniCoverImg.onerror = null;
        this.dom.miniCoverImg.src = ID3Parser.generateProceduralCover('Aura', 'Music');
      };
    }
    if (this.dom.vinylCoverImg) {
      this.dom.vinylCoverImg.onerror = () => {
        this.dom.vinylCoverImg.onerror = null;
        this.dom.vinylCoverImg.src = ID3Parser.generateProceduralCover('Aura', 'Music');
      };
    }
  }

  getTrackArtwork(track) {
    if (track && track.pictureUrl && !track.pictureUrl.startsWith('blob:') && !track.pictureUrl.includes('null')) {
      return track.pictureUrl;
    }
    const title = track ? track.title : 'Track';
    const artist = track ? track.artist : 'Artist';
    const fallback = ID3Parser.generateProceduralCover(title, artist);
    if (track) track.pictureUrl = fallback;
    return fallback;
  }

  bindEvents() {
    // Navigation Tabs
    this.dom.navButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const view = btn.dataset.view;
        this.switchView(view);
      });
    });

    // Desktop Frame Toggle
    if (this.dom.toggleDesktopFrameBtn) {
      this.dom.toggleDesktopFrameBtn.addEventListener('click', () => {
        this.dom.deviceViewport.classList.toggle('fullscreen-mode');
        const isFull = this.dom.deviceViewport.classList.contains('fullscreen-mode');
        this.dom.toggleDesktopFrameBtn.innerHTML = isFull
          ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 14h6m0 0v6m0-6L3 21m17-7h-6m0 0v6m0-6l7 7M4 10h6m0 0V4m0 6L3 3m17 7h-6m0 0V4m0 6l7-7"/></svg> Phone Frame`
          : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg> Fullscreen Mode`;
      });
    }

    // Search bar
    this.dom.searchBar.addEventListener('input', (e) => {
      this.searchQuery = e.target.value.toLowerCase().trim();
      this.dom.searchClear.style.display = this.searchQuery ? 'block' : 'none';
      this.filterAndRender();
    });

    this.dom.searchClear.addEventListener('click', () => {
      this.dom.searchBar.value = '';
      this.searchQuery = '';
      this.dom.searchClear.style.display = 'none';
      this.filterAndRender();
    });

    // Filter Chips
    this.dom.filterChips.forEach(chip => {
      chip.addEventListener('click', () => {
        this.dom.filterChips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        this.currentFilter = chip.dataset.filter;
        this.filterAndRender();
      });
    });

    // File Import Triggers
    this.dom.importBtn.addEventListener('click', () => this.openModal(this.dom.importModal));
    
    document.getElementById('opt-pick-files').addEventListener('click', () => {
      this.closeModal(this.dom.importModal);
      this.openFilePicker();
    });

    document.getElementById('opt-pick-folder').addEventListener('click', () => {
      this.closeModal(this.dom.importModal);
      this.openFolderPicker();
    });

    document.getElementById('opt-add-demos').addEventListener('click', () => {
      this.closeModal(this.dom.importModal);
      this.loadDefaultDemoTracks(true);
    });

    document.getElementById('opt-clear-all').addEventListener('click', async () => {
      this.closeModal(this.dom.importModal);
      const confirmed = await this.showConfirmModal({
        title: 'Clear Music Library',
        message: 'Are you sure you want to clear all imported local tracks from Aura storage? This action cannot be undone.',
        confirmText: 'Clear All',
        cancelText: 'Keep Tracks',
        isDanger: true
      });

      if (confirmed) {
        await auraDB.clearAllTracks();
        this.tracks = [];
        this.clearCurrentlyLoadedTrack();
        this.updateLibraryUI();
        this.showToast('Library cleared');
      }
    });

    // File Input Handlers
    this.dom.fileInputFiles.addEventListener('change', (e) => this.handleFilesSelected(e.target.files));
    this.dom.fileInputFolder.addEventListener('change', (e) => this.handleFilesSelected(e.target.files));

    // Intercept clicks on hidden file inputs so native Android bridges are always prioritized
    if (this.dom.fileInputFolder) {
      this.dom.fileInputFolder.addEventListener('click', (e) => {
        if (window.AndroidBridge && typeof window.AndroidBridge.openFolderPicker === 'function') {
          e.preventDefault();
          e.stopPropagation();
          window.AndroidBridge.openFolderPicker();
        }
      });
    }
    if (this.dom.fileInputFiles) {
      this.dom.fileInputFiles.addEventListener('click', (e) => {
        if (window.AndroidBridge && typeof window.AndroidBridge.openFilePicker === 'function') {
          e.preventDefault();
          e.stopPropagation();
          window.AndroidBridge.openFilePicker();
        }
      });
    }

    // Drag and Drop
    const dropzone = this.dom.emptyState;
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.files.length > 0) {
        this.handleFilesSelected(e.dataTransfer.files);
      }
    });

    // Mini Player Open & Controls
    this.dom.miniPlayer.addEventListener('click', (e) => {
      if (e.target.closest('.mini-btn')) return; // ignore control button clicks
      this.openPlayerSheet();
    });

    if (this.dom.miniPrevBtn) {
      this.dom.miniPrevBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.playPrev();
      });
    }
    this.dom.miniPlayBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.togglePlayPause();
    });
    this.dom.miniNextBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.playNext();
    });

    // Full-screen Sheet Player Controls
    this.dom.sheetDragHandle.addEventListener('click', () => this.closePlayerSheet());
    this.dom.sheetCloseBtn.addEventListener('click', () => this.closePlayerSheet());

    this.dom.btnMainPlay.addEventListener('click', () => this.togglePlayPause());
    this.dom.btnPrev.addEventListener('click', () => this.playPrev());
    this.dom.btnNext.addEventListener('click', () => this.playNext());

    // 10-Second Skip Buttons (Flanking Play Button)
    if (this.dom.btnSeekBack) {
      this.dom.btnSeekBack.addEventListener('click', (e) => {
        e.stopPropagation();
        this.skipSeconds(-10);
      });
    }
    if (this.dom.btnSeekFwd) {
      this.dom.btnSeekFwd.addEventListener('click', (e) => {
        e.stopPropagation();
        this.skipSeconds(10);
      });
    }

    // Scrubber Quick Nudges (⟲ 10s and 10s ⟳)
    if (this.dom.nudgeBack10) {
      this.dom.nudgeBack10.addEventListener('click', (e) => {
        e.stopPropagation();
        this.skipSeconds(-10);
      });
    }
    if (this.dom.nudgeFwd10) {
      this.dom.nudgeFwd10.addEventListener('click', (e) => {
        e.stopPropagation();
        this.skipSeconds(10);
      });
    }

    this.dom.btnShuffle.addEventListener('click', () => {
      this.isShuffled = !this.isShuffled;
      this.dom.btnShuffle.classList.toggle('active', this.isShuffled);
      this.showToast(this.isShuffled ? 'Shuffle: ON' : 'Shuffle: OFF');
    });

    // Loop Controls
    this.dom.btnRepeat.addEventListener('click', () => this.cycleLoopMode());

    if (this.dom.miniLoopBtn) {
      this.dom.miniLoopBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.cycleLoopMode();
      });
    }

    if (this.dom.sheetLoopBadge) {
      this.dom.sheetLoopBadge.addEventListener('click', () => {
        this.updateLoopModalDetails();
        this.openModal(this.dom.loopModal);
      });
    }

    if (this.dom.loopOptCards) {
      this.dom.loopOptCards.forEach(card => {
        card.addEventListener('click', () => {
          const mode = card.dataset.mode;
          this.setLoopMode(mode);
          this.closeModal(this.dom.loopModal);
        });
      });
    }

    // Scrubber Slide / Drag Interaction
    const scrubBar = this.dom.scrubBar;

    const getEventClientX = (e) => {
      if (e.touches && e.touches.length > 0) return e.touches[0].clientX;
      if (e.changedTouches && e.changedTouches.length > 0) return e.changedTouches[0].clientX;
      return e.clientX;
    };

    const updateScrubPosition = (clientX) => {
      const rect = scrubBar.getBoundingClientRect();
      if (!rect.width) return;
      const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const duration = this.audioEngine.audio.duration || (this.currentTrack ? this.currentTrack.duration : 0) || 0;
      this.scrubTargetTime = fraction * duration;

      const pct = fraction * 100;
      this.dom.scrubProgress.style.width = `${pct}%`;
      this.dom.miniProgress.style.width = `${pct}%`;
      this.dom.timeCurrent.textContent = this.formatTime(this.scrubTargetTime);
    };

    const handleScrubStart = (e) => {
      if (!this.currentTrack) return;
      this.isScrubbing = true;
      scrubBar.classList.add('is-scrubbing');

      if (e.pointerId !== undefined && scrubBar.setPointerCapture) {
        try {
          scrubBar.setPointerCapture(e.pointerId);
        } catch (err) {}
      }

      // Temporarily pause while dragging so audio does not stutter or play from stale position
      if (!this.audioEngine.audio.paused) {
        this.audioEngine.pause();
      }

      updateScrubPosition(getEventClientX(e));
    };

    const handleScrubMove = (e) => {
      if (!this.isScrubbing) return;
      if (e.cancelable) e.preventDefault();
      updateScrubPosition(getEventClientX(e));
    };

    const handleScrubEnd = (e) => {
      if (!this.isScrubbing) return;
      this.isScrubbing = false;
      scrubBar.classList.remove('is-scrubbing');

      if (e.pointerId !== undefined && scrubBar.releasePointerCapture) {
        try {
          scrubBar.releasePointerCapture(e.pointerId);
        } catch (err) {}
      }

      const clientX = getEventClientX(e);
      if (clientX !== undefined && !isNaN(clientX)) {
        updateScrubPosition(clientX);
      }

      // Seek to the selected point
      this.audioEngine.seek(this.scrubTargetTime);

      // Play from that point once the user removes their finger
      this.audioEngine.play().catch(err => console.warn('Play after scrub error:', err));
    };

    if (window.PointerEvent) {
      scrubBar.addEventListener('pointerdown', handleScrubStart);
      window.addEventListener('pointermove', handleScrubMove, { passive: false });
      window.addEventListener('pointerup', handleScrubEnd);
      window.addEventListener('pointercancel', handleScrubEnd);
    } else {
      scrubBar.addEventListener('touchstart', handleScrubStart, { passive: false });
      window.addEventListener('touchmove', handleScrubMove, { passive: false });
      window.addEventListener('touchend', handleScrubEnd);
      window.addEventListener('touchcancel', handleScrubEnd);

      scrubBar.addEventListener('mousedown', handleScrubStart);
      window.addEventListener('mousemove', handleScrubMove);
      window.addEventListener('mouseup', handleScrubEnd);
    }

    // Visualizer Mode Switch
    this.dom.vizModeToggle.addEventListener('click', () => {
      const modes = ['bars', 'wave', 'circle'];
      const next = modes[(modes.indexOf(this.audioEngine.visualizerMode) + 1) % modes.length];
      this.audioEngine.visualizerMode = next;
      this.dom.vizModeToggle.textContent = next.toUpperCase();
    });

    // Speed Control
    this.dom.btnSpeed.addEventListener('click', () => {
      const rates = [1.0, 1.25, 1.5, 2.0, 0.75];
      const curIdx = rates.indexOf(this.playbackRate);
      this.playbackRate = rates[(curIdx + 1) % rates.length];
      this.audioEngine.setPlaybackRate(this.playbackRate);
      this.dom.btnSpeed.querySelector('span').textContent = `${this.playbackRate}x`;
      this.showToast(`Speed: ${this.playbackRate}x`);
    });

    // Sleep Timer Modal
    this.dom.btnTimer.addEventListener('click', () => this.openModal(this.dom.timerModal));
    document.querySelectorAll('.timer-opt-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mins = parseInt(btn.dataset.minutes, 10);
        this.setSleepTimer(mins);
        this.closeModal(this.dom.timerModal);
      });
    });

    // Track Info Modal
    this.dom.btnInfo.addEventListener('click', () => this.openTrackInfoModal());

    // Diagnostics Modal Openers
    const handleOpenDiagnostics = (e) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      if (window.auraDiagnostics) {
        window.auraDiagnostics.openModal();
      } else if (this.dom.diagnosticsModal) {
        this.openModal(this.dom.diagnosticsModal);
      }
    };

    if (this.dom.btnOpenDiagnostics) {
      this.dom.btnOpenDiagnostics.addEventListener('click', handleOpenDiagnostics);
    }
    if (this.dom.btnSecDiagnostics) {
      this.dom.btnSecDiagnostics.addEventListener('click', handleOpenDiagnostics);
    }
    if (this.dom.eqDiagnosticsCard) {
      this.dom.eqDiagnosticsCard.addEventListener('click', handleOpenDiagnostics);
    }

    // Diagnostics Modal Actions
    if (this.dom.diagCloseBtn) {
      this.dom.diagCloseBtn.addEventListener('click', (e) => {
        if (e) {
          e.preventDefault();
          e.stopPropagation();
        }
        if (window.auraDiagnostics) {
          window.auraDiagnostics.closeModal();
        } else if (this.dom.diagnosticsModal) {
          this.closeModal(this.dom.diagnosticsModal);
        }
      });
    }
    const saveReportBtn = this.dom.diagSaveReportBtn || this.dom.diagCopyReportBtn;
    if (saveReportBtn) {
      saveReportBtn.addEventListener('click', async () => {
        if (window.auraDiagnostics) {
          const res = await window.auraDiagnostics.saveReportToUserLocation();
          if (res && res.method === 'android_saf') {
            // Android SAF intent will launch file picker dialog
          } else if (res && res.method === 'file_picker') {
            this.showToast('Diagnostic report saved to file!');
          } else if (res && res.method === 'download') {
            this.showToast('Diagnostic report downloaded!');
          } else if (res && res.method === 'clipboard') {
            this.showToast('Report copied to clipboard');
          }
        }
      });
    }
    if (this.dom.diagCrashlyticsTestBtn) {
      this.dom.diagCrashlyticsTestBtn.addEventListener('click', () => {
        if (!window.AndroidBridge) {
          this.showToast('Crashlytics testing requires running inside the Android app');
          return;
        }
        if (confirm('Firebase Crashlytics Test Crash:\n\nPer the Firebase guide, this button forces a crash (RuntimeException) to verify Crashlytics.\n\nIMPORTANT: After the app closes, please RE-OPEN the app so Crashlytics can upload the report to your Firebase Console.\n\nForce test crash now?')) {
          if (window.auraDiagnostics) {
            window.auraDiagnostics.triggerCrashlyticsTest(true);
          } else if (window.AndroidBridge.testCrashlyticsCrash) {
            window.AndroidBridge.testCrashlyticsCrash();
          }
        }
      });
    }
    if (this.dom.diagClearLogsBtn) {
      this.dom.diagClearLogsBtn.addEventListener('click', () => {
        if (window.auraDiagnostics) {
          window.auraDiagnostics.clearLogs();
          this.showToast('Diagnostic log cleared');
        }
      });
    }
    if (this.dom.diagNudgeBtn) {
      this.dom.diagNudgeBtn.addEventListener('click', () => {
        if (window.auraDiagnostics) {
          window.auraDiagnostics.attemptWatchdogRecovery();
          this.showToast('Playback engine recovery nudged');
        }
      });
    }
    if (this.dom.diagBtnFixBattery) {
      this.dom.diagBtnFixBattery.addEventListener('click', () => {
        if (window.AndroidBridge && typeof window.AndroidBridge.requestIgnoreBatteryOptimizations === 'function') {
          window.AndroidBridge.requestIgnoreBatteryOptimizations();
        } else {
          this.showToast('Battery optimization management is Android-specific');
        }
      });
    }
    if (this.dom.diagFilterChips) {
      this.dom.diagFilterChips.forEach(chip => {
        chip.addEventListener('click', () => {
          this.dom.diagFilterChips.forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
          if (window.auraDiagnostics) {
            window.auraDiagnostics.activeFilter = chip.dataset.filter;
            window.auraDiagnostics.renderLogList();
          }
        });
      });
    }

    // Equalizer Shortcut
    this.dom.btnEqShortcut.addEventListener('click', () => {
      this.closePlayerSheet();
      this.switchView('eq');
    });

    // Equalizer Sliders
    this.dom.eqSliders.forEach((slider, idx) => {
      slider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        this.audioEngine.setEqBandGain(idx, val);
        const label = slider.closest('.eq-slider-col').querySelector('.eq-slider-gain-label');
        if (label) {
          const rounded = Math.round(val * 10) / 10;
          label.textContent = `${rounded > 0 ? '+' : ''}${rounded}dB`;
        }
      });
    });

    // EQ Presets
    this.dom.eqPresetChips.forEach(chip => {
      chip.addEventListener('click', () => {
        this.dom.eqPresetChips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        const preset = chip.dataset.preset;
        const gains = this.audioEngine.applyPreset(preset);
        this.dom.eqSliders.forEach((sl, i) => {
          sl.value = gains[i];
          const label = sl.closest('.eq-slider-col').querySelector('.eq-slider-gain-label');
          if (label) {
            const rounded = Math.round(gains[i] * 10) / 10;
            label.textContent = `${rounded > 0 ? '+' : ''}${rounded}dB`;
          }
        });
        this.showToast(`EQ Preset: ${preset.toUpperCase()}`);
      });
    });

    // Bass Booster Slider
    if (this.dom.bassSlider) {
      this.dom.bassSlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        this.audioEngine.setBassBoost(val);
        if (this.dom.bassValLabel) {
          const rounded = Math.round(val * 10) / 10;
          this.dom.bassValLabel.textContent = `+${rounded}dB`;
        }
      });
    }

    // Playlist Modal
    if (this.dom.createPlaylistBtn) {
      this.dom.createPlaylistBtn.addEventListener('click', () => {
        document.getElementById('playlist-name-input').value = '';
        this.openModal(this.dom.playlistModal);
      });
    }

    const savePlBtn = document.getElementById('save-playlist-btn');
    if (savePlBtn) {
      savePlBtn.addEventListener('click', async () => {
        const nameInput = document.getElementById('playlist-name-input');
        const name = nameInput.value.trim();
        if (!name) return;
        const newPl = {
          id: `pl_${Date.now()}`,
          name: name,
          trackIds: [],
          createdAt: Date.now()
        };
        await auraDB.savePlaylist(newPl);
        this.closeModal(this.dom.playlistModal);
        this.renderPlaylists();
        this.showToast(`Created playlist "${name}"`);
        // Immediately open playlist detail to allow adding songs right away!
        await this.openPlaylistDetail(newPl.id);
      });
    }

    // Playlist Detail & Song Management Event Listeners
    const plOpenAddBtn = document.getElementById('playlist-open-add-songs-btn');
    if (plOpenAddBtn) {
      plOpenAddBtn.addEventListener('click', () => {
        if (this.currentEditingPlaylist) {
          this.openAddSongsModal(this.currentEditingPlaylist);
        }
      });
    }

    const plPlayAllBtn = document.getElementById('playlist-play-all-btn');
    if (plPlayAllBtn) {
      plPlayAllBtn.addEventListener('click', () => {
        if (this.currentEditingPlaylist) {
          const ids = this.currentEditingPlaylist.trackIds || [];
          if (ids.length === 0) {
            this.showToast('Add songs first to play this playlist!');
            return;
          }
          this.playPlaylist(this.currentEditingPlaylist.name, ids, 0);
          this.closeModal(this.dom.playlistDetailModal);
        }
      });
    }

    const plDetailDelBtn = document.getElementById('playlist-detail-delete-btn');
    if (plDetailDelBtn) {
      plDetailDelBtn.addEventListener('click', async () => {
        if (!this.currentEditingPlaylist) return;
        const pl = this.currentEditingPlaylist;
        const confirmed = await this.showConfirmModal({
          title: 'Delete Playlist',
          message: `Are you sure you want to delete "${pl.name}"? (Songs remain safely in your library)`,
          confirmText: 'Delete',
          cancelText: 'Cancel',
          isDanger: true
        });
        if (confirmed) {
          await auraDB.deletePlaylist(pl.id);
          this.closeModal(this.dom.playlistDetailModal);
          this.renderPlaylists();
          this.showToast(`Deleted playlist "${pl.name}"`);
        }
      });
    }

    const plDetailCloseBtn = document.getElementById('playlist-detail-close-btn');
    if (plDetailCloseBtn) {
      plDetailCloseBtn.addEventListener('click', () => {
        this.closeModal(this.dom.playlistDetailModal);
      });
    }

    const addSongsConfirmBtn = document.getElementById('add-songs-confirm-btn');
    if (addSongsConfirmBtn) {
      addSongsConfirmBtn.addEventListener('click', () => {
        this.addSelectedSongsToPlaylist();
      });
    }

    const addSongsCancelBtn = document.getElementById('add-songs-cancel-btn');
    if (addSongsCancelBtn) {
      addSongsCancelBtn.addEventListener('click', () => {
        this.closeModal(this.dom.playlistAddSongsModal);
      });
    }

    const addSongsCloseBtn = document.getElementById('add-songs-modal-close-btn');
    if (addSongsCloseBtn) {
      addSongsCloseBtn.addEventListener('click', () => {
        this.closeModal(this.dom.playlistAddSongsModal);
      });
    }

    const quickAddCloseBtn = document.getElementById('quick-add-modal-close-btn');
    if (quickAddCloseBtn) {
      quickAddCloseBtn.addEventListener('click', () => {
        this.closeModal(this.dom.trackAddToPlaylistModal);
      });
    }

    const quickAddNewPlBtn = document.getElementById('quick-add-new-playlist-btn');
    if (quickAddNewPlBtn) {
      quickAddNewPlBtn.addEventListener('click', () => {
        this.closeModal(this.dom.trackAddToPlaylistModal);
        const nameInput = document.getElementById('playlist-name-input');
        if (nameInput) nameInput.value = '';
        this.openModal(this.dom.playlistModal);
      });
    }

    // Modal Close buttons
    document.querySelectorAll('.modal-close-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const modal = e.target.closest('.modal-overlay');
        if (modal) this.closeModal(modal);
      });
    });

    // Sheet Touch Drag Down to Close
    this.setupSwipeToClose();

    // Keybindings (Spacebar play/pause, Arrow keys for seek/skip, Shift+Arrows for next/prev, J/K/L)
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.code === 'Space' || e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        this.togglePlayPause();
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        if (e.shiftKey) {
          this.playNext();
        } else {
          this.skipSeconds(10);
        }
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        if (e.shiftKey) {
          this.playPrev();
        } else {
          this.skipSeconds(-10);
        }
      } else if (e.key === 'l' || e.key === 'L') {
        e.preventDefault();
        this.skipSeconds(10);
      } else if (e.key === 'j' || e.key === 'J') {
        e.preventDefault();
        this.skipSeconds(-10);
      }
    });
  }

  setupSwipeToClose() {
    let startY = 0;
    let currentY = 0;
    const sheet = this.dom.playerSheet;

    sheet.addEventListener('touchstart', (e) => {
      startY = e.touches[0].clientY;
    }, { passive: true });

    sheet.addEventListener('touchmove', (e) => {
      currentY = e.touches[0].clientY;
      const diff = currentY - startY;
      if (diff > 0) {
        sheet.style.transform = `translateY(${diff}px)`;
      }
    }, { passive: true });

    sheet.addEventListener('touchend', () => {
      const diff = currentY - startY;
      sheet.style.transform = '';
      if (diff > 120) {
        this.closePlayerSheet();
      }
      startY = 0;
      currentY = 0;
    });
  }

  // --- File Import & Processing ---

  openFilePicker() {
    if (window.AndroidBridge && typeof window.AndroidBridge.openFilePicker === 'function') {
      window.AndroidBridge.openFilePicker();
    } else if (this.dom && this.dom.fileInputFiles) {
      this.dom.fileInputFiles.click();
    } else {
      const el = document.getElementById('file-input-files');
      if (el) el.click();
    }
  }

  openFolderPicker() {
    if (window.AndroidBridge && typeof window.AndroidBridge.openFolderPicker === 'function') {
      window.AndroidBridge.openFolderPicker();
    } else if (this.dom && this.dom.fileInputFolder) {
      this.dom.fileInputFolder.click();
    } else {
      const el = document.getElementById('file-input-folder');
      if (el) el.click();
    }
  }

  async handleFilesSelected(fileList) {
    if (!fileList || fileList.length === 0) return;
    this.showToast(`Processing ${fileList.length} file(s)...`);

    const newTracks = [];
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      // Filter for all allowable audio extensions
      const ext = file.name.split('.').pop().toLowerCase();
      if (!['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'weba', 'opus', 'wma', 'mid', 'midi', 'ape', 'aiff', 'alac'].includes(ext)) {
        continue;
      }

      try {
        const metadata = await ID3Parser.parse(file);

        let contentUri = null;
        let streamUrl = null;
        if (window.AndroidBridge && typeof window.AndroidBridge.getContentUriForFilename === 'function') {
          try {
            contentUri = window.AndroidBridge.getContentUriForFilename(file.name);
          } catch (e) {}
        }
        if (contentUri) {
          const encoded = encodeURIComponent(contentUri);
          const extParam = ext || 'audio';
          streamUrl = `https://appassets.androidplatform.net/local-media?uri=${encoded}&ext=${extParam}`;
        }

        let fileBlob = null;
        // Only load into IndexedDB Blob if direct system streaming is unavailable
        if (!contentUri) {
          fileBlob = file;
          try {
            const buffer = await file.arrayBuffer();
            let mimeType = file.type || 'audio/mpeg';
            if (ext === 'mp3') mimeType = 'audio/mpeg';
            else if (ext === 'm4a') mimeType = 'audio/mp4';
            else if (ext === 'aac') mimeType = 'audio/aac';
            else if (ext === 'wav') mimeType = 'audio/wav';
            else if (ext === 'flac') mimeType = 'audio/flac';
            else if (ext === 'ogg') mimeType = 'audio/ogg';
            else if (ext === 'opus' || ext === 'weba') mimeType = 'audio/webm';

            fileBlob = new Blob([buffer], { type: mimeType });
            fileBlob.name = file.name;
            fileBlob.lastModified = file.lastModified;
          } catch (readErr) {
            console.warn('Could not read file into ArrayBuffer, using original file object:', readErr);
            if (ext === 'm4a' || (file.type && file.type.includes('m4a'))) {
              fileBlob = new Blob([file], { type: 'audio/mp4' });
              fileBlob.name = file.name;
              fileBlob.lastModified = file.lastModified;
            } else if (ext === 'aac' || (file.type && file.type.includes('aac'))) {
              fileBlob = new Blob([file], { type: 'audio/aac' });
              fileBlob.name = file.name;
              fileBlob.lastModified = file.lastModified;
            }
          }
        }

        const trackObj = {
          id: `local_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
          title: metadata.title,
          artist: metadata.artist,
          album: metadata.album,
          year: metadata.year,
          genre: metadata.genre,
          format: metadata.format || (ext ? ext.toUpperCase() : 'AUDIO'),
          size: file.size,
          pictureUrl: metadata.pictureUrl,
          fileBlob: fileBlob, // Store normalized Blob in IndexedDB
          url: streamUrl,
          contentUri: contentUri,
          isFavorite: false,
          playCount: 0,
          addedAt: Date.now()
        };
        newTracks.push(trackObj);
      } catch (err) {
        console.warn('Error reading track:', file.name, err);
      }
    }

    if (newTracks.length > 0) {
      await auraDB.saveTracks(newTracks);
      this.tracks = [...this.tracks, ...newTracks];
      this.updateLibraryUI();
      this.showToast(`Imported ${newTracks.length} track(s)!`);
      
      // Auto-play first imported track if nothing is playing
      if (!this.currentTrack && newTracks.length > 0) {
        this.playTrack(0);
      }
    } else {
      this.showToast('No valid audio files found.');
    }

    if (this.dom && this.dom.fileInputFiles) this.dom.fileInputFiles.value = '';
    if (this.dom && this.dom.fileInputFolder) this.dom.fileInputFolder.value = '';
  }

  // Load Built-in Demo Tracks
  async loadDefaultDemoTracks(notify = false) {
    const demos = [
      {
        id: 'demo_mp3',
        title: 'Neon Horizon',
        artist: 'Cyber Synthetics',
        album: 'Retro Wave Anthology',
        year: '2026',
        genre: 'Synthwave',
        format: 'MP3',
        size: 71064,
        url: './assets/sample-tracks/Neon_Horizon.mp3',
        pictureUrl: './assets/sample-tracks/neon_horizon_cover.jpg',
        isFavorite: true,
        playCount: 5,
        addedAt: Date.now() - 7000000
      },
      {
        id: 'demo_m4a',
        title: 'Solar Wind Odyssey',
        artist: 'Aura Ambient',
        album: 'Cosmic Drift',
        year: '2026',
        genre: 'Ambient',
        format: 'M4A',
        size: 197983,
        url: './assets/sample-tracks/Solar_Wind.m4a',
        pictureUrl: './assets/sample-tracks/solar_wind_cover.jpg',
        isFavorite: true,
        playCount: 8,
        addedAt: Date.now() - 6000000
      },
      {
        id: 'demo_flac',
        title: 'Obsidian Resonance',
        artist: 'Acoustic Ensemble',
        album: 'Lossless Fidelity Sessions',
        year: '2026',
        genre: 'Acoustic',
        format: 'FLAC',
        size: 280309,
        url: './assets/sample-tracks/Obsidian_Resonance.flac',
        pictureUrl: './assets/sample-tracks/obsidian_resonance_cover.jpg',
        isFavorite: false,
        playCount: 3,
        addedAt: Date.now() - 5000000
      },
      {
        id: 'demo_ogg',
        title: 'Emerald Canopy',
        artist: 'Verdant Soundscape',
        album: 'Nature & Rain',
        year: '2026',
        genre: 'Chillout',
        format: 'OGG',
        size: 86688,
        url: './assets/sample-tracks/Emerald_Canopy.ogg',
        pictureUrl: './assets/sample-tracks/emerald_canopy_cover.jpg',
        isFavorite: false,
        playCount: 4,
        addedAt: Date.now() - 4000000
      },
      {
        id: 'demo_opus',
        title: 'Quantum Pulse',
        artist: 'Neural Drift',
        album: 'Future Beats 2026',
        year: '2026',
        genre: 'Electronic',
        format: 'OPUS',
        size: 156000,
        url: './assets/sample-tracks/Quantum_Pulse.opus',
        pictureUrl: './assets/sample-tracks/quantum_pulse_cover.jpg',
        isFavorite: true,
        playCount: 6,
        addedAt: Date.now() - 3000000
      },
      {
        id: 'demo_wav',
        title: 'Midnight Reverie',
        artist: 'Velvet Echoes',
        album: 'Analog Master Tape',
        year: '2026',
        genre: 'Lo-Fi',
        format: 'WAV',
        size: 1411244,
        url: './assets/sample-tracks/Midnight_Reverie.wav',
        pictureUrl: './assets/sample-tracks/midnight_reverie_cover.jpg',
        isFavorite: true,
        playCount: 9,
        addedAt: Date.now() - 2000000
      },
      {
        id: 'demo_aac',
        title: 'Crystal Cascade',
        artist: 'Prism Orchestra',
        album: 'Ethereal Motion',
        year: '2026',
        genre: 'Orchestral',
        format: 'AAC',
        size: 197382,
        url: './assets/sample-tracks/Crystal_Cascade.aac',
        pictureUrl: './assets/sample-tracks/crystal_cascade_cover.jpg',
        isFavorite: false,
        playCount: 2,
        addedAt: Date.now() - 1000000
      },
      {
        id: 'demo_weba',
        title: 'Starlight Odyssey',
        artist: 'Orbital Odyssey',
        album: 'Web Audio Explorations',
        year: '2026',
        genre: 'Space Ambient',
        format: 'WEBA',
        size: 158000,
        url: './assets/sample-tracks/Starlight_Odyssey.weba',
        pictureUrl: './assets/sample-tracks/starlight_odyssey_cover.jpg',
        isFavorite: false,
        playCount: 3,
        addedAt: Date.now() - 500000
      }
    ];

    // Refresh or add demo tracks
    const toSave = [];
    for (const demo of demos) {
      const idx = this.tracks.findIndex(t => t.id === demo.id);
      if (idx !== -1) {
        // Refresh existing demo track metadata and clear any stale blob cache
        this.tracks[idx] = { ...this.tracks[idx], ...demo, fileBlob: null };
        toSave.push(this.tracks[idx]);
      } else {
        this.tracks.push(demo);
        toSave.push(demo);
      }
    }

    if (toSave.length > 0) {
      await auraDB.saveTracks(toSave);
      this.updateLibraryUI();
      if (notify) this.showToast(`Loaded ${demos.length} audio format test tracks!`);
      this.prefetchSampleBlobs();
    }
  }

  // Pre-fetch sample audio into in-memory Blobs so playback on mobile is instant and offline
  async prefetchSampleBlobs() {
    for (const track of this.tracks) {
      if (track.url && !track.fileBlob) {
        try {
          const blob = await this.audioEngine.fetchAudioBlob(track.url);
          if (blob) {
            track.fileBlob = blob;
            await auraDB.saveTrack(track);
          }
        } catch (e) {
          console.warn('Background sample audio prefetch deferred for:', track.title, e);
        }
      }
    }
  }

  // --- UI Rendering ---

  updateLibraryUI() {
    this.filterAndRender();
    this.renderAlbums();
    this.renderArtists();
    this.renderPlaylists();
  }

  filterAndRender() {
    let list = [...this.tracks];

    // Search query filter
    if (this.searchQuery) {
      list = list.filter(t => 
        (t.title && t.title.toLowerCase().includes(this.searchQuery)) ||
        (t.artist && t.artist.toLowerCase().includes(this.searchQuery)) ||
        (t.album && t.album.toLowerCase().includes(this.searchQuery))
      );
    }

    // Category Filter Chips
    if (this.currentFilter === 'fav') {
      list = list.filter(t => t.isFavorite);
    } else if (this.currentFilter === 'recent') {
      list.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    }

    this.filteredTracks = list;
    this.renderTracks();

    // Stats
    const totalCount = this.tracks.length;
    this.dom.libraryStat.textContent = `${totalCount} local ${totalCount === 1 ? 'track' : 'tracks'}`;
    this.dom.tracksCountBadge.textContent = `${list.length} tracks`;

    // Show/hide empty state
    if (totalCount === 0) {
      this.dom.emptyState.style.display = 'flex';
      this.dom.tracksList.style.display = 'none';
    } else {
      this.dom.emptyState.style.display = 'none';
      this.dom.tracksList.style.display = 'flex';
    }
  }

  renderTracks() {
    this.dom.tracksList.innerHTML = '';

    if (this.filteredTracks.length === 0 && this.tracks.length > 0) {
      this.dom.tracksList.innerHTML = `<div style="text-align:center; padding:30px 10px; color:#64748b; font-size:13px;">No tracks match your search.</div>`;
      return;
    }

    this.filteredTracks.forEach((track, index) => {
      const isCur = this.currentTrack && this.currentTrack.id === track.id;
      const row = document.createElement('div');
      row.className = `track-item ${isCur ? 'is-playing' : ''}`;
      row.dataset.id = track.id;

      const coverSrc = this.getTrackArtwork(track);

      row.innerHTML = `
        <div class="track-artwork-thumb">
          <img src="${coverSrc}" alt="Artwork" loading="lazy">
          <div class="playing-wave-badge">
            <span></span><span></span><span></span>
          </div>
        </div>
        <div class="track-details-col">
          <div class="track-title">${this.escapeHTML(track.title)}</div>
          <div class="track-meta-row">
            <span class="track-artist">${this.escapeHTML(track.artist)}</span>
            <span class="track-meta-divider"></span>
            <span class="track-album">${this.escapeHTML(track.album || 'Unknown')}</span>
            <span class="track-format-tag">${track.format || 'MP3'}</span>
          </div>
        </div>
        <div class="track-right-col">
          <button class="track-fav-btn ${track.isFavorite ? 'is-favorited' : ''}" data-id="${track.id}" title="Favorite">
            <svg viewBox="0 0 24 24" fill="${track.isFavorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
            </svg>
          </button>
          <button class="track-add-pl-btn" data-id="${track.id}" title="Add to Playlist">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </button>
          <button class="track-del-btn" data-id="${track.id}" title="Remove track from library">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      `;

      const thumbImg = row.querySelector('.track-artwork-thumb img');
      if (thumbImg) {
        thumbImg.onerror = () => {
          thumbImg.onerror = null;
          const fallback = ID3Parser.generateProceduralCover(track.title, track.artist);
          thumbImg.src = fallback;
          track.pictureUrl = fallback;
        };
      }

      // Click to play
      row.addEventListener('click', (e) => {
        if (e.target.closest('.track-fav-btn') || e.target.closest('.track-add-pl-btn') || e.target.closest('.track-del-btn')) return;
        this.playTrack(index);
      });

      // Favorite toggle
      const favBtn = row.querySelector('.track-fav-btn');
      favBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleFavorite(track.id);
      });

      // Add to playlist
      const addPlBtn = row.querySelector('.track-add-pl-btn');
      if (addPlBtn) {
        addPlBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.openQuickAddToPlaylist(track);
        });
      }

      // Delete track
      const delBtn = row.querySelector('.track-del-btn');
      if (delBtn) {
        delBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const confirmed = await this.showConfirmModal({
            title: 'Remove Track',
            message: `Remove "${track.title}" from your music library?`,
            confirmText: 'Remove',
            cancelText: 'Cancel',
            isDanger: true
          });
          if (confirmed) {
            this.removeTrack(track.id);
          }
        });
      }

      this.dom.tracksList.appendChild(row);
    });
  }

  async removeTrack(trackId) {
    if (this.currentTrack && this.currentTrack.id === trackId) {
      this.clearCurrentlyLoadedTrack();
    }
    await auraDB.deleteTrack(trackId);
    this.tracks = this.tracks.filter(t => t.id !== trackId);
    this.updateLibraryUI();
    this.showToast('Track removed from library');
  }

  clearCurrentlyLoadedTrack() {
    // 1. Unload audio engine completely
    this.audioEngine.unload();
    this.currentTrack = null;
    this.currentIndex = -1;
    this.isPlaying = false;

    // 2. Hide and reset Mini Player
    this.dom.miniPlayer.style.display = 'none';
    this.dom.miniTitle.textContent = 'No track selected';
    this.dom.miniArtist.textContent = 'Aura Player';
    this.dom.miniProgress.style.width = '0%';
    this.dom.miniThumb.classList.remove('playing');
    this.dom.miniCoverImg.src = ID3Parser.generateProceduralCover('Aura', 'Music');

    // 3. Reset and close Full-screen Sheet Player
    this.closePlayerSheet();
    this.dom.sheetTitle.textContent = 'No track selected';
    this.dom.sheetArtist.textContent = 'Select a track to play';
    this.dom.vinylCoverImg.src = ID3Parser.generateProceduralCover('Aura', 'Music');
    this.dom.scrubProgress.style.width = '0%';
    this.dom.timeCurrent.textContent = '0:00';
    this.dom.timeTotal.textContent = '0:00';
    this.dom.vinylWrapper.classList.remove('playing');
    this.dom.sheetFavBtn.classList.remove('is-favorited');

    // 4. Reset play buttons to play icon
    this.handleStateChange(false);

    // 5. Clear Media Session API lock screen & notification controls
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = 'none';
    }

    // 6. Dismiss native Android notification
    if (this.pauseNotificationTimeout) {
      clearTimeout(this.pauseNotificationTimeout);
      this.pauseNotificationTimeout = null;
    }
    if (window.AndroidBridge && typeof window.AndroidBridge.hideNotification === 'function') {
      try {
        window.AndroidBridge.hideNotification();
      } catch (e) {
        console.warn('AndroidBridge.hideNotification error:', e);
      }
    }

    // 8. Stop sleep timer if active
    this.setSleepTimer(0);

    // 9. Clear playing item highlights
    this.updatePlayingItemHighlight();
  }

  renderAlbums() {
    const albumsMap = {};
    this.tracks.forEach(t => {
      const alb = t.album || 'Unknown Album';
      if (!albumsMap[alb]) {
        albumsMap[alb] = {
          name: alb,
          artist: t.artist || 'Unknown Artist',
          artwork: t.pictureUrl,
          tracks: []
        };
      }
      albumsMap[alb].tracks.push(t);
    });

    this.dom.albumsGrid.innerHTML = '';
    const albumsList = Object.values(albumsMap);

    if (albumsList.length === 0) {
      this.dom.albumsGrid.innerHTML = `<div style="grid-column: 1/-1; text-align:center; padding:30px; color:#64748b;">No albums in library.</div>`;
      return;
    }

    albumsList.forEach(album => {
      const card = document.createElement('div');
      card.className = 'album-card';
      const albumCover = album.artwork || ID3Parser.generateProceduralCover(album.name, album.artist);
      card.innerHTML = `
        <div class="album-cover-box">
          <img src="${albumCover}" alt="${this.escapeHTML(album.name)}" loading="lazy">
          <div class="album-play-overlay">
            <svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
          </div>
        </div>
        <div class="album-info-title">${this.escapeHTML(album.name)}</div>
        <div class="album-info-artist">${this.escapeHTML(album.artist)} • ${album.tracks.length} ${album.tracks.length === 1 ? 'track' : 'tracks'}</div>
      `;

      const albumImg = card.querySelector('.album-cover-box img');
      if (albumImg) {
        albumImg.onerror = () => {
          albumImg.onerror = null;
          albumImg.src = ID3Parser.generateProceduralCover(album.name, album.artist);
        };
      }

      card.addEventListener('click', () => {
        this.playAlbum(album.name, 0);
      });

      this.dom.albumsGrid.appendChild(card);
    });
  }

  renderArtists() {
    const artistsMap = {};
    this.tracks.forEach(t => {
      const art = t.artist || 'Unknown Artist';
      if (!artistsMap[art]) {
        artistsMap[art] = {
          name: art,
          count: 0,
          tracks: []
        };
      }
      artistsMap[art].count++;
      artistsMap[art].tracks.push(t);
    });

    this.dom.artistsList.innerHTML = '';
    const artistsList = Object.values(artistsMap);

    if (artistsList.length === 0) {
      this.dom.artistsList.innerHTML = `<div style="text-align:center; padding:30px; color:#64748b;">No artists found.</div>`;
      return;
    }

    artistsList.forEach(artist => {
      const row = document.createElement('div');
      row.className = 'artist-row';
      const initials = artist.name.slice(0, 2).toUpperCase();
      row.innerHTML = `
        <div class="artist-avatar">${initials}</div>
        <div class="artist-meta">
          <h4>${this.escapeHTML(artist.name)}</h4>
          <p>${artist.count} ${artist.count === 1 ? 'track' : 'tracks'}</p>
        </div>
      `;
      row.addEventListener('click', () => {
        // Filter track view to this artist
        this.dom.searchBar.value = artist.name;
        this.searchQuery = artist.name.toLowerCase();
        this.dom.searchClear.style.display = 'block';
        this.switchView('tracks');
        this.filterAndRender();
      });
      this.dom.artistsList.appendChild(row);
    });
  }

  async renderPlaylists() {
    // Smart Playlists
    const favoritesCount = this.tracks.filter(t => t.isFavorite).length;
    this.dom.playlistsList.innerHTML = `
      <div class="playlist-card" id="playlist-favorites-btn">
        <div class="playlist-icon-square">
          <svg viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
        </div>
        <div class="playlist-info">
          <h4>Favorite Songs</h4>
          <p>${favoritesCount} liked ${favoritesCount === 1 ? 'song' : 'songs'}</p>
        </div>
      </div>
    `;

    document.getElementById('playlist-favorites-btn').addEventListener('click', () => {
      this.playFavorites(0);
    });

    try {
      const customPlaylists = await auraDB.getAllPlaylists();
      customPlaylists.forEach(pl => {
        const card = document.createElement('div');
        card.className = 'playlist-card';
        const count = (pl.trackIds || []).length;
        card.innerHTML = `
          <div class="playlist-icon-square" style="background:linear-gradient(135deg, #00f2fe 0%, #4facfe 100%);">
            <svg viewBox="0 0 24 24"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
          </div>
          <div class="playlist-info" style="flex:1;">
            <h4>${this.escapeHTML(pl.name)}</h4>
            <p>${count} ${count === 1 ? 'song' : 'songs'}</p>
          </div>
          <button class="mini-btn delete-pl-btn" style="color:#64748b; padding:8px;" title="Delete Playlist">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
          </button>
        `;

        // Clicking the playlist card opens the Playlist Detail / Song Management View
        card.addEventListener('click', (e) => {
          if (e.target.closest('.delete-pl-btn')) return;
          this.openPlaylistDetail(pl.id);
        });

        card.querySelector('.delete-pl-btn').addEventListener('click', async (e) => {
          e.stopPropagation();
          const confirmed = await this.showConfirmModal({
            title: 'Delete Playlist',
            message: `Are you sure you want to delete playlist "${pl.name}"? The songs will remain safely in your music library.`,
            confirmText: 'Delete',
            cancelText: 'Cancel',
            isDanger: true
          });
          if (confirmed) {
            await auraDB.deletePlaylist(pl.id);
            this.renderPlaylists();
            this.showToast(`Deleted "${pl.name}"`);
          }
        });

        this.dom.playlistsList.appendChild(card);
      });
    } catch (e) {
      console.warn('Error loading custom playlists:', e);
    }
  }

  // --- Playlist Detail & Song Management Methods ---

  async openPlaylistDetail(playlistId) {
    try {
      const customPlaylists = await auraDB.getAllPlaylists();
      const pl = customPlaylists.find(p => p.id === playlistId);
      if (!pl) return;
      this.currentEditingPlaylist = pl;

      const titleEl = document.getElementById('playlist-detail-title');
      const metaEl = document.getElementById('playlist-detail-meta');
      const listEl = document.getElementById('playlist-songs-list');
      const modal = this.dom.playlistDetailModal;

      if (titleEl) titleEl.textContent = pl.name;

      const trackIdSet = new Set(pl.trackIds || []);
      const plTracks = this.tracks.filter(t => trackIdSet.has(t.id));

      if (metaEl) {
        const totalSec = plTracks.reduce((acc, t) => acc + (t.duration || 0), 0);
        const mins = Math.round(totalSec / 60);
        metaEl.textContent = `${plTracks.length} ${plTracks.length === 1 ? 'song' : 'songs'} • ${mins} min${mins === 1 ? '' : 's'}`;
      }

      if (listEl) {
        listEl.innerHTML = '';
        if (plTracks.length === 0) {
          listEl.innerHTML = `
            <div class="playlist-empty-state">
              <div class="playlist-empty-icon">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              </div>
              <strong style="color:#fff; font-size:15px;">Playlist is Empty</strong>
              <p style="font-size:12px; margin:0; max-width:240px;">Add songs from your local music library to start listening to "${this.escapeHTML(pl.name)}".</p>
              <button class="primary-action-btn" id="playlist-empty-add-btn" style="margin-top:10px; padding:10px 20px; font-size:13px;">+ Add Songs Now</button>
            </div>
          `;
          const emptyAddBtn = listEl.querySelector('#playlist-empty-add-btn');
          if (emptyAddBtn) {
            emptyAddBtn.addEventListener('click', () => {
              this.openAddSongsModal(this.currentEditingPlaylist);
            });
          }
        } else {
          plTracks.forEach((track, index) => {
            const isPlaying = this.currentTrack && this.currentTrack.id === track.id;
            const row = document.createElement('div');
            row.className = `playlist-song-row ${isPlaying ? 'is-playing' : ''}`;
            const cover = this.getTrackArtwork(track);

            row.innerHTML = `
              <div class="playlist-song-thumb">
                <img src="${cover}" alt="Art" loading="lazy">
              </div>
              <div class="playlist-song-meta">
                <div class="playlist-song-title">${this.escapeHTML(track.title)}</div>
                <div class="playlist-song-artist">${this.escapeHTML(track.artist)} • ${this.formatTime(track.duration || 0)}</div>
              </div>
              <button class="playlist-song-remove-btn" title="Remove song from playlist">
                &times;
              </button>
            `;

            const img = row.querySelector('img');
            if (img) {
              img.onerror = () => {
                img.onerror = null;
                img.src = ID3Parser.generateProceduralCover(track.title, track.artist);
              };
            }

            // Click row to play starting at this song in this playlist context
            row.addEventListener('click', (e) => {
              if (e.target.closest('.playlist-song-remove-btn')) return;
              this.playPlaylist(pl.name, pl.trackIds || [], index);
            });

            // Click remove button to remove this track from playlist
            const rmBtn = row.querySelector('.playlist-song-remove-btn');
            rmBtn.addEventListener('click', async (e) => {
              e.stopPropagation();
              await this.removeSongFromPlaylist(pl.id, track.id);
            });

            listEl.appendChild(row);
          });
        }
      }

      this.openModal(modal);
    } catch (e) {
      console.warn('Error opening playlist detail:', e);
    }
  }

  async removeSongFromPlaylist(playlistId, trackId) {
    try {
      const customPlaylists = await auraDB.getAllPlaylists();
      const pl = customPlaylists.find(p => p.id === playlistId);
      if (!pl) return;

      pl.trackIds = (pl.trackIds || []).filter(id => id !== trackId);
      await auraDB.savePlaylist(pl);
      this.currentEditingPlaylist = pl;

      this.renderPlaylists();
      await this.openPlaylistDetail(playlistId);
      this.showToast(`Removed song from "${pl.name}"`);
    } catch (e) {
      console.warn('Error removing song from playlist:', e);
    }
  }

  openAddSongsModal(playlist) {
    if (!playlist) return;
    this.currentEditingPlaylist = playlist;
    const modal = this.dom.playlistAddSongsModal;
    const subtextEl = document.getElementById('add-songs-playlist-subtext');
    const searchInput = document.getElementById('add-songs-search-input');
    const countEl = document.getElementById('add-songs-selected-count');
    const listEl = document.getElementById('add-songs-scroll-list');

    if (subtextEl) subtextEl.textContent = `Adding to "${playlist.name}"`;
    if (searchInput) searchInput.value = '';

    const alreadyInSet = new Set(playlist.trackIds || []);
    this.selectedAddSongIds = new Set();

    const renderList = (filterText = '') => {
      if (!listEl) return;
      listEl.innerHTML = '';
      const query = filterText.toLowerCase().trim();

      const availableTracks = this.tracks.filter(t => {
        if (!query) return true;
        const title = (t.title || '').toLowerCase();
        const artist = (t.artist || '').toLowerCase();
        const album = (t.album || '').toLowerCase();
        return title.includes(query) || artist.includes(query) || album.includes(query);
      });

      if (availableTracks.length === 0) {
        listEl.innerHTML = `<div style="text-align:center; padding:30px; color:#8fa0be; font-size:13px;">No matching songs found in library.</div>`;
        return;
      }

      availableTracks.forEach(track => {
        const isAlreadyIn = alreadyInSet.has(track.id);
        const isSelected = this.selectedAddSongIds.has(track.id);
        const row = document.createElement('div');
        row.className = `add-song-selectable-row ${isSelected ? 'is-selected' : ''} ${isAlreadyIn ? 'is-already-in' : ''}`;
        row.dataset.id = track.id;
        const cover = this.getTrackArtwork(track);

        row.innerHTML = `
          <div class="add-song-checkbox-circle">${isAlreadyIn ? '✓' : (isSelected ? '✓' : '')}</div>
          <div class="playlist-song-thumb">
            <img src="${cover}" alt="Art" loading="lazy">
          </div>
          <div class="playlist-song-meta">
            <div class="playlist-song-title">${this.escapeHTML(track.title)}</div>
            <div class="playlist-song-artist">${this.escapeHTML(track.artist)} ${isAlreadyIn ? '• <span style="color:var(--cyan-bright); font-weight:700;">Already in playlist</span>' : ''}</div>
          </div>
        `;

        const img = row.querySelector('img');
        if (img) {
          img.onerror = () => {
            img.onerror = null;
            img.src = ID3Parser.generateProceduralCover(track.title, track.artist);
          };
        }

        if (!isAlreadyIn) {
          row.addEventListener('click', () => {
            if (this.selectedAddSongIds.has(track.id)) {
              this.selectedAddSongIds.delete(track.id);
            } else {
              this.selectedAddSongIds.add(track.id);
            }
            updateSelection();
          });
        }

        listEl.appendChild(row);
      });
    };

    const updateSelection = () => {
      const cnt = this.selectedAddSongIds.size;
      if (countEl) countEl.textContent = `${cnt} selected`;
      if (listEl) {
        const rows = listEl.querySelectorAll('.add-song-selectable-row');
        rows.forEach(r => {
          const id = r.dataset.id;
          if (id && !alreadyInSet.has(id)) {
            const isSel = this.selectedAddSongIds.has(id);
            r.classList.toggle('is-selected', isSel);
            const circle = r.querySelector('.add-song-checkbox-circle');
            if (circle) circle.textContent = isSel ? '✓' : '';
          }
        });
      }
    };

    const searchClear = document.getElementById('add-songs-search-clear');
    if (searchClear) {
      searchClear.style.display = 'none';
      searchClear.onclick = () => {
        if (searchInput) {
          searchInput.value = '';
          searchInput.focus();
        }
        searchClear.style.display = 'none';
        renderList('');
        updateSelection();
      };
    }

    if (searchInput) {
      searchInput.oninput = () => {
        if (searchClear) {
          searchClear.style.display = searchInput.value ? 'block' : 'none';
        }
        renderList(searchInput.value);
        updateSelection();
      };
    }

    const toggleAllBtn = document.getElementById('add-songs-toggle-all-btn');
    if (toggleAllBtn) {
      toggleAllBtn.onclick = () => {
        const eligible = this.tracks.filter(t => !alreadyInSet.has(t.id));
        if (this.selectedAddSongIds.size === eligible.length) {
          this.selectedAddSongIds.clear();
          toggleAllBtn.textContent = 'Select All';
        } else {
          eligible.forEach(t => this.selectedAddSongIds.add(t.id));
          toggleAllBtn.textContent = 'Deselect All';
        }
        updateSelection();
      };
    }

    renderList();
    updateSelection();
    this.openModal(modal);
  }

  async addSelectedSongsToPlaylist() {
    if (!this.currentEditingPlaylist) return;
    const pl = this.currentEditingPlaylist;
    const selected = Array.from(this.selectedAddSongIds || []);
    if (selected.length === 0) {
      this.showToast('No new songs selected.');
      return;
    }

    const existingSet = new Set(pl.trackIds || []);
    selected.forEach(id => existingSet.add(id));
    pl.trackIds = Array.from(existingSet);

    await auraDB.savePlaylist(pl);
    this.closeModal(this.dom.playlistAddSongsModal);
    this.renderPlaylists();
    await this.openPlaylistDetail(pl.id);
    this.showToast(`Added ${selected.length} ${selected.length === 1 ? 'song' : 'songs'} to "${pl.name}"!`);
  }

  async openQuickAddToPlaylist(track) {
    if (!track) return;
    const modal = this.dom.trackAddToPlaylistModal;
    const titleEl = document.getElementById('quick-add-track-title');
    const listEl = document.getElementById('quick-add-playlists-list');

    if (titleEl) titleEl.textContent = track.title;

    try {
      const customPlaylists = await auraDB.getAllPlaylists();
      if (listEl) {
        listEl.innerHTML = '';
        if (customPlaylists.length === 0) {
          listEl.innerHTML = `<div style="text-align:center; padding:20px; color:#8fa0be; font-size:12.5px;">No custom playlists created yet.<br>Create one below!</div>`;
        } else {
          customPlaylists.forEach(pl => {
            const hasTrack = (pl.trackIds || []).includes(track.id);
            const row = document.createElement('div');
            row.className = `quick-add-pl-item ${hasTrack ? 'has-track' : ''}`;
            row.innerHTML = `
              <div style="display:flex; align-items:center; gap:10px; min-width:0;">
                <span style="font-size:18px;">${hasTrack ? '✅' : '📁'}</span>
                <div>
                  <div style="font-size:13.5px; font-weight:700; color:#fff;">${this.escapeHTML(pl.name)}</div>
                  <div style="font-size:11px; color:#8fa0be;">${(pl.trackIds || []).length} songs</div>
                </div>
              </div>
              <span style="font-size:12px; font-weight:700; color:${hasTrack ? 'var(--cyan-bright)' : '#94a3b8'};">
                ${hasTrack ? 'In Playlist' : '+ Add'}
              </span>
            `;

            row.addEventListener('click', async () => {
              const currentIds = new Set(pl.trackIds || []);
              if (currentIds.has(track.id)) {
                currentIds.delete(track.id);
                pl.trackIds = Array.from(currentIds);
                await auraDB.savePlaylist(pl);
                this.renderPlaylists();
                this.closeModal(modal);
                this.showToast(`Removed "${track.title}" from "${pl.name}"`);
              } else {
                currentIds.add(track.id);
                pl.trackIds = Array.from(currentIds);
                await auraDB.savePlaylist(pl);
                this.renderPlaylists();
                this.closeModal(modal);
                this.showToast(`Added "${track.title}" to "${pl.name}"!`);
              }
            });

            listEl.appendChild(row);
          });
        }
      }

      this.openModal(modal);
    } catch (e) {
      console.warn('Error opening quick add to playlist:', e);
    }
  }

  // --- Playback Management & Loop Context Engine ---

  get repeatMode() {
    return this.loopMode;
  }

  set repeatMode(val) {
    this.loopMode = val;
  }

  getPlaybackQueue() {
    if (this.loopMode === 'album') {
      if (this.currentContext && this.currentContext.type === 'album' && this.currentContext.tracks && this.currentContext.tracks.length > 0) {
        return this.currentContext.tracks;
      }
      if (this.currentTrack) {
        const alb = this.currentTrack.album || 'Unknown Album';
        const albTracks = this.tracks.filter(t => (t.album || 'Unknown Album') === alb);
        if (albTracks.length > 0) return albTracks;
      }
    } else if (this.loopMode === 'playlist') {
      if (this.currentContext && this.currentContext.type === 'playlist' && this.currentContext.tracks && this.currentContext.tracks.length > 0) {
        return this.currentContext.tracks;
      }
      const favs = this.tracks.filter(t => t.isFavorite);
      if (favs.length > 0) return favs;
    } else if (this.loopMode === 'library') {
      if (this.tracks.length > 0) return this.tracks;
    }

    if (this.filteredTracks && this.filteredTracks.length > 0) {
      return this.filteredTracks;
    }
    return this.tracks;
  }

  async playTrack(indexOrTrack, customQueue = null) {
    const queue = customQueue || this.getPlaybackQueue();
    if (!queue || queue.length === 0) return;

    let track;
    let index;

    if (typeof indexOrTrack === 'object' && indexOrTrack !== null) {
      track = indexOrTrack;
      index = queue.findIndex(t => t.id === track.id);
      if (index === -1) index = 0;
    } else {
      index = indexOrTrack;
      if (index < 0 || index >= queue.length) return;
      track = queue[index];
    }

    this.currentIndex = index;
    this.currentTrack = track;
    this.filteredTracks = queue;

    // Immediately wake AudioContext while user gesture is active
    this.audioEngine.resumeContext();

    try {
      this.audioEngine.isChangingTrack = true;
      await this.audioEngine.loadTrack(track);
      await this.audioEngine.play();
      this.audioEngine.isChangingTrack = false;
      this._consecutivePlayErrors = 0;
      this.updateNowPlayingUI();
      this.updateLoopUI();
      this.updatePlayingItemHighlight();
      auraDB.incrementPlayCount(track.id);
      this.updateMediaSessionMetadata(track);
    } catch (e) {
      this.audioEngine.isChangingTrack = false;
      console.warn('Playback error for track:', track.title, e);
      this.handlePlaybackFailure(track, queue);
    }
  }

  handlePlaybackError(e) {
    const errCode = this.audioEngine.audio.error ? this.audioEngine.audio.error.code : 'unknown';
    const errMsg = this.audioEngine.audio.error ? this.audioEngine.audio.error.message : '';
    console.warn(`Runtime audio playback error (code ${errCode}: ${errMsg}):`, e);

    if (window.auraDiagnostics) {
      window.auraDiagnostics.error('AUDIO', `Playback error: code=${errCode} message="${errMsg}" (cur=${this.audioEngine.audio.currentTime ? this.audioEngine.audio.currentTime.toFixed(1) : 0}s)`);
    }

    // If runtime error happened on a stream URL and local fileBlob is available, fall back to blob!
    if (this.currentTrack && this.currentTrack.fileBlob && this.audioEngine.audio.src && !this.audioEngine.audio.src.startsWith('blob:')) {
      console.log('Stream URL error, falling back to local fileBlob...');
      if (window.auraDiagnostics) {
        window.auraDiagnostics.warn('STREAM', 'Falling back from stream URL to local in-memory fileBlob');
      }
      const blob = this.audioEngine.normalizeAudioBlob(this.currentTrack.fileBlob, this.currentTrack.format, this.currentTrack.title);
      this.currentTrack.fileBlob = blob;
      const blobUrl = URL.createObjectURL(blob);
      const currentTime = this.audioEngine.audio.currentTime || 0;
      this.audioEngine.audio.src = blobUrl;
      this.audioEngine.audio.currentTime = currentTime;
      this.audioEngine.audio.play().catch(playErr => {
        this.handlePlaybackFailure(this.currentTrack, this.getPlaybackQueue());
      });
      return;
    }
    if (this.currentTrack) {
      this.handlePlaybackFailure(this.currentTrack, this.getPlaybackQueue());
    }
  }

  handlePlaybackFailure(failedTrack, queue) {
    this._consecutivePlayErrors = (this._consecutivePlayErrors || 0) + 1;

    const trackName = failedTrack ? (failedTrack.title || 'Track') : 'Track';
    console.warn(`[Aura] Playback failure #${this._consecutivePlayErrors} for "${trackName}"`);

    // If every track in the current queue has failed, stop to avoid an infinite loop
    const maxErrors = queue ? queue.length : (this.tracks.length || 1);
    if (this._consecutivePlayErrors >= maxErrors) {
      this._consecutivePlayErrors = 0;
      this.showToast(`Unable to play any tracks in the current queue.`);
      this.audioEngine.unload();
      this.updateNowPlayingUI();
      return;
    }

    this.showToast(`Cannot play "${trackName}". Continuing to next...`);

    // Auto-advance smoothly to the next track so player doesn't pause or get stuck
    if (this._autoSkipTimeout) clearTimeout(this._autoSkipTimeout);
    this._autoSkipTimeout = setTimeout(() => {
      this.playNext(false);
    }, 400);
  }

  togglePlayPause() {
    if (!this.currentTrack && this.filteredTracks.length > 0) {
      this.playTrack(0);
      return;
    }
    if (this.audioEngine.audio.paused) {
      this.audioEngine.play().catch(e => console.warn(e));
    } else {
      this.audioEngine.pause();
    }
  }

  playNext(fromTrackEnd = false) {
    const queue = this.getPlaybackQueue();
    if (!queue || queue.length === 0) return;

    // 1. Single Track Loop
    if (fromTrackEnd && (this.loopMode === 'track' || this.loopMode === 'one')) {
      this.audioEngine.seek(0);
      this.audioEngine.play();
      return;
    }

    // 2. Find current track in this queue
    let curIdx = -1;
    if (this.currentTrack) {
      curIdx = queue.findIndex(t => t.id === this.currentTrack.id);
    }
    if (curIdx === -1) curIdx = this.currentIndex;

    let nextIdx;
    if (this.isShuffled) {
      if (queue.length > 1) {
        do {
          nextIdx = Math.floor(Math.random() * queue.length);
        } while (nextIdx === curIdx && queue.length > 1);
      } else {
        nextIdx = 0;
      }
    } else {
      nextIdx = curIdx + 1;
    }

    // 3. Handle end of queue
    if (nextIdx >= queue.length) {
      if (fromTrackEnd && this.loopMode === 'none') {
        this.audioEngine.pause();
        this.audioEngine.seek(0);
        this.showToast('Playback ended (Loop Off)');
        return;
      }
      nextIdx = 0; // Wrap around (loops album, playlist, or library)
    }

    this.playTrack(nextIdx, queue);
  }

  playPrev() {
    const queue = this.getPlaybackQueue();
    if (!queue || queue.length === 0) return;

    // If more than 3 seconds into track, restart it
    if (this.audioEngine.audio.currentTime > 3) {
      this.audioEngine.seek(0);
      return;
    }

    let curIdx = -1;
    if (this.currentTrack) {
      curIdx = queue.findIndex(t => t.id === this.currentTrack.id);
    }
    if (curIdx === -1) curIdx = this.currentIndex;

    let prevIdx = curIdx - 1;
    if (prevIdx < 0) {
      prevIdx = queue.length - 1;
    }

    this.playTrack(prevIdx, queue);
  }

  playNextTrack() {
    this.playNext();
  }

  playPreviousTrack() {
    this.playPrev();
  }

  handleTrackEnd() {
    this.audioEngine.isChangingTrack = true;
    if (this.loopMode === 'track' || this.loopMode === 'one') {
      this.audioEngine.seek(0);
      this.audioEngine.play().catch(() => {});
    } else {
      this.playNext(true);
    }
  }

  setLoopMode(mode) {
    if (mode === 'all') mode = 'library';
    if (mode === 'one') mode = 'track';
    this.loopMode = mode;

    this.updateLoopUI();
    this.updateLoopModalDetails();

    const albName = this.currentTrack ? (this.currentTrack.album || 'Album') : 'Album';
    const plName = (this.currentContext && this.currentContext.name) ? this.currentContext.name : 'Favorites';

    switch (mode) {
      case 'track':
        this.showToast('Loop: Current Track (Song Repeat 🔂)');
        break;
      case 'album':
        this.showToast(`Loop: Album ("${albName}" 💽)`);
        break;
      case 'playlist':
        this.showToast(`Loop: Playlist (${plName} ❤️)`);
        break;
      case 'library':
        this.showToast('Loop: Library Songs (All Tracks 🎵)');
        break;
      case 'none':
        this.showToast('Loop: OFF (Playback stops at end 🚫)');
        break;
    }
  }

  getAvailableLoopModes() {
    const modes = ['library', 'track'];
    const hasAlbum = this.currentTrack && this.currentTrack.album && 
      this.currentTrack.album !== 'Unknown Album' && 
      this.currentTrack.album !== 'Single' && 
      this.currentTrack.album.trim() !== '';
    const isPlaylist = (this.currentContext && this.currentContext.type === 'playlist') || this.currentFilter === 'fav';

    if (hasAlbum) {
      modes.push('album');
    }
    if (isPlaylist) {
      modes.push('playlist');
    }
    modes.push('none');
    return modes;
  }

  cycleLoopMode() {
    const modes = this.getAvailableLoopModes();
    let current = this.loopMode;
    if (current === 'all') current = 'library';
    if (current === 'one') current = 'track';

    const curIndex = modes.indexOf(current);
    const nextIndex = (curIndex === -1) ? 0 : ((curIndex + 1) % modes.length);
    const nextMode = modes[nextIndex];

    this.setLoopMode(nextMode);
  }

  updateLoopUI() {
    const mode = this.loopMode;
    const albName = this.currentTrack ? (this.currentTrack.album || 'Album') : 'Album';
    const plName = (this.currentContext && this.currentContext.name) ? this.currentContext.name : 'Favorites';

    const svgRepeat = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>`;
    const svgRepeatOne = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/><text x="12" y="14" font-size="7" font-weight="900" fill="currentColor" text-anchor="middle">1</text></svg>`;
    const svgRepeatAlbum = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/><text x="12" y="14" font-size="6" font-weight="900" fill="currentColor" text-anchor="middle">ALB</text></svg>`;
    const svgRepeatPlaylist = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/><text x="12" y="14" font-size="6" font-weight="900" fill="currentColor" text-anchor="middle">PL</text></svg>`;
    const svgRepeatOff = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/><line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" stroke-width="2"/></svg>`;

    const isActive = mode !== 'none';

    // 1. Player Sheet Repeat Button (Song view player)
    if (this.dom.btnRepeat) {
      this.dom.btnRepeat.classList.toggle('active', isActive);
      if (mode === 'track') {
        this.dom.btnRepeat.innerHTML = svgRepeatOne;
        this.dom.btnRepeat.title = 'Loop: Current Track (Click to cycle)';
      } else if (mode === 'album') {
        this.dom.btnRepeat.innerHTML = svgRepeatAlbum;
        this.dom.btnRepeat.title = `Loop: Album ("${albName}")`;
      } else if (mode === 'playlist') {
        this.dom.btnRepeat.innerHTML = svgRepeatPlaylist;
        this.dom.btnRepeat.title = `Loop: Playlist (${plName})`;
      } else if (mode === 'library') {
        this.dom.btnRepeat.innerHTML = svgRepeat;
        this.dom.btnRepeat.title = 'Loop: Library Songs';
      } else {
        this.dom.btnRepeat.innerHTML = svgRepeatOff;
        this.dom.btnRepeat.title = 'Loop: OFF (Play queue once)';
      }
    }

    // 2. Loop Badge in Sheet
    if (this.dom.sheetLoopBadge && this.dom.sheetLoopText) {
      if (mode === 'track') {
        this.dom.sheetLoopIcon.textContent = '🔂';
        this.dom.sheetLoopText.textContent = 'Loop: Current Song';
      } else if (mode === 'album') {
        this.dom.sheetLoopIcon.textContent = '💽';
        this.dom.sheetLoopText.textContent = `Loop: Album (${albName})`;
      } else if (mode === 'playlist') {
        this.dom.sheetLoopIcon.textContent = '❤️';
        this.dom.sheetLoopText.textContent = `Loop: ${plName}`;
      } else if (mode === 'library') {
        this.dom.sheetLoopIcon.textContent = '🎵';
        this.dom.sheetLoopText.textContent = 'Loop: Library Songs';
      } else {
        this.dom.sheetLoopIcon.textContent = '🚫';
        this.dom.sheetLoopText.textContent = 'Loop: Off';
      }
    }

    // 3. Mini Player Loop Button (Main player)
    if (this.dom.miniLoopBtn) {
      this.dom.miniLoopBtn.classList.toggle('active', isActive);
      if (mode === 'track') {
        this.dom.miniLoopBtn.innerHTML = svgRepeatOne;
        this.dom.miniLoopBtn.title = 'Loop: Current Track';
      } else if (mode === 'album') {
        this.dom.miniLoopBtn.innerHTML = svgRepeatAlbum;
        this.dom.miniLoopBtn.title = `Loop: Album ("${albName}")`;
      } else if (mode === 'playlist') {
        this.dom.miniLoopBtn.innerHTML = svgRepeatPlaylist;
        this.dom.miniLoopBtn.title = `Loop: Playlist (${plName})`;
      } else if (mode === 'library') {
        this.dom.miniLoopBtn.innerHTML = svgRepeat;
        this.dom.miniLoopBtn.title = 'Loop: Library Songs';
      } else {
        this.dom.miniLoopBtn.innerHTML = svgRepeatOff;
        this.dom.miniLoopBtn.title = 'Loop: OFF';
      }
    }
  }

  updateLoopModalDetails() {
    const albName = this.currentTrack ? (this.currentTrack.album || 'Unknown Album') : 'Unknown Album';
    const plName = (this.currentContext && this.currentContext.name) ? this.currentContext.name : 'Favorites';

    if (this.dom.loopAlbumTitle) {
      this.dom.loopAlbumTitle.textContent = `Loop Current Album (${albName})`;
    }
    if (this.dom.loopAlbumDesc) {
      this.dom.loopAlbumDesc.textContent = `Repeat all tracks from "${albName}"`;
    }
    if (this.dom.loopPlTitle) {
      this.dom.loopPlTitle.textContent = `Loop Playlist / Favorites (${plName})`;
    }
    if (this.dom.loopPlDesc) {
      this.dom.loopPlDesc.textContent = `Repeat all tracks in ${plName}`;
    }

    if (this.dom.loopOptCards) {
      this.dom.loopOptCards.forEach(card => {
        card.classList.toggle('active', card.dataset.mode === this.loopMode);
      });
    }
  }

  playAlbum(albumName, trackIdx = 0) {
    const albumTracks = this.tracks.filter(t => (t.album || 'Unknown Album') === albumName);
    if (!albumTracks || albumTracks.length === 0) return;

    this.currentContext = {
      type: 'album',
      name: albumName,
      tracks: albumTracks
    };
    this.filteredTracks = albumTracks;
    if (this.loopMode !== 'track') {
      this.loopMode = 'album';
    }
    this.playTrack(trackIdx, albumTracks);
    this.openPlayerSheet();
    this.updateLoopUI();
    this.showToast(`Looping Album: "${albumName}" (${albumTracks.length} tracks)`);
  }

  playFavorites(trackIdx = 0) {
    const favTracks = this.tracks.filter(t => t.isFavorite);
    if (!favTracks || favTracks.length === 0) {
      this.showToast('No favorite tracks yet. Tap ❤️ on any song to add!');
      return;
    }

    this.currentContext = {
      type: 'playlist',
      name: 'Favorites',
      tracks: favTracks
    };
    this.filteredTracks = favTracks;
    if (this.loopMode !== 'track') {
      this.loopMode = 'playlist';
    }
    this.playTrack(trackIdx, favTracks);
    this.openPlayerSheet();
    this.updateLoopUI();
    this.showToast(`Looping Favorites Playlist (${favTracks.length} songs)`);
  }

  playPlaylist(playlistName, trackIds, trackIdx = 0) {
    const idSet = new Set(trackIds || []);
    const plTracks = this.tracks.filter(t => idSet.has(t.id));
    if (!plTracks || plTracks.length === 0) {
      this.showToast(`Playlist "${playlistName}" has no tracks.`);
      return;
    }

    this.currentContext = {
      type: 'playlist',
      name: playlistName,
      tracks: plTracks
    };
    this.filteredTracks = plTracks;
    if (this.loopMode !== 'track') {
      this.loopMode = 'playlist';
    }
    this.playTrack(trackIdx, plTracks);
    this.openPlayerSheet();
    this.updateLoopUI();
    this.showToast(`Looping Playlist: "${playlistName}" (${plTracks.length} songs)`);
  }

  handleStateChange(isPlaying) {
    this.isPlaying = isPlaying;

    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    }

    // Toggle icons for main play button
    const playSvg = `<svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
    const pauseSvg = `<svg viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>`;
    
    this.dom.btnMainPlay.innerHTML = isPlaying ? pauseSvg : playSvg;
    this.dom.miniPlayBtn.innerHTML = isPlaying ? pauseSvg : playSvg;

    // Spinning vinyl animation toggle
    this.dom.miniThumb.classList.toggle('playing', isPlaying);
    this.dom.vinylWrapper.classList.toggle('playing', isPlaying);

    this.updatePlayingItemHighlight();

    this.syncNotificationState(this.currentTrack, isPlaying);
  }

  syncNotificationState(track, isPlaying) {
    if (this.pauseNotificationTimeout) {
      clearTimeout(this.pauseNotificationTimeout);
      this.pauseNotificationTimeout = null;
    }

    if (!track) {
      if (window.AndroidBridge && typeof window.AndroidBridge.hideNotification === 'function') {
        try { window.AndroidBridge.hideNotification(); } catch (e) {}
      }
      return;
    }

    // If audio engine is actively transitioning between tracks, do NOT send a paused notification
    if (!isPlaying && this.audioEngine && this.audioEngine.isChangingTrack) {
      return;
    }

    // Sync Android native notification state (true = playing with Pause action, false = paused with Play action)
    if (window.AndroidBridge && typeof window.AndroidBridge.updateNotification === 'function') {
      try {
        window.AndroidBridge.updateNotification(
          track.title,
          track.artist,
          track.album || 'Local Music',
          isPlaying
        );
      } catch (e) {
        console.warn('AndroidBridge.updateNotification error:', e);
      }
    }
  }

  handleTimeUpdate(current, duration) {
    if (this.isScrubbing) return; // Prevent rubber-banding while user is actively sliding
    if (!duration || isNaN(duration)) return;
    const pct = (current / duration) * 100;
    
    this.dom.miniProgress.style.width = `${pct}%`;
    this.dom.scrubProgress.style.width = `${pct}%`;

    this.dom.timeCurrent.textContent = this.formatTime(current);
    this.dom.timeTotal.textContent = this.formatTime(duration);
  }

  updateNowPlayingUI() {
    const t = this.currentTrack;
    if (!t) return;

    const cover = this.getTrackArtwork(t);
    const fallback = ID3Parser.generateProceduralCover(t.title, t.artist);

    // Mini Player
    this.dom.miniCoverImg.onerror = () => {
      this.dom.miniCoverImg.onerror = null;
      this.dom.miniCoverImg.src = fallback;
    };
    this.dom.miniCoverImg.src = cover;
    this.dom.miniTitle.textContent = t.title;
    this.dom.miniArtist.textContent = t.artist;
    this.dom.miniPlayer.style.display = 'flex';

    // Android native system notification
    this.syncNotificationState(t, this.isPlaying);

    // Full Sheet Player
    this.dom.vinylCoverImg.onerror = () => {
      this.dom.vinylCoverImg.onerror = null;
      this.dom.vinylCoverImg.src = fallback;
    };
    this.dom.vinylCoverImg.src = cover;
    this.dom.sheetTitle.textContent = t.title;
    this.dom.sheetArtist.textContent = `${t.artist} — ${t.album || 'Single'}`;
    this.dom.sheetFavBtn.classList.toggle('is-favorited', !!t.isFavorite);
    this.dom.sheetFavBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="${t.isFavorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
      </svg>
    `;

    this.dom.sheetFavBtn.onclick = () => this.toggleFavorite(t.id);
  }

  updatePlayingItemHighlight() {
    document.querySelectorAll('.track-item').forEach(item => {
      const isCur = this.currentTrack && item.dataset.id === this.currentTrack.id;
      item.classList.toggle('is-playing', isCur);
    });
  }

  async toggleFavorite(trackId) {
    const track = this.tracks.find(t => t.id === trackId);
    if (!track) return;

    track.isFavorite = !track.isFavorite;
    await auraDB.updateTrackFavorite(track.id, track.isFavorite);

    if (this.currentTrack && this.currentTrack.id === track.id) {
      this.currentTrack.isFavorite = track.isFavorite;
      this.dom.sheetFavBtn.classList.toggle('is-favorited', track.isFavorite);
      this.dom.sheetFavBtn.querySelector('svg').setAttribute('fill', track.isFavorite ? 'currentColor' : 'none');
    }

    this.filterAndRender();
    this.renderPlaylists();
    this.showToast(track.isFavorite ? 'Added to Favorites ❤️' : 'Removed from Favorites');
  }

  // --- Views Navigation ---

  switchView(viewName) {
    this.activeView = viewName;
    this.dom.navButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === viewName);
    });

    this.dom.viewSections.forEach(sec => {
      sec.classList.toggle('active-view', sec.id === `view-${viewName}`);
    });
  }

  openPlayerSheet() {
    this.dom.playerSheet.classList.add('open');
  }

  closePlayerSheet() {
    this.dom.playerSheet.classList.remove('open');
  }

  openModal(modal) {
    modal.classList.add('open');
  }

  closeModal(modal) {
    modal.classList.remove('open');
  }

  showConfirmModal({
    title = 'Confirm Action',
    message = 'Are you sure you want to proceed?',
    confirmText = 'Proceed',
    cancelText = 'Cancel',
    isDanger = true
  } = {}) {
    return new Promise((resolve) => {
      const modal = this.dom.confirmModal;
      if (!modal) {
        resolve(window.confirm(message));
        return;
      }

      const titleEl = document.getElementById('confirm-title');
      const msgEl = document.getElementById('confirm-message');
      const proceedBtn = document.getElementById('confirm-proceed-btn');
      const cancelBtn = document.getElementById('confirm-cancel-btn');

      if (titleEl) titleEl.textContent = title;
      if (msgEl) msgEl.textContent = message;
      if (proceedBtn) {
        proceedBtn.textContent = confirmText;
        proceedBtn.className = isDanger
          ? 'primary-action-btn confirm-danger-btn'
          : 'primary-action-btn';
      }
      if (cancelBtn) cancelBtn.textContent = cancelText;

      let isResolved = false;

      const handleConfirm = () => {
        if (isResolved) return;
        isResolved = true;
        cleanup();
        this.closeModal(modal);
        resolve(true);
      };

      const handleCancel = () => {
        if (isResolved) return;
        isResolved = true;
        cleanup();
        this.closeModal(modal);
        resolve(false);
      };

      const handleOverlayClick = (e) => {
        if (e.target === modal) {
          handleCancel();
        }
      };

      const cleanup = () => {
        proceedBtn.removeEventListener('click', handleConfirm);
        cancelBtn.removeEventListener('click', handleCancel);
        modal.removeEventListener('click', handleOverlayClick);
      };

      proceedBtn.addEventListener('click', handleConfirm);
      cancelBtn.addEventListener('click', handleCancel);
      modal.addEventListener('click', handleOverlayClick);

      this.openModal(modal);
    });
  }

  openTrackInfoModal() {
    const t = this.currentTrack;
    if (!t) return;

    document.getElementById('info-title').textContent = t.title;
    document.getElementById('info-artist').textContent = t.artist;
    document.getElementById('info-album').textContent = t.album || 'Unknown';
    document.getElementById('info-genre').textContent = t.genre || 'Music';
    document.getElementById('info-year').textContent = t.year || 'N/A';
    document.getElementById('info-format').textContent = t.format || 'AUDIO';
    document.getElementById('info-size').textContent = t.size ? `${(t.size / (1024 * 1024)).toFixed(2)} MB` : 'N/A';

    this.openModal(this.dom.infoModal);
  }

  // --- Sleep Timer ---

  setSleepTimer(minutes) {
    if (this.sleepTimerInterval) clearInterval(this.sleepTimerInterval);
    if (this.sleepTimer) clearTimeout(this.sleepTimer);

    if (minutes === 0) {
      this.sleepTimerEnd = null;
      this.dom.btnTimer.querySelector('span').textContent = 'Timer';
      this.showToast('Sleep timer turned off');
      return;
    }

    this.sleepTimerEnd = Date.now() + minutes * 60 * 1000;
    this.showToast(`Sleep timer set for ${minutes} min`);

    this.sleepTimerInterval = setInterval(() => {
      const remaining = Math.max(0, Math.floor((this.sleepTimerEnd - Date.now()) / 1000));
      const m = Math.floor(remaining / 60);
      const s = remaining % 60;
      this.dom.btnTimer.querySelector('span').textContent = `${m}:${s < 10 ? '0' : ''}${s}`;

      if (remaining <= 0) {
        clearInterval(this.sleepTimerInterval);
        this.audioEngine.pause();
        this.dom.btnTimer.querySelector('span').textContent = 'Timer';
        this.showToast('Sleep timer expired. Sweet dreams! 🌙');
      }
    }, 1000);
  }

  // --- Media Session API ---

  setupMediaSession() {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('play', () => this.audioEngine.play());
      navigator.mediaSession.setActionHandler('pause', () => this.audioEngine.pause());
      navigator.mediaSession.setActionHandler('previoustrack', () => this.playPrev());
      navigator.mediaSession.setActionHandler('nexttrack', () => this.playNext());
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (details.seekTime !== undefined) {
          this.audioEngine.seek(details.seekTime);
          const dur = this.audioEngine.audio.duration || (this.currentTrack ? this.currentTrack.duration : 0) || 0;
          this.handleTimeUpdate(details.seekTime, dur);
        }
      });
      navigator.mediaSession.setActionHandler('seekbackward', (details) => {
        const offset = (details && details.seekOffset) ? details.seekOffset : 10;
        this.skipSeconds(-offset);
      });
      navigator.mediaSession.setActionHandler('seekforward', (details) => {
        const offset = (details && details.seekOffset) ? details.seekOffset : 10;
        this.skipSeconds(offset);
      });
    }
  }

  // --- 10-Second Skip & Quick Navigation ---

  skipSeconds(seconds) {
    if (!this.currentTrack) return;
    const targetTime = this.audioEngine.skip(seconds);
    const duration = this.audioEngine.audio.duration || this.currentTrack.duration || 0;
    
    // Immediately reflect new time on timeline and scrubber
    this.handleTimeUpdate(targetTime, duration);

    // Visual on-screen feedback bubble
    this.showSkipFeedback(seconds, targetTime);
  }

  showSkipFeedback(seconds, targetTime) {
    if (!this.dom.skipFeedbackBubble) return;
    const isFwd = seconds > 0;
    const absSec = Math.abs(seconds);

    if (this.dom.skipFeedbackIcon) {
      this.dom.skipFeedbackIcon.textContent = isFwd ? '⟳' : '⟲';
    }
    if (this.dom.skipFeedbackText) {
      const sign = isFwd ? '+' : '-';
      this.dom.skipFeedbackText.textContent = `${sign}${absSec}s (${this.formatTime(targetTime)})`;
    }

    this.dom.skipFeedbackBubble.classList.add('active');
    clearTimeout(this._skipFeedbackTimeout);
    this._skipFeedbackTimeout = setTimeout(() => {
      if (this.dom.skipFeedbackBubble) {
        this.dom.skipFeedbackBubble.classList.remove('active');
      }
    }, 850);
  }

  updateMediaSessionMetadata(track) {
    if ('mediaSession' in navigator) {
      const cover = this.getTrackArtwork(track);
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: track.artist,
        album: track.album || 'Local Music',
        artwork: [
          { src: cover, sizes: '192x192', type: 'image/png' },
          { src: cover, sizes: '512x512', type: 'image/png' }
        ]
      });
    }
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

  escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag));
  }

  showToast(message) {
    this.dom.toast.textContent = message;
    this.dom.toast.classList.add('visible');
    clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      this.dom.toast.classList.remove('visible');
    }, 2400);
  }
}

// Instantiate on DOM load
window.addEventListener('DOMContentLoaded', () => {
  window.auraApp = new AuraApp();
});
