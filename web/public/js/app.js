/**
 * StudioCut — Main Application
 * Orchestrates all modules and UI interactions
 */

import { uploadVideo, removeSilence, generateSubtitles, burnSubtitles, cropVideoRequest, exportVideo, saveProject, loadProject, listProjects, deleteProject } from './modules/api.js';
import { WSClient } from './modules/wsClient.js';
import { VideoPlayer } from './modules/videoPlayer.js';
import { Timeline } from './modules/timeline.js';
import { CropTool } from './modules/cropTool.js';
import { SubtitleEditor } from './modules/subtitleEditor.js';
import { showToast, formatDuration } from './utils/helpers.js';

class App {
  constructor() {
    this.projectId = null;
    this.filename = null;
    this.originalName = null;
    this.videoInfo = null;
    this.originalDuration = 0;
    this.originalWaveform = [];
    this.subtitles = [];
    this.processedVideoPath = null;
    this.currentOutputPath = null;

    // Initialize icons
    if (window.lucide) lucide.createIcons();

    // WebSocket
    this.ws = new WSClient();

    // Modules (deferred)
    this.player = null;
    this.timeline = null;
    this.cropTool = null;
    this.subtitleEditor = null;
    this.toolbarEventsBound = false;
    this.sidebarEventsBound = false;

    this._bindUploadEvents();
    this._bindHeaderEvents();
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
      if (e.target.files.length > 0) this._handleUpload(e.target.files[0]);
    });

    ['dragenter', 'dragover'].forEach(evt => {
      dropZone.addEventListener(evt, (e) => { e.preventDefault(); dropZone.classList.add('drop-zone-active'); });
    });
    ['dragleave', 'drop'].forEach(evt => {
      dropZone.addEventListener(evt, (e) => { e.preventDefault(); dropZone.classList.remove('drop-zone-active'); });
    });
    dropZone.addEventListener('drop', (e) => {
      if (e.dataTransfer.files.length > 0) this._handleUpload(e.dataTransfer.files[0]);
    });
  }

  _bindHeaderEvents() {
    // Load project button (always visible)
    document.getElementById('btn-load-project').addEventListener('click', () => this._showProjectList());
    document.getElementById('btn-close-project-list').addEventListener('click', () => {
      document.getElementById('project-list-modal').classList.add('hidden');
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
      this.originalName = result.file.originalName;
      this.videoInfo = result.info;
      this.subtitles = [];
      this.processedVideoPath = null;
      this.currentOutputPath = null;

      showToast('Vídeo carregado com sucesso!', 'success');
      this._showEditor(result);
    } catch (err) {
      showToast(`Erro ao enviar: ${err.message}`, 'error');
      uploadProgress.classList.add('hidden');
    }
  }

  _showEditor(uploadResult) {
    this.originalDuration = uploadResult.info?.duration || 0;
    this.originalWaveform = uploadResult.originalWaveform || uploadResult.waveform || [];

    document.getElementById('upload-screen').classList.add('hidden');
    document.getElementById('editor-screen').classList.remove('hidden');
    document.getElementById('project-info').classList.remove('hidden');
    document.getElementById('project-info').style.display = 'flex';
    document.getElementById('btn-export').classList.remove('hidden');
    document.getElementById('btn-export').style.display = 'flex';
    document.getElementById('btn-save-project').classList.remove('hidden');
    document.getElementById('btn-save-project').style.display = 'flex';

    // Header info
    document.getElementById('video-name').textContent = uploadResult.file.originalName;
    document.getElementById('video-resolution').textContent =
      `${this.videoInfo.video?.width}×${this.videoInfo.video?.height}`;
    document.getElementById('video-duration-header').textContent =
      formatDuration(this.videoInfo.duration);

    // Initialize modules
    this.player = new VideoPlayer();
    this.player.loadOriginal(uploadResult.file.path);
    this.player.setSubtitles(this.subtitles);

    this.timeline = new Timeline(this.player);
    this.cropTool = new CropTool();
    this.subtitleEditor = new SubtitleEditor();

    // Timeline duration from video
    this.player.onDurationChange = (duration) => {
      this.timeline.setDuration(duration);
      this.timeline.setSubtitles(this._getTimelineSubtitles());
    };
    if (this.player.getDuration() > 0) {
      this.timeline.setDuration(this.player.getDuration());
    }

    // Waveform
    if (this.originalWaveform.length > 0) {
      this.timeline.setWaveform(this.originalWaveform);
    }
    this.timeline.setCollapsedMode(false);
    this.timeline.setSubtitles(this._getTimelineSubtitles());

    const originalOnTimeUpdate = this.player.onTimeUpdate;
    this.player.onTimeUpdate = (time) => {
      if (originalOnTimeUpdate) originalOnTimeUpdate(time);
      this.timeline._updatePlayhead(time);
    };

    this._bindToolbarEvents();
    this._bindSidebarEvents();

    if (window.lucide) lucide.createIcons();
  }

  _bindToolbarEvents() {
    if (this.toolbarEventsBound) return;
    this.toolbarEventsBound = true;

    // Remove Silence
    document.getElementById('btn-remove-silence').addEventListener('click', () => this._toggleSilencePanel());

    // Subtitles
    document.getElementById('btn-gen-subtitles').addEventListener('click', () => {
      this.subtitleEditor.toggle();
      document.getElementById('silence-panel').style.transform = 'translateX(100%)';
    });

    // Crop
    document.getElementById('btn-crop-tool').addEventListener('click', () => {
      this.cropTool.toggle();
      document.getElementById('btn-crop-tool').classList.toggle('active', this.cropTool.isActive);
    });

    // Selection
    document.getElementById('btn-selection-tool').addEventListener('click', () => {
      const btn = document.getElementById('btn-selection-tool');
      btn.classList.toggle('active');
      if (!btn.classList.contains('active')) this.timeline.clearSelection();
      showToast('Arraste no track de áudio para selecionar um trecho', 'info', 3000);
    });

    // --- Preview Toggles ---
    const btnOriginal = document.getElementById('btn-toggle-original');
    const btnProcessed = document.getElementById('btn-toggle-processed');

    btnOriginal.addEventListener('click', () => {
      const visible = this.player.toggleOriginal();
      btnOriginal.classList.toggle('active', visible);
    });

    btnProcessed.addEventListener('click', () => {
      const visible = this.player.toggleProcessed();
      btnProcessed.classList.toggle('active', visible);
    });

    // Export
    document.getElementById('btn-export').addEventListener('click', () => this._exportVideo());

    // Save project
    document.getElementById('btn-save-project').addEventListener('click', () => this._saveProject());
  }

  _bindSidebarEvents() {
    if (!this.sidebarEventsBound) {
      document.getElementById('btn-close-silence-panel').addEventListener('click', () => {
        document.getElementById('silence-panel').style.transform = 'translateX(100%)';
      });

      document.getElementById('btn-run-silence-removal').addEventListener('click', () => this._runSilenceRemoval());
      this.sidebarEventsBound = true;
    }

    this.subtitleEditor.onGenerate = (settings) => this._generateSubtitles(settings);
    this.subtitleEditor.onBurn = (style) => this._burnSubtitles(style);

    this.cropTool.onCropChange = (rect) => {
      showToast(`Crop: ${rect.width}×${rect.height} em (${rect.x}, ${rect.y})`, 'info', 2000);
    };
  }

  _toggleSilencePanel() {
    const panel = document.getElementById('silence-panel');
    const isOpen = panel.style.transform === 'translateX(0px)';
    panel.style.transform = isOpen ? 'translateX(100%)' : 'translateX(0px)';
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

      this.processedVideoPath = result.outputPath;
      this.currentOutputPath = result.outputPath;
      this.player.setEditIntervals(result.intervals);
      this.player.loadProcessed(result.outputPath);
      this.player.setSubtitles(this.subtitles);

      // Activate processed preview toggle
      document.getElementById('btn-toggle-processed').classList.add('active');

      this.timeline.setCollapsedMode(true);
      this.timeline.setIntervals(result.intervals);
      if (result.waveform) {
        this.timeline.setWaveform(result.waveform);
      }
      this.timeline.setSubtitles(this._getTimelineSubtitles());

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
      this.subtitles = result.subtitles;
      this.subtitleEditor.setSubtitles(this.subtitles);
      this.player.setSubtitles(this.subtitles);
      document.getElementById('subtitle-track').classList.remove('hidden');
      this.timeline.setSubtitles(this._getTimelineSubtitles());

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
      this.processedVideoPath = result.outputPath;
      this.currentOutputPath = result.outputPath;
      this.player.clearEditIntervals();
      this.player.loadProcessed(result.outputPath);
      this.player.setSubtitles(this.subtitles);
      document.getElementById('btn-toggle-processed').classList.add('active');
      this.timeline.setCollapsedMode(false);
      this.timeline.setIntervals([]);
      this.timeline.setWaveform(this.originalWaveform);
      this.timeline.setSubtitles(this._getTimelineSubtitles());

      showToast('Legendas aplicadas ao vídeo!', 'success');
    } catch (err) {
      this._hideProcessingModal();
      showToast(`Erro: ${err.message}`, 'error');
    }
  }

  async _exportVideo() {
    const sourceFile = this.currentOutputPath || `/uploads/${this.filename}`;

    try {
      const blob = await exportVideo({ projectId: this.projectId, sourceFile });
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

  // --- Project Save/Load ---

  async _saveProject() {
    const name = prompt('Nome do projeto:', this.originalName?.replace(/\.\w+$/, '') || 'Meu Projeto');
    if (!name) return;

    try {
      const state = {
        name,
        projectId: this.projectId,
        filename: this.filename,
        originalName: this.originalName,
        videoInfo: this.videoInfo,
        originalDuration: this.originalDuration,
        originalWaveform: this.originalWaveform,
        subtitles: this.subtitles,
        editIntervals: this.player.getEditIntervals(),
        processedVideoPath: this.processedVideoPath,
        currentOutputPath: this.currentOutputPath,
        timeline: this.timeline.getState(),
        waveform: this.timeline.waveformData,
      };

      await saveProject(state);
      showToast(`Projeto "${name}" salvo com sucesso!`, 'success');
    } catch (err) {
      showToast(`Erro ao salvar: ${err.message}`, 'error');
    }
  }

  async _showProjectList() {
    const modal = document.getElementById('project-list-modal');
    const container = document.getElementById('project-list-items');
    modal.classList.remove('hidden');

    try {
      const projects = await listProjects();

      if (projects.length === 0) {
        container.innerHTML = '<p class="text-sm text-surface-400 text-center py-8">Nenhum projeto salvo.</p>';
        if (window.lucide) lucide.createIcons();
        return;
      }

      container.innerHTML = projects.map(p => `
        <div class="project-item" data-project="${p.name}">
          <div class="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center flex-shrink-0">
            <i data-lucide="film" class="w-5 h-5 text-primary-600"></i>
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-semibold text-surface-800 truncate">${p.name}</p>
            <p class="text-xs text-surface-400">${p.originalName || ''} • ${p.date || ''}</p>
          </div>
          <button class="project-delete-btn p-2 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0" data-project="${p.name}" title="Excluir">
            <i data-lucide="trash-2" class="w-4 h-4 text-surface-400 hover:text-red-500"></i>
          </button>
        </div>
      `).join('');

      if (window.lucide) lucide.createIcons();

      // Click to load
      container.querySelectorAll('.project-item').forEach(item => {
        item.addEventListener('click', (e) => {
          if (e.target.closest('.project-delete-btn')) return;
          const projectName = item.dataset.project;
          modal.classList.add('hidden');
          this._loadProject(projectName);
        });
      });

      // Click to delete
      container.querySelectorAll('.project-delete-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const projectName = btn.dataset.project;
          if (confirm(`Excluir projeto "${projectName}"?`)) {
            try {
              await deleteProject(projectName);
              showToast(`Projeto "${projectName}" excluído.`, 'info');
              this._showProjectList(); // refresh
            } catch (err) {
              showToast(`Erro ao excluir: ${err.message}`, 'error');
            }
          }
        });
      });
    } catch (err) {
      container.innerHTML = `<p class="text-sm text-red-500 text-center py-8">Erro ao carregar projetos: ${err.message}</p>`;
    }
  }

  async _loadProject(projectName) {
    try {
      const state = await loadProject(projectName);

      this.projectId = state.projectId;
      this.filename = state.filename;
      this.originalName = state.originalName;
      this.videoInfo = state.videoInfo;
      this.originalDuration = state.originalDuration || state.videoInfo?.duration || 0;
      this.originalWaveform = state.originalWaveform || state.waveform || [];
      this.subtitles = state.subtitles || [];
      this.processedVideoPath = state.processedVideoPath;
      this.currentOutputPath = state.currentOutputPath;

      // Show editor
      this._showEditor({
        projectId: state.projectId,
        file: {
          originalName: state.originalName,
          filename: state.filename,
          path: `/uploads/${state.filename}`,
          size: state.videoInfo?.size || 0,
        },
        info: state.videoInfo,
        waveform: state.waveform,
        originalWaveform: state.originalWaveform || state.waveform,
        audioPath: `/processed/${state.projectId}/audio.wav`,
      });

      // Restore timeline state
      if (state.timeline) {
        this.timeline.loadState({
          ...state.timeline,
          intervals: [],
          subtitles: [],
        });
      }

      if (state.waveform) {
        this.timeline.setWaveform(state.waveform);
      }

      if (state.subtitles?.length) {
        this.subtitleEditor.setSubtitles(state.subtitles);
        this.player.setSubtitles(state.subtitles);
        document.getElementById('subtitle-track').classList.remove('hidden');
      }

      if (state.editIntervals?.length) {
        this.player.setEditIntervals(state.editIntervals);
        this.timeline.setCollapsedMode(true);
        this.timeline.setIntervals(state.editIntervals);
      } else {
        this.timeline.setCollapsedMode(false);
        this.timeline.setIntervals([]);
      }

      this.timeline.setSubtitles(this._getTimelineSubtitles());

      // Restore processed video
      if (state.processedVideoPath) {
        this.player.loadProcessed(state.processedVideoPath);
        document.getElementById('btn-toggle-processed').classList.add('active');
      }

      showToast(`Projeto "${projectName}" carregado!`, 'success');
    } catch (err) {
      showToast(`Erro ao carregar: ${err.message}`, 'error');
    }
  }

  // --- Modal ---

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

  _getTimelineSubtitles() {
    if (!this.subtitles.length || !this.player) return [];
    return this.player.hasEditedTimeline()
      ? this.player.mapSubtitlesToTimeline(this.subtitles)
      : this.subtitles;
  }
}

// Boot
document.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});
