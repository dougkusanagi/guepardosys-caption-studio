import React, { useState, useEffect } from 'react';
import { Sparkles, Sliders, ArrowLeft, ArrowRight, Loader2, CheckCircle2, AlertTriangle, Play, RefreshCw, Undo2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card.jsx';
import { Button } from '../../components/ui/button.jsx';
import { Progress } from '../../components/ui/progress.jsx';

import ShortsConfigPanel from './ShortsConfigPanel.jsx';
import ShortsClipList from './ShortsClipList.jsx';
import ShortsPreview from './ShortsPreview.jsx';

import { analyzeShorts, getShortsStatus, exportShort } from '../../lib/api.js';

export default function ShortsWizard({ 
  projectId, 
  filename, 
  videoPath, 
  clientId,
  shortsProgress,
  onGoBack 
}) {
  const [step, setStep] = useState('config'); // config | analyzing | review
  const [config, setConfig] = useState({
    clipCount: 3,
    targetDuration: 30.0,
    language: 'pt',
    reframeMode: 'smart'
  });
  
  const [jobId, setJobId] = useState(null);
  const [clips, setClips] = useState([]);
  const [selectedClips, setSelectedClips] = useState(new Set());
  const [activePreviewClip, setActivePreviewClip] = useState(null);
  const [exportingClipId, setExportingClipId] = useState(null);
  
  const [error, setError] = useState(null);
  const [localProgress, setLocalProgress] = useState({ percent: 0, message: '' });

  // 1. Monitor WebSocket progress updates
  useEffect(() => {
    if (!shortsProgress || step !== 'analyzing') return;

    setLocalProgress({
      percent: shortsProgress.progress ?? 0,
      message: shortsProgress.message || 'Processando...'
    });

    if (shortsProgress.stage === 'shorts:done') {
      fetchClips();
    } else if (shortsProgress.stage === 'shorts:error') {
      setError(shortsProgress.message || 'A análise do vídeo falhou.');
      setStep('config');
    }
  }, [shortsProgress]);

  // 2. Poll fallback if WebSocket isn't updating or when entering analyzing stage
  useEffect(() => {
    if (step !== 'analyzing' || !jobId) return;

    let attempts = 0;
    const interval = setInterval(async () => {
      try {
        const status = await getShortsStatus(projectId, jobId);
        
        if (status.job) {
          const statusStr = status.job.status;
          
          if (statusStr === 'ready') {
            clearInterval(interval);
            setClips(status.clips);
            if (status.clips && status.clips.length > 0) {
              setActivePreviewClip(status.clips[0]);
              // Select all by default
              setSelectedClips(new Set(status.clips.map(c => c.id)));
            }
            setStep('review');
          } else if (statusStr === 'error') {
            clearInterval(interval);
            setError('Ocorreu um erro no processamento do vídeo.');
            setStep('config');
          }
        }
      } catch (err) {
        console.error('Error polling status:', err);
        attempts++;
        if (attempts > 15) {
          clearInterval(interval);
          setError('Conexão perdida com o servidor.');
          setStep('config');
        }
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [step, jobId, projectId]);

  // Fetch clips from status endpoint
  const fetchClips = async () => {
    try {
      const status = await getShortsStatus(projectId, jobId);
      if (status.clips) {
        setClips(status.clips);
        if (status.clips.length > 0) {
          setActivePreviewClip(status.clips[0]);
          setSelectedClips(new Set(status.clips.map(c => c.id)));
        }
        setStep('review');
      }
    } catch (err) {
      console.error('Failed to fetch clips:', err);
    }
  };

  // Start the analysis job
  const handleStartAnalysis = async () => {
    setError(null);
    setLocalProgress({ percent: 0, message: 'Iniciando pipeline no servidor...' });
    
    try {
      const res = await analyzeShorts({
        projectId,
        filename,
        clientId,
        ...config
      });
      setJobId(res.jobId);
      setStep('analyzing');
    } catch (err) {
      setError(err.message || 'Erro ao iniciar análise.');
    }
  };

  // Toggle selection checkbox for clips
  const handleToggleSelect = (clipId) => {
    const next = new Set(selectedClips);
    if (next.has(clipId)) {
      next.delete(clipId);
    } else {
      next.add(clipId);
    }
    setSelectedClips(next);
  };

  // Single clip export action
  const handleExportClip = async (clip) => {
    setExportingClipId(clip.id);
    try {
      const res = await exportShort({
        projectId,
        jobId,
        clipId: clip.id
      });
      alert(`Exportação iniciada para: Short #${clip.index + 1}. Os arquivos finais serão salvos na pasta processados.`);
    } catch (err) {
      alert(`Falha na exportação: ${err.message}`);
    } finally {
      setExportingClipId(null);
    }
  };

  return (
    <div className="w-full max-w-7xl mx-auto px-4 py-8">
      {/* Top Navigation */}
      <div className="flex items-center justify-between mb-8">
        <Button 
          variant="outline" 
          size="sm" 
          onClick={onGoBack}
          className="flex items-center gap-1.5 text-surface-600 hover:text-surface-900 border-surface-200"
        >
          <ArrowLeft className="w-4 h-4" />
          Voltar para Home
        </Button>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold px-2.5 py-1 bg-indigo-50 border border-indigo-100 text-indigo-700 rounded-full flex items-center gap-1">
            <Sparkles className="w-3 h-3" />
            Módulo Shorts IA v1.0 (Beta)
          </span>
        </div>
      </div>

      {error && (
        <Card className="mb-6 border-red-200 bg-red-50/50">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="text-sm font-semibold text-red-900">Erro no Processamento</h4>
              <p className="text-xs text-red-700 mt-1">{error}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* --- step: Configuração --- */}
      {step === 'config' && (
        <div className="py-6">
          <ShortsConfigPanel 
            config={config} 
            onChange={setConfig} 
            onStart={handleStartAnalysis} 
          />
        </div>
      )}

      {/* --- step: Analisando --- */}
      {step === 'analyzing' && (
        <Card className="w-full max-w-lg mx-auto border-surface-200/80 shadow-xl p-8 text-center bg-white">
          <CardHeader className="p-0 mb-6">
            <div className="relative w-16 h-16 mx-auto mb-4 flex items-center justify-center">
              <Loader2 className="w-16 h-16 text-primary-500 animate-spin absolute" />
              <Sparkles className="w-6 h-6 text-indigo-600 animate-pulse" />
            </div>
            <CardTitle className="text-xl font-bold text-surface-900">Processando Vídeo com IA</CardTitle>
            <CardDescription className="text-sm text-surface-500">
              Nosso pipeline local está analisando áudio, falas, cenas e movimento. Isso pode levar alguns minutos.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0 space-y-6">
            <div className="space-y-2">
              <div className="flex justify-between text-xs font-semibold text-surface-600">
                <span>{localProgress.message || 'Analisando vídeo...'}</span>
                <span className="font-mono text-primary-600">{localProgress.percent}%</span>
              </div>
              <Progress value={localProgress.percent} className="h-2" />
            </div>

            <div className="rounded-xl bg-surface-50 p-4 text-left border border-surface-100">
              <h5 className="text-xs font-semibold text-surface-700 mb-2">Fases do Pipeline:</h5>
              <ul className="text-[10px] text-surface-500 space-y-1.5 font-mono">
                <li className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 fill-emerald-50" /> Transcrição Speech-to-Text (Whisper)
                </li>
                <li className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 fill-emerald-50" /> Detecção de Silêncios (VAD)
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="w-3.5 h-3.5 rounded-full border border-primary-500 border-t-transparent animate-spin" /> Análise Visual (Cenas, YOLO & Tracking)
                </li>
                <li className="flex items-center gap-1.5 opacity-50">
                  <span className="w-3.5 h-3.5 rounded-full border border-surface-300" /> Seleção dos Melhores Clipes
                </li>
              </ul>
            </div>
          </CardContent>
        </Card>
      )}

      {/* --- step: Revisão (Review) --- */}
      {step === 'review' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left panel: clips list & details */}
          <div className="lg:col-span-7 space-y-6">
            <Card className="border-surface-200/80 shadow-md">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg font-bold text-surface-900">Análise Completa!</CardTitle>
                <CardDescription className="text-xs text-surface-500">
                  A IA encontrou os momentos mais relevantes do seu vídeo baseado em dinamismo de fala e movimento de cena.
                </CardDescription>
              </CardHeader>
              <CardContent className="px-6 pb-6">
                <ShortsClipList 
                  clips={clips}
                  selectedClips={selectedClips}
                  onToggleSelect={handleToggleSelect}
                  activePreviewId={activePreviewClip?.id}
                  onSelectPreview={setActivePreviewClip}
                  onExportClip={handleExportClip}
                  exportingClipId={exportingClipId}
                />
              </CardContent>
            </Card>
          </div>

          {/* Right panel: vertical 9:16 loop preview */}
          <div className="lg:col-span-5 flex flex-col items-center justify-center">
            <Card className="w-full border-surface-200/80 shadow-md bg-surface-50 p-6 flex flex-col items-center">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-surface-500 mb-4">
                Pré-visualização do Corte
              </h4>
              
              <ShortsPreview 
                videoSrc={videoPath}
                clip={activePreviewClip}
                reframeMode={config.reframeMode}
              />
              
              {selectedClips.size > 0 && (
                <Button
                  onClick={async () => {
                    alert(`Exportação em lote iniciada para ${selectedClips.size} clipes.`);
                  }}
                  className="w-full mt-6 py-5 bg-gradient-to-r from-primary-600 to-indigo-600 hover:from-primary-700 hover:to-indigo-700 text-white font-semibold rounded-xl"
                >
                  Exportar Selecionados ({selectedClips.size})
                </Button>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
