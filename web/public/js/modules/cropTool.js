/**
 * Crop Tool Module
 * Visual crop selection overlay on the video
 */

import { clamp } from '../utils/helpers.js';

export class CropTool {
  constructor() {
    this.overlay = document.getElementById('crop-overlay');
    this.canvas = document.getElementById('crop-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.video = document.getElementById('video-original');

    this.isActive = false;
    this.isDragging = false;
    this.dragType = null; // 'create', 'move', 'resize-tl', 'resize-tr', etc.

    // Crop region in video-relative coordinates (0-1)
    this.cropRect = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };

    // Raw pixel positions
    this.startX = 0;
    this.startY = 0;
    this.moveStartRect = null;

    this.onCropChange = null;

    this._bindEvents();
  }

  activate() {
    this.isActive = true;
    this.overlay.classList.remove('hidden');
    this._render();
  }

  deactivate() {
    this.isActive = false;
    this.overlay.classList.add('hidden');
  }

  toggle() {
    if (this.isActive) this.deactivate();
    else this.activate();
  }

  getCropPixels() {
    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    return {
      x: Math.round(this.cropRect.x * vw),
      y: Math.round(this.cropRect.y * vh),
      width: Math.round(this.cropRect.w * vw),
      height: Math.round(this.cropRect.h * vh),
    };
  }

  _bindEvents() {
    this.canvas.addEventListener('mousedown', (e) => this._onMouseDown(e));
    window.addEventListener('mousemove', (e) => this._onMouseMove(e));
    window.addEventListener('mouseup', (e) => this._onMouseUp(e));

    // Resize canvas when video container changes
    const ro = new ResizeObserver(() => {
      if (this.isActive) this._render();
    });
    ro.observe(this.overlay);
  }

  _getCanvasCoords(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
  }

  _onMouseDown(e) {
    if (!this.isActive) return;
    const { x, y } = this._getCanvasCoords(e);

    this.isDragging = true;
    this.startX = x;
    this.startY = y;

    // Check if clicking on handles
    const handle = this._getHandle(x, y);
    if (handle) {
      this.dragType = handle;
    } else if (this._isInside(x, y)) {
      this.dragType = 'move';
      this.moveStartRect = { ...this.cropRect };
    } else {
      this.dragType = 'create';
      this.cropRect = { x, y, w: 0, h: 0 };
    }
  }

  _onMouseMove(e) {
    if (!this.isDragging || !this.isActive) return;
    const { x, y } = this._getCanvasCoords(e);

    const dx = x - this.startX;
    const dy = y - this.startY;

    if (this.dragType === 'create') {
      this.cropRect.w = x - this.cropRect.x;
      this.cropRect.h = y - this.cropRect.y;
    } else if (this.dragType === 'move') {
      this.cropRect.x = clamp(this.moveStartRect.x + dx, 0, 1 - this.cropRect.w);
      this.cropRect.y = clamp(this.moveStartRect.y + dy, 0, 1 - this.cropRect.h);
    } else if (this.dragType.startsWith('resize')) {
      this._handleResize(this.dragType, dx, dy);
    }

    this._render();
  }

  _onMouseUp() {
    if (!this.isDragging) return;
    this.isDragging = false;

    // Normalize negative dimensions
    if (this.cropRect.w < 0) {
      this.cropRect.x += this.cropRect.w;
      this.cropRect.w = Math.abs(this.cropRect.w);
    }
    if (this.cropRect.h < 0) {
      this.cropRect.y += this.cropRect.h;
      this.cropRect.h = Math.abs(this.cropRect.h);
    }

    // Clamp
    this.cropRect.x = clamp(this.cropRect.x, 0, 1);
    this.cropRect.y = clamp(this.cropRect.y, 0, 1);
    this.cropRect.w = clamp(this.cropRect.w, 0.01, 1 - this.cropRect.x);
    this.cropRect.h = clamp(this.cropRect.h, 0.01, 1 - this.cropRect.y);

    if (this.onCropChange) {
      this.onCropChange(this.getCropPixels());
    }

    this._render();
  }

  _isInside(x, y) {
    const r = this.cropRect;
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  _getHandle(x, y) {
    const r = this.cropRect;
    const s = 0.02; // handle size in relative units

    const corners = {
      'resize-tl': [r.x, r.y],
      'resize-tr': [r.x + r.w, r.y],
      'resize-bl': [r.x, r.y + r.h],
      'resize-br': [r.x + r.w, r.y + r.h],
    };

    for (const [type, [cx, cy]] of Object.entries(corners)) {
      if (Math.abs(x - cx) < s && Math.abs(y - cy) < s) {
        return type;
      }
    }
    return null;
  }

  _handleResize(type, dx, dy) {
    const r = this.moveStartRect || this.cropRect;
    if (type === 'resize-br') {
      this.cropRect.w = Math.max(0.01, r.w + dx);
      this.cropRect.h = Math.max(0.01, r.h + dy);
    }
  }

  _render() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.overlay.clientWidth;
    const h = this.overlay.clientHeight;

    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.scale(dpr, dpr);

    // Clear
    this.ctx.clearRect(0, 0, w, h);

    const r = this.cropRect;
    const rx = r.x * w;
    const ry = r.y * h;
    const rw = r.w * w;
    const rh = r.h * h;

    // Darken outside
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    this.ctx.fillRect(0, 0, w, h);

    // Clear crop region
    this.ctx.clearRect(rx, ry, rw, rh);

    // Border
    this.ctx.strokeStyle = '#6366f1';
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(rx, ry, rw, rh);

    // Grid lines (rule of thirds)
    this.ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    this.ctx.lineWidth = 1;
    for (let i = 1; i < 3; i++) {
      // Vertical
      this.ctx.beginPath();
      this.ctx.moveTo(rx + rw * i / 3, ry);
      this.ctx.lineTo(rx + rw * i / 3, ry + rh);
      this.ctx.stroke();
      // Horizontal
      this.ctx.beginPath();
      this.ctx.moveTo(rx, ry + rh * i / 3);
      this.ctx.lineTo(rx + rw, ry + rh * i / 3);
      this.ctx.stroke();
    }

    // Corner handles
    this.ctx.fillStyle = '#6366f1';
    const handleSize = 8;
    const corners = [
      [rx, ry], [rx + rw, ry],
      [rx, ry + rh], [rx + rw, ry + rh],
    ];
    for (const [cx, cy] of corners) {
      this.ctx.fillRect(cx - handleSize / 2, cy - handleSize / 2, handleSize, handleSize);
    }

    // Dimension label
    const pixels = this.getCropPixels();
    this.ctx.fillStyle = 'rgba(0,0,0,0.7)';
    this.ctx.font = '12px "JetBrains Mono", monospace';
    this.ctx.textAlign = 'center';
    this.ctx.fillStyle = '#fff';
    this.ctx.fillText(`${pixels.width} × ${pixels.height}`, rx + rw / 2, ry + rh + 18);
  }
}
