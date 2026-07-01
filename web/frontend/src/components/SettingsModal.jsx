import React from 'react';
import { Settings, Cpu, Bot, Globe, Mic, Save } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog.jsx';
import { Button } from './ui/button.jsx';
import { Label } from './ui/label.jsx';
import { Input } from './ui/input.jsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select.jsx';

const DEFAULT_SETTINGS = {
  llmUrl: 'http://localhost:1234/v1/chat/completions',
  llmModel: 'google/gemma-4-e2b',
  whisperDevice: 'auto',
  defaultWhisperModel: 'small',
  defaultLanguage: 'pt',
};

function loadSettings() {
  try {
    const stored = localStorage.getItem('appSettings');
    if (stored) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
    }
  } catch (e) {
    console.warn('Failed to load settings from localStorage', e);
  }
  return { ...DEFAULT_SETTINGS };
}

function saveSettingsToDisk(settings) {
  try {
    localStorage.setItem('appSettings', JSON.stringify(settings));
  } catch (e) {
    console.warn('Failed to save settings to localStorage', e);
  }
}

export { DEFAULT_SETTINGS, loadSettings, saveSettingsToDisk };

export default function SettingsModal({ open, onOpenChange, settings, onSave }) {
  const [localSettings, setLocalSettings] = React.useState({ ...settings });

  React.useEffect(() => {
    setLocalSettings({ ...settings });
  }, [settings, open]);

  const setValue = (key, value) => {
    setLocalSettings((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    onSave(localSettings);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-6" showClose>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-surface-500" />
            Configurações
          </DialogTitle>
          <DialogDescription>
            Configure os modelos de IA e preferências do sistema.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          {/* LLM Section */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-surface-700 uppercase tracking-wider flex items-center gap-1.5">
              <Bot className="w-3.5 h-3.5 text-surface-400" />
              Modelo de Linguagem (LLM) para Shorts
            </h3>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-surface-600">URL do Servidor</Label>
              <Input
                value={localSettings.llmUrl}
                onChange={(e) => setValue('llmUrl', e.target.value)}
                placeholder="http://localhost:1234/v1/chat/completions"
                className="text-xs h-9"
              />
              <p className="text-[10px] text-surface-400">
                Endpoint compatível com OpenAI (LM Studio, Ollama, vLLM, etc.)
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-surface-600">Nome do Modelo</Label>
              <Input
                value={localSettings.llmModel}
                onChange={(e) => setValue('llmModel', e.target.value)}
                placeholder="google/gemma-4-e2b"
                className="text-xs h-9"
              />
              <p className="text-[10px] text-surface-400">
                Modelo usado para selecionar os melhores trechos para Shorts
              </p>
            </div>
          </div>

          <div className="border-t border-surface-200" />

          {/* Whisper Section */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-surface-700 uppercase tracking-wider flex items-center gap-1.5">
              <Mic className="w-3.5 h-3.5 text-surface-400" />
              Transcrição (Whisper)
            </h3>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-surface-600">Dispositivo</Label>
              <Select
                value={localSettings.whisperDevice}
                onValueChange={(val) => setValue('whisperDevice', val)}
              >
                <SelectTrigger className="w-full bg-surface-50 border-surface-200 text-xs h-9">
                  <SelectValue placeholder="Selecione o dispositivo" />
                </SelectTrigger>
                <SelectContent className="text-xs">
                  <SelectItem value="auto" className="text-xs">Automático (GPU se disponível, senão CPU)</SelectItem>
                  <SelectItem value="cuda" className="text-xs">GPU (CUDA) — Mais rápido</SelectItem>
                  <SelectItem value="cpu" className="text-xs">CPU — Mais compatível</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[10px] text-surface-400">
                {localSettings.whisperDevice === 'auto' && 'Usa GPU NVIDIA se disponível, caso contrário usa CPU.'}
                {localSettings.whisperDevice === 'cuda' && 'Força o uso da placa de vídeo NVIDIA (requer CUDA).'}
                {localSettings.whisperDevice === 'cpu' && 'Processa tudo pelo processador (mais lento, mas universal).'}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-surface-600">Modelo Padrão</Label>
              <Select
                value={localSettings.defaultWhisperModel}
                onValueChange={(val) => setValue('defaultWhisperModel', val)}
              >
                <SelectTrigger className="w-full bg-surface-50 border-surface-200 text-xs h-9">
                  <SelectValue placeholder="Selecione o modelo" />
                </SelectTrigger>
                <SelectContent className="text-xs">
                  <SelectItem value="small" className="text-xs">Small (Rápido — ~1GB VRAM)</SelectItem>
                  <SelectItem value="medium" className="text-xs">Medium (Equilibrado — ~1.5GB VRAM)</SelectItem>
                  <SelectItem value="large-v3" className="text-xs">Large-v3 (Máxima Precisão — ~3GB VRAM)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[10px] text-surface-400">
                Modelo Whisper usado por padrão para transcrições e Shorts.
              </p>
            </div>
          </div>

          <div className="border-t border-surface-200" />

          {/* General Section */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-surface-700 uppercase tracking-wider flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 text-surface-400" />
              Geral
            </h3>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-surface-600">Idioma Padrão</Label>
              <Select
                value={localSettings.defaultLanguage}
                onValueChange={(val) => setValue('defaultLanguage', val)}
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
              <p className="text-[10px] text-surface-400">
                Idioma padrão usado nas transcrições e geração de Shorts.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 mt-6 pt-4 border-t border-surface-200">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="text-xs h-9"
          >
            Cancelar
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleSave}
            className="text-xs h-9 gap-1.5"
          >
            <Save className="w-3.5 h-3.5" />
            Salvar Configurações
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
