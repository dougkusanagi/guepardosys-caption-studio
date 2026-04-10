"""
Subtitle Service — SRT and ASS file generation.
"""

from __future__ import annotations

from pathlib import Path


def clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


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


def write_ass(
    subtitles: list[dict],
    path: str | Path,
    style: dict | None = None,
    play_res: tuple[int, int] | None = None,
) -> None:
    """Write subtitles to ASS format with custom styling."""
    s = style or {}
    play_res_x, play_res_y = play_res or (1920, 1080)
    font_name = s.get("fontName", "Arial")
    font_size = s.get("fontSize", 24)
    primary_color = s.get("primaryColor", "&H00FFFFFF")
    outline_color = s.get("outlineColor", "&H00000000")
    background_color = s.get("backgroundColor", "#000000")
    background_opacity = clamp(float(s.get("backgroundOpacity", 0.0)), 0, 1)
    back_color = s.get("backColor") or _hex_to_ass_color(background_color, alpha=1 - background_opacity)
    bold = s.get("bold", -1)
    outline = s.get("outline", 2)
    shadow = s.get("shadow", 1)
    alignment = s.get("alignment", 2)
    margin_v = s.get("marginV", 30)
    border_style = 3 if background_opacity > 0 else 1
    position_y = clamp(float(s.get("positionY", 88)), 0, 100)
    area_height = clamp(float(s.get("areaHeight", 18)), 4, 100)
    decoration_padding = max(12.0, (float(outline) * 3.0) + (float(shadow) * 4.0))

    header = f"""[Script Info]
Title: Generated Subtitles
ScriptType: v4.00+
PlayResX: {play_res_x}
PlayResY: {play_res_y}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{font_name},{font_size},{primary_color},&H000000FF,{outline_color},{back_color},{bold},0,0,0,100,100,0,0,{border_style},{outline},{shadow},{alignment},10,10,{margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

    dialogues = []
    horizontal_positions = {
        1: 56,
        2: play_res_x / 2,
        3: play_res_x - 56,
        5: play_res_x / 2,
        8: play_res_x / 2,
    }
    x_pos = horizontal_positions.get(alignment, play_res_x / 2)
    y_pos = round((position_y / 100) * play_res_y, 2)
    clip_height = (area_height / 100) * play_res_y

    if alignment in {1, 2, 3}:
        clip_top = y_pos - clip_height - decoration_padding
        clip_bottom = y_pos + decoration_padding
    elif alignment == 5:
        clip_top = y_pos - (clip_height / 2) - decoration_padding
        clip_bottom = y_pos + (clip_height / 2) + decoration_padding
    else:
        clip_top = y_pos - decoration_padding
        clip_bottom = y_pos + clip_height + decoration_padding

    clip_top = round(clamp(clip_top, 0, max(play_res_y - 1, 0)), 2)
    clip_bottom = round(clamp(clip_bottom, clip_top + 1, play_res_y), 2)
    for sub in subtitles:
        start = format_ass_time(sub["start"])
        end = format_ass_time(sub["end"])
        text = str(sub["text"]).replace("\n", r"\N")
        override = rf"{{\an{alignment}\pos({x_pos:.2f},{y_pos:.2f})\clip(0,{clip_top:.2f},{play_res_x:.2f},{clip_bottom:.2f})}}"
        dialogues.append(f"Dialogue: 0,{start},{end},Default,,0,0,0,,{override}{text}")

    content = header + "\n".join(dialogues) + "\n"
    Path(path).write_text(content, encoding="utf-8")


def _hex_to_ass_color(hex_color: str, alpha: float = 0.0) -> str:
    normalized = str(hex_color or "#000000").lstrip("#")
    if len(normalized) != 6:
        normalized = "000000"
    r = normalized[0:2]
    g = normalized[2:4]
    b = normalized[4:6]
    alpha_value = round(clamp(alpha, 0, 1) * 255)
    return f"&H{alpha_value:02X}{b.upper()}{g.upper()}{r.upper()}"
