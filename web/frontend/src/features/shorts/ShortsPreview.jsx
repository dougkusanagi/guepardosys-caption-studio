import React, { useRef, useEffect, useState } from 'react';
import { Play, Pause, RefreshCw, Volume2, VolumeX, Palette, Sparkles, Loader2 } from 'lucide-react';
import { Card } from '../../components/ui/card.jsx';
import { Button } from '../../components/ui/button.jsx';
import { PresetSelector } from '../../components/preset-selector.jsx';

function formatClipTime(seconds) {
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${secs}.${ms}s`;
}

export default function ShortsPreview({ 
  videoSrc, 
  clip, 
  reframeMode = 'smart',
  baseUrl = '',
  subtitleStyle = {},
  onUpdateSubtitleStyle
}) {
  const videoRef = useRef(null);
  const bgVideoRef = useRef(null);

  const isDone = clip?.status === 'done';
  const resolvedVideoSrc = isDone 
    ? (clip.outputPath.startsWith('http') ? clip.outputPath : `${baseUrl}${clip.outputPath}`)
    : videoSrc;

  const startTime = isDone ? 0 : (clip?.start_sec || 0);
  const endTime = isDone ? (clip?.end_sec - clip?.start_sec || 10) : (clip?.end_sec || 10);

  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(true);
  const [progressPercent, setProgressPercent] = useState(0);

  // Local state for subtitle editing panel
  const [localStyle, setLocalStyle] = useState(subtitleStyle);

  // Sync local style when prop changes
  useEffect(() => {
    setLocalStyle(subtitleStyle);
  }, [subtitleStyle]);

  const updateStyleField = (key, value) => {
    setLocalStyle(prev => ({ ...prev, [key]: value }));
  };

  // Sync video source, volume, and active time range
  useEffect(() => {
    const video = videoRef.current;
    const bgVideo = bgVideoRef.current;
    if (!video) return;

    video.currentTime = startTime;
    if (bgVideo) bgVideo.currentTime = startTime;

    video.muted = isMuted;
    if (bgVideo) bgVideo.muted = true; // Background loop is always silent

    if (isPlaying) {
      const playPromise = video.play();
      if (playPromise !== undefined) {
        playPromise.catch((err) => {
          console.debug('Playback prevented by browser autoplay policies', err);
          setIsPlaying(false);
        });
      }
      bgVideo?.play().catch(() => {});
    } else {
      video.pause();
      bgVideo?.pause();
    }
  }, [resolvedVideoSrc, startTime, endTime]);

  // Synchronize loops and progress percentage
  const handleTimeUpdate = () => {
    const video = videoRef.current;
    const bgVideo = bgVideoRef.current;
    if (!video) return;

    const elapsed = video.currentTime - startTime;
    const duration = endTime - startTime;
    if (duration > 0) {
      setProgressPercent((elapsed / duration) * 100);
    }

    if (video.currentTime >= endTime || video.currentTime < startTime) {
      video.currentTime = startTime;
      if (bgVideo) bgVideo.currentTime = startTime;
    }
  };

  // Toggle play/pause
  const handleTogglePlay = () => {
    const video = videoRef.current;
    const bgVideo = bgVideoRef.current;
    if (!video) return;

    if (video.paused) {
      video.play().catch((err) => console.debug(err));
      bgVideo?.play().catch(() => {});
      setIsPlaying(true);
    } else {
      video.pause();
      bgVideo?.pause();
      setIsPlaying(false);
    }
  };

  // Toggle volume mute
  const handleToggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setIsMuted(video.muted);
  };

  // Click on progress bar to seek within the clip
  const handleProgressBarClick = (e) => {
    const video = videoRef.current;
    const bgVideo = bgVideoRef.current;
    if (!video) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const width = rect.width;
    const percent = clickX / width;
    const clipDuration = endTime - startTime;
    const targetTime = startTime + (percent * clipDuration);
    
    video.currentTime = targetTime;
    if (bgVideo) bgVideo.currentTime = targetTime;
    
    setProgressPercent(percent * 100);
  };

  // Safe classes for reframing preview modes in CSS
  let containerClass = "relative overflow-hidden w-full max-w-[270px] aspect-[9/16] bg-black rounded-2xl border-4 border-surface-900/10 shadow-2xl flex items-center justify-center";
  let videoClass = "absolute h-full max-w-none transition-all duration-300";

  if (isDone) {
    // Rendered output is already cropped to 9:16 vertical! No styling trick needed.
    videoClass = "absolute w-full h-full object-cover rounded-xl";
  } else {
    if (reframeMode === 'center' || reframeMode === 'smart') {
      videoClass += " w-auto object-cover min-w-full";
    } else if (reframeMode === 'blur') {
      videoClass += " w-full h-auto object-contain z-10";
    }
  }

  const elapsedSeconds = videoRef.current ? Math.max(0, videoRef.current.currentTime - startTime) : 0;

  return (
    <div className="flex flex-col items-center gap-4 w-full">
      {/* 9:16 vertical video viewport */}
      <div className={containerClass}>
        
        {/* Double video layer for real blur background */}
        {!isDone && reframeMode === 'blur' && (
          <video
            ref={bgVideoRef}
            src={resolvedVideoSrc}
            muted
            loop
            className="absolute w-full h-full object-cover filter blur-md opacity-40 scale-105"
            style={{ pointerEvents: 'none' }}
          />
        )}

        {/* Primary Video Element */}
        {resolvedVideoSrc ? (
          <video
            ref={videoRef}
            src={resolvedVideoSrc}
            className={videoClass}
            onTimeUpdate={handleTimeUpdate}
            playsInline
            loop
            muted={isMuted}
          />
        ) : (
          <div className="text-center text-xs text-surface-400 p-4">
            Carregando preview...
          </div>
        )}

        {/* Video Overlay Info */}
        <div className="absolute bottom-3 left-3 right-3 bg-black/40 backdrop-blur-sm px-2.5 py-1.5 rounded-lg z-20 text-[10px] text-white flex items-center justify-between">
          <span className="font-semibold uppercase tracking-wider text-[8px] bg-primary-600 px-1.5 py-0.5 rounded-md flex items-center gap-1">
            {isDone ? 'Preview Real' : 'Preview Rascunho'}
          </span>
          <span className="font-mono">
            {Math.round(endTime - startTime)}s
          </span>
        </div>
      </div>
      
      {/* Controls Bar */}
      <div className="w-full max-w-[270px] bg-white border border-surface-200 rounded-xl p-3 shadow-sm flex flex-col gap-2.5">
        
        {/* Progress Bar Slider */}
        <div 
          className="relative h-1.5 w-full bg-surface-100 rounded-full cursor-pointer overflow-hidden group"
          onClick={handleProgressBarClick}
        >
          <div 
            className="absolute top-0 left-0 h-full bg-primary-600 rounded-full group-hover:bg-primary-500 transition-all duration-75"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Action Controls */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            {/* Play/Pause Button */}
            <button
              onClick={handleTogglePlay}
              className="w-7 h-7 rounded-lg hover:bg-surface-100 flex items-center justify-center text-surface-700 transition-colors"
            >
              {isPlaying ? (
                <Pause className="w-3.5 h-3.5 fill-current" />
              ) : (
                <Play className="w-3.5 h-3.5 fill-current" />
              )}
            </button>
            
            {/* Restart Button */}
            <button
              onClick={() => {
                if (videoRef.current) {
                  videoRef.current.currentTime = startTime;
                  if (bgVideoRef.current) bgVideoRef.current.currentTime = startTime;
                  videoRef.current.play().catch(() => {});
                  bgVideoRef.current?.play().catch(() => {});
                  setIsPlaying(true);
                }
              }}
              className="w-7 h-7 rounded-lg hover:bg-surface-100 flex items-center justify-center text-surface-600 transition-colors"
              title="Reiniciar Clipe"
            >
              <RefreshCw className="w-3 h-3" />
            </button>
          </div>

          {/* Time Display */}
          <span className="text-[10px] font-mono text-surface-500">
            {formatClipTime(elapsedSeconds)} / {formatClipTime(endTime - startTime)}
          </span>

          {/* Mute/Volume Button */}
          <button
            onClick={handleToggleMute}
            className={`w-7 h-7 rounded-lg hover:bg-surface-100 flex items-center justify-center transition-colors ${
              isMuted ? 'text-surface-450' : 'text-primary-600 bg-primary-50'
            }`}
          >
            {isMuted ? (
              <VolumeX className="w-4.5 h-4.5" />
            ) : (
              <Volume2 className="w-4.5 h-4.5" />
            )}
          </button>
        </div>
      </div>

      <p className="text-xs text-surface-400 text-center max-w-[240px] mb-2">
        {isDone
          ? 'Legendas e silêncios aplicados perfeitamente ao vídeo.'
          : reframeMode === 'smart' 
            ? 'Visualização temporária (Remoção de silêncios pendente)'
            : reframeMode === 'blur'
              ? 'Vídeo centralizado com fundo desfocado'
              : 'Vídeo centralizado (corte estático)'
        }
      </p>

      {/* Subtitle Style Editor Panel */}
      <div className="w-full max-w-[270px] bg-white border border-surface-200 rounded-xl p-4 shadow-sm space-y-4 text-left">
        <h4 className="text-xs font-bold uppercase tracking-wider text-surface-700 flex items-center gap-1.5">
          <Palette className="w-3.5 h-3.5 text-primary-500" />
          Estilo das Legendas
        </h4>
        
        {/* Preset Selector */}
        <div className="space-y-1">
          <label className="text-[10px] font-semibold text-surface-500 block">Presets de Legenda</label>
          <PresetSelector 
            currentStyle={localStyle}
            onStyleChange={(newPresetStyle) => setLocalStyle(prev => ({ ...prev, ...newPresetStyle }))}
          />
        </div>

        {/* Font & Size */}
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className="text-[10px] font-semibold text-surface-500 block">Fonte</label>
            <select
              value={localStyle.fontName || 'Arial'}
              onChange={(e) => updateStyleField('fontName', e.target.value)}
              className="w-full h-8 rounded-lg border border-surface-200 bg-white text-xs px-1 focus:outline-none"
            >
              {['Arial', 'Roboto', 'Inter', 'Montserrat', 'Open Sans'].map(f => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-semibold text-surface-500 block">Tamanho</label>
            <input
              type="number"
              value={localStyle.fontSize || 24}
              onChange={(e) => updateStyleField('fontSize', parseInt(e.target.value, 10) || 24)}
              className="w-full h-8 rounded-lg border border-surface-200 bg-white text-xs px-2 focus:outline-none"
            />
          </div>
        </div>

        {/* Colors */}
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className="text-[10px] font-semibold text-surface-500 block">Texto</label>
            <input
              type="color"
              value={localStyle.primaryColor || '#ffffff'}
              onChange={(e) => updateStyleField('primaryColor', e.target.value)}
              className="w-full h-8 rounded-lg border border-surface-200 bg-white p-1 cursor-pointer focus:outline-none"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-semibold text-surface-500 block">Contorno</label>
            <input
              type="color"
              value={localStyle.outlineColor || '#000000'}
              onChange={(e) => updateStyleField('outlineColor', e.target.value)}
              className="w-full h-8 rounded-lg border border-surface-200 bg-white p-1 cursor-pointer focus:outline-none"
            />
          </div>
        </div>

        {/* Vertical Position */}
        <div className="space-y-1">
          <label className="text-[10px] font-semibold text-surface-500 block">Posição Vertical ({localStyle.positionY || 75}%)</label>
          <input
            type="range"
            min="10"
            max="95"
            value={localStyle.positionY || 75}
            onChange={(e) => updateStyleField('positionY', parseInt(e.target.value, 10))}
            className="w-full accent-primary-600 cursor-pointer h-1 bg-surface-200 rounded-lg appearance-none"
          />
        </div>

        {/* Contour & Shadow */}
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className="text-[10px] font-semibold text-surface-500 block">Contorno</label>
            <input
              type="number"
              value={localStyle.outline !== undefined ? localStyle.outline : 2}
              onChange={(e) => updateStyleField('outline', parseInt(e.target.value, 10) || 0)}
              className="w-full h-8 rounded-lg border border-surface-200 bg-white text-xs px-2 focus:outline-none"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-semibold text-surface-500 block">Sombra</label>
            <input
              type="number"
              value={localStyle.shadow !== undefined ? localStyle.shadow : 1}
              onChange={(e) => updateStyleField('shadow', parseInt(e.target.value, 10) || 0)}
              className="w-full h-8 rounded-lg border border-surface-200 bg-white text-xs px-2 focus:outline-none"
            />
          </div>
        </div>

        {/* Toggles */}
        <div className="flex flex-col gap-2 pt-1">
          <label className="flex items-center gap-2 text-xs font-semibold text-surface-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={!!localStyle.bold}
              onChange={(e) => updateStyleField('bold', e.target.checked)}
              className="rounded border-surface-300 text-primary-600 focus:ring-primary-500 h-3.5 w-3.5 cursor-pointer"
            />
            Negrito
          </label>
          <label className="flex items-center gap-2 text-xs font-semibold text-surface-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={!!localStyle.highlightWords}
              onChange={(e) => updateStyleField('highlightWords', e.target.checked)}
              className="rounded border-surface-300 text-primary-600 focus:ring-primary-500 h-3.5 w-3.5 cursor-pointer"
            />
            Destacar Palavras
          </label>
        </div>

        {localStyle.highlightWords && (
          <div className="space-y-1">
            <label className="text-[10px] font-semibold text-surface-500 block">Cor do Destaque</label>
            <input
              type="color"
              value={localStyle.highlightColor || '#facc15'}
              onChange={(e) => updateStyleField('highlightColor', e.target.value)}
              className="w-full h-8 rounded-lg border border-surface-200 bg-white p-1 cursor-pointer focus:outline-none"
            />
          </div>
        )}

        <Button
          onClick={() => onUpdateSubtitleStyle(localStyle)}
          className="w-full py-2.5 mt-2 bg-indigo-650 hover:bg-indigo-750 text-white font-bold rounded-xl flex items-center justify-center gap-1.5 text-xs shadow-md border-none"
        >
          <Sparkles className="w-3.5 h-3.5" />
          Aplicar Novo Estilo
        </Button>
      </div>
    </div>
  );
}
