import { Palette, Sparkles, Subtitles, X } from 'lucide-react';

import { Button } from './ui/button.jsx';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from './ui/card.jsx';
import { Input } from './ui/input.jsx';
import { Label } from './ui/label.jsx';
import { ScrollArea } from './ui/scroll-area.jsx';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from './ui/sheet.jsx';
import { PresetSelector } from './preset-selector.jsx';
import { clamp, cn, formatTime } from '../lib/utils.js';

function SelectField({ label, value, onChange, children }) {
  const items = Array.isArray(children) ? children : [children];

  return (
    <div>
      <Label className="mb-1.5 block">{label}</Label>
      <select
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
        className="flex h-9 w-full items-center justify-between rounded-lg border border-surface-200 bg-surface-50 px-3 py-2 text-sm text-surface-700 transition-colors focus:outline-none focus:ring-2 focus:ring-primary-400 appearance-none cursor-pointer"
      >
        {items.map((child, index) => (
          <option key={`${child.props.value ?? child.props.children}-${index}`} value={String(child.props.value)}>
            {child.props.children}
          </option>
        ))}
      </select>
    </div>
  );
}

function InputField({ label, onChange, ...props }) {
  return (
    <div>
      <Label className="mb-1 block normal-cap tracking-normal font-medium text-surface-500">{label}</Label>
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
      <Label className="mb-1 block normal-cap tracking-normal font-medium text-surface-500">{label}</Label>
      <Input type="color" value={value} onChange={(event) => onChange(event.target.value)} className="h-10 cursor-pointer p-1" />
    </div>
  );
}

function SubtitlePreview({ subtitle }) {
  if (!subtitle) return null;

  return (
    <Card className="border-surface-200 bg-surface-50 shadow-none">
      <CardContent className="p-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] font-mono text-surface-400">{formatTime(subtitle.start)} &rarr; {formatTime(subtitle.end)}</span>
          <span className="text-[10px] text-surface-300">#{subtitle.index + 1}</span>
        </div>
        <p className="text-xs text-surface-700 leading-relaxed">{subtitle.text}</p>
      </CardContent>
    </Card>
  );
}

function SubtitleSidebarForm({ settings, setSettings, style, setStyle, subtitles, onGenerate, onToast }) {
  return (
    <ScrollArea className="flex-1">
      <div className="space-y-6 px-5 py-5">
        <Card className="border-surface-200/80">
          <CardHeader className="pb-4">
            <CardTitle className="text-sm">Configura&ccedil;&atilde;o da transcri&ccedil;&atilde;o</CardTitle>
            <CardDescription>Whisper ser&aacute; usado para transcrever e sincronizar as falas.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <SelectField label="Modelo Whisper" value={settings.model} onChange={(value) => setSettings((prev) => ({ ...prev, model: value }))}>
              <option value="tiny">Tiny (r&aacute;pido)</option>
              <option value="base">Base</option>
              <option value="small">Small (recomendado)</option>
              <option value="medium">Medium</option>
              <option value="large">Large (preciso)</option>
            </SelectField>
            <SelectField label="Idioma" value={settings.language} onChange={(value) => setSettings((prev) => ({ ...prev, language: value }))}>
              <option value="pt">Portugu&ecirc;s</option>
              <option value="en">Ingl&ecirc;s</option>
              <option value="es">Espanhol</option>
              <option value="fr">Franc&ecirc;s</option>
              <option value="de">Alem&atilde;o</option>
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
            <PresetSelector
              currentStyle={style}
              onStyleChange={setStyle}
              onToast={onToast}
            />
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
            <SelectField label="Posi&ccedil;&atilde;o" value={String(style.alignment)} onChange={(value) => setStyle((prev) => ({ ...prev, alignment: parseInt(value, 10) }))}>
              <option value="2">Inferior Centro</option>
              <option value="8">Superior Centro</option>
              <option value="5">Centro</option>
              <option value="1">Inferior Esquerda</option>
              <option value="3">Inferior Direita</option>
            </SelectField>
            <InputField
              label="Posi&ccedil;&atilde;o Vertical (%)"
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
                  N&atilde;o
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-2">
          <Button type="button" className="w-full gap-2" onClick={onGenerate}>
            <Sparkles className="w-4 h-4" />
            Gerar Legendas com IA
          </Button>
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
                    <SubtitlePreview key={`${subtitle.start}-${subtitle.end}-${index}`} subtitle={{ ...subtitle, index }} />
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </ScrollArea>
  );
}

function SubtitleSidebarHeader({ onClose, inline = false }) {
  const content = (
    <>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Subtitles className="w-4 h-4 text-primary-500" />
          <h2 className="text-base font-semibold text-surface-900">Legendas IA</h2>
        </div>
        <p className="mt-1 text-sm text-surface-500">
          Configure transcri&ccedil;&atilde;o e estilo antes de gerar ou aplicar as legendas.
        </p>
      </div>
      {inline ? (
        <Button type="button" variant="ghost" size="icon" className="shrink-0" onClick={onClose} aria-label="Fechar painel de legendas">
          <X className="w-4 h-4" />
        </Button>
      ) : null}
    </>
  );

  if (inline) {
    return (
      <div className="flex items-start gap-3 border-b border-surface-100 px-5 py-4">
        {content}
      </div>
    );
  }

  return (
    <SheetHeader className="border-b border-surface-100 px-5 py-4 pr-12">
      <SheetTitle className="flex items-center gap-2">
        <Subtitles className="w-4 h-4 text-primary-500" />
        Legendas IA
      </SheetTitle>
      <SheetDescription>Configure transcri&ccedil;&atilde;o e estilo antes de gerar ou aplicar as legendas.</SheetDescription>
    </SheetHeader>
  );
}

export function SubtitleSidebar({ open, settings, setSettings, style, setStyle, subtitles, onClose, onGenerate, onToast }) {
  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <SheetContent side="right" className="top-14 bottom-0 h-auto w-[480px] rounded-none border-l border-surface-200 p-0">
        <div className="flex h-full w-full flex-col">
          <SubtitleSidebarHeader />
          <SubtitleSidebarForm
            settings={settings}
            setSettings={setSettings}
            style={style}
            setStyle={setStyle}
            subtitles={subtitles}
            onGenerate={onGenerate}
            onToast={onToast}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function InlineSubtitlePanel({
  open,
  settings,
  setSettings,
  style,
  setStyle,
  subtitles,
  onClose,
  onGenerate,
  onToast,
  className = '',
}) {
  if (!open) return null;

  return (
    <aside className={cn('subtitle-settings-dock', className)}>
      <div className="subtitle-settings-dock__surface">
        <SubtitleSidebarHeader inline onClose={onClose} />
        <SubtitleSidebarForm
          settings={settings}
          setSettings={setSettings}
          style={style}
          setStyle={setStyle}
          subtitles={subtitles}
          onGenerate={onGenerate}
          onToast={onToast}
        />
      </div>
    </aside>
  );
}
