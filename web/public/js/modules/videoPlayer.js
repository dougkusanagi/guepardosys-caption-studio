/**
 * Video Player Module
 * Manages dual preview playback with support for:
 * - Original/process preview toggles
 * - Subtitle overlay preview
 * - Edited timeline mapping after silence removal
 */

import { formatTime, throttle, clamp } from '../utils/helpers.js';

export class VideoPlayer {
  constructor() {
    this.originalVideo = document.getElementById('video-original');
    this.processedVideo = document.getElementById('video-processed');
    this.originalPanel = document.getElementById('original-panel');
    this.processedPanel = document.getElementById('processed-panel');
    this.processedSubtitleOverlay = document.getElementById('processed-subtitle-overlay');
    this.btnPlay = document.getElementById('btn-play');
    this.playIcon = document.getElementById('play-icon');
    this.btnSkipBack = document.getElementById('btn-skip-back');
    this.btnSkipForward = document.getElementById('btn-skip-forward');
    this.currentTimeInput = document.getElementById('current-time');
    this.totalTimeEl = document.getElementById('total-time');
    this.originalTimeEl = document.getElementById('original-time');
    this.processedTimeEl = document.getElementById('processed-time');
    this.speedSelect = document.getElementById('speed-select');
    this.volumeSlider = document.getElementById('volume-slider');
    this.btnMute = document.getElementById('btn-mute');
    this.volumeIcon = document.getElementById('volume-icon');

    this.isPlaying = false;
    this.duration = 0;
    this.originalDuration = 0;
    this.lastDisplayTime = 0;
    this.onTimeUpdate = null;
    this.onDurationChange = null;

    this.originalSource = '';
    this.realProcessedSource = '';
    this.originalVisible = true;
    this.processedVisible = false;
    this.processedLoaded = false;
    this.hasRealProcessedOutput = false;

    this.userVolume = parseFloat(this.volumeSlider.value || '1');
    this.userMuted = false;

    this.editIntervals = [];
    this.timelineMap = [];
    this.subtitles = [];

    this.pendingOriginalTime = null;
    this.pendingProcessedTime = null;
    this.suppressOriginalTimeUpdate = false;
    this.suppressProcessedTimeUpdate = false;

    this._bindEvents();
    this._syncAudioRouting();
    this._refreshDisplay(0);
  }

  _bindEvents() {
    this.btnPlay.addEventListener('click', () => this.togglePlay());

    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
      if (e.code === 'Space') { e.preventDefault(); this.togglePlay(); }
      if (e.code === 'ArrowLeft') { e.preventDefault(); this.skip(-5); }
      if (e.code === 'ArrowRight') { e.preventDefault(); this.skip(5); }
    });

    this.btnSkipBack.addEventListener('click', () => this.skip(-5));
    this.btnSkipForward.addEventListener('click', () => this.skip(5));

    this.originalVideo.addEventListener('timeupdate', throttle(() => this._handleOriginalTimeUpdate(), 33));
    this.processedVideo.addEventListener('timeupdate', throttle(() => this._handleProcessedTimeUpdate(), 33));

    this.originalVideo.addEventListener('loadedmetadata', () => {
      this.originalDuration = this.originalVideo.duration || 0;
      if (!this.hasEditedTimeline()) {
        this._setDisplayDuration(this.originalDuration);
      }
      this._applyPendingTime(this.originalVideo, 'original');
      this._refreshDisplay(this.getCurrentTime());
    });

    this.processedVideo.addEventListener('loadedmetadata', () => {
      if (this.hasRealProcessedOutput && !this.hasEditedTimeline()) {
        this._setDisplayDuration(this.processedVideo.duration || this.originalDuration);
      }
      this._applyPendingTime(this.processedVideo, 'processed');
      this._refreshDisplay(this.getCurrentTime());
    });

    this.originalVideo.addEventListener('ended', () => this._handleEnded(this.originalVideo));
    this.processedVideo.addEventListener('ended', () => this._handleEnded(this.processedVideo));

    this.currentTimeInput.addEventListener('focus', () => {
      this.currentTimeInput.select();
    });

    this.currentTimeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const parsed = this._parseTimeInput(this.currentTimeInput.value);
        if (parsed !== null) {
          this.seek(parsed);
        }
        this.currentTimeInput.blur();
      }
      if (e.key === 'Escape') {
        this.currentTimeInput.value = formatTime(this.getCurrentTime());
        this.currentTimeInput.blur();
      }
    });

    this.currentTimeInput.addEventListener('blur', () => {
      this.currentTimeInput.value = formatTime(this.getCurrentTime());
    });

    this.speedSelect.addEventListener('change', () => {
      const speed = parseFloat(this.speedSelect.value);
      this.originalVideo.playbackRate = speed;
      this.processedVideo.playbackRate = speed;
    });

    this.volumeSlider.addEventListener('input', () => {
      this.userVolume = parseFloat(this.volumeSlider.value);
      this._syncAudioRouting();
    });

    this.btnMute.addEventListener('click', () => {
      this.userMuted = !this.userMuted;
      this._syncAudioRouting();
    });
  }

  _handleOriginalTimeUpdate() {
    if (this.suppressOriginalTimeUpdate) {
      this.suppressOriginalTimeUpdate = false;
      return;
    }

    if (this._processedActsAsMaster()) return;

    const sourceTime = this.originalVideo.currentTime || 0;
    const processedTime = this.hasRealProcessedOutput
      ? this._sourceTimeToTimelineTime(sourceTime)
      : sourceTime;

    if (this.processedLoaded) {
      this._syncVideoTime(this.processedVideo, processedTime, 'processed');
    }

    this._refreshDisplay(this._sourceTimeToTimelineTime(sourceTime));
  }

  _handleProcessedTimeUpdate() {
    if (this.suppressProcessedTimeUpdate) {
      this.suppressProcessedTimeUpdate = false;
      return;
    }

    if (!this._processedActsAsMaster()) return;

    const processedTime = this.processedVideo.currentTime || 0;
    const displayTime = this.hasRealProcessedOutput
      ? processedTime
      : this._sourceTimeToTimelineTime(processedTime);

    this._syncVideoTime(
      this.originalVideo,
      this._timelineTimeToSourceTime(displayTime),
      'original',
    );

    this._refreshDisplay(displayTime);
  }

  _handleEnded(video) {
    if (video !== this._getMasterVideo()) return;
    this.isPlaying = false;
    this._updatePlayButton();
  }

  _refreshDisplay(displayTime) {
    const safeDisplayTime = this._clampDisplayTime(displayTime);
    this.lastDisplayTime = safeDisplayTime;

    if (document.activeElement !== this.currentTimeInput) {
      this.currentTimeInput.value = formatTime(safeDisplayTime);
    }

    const sourceTime = this.originalVideo.currentTime || this._timelineTimeToSourceTime(safeDisplayTime);
    const processedTime = this.processedVideo.currentTime || safeDisplayTime;

    this.originalTimeEl.textContent = formatTime(sourceTime);
    this.processedTimeEl.textContent = formatTime(
      this.hasRealProcessedOutput ? safeDisplayTime : processedTime,
    );

    this._updateSubtitleOverlay(safeDisplayTime);

    if (this.onTimeUpdate) this.onTimeUpdate(safeDisplayTime);
  }

  _updateSubtitleOverlay(displayTime) {
    if (!this.processedSubtitleOverlay) return;

    const subtitle = this._findSubtitle(displayTime);
    if (!subtitle) {
      this.processedSubtitleOverlay.textContent = '';
      this.processedSubtitleOverlay.classList.add('hidden');
      return;
    }

    this.processedSubtitleOverlay.textContent = subtitle.text;
    this.processedSubtitleOverlay.classList.remove('hidden');
  }

  _findSubtitle(displayTime) {
    if (!this.subtitles.length) return null;

    const subtitleTime = this.hasEditedTimeline()
      ? this._timelineTimeToSourceTime(displayTime)
      : displayTime;

    return this.subtitles.find((sub) => subtitleTime >= sub.start && subtitleTime <= sub.end) || null;
  }

  _processedActsAsMaster() {
    return this.processedLoaded && (this.hasRealProcessedOutput || this.processedVisible);
  }

  _getMasterVideo() {
    return this._processedActsAsMaster() ? this.processedVideo : this.originalVideo;
  }

  _syncAudioRouting() {
    const processedIsMaster = this._processedActsAsMaster();

    if (processedIsMaster) {
      this.originalVideo.muted = true;
      this.originalVideo.volume = 0;
      this.processedVideo.muted = this.userMuted;
      this.processedVideo.volume = this.userVolume;
    } else {
      this.originalVideo.muted = this.userMuted;
      this.originalVideo.volume = this.userVolume;
      this.processedVideo.muted = true;
      this.processedVideo.volume = 0;
    }

    this._updateVolumeIcon();
  }

  _setDisplayDuration(nextDuration) {
    const safeDuration = Number.isFinite(nextDuration) ? Math.max(0, nextDuration) : 0;
    this.duration = safeDuration;
    this.totalTimeEl.textContent = formatTime(safeDuration);
    if (this.onDurationChange) this.onDurationChange(safeDuration);
  }

  _buildTimelineMap(intervals) {
    let cursor = 0;
    return intervals.map((interval) => {
      const duration = Math.max(0, interval.end - interval.start);
      const mapped = {
        sourceStart: interval.start,
        sourceEnd: interval.end,
        timelineStart: cursor,
        timelineEnd: cursor + duration,
        duration,
      };
      cursor += duration;
      return mapped;
    });
  }

  _timelineTimeToSourceTime(time) {
    if (!this.hasEditedTimeline()) return Math.max(0, time);

    const safeTime = this._clampDisplayTime(time);
    for (const segment of this.timelineMap) {
      if (safeTime <= segment.timelineEnd) {
        return segment.sourceStart + (safeTime - segment.timelineStart);
      }
    }
    return this.timelineMap[this.timelineMap.length - 1]?.sourceEnd || 0;
  }

  _sourceTimeToTimelineTime(time) {
    if (!this.hasEditedTimeline()) return Math.max(0, time);

    const safeTime = Math.max(0, time);
    let lastTimelineEnd = 0;

    for (const segment of this.timelineMap) {
      if (safeTime < segment.sourceStart) {
        return lastTimelineEnd;
      }
      if (safeTime <= segment.sourceEnd) {
        return segment.timelineStart + (safeTime - segment.sourceStart);
      }
      lastTimelineEnd = segment.timelineEnd;
    }

    return lastTimelineEnd;
  }

  _clampDisplayTime(time) {
    const max = this.duration > 0 ? this.duration : Math.max(this.lastDisplayTime, 0);
    return clamp(Number.isFinite(time) ? time : 0, 0, max);
  }

  _clampVideoTime(video, time) {
    const safeTime = Math.max(0, Number.isFinite(time) ? time : 0);
    if (!Number.isFinite(video.duration) || video.duration <= 0) return safeTime;
    return clamp(safeTime, 0, Math.max(video.duration - 0.001, 0));
  }

  _setVideoTime(video, time, target) {
    const safeTime = Math.max(0, Number.isFinite(time) ? time : 0);

    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      if (target === 'original') this.pendingOriginalTime = safeTime;
      else this.pendingProcessedTime = safeTime;
      return;
    }

    if (target === 'original') this.suppressOriginalTimeUpdate = true;
    else this.suppressProcessedTimeUpdate = true;

    video.currentTime = this._clampVideoTime(video, safeTime);
  }

  _applyPendingTime(video, target) {
    const pending = target === 'original' ? this.pendingOriginalTime : this.pendingProcessedTime;
    if (pending === null) return;

    if (target === 'original') this.pendingOriginalTime = null;
    else this.pendingProcessedTime = null;

    this._setVideoTime(video, pending, target);
  }

  _syncVideoTime(video, targetTime, target) {
    if (!Number.isFinite(targetTime)) return;
    if (Math.abs((video.currentTime || 0) - targetTime) < 0.08) return;
    this._setVideoTime(video, targetTime, target);
  }

  _parseTimeInput(str) {
    str = str.trim();

    const patterns = [
      /^(\d+):(\d{1,2})\.(\d{1,3})$/,
      /^(\d+):(\d{1,2})$/,
      /^(\d+)\.(\d{1,3})$/,
      /^(\d+)$/,
    ];

    let match = str.match(patterns[0]);
    if (match) return parseInt(match[1], 10) * 60 + parseInt(match[2], 10) + parseInt(match[3].padEnd(3, '0'), 10) / 1000;

    match = str.match(patterns[1]);
    if (match) return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);

    match = str.match(patterns[2]);
    if (match) return parseInt(match[1], 10) + parseInt(match[2].padEnd(3, '0'), 10) / 1000;

    match = str.match(patterns[3]);
    if (match) return parseInt(match[1], 10);

    return null;
  }

  toggleOriginal() {
    this.showOriginal(!this.originalVisible);
    return this.originalVisible;
  }

  toggleProcessed() {
    if (!this.processedLoaded) return false;
    this.showProcessed(!this.processedVisible);
    return this.processedVisible;
  }

  showOriginal(show) {
    this.originalVisible = show;
    this.originalPanel.classList.toggle('hidden', !show);
    this._syncAudioRouting();
  }

  showProcessed(show) {
    this.processedVisible = show;
    this.processedPanel.classList.toggle('hidden', !show);
    this._syncAudioRouting();
  }

  loadOriginal(src) {
    this.isPlaying = false;
    this.originalSource = src;
    this.realProcessedSource = '';
    this.originalDuration = 0;
    this.lastDisplayTime = 0;
    this.processedLoaded = Boolean(src);
    this.hasRealProcessedOutput = false;
    this.pendingOriginalTime = 0;
    this.pendingProcessedTime = 0;
    this.editIntervals = [];
    this.timelineMap = [];

    this.originalVideo.src = src;
    this.originalVideo.load();

    this.processedVideo.src = src;
    this.processedVideo.load();

    this.processedVisible = false;
    this.processedPanel.classList.add('hidden');
    this._setDisplayDuration(0);
    this._refreshDisplay(0);
    this._syncAudioRouting();
    this._updatePlayButton();
  }

  loadProcessed(src) {
    const currentDisplayTime = this.getCurrentTime();

    this.realProcessedSource = src;
    this.hasRealProcessedOutput = true;
    this.processedLoaded = true;

    this.processedVideo.src = src;
    this.pendingProcessedTime = currentDisplayTime;
    this.processedVideo.load();

    this.processedVisible = true;
    this.processedPanel.classList.remove('hidden');
    this.processedVideo.playbackRate = parseFloat(this.speedSelect.value);

    this._syncAudioRouting();
    this._refreshDisplay(currentDisplayTime);
  }

  setSubtitles(subtitles) {
    this.subtitles = subtitles || [];
    this._updateSubtitleOverlay(this.getCurrentTime());
  }

  setEditIntervals(intervals) {
    const normalized = (intervals || [])
      .filter((interval) => Number.isFinite(interval.start) && Number.isFinite(interval.end) && interval.end > interval.start)
      .map((interval) => ({
        start: interval.start,
        end: interval.end,
        duration: interval.duration ?? (interval.end - interval.start),
      }));

    this.editIntervals = normalized;
    this.timelineMap = this._buildTimelineMap(normalized);

    if (this.hasEditedTimeline()) {
      this._setDisplayDuration(this.timelineMap[this.timelineMap.length - 1].timelineEnd);
    } else {
      this._setDisplayDuration(this.originalDuration);
    }

    this.seek(this._sourceTimeToTimelineTime(this.originalVideo.currentTime || 0));
  }

  clearEditIntervals() {
    this.editIntervals = [];
    this.timelineMap = [];
    this._setDisplayDuration(this.originalDuration);
    this.seek(this.originalVideo.currentTime || 0);
  }

  hasEditedTimeline() {
    return this.timelineMap.length > 0;
  }

  getEditIntervals() {
    return this.editIntervals;
  }

  mapSubtitlesToTimeline(subtitles) {
    if (!this.hasEditedTimeline()) return subtitles || [];

    const mapped = [];

    for (const subtitle of subtitles || []) {
      for (const segment of this.timelineMap) {
        const start = Math.max(subtitle.start, segment.sourceStart);
        const end = Math.min(subtitle.end, segment.sourceEnd);
        if (end <= start) continue;

        mapped.push({
          ...subtitle,
          start: Number((segment.timelineStart + (start - segment.sourceStart)).toFixed(3)),
          end: Number((segment.timelineStart + (end - segment.sourceStart)).toFixed(3)),
        });
      }
    }

    return mapped;
  }

  togglePlay() {
    if (this.isPlaying) {
      this.originalVideo.pause();
      if (this.processedLoaded) this.processedVideo.pause();
      this.isPlaying = false;
      this._updatePlayButton();
      return;
    }

    const currentDisplayTime = this.getCurrentTime();
    this.seek(currentDisplayTime);

    const plays = [this.originalVideo.play()];
    if (this.processedLoaded && (this.processedVisible || this.hasRealProcessedOutput)) {
      plays.push(this.processedVideo.play());
    }

    Promise.allSettled(plays).finally(() => {
      this.isPlaying = !this._getMasterVideo().paused;
      this._updatePlayButton();
    });
  }

  seek(time) {
    const displayTime = this._clampDisplayTime(time);
    const sourceTime = this._timelineTimeToSourceTime(displayTime);
    const processedTime = this.hasRealProcessedOutput ? displayTime : sourceTime;

    this._setVideoTime(this.originalVideo, sourceTime, 'original');
    if (this.processedLoaded) {
      this._setVideoTime(this.processedVideo, processedTime, 'processed');
    }

    this._refreshDisplay(displayTime);
  }

  skip(seconds) {
    this.seek(this.getCurrentTime() + seconds);
  }

  getCurrentTime() {
    if (this._processedActsAsMaster()) {
      return this.hasRealProcessedOutput
        ? this._clampDisplayTime(this.processedVideo.currentTime || this.lastDisplayTime)
        : this._clampDisplayTime(this._sourceTimeToTimelineTime(this.processedVideo.currentTime || this.lastDisplayTime));
    }

    return this._clampDisplayTime(this._sourceTimeToTimelineTime(this.originalVideo.currentTime || this.lastDisplayTime));
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
    const vol = this.userMuted ? 0 : this.userVolume;
    let iconName = 'volume-2';
    if (vol === 0) iconName = 'volume-x';
    else if (vol < 0.5) iconName = 'volume-1';
    this.volumeIcon.setAttribute('data-lucide', iconName);
    if (window.lucide) lucide.createIcons({ nodes: [this.volumeIcon] });
  }
}
