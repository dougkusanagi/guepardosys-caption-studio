import React from 'react';
import { Sparkles, Sliders, Settings } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card.jsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select.jsx';
import { Label } from '../../components/ui/label.jsx';
import { Button } from '../../components/ui/button.jsx';

export default function ShortsConfigPanel({ config, onChange, onStart }) {
  const setConfigValue = (key, value) => {
    onChange({ ...config, [key]: value });
  };

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
      <CardContent className="space-y-6 px-6 pb-6">
        {/* Clip Count */}
        <div className="space-y-2">
          <Label className="text-sm font-medium text-surface-700">Quantidade de Clipes Alvo</Label>
          <Select
            value={String(config.clipCount)}
            onValueChange={(val) => setConfigValue('clipCount', parseInt(val))}
          >
            <SelectTrigger className="w-full bg-surface-50 border-surface-200">
              <SelectValue placeholder="Selecione a quantidade" />
            </SelectTrigger>
            <SelectContent>
              {[1, 2, 3, 4, 5, 7, 10].map((num) => (
                <SelectItem key={num} value={String(num)}>
                  {num} {num === 1 ? 'Clipe' : 'Clipes'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Target Duration */}
        <div className="space-y-2">
          <Label className="text-sm font-medium text-surface-700">Duração Recomendada</Label>
          <Select
            value={String(config.targetDuration)}
            onValueChange={(val) => setConfigValue('targetDuration', parseFloat(val))}
          >
            <SelectTrigger className="w-full bg-surface-50 border-surface-200">
              <SelectValue placeholder="Selecione a duração" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="15">~15 segundos (Ideal para Stories/Shorts curtos)</SelectItem>
              <SelectItem value="30">~30 segundos (Recomendado para engajamento)</SelectItem>
              <SelectItem value="45">~45 segundos (Ideal para Reels e TikTok)</SelectItem>
              <SelectItem value="60">~60 segundos (Duração limite de Reels/Shorts)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Reframe Mode */}
        <div className="space-y-2">
          <Label className="text-sm font-medium text-surface-700">Modo de Enquadramento (9:16)</Label>
          <Select
            value={config.reframeMode}
            onValueChange={(val) => setConfigValue('reframeMode', val)}
          >
            <SelectTrigger className="w-full bg-surface-50 border-surface-200">
              <SelectValue placeholder="Selecione o enquadramento" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="smart">Enquadramento Inteligente (Rastreia pessoas e rostos)</SelectItem>
              <SelectItem value="blur">Vertical com Blur (Preenche fundo desfocado)</SelectItem>
              <SelectItem value="center">Centralizado Estático (Apenas corta o meio)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Language */}
        <div className="space-y-2">
          <Label className="text-sm font-medium text-surface-700">Idioma do Áudio (Whisper)</Label>
          <Select
            value={config.language}
            onValueChange={(val) => setConfigValue('language', val)}
          >
            <SelectTrigger className="w-full bg-surface-50 border-surface-200">
              <SelectValue placeholder="Selecione o idioma" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pt">Português (Brasil)</SelectItem>
              <SelectItem value="en">Inglês</SelectItem>
              <SelectItem value="es">Espanhol</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Action Button */}
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
