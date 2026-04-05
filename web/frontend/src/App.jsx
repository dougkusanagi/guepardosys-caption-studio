import {
  AlertCircle,
  AudioLines,
  CheckCircle,
  Clapperboard,
  Crop,
  Download,
  Eye,
  Film,
  FolderOpen,
  Gauge,
  Info,
  Loader2,
  Lock,
  Maximize2,
  Menu,
  Monitor,
  MonitorCheck,
  Plus,
  Save,
  Scissors,
  SkipBack,
  SkipForward,
  Subtitles,
  TextCursorInput,
  Trash2,
  UploadCloud,
  Settings,
  Video,
  Layout,
  Volume1,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { startTransition, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';

import { AssSubtitleRenderer } from './components/ass-subtitle-renderer.jsx';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './components/ui/alert-dialog.jsx';
import { Button } from './components/ui/button.jsx';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from './components/ui/card.jsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './components/ui/dialog.jsx';
import { Input } from './components/ui/input.jsx';
import { Label } from './components/ui/label.jsx';
import { Progress } from './components/ui/progress.jsx';
import { RadioGroup, RadioGroupItem } from './components/ui/radio-group.jsx';
import { ScrollArea } from './components/ui/scroll-area.jsx';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from './components/ui/sheet.jsx';
import { InlineSubtitlePanel, SubtitleSidebar } from './components/subtitle-sidebar.jsx';
import { ColorField, InputField, SelectField } from './components/form-fields.jsx';
import {
  burnSubtitles,
  deleteProject,
  exportVideo,
  generateSubtitles,
  init as initApi,
  listProjects,
  loadProject,
  removeSilence,
  saveProject,
  saveProjectDialog,
  sendNativeNotification,
  uploadVideo,
} from './lib/api.js';
import { buildBurnStyle, generateAssSubtitles } from './lib/subtitles.js';
import * as tauri from './lib/tauri.js';
import { clamp, cn, formatDuration, formatTime } from './lib/utils.js';

const DEFAULT_SILENCE_SETTINGS = {
  model: 'small',
  language: 'pt',
  minGap: 0.8,
  padStart: 0.12,
  padEnd: 0.18,
  minKeep: 0.12,
};

const DEFAULT_SUBTITLE_SETTINGS = {
  model: 'small',
  language: 'pt',
};

const DEFAULT_SUBTITLE_STYLE = {
  fontName: 'Arial',
  fontSize: 24,
  primaryColor: '#ffffff',
  outlineColor: '#000000',
  outline: 2,
  shadow: 1,
  alignment: 2,
  positionY: 88,
  areaHeight: 18,
  bold: false,
};

const DEFAULT_TIMELINE_UI = {
  zoom: 1,
  waveformAmplitude: 1,
  collapsedMode: false,
  trackHeights: {
    video: 48,
    audio: 48,
    subtitle: 48,
  },
};

const DEFAULT_CROP_RECT = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
const DEFAULT_UPLOAD_STATE = { phase: 'idle', progress: 0 };

function getProcessingTitleForStage(stage, fallbackTitle) {
  switch (stage) {
    case 'model_download':
      return 'Baixando Modelo Whisper';
    case 'transcribe':
    case 'cut':
      return 'Removendo Silêncio';
    case 'subtitles':
      return 'Gerando Legendas';
    case 'burn':
      return 'Preparando Exportação';
    case 'crop':
      return 'Recortando Vídeo';
    default:
      return fallbackTitle;
  }
}

function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;

    const mediaQuery = window.matchMedia(query);
    const handleChange = () => setMatches(mediaQuery.matches);
    handleChange();
    mediaQuery.addEventListener('change', handleChange);

    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, [query]);

  return matches;
}

function App() {
  const [projectId, setProjectId] = useState(null);
  const [filename, setFilename] = useState(null);
  const [originalName, setOriginalName] = useState(null);
  const [videoInfo, setVideoInfo] = useState(null);
  const [originalWaveform, setOriginalWaveform] = useState([]);
  const [timelineWaveform, setTimelineWaveform] = useState([]);
  const [processedVideoPath, setProcessedVideoPath] = useState(null);
  const [currentOutputPath, setCurrentOutputPath] = useState(null);
  const [subtitles, setSubtitles] = useState([]);
  const [editIntervals, setEditIntervals] = useState([]);
  const [timelineUi, setTimelineUi] = useState(DEFAULT_TIMELINE_UI);
  const [uploadState, setUploadState] = useState(DEFAULT_UPLOAD_STATE);
  const [editorVisible, setEditorVisible] = useState(false);
  const [showSilencePanel, setShowSilencePanel] = useState(false);
  const [showSubtitleSidebar, setShowSubtitleSidebar] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [showProjectList, setShowProjectList] = useState(false);
  const [dockProcessedPreview, setDockProcessedPreview] = useState(false);
  const [projects, setProjects] = useState([]);
  const [showProcessingModal, setShowProcessingModal] = useState(false);
  const [showHomeConfirm, setShowHomeConfirm] = useState(false);
  const [processingState, setProcessingState] = useState({ title: '', message: '', progress: 0 });
  const [silenceSettings, setSilenceSettings] = useState(DEFAULT_SILENCE_SETTINGS);
  const [subtitleSettings, setSubtitleSettings] = useState(DEFAULT_SUBTITLE_SETTINGS);
  const [subtitleStyle, setSubtitleStyle] = useState(DEFAULT_SUBTITLE_STYLE);
  const [cropActive, setCropActive] = useState(false);
  const [cropRect, setCropRect] = useState(DEFAULT_CROP_RECT);
  const [toasts, setToasts] = useState([]);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveProjectName, setSaveProjectName] = useState('');
  const [showDeleteProjectDialog, setShowDeleteProjectDialog] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState('');
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exportMode, setExportMode] = useState('embedded');
  const [lastSavedPath, setLastSavedPath] = useState(null);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [whisperModelsPath, setWhisperModelsPath] = useState('');

  // Initialize API (detects Tauri vs browser)
  useEffect(() => {
    let cancelled = false;

    async function initializeDesktopApi() {
      try {
        await initApi();
        if (!tauri.isTauri()) return;

        const path = await tauri.getWhisperModelsPath();
        if (!cancelled && path) {
          setWhisperModelsPath(path);
        }
      } catch {}
    }

    initializeDesktopApi();

    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!showSettingsModal || whisperModelsPath || !tauri.isTauri()) return;

    tauri.getWhisperModelsPath().then((path) => {
      if (path) setWhisperModelsPath(path);
    }).catch(() => {});
  }, [showSettingsModal, whisperModelsPath]);

  async function resolveWhisperModelsPath() {
    if (whisperModelsPath) return whisperModelsPath;
    if (!tauri.isTauri()) return '';

    try {
      const path = await tauri.getWhisperModelsPath();
      if (path) {
        setWhisperModelsPath(path);
        return path;
      }
    } catch {}

    return '';
  }

  async function chooseWhisperFolder() {
    const selectedPath = await tauri.chooseFolder();
    const path = Array.isArray(selectedPath) ? selectedPath[0] : selectedPath;
    if (path) setWhisperModelsPath(path);
  }

  async function openWhisperFolder() {
    const path = await resolveWhisperModelsPath();
    if (!path) {
      pushToast('Não foi possível localizar a pasta dos modelos Whisper.', 'error');
      return;
    }

    const opened = await tauri.openFolder(path);
    if (!opened) {
      pushToast('Não foi possível abrir a pasta dos modelos Whisper.', 'error');
    }
  }

  function saveSettings() {
    pushToast('Configurações salvas', 'success');
    setShowSettingsModal(false);
  }

  const playback = usePlaybackController();
  const hasWideDockLayout = useMediaQuery('(min-width: 1101px)');
  const clientId = useWsClient((data) => {
    setProcessingState((prev) => ({
      ...prev,
      title: getProcessingTitleForStage(data.stage, prev.title),
      message: data.message || prev.message,
      progress: data.progress ?? prev.progress,
    }));
  });

  const timelineSubtitles = useMemo(
    () => (playback.hasEditedTimeline() ? playback.mapSubtitlesToTimeline(subtitles) : subtitles),
    [editIntervals, subtitles],
  );

  function pushToast(message, type = 'info', duration = 4000) {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, message, type }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, duration);

    if (type === 'success' || type === 'error') {
      const title = type === 'success' ? 'StudioCut' : 'Erro - StudioCut';
      sendNativeNotification(title, message).catch(() => {});
    }
  }

  function resetEditorState() {
    setProcessedVideoPath(null);
    setCurrentOutputPath(null);
    setOriginalWaveform([]);
    setTimelineWaveform([]);
    setSubtitles([]);
    setEditIntervals([]);
    setTimelineUi(DEFAULT_TIMELINE_UI);
    setSelectionMode(false);
    setShowSilencePanel(false);
    setShowSubtitleSidebar(false);
    setCropActive(false);
    setCropRect(DEFAULT_CROP_RECT);
    playback.setSubtitles([]);
    playback.clearEditIntervals();
  }

  function resetWorkspace() {
    resetEditorState();
    playback.reset();
    setProjectId(null);
    setFilename(null);
    setOriginalName(null);
    setVideoInfo(null);
    setEditorVisible(false);
    setProjects([]);
    setShowProjectList(false);
    setShowProcessingModal(false);
    setProcessingState({ title: '', message: '', progress: 0 });
    setUploadState(DEFAULT_UPLOAD_STATE);
    setDockProcessedPreview(false);
    setSubtitleSettings(DEFAULT_SUBTITLE_SETTINGS);
    setSubtitleStyle(DEFAULT_SUBTITLE_STYLE);
  }

  function getOriginalSourceFile() {
    return filename ? `/uploads/${filename}` : '';
  }

  function getPreviewProcessedSource(
    outputPath = currentOutputPath,
    processedPath = processedVideoPath,
    originalSource = getOriginalSourceFile(),
  ) {
    return outputPath || processedPath || originalSource || '';
  }

  function getSubtitlesForSource(sourceFile) {
    const shouldMapToTimeline = playback.hasEditedTimeline() && sourceFile && sourceFile !== getOriginalSourceFile();
    return shouldMapToTimeline ? timelineSubtitles : subtitles;
  }

  async function handleUpload(file) {
    setUploadState({ phase: 'uploading', progress: 0 });
    try {
      const result = await uploadVideo(file, {
        onUploadProgress: (percent) => {
          setUploadState((prev) => (
            prev.phase === 'processing'
              ? prev
              : { phase: 'uploading', progress: percent }
          ));
        },
        onProcessingState: () => setUploadState({ phase: 'processing', progress: 100 }),
      });

      resetEditorState();
      setProjectId(result.projectId);
      setFilename(result.file.filename);
      setOriginalName(result.file.originalName);
      setVideoInfo(result.info);
      setEditorVisible(true);
      startTransition(() => {
        setOriginalWaveform(result.waveform || []);
        setTimelineWaveform(result.waveform || []);
      });
      const shouldDock = shouldUseDockedPreview(result.info);
      setDockProcessedPreview(shouldDock);

      // In Tauri mode, use the /uploads/ path (served by Vite middleware in dev, by Rust in prod)
      let videoSrc = result.file.path;

      playback.loadOriginal(videoSrc, {
        showOriginal: !shouldDock,
        showProcessed: shouldDock,
      });
      setUploadState(DEFAULT_UPLOAD_STATE);
      pushToast('Vídeo carregado com sucesso!', 'success');
    } catch (err) {
      setUploadState(DEFAULT_UPLOAD_STATE);
      pushToast(`Erro ao enviar: ${err.message || err}`, 'error');
    }
  }

  async function runSilenceRemoval() {
    if (!filename || !projectId) return;

    setShowProcessingModal(true);
    setProcessingState({
      title: 'Removendo Silêncio',
      message: 'Processando seu vídeo com IA...',
      progress: 0,
    });

    try {
      const result = await removeSilence({
        filename,
        projectId,
        clientId,
        ...silenceSettings,
      });

      setShowProcessingModal(false);
      setProcessedVideoPath(result.outputPath);
      setCurrentOutputPath(result.outputPath);
      setEditIntervals(result.intervals);
      setTimelineWaveform(result.waveform || timelineWaveform);
      setTimelineUi((prev) => ({ ...prev, collapsedMode: true }));

      playback.setEditIntervals(result.intervals);
      playback.loadProcessed(result.outputPath);
      playback.setSubtitles(subtitles);

      pushToast(`Silêncios removidos! ${formatDuration(result.stats.removedDuration)} cortados.`, 'success');
    } catch (err) {
      setShowProcessingModal(false);
      pushToast(`Erro: ${err.message || err}`, 'error');
    }
  }

  async function runSubtitleGeneration() {
    if (!filename || !projectId) return;

    setShowProcessingModal(true);
    setProcessingState({
      title: 'Gerando Legendas',
      message: 'A IA está transcrevendo seu vídeo...',
      progress: 0,
    });

    try {
      const result = await generateSubtitles({
        filename,
        projectId,
        clientId,
        model: subtitleSettings.model,
        language: subtitleSettings.language,
        style: buildBurnStyle(
          subtitleStyle,
          playback.getDisplayScaleForSource(getOriginalSourceFile()),
        ),
      });

      setShowProcessingModal(false);
      setSubtitles(result.subtitles);
      playback.setSubtitles(result.subtitles);
      setShowSubtitleSidebar(true);
      pushToast(`${result.subtitles.length} legendas geradas com sucesso!`, 'success');
    } catch (err) {
      setShowProcessingModal(false);
      pushToast(`Erro: ${err.message || err}`, 'error');
    }
  }

  async function runExport(exportMode = 'embedded') {
    if (!projectId || !filename) return;

    try {
      let sourceFile = currentOutputPath || getOriginalSourceFile();
      let exportStyle = null;

      if (subtitles.length > 0 && !outputHasBurnedSubtitles(sourceFile) && (exportMode === 'embedded' || exportMode === 'both')) {
        const subtitlePayload = getSubtitlesForSource(sourceFile);
        const burnScale = playback.getDisplayScaleForSource(sourceFile);
        exportStyle = buildBurnStyle(subtitleStyle, burnScale);
        setShowProcessingModal(true);
        setProcessingState({
          title: 'Preparando Exportação',
          message: 'Aplicando legendas ao vídeo final...',
          progress: 0,
        });

        const burnResult = await burnSubtitles({
          filename,
          projectId,
          clientId,
          sourceFile,
          subtitles: subtitlePayload,
          style: exportStyle,
        });

        setShowProcessingModal(false);
        sourceFile = burnResult.outputPath;
      }

      const shouldExportSubtitleFile = exportMode === 'separate' || exportMode === 'both';
      const exportSubtitles = shouldExportSubtitleFile ? getSubtitlesForSource(sourceFile) : [];
      const subtitleFileStyle = shouldExportSubtitleFile
        ? exportStyle || buildBurnStyle(subtitleStyle, playback.getDisplayScaleForSource(sourceFile))
        : null;
      const subtitleContent = exportSubtitles.length > 0
        ? generateAssSubtitles(exportSubtitles, subtitleFileStyle, videoInfo?.video)
        : null;

      const result = await exportVideo({
        projectId,
        sourceFile,
        originalName,
        subtitleContent: !tauri.isTauri() && shouldExportSubtitleFile ? subtitleContent : null,
        subtitles: tauri.isTauri() && shouldExportSubtitleFile ? exportSubtitles : null,
        style: tauri.isTauri() && shouldExportSubtitleFile ? subtitleFileStyle : null,
      });

      if (tauri.isTauri()) {
        if (result?.cancelled) {
          return;
        }

        if (result?.videoPath && result?.subtitlePath) {
          pushToast('Vídeo e legendas exportados com sucesso!', 'success');
        } else if (result?.videoPath) {
          pushToast('Vídeo exportado com sucesso!', 'success');
        } else if (result?.subtitlePath) {
          pushToast('Legendas exportadas com sucesso!', 'success');
        }
        return;
      }

      const blob = result;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `studiocut_export_${Date.now()}.mp4`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      pushToast('Vídeo exportado com sucesso!', 'success');

      if (shouldExportSubtitleFile && subtitleContent) {
        const subtitleBlob = new Blob([subtitleContent], { type: 'text/plain' });
        const subtitleUrl = URL.createObjectURL(subtitleBlob);
        const subtitleAnchor = document.createElement('a');
        subtitleAnchor.href = subtitleUrl;
        subtitleAnchor.download = `legendas_${Date.now()}.ass`;
        document.body.appendChild(subtitleAnchor);
        subtitleAnchor.click();
        document.body.removeChild(subtitleAnchor);
        URL.revokeObjectURL(subtitleUrl);
        if (exportMode === 'both') {
          pushToast('Legendas separadas exportadas com sucesso!', 'success');
        }
      }
    } catch (err) {
      setShowProcessingModal(false);
      const errorMsg = err?.message || String(err) || 'Erro desconhecido';
      pushToast(`Erro ao exportar: ${errorMsg}`, 'error');
    }
  }

  async function saveCurrentProject() {
    if (!projectId || !filename) return;
    setSaveProjectName(originalName?.replace(/\.\w+$/, '') || 'Meu Projeto');
    setShowSaveDialog(true);
  }

  async function confirmSaveProject() {
    if (!saveProjectName.trim()) return;
    setShowSaveDialog(false);
    try {
      const result = await saveProject({
        name: saveProjectName.trim(),
        projectId,
        filename,
        originalName,
        videoInfo,
        originalDuration: videoInfo?.duration || 0,
        originalWaveform,
        subtitles,
        editIntervals,
        processedVideoPath,
        currentOutputPath,
        subtitleSettings,
        subtitleStyle,
        layout: {
          dockProcessedPreview,
        },
        timeline: {
          ...timelineUi,
          intervals: editIntervals,
          subtitles: timelineSubtitles,
        },
        waveform: timelineWaveform,
      });
      if (result?.savedPath) {
        setLastSavedPath(result.savedPath);
      }
      pushToast(`Projeto "${saveProjectName.trim()}" salvo com sucesso!`, 'success');
    } catch (err) {
      const errorMsg = err?.message || String(err) || 'Erro desconhecido';
      pushToast(`Erro ao salvar: ${errorMsg}`, 'error');
    }
  }

  async function confirmSaveProjectToPath() {
    if (!saveProjectName.trim()) return;
    try {
      const result = await saveProjectDialog({
        name: saveProjectName.trim(),
        projectId,
        filename,
        originalName,
        videoInfo,
        originalDuration: videoInfo?.duration || 0,
        originalWaveform,
        subtitles,
        editIntervals,
        processedVideoPath,
        currentOutputPath,
        subtitleSettings,
        subtitleStyle,
        layout: {
          dockProcessedPreview,
        },
        timeline: {
          ...timelineUi,
          intervals: editIntervals,
          subtitles: timelineSubtitles,
        },
        waveform: timelineWaveform,
      });
      if (result?.cancelled) {
        return;
      }
      setShowSaveDialog(false);
      if (result?.savedPath) {
        setLastSavedPath(result.savedPath);
      }
      pushToast(`Projeto "${saveProjectName.trim()}" salvo com sucesso!`, 'success');
    } catch (err) {
      const errorMsg = err?.message || String(err) || 'Erro desconhecido';
      if (errorMsg !== 'Save cancelled') {
        pushToast(`Erro ao salvar: ${errorMsg}`, 'error');
      }
    }
  }

  async function openProjectList() {
    setShowProjectList(true);
    try {
      const list = await listProjects();
      startTransition(() => setProjects(list));
    } catch (err) {
      pushToast(`Erro ao listar projetos: ${err.message}`, 'error');
    }
  }

  async function openProject(projectName) {
    try {
      const state = await loadProject(projectName);

      resetEditorState();
      setProjectId(state.projectId);
      setFilename(state.filename);
      setOriginalName(state.originalName);
      setVideoInfo(state.videoInfo);
      setOriginalWaveform(state.originalWaveform || state.waveform || []);
      setTimelineWaveform(state.waveform || state.originalWaveform || []);
      setSubtitles(state.subtitles || []);
      setEditIntervals(state.editIntervals || []);
      setProcessedVideoPath(state.processedVideoPath || null);
      setCurrentOutputPath(state.currentOutputPath || null);
      setSubtitleSettings({
        ...DEFAULT_SUBTITLE_SETTINGS,
        ...(state.subtitleSettings || {}),
      });
      setSubtitleStyle({
        ...DEFAULT_SUBTITLE_STYLE,
        ...(state.subtitleStyle || {}),
      });
      setTimelineUi({
        ...DEFAULT_TIMELINE_UI,
        ...(state.timeline || {}),
      });
      const shouldDock = state.layout?.dockProcessedPreview ?? shouldUseDockedPreview(state.videoInfo);
      const loadedOutputPath = state.currentOutputPath || state.processedVideoPath || null;
      const previewOutputPath = getPreviewProcessedSource(
        loadedOutputPath,
        state.processedVideoPath || null,
        `/uploads/${state.filename}`,
      );
      setDockProcessedPreview(shouldDock);
      setEditorVisible(true);
      setShowProjectList(false);

      playback.loadOriginal(`/uploads/${state.filename}`, {
        showOriginal: !shouldDock,
        showProcessed: shouldDock,
      });
      playback.setSubtitles(state.subtitles || []);
      if (state.editIntervals?.length) {
        playback.setEditIntervals(state.editIntervals);
      }
      if (loadedOutputPath) {
        playback.loadProcessed(previewOutputPath);
      }

      pushToast(`Projeto "${projectName}" carregado!`, 'success');
    } catch (err) {
      pushToast(`Erro ao carregar: ${err.message}`, 'error');
    }
  }

  async function removeSavedProject(projectName) {
    setProjectToDelete(projectName);
    setShowDeleteProjectDialog(true);
  }

  async function confirmDeleteProject() {
    setShowDeleteProjectDialog(false);
    try {
      await deleteProject(projectToDelete);
      setProjects((prev) => prev.filter((project) => project.name !== projectToDelete));
      pushToast(`Projeto "${projectToDelete}" excluído.`, 'info');
    } catch (err) {
      pushToast(`Erro ao excluir: ${err.message}`, 'error');
    }
  }

  function handleToggleProcessed() {
    const visible = playback.toggleProcessed();
    if (!visible && !playback.showProcessed && !playback.processedLoaded) {
      pushToast('Carregue um vídeo primeiro.', 'info');
    }
  }

  function handleToggleSelection() {
    const next = !selectionMode;
    setSelectionMode(next);
    if (next) {
      pushToast('Arraste no track de áudio para selecionar um trecho', 'info', 3000);
    }
  }

  function handleCropChange(rect) {
    pushToast(`Crop: ${rect.width}×${rect.height} em (${rect.x}, ${rect.y})`, 'info', 2000);
  }

  function handleToggleDockedPreview() {
    const next = !dockProcessedPreview;
    setDockProcessedPreview(next);
    if (next && playback.showOriginal) {
      playback.toggleOriginal();
    }
  }

  function handleConfirmReturnHome() {
    setShowHomeConfirm(false);
    resetWorkspace();
    pushToast('Editor limpo. Escolha um novo vídeo para começar outro projeto.', 'info');
  }

  useEffect(() => {
    playback.setSubtitles(subtitles);
  }, [subtitles]);

  useEffect(() => {
    function handleKeyDown(event) {
      if (
        event.target.tagName === 'INPUT' ||
        event.target.tagName === 'TEXTAREA' ||
        event.target.tagName === 'SELECT' ||
        event.target.isContentEditable
      ) {
        return;
      }

      if (event.code === 'Space') {
        event.preventDefault();
        playback.togglePlay();
        return;
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        if (event.shiftKey) {
          playback.skip(-5);
        } else {
          playback.skip(-1);
        }
        return;
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        if (event.shiftKey) {
          playback.skip(5);
        } else {
          playback.skip(1);
        }
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        playback.setVolume(clamp(playback.volume + 0.05, 0, 1));
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        playback.setVolume(clamp(playback.volume - 0.05, 0, 1));
        return;
      }

      if (event.key === 'm' || event.key === 'M') {
        playback.toggleMute();
        return;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const dockedLayoutActive = dockProcessedPreview && playback.showProcessed;
  const showInlineSubtitlePanel = dockedLayoutActive && showSubtitleSidebar && hasWideDockLayout;
  const originalSourceFile = getOriginalSourceFile();
  const processedOutputSource = currentOutputPath || processedVideoPath || '';
  const processedPreviewSource = getPreviewProcessedSource(
    currentOutputPath,
    processedVideoPath,
    originalSourceFile,
  );
  const showProcessedSubtitleOverlay =
    subtitles.length > 0
    && Boolean(processedPreviewSource)
    && !outputHasBurnedSubtitles(processedPreviewSource);
  const shouldUseTimelinePreviewSubtitles =
    playback.hasEditedTimeline()
    && processedPreviewSource
    && processedPreviewSource !== originalSourceFile;
  const processedPreviewSubtitles = useMemo(
    () => (
      showProcessedSubtitleOverlay
        ? (shouldUseTimelinePreviewSubtitles ? timelineSubtitles : subtitles)
        : []
    ),
    [showProcessedSubtitleOverlay, shouldUseTimelinePreviewSubtitles, subtitles, timelineSubtitles],
  );

  return (
    <div className="app-shell">
      <Header
        editorVisible={editorVisible}
        originalName={originalName}
        videoInfo={videoInfo}
        onGoHome={() => setShowHomeConfirm(true)}
        onSave={saveCurrentProject}
        onOpenProjects={openProjectList}
        onExport={() => setShowExportDialog(true)}
        onOpenSettings={() => setShowSettingsModal(true)}
      />

      {!editorVisible ? (
        <UploadScreen onUpload={handleUpload} uploadState={uploadState} />
      ) : (
        <div id="editor-screen">
          <Toolbar
            playback={playback}
            selectionMode={selectionMode}
            zoom={timelineUi.zoom}
            subtitlePanelOpen={showSubtitleSidebar}
            dockProcessedPreview={dockProcessedPreview}
            onToggleSilence={() => {
              setShowSilencePanel((prev) => !prev);
              setShowSubtitleSidebar(false);
            }}
            onToggleSubtitles={() => {
              setShowSubtitleSidebar((prev) => !prev);
              setShowSilencePanel(false);
            }}
            onToggleCrop={() => setCropActive((prev) => !prev)}
            cropActive={cropActive}
            onToggleSelection={handleToggleSelection}
            onToggleOriginal={playback.toggleOriginal}
            onToggleProcessed={handleToggleProcessed}
            onToggleDockedPreview={handleToggleDockedPreview}
            onZoomIn={() => setTimelineUi((prev) => ({ ...prev, zoom: clamp(prev.zoom * 1.5, 0.5, 50) }))}
            onZoomOut={() => setTimelineUi((prev) => ({ ...prev, zoom: clamp(prev.zoom / 1.5, 0.5, 50) }))}
            onZoomFit={() => setTimelineUi((prev) => ({ ...prev, zoom: 1 }))}
            onZoomToSlider={(val) => setTimelineUi((prev) => ({ ...prev, zoom: 0.5 + (val / 100) * 49.5 }))}
          />

          <div
            className={cn(
              'editor-workspace',
              dockedLayoutActive && 'editor-workspace--docked',
              showInlineSubtitlePanel && 'editor-workspace--with-subtitle-panel',
            )}
          >
            <div className="editor-main-column">
              <PreviewArea
                playback={playback}
                cropActive={cropActive}
                cropRect={cropRect}
                processedPreviewSubtitles={processedPreviewSubtitles}
                subtitleStyle={subtitleStyle}
                showSubtitleOverlay={showProcessedSubtitleOverlay}
                dockProcessedPreview={dockedLayoutActive}
                onCropRectChange={setCropRect}
                onCropChange={handleCropChange}
              />

              <TransportControls playback={playback} />

              <TimelinePanel
                duration={playback.duration}
                currentTime={playback.currentTime}
                waveform={timelineWaveform}
                intervals={editIntervals}
                subtitles={timelineSubtitles}
                subtitleTrackVisible={subtitles.length > 0}
                selectionMode={selectionMode}
                timelineUi={timelineUi}
                fillAvailableHeight={dockedLayoutActive}
                onTimelineUiChange={setTimelineUi}
                onSeek={playback.seek}
              />
            </div>

            <InlineSubtitlePanel
              open={showInlineSubtitlePanel}
              settings={subtitleSettings}
              setSettings={setSubtitleSettings}
              style={subtitleStyle}
              setStyle={setSubtitleStyle}
              subtitles={subtitles}
              onClose={() => setShowSubtitleSidebar(false)}
              onGenerate={runSubtitleGeneration}
              onToast={pushToast}
            />
          </div>
        </div>
      )}

      <SubtitleSidebar
        open={showSubtitleSidebar && !showInlineSubtitlePanel}
        settings={subtitleSettings}
        setSettings={setSubtitleSettings}
        style={subtitleStyle}
        setStyle={setSubtitleStyle}
        subtitles={subtitles}
        onClose={() => setShowSubtitleSidebar(false)}
        onGenerate={runSubtitleGeneration}
        onToast={pushToast}
      />

      <SilenceSidebar
        open={showSilencePanel}
        settings={silenceSettings}
        setSettings={setSilenceSettings}
        onClose={() => setShowSilencePanel(false)}
        onRun={runSilenceRemoval}
      />

      <ProcessingModal open={showProcessingModal} state={processingState} />

      <HomeConfirmModal
        open={showHomeConfirm}
        onClose={() => setShowHomeConfirm(false)}
        onConfirm={handleConfirmReturnHome}
      />

      <ProjectListModal
        open={showProjectList}
        projects={projects}
        onClose={() => setShowProjectList(false)}
        onOpen={openProject}
        onDelete={removeSavedProject}
      />

      <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Salvar Projeto</DialogTitle>
            <DialogDescription>Escolha um nome para salvar o projeto atual.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Nome do projeto</Label>
              <Input
                value={saveProjectName}
                onChange={(e) => setSaveProjectName(e.target.value)}
                placeholder="Ex: Meu Projeto"
                onKeyDown={(e) => e.key === 'Enter' && confirmSaveProject()}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSaveDialog(false)}>
              Cancelar
            </Button>
            <Button variant="secondary" onClick={confirmSaveProjectToPath} disabled={!saveProjectName.trim()}>
              Salvar em...
            </Button>
            <Button onClick={confirmSaveProject} disabled={!saveProjectName.trim()}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDeleteProjectDialog} onOpenChange={setShowDeleteProjectDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir projeto?</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir o projeto &quot;{projectToDelete}&quot;? Esta a&ccedil;&atilde;o n&atilde;o pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteProject} className="bg-red-600 hover:bg-red-700">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={showExportDialog} onOpenChange={(open) => { setShowExportDialog(open); if (open) setExportMode('embedded'); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Exportar Projeto</DialogTitle>
            <DialogDescription>Escolha como deseja exportar o vídeo e as legendas.</DialogDescription>
          </DialogHeader>
          <RadioGroup value={exportMode} onValueChange={setExportMode} className="gap-3 py-2">
            <div className="flex items-start space-x-3 rounded-lg border border-surface-200 p-4 cursor-pointer transition-colors hover:bg-primary-50/50 has-[[data-state=checked]]:border-primary-500 has-[[data-state=checked]]:bg-primary-50/50" onClick={() => setExportMode('embedded')}>
              <RadioGroupItem value="embedded" className="mt-1" />
              <div className="flex-1">
                <Label className="text-sm font-semibold text-surface-800 uppercase-normal tracking-normal normal-case">Legendas embutidas</Label>
                <p className="text-xs text-surface-500 mt-1">Queima as legendas diretamente no v&iacute;deo.</p>
              </div>
            </div>
            <div className="flex items-start space-x-3 rounded-lg border border-surface-200 p-4 cursor-pointer transition-colors hover:bg-primary-50/50 has-[[data-state=checked]]:border-primary-500 has-[[data-state=checked]]:bg-primary-50/50" onClick={() => setExportMode('separate')}>
              <RadioGroupItem value="separate" className="mt-1" />
              <div className="flex-1">
                <Label className="text-sm font-semibold text-surface-800 uppercase-normal tracking-normal normal-case">Legendas separadas</Label>
                <p className="text-xs text-surface-500 mt-1">Exporta o v&iacute;deo e um arquivo de legenda .ass separado.</p>
              </div>
            </div>
            <div className="flex items-start space-x-3 rounded-lg border border-surface-200 p-4 cursor-pointer transition-colors hover:bg-primary-50/50 has-[[data-state=checked]]:border-primary-500 has-[[data-state=checked]]:bg-primary-50/50" onClick={() => setExportMode('both')}>
              <RadioGroupItem value="both" className="mt-1" />
              <div className="flex-1">
                <Label className="text-sm font-semibold text-surface-800 uppercase-normal tracking-normal normal-case">Ambos</Label>
                <p className="text-xs text-surface-500 mt-1">Exporta o v&iacute;deo com legendas embutidas e tamb&eacute;m o arquivo .ass separado.</p>
              </div>
            </div>
          </RadioGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowExportDialog(false)}>
              Cancelar
            </Button>
            <Button onClick={() => { setShowExportDialog(false); runExport(exportMode); }}>
              <Download className="w-4 h-4" />
              Exportar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showSettingsModal} onOpenChange={setShowSettingsModal}>
        <DialogContent className="max-w-md p-6" showClose={false}>
          <DialogHeader className="mb-2">
            <DialogTitle>Configurações</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Label>Pasta dos modelos Whisper</Label>
            <Input value={whisperModelsPath} readOnly />
            <div className="flex gap-2">
              <Button onClick={chooseWhisperFolder}>Escolher pasta</Button>
              <Button variant="ghost" onClick={openWhisperFolder}>Abrir pasta</Button>
            </div>
          </div>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setShowSettingsModal(false)}>Cancelar</Button>
            <Button onClick={saveSettings}>Salvar alterações</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ToastViewport toasts={toasts} />
    </div>
  );
}

function Header({ editorVisible, originalName, videoInfo, onGoHome, onSave, onOpenProjects, onExport, onOpenSettings }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  function handleMenuAction(action) {
    setMenuOpen(false);
    action();
  }

  return (
    <header id="app-header" className="bg-white/80 backdrop-blur-xl border-b border-surface-200 sticky top-0 z-50">
      <div className="max-w-[1920px] mx-auto px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative" ref={menuRef}>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setMenuOpen(!menuOpen)}
              title="Menu"
            >
              <Menu className="w-5 h-5" />
            </Button>
            {menuOpen && (
              <div className="absolute top-full left-0 mt-2 w-56 rounded-lg border border-surface-200 bg-white shadow-lg py-1 z-50">
                <button
                  type="button"
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-surface-700 hover:bg-primary-50 transition-colors ${!editorVisible ? 'hidden' : ''}`}
                  onClick={() => handleMenuAction(onGoHome)}
                >
                  <Clapperboard className="w-4 h-4" />
                  Novo projeto
                </button>
                <button
                  type="button"
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-surface-700 hover:bg-primary-50 transition-colors ${!editorVisible ? 'hidden' : ''}`}
                  onClick={() => handleMenuAction(onSave)}
                >
                  <Save className="w-4 h-4" />
                  Salvar
                </button>
                <button
                  type="button"
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-surface-700 hover:bg-primary-50 transition-colors"
                  onClick={() => handleMenuAction(onOpenProjects)}
                >
                  <FolderOpen className="w-4 h-4" />
                  Abrir
                </button>
                <div className={`my-1 border-t border-surface-100 ${!editorVisible ? 'hidden' : ''}`} />
                <button
                  type="button"
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-primary-700 hover:bg-primary-50 transition-colors ${!editorVisible ? 'hidden' : ''}`}
                  onClick={() => handleMenuAction(onExport)}
                >
                  <Video className="w-4 h-4" />
                  Exportar Vídeo
                </button>
                <button
                  type="button"
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-primary-700 hover:bg-primary-50 transition-colors ${!editorVisible ? 'hidden' : ''}`}
                  onClick={() => onOpenSettings?.()}
                >
                  <Settings className="w-4 h-4" />
                  Configurações
                </button>
              </div>
            )}
          </div>
          <div className="w-8 h-8 bg-gradient-to-br from-primary-500 to-primary-700 rounded-lg flex items-center justify-center">
            <Clapperboard className="w-4 h-4 text-white" />
          </div>
          <h1 className="text-lg font-bold bg-gradient-to-r from-primary-600 to-primary-800 bg-clip-text text-transparent">StudioCut</h1>
          <span className="text-[10px] font-medium bg-primary-100 text-primary-700 px-2 py-0.5 rounded-full">AI</span>
        </div>

        <div id="project-info" className={`${editorVisible ? 'flex' : 'hidden'} items-center gap-4 text-sm text-surface-500`}>
          <span className="font-medium text-surface-700">{originalName}</span>
          <span className="text-surface-300">|</span>
          <span>{videoInfo?.video?.width}×{videoInfo?.video?.height}</span>
          <span className="text-surface-300">|</span>
          <span>{formatDuration(videoInfo?.duration || 0)}</span>
        </div>

        <div className="w-8" />
      </div>
    </header>
  );
}

function UploadScreen({ onUpload, uploadState }) {
  const inputRef = useRef(null);
  const showUploadState = uploadState.phase !== 'idle';
  const isProcessing = uploadState.phase === 'processing';
  const uploadProgress = isProcessing ? 100 : uploadState.progress;

  async function handleFileSelect() {
    if (tauri.isTauri()) {
      const path = await tauri.openFilePicker();
      if (path) {
        onUpload({ path, name: path.split('/').pop() || path.split('\\').pop() || 'video.mp4' });
      }
      return;
    }
    inputRef.current?.click();
  }

  function handleFiles(files) {
    const file = files?.[0];
    if (file) onUpload(file);
  }

  return (
    <div id="upload-screen" className="flex items-center justify-center min-h-[calc(100vh-56px)]">
      <Card className="mx-auto w-full max-w-xl border-surface-200/80 shadow-xl shadow-surface-200/40">
        <CardContent className="px-6 py-10 text-center">
          <div className="w-20 h-20 bg-gradient-to-br from-primary-100 to-primary-200 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-primary-100">
            <Film className="w-10 h-10 text-primary-600" />
          </div>
          <h2 className="text-3xl font-bold text-surface-900 mb-2">Editor de Vídeo com IA</h2>
          <p className="text-surface-500 mb-8 text-lg">
            Remova silêncios, gere legendas automáticas, corte e edite seus vídeos com inteligência artificial
          </p>

          <div
            id="drop-zone"
            className="block rounded-2xl border-2 border-dashed border-surface-300 bg-surface-50/60 p-12 cursor-pointer transition-all duration-300 group hover:border-primary-400 hover:bg-primary-50/50"
            onClick={handleFileSelect}
            onDragEnter={(event) => { event.preventDefault(); event.currentTarget.classList.add('drop-zone-active'); }}
            onDragOver={(event) => { event.preventDefault(); event.currentTarget.classList.add('drop-zone-active'); }}
            onDragLeave={(event) => { event.preventDefault(); event.currentTarget.classList.remove('drop-zone-active'); }}
            onDrop={(event) => {
              event.preventDefault();
              event.currentTarget.classList.remove('drop-zone-active');
              handleFiles(event.dataTransfer.files);
            }}
          >
            <div className="flex flex-col items-center gap-4">
              <div className="w-14 h-14 bg-white group-hover:bg-primary-100 rounded-xl flex items-center justify-center transition-colors shadow-sm">
                <UploadCloud className="w-7 h-7 text-surface-400 group-hover:text-primary-500 transition-colors" />
              </div>
              <div>
                <p className="font-semibold text-surface-700 group-hover:text-primary-700 transition-colors">
                  {tauri.isTauri() ? 'Clique para selecionar um vídeo' : 'Arraste um vídeo ou clique para selecionar'}
                </p>
                <p className="text-sm text-surface-400 mt-1">MP4, MOV, AVI, MKV, WebM • Até 2GB</p>
              </div>
            </div>
            {!tauri.isTauri() && (
              <input
                ref={inputRef}
                id="file-input"
                type="file"
                accept="video/*"
                className="hidden"
                onChange={(event) => handleFiles(event.target.files)}
              />
            )}
          </div>

          {showUploadState ? (
            <div id="upload-progress" className="mt-6 space-y-4 text-left">
              <Card className="border-surface-200/80 bg-surface-50/80">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-surface-600">Enviando vídeo</span>
                    <span className="text-sm font-mono text-primary-600">{uploadProgress}%</span>
                  </div>
                  <Progress value={uploadProgress} />
                </CardContent>
              </Card>

              {isProcessing ? (
                <Card className="border-primary-100 bg-white/85 shadow-sm shadow-primary-100/40">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <div>
                        <p className="text-sm font-semibold text-surface-700">Preparando editor</p>
                        <p className="text-xs text-surface-500">Gerando waveform e metadados antes de liberar a interface.</p>
                      </div>
                      <Loader2 className="w-4 h-4 text-primary-500 animate-spin flex-shrink-0" />
                    </div>
                    <div className="w-full bg-primary-50 rounded-full h-2 overflow-hidden">
                      <div className="indeterminate-progress" />
                    </div>
                  </CardContent>
                </Card>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function Toolbar({
  playback,
  selectionMode,
  zoom,
  cropActive,
  subtitlePanelOpen,
  dockProcessedPreview,
  onToggleSilence,
  onToggleSubtitles,
  onToggleCrop,
  onToggleSelection,
  onToggleOriginal,
  onToggleProcessed,
  onToggleDockedPreview,
  onZoomIn,
  onZoomOut,
  onZoomFit,
  onZoomToSlider,
}) {
  return (
    <div id="toolbar" className="bg-white border-b border-surface-200 px-6 py-2">
      <div className="flex items-center gap-1">
        <div className="flex items-center gap-1 pr-3 mr-3 border-r border-surface-200">
          <span className="text-[10px] font-bold text-primary-500 uppercase tracking-wider mr-2">IA</span>
          <ToolbarButton icon={<Scissors className="w-4 h-4" />} onClick={onToggleSilence}>
            Remover Silêncio
          </ToolbarButton>
          <ToolbarButton icon={<Subtitles className="w-4 h-4" />} active={subtitlePanelOpen} onClick={onToggleSubtitles}>
            Legendas IA
          </ToolbarButton>
        </div>

        <div className="flex items-center gap-1 pr-3 mr-3 border-r border-surface-200">
          <ToolbarButton icon={<Crop className="w-4 h-4" />} active={cropActive} onClick={onToggleCrop}>
            Crop
          </ToolbarButton>
          <ToolbarButton icon={<TextCursorInput className="w-4 h-4" />} active={selectionMode} onClick={onToggleSelection}>
            Selecionar
          </ToolbarButton>
        </div>

        <div className="flex items-center gap-1 pr-3 mr-3 border-r border-surface-200">
          <ToolbarButton icon={<Monitor className="w-4 h-4" />} active={playback.showOriginal} onClick={onToggleOriginal}>
            Original
          </ToolbarButton>
          <ToolbarButton icon={<MonitorCheck className="w-4 h-4" />} active={playback.showProcessed} onClick={onToggleProcessed}>
            Processado
          </ToolbarButton>
        </div>

        <div className="flex items-center gap-1 pr-3 mr-3 border-r border-surface-200">
          <ToolbarButton icon={<Layout className="w-4 h-4" />} active={dockProcessedPreview} onClick={onToggleDockedPreview}>
            Visualização Vertical
          </ToolbarButton>
        </div>

        <div className="flex items-center gap-1">
          <ToolbarIconButton onClick={onZoomOut} title="Zoom Out">
            <ZoomOut className="w-4 h-4" />
          </ToolbarIconButton>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={((zoom - 0.5) / 49.5) * 100}
            onChange={(e) => onZoomToSlider(Number(e.target.value))}
            className="w-24 h-1 accent-primary-600 cursor-pointer"
            title="Zoom"
          />
          <span className="text-xs font-mono text-surface-500 w-12 text-center">{Math.round(zoom * 100)}%</span>
          <ToolbarIconButton onClick={onZoomIn} title="Zoom In">
            <ZoomIn className="w-4 h-4" />
          </ToolbarIconButton>
          <ToolbarIconButton onClick={onZoomFit} title="Ajustar à Tela">
            <Maximize2 className="w-4 h-4" />
          </ToolbarIconButton>
        </div>
      </div>
    </div>
  );
}

function ToolbarButton({ children, icon, active = false, onClick }) {
  return (
    <Button
      type="button"
      variant="toolbar"
      size="toolbar"
      className={cn('gap-1.5', active ? 'bg-primary-50 text-primary-700 hover:bg-primary-100' : '')}
      onClick={onClick}
    >
      {icon}
      <span>{children}</span>
    </Button>
  );
}

function ToolbarIconButton({ children, onClick, title }) {
  return (
    <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={onClick} title={title}>
      {children}
    </Button>
  );
}

function VideoPanelLoadingState({ title, message }) {
  return (
    <div className="video-panel-loading">
      <Card className="video-panel-loading__card border-white/12 bg-slate-900/72 text-white backdrop-blur-xl">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
              <Loader2 className="w-4 h-4 text-white animate-spin" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white">{title}</p>
              <p className="text-xs text-white/70 mt-1">{message}</p>
            </div>
          </div>
          <div className="mt-4 h-2 rounded-full bg-white/10 overflow-hidden">
            <div className="indeterminate-progress" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function OriginalVideoPanel({
  playback,
  cropActive,
  cropRect,
  onCropRectChange,
  onCropChange,
  className = '',
}) {
  return (
    <div id="original-panel" className={`${className} flex-col min-w-0 min-h-0`}>
      <div className="flex items-center gap-2 mb-2">
        <div className="w-2 h-2 rounded-full bg-surface-400" />
        <span className="text-xs font-semibold text-surface-500 uppercase tracking-wider">Original</span>
        <span className="text-xs font-mono text-surface-400 ml-auto">{formatTime(playback.originalTime)}</span>
      </div>
      <div className="relative bg-black rounded-xl overflow-hidden flex-1 min-h-0 flex items-center justify-center shadow-lg group">
        <div className="video-frame relative max-w-full max-h-full">
          <video
            ref={playback.originalVideoRef}
            className="max-w-full max-h-full object-contain"
            preload="metadata"
            playsInline
            onLoadedMetadata={playback.handleOriginalLoadedMetadata}
            onTimeUpdate={playback.handleOriginalTimeUpdate}
            onEnded={playback.handleEnded}
          />
        </div>
        <CropOverlay
          active={cropActive}
          videoRef={playback.originalVideoRef}
          rect={cropRect}
          onRectChange={onCropRectChange}
          onCropChange={onCropChange}
        />
        {!playback.originalReady ? (
          <VideoPanelLoadingState
            title="Carregando vídeo original"
            message="A timeline já está disponível. O player será liberado assim que os metadados chegarem."
          />
        ) : null}
      </div>
    </div>
  );
}

function ProcessedVideoPanel({
  playback,
  subtitles,
  subtitleStyle,
  showSubtitleOverlay,
  className = '',
}) {
  const subtitlePreviewStyle = buildSubtitlePreviewStyle(subtitleStyle);
  const [videoElement, setVideoElement] = useState(null);
  const [assRendererFailed, setAssRendererFailed] = useState(false);

  function handleProcessedVideoRef(node) {
    playback.processedVideoRef.current = node;
    setVideoElement(node);
  }

  return (
    <div id="processed-panel" className={`${className} flex-col min-w-0 min-h-0`}>
      <div className="flex items-center gap-2 mb-2">
        <div className="w-2 h-2 rounded-full bg-emerald-500" />
        <span className="text-xs font-semibold text-emerald-600 uppercase tracking-wider">Processado</span>
        <span className="text-xs font-mono text-surface-400 ml-auto">{formatTime(playback.processedTime)}</span>
      </div>
      <div className="relative bg-black rounded-xl overflow-hidden flex-1 min-h-0 flex items-center justify-center shadow-lg">
        <div className="video-frame relative max-w-full max-h-full">
          <video
            ref={handleProcessedVideoRef}
            className="block max-w-full max-h-full object-contain"
            preload="metadata"
            playsInline
            onLoadedMetadata={playback.handleProcessedLoadedMetadata}
            onTimeUpdate={playback.handleProcessedTimeUpdate}
            onEnded={playback.handleEnded}
          />
          <AssSubtitleRenderer
            videoElement={videoElement}
            enabled={showSubtitleOverlay}
            subtitles={subtitles}
            subtitleStyle={subtitleStyle}
            onFailureChange={setAssRendererFailed}
          />
          <div
            id="processed-subtitle-overlay"
            className={`video-subtitle-overlay ${showSubtitleOverlay && assRendererFailed && playback.subtitleText ? '' : 'hidden'}`}
            style={subtitlePreviewStyle.container}
          >
            <div className="video-subtitle-overlay__text" style={subtitlePreviewStyle.text}>
              {playback.subtitleText}
            </div>
          </div>
        </div>
        {playback.showProcessed && !playback.processedReady ? (
          <VideoPanelLoadingState
            title="Carregando saída processada"
            message="O comparador fica disponível assim que a nova mídia terminar de abrir."
          />
        ) : null}
      </div>
    </div>
  );
}

function PreviewArea({
  playback,
  cropActive,
  cropRect,
  processedPreviewSubtitles,
  subtitleStyle,
  showSubtitleOverlay,
  dockProcessedPreview,
  onCropRectChange,
  onCropChange,
}) {
  const previewAreaClass = `preview-area ${dockProcessedPreview && !playback.showOriginal ? 'preview-area--collapsed' : ''}`;
  const originalPanelClass = playback.showOriginal ? 'flex flex-1' : 'hidden';
  const processedPanelClass = [
    playback.showProcessed ? 'flex' : 'hidden',
    dockProcessedPreview ? 'editor-preview-dock' : 'flex-1',
  ].filter(Boolean).join(' ');

  return (
    <div id="preview-area" className={previewAreaClass}>
      <OriginalVideoPanel
        playback={playback}
        cropActive={cropActive}
        cropRect={cropRect}
        onCropRectChange={onCropRectChange}
        onCropChange={onCropChange}
        className={originalPanelClass}
      />

      <ProcessedVideoPanel
        playback={playback}
        subtitles={processedPreviewSubtitles}
        subtitleStyle={subtitleStyle}
        showSubtitleOverlay={showSubtitleOverlay}
        className={processedPanelClass}
      />
    </div>
  );
}

function TransportControls({ playback }) {
  const VolumeIcon = playback.muted ? VolumeX : playback.volume < 0.5 ? Volume1 : Volume2;
  const mediaReady = playback.originalReady;

  return (
    <div id="transport" className="bg-white border-t border-surface-200 px-6 py-3 flex-shrink-0">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1">
          <Button type="button" variant="transport" size="transport" title="Ir ao início" onClick={() => playback.seek(0)} disabled={!mediaReady}>
            <span className="text-[11px] font-mono font-semibold tracking-tight">{'|<'}</span>
          </Button>
          <Button type="button" variant="transport" size="transport" title="Voltar 5s" onClick={() => playback.skip(-5)} disabled={!mediaReady}>
            <SkipBack className="w-4 h-4" />
          </Button>
          <Button
            type="button"
            size="icon"
            className={cn(
              'h-10 w-10 rounded-full shadow-md',
              mediaReady ? 'bg-primary-600 text-white hover:bg-primary-700 hover:shadow-lg active:scale-95' : 'bg-primary-200 text-white cursor-not-allowed',
            )}
            onClick={playback.togglePlay}
            disabled={!mediaReady}
          >
            {!mediaReady ? <Loader2 className="w-4 h-4 animate-spin" /> : playback.isPlaying ? <div className="w-4 h-4 border-x-2 border-white" /> : <div className="ml-0.5 border-l-[12px] border-l-white border-y-[8px] border-y-transparent" />}
          </Button>
          <Button type="button" variant="transport" size="transport" title="Avançar 5s" onClick={() => playback.skip(5)} disabled={!mediaReady}>
            <SkipForward className="w-4 h-4" />
          </Button>
          <Button type="button" variant="transport" size="transport" title="Ir ao fim" onClick={() => playback.seek(playback.duration)} disabled={!mediaReady}>
            <span className="text-[11px] font-mono font-semibold tracking-tight">{'>|'}</span>
          </Button>
        </div>

        <div className="flex items-center gap-1.5 text-xs font-mono text-surface-500">
          <input
            id="current-time"
            type="text"
            value={playback.timeInput}
            onChange={(event) => playback.setTimeInput(event.target.value)}
            onFocus={playback.handleTimeInputFocus}
            onBlur={playback.handleTimeInputBlur}
            onKeyDown={playback.handleTimeInputKeyDown}
            className={`w-[82px] bg-transparent border border-transparent rounded px-1.5 py-1 text-center outline-none transition-all font-mono text-xs ${mediaReady ? 'hover:border-surface-300 focus:border-primary-400 focus:bg-white cursor-text' : 'cursor-not-allowed opacity-60'}`}
            disabled={!mediaReady}
          />
          <span className="text-surface-300">/</span>
          <span className="px-1.5 py-1">{formatTime(playback.duration)}</span>
        </div>

        {!mediaReady ? (
          <div className="flex items-center gap-2 rounded-full bg-primary-50 px-3 py-1 text-[11px] font-medium text-primary-700">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Carregando mídia
          </div>
        ) : null}

        <div className="flex items-center gap-2 ml-auto">
          <Gauge className="w-3.5 h-3.5 text-surface-400" />
          <select
            value={String(playback.playbackRate)}
            onChange={(event) => playback.setPlaybackRate(parseFloat(event.target.value))}
            className="text-xs bg-surface-100 border border-surface-200 rounded-md px-2 py-1 text-surface-600 font-medium cursor-pointer"
          >
            <option value="0.25">0.25x</option>
            <option value="0.5">0.5x</option>
            <option value="0.75">0.75x</option>
            <option value="1">1x</option>
            <option value="1.25">1.25x</option>
            <option value="1.5">1.5x</option>
            <option value="2">2x</option>
          </select>

          <div className="flex items-center gap-2 ml-4">
            <Button type="button" variant="transport" size="transport" title="Mudo" onClick={playback.toggleMute}>
              <VolumeIcon className="w-4 h-4" />
            </Button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={playback.volume}
              className="w-20 accent-primary-600"
              onChange={(event) => playback.setVolume(parseFloat(event.target.value))}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function TimelinePanel({
  duration,
  currentTime,
  waveform,
  intervals,
  subtitles,
  subtitleTrackVisible,
  selectionMode,
  timelineUi,
  fillAvailableHeight = false,
  onTimelineUiChange,
  onSeek,
}) {
  const rulerRef = useRef(null);
  const rulerCanvasRef = useRef(null);
  const videoCanvasRef = useRef(null);
  const audioCanvasRef = useRef(null);
  const subtitleCanvasRef = useRef(null);
  const scrollWrapperRef = useRef(null);
  const videoTrackRef = useRef(null);
  const audioTrackRef = useRef(null);
  const subtitleTrackRef = useRef(null);
  const scrollbarTrackRef = useRef(null);

  const [viewWidth, setViewWidth] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [selection, setSelection] = useState(null);
  const [draggingPlayhead, setDraggingPlayhead] = useState(false);
  const [thumbDrag, setThumbDrag] = useState(null);
  const [resizeDrag, setResizeDrag] = useState(null);

  const totalWidth = Math.max(1, viewWidth * timelineUi.zoom);
  const thumbWidth = totalWidth <= viewWidth || viewWidth === 0
    ? viewWidth
    : Math.max(30, (viewWidth / totalWidth) * (scrollbarTrackRef.current?.clientWidth || 0));
  const scrollMax = Math.max(0, totalWidth - viewWidth);
  const thumbTrackWidth = scrollbarTrackRef.current?.clientWidth || 0;
  const thumbLeft = scrollMax > 0 && thumbTrackWidth > thumbWidth
    ? (scrollLeft / scrollMax) * (thumbTrackWidth - thumbWidth)
    : 0;

  function timeToX(time) {
    if (!duration) return 0;
    return (time / duration) * totalWidth;
  }

  function xToTime(x) {
    if (!duration) return 0;
    return (x / totalWidth) * duration;
  }

  useEffect(() => {
    if (!rulerRef.current) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      setViewWidth(entry.contentRect.width);
    });
    observer.observe(rulerRef.current);
    setViewWidth(rulerRef.current.clientWidth);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!selectionMode) setSelection(null);
  }, [selectionMode]);

  useEffect(() => {
    const syncedNodes = [rulerRef.current, videoTrackRef.current, audioTrackRef.current, subtitleTrackRef.current];
    syncedNodes.forEach((node) => {
      if (node) node.scrollLeft = scrollLeft;
    });
  }, [scrollLeft]);

  useEffect(() => {
    function handleMouseMove(event) {
      if (draggingPlayhead && scrollWrapperRef.current) {
        const rect = scrollWrapperRef.current.getBoundingClientRect();
        const x = event.clientX - rect.left - 180 + scrollLeft;
        onSeek(clamp(xToTime(x), 0, duration));
      }

      if (thumbDrag && scrollbarTrackRef.current) {
        const dx = event.clientX - thumbDrag.startX;
        const trackWidth = scrollbarTrackRef.current.clientWidth;
        const nextLeft = clamp(thumbDrag.startLeft + dx, 0, Math.max(trackWidth - thumbWidth, 0));
        const nextScroll = trackWidth <= thumbWidth
          ? 0
          : (nextLeft / (trackWidth - thumbWidth)) * scrollMax;
        setScrollLeft(nextScroll);
      }

      if (resizeDrag) {
        const dy = event.clientY - resizeDrag.startY;
        onTimelineUiChange((prev) => ({
          ...prev,
          trackHeights: {
            ...prev.trackHeights,
            [resizeDrag.track]: clamp(resizeDrag.startHeight + dy, 30, 120),
          },
        }));
      }

      if (selection?.active && audioTrackRef.current) {
        const rect = audioTrackRef.current.getBoundingClientRect();
        const x = event.clientX - rect.left + scrollLeft;
        setSelection((prev) => ({ ...prev, end: clamp(xToTime(x), 0, duration) }));
      }
    }

    function handleMouseUp() {
      setDraggingPlayhead(false);
      setThumbDrag(null);
      setResizeDrag(null);
      setSelection((prev) => prev ? { ...prev, active: false } : prev);
    }

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingPlayhead, duration, onSeek, resizeDrag, scrollLeft, selection, thumbDrag, thumbWidth, scrollMax, onTimelineUiChange]);

  useEffect(() => {
    if (duration <= 0 || viewWidth <= 0) return;

    drawRuler(rulerCanvasRef.current, totalWidth, 28, duration);
    drawVideoTrack(videoCanvasRef.current, totalWidth, timelineUi.trackHeights.video, duration, intervals, selection, timelineUi.collapsedMode);
    drawAudioTrack(audioCanvasRef.current, totalWidth, timelineUi.trackHeights.audio, waveform, duration, intervals, selection, timelineUi.waveformAmplitude, timelineUi.collapsedMode);

    if (subtitleCanvasRef.current) {
      if (subtitleTrackVisible && subtitles.length > 0) {
        drawSubtitleTrack(subtitleCanvasRef.current, totalWidth, timelineUi.trackHeights.subtitle, subtitles, duration);
      } else {
        clearCanvas(subtitleCanvasRef.current, totalWidth, timelineUi.trackHeights.subtitle);
      }
    }
  }, [
    duration,
    intervals,
    selection,
    subtitles,
    subtitleTrackVisible,
    timelineUi.collapsedMode,
    timelineUi.trackHeights.audio,
    timelineUi.trackHeights.subtitle,
    timelineUi.trackHeights.video,
    timelineUi.waveformAmplitude,
    totalWidth,
    viewWidth,
    waveform,
  ]);

  function handleSeekFromElement(event, element) {
    const rect = element.getBoundingClientRect();
    const time = clamp(xToTime(event.clientX - rect.left + scrollLeft), 0, duration);
    onSeek(time);
  }

  function handleNativeScroll(event) {
    const nextScrollLeft = event.currentTarget.scrollLeft;
    if (Math.abs(nextScrollLeft - scrollLeft) > 1) {
      setScrollLeft(clamp(nextScrollLeft, 0, scrollMax));
    }
  }

  return (
    <div
      id="timeline-area"
      className={`bg-white border-t border-surface-200 flex flex-col ${fillAvailableHeight ? 'flex-1 min-h-[220px]' : 'flex-shrink-0'}`}
      style={fillAvailableHeight ? undefined : { height: '220px' }}
    >
      <div className="flex items-center border-b border-surface-100 bg-surface-50 h-[28px] relative overflow-hidden">
        <div className="w-[180px] min-w-[180px] border-r border-surface-200 px-3 flex items-center">
          <span className="text-[10px] font-bold text-surface-400 uppercase tracking-wider">Faixas</span>
        </div>
        <div
          id="timeline-ruler"
          ref={rulerRef}
          className="flex-1 self-stretch h-full relative overflow-x-auto overflow-y-hidden"
          style={{ scrollbarWidth: 'none' }}
          onScroll={handleNativeScroll}
          onMouseDown={(event) => handleSeekFromElement(event, event.currentTarget)}
        >
          <canvas ref={rulerCanvasRef} id="ruler-canvas" className="block h-full" />
        </div>
      </div>

      <div id="tracks-scroll-wrapper" ref={scrollWrapperRef} className="flex-1 overflow-y-auto overflow-x-hidden relative">
        <div className="flex flex-col min-h-full">
          <TrackRow
            title="Vídeo 1"
            icon={<Video className="w-3.5 h-3.5 text-blue-500" />}
            height={timelineUi.trackHeights.video}
            onResizeStart={(event) => setResizeDrag({ track: 'video', startY: event.clientY, startHeight: timelineUi.trackHeights.video })}
          >
            <div
              ref={videoTrackRef}
              className="flex-1 relative overflow-x-auto overflow-y-hidden track-content"
              style={{ scrollbarWidth: 'none' }}
              onScroll={handleNativeScroll}
              onMouseDown={(event) => handleSeekFromElement(event, event.currentTarget)}
            >
              <canvas ref={videoCanvasRef} id="video-track-canvas" className="h-full" />
            </div>
          </TrackRow>

          <TrackRow
            title="Áudio 1"
            icon={<AudioLines className="w-3.5 h-3.5 text-emerald-500" />}
            height={timelineUi.trackHeights.audio}
            onResizeStart={(event) => setResizeDrag({ track: 'audio', startY: event.clientY, startHeight: timelineUi.trackHeights.audio })}
          >
            <div
              ref={audioTrackRef}
              className="flex-1 relative overflow-x-auto overflow-y-hidden track-content"
              style={{ scrollbarWidth: 'none' }}
              onScroll={handleNativeScroll}
              onWheel={(event) => {
                if (event.ctrlKey) {
                  event.preventDefault();
                  onTimelineUiChange((prev) => ({
                    ...prev,
                    waveformAmplitude: clamp(prev.waveformAmplitude + (event.deltaY > 0 ? -0.2 : 0.2), 0.3, 5),
                  }));
                  return;
                }
                if (Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.shiftKey) {
                  event.preventDefault();
                  setScrollLeft((prev) => clamp(prev + (event.deltaX || event.deltaY), 0, scrollMax));
                }
              }}
              onMouseDown={(event) => {
                if (selectionMode) {
                  const rect = event.currentTarget.getBoundingClientRect();
                  const start = clamp(xToTime(event.clientX - rect.left + scrollLeft), 0, duration);
                  setSelection({ start, end: start, active: true });
                  return;
                }
                handleSeekFromElement(event, event.currentTarget);
              }}
            >
              <canvas ref={audioCanvasRef} id="audio-track-canvas" className="h-full" />
            </div>
          </TrackRow>

          {subtitleTrackVisible ? (
            <TrackRow
              title="Legendas"
              icon={<Subtitles className="w-3.5 h-3.5 text-amber-500" />}
              height={timelineUi.trackHeights.subtitle}
              onResizeStart={(event) => setResizeDrag({ track: 'subtitle', startY: event.clientY, startHeight: timelineUi.trackHeights.subtitle })}
            >
              <div
                ref={subtitleTrackRef}
                className="flex-1 relative overflow-x-auto overflow-y-hidden track-content"
                style={{ scrollbarWidth: 'none' }}
                onScroll={handleNativeScroll}
                onMouseDown={(event) => handleSeekFromElement(event, event.currentTarget)}
              >
                <canvas ref={subtitleCanvasRef} id="subtitle-track-canvas" className="h-full" />
              </div>
            </TrackRow>
          ) : null}

          <div className="flex h-[36px] group cursor-pointer hover:bg-primary-50/50 transition-colors">
            <div className="w-[180px] min-w-[180px] border-r border-surface-200 px-3 flex items-center gap-2">
              <Plus className="w-3.5 h-3.5 text-surface-400 group-hover:text-primary-500 transition-colors" />
              <span className="text-xs text-surface-400 group-hover:text-primary-600 font-medium transition-colors">Adicionar faixa</span>
            </div>
            <div className="flex-1" />
          </div>
        </div>

        <div
          id="playhead"
          className="absolute top-0 bottom-0 left-[180px] w-[2px] bg-red-500 z-30 cursor-col-resize"
          style={{ transform: `translateX(${timeToX(currentTime) - scrollLeft}px)` }}
          onMouseDown={(event) => {
            event.preventDefault();
            setDraggingPlayhead(true);
          }}
        >
          <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-3 h-3 bg-red-500 rounded-full border-2 border-white shadow-sm" />
        </div>
      </div>

      <div className="flex h-[14px]">
        <div className="w-[180px] min-w-[180px] border-r border-surface-200 bg-surface-50" />
        <div id="timeline-scrollbar-track" ref={scrollbarTrackRef} className="flex-1 bg-surface-50 border-t border-surface-100 relative cursor-pointer" onClick={(event) => {
          if (!scrollbarTrackRef.current || event.target.id === 'timeline-scrollbar-thumb') return;
          const rect = scrollbarTrackRef.current.getBoundingClientRect();
          const ratio = (event.clientX - rect.left) / rect.width;
          setScrollLeft(clamp(ratio * scrollMax, 0, scrollMax));
        }}>
          <div
            id="timeline-scrollbar-thumb"
            className="absolute top-[2px] h-[10px] bg-surface-300 hover:bg-surface-400 rounded-full transition-colors cursor-grab active:cursor-grabbing"
            style={{ left: `${thumbLeft}px`, width: `${thumbWidth}px` }}
            onMouseDown={(event) => {
              event.preventDefault();
              setThumbDrag({ startX: event.clientX, startLeft: thumbLeft });
            }}
          />
        </div>
      </div>
    </div>
  );
}

function TrackRow({ title, icon, height, onResizeStart, children }) {
  return (
    <div className="track-row flex border-b border-surface-100 group hover:bg-primary-50/30 transition-colors" style={{ height: `${height}px`, minHeight: '30px', maxHeight: '120px' }}>
      <div className="w-[180px] min-w-[180px] border-r border-surface-200 px-3 flex items-center gap-2">
        {icon}
        <span className="text-xs font-medium text-surface-600">{title}</span>
        <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button type="button" variant="ghost" size="icon" className="h-[22px] w-[22px] rounded-md text-surface-400 hover:text-surface-700" title="Visível"><Eye className="w-3 h-3" /></Button>
          <Button type="button" variant="ghost" size="icon" className="h-[22px] w-[22px] rounded-md text-surface-400 hover:text-surface-700" title="Travar"><Lock className="w-3 h-3" /></Button>
        </div>
      </div>
      {children}
      <div className="track-resize-handle" onMouseDown={onResizeStart} />
    </div>
  );
}

function CropOverlay({ active, videoRef, rect, onRectChange, onCropChange }) {
  const canvasRef = useRef(null);
  const dragRef = useRef(null);

  useEffect(() => {
    if (!active || !canvasRef.current) return;
    drawCropOverlay(canvasRef.current, rect);
  }, [active, rect]);

  useEffect(() => {
    function handleMouseMove(event) {
      if (!dragRef.current || !canvasRef.current) return;
      const rectBox = canvasRef.current.getBoundingClientRect();
      const x = clamp((event.clientX - rectBox.left) / rectBox.width, 0, 1);
      const y = clamp((event.clientY - rectBox.top) / rectBox.height, 0, 1);
      const dx = x - dragRef.current.startX;
      const dy = y - dragRef.current.startY;

      if (dragRef.current.type === 'move') {
        onRectChange((prev) => ({
          ...prev,
          x: clamp(dragRef.current.startRect.x + dx, 0, 1 - prev.w),
          y: clamp(dragRef.current.startRect.y + dy, 0, 1 - prev.h),
        }));
      } else {
        onRectChange((prev) => ({
          ...prev,
          w: clamp(dragRef.current.startRect.w + dx, 0.01, 1 - prev.x),
          h: clamp(dragRef.current.startRect.h + dy, 0.01, 1 - prev.y),
        }));
      }
    }

    function handleMouseUp() {
      if (!dragRef.current || !videoRef.current) return;
      const video = videoRef.current;
      onCropChange({
        x: Math.round(rect.x * (video.videoWidth || 0)),
        y: Math.round(rect.y * (video.videoHeight || 0)),
        width: Math.round(rect.w * (video.videoWidth || 0)),
        height: Math.round(rect.h * (video.videoHeight || 0)),
      });
      dragRef.current = null;
    }

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [onCropChange, onRectChange, rect, videoRef]);

  if (!active) return null;

  return (
    <div id="crop-overlay" className="absolute inset-0 pointer-events-none">
      <canvas
        ref={canvasRef}
        id="crop-canvas"
        className="w-full h-full pointer-events-auto"
        onMouseDown={(event) => {
          const canvas = canvasRef.current;
          if (!canvas) return;
          const box = canvas.getBoundingClientRect();
          const x = clamp((event.clientX - box.left) / box.width, 0, 1);
          const y = clamp((event.clientY - box.top) / box.height, 0, 1);
          const inside = x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
          dragRef.current = {
            type: inside ? 'move' : 'resize',
            startX: x,
            startY: y,
            startRect: rect,
          };
        }}
      />
    </div>
  );
}

function SilenceSidebar({ open, settings, setSettings, onClose, onRun }) {
  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <SheetContent side="right" className="top-14 bottom-0 h-auto w-80 rounded-none border-l border-surface-200 p-0">
        <div className="flex h-full flex-col">
          <SheetHeader className="border-b border-surface-100 px-5 py-4 pr-12">
            <SheetTitle className="flex items-center gap-2">
              <Scissors className="w-4 h-4 text-primary-500" />
              Remover Silêncio
            </SheetTitle>
            <SheetDescription>Ajuste os parâmetros usados para detectar e encurtar pausas.</SheetDescription>
          </SheetHeader>

          <ScrollArea className="flex-1">
            <div className="space-y-4 px-5 py-5">
              <Card className="border-surface-200/80">
                <CardContent className="space-y-4 p-5">
                  <SelectField label="Modelo Whisper" value={settings.model} onChange={(value) => setSettings((prev) => ({ ...prev, model: value }))}>
                    <option value="tiny">Tiny (rápido)</option>
                    <option value="base">Base</option>
                    <option value="small">Small (recomendado)</option>
                    <option value="medium">Medium</option>
                    <option value="large">Large (preciso)</option>
                  </SelectField>
                  <SelectField label="Idioma" value={settings.language} onChange={(value) => setSettings((prev) => ({ ...prev, language: value }))}>
                    <option value="pt">Português</option>
                    <option value="en">Inglês</option>
                    <option value="es">Espanhol</option>
                    <option value="fr">Francês</option>
                    <option value="de">Alemão</option>
                  </SelectField>
                  <InputField label="Gap mínimo para mesclar" type="number" step="0.01" value={settings.minGap} onChange={(value) => setSettings((prev) => ({ ...prev, minGap: parseFloat(value) || 0 }))} />
                  <InputField label="Padding no início" type="number" step="0.01" value={settings.padStart} onChange={(value) => setSettings((prev) => ({ ...prev, padStart: parseFloat(value) || 0 }))} />
                  <InputField label="Padding no fim" type="number" step="0.01" value={settings.padEnd} onChange={(value) => setSettings((prev) => ({ ...prev, padEnd: parseFloat(value) || 0 }))} />
                  <InputField label="Trecho mínimo mantido" type="number" step="0.01" value={settings.minKeep} onChange={(value) => setSettings((prev) => ({ ...prev, minKeep: parseFloat(value) || 0 }))} />
                </CardContent>
              </Card>

              <Button type="button" className="w-full gap-2" onClick={onRun}>
                <Scissors className="w-4 h-4" />
                Processar com IA
              </Button>
            </div>
          </ScrollArea>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ProcessingModal({ open, state }) {
  return (
    <Dialog open={open}>
      <DialogContent className="max-w-md p-8" showClose={false} onInteractOutside={(event) => event.preventDefault()}>
        <DialogHeader className="mb-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-primary-100 rounded-xl flex items-center justify-center">
              <Loader2 className="w-6 h-6 text-primary-600 animate-spin" />
            </div>
            <div>
              <DialogTitle>{state.title}</DialogTitle>
              <DialogDescription>{state.message}</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <Progress value={state.progress} className="h-3" />
        <p className="text-xs text-surface-400 mt-3 text-center font-medium">{state.progress}%</p>
      </DialogContent>
    </Dialog>
  );
}

function HomeConfirmModal({ open, onClose, onConfirm }) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <AlertDialogContent>
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 bg-amber-100 rounded-xl flex items-center justify-center shrink-0">
            <AlertCircle className="w-6 h-6 text-amber-600" />
          </div>
          <AlertDialogHeader className="min-w-0 space-y-1">
            <AlertDialogTitle>Voltar para a página inicial?</AlertDialogTitle>
            <AlertDialogDescription>
              O projeto atual será fechado para você começar outro vídeo. Salve antes se quiser manter o progresso.
            </AlertDialogDescription>
          </AlertDialogHeader>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Continuar editando</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Voltar ao início</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ProjectListModal({ open, projects, onClose, onOpen, onDelete }) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-w-lg p-6" showClose>
        <DialogHeader className="mb-4">
          <DialogTitle className="flex items-center gap-2">
            <FolderOpen className="w-5 h-5 text-primary-500" />
            Projetos Salvos
          </DialogTitle>
          <DialogDescription>Abra um projeto salvo ou remova entradas que não precisa mais.</DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[400px]">
          {projects.length === 0 ? (
            <p className="py-8 text-center text-sm text-surface-400">Nenhum projeto salvo.</p>
          ) : (
            <div className="space-y-2">
              {projects.map((project) => (
                <Card key={project.name} className="cursor-pointer border-surface-200 bg-surface-50 transition-colors hover:border-primary-200 hover:bg-primary-50" onClick={() => onOpen(project.name)}>
                  <CardContent className="flex items-center gap-3 p-4">
                    <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center flex-shrink-0">
                      <Film className="w-5 h-5 text-primary-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-surface-800 truncate">{project.name}</p>
                      <p className="text-xs text-surface-400">{project.originalName || ''} • {project.date || ''}</p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-surface-400 hover:bg-red-50 hover:text-red-500"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDelete(project.name);
                      }}
                      title="Excluir"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function ToastViewport({ toasts }) {
  const iconMap = {
    success: CheckCircle,
    error: AlertCircle,
    info: Info,
  };

  return (
    <div className="fixed bottom-4 right-4 z-[120] space-y-3">
      {toasts.map((toast) => {
        const Icon = iconMap[toast.type] || Info;
        return (
          <div key={toast.id} className={`toast toast-${toast.type}`}>
            <Icon className="w-4 h-4 flex-shrink-0" />
            <span>{toast.message}</span>
          </div>
        );
      })}
    </div>
  );
}

function useWsClient(onProgress) {
  const [clientId, setClientId] = useState('');
  const onProgressEvent = useEffectEvent(onProgress);

  useEffect(() => {
    const isT = tauri.init();
    if (isT) {
      // Tauri mode: use event listeners instead of WebSocket
      const generatedId = crypto.randomUUID();
      setClientId(generatedId);

      tauri.onProgress((data) => {
        onProgressEvent(data);
      }).catch(() => {});

      return;
    }

    // Browser mode: use WebSocket
    let ws;
    let cancelled = false;
    let reconnectAttempts = 0;

    function connect() {
      if (cancelled) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'connected') {
            setClientId(data.clientId);
            reconnectAttempts = 0;
            return;
          }
          if (data.type === 'progress') {
            onProgressEvent(data);
          }
        } catch {
          return;
        }
      };

      ws.onclose = () => {
        if (cancelled || reconnectAttempts >= 5) return;
        reconnectAttempts += 1;
        const delay = Math.min(1000 * (2 ** reconnectAttempts), 10000);
        window.setTimeout(connect, delay);
      };
    }

    connect();

    return () => {
      cancelled = true;
      ws?.close();
    };
  }, []);

  return clientId;
}

function usePlaybackController() {
  const originalVideoRef = useRef(null);
  const processedVideoRef = useRef(null);
  const originalDurationRef = useRef(0);
  const subtitlesRef = useRef([]);
  const editIntervalsRef = useRef([]);
  const timelineMapRef = useRef([]);
  const originalSourceRef = useRef('');
  const processedSourceRef = useRef('');

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [originalTime, setOriginalTime] = useState(0);
  const [processedTime, setProcessedTime] = useState(0);
  const [originalReady, setOriginalReady] = useState(false);
  const [processedReady, setProcessedReady] = useState(false);
  const [showOriginal, setShowOriginal] = useState(true);
  const [showProcessed, setShowProcessed] = useState(false);
  const [processedLoaded, setProcessedLoaded] = useState(false);
  const [hasRealProcessedOutput, setHasRealProcessedOutput] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [timeInput, setTimeInput] = useState('00:00.000');
  const [subtitleText, setSubtitleText] = useState('');
  const [sourceVersion, setSourceVersion] = useState(0);

  function hasEditedTimeline() {
    return timelineMapRef.current.length > 0;
  }

  function buildTimelineMap(intervals) {
    let cursor = 0;
    return intervals.map((interval) => {
      const segment = {
        sourceStart: interval.start,
        sourceEnd: interval.end,
        timelineStart: cursor,
        timelineEnd: cursor + (interval.end - interval.start),
      };
      cursor = segment.timelineEnd;
      return segment;
    });
  }

  function timelineTimeToSourceTime(time) {
    if (!hasEditedTimeline()) return Math.max(0, time);
    const safeTime = clamp(time, 0, duration || time);
    for (const segment of timelineMapRef.current) {
      if (safeTime <= segment.timelineEnd) {
        return segment.sourceStart + (safeTime - segment.timelineStart);
      }
    }
    return timelineMapRef.current.at(-1)?.sourceEnd || 0;
  }

  function sourceTimeToTimelineTime(time) {
    if (!hasEditedTimeline()) return Math.max(0, time);
    let lastTimelineEnd = 0;
    for (const segment of timelineMapRef.current) {
      if (time < segment.sourceStart) return lastTimelineEnd;
      if (time <= segment.sourceEnd) {
        return segment.timelineStart + (time - segment.sourceStart);
      }
      lastTimelineEnd = segment.timelineEnd;
    }
    return lastTimelineEnd;
  }

  function updateSubtitle(displayTime) {
    const sourceTime = hasEditedTimeline() ? timelineTimeToSourceTime(displayTime) : displayTime;
    const subtitle = subtitlesRef.current.find((item) => sourceTime >= item.start && sourceTime <= item.end);
    setSubtitleText(subtitle?.text || '');
  }

  function normalizeSourcePath(source) {
    if (!source) return '';
    try {
      return new URL(source, window.location.origin).pathname;
    } catch {
      return source;
    }
  }

  function getElementDisplayScale(video) {
    if (!video) return 1;
    const rect = video.getBoundingClientRect();
    const renderedWidth = rect.width || video.clientWidth || 0;
    const renderedHeight = rect.height || video.clientHeight || 0;
    const widthScale = renderedWidth > 0 && video.videoWidth > 0 ? video.videoWidth / renderedWidth : 0;
    const heightScale = renderedHeight > 0 && video.videoHeight > 0 ? video.videoHeight / renderedHeight : 0;
    const scale = Math.min(widthScale, heightScale);
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
  }

  function getDisplayScaleForSource(sourcePath) {
    const target = normalizeSourcePath(sourcePath);
    const originalPath = normalizeSourcePath(originalSourceRef.current);
    const processedPath = normalizeSourcePath(processedSourceRef.current);
    const originalScale = getElementDisplayScale(originalVideoRef.current);
    const processedScale = getElementDisplayScale(processedVideoRef.current);

    if (target && target === processedPath && processedScale > 0 && (showProcessed || !showOriginal)) {
      return processedScale;
    }
    if (target && target === originalPath && originalScale > 0 && (showOriginal || !showProcessed)) {
      return originalScale;
    }
    if (target && target === processedPath && processedScale > 0) {
      return processedScale;
    }
    if (target && target === originalPath && originalScale > 0) {
      return originalScale;
    }
    return showProcessed ? processedScale || originalScale || 1 : originalScale || processedScale || 1;
  }

  function applyMediaSource(element, src) {
    if (!element) return;
    element.pause();
    if (src) {
      element.src = src;
    } else {
      element.removeAttribute('src');
    }
    element.load();
  }

  function syncAudioRouting(nextShowProcessed = showProcessed, nextHasReal = hasRealProcessedOutput) {
    const originalVideo = originalVideoRef.current;
    const processedVideo = processedVideoRef.current;
    if (!originalVideo && !processedVideo) return;

    const processedIsMaster = Boolean(processedVideo) && processedLoaded && (nextHasReal || nextShowProcessed);
    if (originalVideo) {
      originalVideo.muted = processedIsMaster ? true : muted;
      originalVideo.volume = processedIsMaster ? 0 : volume;
    }
    if (processedVideo) {
      processedVideo.muted = processedIsMaster ? muted : true;
      processedVideo.volume = processedIsMaster ? volume : 0;
    }
  }

  function refreshDisplay(displayTime) {
    const safeDisplayTime = clamp(displayTime, 0, duration || displayTime || 0);
    const original = originalVideoRef.current;
    const processed = processedVideoRef.current;

    setCurrentTime(safeDisplayTime);
    setOriginalTime(original?.currentTime || timelineTimeToSourceTime(safeDisplayTime));
    setProcessedTime(hasRealProcessedOutput ? safeDisplayTime : processed?.currentTime || safeDisplayTime);
    setTimeInput(formatTime(safeDisplayTime));
    updateSubtitle(safeDisplayTime);
  }

  function seek(time) {
    const displayTime = clamp(time, 0, duration || time || 0);
    const original = originalVideoRef.current;
    const processed = processedVideoRef.current;
    const sourceTime = timelineTimeToSourceTime(displayTime);

    if (original) original.currentTime = sourceTime;
    if (processedLoaded && processed) {
      processed.currentTime = hasRealProcessedOutput ? displayTime : sourceTime;
    }

    refreshDisplay(displayTime);
  }

  function loadOriginal(src, options = {}) {
    const nextShowOriginal = options.showOriginal ?? true;
    const nextShowProcessed = options.showProcessed ?? false;
    setIsPlaying(false);
    setOriginalReady(false);
    setProcessedReady(false);
    setShowOriginal(nextShowOriginal);
    setShowProcessed(Boolean(src) && nextShowProcessed);
    setProcessedLoaded(Boolean(src));
    setHasRealProcessedOutput(false);
    setCurrentTime(0);
    setOriginalTime(0);
    setProcessedTime(0);
    setTimeInput('00:00.000');
    setSubtitleText('');
    setDuration(0);
    originalDurationRef.current = 0;
    editIntervalsRef.current = [];
    timelineMapRef.current = [];
    originalSourceRef.current = src;
    processedSourceRef.current = src;
    setSourceVersion((prev) => prev + 1);
  }

  function loadProcessed(src) {
    setHasRealProcessedOutput(true);
    setProcessedLoaded(true);
    setProcessedReady(false);
    setShowProcessed(true);
    processedSourceRef.current = src;
    setSourceVersion((prev) => prev + 1);
  }

  function setSubtitles(nextSubtitles) {
    subtitlesRef.current = nextSubtitles || [];
    updateSubtitle(currentTime);
  }

  function setEditIntervals(intervals) {
    const normalized = (intervals || []).filter((interval) => interval.end > interval.start);
    editIntervalsRef.current = normalized;
    timelineMapRef.current = buildTimelineMap(normalized);
    if (normalized.length > 0) {
      const nextDuration = timelineMapRef.current.at(-1)?.timelineEnd || 0;
      setDuration(nextDuration);
      seek(sourceTimeToTimelineTime(originalVideoRef.current?.currentTime || 0));
    } else {
      setDuration(originalDurationRef.current);
    }
  }

  function clearEditIntervals() {
    editIntervalsRef.current = [];
    timelineMapRef.current = [];
    setDuration(originalDurationRef.current);
    seek(originalVideoRef.current?.currentTime || 0);
  }

  function reset() {
    const original = originalVideoRef.current;
    const processed = processedVideoRef.current;

    original?.pause();
    processed?.pause();

    subtitlesRef.current = [];
    editIntervalsRef.current = [];
    timelineMapRef.current = [];
    originalDurationRef.current = 0;
    originalSourceRef.current = '';
    processedSourceRef.current = '';

    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setOriginalTime(0);
    setProcessedTime(0);
    setOriginalReady(false);
    setProcessedReady(false);
    setShowOriginal(true);
    setShowProcessed(false);
    setProcessedLoaded(false);
    setHasRealProcessedOutput(false);
    setTimeInput('00:00.000');
    setSubtitleText('');
    setSourceVersion((prev) => prev + 1);
  }

  function togglePlay() {
    const original = originalVideoRef.current;
    const processed = processedVideoRef.current;
    if (!original || !originalReady) return;

    if (isPlaying) {
      original.pause();
      processed?.pause();
      setIsPlaying(false);
      return;
    }

    seek(currentTime);
    const plays = [original.play()];
    if (processed && processedLoaded && (showProcessed || hasRealProcessedOutput)) {
      plays.push(processed.play());
    }
    Promise.allSettled(plays).finally(() => {
      setIsPlaying(true);
    });
  }

  function toggleOriginal() {
    const processed = processedVideoRef.current;
    const next = !showOriginal;
    setShowOriginal(next);
    if (!next && !showProcessed) {
      setShowProcessed(true);
      syncAudioRouting(true, hasRealProcessedOutput);
      if (isPlaying && processedLoaded && processed) {
        seek(currentTime);
        void processed.play().catch(() => undefined);
      }
    }
    return next;
  }

  function toggleProcessed() {
    const processed = processedVideoRef.current;
    if (!processedLoaded) return false;
    const next = !showProcessed;
    setShowProcessed(next);
    if (!next && !showOriginal) {
      setShowOriginal(true);
    }
    syncAudioRouting(next, hasRealProcessedOutput);
    if (processed) {
      if (next && isPlaying) {
        seek(currentTime);
        void processed.play().catch(() => undefined);
      } else if (!next && !hasRealProcessedOutput) {
        processed.pause();
      }
    }
    return next;
  }

  function toggleMute() {
    setMuted((prev) => !prev);
  }

  function skip(seconds) {
    seek(currentTime + seconds);
  }

  function handleTimeInputFocus(event) {
    event.target.select();
  }

  function handleTimeInputBlur() {
    setTimeInput(formatTime(currentTime));
  }

  function handleTimeInputKeyDown(event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      const parsed = parseTimeInput(timeInput);
      if (parsed !== null) seek(parsed);
      event.currentTarget.blur();
    }
    if (event.key === 'Escape') {
      setTimeInput(formatTime(currentTime));
      event.currentTarget.blur();
    }
  }

  function handleOriginalLoadedMetadata() {
    const original = originalVideoRef.current;
    if (!original) return;
    setOriginalReady(true);
    originalDurationRef.current = original.duration || 0;
    if (!hasEditedTimeline()) {
      setDuration(originalDurationRef.current);
    }
    refreshDisplay(currentTime);
  }

  function handleProcessedLoadedMetadata() {
    const processed = processedVideoRef.current;
    if (!processed) return;
    setProcessedReady(true);
    if (hasRealProcessedOutput && !hasEditedTimeline()) {
      setDuration(processed.duration || originalDurationRef.current);
    }
    refreshDisplay(currentTime);
  }

  function handleOriginalTimeUpdate() {
    const original = originalVideoRef.current;
    const processed = processedVideoRef.current;
    if (!original) return;

    setOriginalTime(original.currentTime || 0);

    const processedIsMaster = processedLoaded && (hasRealProcessedOutput || showProcessed);
    if (processedIsMaster) return;

    if (processedLoaded && processed) {
      const target = hasRealProcessedOutput ? sourceTimeToTimelineTime(original.currentTime || 0) : original.currentTime || 0;
      if (Math.abs((processed.currentTime || 0) - target) > 0.08) {
        processed.currentTime = target;
      }
    }

    refreshDisplay(sourceTimeToTimelineTime(original.currentTime || 0));
  }

  function handleProcessedTimeUpdate() {
    const original = originalVideoRef.current;
    const processed = processedVideoRef.current;
    if (!processed) return;

    setProcessedTime(processed.currentTime || 0);

    const processedIsMaster = processedLoaded && (hasRealProcessedOutput || showProcessed);
    if (!processedIsMaster) return;

    const displayTime = hasRealProcessedOutput
      ? processed.currentTime || 0
      : sourceTimeToTimelineTime(processed.currentTime || 0);
    const targetSource = timelineTimeToSourceTime(displayTime);

    if (original && Math.abs((original.currentTime || 0) - targetSource) > 0.08) {
      original.currentTime = targetSource;
    }

    refreshDisplay(displayTime);
  }

  function handleEnded() {
    setIsPlaying(false);
  }

  function mapSubtitlesToTimeline(subtitles) {
    if (!hasEditedTimeline()) return subtitles || [];
    const mapped = [];
    for (const subtitle of subtitles || []) {
      for (const segment of timelineMapRef.current) {
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

  useEffect(() => {
    const original = originalVideoRef.current;
    const processed = processedVideoRef.current;
    if (original) {
      applyMediaSource(original, originalSourceRef.current);
      original.playbackRate = playbackRate;
    }
    if (processed) {
      applyMediaSource(processed, processedSourceRef.current);
      processed.playbackRate = playbackRate;
    }
    syncAudioRouting();
  }, [sourceVersion]);

  useEffect(() => {
    const original = originalVideoRef.current;
    const processed = processedVideoRef.current;
    if (original) original.playbackRate = playbackRate;
    if (processed) processed.playbackRate = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
    syncAudioRouting();
  }, [showProcessed, hasRealProcessedOutput, processedLoaded, volume, muted]);

  return {
    originalVideoRef,
    processedVideoRef,
    isPlaying,
    currentTime,
    duration,
    originalTime,
    processedTime,
    originalReady,
    processedReady,
    showOriginal,
    showProcessed,
    processedLoaded,
    volume,
    muted,
    playbackRate,
    timeInput,
    subtitleText,
    setVolume,
    setPlaybackRate,
    setTimeInput,
    setSubtitles,
    setEditIntervals,
    clearEditIntervals,
    reset,
    loadOriginal,
    loadProcessed,
    togglePlay,
    toggleOriginal,
    toggleProcessed,
    toggleMute,
    skip,
    seek,
    hasEditedTimeline,
    mapSubtitlesToTimeline,
    getDisplayScaleForSource,
    handleOriginalLoadedMetadata,
    handleProcessedLoadedMetadata,
    handleOriginalTimeUpdate,
    handleProcessedTimeUpdate,
    handleEnded,
    handleTimeInputFocus,
    handleTimeInputBlur,
    handleTimeInputKeyDown,
  };
}

function parseTimeInput(value) {
  const str = value.trim();
  const mmssMs = /^(\d+):(\d{1,2})\.(\d{1,3})$/;
  const mmss = /^(\d+):(\d{1,2})$/;
  const ssMs = /^(\d+)\.(\d{1,3})$/;
  const ss = /^(\d+)$/;

  let match = str.match(mmssMs);
  if (match) return parseInt(match[1], 10) * 60 + parseInt(match[2], 10) + parseInt(match[3].padEnd(3, '0'), 10) / 1000;
  match = str.match(mmss);
  if (match) return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
  match = str.match(ssMs);
  if (match) return parseInt(match[1], 10) + parseInt(match[2].padEnd(3, '0'), 10) / 1000;
  match = str.match(ss);
  if (match) return parseInt(match[1], 10);
  return null;
}

/**
 * Outline via text-shadow: filled disk of offsets (not rings of samples) avoids both
 * miter spikes (-webkit-text-stroke) and scalloped “petals” from sparse angular sampling.
 * Subpixel sampling keeps the preview closer to libass/FFmpeg, which otherwise renders
 * small outlines visibly thicker than an integer-only CSS shadow approximation.
 */
function buildDiskOutlineTextShadows(outlinePx, color) {
  const radius = Math.max(0, Number(outlinePx) || 0);
  if (radius <= 0) return [];
  const c = color || '#000000';
  const step = radius <= 3 ? 0.5 : 1;
  const steps = Math.ceil(radius / step);
  const maxSq = (radius + step * 0.35) ** 2;
  const layers = [];
  for (let y = -steps; y <= steps; y += 1) {
    const dy = Number((y * step).toFixed(2));
    for (let x = -steps; x <= steps; x += 1) {
      const dx = Number((x * step).toFixed(2));
      if (dx === 0 && dy === 0) continue;
      if (dx * dx + dy * dy > maxSq) continue;
      layers.push(`${dx}px ${dy}px 0 ${c}`);
    }
  }
  return layers;
}

function buildSubtitlePreviewStyle(style) {
  const outline = Math.max(0, Number(style?.outline) || 0);
  const shadow = Math.max(0, Number(style?.shadow) || 0);
  const alignment = Number(style?.alignment) || 2;
  const positionY = clamp(Number(style?.positionY) || 0, 0, 100);
  const areaHeight = clamp(Number(style?.areaHeight) || 18, 4, 100);
  const decorationPadding = Math.max(12, outline * 3 + shadow * 4);
  const isBottomAligned = alignment === 1 || alignment === 2 || alignment === 3;
  const isCenterAligned = alignment === 5;
  const bandTop = clamp(
    isCenterAligned
      ? positionY - areaHeight / 2
      : isBottomAligned
        ? positionY - areaHeight
        : positionY,
    0,
    Math.max(0, 100 - areaHeight),
  );
  const justifyContent = alignment === 1 ? 'flex-start' : alignment === 3 ? 'flex-end' : 'center';
  const textAlign = alignment === 1 ? 'left' : alignment === 3 ? 'right' : 'center';
  const alignItems = isCenterAligned ? 'center' : isBottomAligned ? 'flex-end' : 'flex-start';

  const outlineColor = style?.outlineColor || '#000000';
  const outlineShadows = buildDiskOutlineTextShadows(outline, outlineColor);
  const dropShadow = shadow > 0 ? `${shadow}px ${shadow}px 0 rgba(0, 0, 0, 0.82)` : '';
  const textShadow =
    outlineShadows.length || dropShadow
      ? [...outlineShadows, dropShadow].filter(Boolean).join(', ')
      : 'none';

  return {
    container: {
      top: `calc(${bandTop}% - ${decorationPadding}px)`,
      height: `calc(${areaHeight}% + ${decorationPadding * 2}px)`,
      paddingTop: `${decorationPadding}px`,
      paddingBottom: `${decorationPadding}px`,
      alignItems,
      justifyContent,
    },
    text: {
      color: style?.primaryColor || '#ffffff',
      fontFamily: style?.fontName || 'Arial',
      fontSize: `${Math.max(12, Number(style?.fontSize) || 24)}px`,
      fontWeight: style?.bold ? 700 : 400,
      lineHeight: '1.05',
      textShadow,
      textAlign,
    },
  };
}

function shouldUseDockedPreview(info) {
  const width = Number(info?.video?.width) || 0;
  const height = Number(info?.video?.height) || 0;
  return width > 0 && height > width;
}

function outputHasBurnedSubtitles(outputPath) {
  return /\/subtitled_[^/]+\.mp4$/i.test(outputPath || '');
}

function setupCanvas(canvas, width, height) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  return ctx;
}

function clearCanvas(canvas, width, height) {
  const ctx = setupCanvas(canvas, width, height);
  ctx.clearRect(0, 0, width, height);
}

function drawRuler(canvas, width, height, duration) {
  const ctx = setupCanvas(canvas, width, height);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, width, height);

  const pixelsPerSecond = width / duration;
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

  for (let time = 0; time <= duration; time += tickInterval) {
    const x = (time / duration) * width;
    const isMajor = time % (tickInterval * 5) === 0 || tickInterval >= 10;
    ctx.beginPath();
    ctx.moveTo(x, height);
    ctx.lineTo(x, isMajor ? height - 16 : height - 8);
    ctx.lineWidth = isMajor ? 1 : 0.5;
    ctx.stroke();

    if (isMajor) {
      const mins = Math.floor(time / 60);
      const secs = Math.floor(time % 60);
      ctx.fillText(`${mins}:${String(secs).padStart(2, '0')}`, x, 10);
    }
  }
}

function drawSelection(ctx, width, height, selection, duration) {
  if (!selection || selection.start === selection.end || !duration) return;
  const x1 = (Math.min(selection.start, selection.end) / duration) * width;
  const x2 = (Math.max(selection.start, selection.end) / duration) * width;
  ctx.fillStyle = '#6366f120';
  ctx.fillRect(x1, 0, x2 - x1, height);
  ctx.strokeStyle = '#6366f1';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x1, 0);
  ctx.lineTo(x1, height);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, 0);
  ctx.lineTo(x2, height);
  ctx.stroke();
}

function drawVideoTrack(canvas, width, height, duration, intervals, selection, collapsedMode) {
  const ctx = setupCanvas(canvas, width, height);
  ctx.clearRect(0, 0, width, height);

  if (!collapsedMode && intervals.length > 0) {
    intervals.forEach((interval) => {
      const x1 = (interval.start / duration) * width;
      const x2 = (interval.end / duration) * width;
      ctx.fillStyle = '#93c5fd';
      ctx.fillRect(x1, 2, x2 - x1, height - 4);
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 1;
      ctx.strokeRect(x1, 2, x2 - x1, height - 4);
    });

    ctx.fillStyle = '#fecaca40';
    let prevEnd = 0;
    intervals.forEach((interval) => {
      const gapX1 = (prevEnd / duration) * width;
      const gapX2 = (interval.start / duration) * width;
      if (gapX2 - gapX1 > 1) {
        ctx.fillRect(gapX1, 2, gapX2 - gapX1, height - 4);
      }
      prevEnd = interval.end;
    });
  } else {
    ctx.fillStyle = '#93c5fd';
    ctx.fillRect(0, 2, width, height - 4);
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 2, width, height - 4);
  }

  drawSelection(ctx, width, height, selection, duration);
}

function drawAudioTrack(canvas, width, height, waveform, duration, intervals, selection, amplitude, collapsedMode) {
  const ctx = setupCanvas(canvas, width, height);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#f0fdf4';
  ctx.fillRect(0, 0, width, height);

  if (!waveform.length) return;

  const samplesPerPixel = waveform.length / width;
  const peaks = [];
  const nonZeroPeaks = [];

  for (let px = 0; px < width; px += 1) {
    const start = Math.floor(px * samplesPerPixel);
    const end = Math.min(Math.max(start + 1, Math.floor((px + 1) * samplesPerPixel)), waveform.length);
    let max = 0;
    for (let index = start; index < end; index += 1) {
      if (waveform[index] > max) max = waveform[index];
    }
    peaks.push(max);
    if (max > 0) nonZeroPeaks.push(max);
  }

  const sortedPeaks = nonZeroPeaks.sort((a, b) => a - b);
  const referencePeak = percentile(sortedPeaks, 0.985) || percentile(sortedPeaks, 0.9) || 1;
  const verticalPadding = height <= 40 ? 2 : 3;
  const availableHeight = Math.max(height - verticalPadding * 2, 1);
  const mid = height / 2;
  const effectiveAmplitude = clamp(amplitude, 0.4, 5);
  // Faixa mínima visível (silêncio quase zero) + colunas levemente sobrepostas evitam “frestas” entre pixels.
  const minBarHeight = Math.min(5, Math.max(2.25, availableHeight * 0.055));
  const columnW = 1.12;

  ctx.fillStyle = '#16a34a';
  ctx.globalAlpha = 0.95;

  for (let px = 0; px < width; px += 1) {
    const normalizedPeak = referencePeak > 0 ? clamp(peaks[px] / referencePeak, 0, 1) : 0;
    const shapedPeak = normalizedPeak > 0 ? Math.pow(normalizedPeak, 0.58) : 0;
    const scaledPeak = clamp(shapedPeak * effectiveAmplitude, 0, 1);
    const barHeight = Math.max(minBarHeight, scaledPeak * availableHeight);
    ctx.fillRect(px, mid - barHeight / 2, columnW, barHeight);
  }

  ctx.globalAlpha = 1;
  ctx.strokeStyle = '#16a34a26';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, mid);
  ctx.lineTo(width, mid);
  ctx.stroke();

  if (!collapsedMode && intervals.length > 0) {
    ctx.fillStyle = '#ef444420';
    let prevEnd = 0;
    intervals.forEach((interval) => {
      const x1 = (prevEnd / duration) * width;
      const x2 = (interval.start / duration) * width;
      if (x2 - x1 > 0) ctx.fillRect(x1, 0, x2 - x1, height);
      prevEnd = interval.end;
    });
    const lastX = (prevEnd / duration) * width;
    if (width - lastX > 0) ctx.fillRect(lastX, 0, width - lastX, height);
  }

  drawSelection(ctx, width, height, selection, duration);
}

function percentile(sortedValues, ratio) {
  if (!sortedValues.length) return 0;
  const index = Math.max(0, Math.min(sortedValues.length - 1, Math.floor((sortedValues.length - 1) * ratio)));
  return sortedValues[index];
}

function drawSubtitleTrack(canvas, width, height, subtitles, duration) {
  const ctx = setupCanvas(canvas, width, height);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#fffbeb';
  ctx.fillRect(0, 0, width, height);

  subtitles.forEach((subtitle) => {
    const x1 = (subtitle.start / duration) * width;
    const x2 = (subtitle.end / duration) * width;
    const blockWidth = Math.max(x2 - x1, 2);

    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(x1, 4, blockWidth, height - 8);
    ctx.strokeStyle = '#d97706';
    ctx.lineWidth = 1;
    ctx.strokeRect(x1, 4, blockWidth, height - 8);

    if (blockWidth > 30) {
      ctx.fillStyle = '#78350f';
      ctx.font = '10px Inter, system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.save();
      ctx.beginPath();
      ctx.rect(x1 + 3, 4, blockWidth - 6, height - 8);
      ctx.clip();
      ctx.fillText(subtitle.text, x1 + 4, height / 2 + 3);
      ctx.restore();
    }
  });
}

function drawCropOverlay(canvas, rect) {
  const parent = canvas.parentElement;
  if (!parent) return;
  const ctx = setupCanvas(canvas, parent.clientWidth, parent.clientHeight);
  const width = parent.clientWidth;
  const height = parent.clientHeight;
  ctx.clearRect(0, 0, width, height);

  const rx = rect.x * width;
  const ry = rect.y * height;
  const rw = rect.w * width;
  const rh = rect.h * height;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillRect(0, 0, width, height);
  ctx.clearRect(rx, ry, rw, rh);

  ctx.strokeStyle = '#6366f1';
  ctx.lineWidth = 2;
  ctx.strokeRect(rx, ry, rw, rh);
}

export default App;
