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
    this.repeatMode = 'all'; // 'none' | 'all' | 'one'
    this.currentFilter = 'all';
    this.searchQuery = '';
    this.activeView = 'tracks';
    this.playbackRate = 1.0;
    this.sleepTimer = null;
    this.sleepTimerEnd = null;
    this.sleepTimerInterval = null;

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

    // Load persisted tracks from IndexedDB
    try {
      const stored = await auraDB.getAllTracks();
      if (stored && stored.length > 0) {
        this.tracks = stored;
        this.updateLibraryUI();
      } else {
        // Automatically load demo sample tracks for first-time instant gratification!
        this.loadDefaultDemoTracks();
      }
    } catch (e) {
      console.warn('Could not read IndexedDB:', e);
      this.loadDefaultDemoTracks();
    }

    this.setupMediaSession();
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
      btnMainPlay: document.getElementById('btn-main-play'),
      btnNext: document.getElementById('btn-next'),
      btnRepeat: document.getElementById('btn-repeat'),

      // Secondary Actions
      btnSpeed: document.getElementById('btn-speed'),
      btnTimer: document.getElementById('btn-timer'),
      btnInfo: document.getElementById('btn-info'),
      btnEqShortcut: document.getElementById('btn-eq-shortcut'),

      // Modals
      importModal: document.getElementById('import-modal'),
      timerModal: document.getElementById('timer-modal'),
      infoModal: document.getElementById('info-modal'),
      playlistModal: document.getElementById('playlist-modal'),

      // Hidden file inputs
      fileInputFiles: document.getElementById('file-input-files'),
      fileInputFolder: document.getElementById('file-input-folder'),

      // Frame Desktop Toggle
      deviceViewport: document.getElementById('device-viewport'),
      toggleDesktopFrameBtn: document.getElementById('toggle-desktop-frame'),

      // Toast
      toast: document.getElementById('toast-notice')
    };
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
      this.dom.fileInputFiles.click();
    });

    document.getElementById('opt-pick-folder').addEventListener('click', () => {
      this.closeModal(this.dom.importModal);
      this.dom.fileInputFolder.click();
    });

    document.getElementById('opt-add-demos').addEventListener('click', () => {
      this.closeModal(this.dom.importModal);
      this.loadDefaultDemoTracks(true);
    });

    document.getElementById('opt-clear-all').addEventListener('click', async () => {
      this.closeModal(this.dom.importModal);
      if (confirm('Clear all imported local tracks from Aura storage?')) {
        await auraDB.clearAllTracks();
        this.tracks = [];
        this.audioEngine.pause();
        this.currentTrack = null;
        this.currentIndex = -1;
        this.updateLibraryUI();
        this.showToast('Library cleared');
      }
    });

    // File Input Handlers
    this.dom.fileInputFiles.addEventListener('change', (e) => this.handleFilesSelected(e.target.files));
    this.dom.fileInputFolder.addEventListener('change', (e) => this.handleFilesSelected(e.target.files));

    // Drag and Drop
    const dropzone = this.dom.emptyState;
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.files.length > 0) {
        this.handleFilesSelected(e.dataTransfer.files);
      }
    });

    // Mini Player Open
    this.dom.miniPlayer.addEventListener('click', (e) => {
      if (e.target.closest('.mini-btn')) return; // ignore control button clicks
      this.openPlayerSheet();
    });

    this.dom.miniPlayBtn.addEventListener('click', () => this.togglePlayPause());
    this.dom.miniNextBtn.addEventListener('click', () => this.playNext());

    // Full-screen Sheet Player Controls
    this.dom.sheetDragHandle.addEventListener('click', () => this.closePlayerSheet());
    this.dom.sheetCloseBtn.addEventListener('click', () => this.closePlayerSheet());

    this.dom.btnMainPlay.addEventListener('click', () => this.togglePlayPause());
    this.dom.btnPrev.addEventListener('click', () => this.playPrev());
    this.dom.btnNext.addEventListener('click', () => this.playNext());

    this.dom.btnShuffle.addEventListener('click', () => {
      this.isShuffled = !this.isShuffled;
      this.dom.btnShuffle.classList.toggle('active', this.isShuffled);
      this.showToast(this.isShuffled ? 'Shuffle: ON' : 'Shuffle: OFF');
    });

    this.dom.btnRepeat.addEventListener('click', () => {
      if (this.repeatMode === 'all') {
        this.repeatMode = 'one';
        this.dom.btnRepeat.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/><text x="12" y="14" font-size="8" fill="currentColor" text-anchor="middle">1</text></svg>`;
        this.dom.btnRepeat.classList.add('active');
        this.showToast('Repeat: Current Song');
      } else if (this.repeatMode === 'one') {
        this.repeatMode = 'none';
        this.dom.btnRepeat.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>`;
        this.dom.btnRepeat.classList.remove('active');
        this.showToast('Repeat: OFF');
      } else {
        this.repeatMode = 'all';
        this.dom.btnRepeat.classList.add('active');
        this.showToast('Repeat: All Tracks');
      }
    });

    // Scrubber Interaction
    this.dom.scrubBar.addEventListener('click', (e) => {
      const rect = this.dom.scrubBar.getBoundingClientRect();
      const clickPos = (e.clientX - rect.left) / rect.width;
      const targetTime = clickPos * (this.audioEngine.audio.duration || 0);
      this.audioEngine.seek(targetTime);
    });

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
        if (label) label.textContent = `${val > 0 ? '+' : ''}${val}dB`;
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
          if (label) label.textContent = `${gains[i] > 0 ? '+' : ''}${gains[i]}dB`;
        });
        this.showToast(`EQ Preset: ${preset.toUpperCase()}`);
      });
    });

    // Bass Booster Slider
    if (this.dom.bassSlider) {
      this.dom.bassSlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        this.audioEngine.setBassBoost(val);
        if (this.dom.bassValLabel) this.dom.bassValLabel.textContent = `+${val}dB`;
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
        const name = document.getElementById('playlist-name-input').value.trim();
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

    // Keybindings (Spacebar play/pause, Arrow keys)
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.code === 'Space') {
        e.preventDefault();
        this.togglePlayPause();
      } else if (e.code === 'ArrowRight') {
        this.playNext();
      } else if (e.code === 'ArrowLeft') {
        this.playPrev();
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

  async handleFilesSelected(fileList) {
    if (!fileList || fileList.length === 0) return;
    this.showToast(`Processing ${fileList.length} file(s)...`);

    const newTracks = [];
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      // Filter for audio extensions
      const ext = file.name.split('.').pop().toLowerCase();
      if (!['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'weba'].includes(ext)) {
        continue;
      }

      try {
        const metadata = await ID3Parser.parse(file);
        const trackObj = {
          id: `local_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
          title: metadata.title,
          artist: metadata.artist,
          album: metadata.album,
          year: metadata.year,
          genre: metadata.genre,
          format: metadata.format,
          size: file.size,
          pictureUrl: metadata.pictureUrl,
          fileBlob: file, // Store the raw File blob in IndexedDB
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
  }

  // Load Built-in Demo Tracks
  async loadDefaultDemoTracks(notify = false) {
    const demos = [
      {
        id: 'demo_1',
        title: 'Midnight Drive',
        artist: 'Aura Synthetics',
        album: 'Cyber Horizons',
        year: '2026',
        genre: 'Synthwave',
        format: 'WAV',
        size: 2822400,
        url: './assets/sample-tracks/Midnight_Drive.wav',
        pictureUrl: './assets/sample-tracks/midnight_drive_cover.jpg',
        isFavorite: true,
        playCount: 4,
        addedAt: Date.now() - 3600000
      },
      {
        id: 'demo_2',
        title: 'Celestial Echoes',
        artist: 'Nebula Dream',
        album: 'Deep Space Orbit',
        year: '2026',
        genre: 'Ambient',
        format: 'WAV',
        size: 3175200,
        url: './assets/sample-tracks/Celestial_Echoes.wav',
        pictureUrl: './assets/sample-tracks/celestial_echoes_cover.jpg',
        isFavorite: false,
        playCount: 2,
        addedAt: Date.now() - 1800000
      },
      {
        id: 'demo_3',
        title: 'Golden Hour Sunset',
        artist: 'Velvet Beats',
        album: 'Lo-Fi Chill Sessions',
        year: '2026',
        genre: 'Lo-Fi',
        format: 'WAV',
        size: 2822400,
        url: './assets/sample-tracks/Golden_Hour_Lofi.wav',
        pictureUrl: './assets/sample-tracks/golden_hour_cover.jpg',
        isFavorite: true,
        playCount: 7,
        addedAt: Date.now() - 600000
      }
    ];

    // Filter out duplicates if already present
    const existingIds = new Set(this.tracks.map(t => t.id));
    const toAdd = demos.filter(d => !existingIds.has(d.id));

    if (toAdd.length > 0) {
      await auraDB.saveTracks(toAdd);
      this.tracks = [...this.tracks, ...toAdd];
      this.updateLibraryUI();
      if (notify) this.showToast('Added 3 demo tracks!');
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

      row.innerHTML = `
        <div class="track-artwork-thumb">
          <img src="${track.pictureUrl || './assets/icon-192.png'}" alt="Artwork" loading="lazy">
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
        </div>
      `;

      // Click to play
      row.addEventListener('click', (e) => {
        if (e.target.closest('.track-fav-btn')) return;
        this.playTrack(index);
      });

      // Favorite toggle
      const favBtn = row.querySelector('.track-fav-btn');
      favBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleFavorite(track.id);
      });

      this.dom.tracksList.appendChild(row);
    });
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
      card.innerHTML = `
        <div class="album-cover-box">
          <img src="${album.artwork || './assets/icon-192.png'}" alt="${this.escapeHTML(album.name)}" loading="lazy">
          <div class="album-play-overlay">
            <svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
          </div>
        </div>
        <div class="album-info-title">${this.escapeHTML(album.name)}</div>
        <div class="album-info-artist">${this.escapeHTML(album.artist)} • ${album.tracks.length} ${album.tracks.length === 1 ? 'track' : 'tracks'}</div>
      `;

      card.addEventListener('click', () => {
        // Play first track of this album
        const idx = this.tracks.findIndex(t => t.id === album.tracks[0].id);
        if (idx !== -1) {
          this.playTrack(idx);
          this.openPlayerSheet();
        }
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
      this.dom.filterChips.forEach(c => c.classList.remove('active'));
      const favChip = Array.from(this.dom.filterChips).find(c => c.dataset.filter === 'fav');
      if (favChip) favChip.classList.add('active');
      this.currentFilter = 'fav';
      this.switchView('tracks');
      this.filterAndRender();
    });

    try {
      const customPlaylists = await auraDB.getAllPlaylists();
      customPlaylists.forEach(pl => {
        const card = document.createElement('div');
        card.className = 'playlist-card';
        card.innerHTML = `
          <div class="playlist-icon-square" style="background:linear-gradient(135deg, #00f2fe 0%, #4facfe 100%);">
            <svg viewBox="0 0 24 24"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
          </div>
          <div class="playlist-info" style="flex:1;">
            <h4>${this.escapeHTML(pl.name)}</h4>
            <p>${(pl.trackIds || []).length} songs</p>
          </div>
          <button class="mini-btn delete-pl-btn" style="color:#64748b;" title="Delete Playlist">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
          </button>
        `;

        card.querySelector('.delete-pl-btn').addEventListener('click', async (e) => {
          e.stopPropagation();
          await auraDB.deletePlaylist(pl.id);
          this.renderPlaylists();
          this.showToast(`Deleted "${pl.name}"`);
        });

        this.dom.playlistsList.appendChild(card);
      });
    } catch (e) {
      console.warn('Error loading custom playlists:', e);
    }
  }

  // --- Playback Management ---

  async playTrack(indexInFiltered) {
    if (indexInFiltered < 0 || indexInFiltered >= this.filteredTracks.length) return;
    this.currentIndex = indexInFiltered;
    const track = this.filteredTracks[this.currentIndex];
    this.currentTrack = track;

    try {
      await this.audioEngine.loadTrack(track);
      await this.audioEngine.play();
      this.updateNowPlayingUI();
      this.updatePlayingItemHighlight();
      auraDB.incrementPlayCount(track.id);
      this.updateMediaSessionMetadata(track);
    } catch (e) {
      console.warn('Playback error:', e);
      this.showToast('Could not play track');
    }
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

  playNext() {
    if (this.filteredTracks.length === 0) return;
    let nextIdx = this.currentIndex + 1;
    if (this.isShuffled) {
      nextIdx = Math.floor(Math.random() * this.filteredTracks.length);
    } else if (nextIdx >= this.filteredTracks.length) {
      if (this.repeatMode === 'none') {
        this.audioEngine.pause();
        return;
      }
      nextIdx = 0;
    }
    this.playTrack(nextIdx);
  }

  playPrev() {
    if (this.filteredTracks.length === 0) return;
    // If more than 3 seconds into track, restart it
    if (this.audioEngine.audio.currentTime > 3) {
      this.audioEngine.seek(0);
      return;
    }
    let prevIdx = this.currentIndex - 1;
    if (prevIdx < 0) {
      prevIdx = this.filteredTracks.length - 1;
    }
    this.playTrack(prevIdx);
  }

  handleTrackEnd() {
    if (this.repeatMode === 'one') {
      this.audioEngine.seek(0);
      this.audioEngine.play();
    } else {
      this.playNext();
    }
  }

  handleStateChange(isPlaying) {
    this.isPlaying = isPlaying;

    // Toggle icons for main play button
    const playSvg = `<svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
    const pauseSvg = `<svg viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>`;
    
    this.dom.btnMainPlay.innerHTML = isPlaying ? pauseSvg : playSvg;
    this.dom.miniPlayBtn.innerHTML = isPlaying ? pauseSvg : playSvg;

    // Spinning vinyl animation toggle
    this.dom.miniThumb.classList.toggle('playing', isPlaying);
    this.dom.vinylWrapper.classList.toggle('playing', isPlaying);

    this.updatePlayingItemHighlight();
  }

  handleTimeUpdate(current, duration) {
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

    const cover = t.pictureUrl || './assets/icon-192.png';

    // Mini Player
    this.dom.miniCoverImg.src = cover;
    this.dom.miniTitle.textContent = t.title;
    this.dom.miniArtist.textContent = t.artist;
    this.dom.miniPlayer.style.display = 'flex';

    // Full Sheet Player
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
        if (details.seekTime !== undefined) this.audioEngine.seek(details.seekTime);
      });
      navigator.mediaSession.setActionHandler('seekbackward', () => {
        this.audioEngine.seek(this.audioEngine.audio.currentTime - 10);
      });
      navigator.mediaSession.setActionHandler('seekforward', () => {
        this.audioEngine.seek(this.audioEngine.audio.currentTime + 10);
      });
    }
  }

  updateMediaSessionMetadata(track) {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: track.artist,
        album: track.album || 'Local Music',
        artwork: [
          { src: track.pictureUrl || './assets/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: track.pictureUrl || './assets/icon-512.png', sizes: '512x512', type: 'image/png' }
        ]
      });
    }
  }

  // --- Helpers ---

  formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
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
