import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Film,
  Loader2,
  Mic,
  PencilLine,
  Play,
  Plus,
  Save,
  Subtitles,
  Trash2,
  Upload,
  Volume2,
} from 'lucide-react';
import { startTransition, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';

import { Button } from './components/ui/button.jsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card.jsx';
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
import { ScrollArea } from './components/ui/scroll-area.jsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './components/ui/select.jsx';
import {
  createPreset,
  deletePreset,
  exportVideo,
  generateSubtitles,
  listPresets,
  updatePreset,
  uploadVideo,
} from './lib/api.js';
import { clamp, cn, formatDuration, formatTime } from './lib/utils.js';

const WHISPER_MODELS = ['tiny', 'base', 'small', 'medium', 'large'];

const DEFAULT_SUBTITLE_STYLE = {
  fontName: 'Arial',
  fontSize: 28,
  primaryColor: '#ffffff',
  outlineColor: '#000000',
  outline: 2,
  shadow: 1,
  alignment: 2,
  positionY: 84,
  areaHeight: 18,
  bold: true,
  backgroundColor: '#000000',
  backgroundOpacity: 0.45,
  backgroundBorderColor: '#000000',
  backgroundBorderThickness: 0,
  backgroundBorderRadius: 16,
};

const DEFAULT_FORM = {
  model: 'medium',
  language: 'pt',
};

const DEFAULT_STATUS = {
  type: 'idle',
  title: '',
  message: '',
};

export default function App() {
  const fileInputRef = useRef(null);
  const previewRef = useRef(null);
  const videoRef = useRef(null);
  const presetRailRef = useRef(null);
  const noticeTimeoutRef = useRef(null);

  const [videoFile, setVideoFile] = useState(null);
  const [videoInfo, setVideoInfo] = useState(null);
  const [projectId, setProjectId] = useState('');
  const [subtitles, setSubtitles] = useState([]);
  const [subtitleForm, setSubtitleForm] = useState(DEFAULT_FORM);
  const [subtitleStyle, setSubtitleStyle] = useState(DEFAULT_SUBTITLE_STYLE);
  const [presets, setPresets] = useState([]);
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [status, setStatus] = useState(DEFAULT_STATUS);
  const [notice, setNotice] = useState('');
  const [uploading, setUploading] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [exportingMode, setExportingMode] = useState('');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [accordionOpen, setAccordionOpen] = useState(false);
  const [presetDialog, setPresetDialog] = useState({ type: '', open: false });
  const [presetName, setPresetName] = useState('');
  const [offsetValue, setOffsetValue] = useState('0.5');

  useEffect(() => {
    loadPresets();
  }, []);

  const activeSubtitleIndex = useMemo(
    () => subtitles.findIndex((item) => currentTime >= item.start && currentTime <= item.end),
    [currentTime, subtitles],
  );

  const activeSubtitle = activeSubtitleIndex >= 0 ? subtitles[activeSubtitleIndex] : null;
  const videoReady = Boolean(videoFile?.path);

  async function loadPresets() {
    try {
      const loaded = await listPresets();
      setPresets(loaded);
      if (!selectedPresetId && loaded[0]) {
        setSelectedPresetId(loaded[0].id);
        setSubtitleStyle({ ...DEFAULT_SUBTITLE_STYLE, ...loaded[0].style });
      }
    } catch {
      setPresets([]);
    }
  }

  function setMessage(message) {
    setNotice(message);
    window.clearTimeout(noticeTimeoutRef.current);
    noticeTimeoutRef.current = window.setTimeout(() => setNotice(''), 3200);
  }

  useEffect(() => () => window.clearTimeout(noticeTimeoutRef.current), []);

  async function handleUpload(file) {
    if (!file) return;
    setUploading(true);
    setStatus({
      type: 'loading',
      title: 'Importando vídeo',
      message: `Transcrevendo automaticamente com Whisper ${subtitleForm.model}.`,
    });

    try {
      const result = await uploadVideo(file, {
        model: subtitleForm.model,
        language: subtitleForm.language,
        onProcessingState: () => {
          setStatus({
            type: 'loading',
            title: 'Gerando legendas',
            message: `Whisper ${subtitleForm.model} está analisando o áudio.`,
          });
        },
      });

      startTransition(() => {
        setProjectId(result.projectId);
        setVideoFile(result.file);
        setVideoInfo(result.info);
        setSubtitles(result.subtitles || []);
        setDuration(result.info?.duration || 0);
        setCurrentTime(0);
      });

      if (videoRef.current) {
        videoRef.current.load();
      }

      setStatus({
        type: 'success',
        title: 'Vídeo pronto',
        message: `${(result.subtitles || []).length} legendas geradas na importação.`,
      });
      setMessage('Legendas geradas automaticamente na importação.');
    } catch (error) {
      setStatus({
        type: 'error',
        title: 'Falha ao importar',
        message: error.message,
      });
    } finally {
      setUploading(false);
    }
  }

  async function handleRegenerate() {
    if (!videoFile?.filename || !projectId) return;
    setRegenerating(true);
    setStatus({
      type: 'loading',
      title: 'Regenerando legendas',
      message: `Executando Whisper ${subtitleForm.model}.`,
    });

    try {
      const result = await generateSubtitles({
        filename: videoFile.filename,
        projectId,
        model: subtitleForm.model,
        language: subtitleForm.language,
        style: subtitleStyle,
      });
      setSubtitles(result.subtitles || []);
      setStatus({
        type: 'success',
        title: 'Legendas atualizadas',
        message: `${(result.subtitles || []).length} blocos gerados com Whisper ${subtitleForm.model}.`,
      });
      setMessage(`Whisper ${subtitleForm.model} executado novamente.`);
    } catch (error) {
      setStatus({
        type: 'error',
        title: 'Falha ao regenerar',
        message: error.message,
      });
    } finally {
      setRegenerating(false);
    }
  }

  async function handleExport(mode) {
    if (!videoFile?.path || !projectId || subtitles.length === 0) return;
    setExportingMode(mode);
    setStatus({
      type: 'loading',
      title: 'Preparando exportação',
      message: exportLabel(mode),
    });

    try {
      const result = await exportVideo({
        projectId,
        sourceFile: videoFile.path,
        mode,
        subtitles,
        style: subtitleStyle,
      });
      downloadBlob(result.blob, result.filename);
      setStatus({
        type: 'success',
        title: 'Exportação concluída',
        message: result.filename,
      });
    } catch (error) {
      setStatus({
        type: 'error',
        title: 'Falha ao exportar',
        message: error.message,
      });
    } finally {
      setExportingMode('');
    }
  }

  function handlePresetSelect(preset) {
    setSelectedPresetId(preset.id);
    setSubtitleStyle({ ...DEFAULT_SUBTITLE_STYLE, ...preset.style });
    setMessage(`Preset "${preset.name}" aplicado.`);
  }

  async function handleCreatePreset() {
    if (!presetName.trim()) return;
    try {
      const created = await createPreset(presetName.trim(), subtitleStyle);
      setPresets((prev) => [...prev, created]);
      setSelectedPresetId(created.id);
      setPresetDialog({ type: '', open: false });
      setPresetName('');
      setMessage(`Preset "${created.name}" criado.`);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function handleRenamePreset() {
    const selectedPreset = presets.find((item) => item.id === selectedPresetId);
    if (!selectedPreset || !presetName.trim()) return;
    try {
      const updated = await updatePreset(selectedPreset.id, { name: presetName.trim() });
      setPresets((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      setPresetDialog({ type: '', open: false });
      setPresetName('');
      setMessage(`Preset renomeado para "${updated.name}".`);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function handleSavePresetStyle() {
    const selectedPreset = presets.find((item) => item.id === selectedPresetId);
    if (!selectedPreset) return;
    try {
      const updated = await updatePreset(selectedPreset.id, { style: subtitleStyle });
      setPresets((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      setMessage(`Preset "${updated.name}" atualizado com o estilo atual.`);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function handleDeletePreset() {
    const selectedPreset = presets.find((item) => item.id === selectedPresetId);
    if (!selectedPreset) return;
    try {
      await deletePreset(selectedPreset.id);
      const remaining = presets.filter((item) => item.id !== selectedPreset.id);
      setPresets(remaining);
      if (remaining[0]) {
        setSelectedPresetId(remaining[0].id);
        setSubtitleStyle({ ...DEFAULT_SUBTITLE_STYLE, ...remaining[0].style });
      } else {
        setSelectedPresetId('');
      }
      setMessage(`Preset "${selectedPreset.name}" removido.`);
    } catch (error) {
      setMessage(error.message);
    }
  }

  function updateSubtitle(index, patch) {
    setSubtitles((prev) => prev.map((item, itemIndex) => {
      if (itemIndex !== index) return item;
      const next = { ...item, ...patch };
      const safeStart = Math.max(0, Number(next.start));
      const safeEnd = Math.max(safeStart + 0.05, Number(next.end));
      return {
        ...next,
        start: safeStart,
        end: safeEnd,
      };
    }));
  }

  function shiftSubtitles(seconds) {
    setSubtitles((prev) => prev.map((item) => ({
      ...item,
      start: Math.max(0, round(item.start + seconds)),
      end: Math.max(0.05, round(item.end + seconds)),
    })));
    setMessage(`Offset aplicado: ${seconds > 0 ? '+' : ''}${seconds.toFixed(2)}s.`);
  }

  const handleKeyboardShortcuts = useEffectEvent((event) => {
    const target = event.target;
    if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) {
      return;
    }

    if (!videoRef.current || !videoReady) return;

    if (event.code === 'Space' || event.key.toLowerCase() === 'k') {
      event.preventDefault();
      togglePlayback();
      return;
    }

    if (event.key.toLowerCase() === 'j') {
      seekBy(-10);
      return;
    }
    if (event.key.toLowerCase() === 'l') {
      seekBy(10);
      return;
    }
    if (event.key === 'ArrowLeft') {
      seekBy(-5);
      return;
    }
    if (event.key === 'ArrowRight') {
      seekBy(5);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      updateVolume(clamp(volume + 0.05, 0, 1));
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      updateVolume(clamp(volume - 0.05, 0, 1));
      return;
    }
    if (event.key.toLowerCase() === 'm') {
      toggleMute();
      return;
    }
    if (event.key.toLowerCase() === 'f') {
      previewRef.current?.requestFullscreen?.();
    }
  });

  useEffect(() => {
    window.addEventListener('keydown', handleKeyboardShortcuts);
    return () => window.removeEventListener('keydown', handleKeyboardShortcuts);
  }, [handleKeyboardShortcuts]);

  function togglePlayback() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play();
    } else {
      video.pause();
    }
  }

  function seekBy(delta) {
    if (!videoRef.current) return;
    videoRef.current.currentTime = clamp(videoRef.current.currentTime + delta, 0, duration || 0);
  }

  function updateVolume(nextVolume) {
    setVolume(nextVolume);
    setMuted(nextVolume === 0);
    if (videoRef.current) {
      videoRef.current.volume = nextVolume;
      videoRef.current.muted = nextVolume === 0;
    }
  }

  function toggleMute() {
    const nextMuted = !muted;
    setMuted(nextMuted);
    if (videoRef.current) {
      videoRef.current.muted = nextMuted;
    }
  }

  const subtitlePreviewStyle = buildPreviewStyle(subtitleStyle);

  return (
    <div className="studio-shell">
      <aside className="studio-sidebar">
        <div className="studio-brand">
          <div className="studio-brand__mark">
            <Subtitles className="h-5 w-5" />
          </div>
          <div>
            <p className="studio-brand__eyebrow">Caption Studio</p>
            <h1 className="studio-brand__title">StudioCut</h1>
          </div>
        </div>

        <ScrollArea className="studio-sidebar__scroll">
          <div className="studio-stack">
            <Card className="studio-card">
              <CardHeader className="pb-4">
                <CardTitle>Import</CardTitle>
                <CardDescription>Ao importar, o app já gera as legendas com o modelo padrão selecionado.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Whisper padrão">
                    <Select value={subtitleForm.model} onValueChange={(value) => setSubtitleForm((prev) => ({ ...prev, model: value }))}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {WHISPER_MODELS.map((model) => (
                          <SelectItem key={model} value={model}>{model}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Idioma">
                    <Input
                      value={subtitleForm.language}
                      onChange={(event) => setSubtitleForm((prev) => ({ ...prev, language: event.target.value }))}
                    />
                  </Field>
                </div>

                <button
                  type="button"
                  className="import-dropzone"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                >
                  <Upload className="h-5 w-5" />
                  <div>
                    <p className="font-semibold text-surface-800">{uploading ? 'Importando e transcrevendo...' : 'Selecionar vídeo'}</p>
                    <p className="text-sm text-surface-500">Sem timeline, sem crop, só preview e legenda.</p>
                  </div>
                </button>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={(event) => handleUpload(event.target.files?.[0])}
                />

                {videoFile ? (
                  <div className="rounded-2xl border border-surface-200 bg-surface-50 px-4 py-3 text-sm text-surface-600">
                    <div className="font-semibold text-surface-900">{videoFile.originalName}</div>
                    <div className="mt-1 flex flex-wrap gap-3 text-xs text-surface-500">
                      <span>{videoInfo?.video?.width}x{videoInfo?.video?.height}</span>
                      <span>{formatDuration(videoInfo?.duration || 0)}</span>
                      <span>{subtitles.length} legendas</span>
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card className="studio-card">
              <CardHeader className="pb-4">
                <CardTitle>Subtitle Style</CardTitle>
                <CardDescription>Presets em cartões horizontais com edição escondida em accordion.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" size="icon" onClick={() => presetRailRef.current?.scrollBy({ left: -240, behavior: 'smooth' })}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <div ref={presetRailRef} className="preset-rail">
                    {presets.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        className={cn('choice-card', selectedPresetId === preset.id && 'choice-card--active')}
                        onClick={() => handlePresetSelect(preset)}
                      >
                        <span className="choice-card__title">{preset.name}</span>
                        <span className="choice-card__meta">
                          {preset.style.fontName} · {preset.style.fontSize}px
                        </span>
                        <span
                          className="choice-card__sample"
                          style={sampleChipStyle(preset.style)}
                        >
                          Aa
                        </span>
                      </button>
                    ))}
                  </div>
                  <Button type="button" variant="outline" size="icon" onClick={() => presetRailRef.current?.scrollBy({ left: 240, behavior: 'smooth' })}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => { setPresetDialog({ type: 'create', open: true }); setPresetName(''); }}>
                    <Plus className="h-4 w-4" />
                    Criar
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!selectedPresetId}
                    onClick={() => {
                      const preset = presets.find((item) => item.id === selectedPresetId);
                      setPresetName(preset?.name || '');
                      setPresetDialog({ type: 'rename', open: true });
                    }}
                  >
                    <PencilLine className="h-4 w-4" />
                    Renomear
                  </Button>
                  <Button type="button" variant="destructive" size="sm" disabled={!selectedPresetId || selectedPresetId === 'default'} onClick={handleDeletePreset}>
                    <Trash2 className="h-4 w-4" />
                    Excluir
                  </Button>
                </div>

                <div className="rounded-2xl border border-surface-200">
                  <button
                    type="button"
                    className="accordion-trigger"
                    onClick={() => setAccordionOpen((prev) => !prev)}
                  >
                    <span>Edit Preset</span>
                    <ChevronDown className={cn('h-4 w-4 transition-transform', accordionOpen && 'rotate-180')} />
                  </button>

                  {accordionOpen ? (
                    <div className="accordion-body">
                      <div className="grid gap-3 md:grid-cols-2">
                        <Field label="Font">
                          <Input value={subtitleStyle.fontName} onChange={(event) => setSubtitleStyle((prev) => ({ ...prev, fontName: event.target.value }))} />
                        </Field>
                        <Field label="Font Size">
                          <Input type="number" value={subtitleStyle.fontSize} onChange={(event) => setSubtitleStyle((prev) => ({ ...prev, fontSize: Number(event.target.value) || 1 }))} />
                        </Field>
                        <Field label="Font Color">
                          <Input type="color" value={subtitleStyle.primaryColor} onChange={(event) => setSubtitleStyle((prev) => ({ ...prev, primaryColor: event.target.value }))} />
                        </Field>
                        <Field label="Border Color">
                          <Input type="color" value={subtitleStyle.outlineColor} onChange={(event) => setSubtitleStyle((prev) => ({ ...prev, outlineColor: event.target.value }))} />
                        </Field>
                        <Field label="Border Thickness">
                          <Input type="number" value={subtitleStyle.outline} onChange={(event) => setSubtitleStyle((prev) => ({ ...prev, outline: Number(event.target.value) || 0 }))} />
                        </Field>
                        <Field label="Shadow">
                          <Input type="number" value={subtitleStyle.shadow} onChange={(event) => setSubtitleStyle((prev) => ({ ...prev, shadow: Number(event.target.value) || 0 }))} />
                        </Field>
                        <Field label="Vertical Position">
                          <Input type="number" value={subtitleStyle.positionY} onChange={(event) => setSubtitleStyle((prev) => ({ ...prev, positionY: Number(event.target.value) || 0 }))} />
                        </Field>
                        <Field label="Caption Area Height">
                          <Input type="number" value={subtitleStyle.areaHeight} onChange={(event) => setSubtitleStyle((prev) => ({ ...prev, areaHeight: Number(event.target.value) || 1 }))} />
                        </Field>
                        <Field label="Alignment">
                          <Select value={String(subtitleStyle.alignment)} onValueChange={(value) => setSubtitleStyle((prev) => ({ ...prev, alignment: Number(value) }))}>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="1">Left</SelectItem>
                              <SelectItem value="2">Center</SelectItem>
                              <SelectItem value="3">Right</SelectItem>
                            </SelectContent>
                          </Select>
                        </Field>
                        <Field label="Background Color">
                          <Input type="color" value={subtitleStyle.backgroundColor} onChange={(event) => setSubtitleStyle((prev) => ({ ...prev, backgroundColor: event.target.value }))} />
                        </Field>
                        <Field label="Background Opacity">
                          <Input type="number" step="0.05" min="0" max="1" value={subtitleStyle.backgroundOpacity} onChange={(event) => setSubtitleStyle((prev) => ({ ...prev, backgroundOpacity: Number(event.target.value) || 0 }))} />
                        </Field>
                        <Field label="BG Border Color">
                          <Input type="color" value={subtitleStyle.backgroundBorderColor} onChange={(event) => setSubtitleStyle((prev) => ({ ...prev, backgroundBorderColor: event.target.value }))} />
                        </Field>
                        <Field label="BG Border Thickness">
                          <Input type="number" value={subtitleStyle.backgroundBorderThickness} onChange={(event) => setSubtitleStyle((prev) => ({ ...prev, backgroundBorderThickness: Number(event.target.value) || 0 }))} />
                        </Field>
                        <Field label="BG Border Radius">
                          <Input type="number" value={subtitleStyle.backgroundBorderRadius} onChange={(event) => setSubtitleStyle((prev) => ({ ...prev, backgroundBorderRadius: Number(event.target.value) || 0 }))} />
                        </Field>
                      </div>

                      <label className="flex items-center gap-2 text-sm font-medium text-surface-700">
                        <input
                          type="checkbox"
                          checked={subtitleStyle.bold}
                          onChange={(event) => setSubtitleStyle((prev) => ({ ...prev, bold: event.target.checked }))}
                        />
                        Bold
                      </label>

                      <Button type="button" className="w-full" disabled={!selectedPresetId} onClick={handleSavePresetStyle}>
                        <Save className="h-4 w-4" />
                        Save Preset
                      </Button>
                    </div>
                  ) : null}
                </div>
              </CardContent>
            </Card>

            <Card className="studio-card">
              <CardHeader className="pb-4">
                <CardTitle>Transcription</CardTitle>
                <CardDescription>Rode novamente com outro modelo de Whisper sem reimportar o vídeo.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Whisper Model">
                    <Select value={subtitleForm.model} onValueChange={(value) => setSubtitleForm((prev) => ({ ...prev, model: value }))}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {WHISPER_MODELS.map((model) => (
                          <SelectItem key={model} value={model}>{model}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Language">
                    <Input value={subtitleForm.language} onChange={(event) => setSubtitleForm((prev) => ({ ...prev, language: event.target.value }))} />
                  </Field>
                </div>
                <Button type="button" className="w-full" disabled={!videoReady || regenerating} onClick={handleRegenerate}>
                  {regenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
                  Regenerate Subtitles
                </Button>
              </CardContent>
            </Card>

            <Card className="studio-card">
              <CardHeader className="pb-4">
                <CardTitle>Export</CardTitle>
                <CardDescription>Escolha o formato final de saída.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <ExportButton mode="burned-video" exportingMode={exportingMode} disabled={!videoReady || subtitles.length === 0} onClick={handleExport}>
                  Video with subtitles burned in
                </ExportButton>
                <ExportButton mode="video-plus-srt" exportingMode={exportingMode} disabled={!videoReady || subtitles.length === 0} onClick={handleExport}>
                  Video with subtitles as .srt file
                </ExportButton>
                <ExportButton mode="srt-only" exportingMode={exportingMode} disabled={subtitles.length === 0} onClick={handleExport}>
                  Only .srt file
                </ExportButton>
              </CardContent>
            </Card>

            <Card className="studio-card">
              <CardHeader className="pb-4">
                <CardTitle>Subtitle Timing</CardTitle>
                <CardDescription>Ajuste o offset global para sincronizar com o áudio.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {[-1, -0.5, 0.5, 1].map((value) => (
                    <Button key={value} type="button" variant="outline" size="sm" disabled={subtitles.length === 0} onClick={() => shiftSubtitles(value)}>
                      {value > 0 ? '+' : ''}{value}s
                    </Button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input value={offsetValue} onChange={(event) => setOffsetValue(event.target.value)} />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={subtitles.length === 0}
                    onClick={() => {
                      const parsed = Number(offsetValue);
                      if (!Number.isFinite(parsed)) return;
                      shiftSubtitles(parsed);
                    }}
                  >
                    Apply offset
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="studio-card studio-card--subtitles">
              <CardHeader className="pb-4">
                <CardTitle>Subtitles</CardTitle>
                <CardDescription>Cartões editáveis com timecodes e texto.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {subtitles.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-surface-300 px-4 py-6 text-sm text-surface-500">
                    Importe um vídeo para gerar as legendas automaticamente.
                  </div>
                ) : subtitles.map((subtitle, index) => (
                  <article
                    key={`${subtitle.start}-${subtitle.end}-${index}`}
                    className={cn('subtitle-card', activeSubtitleIndex === index && 'subtitle-card--active')}
                  >
                    <div className="grid gap-3 md:grid-cols-[1fr_1fr]">
                      <Field label="Start">
                        <SubtitleTimeInput value={subtitle.start} onCommit={(value) => updateSubtitle(index, { start: value })} />
                      </Field>
                      <Field label="End">
                        <SubtitleTimeInput value={subtitle.end} onCommit={(value) => updateSubtitle(index, { end: value })} />
                      </Field>
                    </div>
                    <Field label={`Text ${index + 1}`}>
                      <textarea
                        className="subtitle-textarea"
                        value={subtitle.text}
                        onChange={(event) => updateSubtitle(index, { text: event.target.value })}
                      />
                    </Field>
                    <div className="flex justify-end">
                      <Button type="button" variant="ghost" size="sm" onClick={() => {
                        if (videoRef.current) {
                          videoRef.current.currentTime = subtitle.start;
                          videoRef.current.play();
                        }
                      }}>
                        <Play className="h-4 w-4" />
                        Preview line
                      </Button>
                    </div>
                  </article>
                ))}
              </CardContent>
            </Card>
          </div>
        </ScrollArea>
      </aside>

      <main ref={previewRef} className="studio-preview">
        <div className="studio-preview__header">
          <div>
            <p className="studio-preview__label">Preview</p>
            <h2 className="studio-preview__title">{videoFile?.originalName || 'Nenhum vídeo carregado'}</h2>
          </div>
          {videoInfo ? (
            <div className="studio-preview__meta">
              <span>{videoInfo.video?.width}x{videoInfo.video?.height}</span>
              <span>{formatDuration(videoInfo.duration || 0)}</span>
            </div>
          ) : null}
        </div>

        <div className="studio-preview__surface">
          {videoReady ? (
            <>
              <video
                ref={videoRef}
                src={videoFile.path}
                className="studio-video"
                playsInline
                preload="metadata"
                onLoadedMetadata={(event) => {
                  setDuration(event.currentTarget.duration || videoInfo?.duration || 0);
                  event.currentTarget.volume = volume;
                  event.currentTarget.muted = muted;
                }}
                onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
              />
              {activeSubtitle ? (
                <div className="studio-subtitle-layer" style={subtitlePreviewStyle.container}>
                  <div className="studio-subtitle-chip" style={subtitlePreviewStyle.box}>
                    <span style={subtitlePreviewStyle.text}>{activeSubtitle.text}</span>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <div className="studio-preview__empty">
              <Film className="h-10 w-10" />
              <h3>Vertical-first preview</h3>
              <p>O player ocupa toda a altura da tela para revisar melhor vídeos verticais.</p>
            </div>
          )}
        </div>

        <div className="studio-controls">
          <Button type="button" size="sm" onClick={togglePlayback} disabled={!videoReady}>
            <Play className="h-4 w-4" />
            {isPlaying ? 'Pause' : 'Play'}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => seekBy(-5)} disabled={!videoReady}>-5s</Button>
          <Button type="button" variant="outline" size="sm" onClick={() => seekBy(5)} disabled={!videoReady}>+5s</Button>
          <div className="studio-time">{formatTime(currentTime)} / {formatTime(duration)}</div>
          <div className="studio-volume">
            <Volume2 className="h-4 w-4 text-surface-500" />
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={muted ? 0 : volume}
              onChange={(event) => updateVolume(Number(event.target.value))}
            />
          </div>
          <div className="studio-shortcuts">Space/K play, J/L 10s, arrows 5s, M mute, F full screen</div>
        </div>

        <div className={cn('studio-status', status.type && `studio-status--${status.type}`)}>
          {status.type === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          <div>
            <strong>{status.title || 'Idle'}</strong>
            <p>{status.message || 'Importe um vídeo para começar.'}</p>
          </div>
        </div>

        {notice ? <div className="studio-notice">{notice}</div> : null}
      </main>

      <Dialog open={presetDialog.open} onOpenChange={(open) => setPresetDialog((prev) => ({ ...prev, open }))}>
        <DialogContent showClose>
          <DialogHeader>
            <DialogTitle>{presetDialog.type === 'create' ? 'Criar preset' : 'Renomear preset'}</DialogTitle>
            <DialogDescription>
              {presetDialog.type === 'create'
                ? 'O estilo atual será salvo como um novo preset.'
                : 'Atualize apenas o nome do preset selecionado.'}
            </DialogDescription>
          </DialogHeader>
          <Field label="Preset Name">
            <Input value={presetName} onChange={(event) => setPresetName(event.target.value)} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPresetDialog({ type: '', open: false })}>Cancelar</Button>
            <Button type="button" onClick={presetDialog.type === 'create' ? handleCreatePreset : handleRenamePreset}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function ExportButton({ children, mode, exportingMode, onClick, disabled }) {
  const active = exportingMode === mode;
  return (
    <Button type="button" className="w-full justify-start" variant={mode === 'burned-video' ? 'default' : 'outline'} disabled={disabled || Boolean(exportingMode)} onClick={() => onClick(mode)}>
      {active ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
      {children}
    </Button>
  );
}

function SubtitleTimeInput({ value, onCommit }) {
  const [draft, setDraft] = useState(formatTime(value));

  useEffect(() => {
    setDraft(formatTime(value));
  }, [value]);

  return (
    <Input
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        const parsed = parseTimestamp(draft, value);
        onCommit(parsed);
        setDraft(formatTime(parsed));
      }}
    />
  );
}

function buildPreviewStyle(style) {
  const alignment = Number(style.alignment || 2);
  const justifyContent = alignment === 1 ? 'flex-start' : alignment === 3 ? 'flex-end' : 'center';
  return {
    container: {
      justifyContent,
      alignItems: 'center',
      top: `${clamp(100 - Number(style.positionY || 84), 0, 100)}%`,
      transform: 'translateY(-100%)',
    },
    box: {
      background: hexToRgba(style.backgroundColor, style.backgroundOpacity),
      borderColor: style.backgroundBorderColor,
      borderWidth: `${style.backgroundBorderThickness || 0}px`,
      borderStyle: 'solid',
      borderRadius: `${style.backgroundBorderRadius || 0}px`,
      padding: '0.55em 0.8em',
      maxWidth: '84%',
    },
    text: {
      color: style.primaryColor,
      fontFamily: style.fontName,
      fontSize: `${style.fontSize}px`,
      fontWeight: style.bold ? 700 : 500,
      textAlign: alignment === 1 ? 'left' : alignment === 3 ? 'right' : 'center',
      textShadow: `${style.outline || 0}px ${style.outline || 0}px 0 ${style.outlineColor}, 0 0 ${Math.max(0, Number(style.shadow || 0) * 6)}px rgba(0,0,0,0.55)`,
      lineHeight: 1.2,
      whiteSpace: 'pre-wrap',
    },
  };
}

function sampleChipStyle(style) {
  return {
    color: style.primaryColor,
    background: hexToRgba(style.backgroundColor, style.backgroundOpacity),
    border: `${style.backgroundBorderThickness || 0}px solid ${style.backgroundBorderColor}`,
    borderRadius: `${style.backgroundBorderRadius || 0}px`,
    fontFamily: style.fontName,
    fontWeight: style.bold ? 700 : 500,
  };
}

function hexToRgba(hex, opacity = 1) {
  const normalized = String(hex || '#000000').replace('#', '');
  const safe = normalized.length === 6 ? normalized : '000000';
  const r = Number.parseInt(safe.slice(0, 2), 16);
  const g = Number.parseInt(safe.slice(2, 4), 16);
  const b = Number.parseInt(safe.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${clamp(Number(opacity || 0), 0, 1)})`;
}

function parseTimestamp(value, fallback) {
  const normalized = String(value).trim().replace(',', '.');
  const parts = normalized.split(':');
  if (!parts.length) return fallback;

  let seconds = 0;
  if (parts.length === 3) {
    seconds = Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
  } else if (parts.length === 2) {
    seconds = Number(parts[0]) * 60 + Number(parts[1]);
  } else {
    seconds = Number(parts[0]);
  }
  return Number.isFinite(seconds) ? Math.max(0, round(seconds)) : fallback;
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function exportLabel(mode) {
  if (mode === 'burned-video') return 'Gerando vídeo com legendas queimadas.';
  if (mode === 'video-plus-srt') return 'Empacotando vídeo e SRT.';
  return 'Gerando arquivo SRT.';
}
