"""
Benchmark script v2: Compare openai-whisper vs faster-whisper (small and medium models) on GPU (CUDA),
using VRAM cleanups and semantic paragraph grouping, and querying LM Studio.
"""

import os
import gc
import json
import time
import subprocess
import re
from pathlib import Path
import httpx
import torch

# Paths
VIDEO_PATH = r"C:\Users\dl_ag\Videos\Edição\YTDown_YouTube_Media_7BNkptX15O0_001_1080p.mp4"
OUTPUT_DIR = Path(__file__).parent.parent / "temp_test_shorts" / "v2"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

TEMP_WAV_PATH = OUTPUT_DIR / "temp_audio_10m.wav"


def extract_10m_audio():
    print("--- EXTRAINDO CORTES DE ÁUDIO DE 10 MINUTOS ---")
    try:
        from web.services.ffmpeg_svc import _resolve_binary
        ffmpeg_bin = _resolve_binary("ffmpeg")
    except Exception:
        ffmpeg_bin = "ffmpeg"

    cmd = [
        ffmpeg_bin, "-y",
        "-i", str(VIDEO_PATH),
        "-ss", "0", "-t", "600",
        "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1",
        str(TEMP_WAV_PATH)
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print("Áudio extraído com sucesso.")


def clean_vram():
    """Aggressively clear GPU memory to prevent OOM errors on 6GB VRAM."""
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
        torch.cuda.ipc_collect()
    time.sleep(1.0)


def group_segments_semantically(segments: list[dict], max_pause_sec: float = 1.5) -> list[dict]:
    """Group short subtitle segments into semantic paragraphs based on silence gaps."""
    if not segments:
        return []
    
    grouped = []
    current_group = []
    
    for i, seg in enumerate(segments):
        if not current_group:
            current_group.append(seg)
            continue
        
        last_seg = current_group[-1]
        pause = seg["start_sec"] - last_seg["end_sec"]
        
        # Merge if the pause between segments is small (implies continuous speech)
        if pause < max_pause_sec:
            current_group.append(seg)
        else:
            # Commit the current group as a single paragraph
            grouped.append(build_paragraph_from_group(current_group, len(grouped)))
            current_group = [seg]
            
    if current_group:
        grouped.append(build_paragraph_from_group(current_group, len(grouped)))
        
    return grouped


def build_paragraph_from_group(group: list[dict], index: int) -> dict:
    start = group[0]["start_sec"]
    end = group[-1]["end_sec"]
    text = " ".join([seg["text"] for seg in group]).strip()
    return {
        "index": index,
        "start_sec": start,
        "end_sec": end,
        "text": text
    }


def run_standard_whisper(model_size: str) -> list[dict]:
    output_file = OUTPUT_DIR / f"whisper_standard_{model_size}_result.json"
    if output_file.exists():
        print(f"\n--- CARREGANDO RESULTADOS CACHEADOS STANDARD WHISPER ({model_size.upper()}) ---")
        with open(output_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data["segments"]

    import whisper
    
    print(f"\n--- RUNNING STANDARD WHISPER ({model_size.upper()}) ON GPU ---")
    start_load = time.time()
    model = whisper.load_model(model_size, device="cuda")
    load_time = time.time() - start_load
    print(f"Modelo {model_size} carregado na GPU em {load_time:.2f}s.")

    print("Transcrevendo...")
    start_trans = time.time()
    result = model.transcribe(str(TEMP_WAV_PATH), language="pt")
    trans_time = time.time() - start_trans
    print(f"Transcrição concluída em {trans_time:.2f}s.")

    segments = []
    for seg in result.get("segments", []):
        segments.append({
            "index": seg.get("id"),
            "start_sec": round(seg.get("start"), 2),
            "end_sec": round(seg.get("end"), 2),
            "text": seg.get("text", "").strip()
        })

    # Save results
    summary = {
        "model_size": model_size,
        "load_time_sec": round(load_time, 2),
        "transcription_time_sec": round(trans_time, 2),
        "total_segments": len(segments),
        "segments": segments
    }
    
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2, ensure_ascii=False)

    # Cleanup model from VRAM immediately
    del model
    clean_vram()
    
    return segments


def run_faster_whisper(model_size: str) -> list[dict]:
    output_file = OUTPUT_DIR / f"whisper_faster_{model_size}_result.json"
    if output_file.exists():
        print(f"\n--- CARREGANDO RESULTADOS CACHEADOS FASTER-WHISPER ({model_size.upper()}) ---")
        with open(output_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data["segments"]

    from faster_whisper import WhisperModel
    
    print(f"\n--- RUNNING FASTER-WHISPER ({model_size.upper()}) ON GPU ---")
    start_load = time.time()
    # Use float16 for optimized VRAM footprint and execution speed on GPU
    model = WhisperModel(model_size, device="cuda", compute_type="float16")
    load_time = time.time() - start_load
    print(f"Modelo {model_size} carregado na GPU em {load_time:.2f}s.")

    print("Transcrevendo...")
    start_trans = time.time()
    segments_gen, info = model.transcribe(str(TEMP_WAV_PATH), language="pt", beam_size=5)
    
    segments = []
    for idx, seg in enumerate(segments_gen):
        segments.append({
            "index": idx,
            "start_sec": round(seg.start, 2),
            "end_sec": round(seg.end, 2),
            "text": seg.text.strip()
        })
    trans_time = time.time() - start_trans
    print(f"Transcrição concluída em {trans_time:.2f}s.")

    summary = {
        "model_size": model_size,
        "load_time_sec": round(load_time, 2),
        "transcription_time_sec": round(trans_time, 2),
        "total_segments": len(segments),
        "segments": segments
    }
    
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2, ensure_ascii=False)

    # Cleanup model from VRAM immediately
    del model
    clean_vram()

    return segments


def run_llm_shorts_selection(segments: list[dict], suffix: str):
    print(f"\n--- RUNNING LM STUDIO SELECTION FOR {suffix.upper()} ---")
    
    # 1. Format raw transcript
    raw_text = ""
    for seg in segments:
        raw_text += f"[{seg['start_sec']:.1f}s - {seg['end_sec']:.1f}s]: {seg['text']}\n"
    
    # 2. Group semantically
    grouped_segments = group_segments_semantically(segments)
    
    grouped_text = ""
    for seg in grouped_segments:
        grouped_text += f"[{seg['start_sec']:.1f}s - {seg['end_sec']:.1f}s]: {seg['text']}\n"
        
    # Save transcripts to inspect grouping effectiveness
    with open(OUTPUT_DIR / f"transcript_raw_{suffix}.txt", "w", encoding="utf-8") as f:
        f.write(raw_text)
    with open(OUTPUT_DIR / f"transcript_grouped_{suffix}.txt", "w", encoding="utf-8") as f:
        f.write(grouped_text)

    print(f"Redução de segmentos para LLM: {len(segments)} -> {len(grouped_segments)} parágrafos semânticos!")

    system_prompt = (
        "Você é um editor de vídeos virais especializado em Reels/Shorts/TikTok. "
        "Seu trabalho é analisar o áudio transcrito de um vídeo e selecionar os melhores "
        "trechos curtos focando em Storytelling estruturado. "
        "Cada corte DEVE conter:\n"
        "1. Gancho Inicial (Hook): Os primeiros segundos precisam introduzir o tema de forma impactante.\n"
        "2. Desenvolvimento: Apresentação da ideia principal de forma clara e fluida.\n"
        "3. Fechamento: O raciocínio precisa terminar de forma satisfatória e lógica (evitando cortes bruscos no meio de frases).\n\n"
        "Duração ideal: ~30 segundos. Limite máximo estrito: 60 segundos.\n"
        "A duração ideal é apenas um guia, estenda ou encurte para completar a história."
    )

    user_prompt = (
        "Por favor, analise a seguinte transcrição estruturada em parágrafos semânticos e extraia "
        "exatamente 10 propostas de Shorts focadas em storytelling completo (início, meio e fim).\n\n"
        f"Transcrição:\n{grouped_text}\n\n"
        "Responda estritamente com um JSON válido contendo o seguinte formato:\n"
        "{\n"
        "  \"shorts\": [\n"
        "    {\n"
        "      \"id\": 1,\n"
        "      \"start_sec\": 12.5,\n"
        "      \"end_sec\": 42.1,\n"
        "      \"headline\": \"Título Curto Chamativo\",\n"
        "      \"storytelling_structure\": \"Explicação breve de como a história é fechada neste corte.\"\n"
        "    }\n"
        "  ]\n"
        "}"
    )

    api_url = "http://localhost:1234/v1/chat/completions"
    payload = {
        "model": "google/gemma-4-e2b",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "temperature": 0.3
    }

    try:
        with httpx.Client(timeout=300.0) as client:
            response = client.post(api_url, json=payload)
            response.raise_for_status()
            result_data = response.json()
            
            content = result_data["choices"][0]["message"]["content"]
            json_match = re.search(r"\{.*\}", content, re.DOTALL)
            json_str = json_match.group(0) if json_match else content

            parsed_shorts = json.loads(json_str)
            output_file = OUTPUT_DIR / f"llm_shorts_selection_{suffix}.json"
            with open(output_file, "w", encoding="utf-8") as f:
                json.dump(parsed_shorts, f, indent=2, ensure_ascii=False)
            
            print(f"Cortes recomendados pela LLM ({suffix}) salvos.")
            
    except Exception as e:
        print(f"LM Studio falhou para {suffix}: {e}")


def simulate_breath_removal(segments: list[dict], padding: float = 0.2) -> float:
    """
    Simulates breath/silence removal between segments.
    Any gap between segments is reduced to 2 * padding (padding after first + padding before second).
    Returns the new duration of the transcribed audio block.
    """
    if not segments:
        return 0.0
    
    total_duration = 0.0
    for idx, seg in enumerate(segments):
        duration = seg["end_sec"] - seg["start_sec"]
        total_duration += max(0.0, duration)
        
        # Add the padded silence gaps between segments
        if idx > 0:
            prev_seg = segments[idx - 1]
            actual_gap = seg["start_sec"] - prev_seg["end_sec"]
            simulated_gap = min(actual_gap, 2 * padding)
            total_duration += max(0.0, simulated_gap)
            
    return round(total_duration, 2)


def main():
    if not os.path.exists(VIDEO_PATH):
        print(f"Vídeo não encontrado.")
        return

    extract_10m_audio()

    results = {}
    
    # 1. Run Small Models on GPU
    try:
        results["std_small"] = run_standard_whisper("small")
    except Exception as e:
        print(f"Falha Standard Small: {e}")
        
    try:
        results["fw_small"] = run_faster_whisper("small")
    except Exception as e:
        print(f"Falha Faster Small: {e}")

    # 2. Run Medium Models on GPU
    try:
        results["std_medium"] = run_standard_whisper("medium")
    except Exception as e:
        print(f"Falha Standard Medium: {e}")
        
    try:
        results["fw_medium"] = run_faster_whisper("medium")
    except Exception as e:
        print(f"Falha Faster Medium: {e}")

    # 3. Run Large-v3 Models on GPU
    try:
        results["std_large"] = run_standard_whisper("large-v3")
    except Exception as e:
        print(f"Falha Standard Large-v3: {e}")
        
    try:
        results["fw_large"] = run_faster_whisper("large-v3")
    except Exception as e:
        print(f"Falha Faster Large-v3: {e}")

    # 4. Compile performance log
    summary_text = "=== COMPARAÇÃO DE PERFORMANCE NA GPU (10m Áudio) ===\n"
    
    keys_to_compile = [
        ("std_small", "whisper_standard", "small", "Whisper Standard"),
        ("fw_small", "whisper_faster", "small", "Faster-Whisper"),
        ("std_medium", "whisper_standard", "medium", "Whisper Standard"),
        ("fw_medium", "whisper_faster", "medium", "Faster-Whisper"),
        ("std_large", "whisper_standard", "large-v3", "Whisper Standard"),
        ("fw_large", "whisper_faster", "large-v3", "Faster-Whisper")
    ]
    
    for key, prefix, size, engine_name in keys_to_compile:
        file_path = OUTPUT_DIR / f"{prefix}_{size}_result.json"
        if file_path.exists():
            with open(file_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            
            # Simulate breath removal with 0.2s padding
            original_dur = 600.0
            new_dur = simulate_breath_removal(data.get("segments", []), padding=0.2)
            time_saved = round(original_dur - new_dur, 2)
            
            summary_text += f"{engine_name} ({size.upper()}):\n"
            summary_text += f"  Tempo de carregamento: {data['load_time_sec']}s\n"
            summary_text += f"  Tempo de transcrição:  {data['transcription_time_sec']}s\n"
            summary_text += f"  Total de segmentos:    {data['total_segments']}\n"
            summary_text += f"  Simulação Corte Respiros (pad=0.2s): Duração vai de {original_dur}s para {new_dur}s (economiza {time_saved}s)\n\n"
            
    print("\n" + summary_text)
    with open(OUTPUT_DIR / "gpu_benchmark_summary.txt", "w", encoding="utf-8") as f:
        f.write(summary_text)

    # 5. Prompt LLM on small, medium and large results to evaluate segment quality
    if "fw_small" in results:
        run_llm_shorts_selection(results["fw_small"], "small")
    if "fw_medium" in results:
        run_llm_shorts_selection(results["fw_medium"], "medium")
    if "fw_large" in results:
        run_llm_shorts_selection(results["fw_large"], "large-v3")

    # Clean temporary audio
    if TEMP_WAV_PATH.exists():
        TEMP_WAV_PATH.unlink()


if __name__ == "__main__":
    main()
