/**
 * Timeline Module
 * Multi-track timeline with ruler, waveform, video thumbnails, playhead, zoom, and selection
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
    this.tracksContainer = document.getElementById('tracks-container');
    this.zoomLevelEl = document.getElementById('zoom-level');

    this.duration = 0;
    this.zoom = 1;
    this.scrollOffset = 0;
    this.waveformData = [];
    this.intervals = [];
    this.subtitles = [];
    this.selectionStart = null;
    this.selectionEnd = null;
    this.isSelecting = false;
    this.trackPanelWidth = 180;

    this.onSeek = null;
    this.onSelectionChange = null;

    this._resizeObserver = null;
    this._animFrame = null;

    this._init();
  }

  _init() {
    // Resize
    this._resizeObserver = new ResizeObserver(debounce(() => this._render(), 50));
    this._resizeObserver.observe(this.rulerCanvas.parentElement);
    this._resizeObserver.observe(this.audioTrackCanvas.parentElement);

    // Click to seek
    const handleSeek = (e) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const time = this._xToTime(x);
      if (time >= 0 && time <= this.duration) {
        this.player.seek(time);
        if (this.onSeek) this.onSeek(time);
      }
    };

    this.rulerCanvas.parentElement.addEventListener('click', handleSeek);
    this.videoTrackCanvas.parentElement.addEventListener('click', handleSeek);
    this.audioTrackCanvas.parentElement.addEventListener('click', handleSeek);

    // Selection on audio track
    this.audioTrackCanvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const rect = this.audioTrackCanvas.getBoundingClientRect();
      this.selectionStart = this._xToTime(e.clientX - rect.left);
      this.selectionEnd = this.selectionStart;
      this.isSelecting = true;
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isSelecting) return;
      const rect = this.audioTrackCanvas.getBoundingClientRect();
      this.selectionEnd = this._xToTime(e.clientX - rect.left);
      this._render();
    });

    window.addEventListener('mouseup', () => {
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

    // Zoom buttons
    document.getElementById('btn-zoom-in').addEventListener('click', () => this.setZoom(this.zoom * 1.5));
    document.getElementById('btn-zoom-out').addEventListener('click', () => this.setZoom(this.zoom / 1.5));
    document.getElementById('btn-zoom-fit').addEventListener('click', () => this.setZoom(1));

    // Playhead update
    this.player.onTimeUpdate = throttle((time) => {
      this._updatePlayhead(time);
    }, 33);

    // Scroll sync
    this.tracksContainer.addEventListener('scroll', () => {
      this.scrollOffset = this.tracksContainer.scrollLeft;
    });
  }

  setDuration(duration) {
    this.duration = duration;
    this._render();
  }

  setWaveform(data) {
    this.waveformData = data || [];
    this._render();
  }

  setIntervals(intervals) {
    this.intervals = intervals || [];
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
  }

  _xToTime(x) {
    const width = this.audioTrackCanvas.parentElement.clientWidth;
    const totalWidth = width * this.zoom;
    return (x / totalWidth) * this.duration;
  }

  _timeToX(time) {
    const width = this.audioTrackCanvas.parentElement.clientWidth;
    const totalWidth = width * this.zoom;
    return (time / this.duration) * totalWidth;
  }

  _updatePlayhead(time) {
    const x = this._timeToX(time);
    this.playhead.style.transform = `translateX(${x}px)`;
  }

  _render() {
    if (this.duration <= 0) return;

    this._drawRuler();
    this._drawVideoTrack();
    this._drawAudioTrack();
    if (this.subtitles.length > 0) {
      this._drawSubtitleTrack();
    }
  }

  _setupCanvas(canvas) {
    const parent = canvas.parentElement;
    const dpr = window.devicePixelRatio || 1;
    const w = parent.clientWidth * this.zoom;
    const h = parent.clientHeight;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    return { ctx, w, h };
  }

  _drawRuler() {
    const { ctx, w, h } = this._setupCanvas(this.rulerCanvas);

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, w, h);

    // Calculate tick interval based on zoom
    let tickInterval = 1; // seconds
    const pixelsPerSecond = w / this.duration;
    if (pixelsPerSecond < 5) tickInterval = 30;
    else if (pixelsPerSecond < 10) tickInterval = 15;
    else if (pixelsPerSecond < 20) tickInterval = 10;
    else if (pixelsPerSecond < 50) tickInterval = 5;
    else if (pixelsPerSecond < 100) tickInterval = 2;

    // Draw ticks
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

    // Minor ticks
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

    // Background
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#dbeafe');
    grad.addColorStop(1, '#eff6ff');
    ctx.fillStyle = grad;

    if (this.intervals.length > 0) {
      // Draw kept segments
      for (const interval of this.intervals) {
        const x1 = this._timeToX(interval.start);
        const x2 = this._timeToX(interval.end);
        ctx.fillStyle = '#93c5fd';
        ctx.fillRect(x1, 2, x2 - x1, h - 4);

        // Border
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 1;
        ctx.strokeRect(x1, 2, x2 - x1, h - 4);
      }

      // Draw removed segments (gaps between intervals)
      ctx.fillStyle = '#fecaca40';
      let prevEnd = 0;
      for (const interval of this.intervals) {
        const gapX1 = this._timeToX(prevEnd);
        const gapX2 = this._timeToX(interval.start);
        if (gapX2 - gapX1 > 1) {
          ctx.fillRect(gapX1, 2, gapX2 - gapX1, h - 4);
          // Diagonal lines pattern for removed
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
      // Full video bar
      ctx.fillRect(0, 2, w, h - 4);
      ctx.fillStyle = '#93c5fd';
      ctx.fillRect(0, 2, w, h - 4);
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 1;
      ctx.strokeRect(0, 2, w, h - 4);
    }

    // Draw selection overlay
    this._drawSelection(ctx, h);
  }

  _drawAudioTrack() {
    const { ctx, w, h } = this._setupCanvas(this.audioTrackCanvas);
    ctx.clearRect(0, 0, w, h);

    // Background
    ctx.fillStyle = '#f0fdf4';
    ctx.fillRect(0, 0, w, h);

    if (this.waveformData.length === 0) return;

    // Draw waveform
    const mid = h / 2;
    const samplesPerPixel = this.waveformData.length / w;

    ctx.fillStyle = '#22c55e';
    ctx.globalAlpha = 0.6;

    for (let px = 0; px < w; px++) {
      const sampleIdx = Math.floor(px * samplesPerPixel);
      const endIdx = Math.min(Math.floor((px + 1) * samplesPerPixel), this.waveformData.length);

      let maxVal = 0;
      for (let i = sampleIdx; i < endIdx; i++) {
        if (this.waveformData[i] > maxVal) maxVal = this.waveformData[i];
      }

      const barH = maxVal * (h * 0.8);
      ctx.fillRect(px, mid - barH / 2, 1, barH);
    }

    ctx.globalAlpha = 1;

    // Center line
    ctx.strokeStyle = '#16a34a40';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(w, mid);
    ctx.stroke();

    // Draw silence regions if intervals exist
    if (this.intervals.length > 0) {
      ctx.fillStyle = '#ef444420';
      let prevEnd = 0;
      for (const interval of this.intervals) {
        const x1 = this._timeToX(prevEnd);
        const x2 = this._timeToX(interval.start);
        if (x2 - x1 > 0) {
          ctx.fillRect(x1, 0, x2 - x1, h);
        }
        prevEnd = interval.end;
      }
      // Last gap
      const lastX = this._timeToX(prevEnd);
      const endX = this._timeToX(this.duration);
      if (endX - lastX > 0) {
        ctx.fillRect(lastX, 0, endX - lastX, h);
      }
    }

    // Draw selection overlay
    this._drawSelection(ctx, h);
  }

  _drawSubtitleTrack() {
    const { ctx, w, h } = this._setupCanvas(this.subtitleTrackCanvas);
    ctx.clearRect(0, 0, w, h);

    // Background
    ctx.fillStyle = '#fffbeb';
    ctx.fillRect(0, 0, w, h);

    // Draw subtitle blocks
    for (const sub of this.subtitles) {
      const x1 = this._timeToX(sub.start);
      const x2 = this._timeToX(sub.end);
      const blockW = Math.max(x2 - x1, 2);

      // Block
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(x1, 4, blockW, h - 8);

      // Border
      ctx.strokeStyle = '#d97706';
      ctx.lineWidth = 1;
      ctx.strokeRect(x1, 4, blockW, h - 8);

      // Text (if enough space)
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
}
