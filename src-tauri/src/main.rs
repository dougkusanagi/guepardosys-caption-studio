#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![allow(dead_code)]
#![allow(non_snake_case)]

mod ffmpeg;
mod preset;
mod subtitle;
mod whisper;

use std::collections::HashMap;
use std::path::PathBuf;

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

    let transcription = whisper::transcribe(&state.app_data_dir, &audio_path, &req.model, &req.language)
        .await
        .map_err(|e| e.to_string())?;

    send_progress(&window, "transcribe", 80, "Analisando intervalos de fala...").await;

    let info = ffmpeg::get_video_info(&state.ffprobe_path, &input_path.to_string_lossy())
        .map_err(|e| e.to_string())?;
    let duration = info.duration;

    let intervals = whisper::collect_speech_intervals(&transcription, duration, req.padStart, req.padEnd);
    let merged = whisper::merge_intervals(&intervals, req.minGap);
    let final_intervals = whisper::drop_tiny_intervals(&merged, req.minKeep);

    if final_intervals.is_empty() {
        return Err("Nenhuma fala detectada no vídeo".into());
    }

    let kept: f64 = final_intervals.iter().map(|(s, e)| e - s).sum();

    send_progress(&window, "cut", 0, "Cortando vídeo...").await;

    let output_name = format!("processed_{}.mp4", Uuid::new_v4().simple().to_string().chars().take(8).collect::<String>());
    let output_path = project_dir.join(&output_name);

    ffmpeg::cut_video(
        &state.ffmpeg_path,
        &input_path.to_string_lossy(),
        &output_path.to_string_lossy(),
        &final_intervals,
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

    let transcription = whisper::transcribe(&state.app_data_dir, &audio_path, &req.model, &req.language)
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
    let input_path = resolve_source_path(&state.app_data_dir, &source_file)
        .ok_or_else(|| "Arquivo de origem não encontrado".to_string())?;

    if !input_path.exists() {
        return Err("Arquivo de origem não encontrado".into());
    }

    let mut subtitles = req.subtitles.unwrap_or_default();
    if subtitles.is_empty() {
        if !ass_path.exists() {
            return Err("Gere as legendas primeiro".into());
        }
        subtitles = subtitle::parse_srt(&project_dir.join("subtitles.srt"))
            .map_err(|e| e.to_string())?;
    }

    let play_res = get_video_play_res(&state, &input_path)?;
    subtitle::write_ass(&subtitles, &ass_path, req.style.as_ref(), Some(play_res))
        .map_err(|e| e.to_string())?;

    send_progress(&window, "burn", 0, "Aplicando legendas...").await;

    let output_name = format!("subtitled_{}.mp4", Uuid::new_v4().simple().to_string().chars().take(8).collect::<String>());
    let output_path = project_dir.join(&output_name);

    ffmpeg::burn_subtitles(
        &state.ffmpeg_path,
        &input_path.to_string_lossy(),
        &ass_path.to_string_lossy(),
        &output_path.to_string_lossy(),
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

    let output_name = format!("cropped_{}.mp4", Uuid::new_v4().simple().to_string().chars().take(8).collect::<String>());
    let output_path = project_dir.join(&output_name);

    ffmpeg::crop_video(
        &state.ffmpeg_path,
        &input_path.to_string_lossy(),
        &output_path.to_string_lossy(),
        req.x,
        req.y,
        req.width,
        req.height,
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
) -> Result<serde_json::Value, String> {
    let input_path = PathBuf::from(&path);
    if !input_path.exists() {
        return Err("Arquivo não encontrado".into());
    }

    let ext = input_path.extension().and_then(|e| e.to_str()).unwrap_or("");
    let allowed = ["mp4", "mov", "avi", "mkv", "webm", "m4v", "flv", "wmv"];
    if !allowed.contains(&ext.to_lowercase().as_str()) {
        return Err("Formato não suportado".into());
    }

    let file_id = Uuid::new_v4().to_string();
    let filename = format!("{}.{}", file_id, ext);
    let uploads_dir = state.app_data_dir.join("uploads");
    let file_path = uploads_dir.join(&filename);
    std::fs::copy(&input_path, &file_path).map_err(|e| e.to_string())?;

    let project_id = Uuid::new_v4().to_string();
    let project_dir = state.app_data_dir.join("processed").join(&project_id);
    std::fs::create_dir_all(&project_dir).map_err(|e| e.to_string())?;

    let info = ffmpeg::get_video_info(&state.ffprobe_path, &file_path.to_string_lossy())
        .map_err(|e| e.to_string())?;

    let waveform_path = project_dir.join("waveform.json");
    let waveform = ffmpeg::generate_waveform(
        &state.ffmpeg_path,
        &file_path.to_string_lossy(),
        &waveform_path.to_string_lossy(),
    )
    .map_err(|e| e.to_string())?;

    let file_size = file_path.metadata().map_err(|e| e.to_string())?.len();
    let original_name = input_path.file_name().and_then(|n| n.to_str()).unwrap_or("video.mp4");

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
fn save_project(
    state: tauri::State<'_, AppState>,
    data: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let name = data.get("name").and_then(|v| v.as_str()).unwrap_or("untitled").trim().to_string();
    if name.is_empty() {
        return Err("Nome do projeto é obrigatório".into());
    }

    let safe_name: String = name.chars().map(|c| if c.is_alphanumeric() || " _-".contains(c) { c } else { '_' }).collect();
    let projects_dir = state.app_data_dir.join("projects");
    let file_path = projects_dir.join(format!("{}.json", safe_name));

    let mut data = data;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    data["savedAt"] = serde_json::json!(now);

    std::fs::write(
        &file_path,
        serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    Ok(serde_json::json!({ "ok": true, "name": name.clone() }))
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
                    let fallback_name = entry.path().file_stem()
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
fn load_project(state: tauri::State<'_, AppState>, project_name: String) -> Result<serde_json::Value, String> {
    let safe_name: String = project_name.chars().map(|c| if c.is_alphanumeric() || " _-".contains(c) { c } else { '_' }).collect();
    let file_path = state.app_data_dir.join("projects").join(format!("{}.json", safe_name));

    if !file_path.exists() {
        return Err("Projeto não encontrado".into());
    }

    let text = std::fs::read_to_string(&file_path).map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_project(state: tauri::State<'_, AppState>, project_name: String) -> Result<(), String> {
    let safe_name: String = project_name.chars().map(|c| if c.is_alphanumeric() || " _-".contains(c) { c } else { '_' }).collect();
    let file_path = state.app_data_dir.join("projects").join(format!("{}.json", safe_name));

    if file_path.exists() {
        std::fs::remove_file(&file_path).map_err(|e| e.to_string())?;
    }

    Ok(())
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
                        let name = path.file_stem()
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
    let valid_models = ["base", "small", "medium", "large", "large-v3"];
    if !valid_models.contains(&model.as_str()) {
        return Err(format!("Modelo inválido. Opções: {}", valid_models.join(", ")));
    }

    let models_dir = state.app_data_dir.join("whisper-models");
    std::fs::create_dir_all(&models_dir).map_err(|e| e.to_string())?;

    let dest = models_dir.join(format!("ggml-{}.bin", model));
    if dest.exists() {
        return Ok(serde_json::json!({
            "name": model,
            "path": dest.to_string_lossy().to_string(),
            "already_exists": true,
        }));
    }

    let _ = window.emit("model_download_progress", serde_json::json!({
        "progress": 0,
        "message": format!("Baixando modelo {}...", model),
    }));

    let url = format!(
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{}.bin",
        model
    );

    let window_clone = window.clone();
    whisper::download_model(&url, &dest, move |progress| {
        let pct = (progress * 100.0) as i32;
        let _ = window_clone.emit("model_download_progress", serde_json::json!({
            "progress": pct,
            "message": format!("Baixando modelo... {}%", pct),
        }));
    })
    .await
    .map_err(|e| format!("Falha ao baixar modelo: {}", e))?;

    let _ = window.emit("model_download_progress", serde_json::json!({
        "progress": 100,
        "message": "Modelo baixado!",
    }));

    Ok(serde_json::json!({
        "name": model,
        "path": dest.to_string_lossy().to_string(),
        "downloaded": true,
    }))
}

// --- Helpers ---

fn resolve_source_path(app_data_dir: &std::path::Path, source_file: &str) -> Option<PathBuf> {
    let source = app_data_dir.join(source_file.trim_start_matches('/'));
    let source = source.canonicalize().ok()?;
    if source.starts_with(app_data_dir) {
        Some(source)
    } else {
        None
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
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir().expect("Failed to get app data dir");
            std::fs::create_dir_all(&app_data_dir).ok();
            std::fs::create_dir_all(app_data_dir.join("uploads")).ok();
            std::fs::create_dir_all(app_data_dir.join("processed")).ok();
            std::fs::create_dir_all(app_data_dir.join("projects")).ok();
            std::fs::create_dir_all(app_data_dir.join("whisper-models")).ok();

            preset::init_presets(&app_data_dir).ok();

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
            list_projects,
            load_project,
            delete_project,
            list_models,
            download_model,
        ])
        .run(tauri::generate_context!())
        .expect("error while running StudioCut");
}

fn resolve_sidecar_path(app_handle: &tauri::AppHandle, name: &str) -> String {
    let full_name = if cfg!(windows) {
        format!("{}.exe", name)
    } else {
        name.to_string()
    };

    app_handle
        .path()
        .resolve(
            format!("binaries/{}", full_name),
            tauri::path::BaseDirectory::Resource,
        )
        .unwrap_or_else(|_| std::path::PathBuf::from(&full_name))
        .to_string_lossy()
        .to_string()
}
