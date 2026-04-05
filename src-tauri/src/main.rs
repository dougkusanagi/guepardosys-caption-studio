#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![allow(dead_code)]
#![allow(non_snake_case)]

mod ffmpeg;
mod preset;
mod subtitle;
mod whisper;

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tauri::Manager;
use uuid::Uuid;

// --- App State ---
struct AppState {
    app_data_dir: PathBuf,
    ffmpeg_path: String,
    ffprobe_path: String,
}

const VALID_WHISPER_MODELS: &[&str] = &["tiny", "base", "small", "medium", "large", "large-v3"];

struct EnsureWhisperModelResult {
    path: PathBuf,
    already_exists: bool,
}

// --- Request Models ---
#[derive(Deserialize)]
struct RemoveSilenceRequest {
    filename: String,
    projectId: String,
    clientId: String,
    model: String,
    language: String,
    minGap: f64,
    padStart: f64,
    padEnd: f64,
    minKeep: f64,
}

#[derive(Deserialize)]
struct SubtitleRequest {
    filename: String,
    projectId: String,
    clientId: String,
    model: String,
    language: String,
    style: Option<HashMap<String, serde_json::Value>>,
}

#[derive(Deserialize)]
struct BurnSubtitleRequest {
    filename: String,
    projectId: String,
    clientId: String,
    sourceFile: String,
    subtitles: Option<Vec<subtitle::SubtitleSegment>>,
    style: Option<HashMap<String, serde_json::Value>>,
}

#[derive(Deserialize)]
struct CropRequest {
    filename: String,
    projectId: String,
    clientId: String,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
}

#[derive(Deserialize)]
struct ExportRequest {
    projectId: String,
    sourceFile: String,
    originalName: Option<String>,
    subtitleContent: Option<String>,
    subtitles: Option<Vec<subtitle::SubtitleSegment>>,
    style: Option<HashMap<String, serde_json::Value>>,
}

// --- Response Types ---
#[derive(Serialize)]
struct Interval {
    start: f64,
    end: f64,
    duration: f64,
}

#[derive(Serialize)]
struct SilenceStats {
    originalDuration: f64,
    keptDuration: f64,
    removedDuration: f64,
    segmentCount: usize,
}

#[derive(Serialize)]
struct RemoveSilenceResponse {
    outputPath: String,
    outputLocalPath: Option<String>,
    intervals: Vec<Interval>,
    stats: SilenceStats,
    waveform: Vec<f64>,
    transcription: whisper::TranscriptionResult,
}

#[derive(Serialize)]
struct SubtitleResponse {
    subtitles: Vec<subtitle::SubtitleSegment>,
    srtPath: String,
    assPath: String,
}

#[derive(Serialize)]
struct BurnSubtitleResponse {
    outputPath: String,
    outputLocalPath: Option<String>,
}

#[derive(Serialize)]
struct CropResponse {
    outputPath: String,
    outputLocalPath: Option<String>,
    info: ffmpeg::VideoInfo,
}

#[derive(Serialize)]
struct ExportResponse {
    cancelled: bool,
    videoPath: Option<String>,
    subtitlePath: Option<String>,
}

// --- Tauri Commands ---

#[tauri::command]
async fn remove_silence(
    state: tauri::State<'_, AppState>,
    req: RemoveSilenceRequest,
    window: tauri::WebviewWindow,
) -> Result<RemoveSilenceResponse, String> {
    let uploads_dir = state.app_data_dir.join("uploads");
    let project_dir = state.app_data_dir.join("processed").join(&req.projectId);
    std::fs::create_dir_all(&project_dir).map_err(|e| e.to_string())?;

    let input_path = uploads_dir.join(&req.filename);
    if !input_path.exists() {
        return Err("Arquivo não encontrado".into());
    }

    ensure_whisper_model(&state.app_data_dir, &req.model, &window, true).await?;

    send_progress(&window, "transcribe", 0, "Extraindo áudio...").await;

    let audio_path = project_dir.join("audio_16k.wav");
    ffmpeg::extract_audio(
        &state.ffmpeg_path,
        &input_path.to_string_lossy(),
        &audio_path.to_string_lossy(),
        16000,
    )
    .map_err(|e| e.to_string())?;

    send_progress(&window, "transcribe", 10, "Transcrevendo com Whisper...").await;

    let window_clone = window.clone();
    let transcription = whisper::transcribe_with_progress(whisper::TranscribeOptions {
        app_data_dir: &state.app_data_dir,
        audio_path: &audio_path,
        model_name: &req.model,
        language: &req.language,
        on_progress: Some(std::sync::Arc::new(std::sync::Mutex::new(Some(Box::new(
            move |pct| {
                let mapped = 10 + (pct * 70 / 100);
                let _ = window_clone.emit(
                    "processing_progress",
                    serde_json::json!({
                        "type": "progress",
                        "stage": "transcribe",
                        "progress": mapped,
                        "message": format!("Transcrevendo com Whisper... {}%", pct),
                    }),
                );
            },
        ))))),
    })
    .await
    .map_err(|e| e.to_string())?;

    send_progress(
        &window,
        "transcribe",
        80,
        "Analisando intervalos de fala...",
    )
    .await;

    let info = ffmpeg::get_video_info(&state.ffprobe_path, &input_path.to_string_lossy())
        .map_err(|e| e.to_string())?;
    let duration = info.duration;

    let intervals =
        whisper::collect_speech_intervals(&transcription, duration, req.padStart, req.padEnd);
    let merged = whisper::merge_intervals(&intervals, req.minGap);
    let final_intervals = whisper::drop_tiny_intervals(&merged, req.minKeep);

    if final_intervals.is_empty() {
        return Err("Nenhuma fala detectada no vídeo".into());
    }

    let kept: f64 = final_intervals.iter().map(|(s, e)| e - s).sum();

    send_progress(&window, "cut", 0, "Cortando vídeo...").await;

    let output_name = format!(
        "processed_{}.mp4",
        Uuid::new_v4()
            .simple()
            .to_string()
            .chars()
            .take(8)
            .collect::<String>()
    );
    let output_path = project_dir.join(&output_name);

    ffmpeg::cut_video_with_progress(
        &state.ffmpeg_path,
        &input_path.to_string_lossy(),
        &output_path.to_string_lossy(),
        &final_intervals,
        |pct| {
            let _ = window.emit(
                "processing_progress",
                serde_json::json!({
                    "type": "progress",
                    "stage": "cut",
                    "progress": pct,
                    "message": format!("Cortando vídeo... {}%", pct),
                }),
            );
        },
    )
    .map_err(|e| e.to_string())?;

    let new_waveform_path = project_dir.join("waveform_processed.json");
    let new_waveform = ffmpeg::generate_waveform(
        &state.ffmpeg_path,
        &output_path.to_string_lossy(),
        &new_waveform_path.to_string_lossy(),
    )
    .map_err(|e| e.to_string())?;

    send_progress(&window, "done", 100, "Concluído!").await;

    Ok(RemoveSilenceResponse {
        outputPath: format!("/processed/{}/{}", req.projectId, output_name),
        outputLocalPath: Some(output_path.to_string_lossy().to_string()),
        intervals: final_intervals
            .iter()
            .map(|(s, e)| Interval {
                start: (*s * 1000.0).round() / 1000.0,
                end: (*e * 1000.0).round() / 1000.0,
                duration: ((*e - *s) * 1000.0).round() / 1000.0,
            })
            .collect(),
        stats: SilenceStats {
            originalDuration: duration,
            keptDuration: (kept * 100.0).round() / 1000.0,
            removedDuration: ((duration - kept) * 100.0).round() / 100.0,
            segmentCount: final_intervals.len(),
        },
        waveform: new_waveform,
        transcription,
    })
}

#[tauri::command]
async fn generate_subtitles(
    state: tauri::State<'_, AppState>,
    req: SubtitleRequest,
    window: tauri::WebviewWindow,
) -> Result<SubtitleResponse, String> {
    let uploads_dir = state.app_data_dir.join("uploads");
    let project_dir = state.app_data_dir.join("processed").join(&req.projectId);
    std::fs::create_dir_all(&project_dir).map_err(|e| e.to_string())?;

    let input_path = uploads_dir.join(&req.filename);
    if !input_path.exists() {
        return Err("Arquivo não encontrado".into());
    }

    ensure_whisper_model(&state.app_data_dir, &req.model, &window, true).await?;

    send_progress(&window, "subtitles", 0, "Extraindo áudio...").await;

    let audio_path = project_dir.join("audio_sub.wav");
    ffmpeg::extract_audio(
        &state.ffmpeg_path,
        &input_path.to_string_lossy(),
        &audio_path.to_string_lossy(),
        16000,
    )
    .map_err(|e| e.to_string())?;

    send_progress(&window, "subtitles", 10, "Gerando legendas com IA...").await;

    let window_clone = window.clone();
    let transcription = whisper::transcribe_with_progress(whisper::TranscribeOptions {
        app_data_dir: &state.app_data_dir,
        audio_path: &audio_path,
        model_name: &req.model,
        language: &req.language,
        on_progress: Some(std::sync::Arc::new(std::sync::Mutex::new(Some(Box::new(
            move |pct| {
                let mapped = 10 + (pct * 85 / 100);
                let _ = window_clone.emit(
                    "processing_progress",
                    serde_json::json!({
                        "type": "progress",
                        "stage": "subtitles",
                        "progress": mapped,
                        "message": format!("Gerando legendas com IA... {}%", pct),
                    }),
                );
            },
        ))))),
    })
    .await
    .map_err(|e| e.to_string())?;

    let subtitles = whisper::get_subtitle_segments(&transcription);

    let srt_path = project_dir.join("subtitles.srt");
    subtitle::write_srt(&subtitles, &srt_path).map_err(|e| e.to_string())?;

    let ass_path = project_dir.join("subtitles.ass");
    let play_res = get_video_play_res(&state, &input_path)?;
    subtitle::write_ass(&subtitles, &ass_path, req.style.as_ref(), Some(play_res))
        .map_err(|e| e.to_string())?;

    send_progress(&window, "subtitles", 100, "Legendas geradas!").await;

    Ok(SubtitleResponse {
        subtitles,
        srtPath: format!("/processed/{}/subtitles.srt", req.projectId),
        assPath: format!("/processed/{}/subtitles.ass", req.projectId),
    })
}

#[tauri::command]
async fn burn_subtitles(
    state: tauri::State<'_, AppState>,
    req: BurnSubtitleRequest,
    window: tauri::WebviewWindow,
) -> Result<BurnSubtitleResponse, String> {
    let project_dir = state.app_data_dir.join("processed").join(&req.projectId);
    let ass_path = project_dir.join("subtitles.ass");

    let source_file = if req.sourceFile.is_empty() {
        format!("/uploads/{}", req.filename)
    } else {
        req.sourceFile
    };
    let input_path = resolve_source_path(&state.app_data_dir, &source_file)?;

    let mut subtitles = req.subtitles.unwrap_or_default();
    if subtitles.is_empty() {
        if !ass_path.exists() {
            return Err("Gere as legendas primeiro".into());
        }
        subtitles =
            subtitle::parse_srt(&project_dir.join("subtitles.srt")).map_err(|e| e.to_string())?;
    }

    let play_res = get_video_play_res(&state, &input_path)?;
    subtitle::write_ass(&subtitles, &ass_path, req.style.as_ref(), Some(play_res))
        .map_err(|e| e.to_string())?;

    send_progress(&window, "burn", 0, "Aplicando legendas...").await;

    let output_name = format!(
        "subtitled_{}.mp4",
        Uuid::new_v4()
            .simple()
            .to_string()
            .chars()
            .take(8)
            .collect::<String>()
    );
    let output_path = project_dir.join(&output_name);

    ffmpeg::burn_subtitles_with_progress(
        &state.ffmpeg_path,
        &input_path.to_string_lossy(),
        &ass_path.to_string_lossy(),
        &output_path.to_string_lossy(),
        |pct| {
            let _ = window.emit(
                "processing_progress",
                serde_json::json!({
                    "type": "progress",
                    "stage": "burn",
                    "progress": pct,
                    "message": format!("Aplicando legendas... {}%", pct),
                }),
            );
        },
    )
    .map_err(|e| e.to_string())?;

    send_progress(&window, "done", 100, "Legendas aplicadas!").await;

    Ok(BurnSubtitleResponse {
        outputPath: format!("/processed/{}/{}", req.projectId, output_name),
        outputLocalPath: Some(output_path.to_string_lossy().to_string()),
    })
}

#[tauri::command]
async fn crop_video(
    state: tauri::State<'_, AppState>,
    req: CropRequest,
    window: tauri::WebviewWindow,
) -> Result<CropResponse, String> {
    let uploads_dir = state.app_data_dir.join("uploads");
    let project_dir = state.app_data_dir.join("processed").join(&req.projectId);
    std::fs::create_dir_all(&project_dir).map_err(|e| e.to_string())?;

    let input_path = uploads_dir.join(&req.filename);
    if !input_path.exists() {
        return Err("Arquivo não encontrado".into());
    }

    send_progress(&window, "crop", 0, "Cortando vídeo...").await;

    let output_name = format!(
        "cropped_{}.mp4",
        Uuid::new_v4()
            .simple()
            .to_string()
            .chars()
            .take(8)
            .collect::<String>()
    );
    let output_path = project_dir.join(&output_name);

    ffmpeg::crop_video_with_progress(
        &state.ffmpeg_path,
        &input_path.to_string_lossy(),
        &output_path.to_string_lossy(),
        req.x,
        req.y,
        req.width,
        req.height,
        |pct| {
            let _ = window.emit(
                "processing_progress",
                serde_json::json!({
                    "type": "progress",
                    "stage": "crop",
                    "progress": pct,
                    "message": format!("Cortando vídeo... {}%", pct),
                }),
            );
        },
    )
    .map_err(|e| e.to_string())?;

    let info = ffmpeg::get_video_info(&state.ffprobe_path, &output_path.to_string_lossy())
        .map_err(|e| e.to_string())?;

    send_progress(&window, "done", 100, "Corte concluído!").await;

    Ok(CropResponse {
        outputPath: format!("/processed/{}/{}", req.projectId, output_name),
        outputLocalPath: Some(output_path.to_string_lossy().to_string()),
        info,
    })
}

#[tauri::command]
async fn upload_video(
    state: tauri::State<'_, AppState>,
    path: String,
    window: tauri::WebviewWindow,
) -> Result<serde_json::Value, String> {
    let input_path = PathBuf::from(&path);
    if !input_path.exists() {
        return Err("Arquivo não encontrado".into());
    }

    let ext = input_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");
    let allowed = ["mp4", "mov", "avi", "mkv", "webm", "m4v", "flv", "wmv"];
    if !allowed.contains(&ext.to_lowercase().as_str()) {
        return Err("Formato não suportado".into());
    }

    let file_id = Uuid::new_v4().to_string();
    let filename = format!("{}.{}", file_id, ext);
    let uploads_dir = state.app_data_dir.join("uploads");
    let file_path = uploads_dir.join(&filename);

    let file_size = input_path.metadata().map_err(|e| e.to_string())?.len();
    let mut copied: u64 = 0;
    let mut last_pct = 0i32;
    {
        let mut src = std::fs::File::open(&input_path).map_err(|e| e.to_string())?;
        let mut dst = std::fs::File::create(&file_path).map_err(|e| e.to_string())?;
        let mut buf = vec![0u8; 1024 * 1024];
        loop {
            let n = std::io::Read::read(&mut src, &mut buf).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            std::io::Write::write_all(&mut dst, &buf[..n]).map_err(|e| e.to_string())?;
            copied += n as u64;
            let pct = ((copied as f64 / file_size as f64) * 40.0) as i32;
            if pct != last_pct {
                last_pct = pct;
                let _ = window.emit(
                    "processing_progress",
                    serde_json::json!({
                        "type": "progress",
                        "stage": "upload",
                        "progress": pct,
                        "message": format!("Carregando vídeo... {}%", pct),
                    }),
                );
            }
        }
    }

    let _ = window.emit(
        "processing_progress",
        serde_json::json!({
            "type": "progress",
            "stage": "upload",
            "progress": 45,
            "message": "Analisando vídeo...",
        }),
    );

    let project_id = Uuid::new_v4().to_string();
    let project_dir = state.app_data_dir.join("processed").join(&project_id);
    std::fs::create_dir_all(&project_dir).map_err(|e| e.to_string())?;

    let info = ffmpeg::get_video_info(&state.ffprobe_path, &file_path.to_string_lossy())
        .map_err(|e| e.to_string())?;

    let _ = window.emit(
        "processing_progress",
        serde_json::json!({
            "type": "progress",
            "stage": "upload",
            "progress": 60,
            "message": "Gerando waveform...",
        }),
    );

    let waveform_path = project_dir.join("waveform.json");
    let waveform = ffmpeg::generate_waveform(
        &state.ffmpeg_path,
        &file_path.to_string_lossy(),
        &waveform_path.to_string_lossy(),
    )
    .map_err(|e| e.to_string())?;

    let _ = window.emit(
        "processing_progress",
        serde_json::json!({
            "type": "progress",
            "stage": "upload",
            "progress": 100,
            "message": "Vídeo carregado!",
        }),
    );

    let original_name = input_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("video.mp4");

    Ok(serde_json::json!({
        "projectId": project_id,
        "file": {
            "originalName": original_name,
            "filename": filename,
            "path": format!("/uploads/{}", filename),
            "size": file_size,
            "_localPath": file_path.to_string_lossy().to_string(),
        },
        "info": info,
        "waveform": waveform,
    }))
}

#[tauri::command]
fn get_app_data_dir(state: tauri::State<'_, AppState>) -> String {
    state.app_data_dir.to_string_lossy().to_string()
}

#[tauri::command]
fn list_presets(state: tauri::State<'_, AppState>) -> Result<Vec<preset::Preset>, String> {
    preset::list_presets(&state.app_data_dir).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_preset(
    state: tauri::State<'_, AppState>,
    name: String,
    style: HashMap<String, serde_json::Value>,
) -> Result<preset::Preset, String> {
    preset::create_preset(&state.app_data_dir, &name, style).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_preset(
    state: tauri::State<'_, AppState>,
    preset_id: String,
    name: Option<String>,
    style: Option<HashMap<String, serde_json::Value>>,
) -> Result<preset::Preset, String> {
    preset::update_preset(&state.app_data_dir, &preset_id, name, style).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_preset(state: tauri::State<'_, AppState>, preset_id: String) -> Result<(), String> {
    preset::delete_preset(&state.app_data_dir, &preset_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn send_notification(app: tauri::AppHandle, title: String, body: String) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    app.notification()
        .builder()
        .title(&title)
        .body(&body)
        .show()
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn save_project(
    state: tauri::State<'_, AppState>,
    data: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let name = data
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("untitled")
        .trim()
        .to_string();
    if name.is_empty() {
        return Err("Nome do projeto é obrigatório".into());
    }

    let safe_name: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || " _-".contains(c) {
                c
            } else {
                '_'
            }
        })
        .collect();
    let projects_dir = state.app_data_dir.join("projects");

    std::fs::create_dir_all(&projects_dir).map_err(|e| e.to_string())?;

    let file_path = projects_dir.join(format!("{}.json", safe_name));

    let mut data = data;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    data["savedAt"] = serde_json::json!(now);
    data["savedPath"] = serde_json::json!(file_path.to_string_lossy().to_string());

    std::fs::write(
        &file_path,
        serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    Ok(
        serde_json::json!({ "ok": true, "name": name.clone(), "savedPath": file_path.to_string_lossy().to_string() }),
    )
}

#[tauri::command]
fn list_projects(state: tauri::State<'_, AppState>) -> Result<Vec<serde_json::Value>, String> {
    let projects_dir = state.app_data_dir.join("projects");
    let mut projects = Vec::new();

    if projects_dir.exists() {
        let mut entries: Vec<_> = std::fs::read_dir(&projects_dir)
            .map_err(|e| e.to_string())?
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().and_then(|ext| ext.to_str()) == Some("json"))
            .collect();

        entries.sort_by_key(|e| {
            e.metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
        });
        entries.reverse();

        for entry in entries {
            if let Ok(text) = std::fs::read_to_string(entry.path()) {
                if let Ok(data) = serde_json::from_str::<serde_json::Value>(&text) {
                    let fallback_name = entry
                        .path()
                        .file_stem()
                        .and_then(|s| s.to_str())
                        .unwrap_or("unknown")
                        .to_string();
                    projects.push(serde_json::json!({
                        "name": data.get("name").and_then(|v| v.as_str()).unwrap_or(&fallback_name),
                        "originalName": data.get("originalName").and_then(|v| v.as_str()).unwrap_or(""),
                        "date": data.get("savedAt").and_then(|v| v.as_str()).unwrap_or(""),
                        "file": entry.file_name().to_string_lossy().to_string(),
                    }));
                }
            }
        }
    }

    Ok(projects)
}

#[tauri::command]
fn load_project(
    state: tauri::State<'_, AppState>,
    project_name: String,
) -> Result<serde_json::Value, String> {
    let safe_name: String = project_name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || " _-".contains(c) {
                c
            } else {
                '_'
            }
        })
        .collect();
    let file_path = state
        .app_data_dir
        .join("projects")
        .join(format!("{}.json", safe_name));

    if !file_path.exists() {
        return Err("Projeto não encontrado".into());
    }

    let text = std::fs::read_to_string(&file_path).map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_project(state: tauri::State<'_, AppState>, project_name: String) -> Result<(), String> {
    let safe_name: String = project_name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || " _-".contains(c) {
                c
            } else {
                '_'
            }
        })
        .collect();
    let file_path = state
        .app_data_dir
        .join("projects")
        .join(format!("{}.json", safe_name));

    if file_path.exists() {
        std::fs::remove_file(&file_path).map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
fn save_project_dialog(
    state: tauri::State<'_, AppState>,
    data: serde_json::Value,
    app: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    use tauri_plugin_dialog::DialogExt;

    let name = data
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("untitled")
        .trim()
        .to_string();
    if name.is_empty() {
        return Err("Nome do projeto é obrigatório".into());
    }

    let safe_name: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || " _-".contains(c) {
                c
            } else {
                '_'
            }
        })
        .collect();

    let file_path = app
        .dialog()
        .file()
        .set_file_name(&format!("{}.json", safe_name))
        .add_filter("JSON", &["json"])
        .blocking_save_file();

    let file_path = file_path.ok_or_else(|| "Save cancelled".to_string())?;

    let path_buf = match &file_path {
        tauri_plugin_dialog::FilePath::Path(p) => p.clone(),
        tauri_plugin_dialog::FilePath::Url(u) => u
            .to_file_path()
            .map_err(|_| "Invalid file URI".to_string())?,
    };

    let mut data = data;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let path_str = path_buf.to_string_lossy().to_string();
    data["savedAt"] = serde_json::json!(now);
    data["savedPath"] = serde_json::json!(path_str.clone());

    std::fs::write(
        &path_buf,
        serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    let projects_dir = state.app_data_dir.join("projects");
    std::fs::create_dir_all(&projects_dir).map_err(|e| e.to_string())?;
    let internal_path = projects_dir.join(format!("{}.json", safe_name));
    std::fs::write(
        &internal_path,
        serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    Ok(serde_json::json!({ "ok": true, "name": name.clone(), "savedPath": path_str }))
}

#[tauri::command]
fn export_video(
    state: tauri::State<'_, AppState>,
    req: ExportRequest,
    app: tauri::AppHandle,
) -> Result<ExportResponse, String> {
    use tauri_plugin_dialog::DialogExt;

    let source_path = resolve_source_path(&state.app_data_dir, &req.sourceFile)?;
    if !source_path.exists() {
        return Err(format!(
            "Arquivo de origem não encontrado: {}",
            source_path.display()
        ));
    }

    let base_name = export_base_name(
        req.originalName.as_deref(),
        source_path.file_stem().and_then(|stem| stem.to_str()),
    );
    let extension = source_path
        .extension()
        .and_then(|ext| ext.to_str())
        .filter(|ext| !ext.trim().is_empty())
        .unwrap_or("mp4");
    let suggested_name = format!("{}.{}", base_name, extension);

    let file_path = app
        .dialog()
        .file()
        .set_title("Escolha onde salvar o vídeo exportado")
        .set_file_name(&suggested_name)
        .add_filter("Vídeo", &[extension])
        .blocking_save_file();

    let Some(file_path) = file_path else {
        return Ok(ExportResponse {
            cancelled: true,
            videoPath: None,
            subtitlePath: None,
        });
    };

    let selected_path = dialog_file_path_to_path_buf(&file_path)?;
    let video_path = ensure_path_extension(&selected_path, extension);
    let export_dir = video_path.parent().ok_or_else(|| {
        format!(
            "Não foi possível determinar a pasta de destino para {}",
            video_path.display()
        )
    })?;
    std::fs::create_dir_all(export_dir).map_err(|e| e.to_string())?;
    std::fs::copy(&source_path, &video_path)
        .map_err(|e| format!("Falha ao exportar vídeo: {}", e))?;

    let subtitle_path = {
        let subtitle_stem = video_path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .filter(|stem| !stem.trim().is_empty())
            .unwrap_or(&base_name);

        if let Some(subtitles) = req.subtitles.as_ref().filter(|items| !items.is_empty()) {
            let path = export_dir.join(format!("{}_legendas.ass", subtitle_stem));
            let play_res = get_video_play_res(&state, &source_path)?;
            subtitle::write_ass(subtitles, &path, req.style.as_ref(), Some(play_res))
                .map_err(|e| format!("Falha ao exportar legendas: {}", e))?;
            Some(path)
        } else if let Some(content) = req
            .subtitleContent
            .as_ref()
            .filter(|text| !text.trim().is_empty())
        {
            let path = export_dir.join(format!("{}_legendas.ass", subtitle_stem));
            std::fs::write(&path, content)
                .map_err(|e| format!("Falha ao exportar legendas: {}", e))?;
            Some(path)
        } else {
            None
        }
    };

    Ok(ExportResponse {
        cancelled: false,
        videoPath: Some(video_path.to_string_lossy().to_string()),
        subtitlePath: subtitle_path.map(|path| path.to_string_lossy().to_string()),
    })
}

#[tauri::command]
fn list_models(state: tauri::State<'_, AppState>) -> Vec<serde_json::Value> {
    let models_dir = state.app_data_dir.join("whisper-models");
    let mut models = Vec::new();

    if models_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&models_dir) {
            for entry in entries.filter_map(|e| e.ok()) {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) == Some("bin") {
                    if let Ok(metadata) = path.metadata() {
                        let name = path
                            .file_stem()
                            .and_then(|s| s.to_str())
                            .unwrap_or("")
                            .trim_start_matches("ggml-")
                            .to_string();
                        models.push(serde_json::json!({
                            "name": name,
                            "size_mb": (metadata.len() as f64) / (1024.0 * 1024.0),
                            "path": path.to_string_lossy().to_string(),
                        }));
                    }
                }
            }
        }
    }

    models
}

#[tauri::command]
async fn download_model(
    state: tauri::State<'_, AppState>,
    model: String,
    window: tauri::WebviewWindow,
) -> Result<serde_json::Value, String> {
    let ensure_result = ensure_whisper_model(&state.app_data_dir, &model, &window, false).await?;

    Ok(serde_json::json!({
        "name": model,
        "path": ensure_result.path.to_string_lossy().to_string(),
        "already_exists": ensure_result.already_exists,
        "downloaded": !ensure_result.already_exists,
    }))
}

// --- Helpers ---

fn validate_whisper_model(model: &str) -> Result<(), String> {
    if VALID_WHISPER_MODELS.contains(&model) {
        return Ok(());
    }

    Err(format!(
        "Modelo inválido. Opções: {}",
        VALID_WHISPER_MODELS.join(", ")
    ))
}

fn whisper_model_path(app_data_dir: &Path, model: &str) -> PathBuf {
    app_data_dir
        .join("whisper-models")
        .join(format!("ggml-{}.bin", model))
}

fn emit_model_download_progress(
    window: &tauri::WebviewWindow,
    progress: i32,
    message: &str,
    mirror_to_processing: bool,
) {
    let _ = window.emit(
        "model_download_progress",
        serde_json::json!({
            "progress": progress,
            "message": message,
        }),
    );

    if mirror_to_processing {
        let _ = window.emit(
            "processing_progress",
            serde_json::json!({
                "type": "progress",
                "stage": "model_download",
                "progress": progress,
                "message": message,
            }),
        );
    }
}

async fn ensure_whisper_model(
    app_data_dir: &Path,
    model: &str,
    window: &tauri::WebviewWindow,
    mirror_to_processing: bool,
) -> Result<EnsureWhisperModelResult, String> {
    validate_whisper_model(model)?;

    let models_dir = app_data_dir.join("whisper-models");
    std::fs::create_dir_all(&models_dir).map_err(|e| e.to_string())?;

    let dest = whisper_model_path(app_data_dir, model);
    if dest.exists() {
        return Ok(EnsureWhisperModelResult {
            path: dest,
            already_exists: true,
        });
    }

    emit_model_download_progress(
        window,
        0,
        &format!("Baixando modelo Whisper {}...", model),
        mirror_to_processing,
    );

    let model_name = model.to_string();
    let progress_window = window.clone();
    let url = format!(
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{}.bin",
        model
    );

    whisper::download_model(&url, &dest, move |progress| {
        let pct = (progress * 100.0).round() as i32;
        emit_model_download_progress(
            &progress_window,
            pct,
            &format!("Baixando modelo Whisper {}... {}%", model_name, pct),
            mirror_to_processing,
        );
    })
    .await
    .map_err(|e| format!("Falha ao baixar modelo '{}': {}", model, e))?;

    emit_model_download_progress(
        window,
        100,
        &format!("Modelo Whisper {} pronto.", model),
        mirror_to_processing,
    );

    Ok(EnsureWhisperModelResult {
        path: dest,
        already_exists: false,
    })
}

fn normalize_path_for_comparison(path: &std::path::Path) -> PathBuf {
    #[cfg(windows)]
    {
        let raw = path.to_string_lossy();
        if let Some(stripped) = raw.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{}", stripped));
        }
        if let Some(stripped) = raw.strip_prefix(r"\\?\") {
            return PathBuf::from(stripped);
        }
    }

    path.to_path_buf()
}

fn dialog_file_path_to_path_buf(
    file_path: &tauri_plugin_dialog::FilePath,
) -> Result<PathBuf, String> {
    match file_path {
        tauri_plugin_dialog::FilePath::Path(path) => Ok(path.clone()),
        tauri_plugin_dialog::FilePath::Url(url) => url
            .to_file_path()
            .map_err(|_| "Invalid file URI".to_string()),
    }
}

fn ensure_path_extension(path: &std::path::Path, extension: &str) -> PathBuf {
    let clean_ext = extension.trim().trim_start_matches('.');
    if clean_ext.is_empty() {
        return path.to_path_buf();
    }

    match path.extension().and_then(|ext| ext.to_str()) {
        Some(current) if current.eq_ignore_ascii_case(clean_ext) => path.to_path_buf(),
        _ => path.with_extension(clean_ext),
    }
}

fn sanitize_filename_stem(value: &str) -> String {
    let sanitized: String = value
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == ' ' || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let collapsed = sanitized.trim().trim_matches('.').to_string();
    if collapsed.is_empty() {
        "studiocut_export".to_string()
    } else {
        collapsed
    }
}

fn export_base_name(original_name: Option<&str>, fallback_stem: Option<&str>) -> String {
    let raw = original_name
        .and_then(|name| {
            std::path::Path::new(name)
                .file_stem()
                .and_then(|stem| stem.to_str())
        })
        .or(fallback_stem)
        .unwrap_or("studiocut_export");
    let stem = sanitize_filename_stem(raw);
    if stem.to_ascii_lowercase().ends_with("_studiocut") {
        stem
    } else {
        format!("{}_studiocut", stem)
    }
}

fn next_available_path(dir: &std::path::Path, stem: &str, extension: &str) -> PathBuf {
    let clean_ext = extension.trim().trim_start_matches('.');
    let with_ext = |name: &str| {
        if clean_ext.is_empty() {
            dir.join(name)
        } else {
            dir.join(format!("{}.{}", name, clean_ext))
        }
    };

    let mut candidate = with_ext(stem);
    let mut counter = 2;
    while candidate.exists() {
        candidate = with_ext(&format!("{} ({})", stem, counter));
        counter += 1;
    }

    candidate
}

fn resolve_source_path(
    app_data_dir: &std::path::Path,
    source_file: &str,
) -> Result<PathBuf, String> {
    let trimmed = source_file.trim_start_matches('/');
    let source = app_data_dir.join(trimmed);

    if !source.exists() {
        return Err(format!(
            "Arquivo de origem não encontrado: {}",
            source.display()
        ));
    }

    let allowed_root = app_data_dir
        .canonicalize()
        .unwrap_or_else(|_| app_data_dir.to_path_buf());
    let normalized_allowed_root = normalize_path_for_comparison(&allowed_root);

    match source.canonicalize() {
        Ok(canonical) => {
            if normalize_path_for_comparison(&canonical).starts_with(&normalized_allowed_root) {
                Ok(canonical)
            } else {
                Err(format!(
                    "Arquivo fora do diretório permitido: {}",
                    canonical.display()
                ))
            }
        }
        Err(e) => {
            // Fallback: use the path as-is if canonicalize fails (e.g., Windows long paths)
            if normalize_path_for_comparison(&source).starts_with(&normalized_allowed_root) {
                Ok(source)
            } else {
                Err(format!(
                    "Erro ao resolver caminho: {} ({})",
                    e,
                    source.display()
                ))
            }
        }
    }
}

fn get_video_play_res(state: &AppState, path: &std::path::Path) -> Result<(u32, u32), String> {
    let info = ffmpeg::get_video_info(&state.ffprobe_path, &path.to_string_lossy())
        .map_err(|e| e.to_string())?;
    let width = info.video.as_ref().map(|v| v.width).unwrap_or(1920) as u32;
    let height = info.video.as_ref().map(|v| v.height).unwrap_or(1080) as u32;
    Ok((width, height))
}

async fn send_progress(window: &tauri::WebviewWindow, stage: &str, progress: i32, message: &str) {
    let _ = window.emit(
        "processing_progress",
        serde_json::json!({
            "type": "progress",
            "stage": stage,
            "progress": progress,
            "message": message,
        }),
    );
}

// --- Main ---

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data dir");
            std::fs::create_dir_all(&app_data_dir).ok();
            std::fs::create_dir_all(app_data_dir.join("uploads")).ok();
            std::fs::create_dir_all(app_data_dir.join("processed")).ok();
            std::fs::create_dir_all(app_data_dir.join("projects")).ok();
            std::fs::create_dir_all(app_data_dir.join("whisper-models")).ok();

            preset::init_presets(&app_data_dir).ok();

            init_bundled_model(app.handle(), &app_data_dir).ok();

            let ffmpeg_path = resolve_sidecar_path(app.handle(), "ffmpeg");
            let ffprobe_path = resolve_sidecar_path(app.handle(), "ffprobe");

            app.manage(AppState {
                app_data_dir,
                ffmpeg_path,
                ffprobe_path,
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            upload_video,
            remove_silence,
            generate_subtitles,
            burn_subtitles,
            crop_video,
            get_app_data_dir,
            list_presets,
            create_preset,
            update_preset,
            delete_preset,
            save_project,
            save_project_dialog,
            export_video,
            list_projects,
            load_project,
            delete_project,
            list_models,
            download_model,
            send_notification,
        ])
        .run(tauri::generate_context!())
        .expect("error while running StudioCut");
}

fn init_bundled_model(
    app_handle: &tauri::AppHandle,
    app_data_dir: &std::path::Path,
) -> Result<(), String> {
    let models_dir = app_data_dir.join("whisper-models");
    let dest = models_dir.join("ggml-tiny.bin");

    if dest.exists() {
        return Ok(());
    }

    if let Ok(resource_path) = app_handle
        .path()
        .resolve("models/ggml-tiny.bin", tauri::path::BaseDirectory::Resource)
    {
        if resource_path.exists() {
            std::fs::copy(&resource_path, &dest)
                .map_err(|e| format!("Falha ao copiar modelo embutido: {}", e))?;
        }
    }

    Ok(())
}

fn resolve_sidecar_path(app_handle: &tauri::AppHandle, name: &str) -> String {
    let target = std::env::consts::ARCH;
    let triple = if cfg!(target_os = "windows") {
        format!("{}-pc-windows-msvc", target)
    } else if cfg!(target_os = "macos") {
        format!("{}-apple-darwin", target)
    } else {
        format!("{}-unknown-linux-gnu", target)
    };

    let mut candidates = vec![format!("{}-{}", name, triple), name.to_string()];
    if cfg!(target_os = "windows") {
        candidates.insert(0, format!("{}-{}.exe", name, triple));
        candidates.insert(1, format!("{}.exe", name));
    }

    for candidate in candidates {
        if let Ok(path) = app_handle.path().resolve(
            format!("binaries/{}", candidate),
            tauri::path::BaseDirectory::Resource,
        ) {
            if path.exists() {
                return path.to_string_lossy().to_string();
            }
        }

        if let Ok(current_exe) = std::env::current_exe() {
            if let Some(exe_dir) = current_exe.parent() {
                let exe_path = exe_dir.join(&candidate);
                if exe_path.exists() {
                    return exe_path.to_string_lossy().to_string();
                }
            }
        }

        let dev_path = std::env::current_dir()
            .ok()
            .map(|cwd| cwd.join("src-tauri").join("binaries").join(&candidate));
        if let Some(ref p) = dev_path {
            if p.exists() {
                return p.to_string_lossy().to_string();
            }
        }
    }

    name.to_string()
}
