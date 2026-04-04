use std::process::Command;

use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct VideoInfo {
    pub duration: f64,
    pub size: i64,
    pub bitrate: i64,
    pub format: String,
    pub video: Option<VideoStream>,
    pub audio: Option<AudioStream>,
}

#[derive(Serialize, Clone)]
pub struct VideoStream {
    pub codec: String,
    pub width: i64,
    pub height: i64,
    pub fps: f64,
}

#[derive(Serialize, Clone)]
pub struct AudioStream {
    pub codec: String,
    pub sample_rate: i64,
    pub channels: i64,
}

pub fn get_video_info(ffprobe_path: &str, path: &str) -> Result<VideoInfo, String> {
    let output = Command::new(ffprobe_path)
        .args([
            "-v", "error",
            "-show_format", "-show_streams",
            "-print_format", "json",
            path,
        ])
        .output()
        .map_err(|e| format!("Não foi possível executar ffprobe: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffprobe falhou: {}", stderr.lines().last().unwrap_or("erro desconhecido")));
    }

    let data: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Não foi possível interpretar resposta do ffprobe: {}", e))?;

    let fmt = data.get("format").and_then(|v| v.as_object()).cloned().unwrap_or_default();
    let streams = data.get("streams").and_then(|v| v.as_array()).cloned().unwrap_or_default();

    let video_stream = streams.iter().find(|s| s.get("codec_type").and_then(|v| v.as_str()) == Some("video"));
    let audio_stream = streams.iter().find(|s| s.get("codec_type").and_then(|v| v.as_str()) == Some("audio"));

    let fps = video_stream
        .and_then(|s| s.get("r_frame_rate").and_then(|v| v.as_str()))
        .map(|r| {
            let parts: Vec<&str> = r.split('/').collect();
            if parts.len() == 2 {
                let num: f64 = parts[0].parse().unwrap_or(30.0);
                let den: f64 = parts[1].parse().unwrap_or(1.0);
                if den > 0.0 { num / den } else { 30.0 }
            } else { 30.0 }
        })
        .unwrap_or(30.0);

    Ok(VideoInfo {
        duration: fmt.get("duration").and_then(|v| v.as_f64()).unwrap_or(0.0),
        size: fmt.get("size").and_then(|v| v.as_i64()).unwrap_or(0),
        bitrate: fmt.get("bit_rate").and_then(|v| v.as_i64()).unwrap_or(0),
        format: fmt.get("format_name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        video: video_stream.map(|s| VideoStream {
            codec: s.get("codec_name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            width: s.get("width").and_then(|v| v.as_i64()).unwrap_or(0),
            height: s.get("height").and_then(|v| v.as_i64()).unwrap_or(0),
            fps: (fps * 100.0).round() / 100.0,
        }),
        audio: audio_stream.map(|s| AudioStream {
            codec: s.get("codec_name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            sample_rate: s.get("sample_rate").and_then(|v| v.as_str()).and_then(|v| v.parse().ok()).unwrap_or(44100),
            channels: s.get("channels").and_then(|v| v.as_i64()).unwrap_or(2),
        }),
    })
}

pub fn extract_audio(ffmpeg_path: &str, input: &str, output: &str, sample_rate: u32) -> Result<(), String> {
    let output = Command::new(ffmpeg_path)
        .args([
            "-y", "-i", input,
            "-vn", "-ac", "1", "-ar", &sample_rate.to_string(),
            "-c:a", "pcm_s16le", output,
        ])
        .output()
        .map_err(|e| format!("Falha ao executar ffmpeg: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Falha ao extrair áudio: {}", stderr.lines().last().unwrap_or("erro desconhecido")));
    }

    Ok(())
}

pub fn generate_waveform(ffmpeg_path: &str, input: &str, output: &str) -> Result<Vec<f64>, String> {
    let raw_path = format!("{}.tmp.raw", output);

    let output_cmd = Command::new(ffmpeg_path)
        .args([
            "-y", "-i", input,
            "-vn", "-ac", "1", "-ar", "400",
            "-f", "s16le", &raw_path,
        ])
        .output()
        .map_err(|e| format!("Falha ao executar ffmpeg: {}", e))?;

    if !output_cmd.status.success() {
        let stderr = String::from_utf8_lossy(&output_cmd.stderr);
        return Err(format!("Falha ao gerar waveform: {}", stderr.lines().last().unwrap_or("erro desconhecido")));
    }

    let raw_data = std::fs::read(&raw_path).map_err(|e| format!("Falha ao ler raw: {}", e))?;
    let mut samples = Vec::new();

    for i in (0..raw_data.len()).step_by(2) {
        if i + 1 < raw_data.len() {
            let val = i16::from_le_bytes([raw_data[i], raw_data[i + 1]]);
            samples.push((val as f64).abs() / 32768.0);
        }
    }

    let target = samples.len().min(6000);
    let step = (samples.len() / target).max(1);
    let mut peaks: Vec<f64> = Vec::new();

    for i in (0..samples.len()).step_by(step) {
        let chunk = &samples[i..(i + step).min(samples.len())];
        peaks.push(chunk.iter().cloned().fold(0.0f64, f64::max));
    }

    let mut non_zero: Vec<f64> = peaks.iter().filter(|&&v| v > 0.0).copied().collect();
    non_zero.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let reference_peak = non_zero
        .get((non_zero.len() as f64 * 0.985) as usize)
        .copied()
        .unwrap_or_else(|| peaks.iter().cloned().fold(0.0f64, f64::max));

    let normalized: Vec<f64> = peaks
        .iter()
        .map(|&p| {
            if reference_peak > 0.0 && p > 0.0 {
                let scaled = (p / reference_peak).min(1.0);
                (scaled.powf(0.62) * 10000.0).round() / 10000.0
            } else {
                0.0
            }
        })
        .collect();

    let json = serde_json::to_string(&normalized).map_err(|e| e.to_string())?;
    std::fs::write(output, json).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&raw_path);

    Ok(normalized)
}

fn build_filter_complex(intervals: &[(f64, f64)]) -> String {
    let mut parts = Vec::new();
    for (i, (start, end)) in intervals.iter().enumerate() {
        parts.push(format!("[0:v]trim=start={:.6}:end={:.6},setpts=PTS-STARTPTS[v{}]", start, end, i));
        parts.push(format!("[0:a]atrim=start={:.6}:end={:.6},asetpts=PTS-STARTPTS[a{}]", start, end, i));
    }

    let concat_inputs: String = (0..intervals.len())
        .map(|i| format!("[v{}][a{}]", i, i))
        .collect();
    parts.push(format!(
        "{}concat=n={}:v=1:a=1[outv][outa]",
        concat_inputs,
        intervals.len()
    ));

    parts.join(";")
}

pub fn cut_video(ffmpeg_path: &str, input: &str, output: &str, intervals: &[(f64, f64)]) -> Result<(), String> {
    if intervals.is_empty() {
        return Err("Nenhum intervalo disponível para processar".into());
    }

    let filter_complex = build_filter_complex(intervals);
    let args = vec![
        "-y", "-i", input,
        "-filter_complex", &filter_complex,
        "-map", "[outv]", "-map", "[outa]",
        "-c:v", "libx264", "-preset", "medium", "-crf", "18",
        "-c:a", "aac", "-b:a", "192k",
        output,
    ];

    let output_cmd = Command::new(ffmpeg_path)
        .args(&args)
        .output()
        .map_err(|e| format!("Falha ao executar ffmpeg: {}", e))?;

    if !output_cmd.status.success() {
        let stderr = String::from_utf8_lossy(&output_cmd.stderr);
        return Err(format!("Falha ao cortar vídeo: {}", stderr.lines().last().unwrap_or("erro desconhecido")));
    }

    Ok(())
}

pub fn crop_video(
    ffmpeg_path: &str,
    input: &str,
    output: &str,
    x: i32, y: i32, width: i32, height: i32,
) -> Result<(), String> {
    let output_cmd = Command::new(ffmpeg_path)
        .args([
            "-y", "-i", input,
            "-vf", &format!("crop={}:{height}:{x}:{y}", width),
            "-c:v", "libx264", "-preset", "medium", "-crf", "18",
            "-c:a", "aac", "-b:a", "192k",
            output,
        ])
        .output()
        .map_err(|e| format!("Falha ao executar ffmpeg: {}", e))?;

    if !output_cmd.status.success() {
        let stderr = String::from_utf8_lossy(&output_cmd.stderr);
        return Err(format!("Falha ao recortar vídeo: {}", stderr.lines().last().unwrap_or("erro desconhecido")));
    }

    Ok(())
}

pub fn burn_subtitles(ffmpeg_path: &str, input: &str, ass_path: &str, output: &str) -> Result<(), String> {
    let escaped = ass_path.replace('\\', "/").replace(':', "\\:");
    let output_cmd = Command::new(ffmpeg_path)
        .args([
            "-y", "-i", input,
            "-vf", &format!("ass='{}'", escaped),
            "-c:v", "libx264", "-preset", "medium", "-crf", "18",
            "-c:a", "aac", "-b:a", "192k",
            output,
        ])
        .output()
        .map_err(|e| format!("Falha ao executar ffmpeg: {}", e))?;

    if !output_cmd.status.success() {
        let stderr = String::from_utf8_lossy(&output_cmd.stderr);
        return Err(format!("Falha ao aplicar as legendas: {}", stderr.lines().last().unwrap_or("erro desconhecido")));
    }

    Ok(())
}
