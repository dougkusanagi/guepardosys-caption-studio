/**
 * Video Player Module
 * Manages dual video playback (original + processed)
 */

import { formatTime, throttle } from '../utils/helpers.js';

export class VideoPlayer {
  constructor() {
    this.originalVideo = document.getElementById('video-original');
    this.processedVideo = document.getElementById('video-processed');
    this.processedPanel = document.getElementById('processed-panel');
    this.btnPlay = document.getElementById('btn-play');
    this.playIcon = document.getElementById('play-icon');
    this.btnSkipBack = document.getElementById('btn-skip-back');
    this.btnSkipForward = document.getElementById('btn-skip-forward');
    this.currentTimeEl = document.getElementById('current-time');
    this.totalTimeEl = document.getElementById('total-time');
    this.originalTimeEl = document.getElementById('original-time');
    this.processedTimeEl = document.getElementById('processed-time');
    this.speedSelect = document.getElementById('speed-select');
    this.volumeSlider = document.getElementById('volume-slider');
    this.btnMute = document.getElementById('btn-mute');
    this.volumeIcon = document.getElementById('volume-icon');

    this.isPlaying = false;
    this.duration = 0;
    this.onTimeUpdate = null;
    this.onDurationChange = null;

    this._bindEvents();
  }

  _bindEvents() {
    // Play/Pause
    this.btnPlay.addEventListener('click', () => this.togglePlay());

    // Keyboard shortcut
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
      if (e.code === 'Space') {
        e.preventDefault();
        this.togglePlay();
      }
      if (e.code === 'ArrowLeft') {
        e.preventDefault();
        this.skip(-5);
      }
      if (e.code === 'ArrowRight') {
        e.preventDefault();
        this.skip(5);
      }
    });

    // Skip buttons
    this.btnSkipBack.addEventListener('click', () => this.skip(-5));
    this.btnSkipForward.addEventListener('click', () => this.skip(5));

    // Time update
    const updateTime = throttle(() => {
      const time = this.originalVideo.currentTime;
      this.currentTimeEl.textContent = formatTime(time);
      this.originalTimeEl.textContent = formatTime(time);
      if (this.onTimeUpdate) this.onTimeUpdate(time);
    }, 33);

    this.originalVideo.addEventListener('timeupdate', updateTime);

    // Duration
    this.originalVideo.addEventListener('loadedmetadata', () => {
      this.duration = this.originalVideo.duration;
      this.totalTimeEl.textContent = formatTime(this.duration);
      if (this.onDurationChange) this.onDurationChange(this.duration);
    });

    // End
    this.originalVideo.addEventListener('ended', () => {
      this.isPlaying = false;
      this._updatePlayButton();
    });

    // Speed
    this.speedSelect.addEventListener('change', () => {
      const speed = parseFloat(this.speedSelect.value);
      this.originalVideo.playbackRate = speed;
      if (this.processedVideo.src) this.processedVideo.playbackRate = speed;
    });

    // Volume
    this.volumeSlider.addEventListener('input', () => {
      this.originalVideo.volume = this.volumeSlider.value;
      if (this.processedVideo.src) this.processedVideo.volume = this.volumeSlider.value;
      this._updateVolumeIcon();
    });

    // Mute
    this.btnMute.addEventListener('click', () => {
      this.originalVideo.muted = !this.originalVideo.muted;
      if (this.processedVideo.src) this.processedVideo.muted = this.originalVideo.muted;
      this._updateVolumeIcon();
    });

    // Processed video time update
    this.processedVideo.addEventListener('timeupdate', throttle(() => {
      this.processedTimeEl.textContent = formatTime(this.processedVideo.currentTime);
    }, 33));
  }

  loadOriginal(src) {
    this.originalVideo.src = src;
    this.originalVideo.load();
  }

  loadProcessed(src) {
    this.processedVideo.src = src;
    this.processedVideo.load();
    this.processedPanel.classList.remove('hidden');
  }

  togglePlay() {
    if (this.isPlaying) {
      this.originalVideo.pause();
      if (this.processedVideo.src) this.processedVideo.pause();
    } else {
      this.originalVideo.play();
      if (this.processedVideo.src) this.processedVideo.play();
    }
    this.isPlaying = !this.isPlaying;
    this._updatePlayButton();
  }

  seek(time) {
    this.originalVideo.currentTime = time;
    this.currentTimeEl.textContent = formatTime(time);
    this.originalTimeEl.textContent = formatTime(time);
  }

  skip(seconds) {
    const newTime = Math.max(0, Math.min(this.duration, this.originalVideo.currentTime + seconds));
    this.seek(newTime);
  }

  getCurrentTime() {
    return this.originalVideo.currentTime;
  }

  getDuration() {
    return this.duration;
  }

  _updatePlayButton() {
    const iconName = this.isPlaying ? 'pause' : 'play';
    this.playIcon.setAttribute('data-lucide', iconName);
    this.playIcon.classList.toggle('ml-0.5', !this.isPlaying);
    if (window.lucide) lucide.createIcons({ nodes: [this.playIcon] });
  }

  _updateVolumeIcon() {
    const vol = this.originalVideo.muted ? 0 : parseFloat(this.volumeSlider.value);
    let iconName = 'volume-2';
    if (vol === 0) iconName = 'volume-x';
    else if (vol < 0.5) iconName = 'volume-1';
    this.volumeIcon.setAttribute('data-lucide', iconName);
    if (window.lucide) lucide.createIcons({ nodes: [this.volumeIcon] });
  }
}
