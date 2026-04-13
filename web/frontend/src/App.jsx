import {
  CheckCircle2,
  ChevronDown,
  Download,
  Film,
  Loader2,
  Mic,
  Pause,
  PencilLine,
  Play,
  Plus,
  RotateCcw,
  Save,
  SkipBack,
  SkipForward,
  Subtitles,
  Trash2,
  Upload,
  Video,
  Volume2,
  VolumeX,
  XCircle,
} from 'lucide-react';
import { startTransition, useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';

import { Button } from './components/ui/button.jsx';
import { Card, CardContent } from './components/ui/card.jsx';
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

const DEFAULT_FORM = { model: 'medium', language: 'pt' };

export default function App() {
  const fileInputRef   = useRef(null);
  const previewRef     = useRef(null);
  const videoRef       = useRef(null);
  const videoSurfaceRef = useRef(null);
  const noticeTimerRef = useRef(null);
  const controlsTimerRef = useRef(null);
  const activeSubRef   = useRef(null);

  const [videoFile,       setVideoFile]       = useState(null);
  const [videoInfo,       setVideoInfo]       = useState(null);
  const [projectId,       setProjectId]       = useState('');
  const [subtitles,       setSubtitles]       = useState([]);
  const [subtitleForm,    setSubtitleForm]    = useState(DEFAULT_FORM);
  const [subtitleStyle,   setSubtitleStyle]   = useState(DEFAULT_SUBTITLE_STYLE);
  const [presets,         setPresets]         = useState([]);
  const [selectedPresetId,setSelectedPresetId]= useState('');
  const [notice,          setNotice]          = useState(null);   // { type, msg }
  const [uploading,       setUploading]       = useState(false);
  const [regenerating,    setRegenerating]    = useState(false);
  const [exportingMode,   setExportingMode]   = useState('');
  const [currentTime,     setCurrentTime]     = useState(0);
  const [duration,        setDuration]        = useState(0);
  const [isPlaying,       setIsPlaying]       = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [videoDimensions, setVideoDimensions] = useState({ width: 0, height: 0 });
  const [surfaceBounds,   setSurfaceBounds]   = useState({ width: 0, height: 0 });
  const [volume,          setVolume]          = useState(1);
  const [muted,           setMuted]           = useState(false);
  const [accordionOpen,   setAccordionOpen]   = useState(false);
  const [presetDialog,    setPresetDialog]    = useState({ type: '', open: false });
  const [presetName,      setPresetName]      = useState('');
  const [offsetValue,     setOffsetValue]     = useState('0.5');
  const [isDragging,      setIsDragging]      = useState(false);
  const [exportOpen,      setExportOpen]      = useState(false);

  useEffect(() => { loadPresets(); }, []);

  useEffect(() => {
    const surface = videoSurfaceRef.current;
    if (!surface || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setSurfaceBounds({ width: rect.width, height: rect.height });
    });
    observer.observe(surface);
    return () => observer.disconnect();
  }, []);

  // Close export dropdown on outside click
  useEffect(() => {
    if (!exportOpen) return;
    const close = (e) => {
      if (!e.target.closest('.export-dropdown')) setExportOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [exportOpen]);

  const activeSubtitleIndex = useMemo(
    () => subtitles.findIndex((s) => currentTime >= s.start && currentTime <= s.end),
    [currentTime, subtitles],
  );
  const activeSubtitle = activeSubtitleIndex >= 0 ? subtitles[activeSubtitleIndex] : null;
  const videoReady = Boolean(videoFile?.path);

  // Auto-scroll active subtitle into view
  useEffect(() => {
    activeSubRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [activeSubtitleIndex]);

  async function loadPresets() {
    try {
      const loaded = await listPresets();
      setPresets(loaded);
      if (!selectedPresetId && loaded[0]) {
        setSelectedPresetId(loaded[0].id);
        setSubtitleStyle({ ...DEFAULT_SUBTITLE_STYLE, ...loaded[0].style });
      }
    } catch { setPresets([]); }
  }

  function toast(msg, type = 'info') {
    setNotice({ msg, type });
    window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), 3400);
  }

  useEffect(() => () => window.clearTimeout(noticeTimerRef.current), []);
  useEffect(() => () => window.clearTimeout(controlsTimerRef.current), []);

  // Drag-and-drop
  const handleDragOver  = useCallback((e) => { e.preventDefault(); setIsDragging(true); }, []);
  const handleDragLeave = useCallback((e) => { if (!e.currentTarget.contains(e.relatedTarget)) setIsDragging(false); }, []);
  const handleDrop      = useCallback((e) => {
    e.preventDefault(); setIsDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f?.type.startsWith('video/')) handleUpload(f);
  }, []);

  async function handleUpload(file) {
    if (!file) return;
    setUploading(true);
    try {
      const result = await uploadVideo(file, {
        model: subtitleForm.model,
        language: subtitleForm.language,
        onProcessingState: () => {},
      });
      startTransition(() => {
        setProjectId(result.projectId);
        setVideoFile(result.file);
        setVideoInfo(result.info);
        setVideoDimensions({
          width: Number(result.info?.video?.width) || 0,
          height: Number(result.info?.video?.height) || 0,
        });
        setSubtitles(result.subtitles || []);
        setDuration(result.info?.duration || 0);
        setCurrentTime(0);
      });
      if (videoRef.current) videoRef.current.load();
      toast(`${(result.subtitles || []).length} legendas geradas.`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally { setUploading(false); }
  }

  async function handleRegenerate() {
    if (!videoFile?.filename || !projectId) return;
    setRegenerating(true);
    try {
      const result = await generateSubtitles({
        filename: videoFile.filename, projectId,
        model: subtitleForm.model, language: subtitleForm.language, style: subtitleStyle,
      });
      setSubtitles(result.subtitles || []);
      toast(`${(result.subtitles || []).length} legendas com Whisper ${subtitleForm.model}.`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally { setRegenerating(false); }
  }

  async function handleExport(mode) {
    if (!videoFile?.path || !projectId || subtitles.length === 0) return;
    setExportOpen(false);
    setExportingMode(mode);
    try {
      const result = await exportVideo({ projectId, sourceFile: videoFile.path, mode, subtitles, style: subtitleStyle });
      downloadBlob(result.blob, result.filename);
      toast(`Exportado: ${result.filename}`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally { setExportingMode(''); }
  }

  function handlePresetSelect(preset) {
    setSelectedPresetId(preset.id);
    setSubtitleStyle({ ...DEFAULT_SUBTITLE_STYLE, ...preset.style });
    toast(`Preset "${preset.name}" aplicado.`);
  }

  async function handleCreatePreset() {
    if (!presetName.trim()) return;
    try {
      const created = await createPreset(presetName.trim(), subtitleStyle);
      setPresets((p) => [...p, created]);
      setSelectedPresetId(created.id);
      setPresetDialog({ type: '', open: false });
      setPresetName('');
      toast(`Preset "${created.name}" criado.`, 'success');
    } catch (err) { toast(err.message, 'error'); }
  }

  async function handleRenamePreset() {
    const sel = presets.find((p) => p.id === selectedPresetId);
    if (!sel || !presetName.trim()) return;
    try {
      const updated = await updatePreset(sel.id, { name: presetName.trim() });
      setPresets((p) => p.map((x) => (x.id === updated.id ? updated : x)));
      setPresetDialog({ type: '', open: false });
      setPresetName('');
      toast(`Preset renomeado para "${updated.name}".`);
    } catch (err) { toast(err.message, 'error'); }
  }

  async function handleSavePresetStyle() {
    const sel = presets.find((p) => p.id === selectedPresetId);
    if (!sel) return;
    try {
      const updated = await updatePreset(sel.id, { style: subtitleStyle });
      setPresets((p) => p.map((x) => (x.id === updated.id ? updated : x)));
      toast(`Preset "${updated.name}" salvo.`, 'success');
    } catch (err) { toast(err.message, 'error'); }
  }

  async function handleDeletePreset() {
    const sel = presets.find((p) => p.id === selectedPresetId);
    if (!sel) return;
    try {
      await deletePreset(sel.id);
      const rest = presets.filter((p) => p.id !== sel.id);
      setPresets(rest);
      if (rest[0]) { setSelectedPresetId(rest[0].id); setSubtitleStyle({ ...DEFAULT_SUBTITLE_STYLE, ...rest[0].style }); }
      else setSelectedPresetId('');
      toast(`Preset "${sel.name}" excluído.`);
    } catch (err) { toast(err.message, 'error'); }
  }

  function updateSubtitle(index, patch) {
    setSubtitles((prev) => prev.map((item, i) => {
      if (i !== index) return item;
      return { ...item, ...patch };
    }));
  }

  function shiftSubtitles(seconds) {
    setSubtitles((prev) => prev.map((item) => ({
      ...item,
      start: Math.max(0, round(item.start + seconds)),
      end: Math.max(0.05, round(item.end + seconds)),
    })));
    toast(`Deslocamento de ${seconds > 0 ? '+' : ''}${seconds.toFixed(2)}s aplicado.`);
  }

  const handleKeyboardShortcuts = useEffectEvent((e) => {
    const t = e.target;
    if (t instanceof HTMLElement && (t.isContentEditable || ['INPUT','TEXTAREA','SELECT'].includes(t.tagName))) return;
    if (!videoRef.current || !videoReady) return;
    if (e.code === 'Space' || e.key.toLowerCase() === 'k') { e.preventDefault(); togglePlayback(); return; }
    if (e.key.toLowerCase() === 'j') { seekBy(-10); return; }
    if (e.key.toLowerCase() === 'l') { seekBy(10); return; }
    if (e.key === 'ArrowLeft') { seekBy(-5); return; }
    if (e.key === 'ArrowRight') { seekBy(5); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); updateVolume(clamp(volume + 0.05, 0, 1)); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); updateVolume(clamp(volume - 0.05, 0, 1)); return; }
    if (e.key.toLowerCase() === 'm') { toggleMute(); return; }
    if (e.key.toLowerCase() === 'f') previewRef.current?.requestFullscreen?.();
  });

  useEffect(() => {
    window.addEventListener('keydown', handleKeyboardShortcuts);
    return () => window.removeEventListener('keydown', handleKeyboardShortcuts);
  }, [handleKeyboardShortcuts]);

  function togglePlayback() {
    const v = videoRef.current;
    if (!v) return;
    v.paused ? v.play() : v.pause();
  }

  function seekBy(delta) {
    if (!videoRef.current) return;
    videoRef.current.currentTime = clamp(videoRef.current.currentTime + delta, 0, duration || 0);
  }

  function seekTo(time) {
    if (!videoRef.current) return;
    videoRef.current.currentTime = clamp(time, 0, duration || 0);
  }

  function updateVolume(v) {
    setVolume(v); setMuted(v === 0);
    if (videoRef.current) { videoRef.current.volume = v; videoRef.current.muted = v === 0; }
  }

  function toggleMute() {
    const next = !muted; setMuted(next);
    if (videoRef.current) videoRef.current.muted = next;
  }

  function scheduleControlsHide(delay = 1100) {
    window.clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = window.setTimeout(() => setControlsVisible(false), delay);
  }

  function revealControls(delay = 1100) {
    setControlsVisible(true);
    scheduleControlsHide(delay);
  }

  const subtitlePreviewStyle = buildPreviewStyle(subtitleStyle);
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const canExport = videoReady && subtitles.length > 0;
  const isExporting = Boolean(exportingMode);
  const isVerticalVideo = videoDimensions.height > videoDimensions.width && videoDimensions.width > 0;
  const videoAspectRatio = (videoDimensions.width > 0 && videoDimensions.height > 0)
    ? videoDimensions.width / videoDimensions.height
    : 16 / 9;
  const videoStageSize = useMemo(
    () => fitAspectRatio(surfaceBounds.width, surfaceBounds.height, videoAspectRatio),
    [surfaceBounds.height, surfaceBounds.width, videoAspectRatio],
  );
  const videoStageStyle = videoReady
    ? {
        width: `${Math.max(videoStageSize.width, 0)}px`,
        height: `${Math.max(videoStageSize.height, 0)}px`,
      }
    : undefined;

  return (
    <div className="studio-shell">

      {/* ═══════════════════════════════════════════
          SIDEBAR
      ═══════════════════════════════════════════ */}
      <aside className="studio-sidebar">

        {/* ── BRAND BAR ── */}
        <div className="studio-brand">
          <div className="studio-brand__mark">
            <Subtitles size={18} />
          </div>
          <div className="studio-brand__text">
            <p className="studio-brand__eyebrow">Estúdio de Legendas</p>
            <h1 className="studio-brand__title">StudioCut</h1>
          </div>

          {/* Export dropdown right after logo */}
          <div className="export-dropdown" style={{ marginLeft: 'auto', position: 'relative' }}>
            <button
              type="button"
              className={cn('export-trigger', isExporting && 'export-trigger--busy')}
              onClick={() => setExportOpen((o) => !o)}
              disabled={isExporting}
              title="Exportar"
            >
              {isExporting
                ? <Loader2 size={14} className="animate-spin" />
                : <Download size={14} />
              }
              <span>Exportar</span>
              <ChevronDown size={12} className={cn('export-trigger__chevron', exportOpen && 'export-trigger__chevron--open')} />
            </button>

            {exportOpen && (
              <div className="export-menu">
                <button
                  type="button"
                  className={cn('export-menu__item export-menu__item--primary', !canExport && 'export-menu__item--disabled')}
                  disabled={!canExport}
                  onClick={() => handleExport('burned-video')}
                >
                  <div className="export-menu__icon"><Video size={14} /></div>
                  <div>
                    <div className="export-menu__label">Legenda embutida</div>
                    <div className="export-menu__sub">Legendas gravadas no vídeo</div>
                  </div>
                </button>
                <button
                  type="button"
                  className={cn('export-menu__item', subtitles.length === 0 && 'export-menu__item--disabled')}
                  disabled={subtitles.length === 0}
                  onClick={() => handleExport('srt-only')}
                >
                  <div className="export-menu__icon"><Download size={14} /></div>
                  <div>
                    <div className="export-menu__label">Apenas arquivo .srt</div>
                    <div className="export-menu__sub">Somente o arquivo de legenda</div>
                  </div>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── SCROLLABLE CONTENT ── */}
        <div className="sidebar-scroll">
          <div className="sidebar-stack">

            {/* ── TRANSCRIPTION ── */}
            <SidebarSection icon={<Mic size={15} />} title="Transcrição" desc="Importe e regenere legendas em um só lugar.">
              <div className="two-col">
                <Field label="Modelo">
                  <Select value={subtitleForm.model} onValueChange={(v) => setSubtitleForm((p) => ({ ...p, model: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {WHISPER_MODELS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Idioma">
                  <Input value={subtitleForm.language} onChange={(e) => setSubtitleForm((p) => ({ ...p, language: e.target.value }))} placeholder="pt" />
                </Field>
              </div>
              {videoFile && (
                <div className="file-chip">
                  <div className="file-chip__icon"><Video size={13} /></div>
                  <div className="file-chip__info">
                    <p className="file-chip__name" title={videoFile.originalName}>{videoFile.originalName}</p>
                    <div className="file-chip__meta">
                      {videoInfo?.video?.width && <span>{videoInfo.video.width}×{videoInfo.video.height}</span>}
                      <span>{formatDuration(videoInfo?.duration || 0)}</span>
                      <span>{subtitles.length} legendas</span>
                    </div>
                  </div>
                </div>
              )}
              <button type="button" className="regen-btn" disabled={!videoReady || regenerating} onClick={handleRegenerate}>
                {regenerating ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                Regenerar legendas
              </button>
            </SidebarSection>

            {/* ── SUBTITLE STYLE ── */}
            <SidebarSection icon={<Subtitles size={15} />} title="Estilo da legenda" desc="Escolha e personalize um preset de estilo.">
              <div className="preset-grid">
                {presets.length > 0 ? (
                  presets.map((preset) => {
                    const preview = buildPresetCardPreviewStyle(preset.style);
                    return (
                      <button
                        key={preset.id} type="button"
                        className={cn('preset-card', selectedPresetId === preset.id && 'preset-card--active')}
                        onClick={() => handlePresetSelect(preset)}
                      >
                        <div className="preset-card__frame">
                          <div className="preset-card__frame-glow" />
                          <div style={preview.anchor}>
                            <div style={preview.box}>
                              <span style={preview.text}>{preset.name}</span>
                            </div>
                          </div>
                        </div>
                        <span className="preset-card__name">{preset.name}</span>
                        <span className="preset-card__meta">{preset.style.fontName} · {preset.style.fontSize}px</span>
                        <span className="preset-card__desc">{presetStyleDesc(preset.style)}</span>
                      </button>
                    );
                  })
                ) : (
                  <div className="preset-empty">Nenhum preset disponível.</div>
                )}
              </div>

              <div className="action-row">
                <button type="button" className="action-btn" onClick={() => { setPresetDialog({ type: 'create', open: true }); setPresetName(''); }}>
                  <Plus size={13} /> Novo
                </button>
                <button type="button" className="action-btn" disabled={!selectedPresetId}
                  onClick={() => { const p = presets.find((x) => x.id === selectedPresetId); setPresetName(p?.name || ''); setPresetDialog({ type: 'rename', open: true }); }}>
                  <PencilLine size={13} /> Renomear
                </button>
                <button type="button" className="action-btn action-btn--danger"
                  disabled={!selectedPresetId || selectedPresetId === 'default'}
                  onClick={handleDeletePreset}>
                  <Trash2 size={13} /> Excluir
                </button>
              </div>

              {/* Edit Style accordion */}
              <div className="accordion">
                <button type="button" className="accordion__trigger" onClick={() => setAccordionOpen((o) => !o)}>
                  <span>Editar estilo</span>
                  <ChevronDown size={14} className={cn('accordion__chevron', accordionOpen && 'accordion__chevron--open')} />
                </button>
                {accordionOpen && (
                  <div className="accordion__body">
                    <div className="two-col">
                      <Field label="Fonte"><Input value={subtitleStyle.fontName} onChange={(e) => setSubtitleStyle((p) => ({ ...p, fontName: e.target.value }))} /></Field>
                      <Field label="Tamanho"><Input type="number" value={subtitleStyle.fontSize} onChange={(e) => setSubtitleStyle((p) => ({ ...p, fontSize: Number(e.target.value) || 1 }))} /></Field>
                      <Field label="Cor"><ColorPicker value={subtitleStyle.primaryColor} onChange={(v) => setSubtitleStyle((p) => ({ ...p, primaryColor: v }))} /></Field>
                      <Field label="Cor da borda"><ColorPicker value={subtitleStyle.outlineColor} onChange={(v) => setSubtitleStyle((p) => ({ ...p, outlineColor: v }))} /></Field>
                      <Field label="Borda"><Input type="number" value={subtitleStyle.outline} onChange={(e) => setSubtitleStyle((p) => ({ ...p, outline: Number(e.target.value) || 0 }))} /></Field>
                      <Field label="Sombra"><Input type="number" value={subtitleStyle.shadow} onChange={(e) => setSubtitleStyle((p) => ({ ...p, shadow: Number(e.target.value) || 0 }))} /></Field>
                      <Field label="Posição Y"><Input type="number" value={subtitleStyle.positionY} onChange={(e) => setSubtitleStyle((p) => ({ ...p, positionY: Number(e.target.value) || 0 }))} /></Field>
                      <Field label="Alinhamento">
                        <Select value={String(subtitleStyle.alignment)} onValueChange={(v) => setSubtitleStyle((p) => ({ ...p, alignment: Number(v) }))}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="1">Esquerda</SelectItem>
                            <SelectItem value="2">Centro</SelectItem>
                            <SelectItem value="3">Direita</SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field label="Cor do fundo"><ColorPicker value={subtitleStyle.backgroundColor} onChange={(v) => setSubtitleStyle((p) => ({ ...p, backgroundColor: v }))} /></Field>
                      <Field label="Opacidade do fundo"><Input type="number" step="0.05" min="0" max="1" value={subtitleStyle.backgroundOpacity} onChange={(e) => setSubtitleStyle((p) => ({ ...p, backgroundOpacity: Number(e.target.value) }))} /></Field>
                      <Field label="Raio do fundo"><Input type="number" value={subtitleStyle.backgroundBorderRadius} onChange={(e) => setSubtitleStyle((p) => ({ ...p, backgroundBorderRadius: Number(e.target.value) }))} /></Field>
                      <Field label="Borda do fundo"><Input type="number" value={subtitleStyle.backgroundBorderThickness} onChange={(e) => setSubtitleStyle((p) => ({ ...p, backgroundBorderThickness: Number(e.target.value) }))} /></Field>
                    </div>
                    <label className="bold-toggle">
                      <input type="checkbox" checked={subtitleStyle.bold} onChange={(e) => setSubtitleStyle((p) => ({ ...p, bold: e.target.checked }))} />
                      <span>Texto em negrito</span>
                    </label>
                    <button type="button" className="save-preset-btn" disabled={!selectedPresetId} onClick={handleSavePresetStyle}>
                      <Save size={13} /> Salvar no preset
                    </button>
                  </div>
                )}
              </div>
            </SidebarSection>


            {/* ── SUBTITLES LIST ── */}
            <SidebarSection
              icon={<Film size={15} />}
              title="Legendas"
              badge={subtitles.length > 0 ? subtitles.length : null}
              desc={null}
            >
              {subtitles.length === 0 ? (
                <div className="sub-empty">
                  <Subtitles size={28} style={{ color: '#cbd5e1' }} />
                  <p>Importe um vídeo para gerar legendas automaticamente.</p>
                </div>
              ) : (
                <div className="sub-list">
                  {subtitles.map((sub, i) => (
                    <article
                      key={`${sub.start}-${i}`}
                      ref={activeSubtitleIndex === i ? activeSubRef : null}
                      className={cn('sub-card', activeSubtitleIndex === i && 'sub-card--active')}
                    >
                      <div className="sub-card__header">
                        <span className="sub-card__index">#{i + 1}</span>
                        <span className="sub-card__time">{formatTime(sub.start)} → {formatTime(sub.end)}</span>
                        <button
                          type="button"
                          className="sub-card__play"
                          title="Pré-visualizar esta linha"
                          onClick={() => { if (videoRef.current) { videoRef.current.currentTime = sub.start; videoRef.current.play(); } }}
                        >
                          <Play size={11} style={{ fill: 'currentColor' }} />
                        </button>
                      </div>
                      <textarea
                        className="sub-textarea"
                        value={sub.text}
                        onChange={(e) => updateSubtitle(i, { text: e.target.value })}
                        rows={2}
                      />
                    </article>
                  ))}
                </div>
              )}
            </SidebarSection>

          </div>
        </div>
      </aside>

      {/* ═══════════════════════════════════════════
          MAIN PREVIEW
      ═══════════════════════════════════════════ */}
      <main ref={previewRef} className="studio-main">
        <input
          id="video-file-input"
          ref={fileInputRef}
          type="file"
          accept="video/*"
          className="hidden"
          disabled={uploading}
          onChange={(e) => {
            handleUpload(e.target.files?.[0]);
            e.target.value = '';
          }}
        />

        <div className={cn('preview-workspace', isVerticalVideo && 'preview-workspace--vertical')}>
          <div ref={videoSurfaceRef} className="video-surface">
            {videoReady ? (
              <div
                className="video-stage"
                style={videoStageStyle}
                onMouseMove={() => revealControls()}
                onMouseLeave={() => setControlsVisible(false)}
                onTouchStart={() => revealControls(1800)}
              >
                <video
                  ref={videoRef}
                  src={videoFile.path}
                  className="video-el"
                  playsInline preload="metadata"
                  onLoadedMetadata={(e) => {
                    setDuration(e.currentTarget.duration || videoInfo?.duration || 0);
                    setVideoDimensions({
                      width: e.currentTarget.videoWidth || Number(videoInfo?.video?.width) || 0,
                      height: e.currentTarget.videoHeight || Number(videoInfo?.video?.height) || 0,
                    });
                    e.currentTarget.volume = volume;
                    e.currentTarget.muted = muted;
                    revealControls(1400);
                  }}
                  onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                  onPlay={() => {
                    setIsPlaying(true);
                    scheduleControlsHide(900);
                  }}
                  onPause={() => {
                    setIsPlaying(false);
                    revealControls(1400);
                  }}
                />
                {activeSubtitle && (
                  <div className="sub-overlay">
                    <div style={subtitlePreviewStyle.anchor}>
                      <div style={subtitlePreviewStyle.box}>
                        <span style={subtitlePreviewStyle.text}>{activeSubtitle.text}</span>
                      </div>
                    </div>
                  </div>
                )}
                <div
                  className="player-overlay"
                  data-visible={controlsVisible}
                >
                  <div className="player-overlay__shade" />
                  <div className="player-overlay__center">
                    <button type="button" className="player-btn player-btn--transport" onClick={() => seekBy(-5)} disabled={!videoReady} title="Voltar 5 segundos">
                      <SkipBack size={22} />
                    </button>
                    <button type="button" className={cn('player-btn player-btn--play player-btn--transport-main', !videoReady && 'player-btn--disabled')} onClick={togglePlayback} disabled={!videoReady} title="Reproduzir/Pausar">
                      {isPlaying ? <Pause size={28} style={{ fill: 'currentColor' }} /> : <Play size={28} style={{ fill: 'currentColor' }} />}
                    </button>
                    <button type="button" className="player-btn player-btn--transport" onClick={() => seekBy(5)} disabled={!videoReady} title="Avançar 5 segundos">
                      <SkipForward size={22} />
                    </button>
                  </div>

                  <div className="player-bottom">
                    <div className="player-bottom__meta">
                      <span className="player-time">
                        {formatTime(currentTime)}<span style={{ opacity: 0.4, margin: '0 0.15em' }}>/</span>{formatTime(duration)}
                      </span>

                      <div className="player-vol">
                        <button type="button" className="player-btn player-btn--sm" onClick={toggleMute} title="Silenciar">
                          {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
                        </button>
                        <input type="range" className="vol-slider" min={0} max={1} step={0.05}
                          value={muted ? 0 : volume} onChange={(e) => updateVolume(Number(e.target.value))} aria-label="Volume" />
                      </div>
                    </div>

                    <div className="scrubber" onClick={videoReady ? (e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      seekTo(clamp((e.clientX - r.left) / r.width, 0, 1) * duration);
                    } : undefined}>
                      <div className="scrubber__track">
                        <div className="scrubber__fill" style={{ width: `${progress}%` }} />
                        <div className="scrubber__thumb" style={{ left: `${progress}%` }} />
                      </div>
                      <input type="range" className="scrubber__input" min={0} max={duration || 1} step={0.1}
                        value={currentTime} disabled={!videoReady}
                        onChange={(e) => seekTo(Number(e.target.value))} aria-label="Buscar" />
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <label
                htmlFor="video-file-input"
                className={cn('dropzone dropzone--player', isDragging && 'dropzone--over')}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                aria-disabled={uploading}
              >
                <div className="dropzone__icon">
                  {uploading ? <Loader2 size={22} className="animate-spin" /> : <Upload size={22} />}
                </div>
                <p className="dropzone__title">{uploading ? 'Importando e transcrevendo…' : 'Clique ou arraste o vídeo aqui'}</p>
                <p className="dropzone__sub">{uploading ? `Whisper ${subtitleForm.model} em execução…` : 'MP4, MOV, MKV, WebM'}</p>
              </label>
            )}
          </div>

          <section className="timing-panel">
            <div className="timing-panel__header">
              <div className="timing-panel__icon"><SkipForward size={15} /></div>
              <div>
                <div className="timing-panel__title">Sincronia</div>
                <p className="timing-panel__desc">Desloque todas as legendas para corrigir a sincronização.</p>
              </div>
            </div>

            <div className="offset-row">
              {[-1, -0.5, 0.5, 1].map((v) => (
                <button key={v} type="button"
                  className={cn('offset-chip', v < 0 && 'offset-chip--neg')}
                  disabled={subtitles.length === 0}
                  onClick={() => shiftSubtitles(v)}>
                  {v > 0 ? '+' : ''}{v}s
                </button>
              ))}
            </div>
            <div className="offset-custom">
              <Input value={offsetValue} onChange={(e) => setOffsetValue(e.target.value)} placeholder="ex.: 0.5" style={{ fontFamily: 'ui-monospace,monospace', fontSize: '0.8rem' }} />
              <button type="button" className="action-btn" disabled={subtitles.length === 0}
                onClick={() => { const n = Number(offsetValue); if (Number.isFinite(n)) shiftSubtitles(n); }}>
                Aplicar
              </button>
            </div>
          </section>
        </div>
      </main>

      {/* ── TOAST ── */}
      {notice && (
        <div className={cn('toast', notice.type === 'error' && 'toast--error', notice.type === 'success' && 'toast--success')}>
          {notice.type === 'success' && <CheckCircle2 size={14} />}
          {notice.type === 'error' && <XCircle size={14} />}
          {notice.msg}
        </div>
      )}

      {/* ── PRESET DIALOG ── */}
      <Dialog open={presetDialog.open} onOpenChange={(o) => setPresetDialog((p) => ({ ...p, open: o }))}>
        <DialogContent showClose>
          <DialogHeader>
            <DialogTitle>{presetDialog.type === 'create' ? 'Criar preset' : 'Renomear preset'}</DialogTitle>
            <DialogDescription>
              {presetDialog.type === 'create' ? 'O estilo atual será salvo como um novo preset.' : 'Atualize o nome do preset.'}
            </DialogDescription>
          </DialogHeader>
          <Field label="Nome do preset">
            <Input value={presetName} onChange={(e) => setPresetName(e.target.value)} autoFocus placeholder="Meu estilo"
              onKeyDown={(e) => { if (e.key === 'Enter') presetDialog.type === 'create' ? handleCreatePreset() : handleRenamePreset(); }} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPresetDialog({ type: '', open: false })}>Cancelar</Button>
            <Button onClick={presetDialog.type === 'create' ? handleCreatePreset : handleRenamePreset}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ─── Small helper components ─────────────────────────── */

function SidebarSection({ icon, title, desc, badge, children }) {
  return (
    <section className="sidebar-section">
      <div className="sidebar-section__header">
        <div className="sidebar-section__icon">{icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
            <span className="sidebar-section__title">{title}</span>
            {badge != null && <span className="sidebar-section__badge">{badge}</span>}
          </div>
          {desc && <p className="sidebar-section__desc">{desc}</p>}
        </div>
      </div>
      <div className="sidebar-section__body">{children}</div>
    </section>
  );
}

function Field({ label, children }) {
  return (
    <div className="field">
      <label className="field__label">{label}</label>
      {children}
    </div>
  );
}

function ColorPicker({ value, onChange }) {
  return (
    <div className="color-picker">
      <div className="color-picker__swatch" style={{ background: value }} />
      <span className="color-picker__hex">{value}</span>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="color-picker__input" />
    </div>
  );
}

/* ─── Pure helpers ────────────────────────────────────── */

function buildPreviewStyle(style) {
  const a = Number(style.alignment || 2);
  const jc = a === 1 ? 'flex-start' : a === 3 ? 'flex-end' : 'center';
  const bottomPct = 100 - clamp(Number(style.positionY || 84), 0, 100);
  return {
    anchor: {
      position: 'absolute',
      left: 0, right: 0,
      bottom: `${bottomPct}%`,
      display: 'flex',
      justifyContent: jc,
      paddingLeft: 'var(--subtitle-pad-x, 1rem)',
      paddingRight: 'var(--subtitle-pad-x, 1rem)',
      boxSizing: 'border-box',
    },
    box: {
      background: hexToRgba(style.backgroundColor, style.backgroundOpacity),
      borderColor: style.backgroundBorderColor,
      borderWidth: `${style.backgroundBorderThickness || 0}px`,
      borderStyle: 'solid',
      borderRadius: `${style.backgroundBorderRadius || 0}px`,
      padding: '0.45em 0.75em',
      maxWidth: '86%',
    },
    text: {
      color: style.primaryColor, fontFamily: style.fontName, fontSize: `${style.fontSize}px`,
      fontWeight: style.bold ? 700 : 500,
      textAlign: a === 1 ? 'left' : a === 3 ? 'right' : 'center',
      textShadow: `${style.outline || 0}px ${style.outline || 0}px 0 ${style.outlineColor}, 0 0 ${Math.max(0, Number(style.shadow || 0) * 6)}px rgba(0,0,0,.55)`,
      lineHeight: 1.2, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
    },
  };
}

function buildPresetCardPreviewStyle(style) {
  const previewStyle = buildPreviewStyle(style);
  const fontSize = clamp(Math.round(Number(style.fontSize || 28) * 0.38), 11, 18);
  return {
    anchor: {
      ...previewStyle.anchor,
      left: '8%',
      right: '8%',
      paddingLeft: 0,
      paddingRight: 0,
      bottom: `${100 - clamp(Number(style.positionY || 84), 0, 100)}%`,
    },
    box: {
      ...previewStyle.box,
      padding: '0.2em 0.45em',
      maxWidth: '100%',
    },
    text: {
      ...previewStyle.text,
      fontSize: `${fontSize}px`,
      lineHeight: 1.1,
    },
  };
}

function fitAspectRatio(maxWidth, maxHeight, ratio) {
  if (!maxWidth || !maxHeight || !ratio) return { width: 0, height: 0 };
  let width = maxWidth;
  let height = width / ratio;
  if (height > maxHeight) {
    height = maxHeight;
    width = height * ratio;
  }
  return {
    width: Math.floor(width),
    height: Math.floor(height),
  };
}

function presetStyleDesc(style) {
  const parts = [];
  parts.push(alignmentLabel(style.alignment));
  parts.push(`Y ${Math.round(Number(style.positionY || 84))}`);
  if (Number(style.outline) > 0) parts.push(`borda ${style.outline}`);
  if (Number(style.shadow) > 0) parts.push(`sombra ${style.shadow}`);
  if (style.bold) parts.push('negrito');
  if (Number(style.backgroundOpacity) > 0) parts.push('fundo');
  return parts.join(' · ');
}

function alignmentLabel(value) {
  const a = Number(value || 2);
  if (a === 1) return 'Esquerda';
  if (a === 3) return 'Direita';
  return 'Centro';
}

function hexToRgba(hex, opacity = 1) {
  const s = String(hex || '#000000').replace('#', '');
  const safe = s.length === 6 ? s : '000000';
  return `rgba(${parseInt(safe.slice(0,2),16)},${parseInt(safe.slice(2,4),16)},${parseInt(safe.slice(4,6),16)},${clamp(Number(opacity||0),0,1)})`;
}

function round(v) { return Math.round(v * 1000) / 1000; }

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}
