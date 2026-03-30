/**
 * Spectrogram Module
 * Real-time audio spectrogram visualization using Web Audio API
 */

export class Spectrogram {
  constructor() {
    this.canvas = document.getElementById('spectrogram-canvas');
    this.panel = document.getElementById('spectrogram-panel');
    this.ctx = null;
    this.audioContext = null;
    this.analyser = null;
    this.source = null;
    this.audioBuffer = null;
    this.isVisible = false;
    this.animId = null;
    this.spectrogramImage = null;
  }

  async loadAudio(audioUrl) {
    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();

      const response = await fetch(audioUrl);
      const arrayBuffer = await response.arrayBuffer();
      this.audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

      // Generate full spectrogram image
      this._generateFullSpectrogram();
    } catch (err) {
      console.error('[Spectrogram] Failed to load audio:', err);
    }
  }

  show() {
    this.isVisible = true;
    this.panel.classList.remove('hidden');
    if (this.spectrogramImage) {
      this._drawStaticSpectrogram();
    }
  }

  hide() {
    this.isVisible = false;
    this.panel.classList.add('hidden');
  }

  toggle() {
    if (this.isVisible) this.hide();
    else this.show();
  }

  updatePlayhead(currentTime, duration) {
    if (!this.isVisible || !this.spectrogramImage) return;
    this._drawStaticSpectrogram();

    // Draw playhead
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.width / dpr;
    const h = this.canvas.height / dpr;
    const x = (currentTime / duration) * w;

    const ctx = this.canvas.getContext('2d');
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }

  _generateFullSpectrogram() {
    if (!this.audioBuffer) return;

    const channelData = this.audioBuffer.getChannelData(0);
    const sampleRate = this.audioBuffer.sampleRate;

    // FFT parameters
    const fftSize = 1024;
    const hopSize = 512;
    const numFrames = Math.floor((channelData.length - fftSize) / hopSize);
    const numBins = fftSize / 2;

    // Create offscreen canvas for spectrogram image
    const offscreen = document.createElement('canvas');
    offscreen.width = numFrames;
    offscreen.height = numBins;
    const offCtx = offscreen.getContext('2d');
    const imageData = offCtx.createImageData(numFrames, numBins);

    // Simple DFT-based spectrogram (using windowed segments)
    for (let frame = 0; frame < numFrames; frame++) {
      const start = frame * hopSize;
      const segment = new Float32Array(fftSize);

      // Apply Hanning window
      for (let i = 0; i < fftSize; i++) {
        const windowVal = 0.5 * (1 - Math.cos(2 * Math.PI * i / (fftSize - 1)));
        segment[i] = (channelData[start + i] || 0) * windowVal;
      }

      // Compute magnitude spectrum using simple approach
      const magnitudes = this._computeFFTMagnitudes(segment);

      // Map to image
      for (let bin = 0; bin < numBins; bin++) {
        const y = numBins - 1 - bin; // Flip vertically
        const idx = (y * numFrames + frame) * 4;

        // Convert to dB scale
        const db = 20 * Math.log10(Math.max(magnitudes[bin], 1e-10));
        const normalized = Math.max(0, Math.min(1, (db + 80) / 80));

        // Color map (cool blue to warm orange)
        const [r, g, b] = this._spectrogramColor(normalized);
        imageData.data[idx] = r;
        imageData.data[idx + 1] = g;
        imageData.data[idx + 2] = b;
        imageData.data[idx + 3] = 255;
      }
    }

    offCtx.putImageData(imageData, 0, 0);
    this.spectrogramImage = offscreen;

    if (this.isVisible) {
      this._drawStaticSpectrogram();
    }
  }

  _computeFFTMagnitudes(signal) {
    const N = signal.length;
    const numBins = N / 2;
    const magnitudes = new Float32Array(numBins);

    // Simple DFT — for a real implementation, use FFT library
    // But this is good enough for visualization
    for (let k = 0; k < numBins; k++) {
      let re = 0, im = 0;
      // Use stride for performance (skip some samples)
      const stride = Math.max(1, Math.floor(N / 256));
      for (let n = 0; n < N; n += stride) {
        const angle = -2 * Math.PI * k * n / N;
        re += signal[n] * Math.cos(angle);
        im += signal[n] * Math.sin(angle);
      }
      magnitudes[k] = Math.sqrt(re * re + im * im) * stride / N;
    }

    return magnitudes;
  }

  _spectrogramColor(value) {
    // Dark-to-bright color map
    if (value < 0.2) {
      const t = value / 0.2;
      return [
        Math.round(15 + t * 25),
        Math.round(23 + t * 20),
        Math.round(42 + t * 40)
      ];
    }
    if (value < 0.5) {
      const t = (value - 0.2) / 0.3;
      return [
        Math.round(40 + t * 60),
        Math.round(43 + t * 50),
        Math.round(82 + t * 80)
      ];
    }
    if (value < 0.75) {
      const t = (value - 0.5) / 0.25;
      return [
        Math.round(100 + t * 155),
        Math.round(93 + t * 80),
        Math.round(162 - t * 80)
      ];
    }
    const t = (value - 0.75) / 0.25;
    return [
      255,
      Math.round(173 + t * 82),
      Math.round(82 + t * 40)
    ];
  }

  _drawStaticSpectrogram() {
    if (!this.spectrogramImage) return;

    const dpr = window.devicePixelRatio || 1;
    const parent = this.canvas.parentElement;
    const w = parent.clientWidth;
    const h = parent.clientHeight;

    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;

    const ctx = this.canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    // Draw spectrogram image scaled to canvas
    ctx.drawImage(this.spectrogramImage, 0, 0, w, h);
  }
}
