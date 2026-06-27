import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, Sliders, ArrowLeft, ArrowRight, Loader2, CheckCircle2, AlertTriangle, Play, RefreshCw, Undo2, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card.jsx';
import { Button } from '../../components/ui/button.jsx';
import { Progress } from '../../components/ui/progress.jsx';

import ShortsConfigPanel from './ShortsConfigPanel.jsx';
import ShortsClipList from './ShortsClipList.jsx';
import ShortsPreview from './ShortsPreview.jsx';

import { analyzeShorts, getShortsStatus, exportShort, cancelShorts } from '../../lib/api.js';

export default function ShortsWizard({ 
  projectId, 
  filename, 
  videoPath, 
  clientId,
  shortsProgress,
  onGoBack,
  initialConfig,
  autoStart,
  onResetAutoStart
}) {
  const [step, setStep] = useState('config'); // config | analyzing | review
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState(initialConfig || {
    clipCount: 3,
    targetDuration: 30.0,
    language: 'pt',
    reframeMode: 'smart',
    whisperModel: 'small',
    breathPadding: 0.1
  });
  
  const [jobId, setJobId] = useState(null);
  const [clips, setClips] = useState([]);
  const [selectedClips, setSelectedClips] = useState(new Set());
  const [activePreviewClip, setActivePreviewClip] = useState(null);
  const [exportingClipId, setExportingClipId] = useState(null);
  
  const [error, setError] = useState(null);
  const [localProgress, setLocalProgress] = useState({ percent: 0, message: '', stage: '' });
  
  // System logs terminal states
  const [logs, setLogs] = useState([]);
  const [showLogs, setShowLogs] = useState(false);
  const logEndRef = useRef(null);

  // Auto-scroll logs terminal
  useEffect(() => {
    if (showLogs && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, showLogs]);

  // 1. Monitor WebSocket progress updates
  useEffect(() => {
    if (!shortsProgress || step !== 'analyzing') return;

    setLocalProgress({
      percent: shortsProgress.progress ?? 0,
      message: shortsProgress.message || 'Processando...',
      stage: shortsProgress.stage || ''
    });

    if (shortsProgress.message) {
      setLogs((prev) => {
        // Avoid adding the exact same last message
        if (prev.length > 0 && prev[prev.length - 1].includes(shortsProgress.message)) {
          return prev;
        }
        const timestamp = new Date().toLocaleTimeString('pt-BR', { hour12: false });
        return [...prev, `[${timestamp}] ${shortsProgress.message}`];
      });
    }

    if (shortsProgress.stage === 'shorts:done') {
      fetchClips();
    } else if (shortsProgress.stage === 'shorts:error') {
      setError(shortsProgress.message || 'A análise do vídeo falhou.');
      setStep('config');
    }
  }, [shortsProgress]);



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
    setLogs([]);
    setLocalProgress({ percent: 0, message: 'Iniciando pipeline no servidor...', stage: 'shorts:init' });
    
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

  // Carrega o status do último job existente ao montar
  useEffect(() => {
    async function loadLatestJob() {
      if (autoStart) {
        setStep('analyzing');
        setLoading(false);
        handleStartAnalysis();
        if (onResetAutoStart) onResetAutoStart();
        return;
      }

      try {
        const status = await getShortsStatus(projectId);
        if (status.job) {
          setJobId(status.job.id);
          const statusStr = status.job.status;
          
          if (statusStr === 'ready' && status.clips && status.clips.length > 0) {
            setClips(status.clips);
            setActivePreviewClip(status.clips[0]);
            setSelectedClips(new Set(status.clips.map(c => c.id)));
            setStep('review');
          } else if (statusStr === 'analyzing' || statusStr === 'pending') {
            setStep('analyzing');
          } else {
            setStep('config');
          }
        } else {
          setStep('config');
        }
      } catch (err) {
        console.error('Error loading latest job:', err);
        setStep('config');
      } finally {
        setLoading(false);
      }
    }

    loadLatestJob();
  }, [projectId, autoStart]);

  const handleCancelAnalysis = async () => {
    if (!jobId) {
      onGoBack();
      return;
    }
    try {
      setLocalProgress((prev) => ({ ...prev, message: 'Cancelando processamento no servidor...' }));
      await cancelShorts({ projectId, jobId });
      onGoBack();
    } catch (err) {
      console.error('Failed to cancel analysis:', err);
      setError('Falha ao cancelar o processamento no servidor.');
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

  const getStageInfo = (stageId) => {
    const currentStage = localProgress.stage || 'shorts:init';
    const stageOrder = [
      'shorts:init', 
      'shorts:extract_audio', 
      'shorts:transcribe', 
      'shorts:group', 
      'shorts:select', 
      'shorts:done'
    ];
    
    const currentIndex = stageOrder.indexOf(currentStage);
    
    let targetIndex = -1;
    if (stageId === 'extract') targetIndex = 1;
    else if (stageId === 'transcribe') targetIndex = 2;
    else if (stageId === 'group') targetIndex = 3;
    else if (stageId === 'select') targetIndex = 4;
    else if (stageId === 'done') targetIndex = 5;
    
    if (currentStage === 'shorts:done') {
      return { status: 'completed', progress: 100 };
    }
    
    if (currentIndex > targetIndex) {
      return { status: 'completed', progress: 100 };
    } else if (currentIndex === targetIndex || (stageId === 'extract' && currentIndex === 0)) {
      let subProgress = 50;
      if (stageId === 'extract') {
        subProgress = currentIndex === 0 ? 50 : 100;
      } else if (stageId === 'transcribe') {
        subProgress = Math.min(100, Math.max(0, Math.round(((localProgress.percent - 30) / 25) * 100)));
      } else if (stageId === 'select') {
        subProgress = 65;
      } else if (stageId === 'group') {
        subProgress = 85;
      } else if (stageId === 'done') {
        subProgress = 95;
      }
      return { status: 'running', progress: subProgress };
    } else {
      return { status: 'pending', progress: 0 };
    }
  };

  if (loading) {
    return (
      <div className="w-full max-w-7xl mx-auto px-4 py-8 flex flex-col items-center justify-center min-h-[400px] text-surface-400">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500 mb-2" />
        <p className="text-sm font-medium text-surface-600">Carregando informações do projeto...</p>
      </div>
    );
  }

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
        <Card className="w-full max-w-4xl mx-auto border-surface-200/80 shadow-2xl p-8 bg-white">
          <CardHeader className="p-0 mb-8 border-b border-surface-100 pb-4 flex flex-row items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <Loader2 className="w-6 h-6 text-primary-500 animate-spin" />
                <CardTitle className="text-xl font-extrabold text-surface-900">Dashboard de Processamento IA</CardTitle>
              </div>
              <CardDescription className="text-sm text-surface-500">
                Nosso pipeline local de inteligência artificial está processando seu vídeo. Acompanhe o progresso detalhado de cada fase abaixo.
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCancelAnalysis}
              className="border-red-200 text-red-600 hover:bg-red-50 flex items-center gap-1.5 flex-shrink-0"
            >
              <XCircle className="w-4 h-4 text-red-500" />
              Cancelar Processo
            </Button>
          </CardHeader>
          <CardContent className="p-0 space-y-6">
            
            {/* Top Pipeline Flow Steps Indicators */}
            <div className="flex flex-wrap items-center justify-between border-b border-surface-100 pb-6 mb-6 gap-3">
              {['extract', 'transcribe', 'group', 'select', 'done'].map((stageId, idx) => {
                const info = getStageInfo(stageId);
                const label = stageId === 'extract' ? 'Extração' : stageId === 'transcribe' ? 'Transcrição' : stageId === 'group' ? 'Agrupamento' : stageId === 'select' ? 'Seleção' : 'Conclusão';
                return (
                  <div key={stageId} className="flex items-center gap-2">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs border transition-all duration-300 ${
                      info.status === 'completed' ? 'bg-emerald-500 border-emerald-500 text-white shadow-sm' :
                      info.status === 'running' ? 'bg-primary-600 border-primary-600 text-white animate-pulse shadow-md shadow-primary-100' :
                      'bg-surface-50 border-surface-200 text-surface-400'
                    }`}>
                      {info.status === 'completed' ? '✓' : idx + 1}
                    </div>
                    <span className={`text-[11px] font-semibold transition-colors ${
                      info.status === 'completed' ? 'text-emerald-600' :
                      info.status === 'running' ? 'text-primary-600' : 'text-surface-400'
                    }`}>
                      {label}
                    </span>
                    {idx < 4 && <span className="text-surface-300 font-bold ml-2 hidden sm:inline">➔</span>}
                  </div>
                );
              })}
            </div>

            {/* Overall Progress Indicator */}
            <div className="bg-surface-50 rounded-xl p-4 border border-surface-100 space-y-2 mb-6">
              <div className="flex justify-between text-xs font-bold text-surface-700">
                <span className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-primary-500 animate-ping" />
                  Status Global: {localProgress.message || 'Processando arquivo...'}
                </span>
                <span className="font-mono text-primary-600 text-sm">{localProgress.percent}%</span>
              </div>
              <Progress value={localProgress.percent} className="h-2.5" />
            </div>

            {/* Detailed Stage-by-Stage checklist */}
            <div className="space-y-4">
              <h4 className="text-xs font-bold uppercase tracking-wider text-surface-500">Etapas do Processamento</h4>
              
              {[
                { id: 'extract', title: '1. Extração de Áudio', desc: 'Extrai a faixa de áudio original do vídeo e a normaliza para 16kHz para alimentar o modelo de transcrição.' },
                { id: 'transcribe', title: '2. Transcrição de Fala (Whisper)', desc: 'Realiza a decodificação da fala e detecta marcas de tempo em nível de palavra para legendas.' },
                { id: 'group', title: '3. Agrupamento Semântico', desc: 'Analisa as pausas no áudio e junta fragmentos de sentenças em parágrafos de storytelling coerentes.' },
                { id: 'select', title: '4. Seleção dos Melhores Clipes', desc: 'Analisa o conteúdo textual com o Gemma via LM Studio (ou fallback local) buscando os ganchos narrativos.' },
                { id: 'done', title: '5. Gravação de Resultados', desc: 'Organiza as propostas selecionadas e armazena os registros no banco de dados SQLite para revisão.' }
              ].map((stage) => {
                const info = getStageInfo(stage.id);
                return (
                  <div key={stage.id} className={`p-3.5 rounded-xl border transition-all duration-300 ${
                    info.status === 'completed' ? 'border-emerald-100 bg-emerald-50/10' :
                    info.status === 'running' ? 'border-primary-200 bg-primary-50/5' : 'border-surface-100 opacity-60'
                  }`}>
                    <div className="flex items-start justify-between gap-3 mb-1.5">
                      <div className="space-y-0.5">
                        <h5 className={`text-xs font-bold ${
                          info.status === 'completed' ? 'text-emerald-700' :
                          info.status === 'running' ? 'text-primary-700' : 'text-surface-700'
                        }`}>
                          {stage.title}
                        </h5>
                        <p className="text-[10px] text-surface-500 max-w-2xl leading-relaxed">{stage.desc}</p>
                      </div>
                      
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {info.status === 'completed' && <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-full flex items-center gap-1">✓ Concluído</span>}
                        {info.status === 'running' && (
                          <span className="text-[10px] font-bold text-primary-600 bg-primary-50 border border-primary-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                            <Loader2 className="w-3 h-3 animate-spin text-primary-500" />
                            {info.progress}%
                          </span>
                        )}
                        {info.status === 'pending' && <span className="text-[10px] font-medium text-surface-400 bg-surface-50 border border-surface-150 px-2 py-0.5 rounded-full">Aguardando</span>}
                      </div>
                    </div>
                    
                    {/* Sub-progress bar for the individual stage */}
                    <Progress value={info.progress} className={`h-1.5 ${
                      info.status === 'completed' ? 'bg-emerald-200' : 'bg-surface-200'
                    }`} />
                  </div>
                );
              })}
            </div>

            {/* Terminal Console Fixo */}
            <div className="border-t border-surface-200 pt-6 mt-8">
              <div className="flex items-center justify-between mb-3">
                <h5 className="text-xs font-bold font-mono text-surface-700 flex items-center gap-2">
                  <span className="w-2 h-2 bg-emerald-500 rounded-full animate-ping" />
                  Console de Comunicação do Sidecar (Logs do Whisper/IA)
                </h5>
                <span className="text-[10px] font-mono text-surface-400">Status: Conectado</span>
              </div>
              <div className="bg-surface-950 text-emerald-400 font-mono text-[9px] p-4 rounded-xl border border-surface-800 shadow-inner h-[180px] overflow-y-auto">
                {logs.length === 0 ? (
                  <div className="text-surface-600 italic">Aguardando logs do pipeline...</div>
                ) : (
                  <div className="space-y-1.5">
                    {logs.map((log, index) => (
                      <div key={index} className="whitespace-pre-wrap leading-relaxed">{log}</div>
                    ))}
                    <div ref={logEndRef} />
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* --- step: Revisão (Review) --- */}
      {step === 'review' && (
        <div className="space-y-8">
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
                      const clipsToExport = Array.from(selectedClips);
                      let successCount = 0;
                      for (const cid of clipsToExport) {
                        const clipObj = clips.find(c => c.id === cid);
                        setExportingClipId(cid);
                        try {
                          await exportShort({
                            projectId,
                            jobId,
                            clipId: cid
                          });
                          successCount++;
                        } catch (err) {
                          console.error(`Error exporting clip ${cid}:`, err);
                        }
                      }
                      setExportingClipId(null);
                      alert(`Exportação concluída! ${successCount} de ${clipsToExport.length} clipes foram salvos na pasta de processados.`);
                      fetchClips(); // Refresh status/paths
                    }}
                    className="w-full mt-6 py-5 bg-gradient-to-r from-primary-600 to-indigo-600 hover:from-primary-700 hover:to-indigo-700 text-white font-semibold rounded-xl"
                    disabled={exportingClipId !== null}
                  >
                    {exportingClipId !== null ? 'Exportando Lote...' : `Exportar Selecionados (${selectedClips.size})`}
                  </Button>
                )}
              </Card>
            </div>
          </div>

          {/* Histórico Completo de Logs do Processamento */}
          <Card className="border-surface-200/80 shadow-md">
            <CardHeader className="pb-2 pt-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowLogs(!showLogs)}
                className="w-full justify-between hover:bg-surface-50 font-bold text-xs text-surface-650 hover:text-surface-900 rounded-lg h-9 px-3"
              >
                <span className="flex items-center gap-2 font-mono">
                  <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full" />
                  Histórico de Logs do Processamento IA (Whisper & Gemma)
                </span>
                <span>{showLogs ? 'Recolher Logs' : 'Expandir Logs'} ({logs.length})</span>
              </Button>
            </CardHeader>
            {showLogs && (
              <CardContent className="px-6 pb-6">
                <div className="bg-surface-950 text-emerald-400 font-mono text-[9px] p-4 rounded-xl border border-surface-800 shadow-inner h-[220px] overflow-y-auto">
                  <div className="space-y-1.5">
                    {logs.map((log, index) => (
                      <div key={index} className="whitespace-pre-wrap leading-relaxed">{log}</div>
                    ))}
                    <div ref={logEndRef} />
                  </div>
                </div>
              </CardContent>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
