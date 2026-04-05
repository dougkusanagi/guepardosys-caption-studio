import { clamp, hexToASSColor } from './utils.js';

export function buildBurnStyle(style, displayScale = 1) {
  const safeScale = Number.isFinite(displayScale) && displayScale > 0 ? displayScale : 1;
  return {
    fontName: style.fontName,
    fontSize: Number((style.fontSize * safeScale).toFixed(2)),
    primaryColor: style.primaryColor,
    outlineColor: style.outlineColor,
    bold: !!style.bold,
    outline: Number((style.outline * safeScale).toFixed(2)),
    shadow: Number((style.shadow * safeScale).toFixed(2)),
    alignment: style.alignment,
    positionY: clamp(Number(style.positionY) || 0, 0, 100),
    areaHeight: clamp(Number(style.areaHeight) || 18, 4, 100),
    marginV: 0,
  };
}

export function generateAssSubtitles(subtitles, style, playRes) {
  const alignment = Number(style?.alignment) || 2;
  const fontName = style?.fontName || 'Arial';
  const fontSize = Number(style?.fontSize) || 24;
  const primaryColor = hexToASSColor(style?.primaryColor || '#ffffff');
  const outlineColor = hexToASSColor(style?.outlineColor || '#000000');
  const outline = Number(style?.outline) || 2;
  const shadow = Number(style?.shadow) || 1;
  const bold = style?.bold ? -1 : 0;
  const playResX = Number(playRes?.width) || 1920;
  const playResY = Number(playRes?.height) || 1080;
  const positionY = clamp(Number(style?.positionY) || 88, 0, 100);
  const areaHeight = clamp(Number(style?.areaHeight) || 18, 4, 100);
  const decorationPadding = Math.max(12, outline * 3 + shadow * 4);
  const xPos = alignment === 1
    ? 56
    : alignment === 3
      ? playResX - 56
      : playResX / 2;
  const yPos = (positionY / 100) * playResY;
  const clipHeight = (areaHeight / 100) * playResY;
  const [clipTopRaw, clipBottomRaw] = alignment === 1 || alignment === 2 || alignment === 3
    ? [yPos - clipHeight - decorationPadding, yPos + decorationPadding]
    : alignment === 5
      ? [yPos - clipHeight / 2 - decorationPadding, yPos + clipHeight / 2 + decorationPadding]
      : [yPos - decorationPadding, yPos + clipHeight + decorationPadding];
  const clipTop = clamp(clipTopRaw, 0, Math.max(0, playResY - 1));
  const clipBottom = clamp(clipBottomRaw, clipTop + 1, playResY);

  const lines = [
    '[Script Info]',
    'Title: Legendas StudioCut',
    'ScriptType: v4.00+',
    'WrapStyle: 0',
    `PlayResX: ${playResX}`,
    `PlayResY: ${playResY}`,
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,${fontName},${fontSize},${primaryColor},&H000000FF,${outlineColor},&H80000000,${bold},0,0,0,100,100,0,0,1,${outline},${shadow},${alignment},10,10,0,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  for (const sub of subtitles || []) {
    const start = formatAssTime(sub.start);
    const end = formatAssTime(sub.end);
    const text = String(sub.text || '').replace(/\n/g, '\\N');
    const overrideTag = `{\\an${alignment}\\pos(${xPos.toFixed(2)},${yPos.toFixed(2)})\\clip(0,${clipTop.toFixed(2)},${playResX.toFixed(2)},${clipBottom.toFixed(2)})}`;
    lines.push(`Dialogue: 0,${start},${end},Default,,0,0,0,,${overrideTag}${text}`);
  }

  return lines.join('\r\n') + '\r\n';
}

function formatAssTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds % 1) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}
