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
  Monitor,
  MonitorCheck,
  Palette,
  Plus,
  Save,
  Scissors,
  SkipBack,
  SkipForward,
  Sparkles,
  Stamp,
  Subtitles,
  TextCursorInput,
  Trash2,
  UploadCloud,
  Video,
  Volume1,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { Children, isValidElement, startTransition, useEffect, useEffectEvent, useRef, useState } from 'react';

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
  DialogHeader,
  DialogTitle,
} from './components/ui/dialog.jsx';
import { Input } from './components/ui/input.jsx';
import { Label } from './components/ui/label.jsx';
import { Progress } from './components/ui/progress.jsx';
import { ScrollArea } from './components/ui/scroll-area.jsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './components/ui/select.jsx';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from './components/ui/sheet.jsx';
import { PresetSelector } from './components/preset-selector.jsx';
import {
  burnSubtitles,
  deleteProject,
  exportVideo,
  generateSubtitles,
  listProjects,
  loadProject,
  removeSilence,
  saveProject,
  uploadVideo,
  BASE_URL,
} from './lib/api.js';
import { clamp, cn, formatDuration, formatTime, hexToASSColor } from './lib/utils.js';

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
  highlightWords: true,
  highlightColor: '#facc15',
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

  const playback = usePlaybackController();
  const clientId = useWsClient((data) => {
    setProcessingState((prev) => ({
      ...prev,
      message: data.message || prev.message,
      progress: data.progress ?? prev.progress,
    }));
  });

  useEffect(() => {
    async function loadInitialProjects() {
      try {
        const list = await listProjects();
        startTransition(() => setProjects(list));
      } catch (err) {
        console.error('Erro ao carregar lista de projetos inicial:', err);
      }
    }
    loadInitialProjects();
  }, []);

  const timelineSubtitles = playback.hasEditedTimeline()
    ? playback.mapSubtitlesToTimeline(subtitles)
    : subtitles;

  function pushToast(message, type = 'info', duration = 4000) {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, message, type }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, duration);
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

  function getSubtitleBurnSourceFile() {
    if (currentOutputPath && outputHasBurnedSubtitles(currentOutputPath)) {
      return processedVideoPath || getOriginalSourceFile();
    }
    return currentOutputPath || getOriginalSourceFile();
  }

  function getPreviewProcessedSource(
    outputPath = currentOutputPath,
    processedPath = processedVideoPath,
    originalSource = getOriginalSourceFile(),
  ) {
    if (outputHasBurnedSubtitles(outputPath)) {
      return processedPath || originalSource || outputPath || '';
    }
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
      playback.loadOriginal(result.file.path, {
        showOriginal: !shouldDock,
        showProcessed: shouldDock,
      });
      setUploadState(DEFAULT_UPLOAD_STATE);
      pushToast('Vídeo carregado com sucesso!', 'success');
    } catch (err) {
      setUploadState(DEFAULT_UPLOAD_STATE);
      pushToast(`Erro ao enviar: ${err.message}`, 'error');
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
      pushToast(`Erro: ${err.message}`, 'error');
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
      pushToast(`Erro: ${err.message}`, 'error');
    }
  }

  async function runBurnSubtitles() {
    if (!filename || !projectId || subtitles.length === 0) return;

    const sourceFile = getSubtitleBurnSourceFile();
    const subtitlePayload = getSubtitlesForSource(sourceFile);
    const burnScale = playback.getDisplayScaleForSource(sourceFile);

    setShowProcessingModal(true);
    setProcessingState({
      title: 'Aplicando Legendas',
      message: 'Queimando legendas no vídeo...',
      progress: 0,
    });

    try {
      const result = await burnSubtitles({
        filename,
        projectId,
        clientId,
        sourceFile,
        subtitles: subtitlePayload,
        style: buildBurnStyle(subtitleStyle, burnScale),
      });

      setShowProcessingModal(false);
      setCurrentOutputPath(result.outputPath);
      playback.loadProcessed(getPreviewProcessedSource(result.outputPath));
      playback.setSubtitles(subtitles);
      pushToast('Legendas aplicadas ao vídeo!', 'success');
    } catch (err) {
      setShowProcessingModal(false);
      pushToast(`Erro: ${err.message}`, 'error');
    }
  }

  async function runExport() {
    if (!projectId || !filename) return;

    try {
      let sourceFile = currentOutputPath || getOriginalSourceFile();

      if (subtitles.length > 0 && !outputHasBurnedSubtitles(sourceFile)) {
        const subtitlePayload = getSubtitlesForSource(sourceFile);
        const burnScale = playback.getDisplayScaleForSource(sourceFile);
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
          style: buildBurnStyle(subtitleStyle, burnScale),
        });

        setShowProcessingModal(false);
        sourceFile = burnResult.outputPath;
      }

      const blob = await exportVideo({ projectId, sourceFile });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `studiocut_export_${Date.now()}.mp4`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      pushToast('Vídeo exportado com sucesso!', 'success');
    } catch (err) {
      setShowProcessingModal(false);
      pushToast(`Erro ao exportar: ${err.message}`, 'error');
    }
  }

  async function saveCurrentProject() {
    if (!projectId || !filename) return;
    const name = window.prompt('Nome do projeto:', originalName?.replace(/\.\w+$/, '') || 'Meu Projeto');
    if (!name) return;

    try {
      await saveProject({
        name,
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
      pushToast(`Projeto "${name}" salvo com sucesso!`, 'success');
      const list = await listProjects();
      startTransition(() => setProjects(list));
    } catch (err) {
      pushToast(`Erro ao salvar: ${err.message}`, 'error');
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

  function loadProjectState(state) {
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
  }

  async function openProject(projectName) {
    try {
      const state = await loadProject(projectName);
      loadProjectState(state);
      pushToast(`Projeto "${projectName}" carregado!`, 'success');
    } catch (err) {
      pushToast(`Erro ao carregar: ${err.message}`, 'error');
    }
  }

  async function handleImportProject(projectData) {
    try {
      await saveProject(projectData);
      loadProjectState(projectData);
      const list = await listProjects();
      startTransition(() => setProjects(list));
      pushToast(`Projeto "${projectData.name}" importado com sucesso!`, 'success');
    } catch (err) {
      pushToast(`Erro ao importar projeto: ${err.message}`, 'error');
    }
  }

  async function removeSavedProject(projectName) {
    if (!window.confirm(`Excluir projeto "${projectName}"?`)) return;
    try {
      await deleteProject(projectName);
      setProjects((prev) => prev.filter((project) => project.name !== projectName));
      pushToast(`Projeto "${projectName}" excluído.`, 'info');
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
    if (!currentOutputPath || !outputHasBurnedSubtitles(currentOutputPath)) return;
    const previewSource = getPreviewProcessedSource(currentOutputPath);
    if (!previewSource || previewSource === currentOutputPath) return;
    setCurrentOutputPath(previewSource);
    playback.loadProcessed(previewSource);
  }, [subtitleStyle, subtitles, currentOutputPath, processedVideoPath, filename]);

  const dockedLayoutActive = dockProcessedPreview && (playback.showOriginal || playback.showProcessed);

  return (
    <div className="app-shell">
      {editorVisible && (
        <Header
          editorVisible={editorVisible}
          originalName={originalName}
          videoInfo={videoInfo}
          onGoHome={() => setShowHomeConfirm(true)}
          onSave={saveCurrentProject}
          onOpenProjects={openProjectList}
          onExport={runExport}
        />
      )}

      {!editorVisible ? (
        <UploadScreen
          onUpload={handleUpload}
          uploadState={uploadState}
          projects={projects}
          onOpenProject={openProject}
          onDeleteProject={removeSavedProject}
          onImportProject={handleImportProject}
        />
      ) : (
        <div id="editor-screen">
          <Toolbar
            playback={playback}
            selectionMode={selectionMode}
            zoom={timelineUi.zoom}
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
            onZoomIn={() => setTimelineUi((prev) => ({ ...prev, zoom: clamp(prev.zoom * 1.5, 0.5, 20) }))}
            onZoomOut={() => setTimelineUi((prev) => ({ ...prev, zoom: clamp(prev.zoom / 1.5, 0.5, 20) }))}
            onZoomFit={() => setTimelineUi((prev) => ({ ...prev, zoom: 1 }))}
          />

          <div className={`editor-workspace ${
            dockedLayoutActive
              ? ((playback.showOriginal ? 1 : 0) + (playback.showProcessed ? 1 : 0) === 2)
                ? 'editor-workspace--docked-double'
                : 'editor-workspace--docked-single'
              : ''
          } ${showSubtitleSidebar ? 'editor-workspace--sidebar-left' : ''}`}>
            <div className="editor-main-column">
              <PreviewArea
                playback={playback}
                cropActive={cropActive}
                cropRect={cropRect}
                subtitleStyle={subtitleStyle}
                showSubtitleOverlay={subtitles.length > 0}
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
          </div>
        </div>
      )}

      <SubtitleSidebar
        open={showSubtitleSidebar}
        settings={subtitleSettings}
        setSettings={setSubtitleSettings}
        style={subtitleStyle}
        setStyle={setSubtitleStyle}
        subtitles={subtitles}
        onClose={() => setShowSubtitleSidebar(false)}
        onGenerate={runSubtitleGeneration}
        onBurn={runBurnSubtitles}
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

      <ToastViewport toasts={toasts} />
    </div>
  );
}

function Header({ editorVisible, originalName, videoInfo, onGoHome, onSave, onOpenProjects, onExport }) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <header id="app-header" className="bg-white/80 backdrop-blur-xl border-b border-surface-200 sticky top-0 z-50">
      <div className="max-w-[1920px] mx-auto px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-gradient-to-br from-primary-500 to-primary-700 rounded-lg flex items-center justify-center">
            <Film className="w-4 h-4 text-white" />
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

        <div className="flex items-center gap-2">
          <div className="relative" ref={dropdownRef}>
            <Button
              type="button"
              onClick={() => setIsOpen(!isOpen)}
              variant="outline"
              size="sm"
              className="gap-1.5 px-3 h-8 text-xs font-medium"
            >
              <span>Arquivo</span>
              <svg className={`w-3 h-3 text-surface-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </Button>

            {isOpen && (
              <div className="absolute right-0 mt-1.5 w-48 rounded-lg border border-surface-200 bg-white/95 backdrop-blur-md shadow-xl py-1 z-50 animate-in fade-in slide-in-from-top-1 duration-100">
                {editorVisible && (
                  <button
                    type="button"
                    onClick={() => {
                      onGoHome();
                      setIsOpen(false);
                    }}
                    className="w-full text-left px-3.5 py-2.5 text-xs text-surface-700 hover:bg-surface-100 flex items-center gap-2.5 transition-colors font-medium"
                  >
                    <UploadCloud className="w-3.5 h-3.5 text-surface-400" />
                    Novo Projeto
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    onOpenProjects();
                    setIsOpen(false);
                  }}
                  className="w-full text-left px-3.5 py-2.5 text-xs text-surface-700 hover:bg-surface-100 flex items-center gap-2.5 transition-colors font-medium"
                >
                  <FolderOpen className="w-3.5 h-3.5 text-surface-400" />
                  Abrir Projeto
                </button>

                {editorVisible && (
                  <button
                    type="button"
                    onClick={() => {
                      onSave();
                      setIsOpen(false);
                    }}
                    className="w-full text-left px-3.5 py-2.5 text-xs text-surface-700 hover:bg-surface-100 flex items-center gap-2.5 transition-colors font-medium"
                  >
                    <Save className="w-3.5 h-3.5 text-surface-400" />
                    Salvar Projeto
                  </button>
                )}

                {editorVisible && (
                  <>
                    <div className="border-t border-surface-200 my-1" />
                    <button
                      type="button"
                      onClick={() => {
                        onExport();
                        setIsOpen(false);
                      }}
                      className="w-full text-left px-3.5 py-2.5 text-xs text-surface-700 hover:bg-surface-100 flex items-center gap-2.5 transition-colors font-medium"
                    >
                      <Download className="w-3.5 h-3.5 text-surface-400" />
                      Exportar Video
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

function UploadScreen({ onUpload, uploadState, projects, onOpenProject, onDeleteProject, onImportProject }) {
  const inputRef = useRef(null);
  const importInputRef = useRef(null);
  const showUploadState = uploadState.phase !== 'idle';
  const isProcessing = uploadState.phase === 'processing';
  const uploadProgress = isProcessing ? 100 : uploadState.progress;

  function handleFiles(files) {
    const file = files?.[0];
    if (file) onUpload(file);
  }

  function handleImportClick() {
    importInputRef.current?.click();
  }

  function handleImportFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const projectData = JSON.parse(e.target.result);
        if (!projectData.projectId || !projectData.filename) {
          throw new Error("Formato de projeto inválido. Certifique-se de que é um arquivo JSON de projeto do StudioCut.");
        }
        onImportProject(projectData);
      } catch (err) {
        alert(`Erro ao ler arquivo de projeto: ${err.message}`);
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  }

  return (
    <div id="upload-screen" className="flex items-center justify-center min-h-screen bg-surface-50 p-6 md:p-12">
      <div className="w-full max-w-6xl grid grid-cols-1 md:grid-cols-2 gap-8 items-stretch">
        {/* Left Side: New Project (Upload) */}
        <Card className="border-surface-200/80 shadow-xl shadow-surface-200/40 h-full flex flex-col justify-between">
          <CardHeader className="text-center pb-2 pt-8">
            <div className="w-16 h-16 bg-gradient-to-br from-primary-500 to-primary-700 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-primary-200">
              <Film className="w-8 h-8 text-white" />
            </div>
            <CardTitle className="text-2xl font-bold text-surface-900">Novo Projeto</CardTitle>
            <CardDescription className="text-surface-500 text-sm max-w-sm mx-auto">
              Remova silêncios, gere legendas automáticas, corte e edite seus vídeos com inteligência artificial.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-6 pb-8 pt-4 flex-1 flex flex-col justify-center">
            <label
              htmlFor="file-input"
              id="drop-zone"
              className="block rounded-2xl border-2 border-dashed border-surface-300 bg-surface-50/60 p-8 cursor-pointer transition-all duration-300 group hover:border-primary-400 hover:bg-primary-50/50"
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
                <div className="w-12 h-12 bg-white group-hover:bg-primary-100 rounded-xl flex items-center justify-center transition-colors shadow-sm">
                  <UploadCloud className="w-6 h-6 text-surface-400 group-hover:text-primary-500 transition-colors" />
                </div>
                <div className="text-center">
                  <p className="font-semibold text-sm text-surface-700 group-hover:text-primary-700 transition-colors">
                    Arraste um vídeo ou clique para selecionar
                  </p>
                  <p className="text-xs text-surface-400 mt-1">MP4, MOV, AVI, MKV, WebM • Até 2GB</p>
                </div>
              </div>
              <input
                ref={inputRef}
                id="file-input"
                type="file"
                accept="video/*"
                className="hidden"
                onChange={(event) => handleFiles(event.target.files)}
              />
            </label>

            {showUploadState && (
              <div id="upload-progress" className="mt-6 space-y-4 text-left">
                <Card className="border-surface-200/80 bg-surface-50/80">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-surface-600">Enviando vídeo</span>
                      <span className="text-xs font-mono text-primary-600">{uploadProgress}%</span>
                    </div>
                    <Progress value={uploadProgress} />
                  </CardContent>
                </Card>

                {isProcessing && (
                  <Card className="border-primary-100 bg-white/85 shadow-sm shadow-primary-100/40">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between gap-3 mb-2">
                        <div>
                          <p className="text-xs font-semibold text-surface-700">Preparando editor</p>
                          <p className="text-[10px] text-surface-500">Gerando waveform e metadados...</p>
                        </div>
                        <Loader2 className="w-3.5 h-3.5 text-primary-500 animate-spin flex-shrink-0" />
                      </div>
                      <div className="w-full bg-primary-50 rounded-full h-1.5 overflow-hidden">
                        <div className="indeterminate-progress" />
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right Side: Recent Projects */}
        <Card className="border-surface-200/80 shadow-xl shadow-surface-200/40 h-full flex flex-col justify-between">
          <CardHeader className="flex flex-row items-center justify-between pb-4 pt-8 px-6 border-b border-surface-100">
            <div>
              <CardTitle className="text-xl font-bold text-surface-900 flex items-center gap-2">
                <FolderOpen className="w-5 h-5 text-primary-500" />
                Projetos Recentes
              </CardTitle>
              <CardDescription className="text-xs text-surface-500 mt-1">
                Continue editando um projeto salvo.
              </CardDescription>
            </div>
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleImportClick}
                className="flex items-center gap-1.5 text-xs"
              >
                <UploadCloud className="w-3.5 h-3.5" />
                Importar de Arquivo
              </Button>
              <input
                ref={importInputRef}
                type="file"
                accept=".json"
                className="hidden"
                onChange={handleImportFileChange}
              />
            </div>
          </CardHeader>
          <CardContent className="p-6 flex-1 flex flex-col justify-start">
            <ScrollArea className="h-[360px] pr-2">
              {projects.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full py-16 text-center">
                  <FolderOpen className="w-10 h-10 text-surface-300 mb-3" />
                  <p className="text-sm font-medium text-surface-400">Nenhum projeto recente encontrado</p>
                  <p className="text-xs text-surface-400 mt-1">Envie um vídeo à esquerda para começar.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {projects.map((project) => (
                    <Card
                      key={project.name}
                      className="cursor-pointer border-surface-200 bg-surface-50/50 transition-all hover:border-primary-200 hover:bg-primary-50/30 hover:shadow-sm"
                      onClick={() => onOpenProject(project.name)}
                    >
                      <CardContent className="flex items-center gap-3.5 p-3.5">
                        <div className="w-9 h-9 bg-primary-100 rounded-lg flex items-center justify-center flex-shrink-0">
                          <Film className="w-4 h-4 text-primary-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-surface-800 truncate">{project.name}</p>
                          <p className="text-[10px] text-surface-400 truncate mt-0.5">
                            {project.originalName || ''} • {project.date ? new Date(project.date).toLocaleDateString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''}
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-surface-400 hover:bg-red-50 hover:text-red-500 rounded-md"
                          onClick={(event) => {
                            event.stopPropagation();
                            onDeleteProject(project.name);
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
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Toolbar({
  playback,
  selectionMode,
  zoom,
  cropActive,
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
}) {
  return (
    <div id="toolbar" className="bg-white border-b border-surface-200 px-6 py-2">
      <div className="flex items-center gap-1">
        <div className="flex items-center gap-1 pr-3 mr-3 border-r border-surface-200">
          <span className="text-[10px] font-bold text-primary-500 uppercase tracking-wider mr-2">IA</span>
          <ToolbarButton icon={<Scissors className="w-4 h-4" />} onClick={onToggleSilence}>
            Remover Silêncio
          </ToolbarButton>
          <ToolbarButton icon={<Subtitles className="w-4 h-4" />} onClick={onToggleSubtitles}>
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
          <ToolbarButton icon={<Eye className="w-4 h-4" />} active={dockProcessedPreview} onClick={onToggleDockedPreview}>
            Preview lateral
          </ToolbarButton>
        </div>

        <div className="flex items-center gap-1">
          <ToolbarIconButton onClick={onZoomOut} title="Zoom Out">
            <ZoomOut className="w-4 h-4" />
          </ToolbarIconButton>
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
  const originalVideo = playback.originalVideoRef.current;
  const aspectRatio = originalVideo && originalVideo.videoWidth && originalVideo.videoHeight
    ? `${originalVideo.videoWidth} / ${originalVideo.videoHeight}`
    : 'auto';

  return (
    <div id="original-panel" className={`${className} flex-col min-w-0 min-h-0`}>
      <div className="flex items-center gap-2 mb-2">
        <div className="w-2 h-2 rounded-full bg-surface-400" />
        <span className="text-xs font-semibold text-surface-500 uppercase tracking-wider">Original</span>
        <span className="text-xs font-mono text-surface-400 ml-auto">{formatTime(playback.originalTime)}</span>
      </div>
      <div className="relative bg-black rounded-none overflow-hidden flex-1 min-h-0 flex items-center justify-center shadow-lg group">
        <div 
          className="video-frame relative max-w-full max-h-full"
          style={{ aspectRatio, width: 'auto', height: 'auto' }}
        >
          <video
            ref={playback.originalVideoRef}
            className="w-full h-full object-contain"
            preload="metadata"
            playsInline
            onLoadedMetadata={playback.handleOriginalLoadedMetadata}
            onTimeUpdate={playback.handleOriginalTimeUpdate}
            onEnded={playback.handleEnded}
          />
          <CropOverlay
            active={cropActive}
            videoRef={playback.originalVideoRef}
            rect={cropRect}
            onRectChange={onCropRectChange}
            onCropChange={onCropChange}
          />
        </div>
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

function SubtitleOverlayText({ playback, subtitleStyle }) {
  const activeSubtitle = playback.activeSubtitle;
  if (!activeSubtitle) return null;

  const highlightWords = subtitleStyle?.highlightWords;
  const highlightColor = subtitleStyle?.highlightColor || '#facc15';

  if (!highlightWords || !activeSubtitle.words || activeSubtitle.words.length === 0) {
    return activeSubtitle.text;
  }

  const sourceTime = playback.hasEditedTimeline()
    ? playback.timelineTimeToSourceTime(playback.currentTime)
    : playback.currentTime;

  // Find the currently active word index
  let activeIndex = -1;
  for (let i = 0; i < activeSubtitle.words.length; i++) {
    const w = activeSubtitle.words[i];
    if (sourceTime >= w.start && sourceTime <= w.end) {
      activeIndex = i;
      break;
    }
  }

  // If no word is currently active (e.g. during small gaps),
  // keep highlighting the last spoken word to avoid flickering.
  if (activeIndex === -1) {
    for (let i = activeSubtitle.words.length - 1; i >= 0; i--) {
      if (sourceTime >= activeSubtitle.words[i].end) {
        activeIndex = i;
        break;
      }
    }
  }

  return (
    <>
      {activeSubtitle.words.map((w, i) => {
        const isHighlighted = i === activeIndex;
        return (
          <span
            key={i}
            style={{
              display: 'inline-block',
              verticalAlign: 'baseline',
              color: isHighlighted ? highlightColor : (subtitleStyle?.primaryColor || '#ffffff'),
              transform: isHighlighted ? 'scale(1.16)' : 'scale(1)',
              transition: 'color 0.1s ease-in-out, transform 0.1s ease-in-out',
            }}
          >
            {w.word}
          </span>
        );
      })}
    </>
  );
}

function ProcessedVideoPanel({
  playback,
  subtitleStyle,
  showSubtitleOverlay,
  className = '',
}) {
  const processedVideo = playback.processedVideoRef.current;
  const aspectRatio = processedVideo && processedVideo.videoWidth && processedVideo.videoHeight
    ? `${processedVideo.videoWidth} / ${processedVideo.videoHeight}`
    : 'auto';
  const subtitlePreviewStyle = buildSubtitlePreviewStyle(subtitleStyle);

  return (
    <div id="processed-panel" className={`${className} flex-col min-w-0 min-h-0`}>
      <div className="flex items-center gap-2 mb-2">
        <div className="w-2 h-2 rounded-full bg-emerald-500" />
        <span className="text-xs font-semibold text-emerald-600 uppercase tracking-wider">Processado</span>
        <span className="text-xs font-mono text-surface-400 ml-auto">{formatTime(playback.processedTime)}</span>
      </div>
      <div className="relative bg-black rounded-none overflow-hidden flex-1 min-h-0 flex items-center justify-center shadow-lg">
        <div 
          className="video-frame relative max-w-full max-h-full"
          style={{ aspectRatio, width: 'auto', height: 'auto' }}
        >
          <video
            ref={playback.processedVideoRef}
            className="block w-full h-full object-contain"
            preload="metadata"
            playsInline
            onLoadedMetadata={playback.handleProcessedLoadedMetadata}
            onTimeUpdate={playback.handleProcessedTimeUpdate}
            onEnded={playback.handleEnded}
          />
          <div
            id="processed-subtitle-overlay"
            className={`video-subtitle-overlay ${showSubtitleOverlay && playback.subtitleText ? '' : 'hidden'}`}
            style={subtitlePreviewStyle.container}
          >
            <div className="video-subtitle-overlay__text" style={subtitlePreviewStyle.text}>
              <SubtitleOverlayText playback={playback} subtitleStyle={subtitleStyle} />
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
  subtitleStyle,
  showSubtitleOverlay,
  dockProcessedPreview,
  onCropRectChange,
  onCropChange,
}) {
  const showOriginal = playback.showOriginal;
  const showProcessed = playback.showProcessed;

  // Count active panels when docked
  const dockedPanelsCount = (showOriginal ? 1 : 0) + (showProcessed ? 1 : 0);
  const isDocked = dockProcessedPreview && dockedPanelsCount > 0;

  const previewAreaClass = isDocked
    ? `editor-preview-dock ${dockedPanelsCount === 2 ? 'editor-preview-dock--double' : 'editor-preview-dock--single'} flex gap-4`
    : `preview-area ${dockedPanelsCount === 0 ? 'preview-area--collapsed' : ''}`;

  const originalPanelClass = showOriginal ? 'flex flex-1' : 'hidden';
  const processedPanelClass = showProcessed ? 'flex flex-1' : 'hidden';

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

      <div id="timeline-scrollbar-track" ref={scrollbarTrackRef} className="h-[14px] bg-surface-50 border-t border-surface-100 relative cursor-pointer" onClick={(event) => {
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

function SubtitleSidebar({ open, settings, setSettings, style, setStyle, subtitles, onClose, onGenerate, onBurn }) {
  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) onClose(); }} modal={false}>
      <SheetContent
        side="left"
        hasOverlay={false}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className="top-14 bottom-0 h-auto w-80 rounded-none border-r border-surface-200 p-0"
      >
        <div className="flex h-full flex-col">
          <SheetHeader className="border-b border-surface-100 px-5 py-4 pr-12">
            <SheetTitle className="flex items-center gap-2">
              <Subtitles className="w-4 h-4 text-primary-500" />
              Legendas IA
            </SheetTitle>
            <SheetDescription>Configure transcrição e estilo antes de gerar ou aplicar as legendas.</SheetDescription>
          </SheetHeader>

          <ScrollArea className="flex-1">
            <div className="space-y-6 px-5 py-5">
              <Card className="border-surface-200/80">
                <CardHeader className="pb-4">
                  <CardTitle className="text-sm">Configuração da transcrição</CardTitle>
                  <CardDescription>Whisper será usado para transcrever e sincronizar as falas.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
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
                </CardContent>
              </Card>

              <Card className="border-surface-200/80">
                <CardHeader className="pb-4">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Palette className="w-3.5 h-3.5 text-primary-500" />
                    Estilo das Legendas
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <Label className="mb-2 block">Presets</Label>
                    <PresetSelector
                      currentStyle={style}
                      onStyleChange={setStyle}
                    />
                  </div>
                  <SelectField label="Fonte" value={style.fontName} onChange={(value) => setStyle((prev) => ({ ...prev, fontName: value }))}>
                    <option value="Arial">Arial</option>
                    <option value="Roboto">Roboto</option>
                    <option value="Inter">Inter</option>
                    <option value="Montserrat">Montserrat</option>
                    <option value="Open Sans">Open Sans</option>
                  </SelectField>
                  <InputField label="Tamanho" type="number" value={style.fontSize} onChange={(value) => setStyle((prev) => ({ ...prev, fontSize: parseInt(value, 10) || 24 }))} />
                  <div className="grid grid-cols-2 gap-3">
                    <ColorField label="Cor do Texto" value={style.primaryColor} onChange={(value) => setStyle((prev) => ({ ...prev, primaryColor: value }))} />
                    <ColorField label="Cor do Contorno" value={style.outlineColor} onChange={(value) => setStyle((prev) => ({ ...prev, outlineColor: value }))} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <InputField label="Contorno" type="number" value={style.outline} onChange={(value) => setStyle((prev) => ({ ...prev, outline: parseInt(value, 10) || 0 }))} />
                    <InputField label="Sombra" type="number" value={style.shadow} onChange={(value) => setStyle((prev) => ({ ...prev, shadow: parseInt(value, 10) || 0 }))} />
                  </div>
                  <SelectField label="Posição" value={String(style.alignment)} onChange={(value) => setStyle((prev) => ({ ...prev, alignment: parseInt(value, 10) }))}>
                    <option value="2">Inferior Centro</option>
                    <option value="8">Superior Centro</option>
                    <option value="5">Centro</option>
                    <option value="1">Inferior Esquerda</option>
                    <option value="3">Inferior Direita</option>
                  </SelectField>
                  <InputField
                    label="Posição Vertical (%)"
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={style.positionY}
                    onChange={(value) => setStyle((prev) => ({ ...prev, positionY: clamp(parseFloat(value) || 0, 0, 100) }))}
                  />
                  <InputField
                    label="Altura da Faixa (%)"
                    type="number"
                    min="4"
                    max="100"
                    step="1"
                    value={style.areaHeight}
                    onChange={(value) => setStyle((prev) => ({ ...prev, areaHeight: clamp(parseFloat(value) || 0, 4, 100) }))}
                  />
                  <div>
                    <Label className="mb-2 block">Negrito</Label>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant={style.bold ? 'default' : 'outline'}
                        className="flex-1"
                        onClick={() => setStyle((prev) => ({ ...prev, bold: true }))}
                      >
                        Sim
                      </Button>
                      <Button
                        type="button"
                        variant={!style.bold ? 'default' : 'outline'}
                        className="flex-1"
                        onClick={() => setStyle((prev) => ({ ...prev, bold: false }))}
                      >
                        Não
                      </Button>
                    </div>
                  </div>

                  <div>
                    <Label className="mb-2 block">Destacar palavras faladas</Label>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant={style.highlightWords ? 'default' : 'outline'}
                        className="flex-1"
                        onClick={() => setStyle((prev) => ({ ...prev, highlightWords: true }))}
                      >
                        Sim
                      </Button>
                      <Button
                        type="button"
                        variant={!style.highlightWords ? 'default' : 'outline'}
                        className="flex-1"
                        onClick={() => setStyle((prev) => ({ ...prev, highlightWords: false }))}
                      >
                        Não
                      </Button>
                    </div>
                  </div>

                  {style.highlightWords && (
                    <ColorField
                      label="Cor do Destaque"
                      value={style.highlightColor || '#facc15'}
                      onChange={(value) => setStyle((prev) => ({ ...prev, highlightColor: value }))}
                    />
                  )}
                </CardContent>
              </Card>

              <div className="space-y-2">
                <Button type="button" className="w-full gap-2" onClick={onGenerate}>
                  <Sparkles className="w-4 h-4" />
                  Gerar Legendas com IA
                </Button>
                {subtitles.length ? (
                  <Button type="button" variant="secondary" className="w-full gap-2" onClick={onBurn}>
                    <Stamp className="w-4 h-4" />
                    Aplicar no Vídeo
                  </Button>
                ) : null}
              </div>

              {subtitles.length ? (
                <Card className="border-surface-200/80">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Legendas Geradas</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="max-h-[300px]">
                      <div className="space-y-2">
                        {subtitles.map((subtitle, index) => (
                          <Card key={`${subtitle.start}-${subtitle.end}-${index}`} className="border-surface-200 bg-surface-50 shadow-none">
                            <CardContent className="p-3">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-[10px] font-mono text-surface-400">{formatTime(subtitle.start)} → {formatTime(subtitle.end)}</span>
                                <span className="text-[10px] text-surface-300">#{index + 1}</span>
                              </div>
                              <p className="text-xs text-surface-700 leading-relaxed">{subtitle.text}</p>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              ) : null}
            </div>
          </ScrollArea>
        </div>
      </SheetContent>
    </Sheet>
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

function SelectField({ label, value, onChange, children }) {
  const items = Children.toArray(children).filter(isValidElement);

  return (
    <div>
      <Label className="mb-1.5 block">{label}</Label>
      <Select value={String(value)} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((child, index) => (
            <SelectItem key={`${child.props.value ?? child.props.children}-${index}`} value={String(child.props.value)}>
              {child.props.children}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function InputField({ label, onChange, ...props }) {
  return (
    <div>
      <Label className="mb-1 block normal-case tracking-normal font-medium text-surface-500">{label}</Label>
      <Input
        {...props}
        onChange={onChange ? (event) => onChange(event.target.value) : undefined}
      />
    </div>
  );
}

function ColorField({ label, value, onChange }) {
  return (
    <div>
      <Label className="mb-1 block normal-case tracking-normal font-medium text-surface-500">{label}</Label>
      <Input type="color" value={value} onChange={(event) => onChange(event.target.value)} className="h-10 cursor-pointer p-1" />
    </div>
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
    let ws;
    let cancelled = false;
    let reconnectAttempts = 0;

    function connect() {
      if (cancelled) return;
      const wsUrl = BASE_URL
        ? `${BASE_URL.replace('http', 'ws')}/ws`
        : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;
      ws = new WebSocket(wsUrl);

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
  const [activeSubtitle, setActiveSubtitle] = useState(null);
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
    setActiveSubtitle(subtitle || null);
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
    const frame = video.closest('.video-frame');
    const frameRect = frame?.getBoundingClientRect();
    const renderedWidth = frameRect?.width || frame?.clientWidth || video.clientWidth || 0;
    const renderedHeight = frameRect?.height || frame?.clientHeight || video.clientHeight || 0;
    const widthScale = renderedWidth > 0 && video.videoWidth > 0 ? video.videoWidth / renderedWidth : 0;
    const heightScale = renderedHeight > 0 && video.videoHeight > 0 ? video.videoHeight / renderedHeight : 0;
    const scale = Math.max(widthScale, heightScale);
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
      const fullSrc = (src.startsWith('/') && !src.startsWith('//')) ? `${BASE_URL}${src}` : src;
      element.src = fullSrc;
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
    setActiveSubtitle(null);
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
    setActiveSubtitle(null);
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
    activeSubtitle,
    timelineTimeToSourceTime,
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

function buildBurnStyle(style, displayScale = 1) {
  const safeScale = Number.isFinite(displayScale) && displayScale > 0 ? displayScale : 1;
  return {
    fontName: style.fontName,
    fontSize: Number((style.fontSize * safeScale).toFixed(2)),
    primaryColor: hexToASSColor(style.primaryColor),
    outlineColor: hexToASSColor(style.outlineColor),
    backColor: '&H80000000',
    bold: style.bold ? -1 : 0,
    outline: Number((style.outline * safeScale).toFixed(2)),
    shadow: Number((style.shadow * safeScale).toFixed(2)),
    alignment: style.alignment,
    positionY: clamp(Number(style.positionY) || 0, 0, 100),
    areaHeight: clamp(Number(style.areaHeight) || 18, 4, 100),
    marginV: 0,
    highlightWords: style.highlightWords ?? false,
    highlightColor: style.highlightColor ? hexToASSColor(style.highlightColor) : '&H0008B3EA',
  };
}

/**
 * Outline via text-shadow: filled disk of offsets (not rings of samples) avoids both
 * miter spikes (-webkit-text-stroke) and scalloped “petals” from sparse angular sampling.
 */
function buildDiskOutlineTextShadows(outlinePx, color) {
  const w = Math.max(0, Math.ceil(Number(outlinePx) || 0));
  if (w <= 0) return [];
  const c = color || '#000000';
  // w===1: include diagonals so a 1px outline matches a full 8-neighbour ring (not a thin +).
  const maxSq = w === 1 ? 2 : w * w;
  const layers = [];
  for (let dy = -w; dy <= w; dy += 1) {
    for (let dx = -w; dx <= w; dx += 1) {
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
  const dropShadow = shadow > 0 ? `0 ${shadow}px ${shadow * 4}px rgba(0, 0, 0, 0.82)` : '';
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
      fontWeight: style?.bold ? 700 : 600,
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
