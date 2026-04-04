use std::path::Path;
use std::sync::{Arc, Mutex};

use once_cell::sync::Lazy;
use serde::Serialize;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

static MODEL_CACHE: Lazy<Mutex<Option<(String, Arc<WhisperContext>)>>> = Lazy::new(|| Mutex::new(None));

#[derive(Serialize, Clone)]
pub struct WordTimestamp {
    pub start: f64,
    pub end: f64,
    pub word: String,
}

#[derive(Serialize, Clone)]
pub struct SegmentResult {
    pub start: f64,
    pub end: f64,
    pub text: String,
    pub words: Option<Vec<WordTimestamp>>,
}

#[derive(Serialize, Clone)]
pub struct TranscriptionResult {
    pub text: String,
    pub segments: Vec<SegmentResult>,
    pub language: String,
}

pub async fn transcribe(
    app_data_dir: &Path,
    audio_path: &Path,
    model_name: &str,
    language: &str,
) -> Result<TranscriptionResult, String> {
    let models_dir = app_data_dir.join("whisper-models");
    let model_path = models_dir.join(format!("ggml-{}.bin", model_name));

    if !model_path.exists() {
        return Err(format!(
            "Modelo '{}' não encontrado. Baixe-o primeiro.",
            model_name
        ));
    }

    let context = {
        let mut cache = MODEL_CACHE.lock().unwrap();
        match &*cache {
            Some((name, ctx)) if name == model_name => ctx.clone(),
            _ => {
                let ctx = Arc::new(WhisperContext::new_with_params(
                    &model_path,
                    WhisperContextParameters::default(),
                )
                .map_err(|e| format!("Falha ao carregar modelo: {}", e))?);
                *cache = Some((model_name.to_string(), ctx.clone()));
                ctx
            }
        }
    };

    let mut state = context.create_state().map_err(|e: whisper_rs::WhisperError| e.to_string())?;

    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_language(Some(language));
    params.set_token_timestamps(true);
    params.set_print_progress(false);
    params.set_print_timestamps(false);
    params.set_print_special(false);
    params.set_print_realtime(false);
    params.set_n_threads(num_cpus::get() as i32);

    // Read audio file as f32 samples (16kHz mono WAV expected)
    let samples = load_wav(audio_path)?;

    state
        .full(params, &samples)
        .map_err(|e| format!("Falha na transcrição: {}", e))?;

    let num_segments = state.full_n_segments();
    let mut segments = Vec::new();
    let mut full_text = String::new();

    for i in 0..num_segments {
        let segment = state.get_segment(i as i32).ok_or("Segment not found".to_string())?;
        let text = segment.to_str_lossy().map_err(|e| e.to_string())?.to_string();
        let start = segment.start_timestamp() as f64 / 100.0;
        let end = segment.end_timestamp() as f64 / 100.0;

        let words: Vec<WordTimestamp> = (0..segment.n_tokens())
            .filter_map(|j| segment.get_token(j))
            .filter_map(|token| {
                let word = token.to_str_lossy().ok()?.to_string();
                let data = token.token_data();
                let start_t = data.t0 as f64 / 100.0;
                let end_t = data.t1 as f64 / 100.0;
                if start_t > 0.0 || end_t > 0.0 {
                    Some(WordTimestamp {
                        start: start_t,
                        end: end_t,
                        word,
                    })
                } else {
                    None
                }
            })
            .collect();
        let word_timestamps = if words.is_empty() { None } else { Some(words) };

        if !full_text.is_empty() {
            full_text.push(' ');
        }
        full_text.push_str(&text);

        segments.push(SegmentResult {
            start,
            end,
            text,
            words: word_timestamps,
        });
    }

    let lang_id = state.full_lang_id_from_state();
    let lang = whisper_rs::get_lang_str(lang_id).unwrap_or("unknown").to_string();

    Ok(TranscriptionResult {
        text: full_text,
        segments,
        language: lang,
    })
}

pub fn collect_speech_intervals(
    transcription: &TranscriptionResult,
    duration: f64,
    pad_start: f64,
    pad_end: f64,
) -> Vec<(f64, f64)> {
    let mut intervals = Vec::new();

    for segment in &transcription.segments {
        if let Some(words) = &segment.words {
            for word in words {
                let s = (word.start - pad_start).max(0.0).min(duration);
                let e = (word.end + pad_end).max(0.0).min(duration);
                if e > s {
                    intervals.push((s, e));
                }
            }
        } else {
            let s = (segment.start - pad_start).max(0.0).min(duration);
            let e = (segment.end + pad_end).max(0.0).min(duration);
            if e > s {
                intervals.push((s, e));
            }
        }
    }

    intervals
}

pub fn merge_intervals(intervals: &[(f64, f64)], min_gap: f64) -> Vec<(f64, f64)> {
    let mut sorted = intervals.to_vec();
    sorted.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());

    if sorted.is_empty() {
        return Vec::new();
    }

    let mut merged = vec![sorted[0]];
    for &(cur_start, cur_end) in &sorted[1..] {
        let last = merged.last_mut().unwrap();
        if cur_start - last.1 <= min_gap {
            last.1 = last.1.max(cur_end);
        } else {
            merged.push((cur_start, cur_end));
        }
    }

    merged
}

pub fn drop_tiny_intervals(intervals: &[(f64, f64)], min_keep: f64) -> Vec<(f64, f64)> {
    intervals
        .iter()
        .filter(|(s, e)| (e - s) >= min_keep)
        .copied()
        .collect()
}

pub fn get_subtitle_segments(transcription: &TranscriptionResult) -> Vec<crate::subtitle::SubtitleSegment> {
    transcription
        .segments
        .iter()
        .filter(|s| !s.text.trim().is_empty())
        .map(|s| crate::subtitle::SubtitleSegment {
            start: s.start,
            end: s.end,
            text: s.text.clone(),
        })
        .collect()
}

fn load_wav(path: &Path) -> Result<Vec<f32>, String> {
    let mut reader = hound::WavReader::open(path).map_err(|e| format!("Falha ao abrir WAV: {}", e))?;
    let spec = reader.spec();

    if spec.channels != 1 {
        return Err("Áudio deve ser mono".into());
    }

    let samples: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Int => reader
            .samples::<i16>()
            .map(|s| s.unwrap() as f32 / 32768.0)
            .collect(),
        hound::SampleFormat::Float => reader.samples::<f32>().map(|s| s.unwrap()).collect(),
    };

    Ok(samples)
}

pub async fn download_model<F>(url: &str, dest: &Path, mut on_progress: F) -> Result<(), String>
where
    F: FnMut(f64) + Send + 'static,
{
    use tokio::io::AsyncWriteExt;

    let response = reqwest::get(url)
        .await
        .map_err(|e| format!("Falha na requisição: {}", e))?;

    let total_size = response
        .content_length()
        .ok_or("Não foi possível determinar o tamanho do arquivo")?;

    let mut file = tokio::fs::File::create(dest)
        .await
        .map_err(|e| format!("Falha ao criar arquivo: {}", e))?;

    let mut stream = response.bytes_stream();
    let mut downloaded: u64 = 0;

    use futures::StreamExt;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Erro no download: {}", e))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Erro ao escrever: {}", e))?;
        downloaded += chunk.len() as u64;
        on_progress(downloaded as f64 / total_size as f64);
    }

    file.flush().await.map_err(|e| e.to_string())?;
    Ok(())
}
