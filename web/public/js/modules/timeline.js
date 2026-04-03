/**
 * Timeline Module
 * Multi-track timeline with:
 * - Horizontal scroll (synced ruler + tracks)
 * - Draggable playhead with boundary clamping to 0
 * - Ctrl+Scroll waveform amplitude boost
 * - Resizable track heights (drag border)
 * - Zoom in/out
 * - Selection
 */

import { formatTime, clamp, throttle, debounce } from '../utils/helpers.js';

export class Timeline {
  constructor(player) {
    this.player = player;
    this.rulerCanvas = document.getElementById('ruler-canvas');
    this.videoTrackCanvas = document.getElementById('video-track-canvas');
    this.audioTrackCanvas = document.getElementById('audio-track-canvas');
    this.subtitleTrackCanvas = document.getElementById('subtitle-track-canvas');
    this.playhead = document.getElementById('playhead');
    this.scrollWrapper = document.getElementById('tracks-scroll-wrapper');
    this.rulerContainer = document.getElementById('timeline-ruler');
    this.zoomLevelEl = document.getElementById('zoom-level');
    this.scrollbarTrack = document.getElementById('timeline-scrollbar-track');
    this.scrollbarThumb = document.getElementById('timeline-scrollbar-thumb');

    this.duration = 0;
    this.zoom = 1;
    this.scrollLeft = 0;
    this.waveformData = [];
    this.waveformAmplitude = 1.0; // Ctrl+scroll boost
    this.intervals = [];
    this.subtitles = [];
    this.collapsedMode = false;
    this.selectionStart = null;
    this.selectionEnd = null;
    this.isSelecting = false;
    this.isDraggingPlayhead = false;
    this.trackPanelWidth = 180;

    this.onSeek = null;
    this.onSelectionChange = null;

    this._init();
  }

  _init() {
    // Resize observer
    const ro = new ResizeObserver(debounce(() => this._render(), 50));
    ro.observe(this.rulerContainer);

    // --- Click to seek (on ruler) ---
    this.rulerContainer.addEventListener('mousedown', (e) => {
      const rect = this.rulerContainer.getBoundingClientRect();
      const x = e.clientX - rect.left + this.scrollLeft;
      const time = this._xToTime(x);
      this.player.seek(clamp(time, 0, this.duration));
    });

    // --- Click to seek (on track content) ---
    for (const tc of document.querySelectorAll('.track-content')) {
      tc.addEventListener('mousedown', (e) => {
        if (e.target.closest('.track-resize-handle')) return;
        const rect = tc.getBoundingClientRect();
        const x = e.clientX - rect.left + this.scrollLeft;
        const time = this._xToTime(x);
        this.player.seek(clamp(time, 0, this.duration));
      });
    }

    // --- Draggable playhead ---
    this.playhead.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.isDraggingPlayhead = true;
      document.body.style.cursor = 'col-resize';
    });

    window.addEventListener('mousemove', (e) => {
      if (this.isDraggingPlayhead) {
        const containerRect = this.scrollWrapper.getBoundingClientRect();
        const xInContainer = e.clientX - containerRect.left - this.trackPanelWidth;
        const x = xInContainer + this.scrollLeft;

        // If dragged past the left edge → go to 0
        if (xInContainer < 0) {
          this.player.seek(0);
        } else {
          const time = clamp(this._xToTime(x), 0, this.duration);
          this.player.seek(time);
        }
      }

      if (this.isSelecting) {
        const el = this.audioTrackCanvas.parentElement;
        const rect = el.getBoundingClientRect();
        const x = e.clientX - rect.left + this.scrollLeft;
        this.selectionEnd = clamp(this._xToTime(x), 0, this.duration);
        this._render();
      }
    });

    window.addEventListener('mouseup', () => {
      if (this.isDraggingPlayhead) {
        this.isDraggingPlayhead = false;
        document.body.style.cursor = '';
      }
      if (this.isSelecting) {
        this.isSelecting = false;
        if (this.selectionStart !== null && this.selectionEnd !== null) {
          const start = Math.min(this.selectionStart, this.selectionEnd);
          const end = Math.max(this.selectionStart, this.selectionEnd);
          if (end - start > 0.05 && this.onSelectionChange) {
            this.onSelectionChange(start, end);
          }
        }
      }
    });

    // --- Selection on audio track ---
    this.audioTrackCanvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const rect = this.audioTrackCanvas.parentElement.getBoundingClientRect();
      const x = e.clientX - rect.left + this.scrollLeft;
      this.selectionStart = clamp(this._xToTime(x), 0, this.duration);
      this.selectionEnd = this.selectionStart;
      this.isSelecting = true;
    });

    // --- Ctrl+Scroll to boost waveform amplitude ---
    this.audioTrackCanvas.parentElement.addEventListener('wheel', (e) => {
      if (e.ctrlKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.2 : 0.2;
        this.waveformAmplitude = clamp(this.waveformAmplitude + delta, 0.3, 5.0);
        this._render();
      }
    }, { passive: false });

    // --- Zoom buttons ---
    document.getElementById('btn-zoom-in').addEventListener('click', () => this.setZoom(this.zoom * 1.5));
    document.getElementById('btn-zoom-out').addEventListener('click', () => this.setZoom(this.zoom / 1.5));
    document.getElementById('btn-zoom-fit').addEventListener('click', () => this.setZoom(1));

    // --- Playhead update from player ---
    this.player.onTimeUpdate = throttle((time) => {
      this._updatePlayhead(time);
    }, 33);

    // --- Horizontal scroll sync ---
    this._initScrollSync();

    // --- Track height resize ---
    this._initTrackResize();
  }

  // === Scroll sync: ruler + all track-content share scrollLeft ===
  _initScrollSync() {
    // Use the custom scrollbar to drive scroll
    let isDraggingThumb = false;
    let thumbDragStartX = 0;
    let thumbDragStartLeft = 0;

    this.scrollbarThumb.addEventListener('mousedown', (e) => {
      e.preventDefault();
      isDraggingThumb = true;
      thumbDragStartX = e.clientX;
      thumbDragStartLeft = parseFloat(this.scrollbarThumb.style.left) || 0;
      document.body.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDraggingThumb) return;
      const trackWidth = this.scrollbarTrack.clientWidth;
      const thumbWidth = this.scrollbarThumb.clientWidth;
      const dx = e.clientX - thumbDragStartX;
      const newLeft = clamp(thumbDragStartLeft + dx, 0, trackWidth - thumbWidth);
      this.scrollbarThumb.style.left = `${newLeft}px`;

      // Convert thumb position to scroll position
      const scrollMax = this._getTotalWidth() - this._getViewWidth();
      if (scrollMax > 0) {
        this.scrollLeft = (newLeft / (trackWidth - thumbWidth)) * scrollMax;
      }
      this._applyScroll();
    });

    window.addEventListener('mouseup', () => {
      if (isDraggingThumb) {
        isDraggingThumb = false;
        document.body.style.cursor = '';
      }
    });

    // Click on scrollbar track to jump
    this.scrollbarTrack.addEventListener('click', (e) => {
      if (e.target === this.scrollbarThumb) return;
      const rect = this.scrollbarTrack.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const trackWidth = rect.width;
      const ratio = clickX / trackWidth;
      const scrollMax = this._getTotalWidth() - this._getViewWidth();
      this.scrollLeft = clamp(ratio * scrollMax, 0, scrollMax);
      this._applyScroll();
      this._updateScrollbar();
    });

    // Mouse wheel horizontal scroll on timeline area
    this.scrollWrapper.addEventListener('wheel', (e) => {
      if (e.ctrlKey) return; // Let ctrl+scroll go to amplitude
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) {
        e.preventDefault();
        const delta = e.deltaX || e.deltaY;
        const scrollMax = this._getTotalWidth() - this._getViewWidth();
        this.scrollLeft = clamp(this.scrollLeft + delta, 0, scrollMax);
        this._applyScroll();
        this._updateScrollbar();
      }
    }, { passive: false });
  }

  _applyScroll() {
    // Sync all scrollable areas
    this.rulerContainer.scrollLeft = this.scrollLeft;
    for (const tc of document.querySelectorAll('.track-content')) {
      tc.scrollLeft = this.scrollLeft;
    }
  }

  _updateScrollbar() {
    const totalWidth = this._getTotalWidth();
    const viewWidth = this._getViewWidth();
    const trackWidth = this.scrollbarTrack.clientWidth;

    if (totalWidth <= viewWidth) {
      this.scrollbarThumb.style.left = '0px';
      this.scrollbarThumb.style.width = `${trackWidth}px`;
      return;
    }

    const thumbWidth = Math.max(30, (viewWidth / totalWidth) * trackWidth);
    const scrollMax = totalWidth - viewWidth;
    const thumbLeft = (this.scrollLeft / scrollMax) * (trackWidth - thumbWidth);

    this.scrollbarThumb.style.width = `${thumbWidth}px`;
    this.scrollbarThumb.style.left = `${clamp(thumbLeft, 0, trackWidth - thumbWidth)}px`;
  }

  _getTotalWidth() {
    return this._getViewWidth() * this.zoom;
  }

  _getViewWidth() {
    return this.rulerContainer.clientWidth;
  }

  // === Track height resize ===
  _initTrackResize() {
    const handles = document.querySelectorAll('.track-resize-handle');
    handles.forEach(handle => {
      let startY = 0;
      let startHeight = 0;
      let trackRow = null;

      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        trackRow = handle.closest('.track-row');
        startY = e.clientY;
        startHeight = trackRow.offsetHeight;
        handle.classList.add('active');
        document.body.style.cursor = 'row-resize';

        const onMove = (ev) => {
          const dy = ev.clientY - startY;
          const minH = parseInt(trackRow.style.minHeight) || 30;
          const maxH = parseInt(trackRow.style.maxHeight) || 120;
          const newH = clamp(startHeight + dy, minH, maxH);
          trackRow.style.height = `${newH}px`;
          this._render();
        };

        const onUp = () => {
          handle.classList.remove('active');
          document.body.style.cursor = '';
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      });
    });
  }

  // === Public API ===
  setDuration(duration) {
    this.duration = duration;
    this._render();
    this._updateScrollbar();
  }

  setWaveform(data) {
    this.waveformData = data || [];
    this._render();
  }

  setIntervals(intervals) {
    this.intervals = intervals || [];
    this._render();
  }

  setCollapsedMode(collapsed) {
    this.collapsedMode = Boolean(collapsed);
    this._render();
  }

  setSubtitles(subtitles) {
    this.subtitles = subtitles || [];
    this._render();
  }

  setZoom(level) {
    this.zoom = clamp(level, 0.5, 20);
    this.zoomLevelEl.textContent = `${Math.round(this.zoom * 100)}%`;
    this._render();
    this._updateScrollbar();
  }

  // === Coordinate conversion ===
  _xToTime(x) {
    const totalWidth = this._getTotalWidth();
    return (x / totalWidth) * this.duration;
  }

  _timeToX(time) {
    const totalWidth = this._getTotalWidth();
    return (time / this.duration) * totalWidth;
  }

  _updatePlayhead(time) {
    const x = this._timeToX(time) - this.scrollLeft;
    this.playhead.style.transform = `translateX(${x}px)`;
  }

  // === Rendering ===
  _render() {
    if (this.duration <= 0) return;
    this._drawRuler();
    this._drawVideoTrack();
    this._drawAudioTrack();
    if (this.subtitles.length > 0) {
      this._drawSubtitleTrack();
    } else {
      this._clearCanvas(this.subtitleTrackCanvas);
    }
    // Update playhead position
    this._updatePlayhead(this.player.getCurrentTime());
  }

  _clearCanvas(canvas) {
    const parent = canvas.parentElement;
    if (!parent) return;
    const dpr = window.devicePixelRatio || 1;
    const width = this._getTotalWidth();
    const height = parent.clientHeight;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }

  _setupCanvas(canvas) {
    const parent = canvas.parentElement;
    const dpr = window.devicePixelRatio || 1;
    const totalW = this._getTotalWidth();
    const h = parent.clientHeight;

    canvas.width = totalW * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${totalW}px`;
    canvas.style.height = `${h}px`;

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    return { ctx, w: totalW, h };
  }

  _drawRuler() {
    const { ctx, w, h } = this._setupCanvas(this.rulerCanvas);

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, w, h);

    const pixelsPerSecond = w / this.duration;
    let tickInterval = 1;
    if (pixelsPerSecond < 5) tickInterval = 30;
    else if (pixelsPerSecond < 10) tickInterval = 15;
    else if (pixelsPerSecond < 20) tickInterval = 10;
    else if (pixelsPerSecond < 50) tickInterval = 5;
    else if (pixelsPerSecond < 100) tickInterval = 2;

    ctx.strokeStyle = '#cbd5e1';
    ctx.fillStyle = '#64748b';
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';

    for (let t = 0; t <= this.duration; t += tickInterval) {
      const x = this._timeToX(t);
      const isMajor = t % (tickInterval * 5) === 0 || tickInterval >= 10;

      ctx.beginPath();
      ctx.moveTo(x, h);
      ctx.lineTo(x, isMajor ? h - 16 : h - 8);
      ctx.lineWidth = isMajor ? 1 : 0.5;
      ctx.stroke();

      if (isMajor) {
        const mins = Math.floor(t / 60);
        const secs = Math.floor(t % 60);
        ctx.fillText(`${mins}:${String(secs).padStart(2, '0')}`, x, 10);
      }
    }

    if (pixelsPerSecond > 30) {
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 0.5;
      const minorInterval = tickInterval / 5;
      for (let t = 0; t <= this.duration; t += minorInterval) {
        const x = this._timeToX(t);
        ctx.beginPath();
        ctx.moveTo(x, h);
        ctx.lineTo(x, h - 4);
        ctx.stroke();
      }
    }
  }

  _drawVideoTrack() {
    const { ctx, w, h } = this._setupCanvas(this.videoTrackCanvas);
    ctx.clearRect(0, 0, w, h);

    if (!this.collapsedMode && this.intervals.length > 0) {
      for (const interval of this.intervals) {
        const x1 = this._timeToX(interval.start);
        const x2 = this._timeToX(interval.end);
        ctx.fillStyle = '#93c5fd';
        ctx.fillRect(x1, 2, x2 - x1, h - 4);
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 1;
        ctx.strokeRect(x1, 2, x2 - x1, h - 4);
      }

      ctx.fillStyle = '#fecaca40';
      let prevEnd = 0;
      for (const interval of this.intervals) {
        const gapX1 = this._timeToX(prevEnd);
        const gapX2 = this._timeToX(interval.start);
        if (gapX2 - gapX1 > 1) {
          ctx.fillRect(gapX1, 2, gapX2 - gapX1, h - 4);
          ctx.strokeStyle = '#f8717130';
          ctx.lineWidth = 0.5;
          for (let lx = gapX1; lx < gapX2; lx += 6) {
            ctx.beginPath();
            ctx.moveTo(lx, 2);
            ctx.lineTo(lx + h, h - 2);
            ctx.stroke();
          }
        }
        prevEnd = interval.end;
      }
    } else {
      ctx.fillStyle = '#93c5fd';
      ctx.fillRect(0, 2, w, h - 4);
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 1;
      ctx.strokeRect(0, 2, w, h - 4);
    }

    this._drawSelection(ctx, h);
  }

  _drawAudioTrack() {
    const { ctx, w, h } = this._setupCanvas(this.audioTrackCanvas);
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = '#f0fdf4';
    ctx.fillRect(0, 0, w, h);

    if (this.waveformData.length === 0) return;

    const samplesPerPixel = this.waveformData.length / w;
    const amp = Math.max(0.4, Math.min(this.waveformAmplitude, 5));
    const peaks = [];
    const nonZeroPeaks = [];

    for (let px = 0; px < w; px += 1) {
      const sampleIdx = Math.floor(px * samplesPerPixel);
      const endIdx = Math.min(Math.max(sampleIdx + 1, Math.floor((px + 1) * samplesPerPixel)), this.waveformData.length);

      let maxVal = 0;
      for (let i = sampleIdx; i < endIdx; i += 1) {
        if (this.waveformData[i] > maxVal) maxVal = this.waveformData[i];
      }
      peaks.push(maxVal);
      if (maxVal > 0) nonZeroPeaks.push(maxVal);
    }

    const sortedPeaks = nonZeroPeaks.sort((a, b) => a - b);
    const referencePeak = this._percentile(sortedPeaks, 0.985) || this._percentile(sortedPeaks, 0.9) || 1;
    const verticalPadding = h <= 40 ? 2 : 3;
    const availableHeight = Math.max(h - verticalPadding * 2, 1);
    const mid = h / 2;
    const minBarHeight = Math.min(5, Math.max(2.25, availableHeight * 0.055));
    const columnW = 1.12;

    ctx.fillStyle = '#16a34a';
    ctx.globalAlpha = 0.95;

    for (let px = 0; px < w; px += 1) {
      const normalizedPeak = referencePeak > 0 ? Math.max(0, Math.min(peaks[px] / referencePeak, 1)) : 0;
      const shapedPeak = normalizedPeak > 0 ? Math.pow(normalizedPeak, 0.58) : 0;
      const scaledPeak = Math.max(0, Math.min(shapedPeak * amp, 1));
      const barH = Math.max(minBarHeight, scaledPeak * availableHeight);
      ctx.fillRect(px, mid - barH / 2, columnW, barH);
    }

    ctx.globalAlpha = 1;

    ctx.strokeStyle = '#16a34a26';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(w, mid);
    ctx.stroke();

    if (!this.collapsedMode && this.intervals.length > 0) {
      ctx.fillStyle = '#ef444420';
      let prevEnd = 0;
      for (const interval of this.intervals) {
        const x1 = this._timeToX(prevEnd);
        const x2 = this._timeToX(interval.start);
        if (x2 - x1 > 0) ctx.fillRect(x1, 0, x2 - x1, h);
        prevEnd = interval.end;
      }
      const lastX = this._timeToX(prevEnd);
      const endX = this._timeToX(this.duration);
      if (endX - lastX > 0) ctx.fillRect(lastX, 0, endX - lastX, h);
    }

    this._drawSelection(ctx, h);
  }

  _percentile(sortedValues, ratio) {
    if (!sortedValues.length) return 0;
    const index = Math.max(0, Math.min(sortedValues.length - 1, Math.floor((sortedValues.length - 1) * ratio)));
    return sortedValues[index];
  }

  _drawSubtitleTrack() {
    const { ctx, w, h } = this._setupCanvas(this.subtitleTrackCanvas);
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = '#fffbeb';
    ctx.fillRect(0, 0, w, h);

    for (const sub of this.subtitles) {
      const x1 = this._timeToX(sub.start);
      const x2 = this._timeToX(sub.end);
      const blockW = Math.max(x2 - x1, 2);

      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(x1, 4, blockW, h - 8);
      ctx.strokeStyle = '#d97706';
      ctx.lineWidth = 1;
      ctx.strokeRect(x1, 4, blockW, h - 8);

      if (blockW > 30) {
        ctx.fillStyle = '#78350f';
        ctx.font = '10px Inter, system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.save();
        ctx.beginPath();
        ctx.rect(x1 + 3, 4, blockW - 6, h - 8);
        ctx.clip();
        ctx.fillText(sub.text, x1 + 4, h / 2 + 3);
        ctx.restore();
      }
    }
  }

  _drawSelection(ctx, h) {
    if (this.selectionStart !== null && this.selectionEnd !== null) {
      const x1 = this._timeToX(Math.min(this.selectionStart, this.selectionEnd));
      const x2 = this._timeToX(Math.max(this.selectionStart, this.selectionEnd));
      if (x2 - x1 > 1) {
        ctx.fillStyle = '#6366f120';
        ctx.fillRect(x1, 0, x2 - x1, h);
        ctx.strokeStyle = '#6366f1';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x1, 0); ctx.lineTo(x1, h);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x2, 0); ctx.lineTo(x2, h);
        ctx.stroke();
      }
    }
  }

  clearSelection() {
    this.selectionStart = null;
    this.selectionEnd = null;
    this._render();
  }

  // === Serialization for project save/load ===
  getState() {
    return {
      zoom: this.zoom,
      waveformAmplitude: this.waveformAmplitude,
      intervals: this.intervals,
      subtitles: this.subtitles,
      collapsedMode: this.collapsedMode,
      trackHeights: {
        video: document.getElementById('track-video')?.offsetHeight || 48,
        audio: document.getElementById('track-audio')?.offsetHeight || 48,
        subtitle: document.getElementById('subtitle-track')?.offsetHeight || 48,
      },
    };
  }

  loadState(state) {
    if (state.zoom !== undefined) this.setZoom(state.zoom);
    if (state.waveformAmplitude !== undefined) this.waveformAmplitude = state.waveformAmplitude;
    if (state.collapsedMode !== undefined) this.collapsedMode = state.collapsedMode;
    if (state.intervals) this.setIntervals(state.intervals);
    if (state.subtitles) this.setSubtitles(state.subtitles);
    if (state.trackHeights) {
      const vh = state.trackHeights.video;
      const ah = state.trackHeights.audio;
      const sh = state.trackHeights.subtitle;
      if (vh) document.getElementById('track-video').style.height = `${vh}px`;
      if (ah) document.getElementById('track-audio').style.height = `${ah}px`;
      if (sh) document.getElementById('subtitle-track').style.height = `${sh}px`;
    }
    this._render();
    this._updateScrollbar();
  }
}
