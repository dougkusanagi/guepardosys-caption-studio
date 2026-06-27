"""
Test script calling local LLM (LM Studio) using already transcribed segments.
Avoids response_format type json_object parameter to prevent 400 Bad Request.
"""

import json
import re
import time
from pathlib import Path
import httpx

OUTPUT_DIR = Path(__file__).parent.parent / "web" / "processed" / "shorts_benchmark_outputs"
FASTER_WHISPER_RESULT = OUTPUT_DIR / "whisper_faster_result.json"


def run_llm_shorts_selection():
    if not FASTER_WHISPER_RESULT.exists():
        print(f"Erro: Transcrição não encontrada em {FASTER_WHISPER_RESULT}")
        return

    print("Carregando transcrição do Faster-Whisper...")
    with open(FASTER_WHISPER_RESULT, "r", encoding="utf-8") as f:
        data = json.load(f)
    
    segments = data["segments"]
    print(f"Carregados {len(segments)} segmentos.")

    # 1. Format the transcript with timestamps for the LLM
    transcript_text = ""
    for seg in segments:
        transcript_text += f"[{seg['start_sec']:.1f}s - {seg['end_sec']:.1f}s]: {seg['text']}\n"
    
    # 2. Prepare prompts
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

    api_url = "http://localhost:1234/v1/chat/completions"
    
    payload = {
        "model": "google/gemma-4-e2b",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "temperature": 0.3
    }

    print(f"Enviando transcrição ({len(segments)} segmentos) para {api_url}...")
    start_llm = time.clock() if hasattr(time, 'clock') else time.time()
    try:
        with httpx.Client(timeout=300.0) as client:
            response = client.post(api_url, json=payload)
            response.raise_for_status()
            result_data = response.json()
            llm_time = (time.clock() if hasattr(time, 'clock') else time.time()) - start_llm
            print(f"LLM respondeu em {llm_time:.2f} segundos.")

            content = result_data["choices"][0]["message"]["content"]
            
            # Extract JSON block using regex
            json_match = re.search(r"\{.*\}", content, re.DOTALL)
            if json_match:
                json_str = json_match.group(0)
            else:
                json_str = content

            try:
                parsed_shorts = json.loads(json_str)
            except json.JSONDecodeError as jde:
                # If direct json parse fails, output raw content for debug
                print(f"Falha ao interpretar JSON. Resposta bruta do modelo:\n{content}")
                raise jde

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
        print("Verifique se o LM Studio está rodando e se o modelo está carregado.")


if __name__ == "__main__":
    run_llm_shorts_selection()
