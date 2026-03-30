"""
Subtitle Service — SRT and ASS file generation.
"""

from __future__ import annotations

from pathlib import Path


def format_srt_time(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = round((seconds % 1) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def format_ass_time(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    cs = round((seconds % 1) * 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def write_srt(subtitles: list[dict], path: str | Path) -> None:
    """Write subtitles to SRT format."""
    lines = []
    for i, sub in enumerate(subtitles, 1):
        lines.append(str(i))
        lines.append(f"{format_srt_time(sub['start'])} --> {format_srt_time(sub['end'])}")
        lines.append(sub["text"])
        lines.append("")
    Path(path).write_text("\n".join(lines), encoding="utf-8")


def write_ass(subtitles: list[dict], path: str | Path, style: dict | None = None) -> None:
    """Write subtitles to ASS format with custom styling."""
    s = style or {}
    font_name = s.get("fontName", "Arial")
    font_size = s.get("fontSize", 24)
    primary_color = s.get("primaryColor", "&H00FFFFFF")
    outline_color = s.get("outlineColor", "&H00000000")
    back_color = s.get("backColor", "&H80000000")
    bold = s.get("bold", -1)
    outline = s.get("outline", 2)
    shadow = s.get("shadow", 1)
    alignment = s.get("alignment", 2)
    margin_v = s.get("marginV", 30)

    header = f"""[Script Info]
Title: Generated Subtitles
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{font_name},{font_size},{primary_color},&H000000FF,{outline_color},{back_color},{bold},0,0,0,100,100,0,0,1,{outline},{shadow},{alignment},10,10,{margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

    dialogues = []
    for sub in subtitles:
        start = format_ass_time(sub["start"])
        end = format_ass_time(sub["end"])
        dialogues.append(f"Dialogue: 0,{start},{end},Default,,0,0,0,,{sub['text']}")

    content = header + "\n".join(dialogues) + "\n"
    Path(path).write_text(content, encoding="utf-8")
