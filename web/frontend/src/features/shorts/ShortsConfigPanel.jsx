import React from 'react';
import { Sparkles, Sliders, Settings } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card.jsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select.jsx';
import { Label } from '../../components/ui/label.jsx';
import { Button } from '../../components/ui/button.jsx';

export default function ShortsConfigPanel({ config, onChange, onStart, hideStartButton = false }) {
  const setConfigValue = (key, value) => {
    onChange({ ...config, [key]: value });
  };

  const fields = (
    <div className="space-y-4">
      {/* Clip Count */}
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold text-surface-700">
          {config.dynamicClipCount ? 'Quantidade Mínima de Clipes' : 'Quantidade de Clipes Alvo'}
        </Label>
        <Select
          value={String(config.clipCount)}
          onValueChange={(val) => setConfigValue('clipCount', parseInt(val))}
        >
          <SelectTrigger className="w-full bg-surface-50 border-surface-200 text-xs h-9">
            <SelectValue placeholder="Selecione a quantidade" />
          </SelectTrigger>
          <SelectContent>
            {[1, 2, 3, 4, 5, 7, 10].map((num) => (
              <SelectItem key={num} value={String(num)} className="text-xs">
                {num} {num === 1 ? 'Clipe' : 'Clipes'}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Dynamic Clip Count Toggle */}
      <div 
        onClick={() => setConfigValue('dynamicClipCount', !config.dynamicClipCount)}
        className="flex items-start gap-3 p-3 rounded-lg border border-surface-100 bg-surface-50/50 cursor-pointer hover:bg-surface-100/50 transition-colors select-none"
      >
        <input
          type="checkbox"
          checked={!!config.dynamicClipCount}
          readOnly
          className="rounded border-surface-300 text-primary-600 focus:ring-primary-500 h-4 w-4 mt-0.5 cursor-pointer"
        />
        <div className="space-y-0.5">
          <span className="text-xs font-semibold text-surface-700">
            Deixar a IA decidir quantidade
          </span>
          <p className="text-[10px] text-surface-500 leading-normal font-normal">
            A IA gerará o máximo de clipes virais possíveis (respeitando o mínimo).
          </p>
        </div>
      </div>

      {/* Target Duration */}
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold text-surface-700">Duração Recomendada</Label>
        <Select
          value={String(config.targetDuration)}
          onValueChange={(val) => setConfigValue('targetDuration', parseFloat(val))}
        >
          <SelectTrigger className="w-full bg-surface-50 border-surface-200 text-xs h-9">
            <SelectValue placeholder="Selecione a duração" />
          </SelectTrigger>
          <SelectContent className="text-xs">
            <SelectItem value="15" className="text-xs">~15 segundos (Ideal para Stories/Shorts)</SelectItem>
            <SelectItem value="30" className="text-xs">~30 segundos (Recomendado/Viral)</SelectItem>
            <SelectItem value="45" className="text-xs">~45 segundos (Ideal para Reels/TikTok)</SelectItem>
            <SelectItem value="60" className="text-xs">~60 segundos (Duração limite)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Reframe Mode */}
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold text-surface-700">Enquadramento (9:16)</Label>
        <Select
          value={config.reframeMode}
          onValueChange={(val) => setConfigValue('reframeMode', val)}
        >
          <SelectTrigger className="w-full bg-surface-50 border-surface-200 text-xs h-9">
            <SelectValue placeholder="Selecione o enquadramento" />
          </SelectTrigger>
          <SelectContent className="text-xs">
            <SelectItem value="smart" className="text-xs">Enquadramento Inteligente (Rastreia pessoas)</SelectItem>
            <SelectItem value="blur" className="text-xs">Vertical com Blur (Fundo desfocado)</SelectItem>
            <SelectItem value="center" className="text-xs">Centralizado Estático (Corta meio)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Language */}
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold text-surface-700">Idioma do Áudio</Label>
        <Select
          value={config.language}
          onValueChange={(val) => setConfigValue('language', val)}
        >
          <SelectTrigger className="w-full bg-surface-50 border-surface-200 text-xs h-9">
            <SelectValue placeholder="Selecione o idioma" />
          </SelectTrigger>
          <SelectContent className="text-xs">
            <SelectItem value="pt" className="text-xs">Português (Brasil)</SelectItem>
            <SelectItem value="en" className="text-xs">Inglês</SelectItem>
            <SelectItem value="es" className="text-xs">Espanhol</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Whisper Model */}
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold text-surface-700">Modelo Whisper (Transcrição)</Label>
        <Select
          value={config.whisperModel || 'small'}
          onValueChange={(val) => setConfigValue('whisperModel', val)}
        >
          <SelectTrigger className="w-full bg-surface-50 border-surface-200 text-xs h-9">
            <SelectValue placeholder="Selecione o modelo" />
          </SelectTrigger>
          <SelectContent className="text-xs">
            <SelectItem value="small" className="text-xs">Small (Rápido - 1GB VRAM)</SelectItem>
            <SelectItem value="medium" className="text-xs">Medium (Equilibrado - 1.5GB VRAM)</SelectItem>
            <SelectItem value="large-v3" className="text-xs">Large-v3 (Máxima Precisão - 3GB VRAM)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Silence Padding (Respiro) */}
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold text-surface-700">Respiro entre Falas</Label>
        <Select
          value={String(config.breathPadding !== undefined ? config.breathPadding : 0.1)}
          onValueChange={(val) => setConfigValue('breathPadding', parseFloat(val))}
        >
          <SelectTrigger className="w-full bg-surface-50 border-surface-200 text-xs h-9">
            <SelectValue placeholder="Selecione o tempo de respiro" />
          </SelectTrigger>
          <SelectContent className="text-xs">
            <SelectItem value="0" className="text-xs">0.0s (Corte Seco - Sem Silêncio)</SelectItem>
            <SelectItem value="0.05" className="text-xs">0.05s (Mínimo Respiro)</SelectItem>
            <SelectItem value="0.1" className="text-xs">0.1s (Recomendado/Viral)</SelectItem>
            <SelectItem value="0.2" className="text-xs">0.2s (Conversa Natural)</SelectItem>
            <SelectItem value="0.3" className="text-xs">0.3s (Tradicional)</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );

  if (hideStartButton) {
    return fields;
  }

  return (
    <Card className="border-surface-200/80 shadow-xl shadow-surface-200/40 w-full max-w-xl mx-auto">
      <CardHeader className="text-center pb-4 pt-6">
        <div className="w-12 h-12 bg-gradient-to-br from-primary-500 to-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-md shadow-primary-200">
          <Sparkles className="w-6 h-6 text-white" />
        </div>
        <CardTitle className="text-2xl font-bold text-surface-900 flex items-center justify-center gap-2">
          Configurar Shorts IA
        </CardTitle>
        <CardDescription className="text-surface-500 text-sm max-w-sm mx-auto">
          Defina as diretrizes para nossa inteligência artificial analisar e recortar os melhores momentos.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-6 pb-6 pt-0 space-y-6">
        {fields}
        <Button
          onClick={onStart}
          className="w-full py-6 mt-2 bg-gradient-to-r from-primary-600 to-indigo-600 hover:from-primary-700 hover:to-indigo-700 text-white font-semibold rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-primary-200/40 transition-all duration-300 transform hover:scale-[1.01]"
        >
          <Sparkles className="w-5 h-5" />
          Analisar Vídeo & Encontrar Shorts
        </Button>
      </CardContent>
    </Card>
  );
}
