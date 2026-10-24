/**
 * IndexedDB storage layer for Aura Mobile MP3 Player
 * Persists audio blobs, tracks metadata, playlists, favorites, and player preferences
 * completely offline on the user's device.
 */

class AuraDB {
  constructor() {
    this.dbName = 'AuraMusicPlayerDB';
    this.dbVersion = 1;
    this.db = null;
  }

  async init() {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Tracks store
        if (!db.objectStoreNames.contains('tracks')) {
          const trackStore = db.createObjectStore('tracks', { keyPath: 'id' });
          trackStore.createIndex('title', 'title', { unique: false });
          trackStore.createIndex('artist', 'artist', { unique: false });
          trackStore.createIndex('album', 'album', { unique: false });
          trackStore.createIndex('isFavorite', 'isFavorite', { unique: false });
          trackStore.createIndex('addedAt', 'addedAt', { unique: false });
        }

        // Playlists store
        if (!db.objectStoreNames.contains('playlists')) {
          db.createObjectStore('playlists', { keyPath: 'id' });
        }

        // Settings / key-value store
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onerror = (event) => {
        console.error('IndexedDB error:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  // --- Track Operations ---

  async saveTrack(track) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('tracks', 'readwrite');
      const store = tx.objectStore('tracks');
      const req = store.put(track);
      req.onsuccess = () => resolve(track);
      req.onerror = () => reject(req.error);
    });
  }

  async saveTracks(tracksArray) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('tracks', 'readwrite');
      const store = tx.objectStore('tracks');
      for (const track of tracksArray) {
        store.put(track);
      }
      tx.oncomplete = () => resolve(tracksArray);
      tx.onerror = () => reject(tx.error);
    });
  }

  async getAllTracks() {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('tracks', 'readonly');
      const store = tx.objectStore('tracks');
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async getTrack(id) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('tracks', 'readonly');
      const store = tx.objectStore('tracks');
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async deleteTrack(id) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('tracks', 'readwrite');
      const store = tx.objectStore('tracks');
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  async clearAllTracks() {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('tracks', 'readwrite');
      const store = tx.objectStore('tracks');
      const req = store.clear();
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  async updateTrackFavorite(id, isFavorite) {
    const track = await this.getTrack(id);
    if (!track) return null;
    track.isFavorite = isFavorite;
    return this.saveTrack(track);
  }

  async incrementPlayCount(id) {
    const track = await this.getTrack(id);
    if (!track) return null;
    track.playCount = (track.playCount || 0) + 1;
    track.lastPlayedAt = Date.now();
    return this.saveTrack(track);
  }

  // --- Playlist Operations ---

  async getAllPlaylists() {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('playlists', 'readonly');
      const store = tx.objectStore('playlists');
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async savePlaylist(playlist) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('playlists', 'readwrite');
      const store = tx.objectStore('playlists');
      const req = store.put(playlist);
      req.onsuccess = () => resolve(playlist);
      req.onerror = () => reject(req.error);
    });
  }

  async deletePlaylist(id) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('playlists', 'readwrite');
      const store = tx.objectStore('playlists');
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  // --- Settings & Preferences ---

  async setSetting(key, value) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('settings', 'readwrite');
      const store = tx.objectStore('settings');
      const req = store.put({ key, value });
      req.onsuccess = () => resolve(value);
      req.onerror = () => reject(req.error);
    });
  }

  async getSetting(key, defaultValue = null) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('settings', 'readonly');
      const store = tx.objectStore('settings');
      const req = store.get(key);
      req.onsuccess = () => {
        if (req.result && req.result.value !== undefined) {
          resolve(req.result.value);
        } else {
          resolve(defaultValue);
        }
      };
      req.onerror = () => resolve(defaultValue);
    });
  }
}

if (typeof window !== 'undefined') {
  window.auraDB = new AuraDB();
}
