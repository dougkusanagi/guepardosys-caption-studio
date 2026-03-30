/**
 * StudioCut — Main Application
 * Orchestrates all modules and UI interactions
 */

import { uploadVideo, removeSilence, generateSubtitles, burnSubtitles, cropVideoRequest, exportVideo } from './modules/api.js';
import { WSClient } from './modules/wsClient.js';
import { VideoPlayer } from './modules/videoPlayer.js';
import { Timeline } from './modules/timeline.js';
import { Spectrogram } from './modules/spectrogram.js';
import { CropTool } from './modules/cropTool.js';
import { SubtitleEditor } from './modules/subtitleEditor.js';
import { showToast, formatDuration, formatSize } from './utils/helpers.js';

class App {
  constructor() {
    // State
    this.projectId = null;
    this.filename = null;
    this.videoInfo = null;
    this.processedVideoPath = null;
    this.currentOutputPath = null;

    // Initialize icons
    if (window.lucide) lucide.createIcons();

    // Initialize WebSocket
    this.ws = new WSClient();

    // Initialize modules (deferred until editor is shown)
    this.player = null;
    this.timeline = null;
    this.spectrogram = null;
    this.cropTool = null;
    this.subtitleEditor = null;

    this._bindUploadEvents();
    this._connectWebSocket();
  }

  async _connectWebSocket() {
    try {
      await this.ws.connect();
      this.ws.on('progress', (data) => this._handleProgress(data));
    } catch (err) {
      console.warn('[WS] Initial connection failed, will retry:', err.message);
    }
  }

  _bindUploadEvents() {
    const fileInput = document.getElementById('file-input');
    const dropZone = document.getElementById('drop-zone');

    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        this._handleUpload(e.target.files[0]);
      }
    });

    // Drag & drop
    ['dragenter', 'dragover'].forEach(evt => {
      dropZone.addEventListener(evt, (e) => {
        e.preventDefault();
        dropZone.classList.add('drop-zone-active');
      });
    });

    ['dragleave', 'drop'].forEach(evt => {
      dropZone.addEventListener(evt, (e) => {
        e.preventDefault();
        dropZone.classList.remove('drop-zone-active');
      });
    });

    dropZone.addEventListener('drop', (e) => {
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        this._handleUpload(files[0]);
      }
    });
  }

  async _handleUpload(file) {
    const uploadProgress = document.getElementById('upload-progress');
    const uploadBar = document.getElementById('upload-bar');
    const uploadPercent = document.getElementById('upload-percent');

    uploadProgress.classList.remove('hidden');

    try {
      const result = await uploadVideo(file, (percent) => {
        uploadBar.style.width = `${percent}%`;
        uploadPercent.textContent = `${percent}%`;
      });

      this.projectId = result.projectId;
      this.filename = result.file.filename;
      this.videoInfo = result.info;

      showToast('Vídeo carregado com sucesso!', 'success');

      // Switch to editor
      this._showEditor(result);
    } catch (err) {
      showToast(`Erro ao enviar: ${err.message}`, 'error');
      uploadProgress.classList.add('hidden');
    }
  }

  _showEditor(uploadResult) {
    // Hide upload, show editor
    document.getElementById('upload-screen').classList.add('hidden');
    document.getElementById('editor-screen').classList.remove('hidden');
    document.getElementById('project-info').classList.remove('hidden');
    document.getElementById('project-info').style.display = 'flex';
    document.getElementById('btn-export').classList.remove('hidden');
    document.getElementById('btn-export').style.display = 'flex';

    // Set header info
    document.getElementById('video-name').textContent = uploadResult.file.originalName;
    document.getElementById('video-resolution').textContent =
      `${this.videoInfo.video?.width}×${this.videoInfo.video?.height}`;
    document.getElementById('video-duration-header').textContent =
      formatDuration(this.videoInfo.duration);

    // Initialize modules
    this.player = new VideoPlayer();
    this.player.loadOriginal(uploadResult.file.path);

    this.timeline = new Timeline(this.player);
    this.spectrogram = new Spectrogram();
    this.cropTool = new CropTool();
    this.subtitleEditor = new SubtitleEditor();

    // Set initial timeline data
    this.player.onDurationChange = (duration) => {
      this.timeline.setDuration(duration);
    };

    // Set waveform
    if (uploadResult.waveform) {
      this.timeline.setWaveform(uploadResult.waveform);
    }

    // Load audio for spectrogram
    if (uploadResult.audioPath) {
      this.spectrogram.loadAudio(uploadResult.audioPath);
    }

    // Update spectrogram playhead
    const originalOnTimeUpdate = this.player.onTimeUpdate;
    this.player.onTimeUpdate = (time) => {
      if (originalOnTimeUpdate) originalOnTimeUpdate(time);
      this.timeline._updatePlayhead(time);
      if (this.spectrogram.isVisible) {
        this.spectrogram.updatePlayhead(time, this.player.getDuration());
      }
    };

    // Bind toolbar events
    this._bindToolbarEvents();
    this._bindSidebarEvents();

    // Re-create icons
    if (window.lucide) lucide.createIcons();
  }

  _bindToolbarEvents() {
    // Remove Silence
    document.getElementById('btn-remove-silence').addEventListener('click', () => {
      this._toggleSilencePanel();
    });

    // Subtitles
    document.getElementById('btn-gen-subtitles').addEventListener('click', () => {
      this.subtitleEditor.toggle();
      // Close silence panel if open
      document.getElementById('silence-panel').style.transform = 'translateX(100%)';
    });

    // Crop
    document.getElementById('btn-crop-tool').addEventListener('click', () => {
      this.cropTool.toggle();
      const btn = document.getElementById('btn-crop-tool');
      btn.classList.toggle('active', this.cropTool.isActive);
    });

    // Selection tool
    document.getElementById('btn-selection-tool').addEventListener('click', () => {
      const btn = document.getElementById('btn-selection-tool');
      btn.classList.toggle('active');
      if (!btn.classList.contains('active')) {
        this.timeline.clearSelection();
      }
      showToast('Arraste no track de áudio para selecionar um trecho', 'info', 3000);
    });

    // Spectrogram toggle
    document.getElementById('btn-toggle-spectrogram').addEventListener('click', () => {
      this.spectrogram.toggle();
      const btn = document.getElementById('btn-toggle-spectrogram');
      btn.classList.toggle('active', this.spectrogram.isVisible);
    });

    // Export
    document.getElementById('btn-export').addEventListener('click', () => {
      this._exportVideo();
    });
  }

  _bindSidebarEvents() {
    // Silence removal panel
    document.getElementById('btn-close-silence-panel').addEventListener('click', () => {
      document.getElementById('silence-panel').style.transform = 'translateX(100%)';
    });

    document.getElementById('btn-run-silence-removal').addEventListener('click', () => {
      this._runSilenceRemoval();
    });

    // Subtitle generation
    this.subtitleEditor.onGenerate = (settings) => {
      this._generateSubtitles(settings);
    };

    this.subtitleEditor.onBurn = (style) => {
      this._burnSubtitles(style);
    };

    // Crop apply
    this.cropTool.onCropChange = (rect) => {
      showToast(`Crop: ${rect.width}×${rect.height} em (${rect.x}, ${rect.y})`, 'info', 2000);
    };
  }

  _toggleSilencePanel() {
    const panel = document.getElementById('silence-panel');
    const isOpen = panel.style.transform === 'translateX(0px)';
    panel.style.transform = isOpen ? 'translateX(100%)' : 'translateX(0px)';

    // Close subtitle sidebar if open
    if (!isOpen) this.subtitleEditor.close();
  }

  async _runSilenceRemoval() {
    const settings = {
      filename: this.filename,
      projectId: this.projectId,
      clientId: this.ws.getClientId(),
      model: document.getElementById('silence-model').value,
      language: document.getElementById('silence-language').value,
      minGap: parseFloat(document.getElementById('silence-min-gap').value),
      padStart: parseFloat(document.getElementById('silence-pad-start').value),
      padEnd: parseFloat(document.getElementById('silence-pad-end').value),
      minKeep: parseFloat(document.getElementById('silence-min-keep').value),
    };

    this._showProcessingModal('Removendo Silêncio', 'Processando seu vídeo com IA...');

    try {
      const result = await removeSilence(settings);

      this._hideProcessingModal();

      // Show processed video
      this.processedVideoPath = result.outputPath;
      this.currentOutputPath = result.outputPath;
      this.player.loadProcessed(result.outputPath);

      // Update timeline with intervals
      this.timeline.setIntervals(result.intervals);

      // Update waveform if available
      if (result.waveform) {
        // Keep original waveform but mark removed sections
      }

      // Show results
      document.getElementById('silence-results').classList.remove('hidden');
      document.getElementById('result-segments').textContent = result.stats.segmentCount;
      document.getElementById('result-original-dur').textContent = formatDuration(result.stats.originalDuration);
      document.getElementById('result-kept-dur').textContent = formatDuration(result.stats.keptDuration);
      document.getElementById('result-removed-dur').textContent = formatDuration(result.stats.removedDuration);

      showToast(`Silêncios removidos! ${formatDuration(result.stats.removedDuration)} cortados.`, 'success');
    } catch (err) {
      this._hideProcessingModal();
      showToast(`Erro: ${err.message}`, 'error');
    }
  }

  async _generateSubtitles(settings) {
    this._showProcessingModal('Gerando Legendas', 'A IA está transcrevendo seu vídeo...');

    try {
      const result = await generateSubtitles({
        filename: this.filename,
        projectId: this.projectId,
        clientId: this.ws.getClientId(),
        model: settings.model,
        language: settings.language,
      });

      this._hideProcessingModal();

      // Update UI
      this.subtitleEditor.setSubtitles(result.subtitles);

      // Show subtitle track
      document.getElementById('subtitle-track').classList.remove('hidden');
      this.timeline.setSubtitles(result.subtitles);

      showToast(`${result.subtitles.length} legendas geradas com sucesso!`, 'success');
    } catch (err) {
      this._hideProcessingModal();
      showToast(`Erro: ${err.message}`, 'error');
    }
  }

  async _burnSubtitles(style) {
    this._showProcessingModal('Aplicando Legendas', 'Queimando legendas no vídeo...');

    try {
      const result = await burnSubtitles({
        filename: this.filename,
        projectId: this.projectId,
        clientId: this.ws.getClientId(),
        style,
      });

      this._hideProcessingModal();

      this.currentOutputPath = result.outputPath;
      this.player.loadProcessed(result.outputPath);

      showToast('Legendas aplicadas ao vídeo!', 'success');
    } catch (err) {
      this._hideProcessingModal();
      showToast(`Erro: ${err.message}`, 'error');
    }
  }

  async _exportVideo() {
    const sourceFile = this.currentOutputPath || `/uploads/${this.filename}`;

    try {
      const blob = await exportVideo({
        projectId: this.projectId,
        sourceFile,
      });

      // Download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `studiocut_export_${Date.now()}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showToast('Vídeo exportado com sucesso!', 'success');
    } catch (err) {
      showToast(`Erro ao exportar: ${err.message}`, 'error');
    }
  }

  _showProcessingModal(title, message) {
    const modal = document.getElementById('processing-modal');
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-message').textContent = message;
    document.getElementById('modal-progress-bar').style.width = '0%';
    document.getElementById('modal-stage').textContent = '0%';
    modal.classList.remove('hidden');
  }

  _hideProcessingModal() {
    document.getElementById('processing-modal').classList.add('hidden');
  }

  _handleProgress(data) {
    const bar = document.getElementById('modal-progress-bar');
    const stage = document.getElementById('modal-stage');
    const message = document.getElementById('modal-message');

    if (bar && stage) {
      bar.style.width = `${data.progress}%`;
      stage.textContent = `${data.progress}%`;
    }
    if (message && data.message) {
      message.textContent = data.message;
    }
  }
}

// Boot
document.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});
