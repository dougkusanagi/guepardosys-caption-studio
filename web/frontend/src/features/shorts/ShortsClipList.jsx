import React from 'react';
import { Play, Download, CheckCircle2, AlertCircle } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/card.jsx';
import { Button } from '../../components/ui/button.jsx';
import { ScrollArea } from '../../components/ui/scroll-area.jsx';

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export default function ShortsClipList({
  clips,
  selectedClips,
  onToggleSelect,
  activePreviewId,
  onSelectPreview,
  onExportClip,
  exportingClipId
}) {
  if (!clips || clips.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center text-surface-400 bg-surface-50 border border-dashed border-surface-200 rounded-xl">
        <AlertCircle className="w-8 h-8 mb-2" />
        <p className="text-sm">Nenhum clipe sugerido foi encontrado.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-surface-700">Clipes Sugeridos ({clips.length})</h3>
        <p className="text-xs text-surface-400">Selecione para exportar ou clique para visualizar</p>
      </div>
      
      <ScrollArea className="h-[480px] pr-2">
        <div className="space-y-3">
          {clips.map((clip) => {
            const isSelected = selectedClips.has(clip.id);
            const isActive = activePreviewId === clip.id;
            const isExporting = exportingClipId === clip.id;
            const viralScorePercent = Math.round(clip.score * 100);

            // Dynamic color based on viral score
            const scoreColor = 
              viralScorePercent >= 90 ? 'text-emerald-600 bg-emerald-50 border-emerald-100' :
              viralScorePercent >= 80 ? 'text-indigo-600 bg-indigo-50 border-indigo-100' :
              'text-amber-600 bg-amber-50 border-amber-100';

            return (
              <Card 
                key={clip.id}
                className={`border transition-all duration-200 cursor-pointer ${
                  isActive 
                    ? 'border-primary-500 shadow-md shadow-primary-50/50 bg-primary-50/10' 
                    : 'border-surface-200/80 hover:border-surface-300 bg-white'
                }`}
                onClick={() => onSelectPreview(clip)}
              >
                <CardContent className="p-4 flex items-center justify-between gap-4">
                  {/* Select Checkbox/Indicator */}
                  <div 
                    className="flex-shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleSelect(clip.id);
                    }}
                  >
                    <div className={`w-5 h-5 rounded-full border flex items-center justify-center transition-colors ${
                      isSelected 
                        ? 'bg-primary-600 border-primary-600 text-white' 
                        : 'border-surface-300 hover:border-primary-400 bg-white'
                    }`}>
                      {isSelected && <CheckCircle2 className="w-3.5 h-3.5 fill-white text-primary-600" />}
                    </div>
                  </div>

                  {/* Clip Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-sm text-surface-900 truncate">
                        {clip.headline || `Short #${clip.index + 1}`}
                      </span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border flex-shrink-0 ${scoreColor}`}>
                        Score Viral: {viralScorePercent}%
                      </span>
                    </div>
                    <p className="text-xs text-surface-500 font-mono mb-1">
                      {formatTime(clip.start_sec)} - {formatTime(clip.end_sec)} ({Math.round(clip.end_sec - clip.start_sec)}s)
                    </p>
                    {clip.storytelling_structure && (
                      <p className="text-[10px] text-surface-400 italic line-clamp-2">
                        {clip.storytelling_structure}
                      </p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                    <Button
                      variant={isActive ? "secondary" : "outline"}
                      size="sm"
                      onClick={() => onSelectPreview(clip)}
                      className="text-xs h-8 px-2.5 flex items-center gap-1"
                    >
                      <Play className={`w-3.5 h-3.5 ${isActive ? 'fill-current' : ''}`} />
                      Assistir
                    </Button>
                    
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={isExporting}
                      onClick={() => onExportClip(clip)}
                      className="text-xs h-8 px-2.5 bg-surface-900 hover:bg-surface-800 text-white flex items-center gap-1"
                    >
                      <Download className="w-3.5 h-3.5" />
                      {isExporting ? 'Exportando...' : 'Exportar'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
