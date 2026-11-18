/**
 * High-performance pure JavaScript ID3v1 & ID3v2 (v2.2, v2.3, v2.4) tag parser
 * Extracts Title, Artist, Album, Year, Genre, Track Number, and Embedded Album Art (APIC).
 */

class ID3Parser {
  /**
   * Parse metadata from an audio File or Blob.
   * @param {File|Blob} file
   * @returns {Promise<Object>} Metadata object
   */
  static async parse(file) {
    const defaultMeta = {
      title: ID3Parser.cleanFilename(file.name || 'Unknown Track'),
      artist: 'Unknown Artist',
      album: 'Local Audio',
      year: '',
      genre: 'Music',
      trackNumber: '',
      picture: null,
      pictureUrl: null,
      format: file.name ? file.name.split('.').pop().toUpperCase() : 'AUDIO',
      size: file.size,
      duration: 0
    };

    // If filename has "Artist - Title" format, pre-seed
    if (file.name) {
      const parsedFromFilename = ID3Parser.parseFilename(file.name);
      if (parsedFromFilename.artist) defaultMeta.artist = parsedFromFilename.artist;
      if (parsedFromFilename.title) defaultMeta.title = parsedFromFilename.title;
    }

    try {
      // 1. Try reading the first 512KB for ID3v2 header and frames
      const headerBuffer = await ID3Parser.readSlice(file, 0, Math.min(file.size, 512 * 1024));
      const id3v2Meta = ID3Parser.parseID3v2(new DataView(headerBuffer));
      
      if (id3v2Meta) {
        Object.assign(defaultMeta, id3v2Meta);
      } else {
        // If not ID3v2, check if it's an MP4 / M4A container (QuickTime/ISO atoms: moov -> udta -> meta -> ilst)
        const ext = file.name ? file.name.split('.').pop().toLowerCase() : '';
        if (ext === 'm4a' || ext === 'aac' || ext === 'mp4' || defaultMeta.format === 'M4A') {
          const mp4Meta = await ID3Parser.parseMP4(file);
          if (mp4Meta) {
            Object.assign(defaultMeta, mp4Meta);
          }
        }
      }

      // 2. If title or artist still default, try ID3v1 at end of file (128 bytes)
      if ((defaultMeta.title === 'Unknown Track' || defaultMeta.artist === 'Unknown Artist') && file.size > 128) {
        const footerBuffer = await ID3Parser.readSlice(file, file.size - 128, file.size);
        const id3v1Meta = ID3Parser.parseID3v1(new DataView(footerBuffer));
        if (id3v1Meta) {
          if (!defaultMeta.title || defaultMeta.title === 'Unknown Track') defaultMeta.title = id3v1Meta.title || defaultMeta.title;
          if (!defaultMeta.artist || defaultMeta.artist === 'Unknown Artist') defaultMeta.artist = id3v1Meta.artist || defaultMeta.artist;
          if (!defaultMeta.album || defaultMeta.album === 'Local Audio') defaultMeta.album = id3v1Meta.album || defaultMeta.album;
          if (!defaultMeta.year) defaultMeta.year = id3v1Meta.year || '';
        }
      }

      // 3. If track has cover picture blob, convert to permanent Data URL
      if (defaultMeta.picture && defaultMeta.picture.data && defaultMeta.picture.data.byteLength > 64) {
        try {
          const mime = defaultMeta.picture.format || 'image/jpeg';
          const blob = new Blob([defaultMeta.picture.data], { type: mime });
          const dataUrl = await ID3Parser.blobToDataUrl(blob);
          if (dataUrl) {
            defaultMeta.pictureUrl = dataUrl;
          }
        } catch (e) {
          console.warn('Could not create Data URL for picture:', e);
        }
      }

      // If no picture, generate a vibrant procedural gradient cover
      if (!defaultMeta.pictureUrl) {
        defaultMeta.pictureUrl = ID3Parser.generateProceduralCover(defaultMeta.title, defaultMeta.artist);
      }
    } catch (err) {
      console.warn('ID3 parsing error (using fallback):', err);
      if (!defaultMeta.pictureUrl) {
        defaultMeta.pictureUrl = ID3Parser.generateProceduralCover(defaultMeta.title, defaultMeta.artist);
      }
    }

    return defaultMeta;
  }

  static blobToDataUrl(blob) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string' && reader.result.startsWith('data:image')) {
          resolve(reader.result);
        } else {
          resolve(null);
        }
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  }

  static readSlice(file, start, end) {
    return new Promise((resolve, reject) => {
      const slice = file.slice(start, end);
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(slice);
    });
  }

  static parseID3v2(view) {
    if (view.byteLength < 10) return null;
    // Check "ID3" identifier
    if (view.getUint8(0) !== 0x49 || view.getUint8(1) !== 0x44 || view.getUint8(2) !== 0x33) {
      return null;
    }

    const versionMajor = view.getUint8(3); // e.g. 3 for ID3v2.3, 4 for ID3v2.4
    const versionMinor = view.getUint8(4);
    const flags = view.getUint8(5);
    
    // Tag size is a 4-byte synchsafe integer (7 bits per byte)
    const tagSize = ((view.getUint8(6) & 0x7F) << 21) |
                    ((view.getUint8(7) & 0x7F) << 14) |
                    ((view.getUint8(8) & 0x7F) << 7)  |
                    (view.getUint8(9) & 0x7F);

    let offset = 10;
    const maxOffset = Math.min(view.byteLength, 10 + tagSize);
    const meta = {};

    // ID3v2.3 and ID3v2.4 have 4-character frame IDs and 4-byte sizes
    // ID3v2.2 has 3-character frame IDs and 3-byte sizes
    const isV22 = versionMajor === 2;

    while (offset < maxOffset - (isV22 ? 6 : 10)) {
      let frameId = '';
      let frameSize = 0;

      if (isV22) {
        frameId = String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2));
        frameSize = (view.getUint8(offset + 3) << 16) | (view.getUint8(offset + 4) << 8) | view.getUint8(offset + 5);
        offset += 6;
      } else {
        frameId = String.fromCharCode(
          view.getUint8(offset),
          view.getUint8(offset + 1),
          view.getUint8(offset + 2),
          view.getUint8(offset + 3)
        );
        if (versionMajor === 4) {
          // Syncsafe in v2.4
          frameSize = ((view.getUint8(offset + 4) & 0x7F) << 21) |
                      ((view.getUint8(offset + 5) & 0x7F) << 14) |
                      ((view.getUint8(offset + 6) & 0x7F) << 7)  |
                      (view.getUint8(offset + 7) & 0x7F);
        } else {
          frameSize = view.getUint32(offset + 4);
        }
        offset += 10;
      }

      // Check for padding (null bytes)
      if (!frameId || frameId.charCodeAt(0) === 0 || frameSize <= 0 || offset + frameSize > view.byteLength) {
        break;
      }

      const frameData = new DataView(view.buffer, view.byteOffset + offset, frameSize);
      offset += frameSize;

      // Extract text or picture frames
      if (frameId === 'TIT2' || frameId === 'TT2') {
        meta.title = ID3Parser.decodeTextFrame(frameData);
      } else if (frameId === 'TPE1' || frameId === 'TP1') {
        meta.artist = ID3Parser.decodeTextFrame(frameData);
      } else if (frameId === 'TALB' || frameId === 'TAL') {
        meta.album = ID3Parser.decodeTextFrame(frameData);
      } else if (frameId === 'TYER' || frameId === 'TDRC' || frameId === 'TYE') {
        meta.year = ID3Parser.decodeTextFrame(frameData).slice(0, 4);
      } else if (frameId === 'TCON' || frameId === 'TCO') {
        meta.genre = ID3Parser.decodeTextFrame(frameData);
      } else if (frameId === 'TRCK' || frameId === 'TRK') {
        meta.trackNumber = ID3Parser.decodeTextFrame(frameData);
      } else if ((frameId === 'APIC' || frameId === 'PIC') && !meta.picture) {
        meta.picture = ID3Parser.decodePictureFrame(frameData, isV22);
      }
    }

    return Object.keys(meta).length > 0 ? meta : null;
  }

  static decodeTextFrame(view) {
    if (view.byteLength <= 1) return '';
    const encoding = view.getUint8(0);
    const bytes = new Uint8Array(view.buffer, view.byteOffset + 1, view.byteLength - 1);
    return ID3Parser.decodeString(bytes, encoding).replace(/\0/g, '').trim();
  }

  static decodeString(bytes, encoding) {
    try {
      if (encoding === 0) {
        // ISO-8859-1
        let str = '';
        for (let i = 0; i < bytes.length; i++) {
          str += String.fromCharCode(bytes[i]);
        }
        return decodeURIComponent(escape(str));
      } else if (encoding === 1) {
        // UTF-16 with BOM
        return new TextDecoder('utf-16').decode(bytes);
      } else if (encoding === 2) {
        // UTF-16BE
        return new TextDecoder('utf-16be').decode(bytes);
      } else if (encoding === 3) {
        // UTF-8
        return new TextDecoder('utf-8').decode(bytes);
      }
    } catch (e) {
      // Fallback
      let fallback = '';
      for (let i = 0; i < bytes.length; i++) {
        if (bytes[i] >= 32 && bytes[i] <= 126) fallback += String.fromCharCode(bytes[i]);
      }
      return fallback;
    }
    return '';
  }

  static decodePictureFrame(view, isV22) {
    try {
      if (view.byteLength < 10) return null;
      let offset = 0;
      const encoding = view.getUint8(offset++);
      
      let mimeType = 'image/jpeg';
      if (isV22) {
        const fmt = String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2)).toUpperCase();
        offset += 3;
        mimeType = fmt === 'PNG' ? 'image/png' : 'image/jpeg';
      } else {
        let mime = '';
        while (offset < view.byteLength && view.getUint8(offset) !== 0) {
          mime += String.fromCharCode(view.getUint8(offset++));
        }
        offset++; // skip null terminator
        if (mime) mimeType = mime.toLowerCase();
      }

      const pictureType = view.getUint8(offset++); // 0x03 is front cover
      
      // Skip description (null terminated string)
      if (encoding === 1 || encoding === 2) {
        // UTF-16 two null bytes
        while (offset < view.byteLength - 1 && !(view.getUint8(offset) === 0 && view.getUint8(offset + 1) === 0)) {
          offset += 2;
        }
        offset += 2;
      } else {
        // 1 null byte
        while (offset < view.byteLength && view.getUint8(offset) !== 0) {
          offset++;
        }
        offset++;
      }

      if (offset >= view.byteLength) return null;

      const imgData = new Uint8Array(view.buffer, view.byteOffset + offset, view.byteLength - offset);
      return {
        format: mimeType,
        type: pictureType,
        data: imgData
      };
    } catch (e) {
      console.warn('Failed to decode picture frame:', e);
      return null;
    }
  }

  static parseID3v1(view) {
    if (view.byteLength < 128) return null;
    const offset = view.byteLength - 128;
    // Check "TAG"
    if (view.getUint8(offset) !== 0x54 || view.getUint8(offset + 1) !== 0x41 || view.getUint8(offset + 2) !== 0x47) {
      return null;
    }

    const getString = (start, length) => {
      let str = '';
      for (let i = 0; i < length; i++) {
        const b = view.getUint8(offset + start + i);
        if (b === 0) break;
        str += String.fromCharCode(b);
      }
      return str.trim();
    };

    return {
      title: getString(3, 30),
      artist: getString(33, 30),
      album: getString(63, 30),
      year: getString(93, 4)
    };
  }

  static cleanFilename(name) {
    if (!name) return 'Unknown Track';
    // Remove extension
    let clean = name.replace(/\.[^/.]+$/, '');
    // Remove leading track numbers like "01 - ", "1. ", "02_"
    clean = clean.replace(/^\s*\d+[\s\.\-_]+/, '');
    // Replace underscores with spaces
    clean = clean.replace(/_/g, ' ');
    return clean.trim();
  }

  static parseFilename(name) {
    const clean = ID3Parser.cleanFilename(name);
    // If filename is formatted "Artist - Title"
    if (clean.includes(' - ')) {
      const parts = clean.split(' - ');
      if (parts.length >= 2) {
        return {
          artist: parts[0].trim(),
          title: parts.slice(1).join(' - ').trim()
        };
      }
    }
    return { title: clean, artist: null };
  }

  /**
   * Generates a sleek procedural canvas artwork for tracks without embedded album art.
   */
  static generateProceduralCover(title = 'Song', artist = 'Artist') {
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 400;
    const ctx = canvas.getContext('2d');

    // Deterministic hue hash based on title + artist
    let hash = 0;
    const str = `${title}-${artist}`;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const h1 = Math.abs(hash) % 360;
    const h2 = (h1 + 65) % 360;

    // Rich dual-gradient background
    const grad = ctx.createLinearGradient(0, 0, 400, 400);
    grad.addColorStop(0, `hsl(${h1}, 80%, 20%)`);
    grad.addColorStop(0.5, `hsl(${(h1 + 30) % 360}, 85%, 12%)`);
    grad.addColorStop(1, `hsl(${h2}, 75%, 8%)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 400, 400);

    // Glowing geometric sound rings
    ctx.save();
    ctx.translate(200, 200);
    for (let r = 160; r > 30; r -= 30) {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.strokeStyle = `hsla(${h1}, 90%, 65%, ${0.12 + (160 - r) * 0.002})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Outer vinyl groove dots
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) {
      const x = Math.cos(a) * 140;
      const y = Math.sin(a) * 140;
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${h2}, 95%, 70%, 0.4)`;
      ctx.fill();
    }

    // Center circular badge
    ctx.beginPath();
    ctx.arc(0, 0, 68, 0, Math.PI * 2);
    ctx.fillStyle = `hsla(${h1}, 70%, 15%, 0.9)`;
    ctx.strokeStyle = `hsla(${h1}, 95%, 65%, 0.7)`;
    ctx.lineWidth = 3;
    ctx.fill();
    ctx.stroke();

    // Initials in center
    const initials = (title.charAt(0) + (artist !== 'Unknown Artist' ? artist.charAt(0) : title.charAt(1) || '')).toUpperCase();
    ctx.font = '700 48px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initials, 0, 2);

    ctx.restore();
    return canvas.toDataURL('image/jpeg', 0.88);
  }

  /**
   * Parse iTunes/M4A metadata from MP4 container atoms (moov -> udta -> meta -> ilst)
   */
  static async parseMP4(file) {
    try {
      // Find moov atom in first 512KB or last 1MB
      let foundMoov = null;
      const headSize = Math.min(file.size, 512 * 1024);
      const headBuf = await ID3Parser.readSlice(file, 0, headSize);
      const headView = new DataView(headBuf);

      let off = 0;
      while (off <= headSize - 8) {
        const size = headView.getUint32(off);
        const name = String.fromCharCode(
          headView.getUint8(off + 4),
          headView.getUint8(off + 5),
          headView.getUint8(off + 6),
          headView.getUint8(off + 7)
        );
        if (name === 'moov') {
          foundMoov = { offset: off, size: size };
          break;
        }
        if (size <= 0) break;
        off += size;
      }

      if (!foundMoov && file.size > headSize) {
        const tailStart = Math.max(0, file.size - 1024 * 1024);
        const tailBuf = await ID3Parser.readSlice(file, tailStart, file.size);
        const tailView = new DataView(tailBuf);
        let tOff = 0;
        while (tOff <= tailBuf.byteLength - 8) {
          const size = tailView.getUint32(tOff);
          const name = String.fromCharCode(
            tailView.getUint8(tOff + 4),
            tailView.getUint8(tOff + 5),
            tailView.getUint8(tOff + 6),
            tailView.getUint8(tOff + 7)
          );
          if (name === 'moov') {
            foundMoov = { offset: tailStart + tOff, size: size };
            break;
          }
          if (size <= 0) break;
          tOff += size;
        }
      }

      if (!foundMoov) return null;

      const readSize = Math.min(foundMoov.size, 1024 * 1024);
      const moovAtomBuf = await ID3Parser.readSlice(file, foundMoov.offset, Math.min(file.size, foundMoov.offset + readSize));
      const view = new DataView(moovAtomBuf);

      return ID3Parser.parseMoovMetadata(view);
    } catch (e) {
      console.warn('MP4 metadata parsing error:', e);
      return null;
    }
  }

  static parseMoovMetadata(view) {
    const findAtom = (start, end, targetName) => {
      let cur = start;
      while (cur <= end - 8) {
        const size = view.getUint32(cur);
        const name = String.fromCharCode(
          view.getUint8(cur + 4),
          view.getUint8(cur + 5),
          view.getUint8(cur + 6),
          view.getUint8(cur + 7)
        );
        if (name === targetName) {
          return { start: cur + 8, end: cur + size, size };
        }
        if (size <= 0) break;
        cur += size;
      }
      return null;
    };

    const udta = findAtom(8, view.byteLength, 'udta');
    if (!udta) return null;

    const meta = findAtom(udta.start, udta.end, 'meta');
    if (!meta) return null;

    // meta atom has 4 bytes flags/version after header
    const ilst = findAtom(meta.start + 4, meta.end, 'ilst');
    if (!ilst) return null;

    const metadata = {};
    let cur = ilst.start;
    const decoder = new TextDecoder('utf-8');

    while (cur <= ilst.end - 8) {
      const atomSize = view.getUint32(cur);
      const atomName = String.fromCharCode(
        view.getUint8(cur + 4),
        view.getUint8(cur + 5),
        view.getUint8(cur + 6),
        view.getUint8(cur + 7)
      );
      if (atomSize <= 8) {
        cur += 8;
        continue;
      }

      const dataAtom = findAtom(cur + 8, cur + atomSize, 'data');
      if (dataAtom) {
        const typeFlags = view.getUint32(dataAtom.start);
        const payloadStart = dataAtom.start + 8;
        const payloadLength = dataAtom.end - payloadStart;

        if (payloadLength > 0 && payloadStart + payloadLength <= view.byteLength) {
          if (atomName === 'covr' || atomName === '©cov') {
            const mime = (typeFlags === 14) ? 'image/png' : 'image/jpeg';
            const picBytes = new Uint8Array(view.buffer, view.byteOffset + payloadStart, payloadLength);
            metadata.picture = { format: mime, data: picBytes };
          } else {
            const textBytes = new Uint8Array(view.buffer, view.byteOffset + payloadStart, payloadLength);
            const textVal = decoder.decode(textBytes).trim();
            if (atomName === '©nam') metadata.title = textVal;
            else if (atomName === '©ART' || atomName === 'aART') metadata.artist = textVal;
            else if (atomName === '©alb') metadata.album = textVal;
            else if (atomName === '©day') metadata.year = textVal.slice(0, 4);
            else if (atomName === '©gen' || atomName === 'gnre') metadata.genre = textVal;
            else if (atomName === 'trkn' && payloadLength >= 4) {
              metadata.trackNumber = String(view.getUint16(payloadStart + 2));
            }
          }
        }
      }

      cur += atomSize;
    }

    return Object.keys(metadata).length > 0 ? metadata : null;
  }
}

if (typeof window !== 'undefined') {
  window.ID3Parser = ID3Parser;
}
