"""
Benchmark script comparing openai-whisper vs faster-whisper (small models) 
on a 10-minute slice of video, extracting storytelling-focused Shorts using a local LLM (LM Studio).
"""

import os
import json
import time
import subprocess
from pathlib import Path
import httpx
import torch

# Paths
VIDEO_PATH = r"C:\Users\dl_ag\Videos\Edição\YTDown_YouTube_Media_7BNkptX15O0_001_1080p.mp4"
OUTPUT_DIR = Path(__file__).parent.parent / "web" / "processed" / "shorts_benchmark_outputs"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

TEMP_WAV_PATH = OUTPUT_DIR / "temp_audio_10m.wav"

# Device Configuration
device = "cuda" if torch.cuda.is_available() else "cpu"
print(f"=== CONFIGURAÇÃO DE HARDWARE ===")
print(f"Dispositivo de processamento detectado: {device.upper()}")
if device == "cuda":
    print(f"GPU: {torch.cuda.get_device_name(0)}")
print(f"================================\n")


def extract_10m_audio():
    print("--- EXTRAINDO CORTES DE ÁUDIO DE 10 MINUTOS ---")
    try:
        from web.services.ffmpeg_svc import _resolve_binary
        ffmpeg_bin = _resolve_binary("ffmpeg")
    except Exception:
        ffmpeg_bin = "ffmpeg"  # Fallback to path

    print(f"Executando corte de áudio via {ffmpeg_bin}...")
    cmd = [
        ffmpeg_bin, "-y",
        "-i", str(VIDEO_PATH),
        "-ss", "0", "-t", "600",  # First 10 minutes (600s)
        "-vn", 
        "-acodec", "pcm_s16le", 
        "-ar", "16000", 
        "-ac", "1",
        str(TEMP_WAV_PATH)
    ]
    
    start_time = time.time()
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print(f"Áudio de 10m extraído com sucesso em {time.time() - start_time:.2f}s.")


def run_standard_whisper() -> list[dict]:
    import whisper
    
    print("\n--- INICIANDO OPENAI-WHISPER (STANDARD) ---")
    print("Carregando modelo standard 'small'...")
    start_load = time.time()
    model = whisper.load_model("small", device=device)
    load_time = time.time() - start_load
    print(f"Modelo carregado em {load_time:.2f} segundos.")

    print(f"Transcrevendo áudio slice com standard whisper...")
    start_trans = time.time()
    result = model.transcribe(str(TEMP_WAV_PATH), language="pt")
    trans_time = time.time() - start_trans
    print(f"Transcrição concluída em {trans_time:.2f} segundos.")

    # Save details
    segments = []
    for seg in result.get("segments", []):
        segments.append({
            "index": seg.get("id"),
            "start_sec": round(seg.get("start"), 2),
            "end_sec": round(seg.get("end"), 2),
            "text": seg.get("text", "").strip()
        })

    summary = {
        "load_time_sec": round(load_time, 2),
        "transcription_time_sec": round(trans_time, 2),
        "total_segments": len(segments),
        "segments": segments
    }

    output_file = OUTPUT_DIR / "whisper_standard_result.json"
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2, ensure_ascii=False)
    print(f"Resultado salvo em: {output_file}")
    
    return segments


def run_faster_whisper() -> list[dict]:
    from faster_whisper import WhisperModel
    
    print("\n--- INICIANDO FASTER-WHISPER ---")
    print("Carregando modelo faster 'small'...")
    start_load = time.time()
    # On GPU use float16, on CPU use int8
    compute_type = "float16" if device == "cuda" else "int8"
    model = WhisperModel("small", device=device, compute_type=compute_type)
    load_time = time.time() - start_load
    print(f"Modelo carregado em {load_time:.2f} segundos.")

    print(f"Transcrevendo áudio slice com faster-whisper...")
    start_trans = time.time()
    # beam_size 5 is standard, returns a generator
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
    print(f"Transcrição concluída em {trans_time:.2f} segundos.")

    summary = {
        "load_time_sec": round(load_time, 2),
        "transcription_time_sec": round(trans_time, 2),
        "total_segments": len(segments),
        "segments": segments
    }

    output_file = OUTPUT_DIR / "whisper_faster_result.json"
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2, ensure_ascii=False)
    print(f"Resultado salvo em: {output_file}")

    return segments


def run_llm_shorts_selection(segments: list[dict]):
    print("\n--- CHAMANDO LOCAL LLM (LM STUDIO) ---")
    
    # 1. Format the transcript with timestamps for the LLM
    transcript_text = ""
    for seg in segments:
        transcript_text += f"[{seg['start_sec']:.1f}s - {seg['end_sec']:.1f}s]: {seg['text']}\n"
    
    # Write full text representation for reference
    with open(OUTPUT_DIR / "transcript_formatted.txt", "w", encoding="utf-8") as f:
        f.write(transcript_text)

    # 2. Prepare the payload
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
        "Por favor, analise a seguinte transcrição (primeiros 10 minutos de vídeo) e extraia "
        "exatamente 10 propostas de Shorts focadas em storytelling completo (início, meio e fim).\n\n"
        f"Transcrição:\n{transcript_text}\n\n"
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

    # LM Studio default URL
    api_url = "http://localhost:1234/v1/chat/completions"
    
    payload = {
        "model": "local-model", # LM Studio auto-resolves this to whatever model is loaded
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "temperature": 0.3,
        "response_format": {"type": "json_object"}
    }

    print(f"Enviando transcrição ({len(segments)} segmentos) para {api_url}...")
    start_llm = time.time()
    try:
        with httpx.Client(timeout=180.0) as client:
            response = client.post(api_url, json=payload)
            response.raise_for_status()
            result_data = response.json()
            llm_time = time.time() - start_llm
            print(f"LLM respondeu em {llm_time:.2f} segundos.")

            content = result_data["choices"][0]["message"]["content"]
            parsed_shorts = json.loads(content)
            
            output_file = OUTPUT_DIR / "llm_shorts_selection.json"
            with open(output_file, "w", encoding="utf-8") as f:
                json.dump(parsed_shorts, f, indent=2, ensure_ascii=False)
            print(f"Cortes selecionados salvos com sucesso em: {output_file}")
            
            print("\n=== CORTES RECOMENDADOS PELA IA ===")
            for item in parsed_shorts.get("shorts", []):
                duration = round(item['end_sec'] - item['start_sec'], 1)
                print(f"- [{item['start_sec']}s - {item['end_sec']}s] ({duration}s): {item['headline']}")
                print(f"  Estrutura: {item['storytelling_structure']}")
            print("===================================")

    except Exception as e:
        print(f"Erro na comunicação com o LM Studio: {e}")
        print("Certifique-se de que o LM Studio está rodando e o servidor local está ativado na porta 1234.")


def main():
    if not os.path.exists(VIDEO_PATH):
        print(f"Erro: Arquivo de vídeo não encontrado em '{VIDEO_PATH}'")
        return

    # Extract slice
    extract_10m_audio()

    # 1. Run Standard Whisper
    try:
        segments_std = run_standard_whisper()
    except Exception as e:
        print(f"Falha ao rodar OpenAI Whisper: {e}")
        segments_std = None

    # 2. Run Faster-Whisper
    try:
        segments_fw = run_faster_whisper()
    except Exception as e:
        print(f"Falha ao rodar Faster-Whisper: {e}")
        segments_fw = None

    # 3. Print Comparison
    if segments_std and segments_fw:
        # Load times and trans times
        with open(OUTPUT_DIR / "whisper_standard_result.json", "r", encoding="utf-8") as f:
            data_std = json.load(f)
        with open(OUTPUT_DIR / "whisper_faster_result.json", "r", encoding="utf-8") as f:
            data_fw = json.load(f)

        print("\n=== COMPARAÇÃO DE PERFORMANCE ===")
        print(f"OpenAI Whisper (Standard):")
        print(f"  Tempo de carregamento: {data_std['load_time_sec']}s")
        print(f"  Tempo de transcrição:  {data_std['transcription_time_sec']}s")
        print(f"  Total de segmentos:    {data_std['total_segments']}")
        print(f"Faster-Whisper:")
        print(f"  Tempo de carregamento: {data_fw['load_time_sec']}s")
        print(f"  Tempo de transcrição:  {data_fw['transcription_time_sec']}s")
        print(f"  Total de segmentos:    {data_fw['total_segments']}")
        
        ratio = data_std['transcription_time_sec'] / max(0.1, data_fw['transcription_time_sec'])
        print(f"\nResultado: Faster-Whisper foi {ratio:.2f}x mais rápido!")
        print("================================")
        
        # Write benchmark summary
        summary_text = (
            f"BENCHMARK DE TRANSCRIÇÃO (Modelos 'small' em {device.upper()} - 10 Minutos de Áudio)\n"
            f"========================================================================\n"
            f"OpenAI Whisper Standard:\n"
            f"  Tempo de Transcrição: {data_std['transcription_time_sec']}s\n"
            f"  Segmentos extraídos:  {data_std['total_segments']}\n\n"
            f"Faster-Whisper:\n"
            f"  Tempo de Transcrição: {data_fw['transcription_time_sec']}s\n"
            f"  Segmentos extraídos:  {data_fw['total_segments']}\n\n"
            f"Velocidade: Faster-Whisper foi {ratio:.2f}x mais rápido.\n"
        )
        with open(OUTPUT_DIR / "benchmark_summary.txt", "w", encoding="utf-8") as f:
            f.write(summary_text)

    # 4. Run LLM Selection (using faster-whisper output if available)
    chosen_segments = segments_fw if segments_fw else segments_std
    if chosen_segments:
        run_llm_shorts_selection(chosen_segments)
    else:
        print("\nNão há transcrições válidas disponíveis para enviar ao LM Studio.")

    # Clean up
    if TEMP_WAV_PATH.exists():
        try:
            TEMP_WAV_PATH.unlink()
            print("\nArquivo temporário de áudio removido.")
        except Exception as e:
            print(f"Falha ao deletar arquivo temporário: {e}")


if __name__ == "__main__":
    main()
