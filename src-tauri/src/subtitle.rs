use std::collections::HashMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone)]
pub struct SubtitleSegment {
    pub start: f64,
    pub end: f64,
    pub text: String,
}

pub fn write_srt(segments: &[SubtitleSegment], path: &Path) -> Result<(), String> {
    let mut lines = Vec::new();
    for (i, seg) in segments.iter().enumerate() {
        lines.push((i + 1).to_string());
        lines.push(format!("{} --> {}", format_srt_time(seg.start), format_srt_time(seg.end)));
        lines.push(seg.text.clone());
        lines.push(String::new());
    }
    std::fs::write(path, lines.join("\n")).map_err(|e| e.to_string())
}

pub fn write_ass(
    segments: &[SubtitleSegment],
    path: &Path,
    style: Option<&HashMap<String, serde_json::Value>>,
    play_res: Option<(u32, u32)>,
) -> Result<(), String> {
    let s = style.cloned().unwrap_or_default();
    let (play_res_x, play_res_y) = play_res.unwrap_or((1920, 1080));

    let font_name = s.get("fontName").and_then(|v| v.as_str()).unwrap_or("Arial");
    let font_size = s.get("fontSize").and_then(|v| v.as_i64()).unwrap_or(24);
    let primary_color = hex_to_ass(s.get("primaryColor").and_then(|v| v.as_str()).unwrap_or("#ffffff"));
    let outline_color = hex_to_ass(s.get("outlineColor").and_then(|v| v.as_str()).unwrap_or("#000000"));
    let back_color = "&H80000000";
    let bold = if s.get("bold").and_then(|v| v.as_bool()).unwrap_or(false) { -1 } else { 0 };
    let outline = s.get("outline").and_then(|v| v.as_i64()).unwrap_or(2);
    let shadow = s.get("shadow").and_then(|v| v.as_i64()).unwrap_or(1);
    let alignment = s.get("alignment").and_then(|v| v.as_i64()).unwrap_or(2) as i32;
    let margin_v = s.get("marginV").and_then(|v| v.as_i64()).unwrap_or(30);
    let position_y = s.get("positionY").and_then(|v| v.as_f64()).unwrap_or(88.0).clamp(0.0, 100.0);
    let area_height = s.get("areaHeight").and_then(|v| v.as_f64()).unwrap_or(18.0).clamp(4.0, 100.0);
    let decoration_padding = (outline as f64 * 3.0 + shadow as f64 * 4.0).max(12.0);

    let header = format!(
        "[Script Info]
Title: Generated Subtitles
ScriptType: v4.00+
PlayResX: {play_res_x}
PlayResY: {play_res_y}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{font_name},{font_size},{primary_color},&H000000FF,{outline_color},{back_color},{bold},0,0,0,100,100,0,0,1,{outline},{shadow},{alignment},10,10,{margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"
    );

    let horizontal_positions = match alignment {
        1 => 56.0,
        2 => play_res_x as f64 / 2.0,
        3 => play_res_x as f64 - 56.0,
        5 => play_res_x as f64 / 2.0,
        8 => play_res_x as f64 / 2.0,
        _ => play_res_x as f64 / 2.0,
    };

    let x_pos = horizontal_positions;
    let y_pos = (position_y / 100.0) * play_res_y as f64;
    let clip_height = (area_height / 100.0) * play_res_y as f64;

    let (clip_top, clip_bottom) = match alignment {
        1 | 2 | 3 => (y_pos - clip_height - decoration_padding, y_pos + decoration_padding),
        5 => (y_pos - clip_height / 2.0 - decoration_padding, y_pos + clip_height / 2.0 + decoration_padding),
        _ => (y_pos - decoration_padding, y_pos + clip_height + decoration_padding),
    };

    let clip_top = clip_top.clamp(0.0, (play_res_y as f64 - 1.0).max(0.0));
    let clip_bottom = clip_bottom.clamp(clip_top + 1.0, play_res_y as f64);

    let mut dialogues = Vec::new();
    for seg in segments {
        let text = seg.text.replace('\n', "\\N");
        let override_tag = format!(
            "{{\\an{}\\pos({:.2},{:.2})\\clip(0,{:.2},{:.2},{:.2})}}",
            alignment, x_pos, y_pos, clip_top, play_res_x, clip_bottom
        );
        dialogues.push(format!(
            "Dialogue: 0,{},{},Default,,0,0,0,,{}{}",
            format_ass_time(seg.start),
            format_ass_time(seg.end),
            override_tag,
            text
        ));
    }

    let content = format!("{}\n{}\n", header, dialogues.join("\n"));
    std::fs::write(path, content).map_err(|e| e.to_string())
}

pub fn parse_srt(path: &Path) -> Result<Vec<SubtitleSegment>, String> {
    let text = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let mut subtitles = Vec::new();

    for block in text.trim().split("\n\n") {
        let lines: Vec<&str> = block.trim().lines().collect();
        if lines.len() >= 3 {
            let times: Vec<&str> = lines[1].split(" --> ").collect();
            if times.len() == 2 {
                subtitles.push(SubtitleSegment {
                    start: parse_srt_time(times[0].trim())?,
                    end: parse_srt_time(times[1].trim())?,
                    text: lines[2..].join(" "),
                });
            }
        }
    }

    Ok(subtitles)
}

fn format_srt_time(seconds: f64) -> String {
    let h = (seconds / 3600.0) as i64;
    let m = ((seconds % 3600.0) / 60.0) as i64;
    let s = (seconds % 60.0) as i64;
    let ms = ((seconds % 1.0) * 1000.0).round() as i64;
    format!("{:02}:{:02}:{:02},{:03}", h, m, s, ms)
}

fn format_ass_time(seconds: f64) -> String {
    let h = (seconds / 3600.0) as i64;
    let m = ((seconds % 3600.0) / 60.0) as i64;
    let s = (seconds % 60.0) as i64;
    let cs = ((seconds % 1.0) * 100.0).round() as i64;
    format!("{}:{:02}:{:02}.{:02}", h, m, s, cs)
}

fn parse_srt_time(ts: &str) -> Result<f64, String> {
    let ts = ts.replace(',', ".");
    let parts: Vec<&str> = ts.split(':').collect();
    if parts.len() != 3 {
        return Err(format!("Invalid SRT time: {}", ts));
    }
    let h: f64 = parts[0].parse().map_err(|_| "Invalid hours")?;
    let m: f64 = parts[1].parse().map_err(|_| "Invalid minutes")?;
    let s: f64 = parts[2].parse().map_err(|_| "Invalid seconds")?;
    Ok(h * 3600.0 + m * 60.0 + s)
}

fn hex_to_ass(hex: &str) -> String {
    let hex = hex.trim_start_matches('#');
    if hex.len() == 6 {
        let r = &hex[0..2];
        let g = &hex[2..4];
        let b = &hex[4..6];
        format!("&H00{}{}{}", b, g, r)
    } else {
        "&H00FFFFFF".to_string()
    }
}
