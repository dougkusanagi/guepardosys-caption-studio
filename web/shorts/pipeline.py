"""
Orchestrator for running Shorts pipeline skills in sequence.
"""

import asyncio
import gc
import json
import logging
import re
from pathlib import Path
from typing import Callable, Awaitable
import httpx

from web.services import ffmpeg_svc
from web.shorts import store
from web.shorts.models import ModelManager
from web.shorts.utils import group_segments_semantically, select_shorts_fallback

logger = logging.getLogger(__name__)

# The uploads directory is relative to the backend server directory
UPLOADS_DIR = Path(__file__).parent.parent / "uploads"
PROCESSED_DIR = Path(__file__).parent.parent / "processed"


class ShortsPipeline:
    """Manages the execution of the pipeline stages/skills."""

    def __init__(self):
        self.cancelled_jobs = set()
        self.active_jobs = set()

    def is_busy(self) -> bool:
        return len(self.active_jobs) > 0

    def cancel_analysis(self, project_id: str, job_id: str):
        self.cancelled_jobs.add(job_id)
        store.update_job_status(project_id, job_id, "cancelled")

    async def unload_lm_studio_models(self):
        """Contact LM Studio local API and request unloading all loaded model instances from VRAM."""
        url_list = "http://localhost:1234/api/v1/models"
        url_unload = "http://localhost:1234/api/v1/models/unload"
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                res = await client.get(url_list)
                if res.status_code == 200:
                    data = res.json()
                    models_list = data.get("data", []) if isinstance(data, dict) else data
                    for model_info in models_list:
                        instances = model_info.get("loaded_instances", [])
                        for inst in instances:
                            inst_id = inst.get("instance_id") or inst.get("id")
                            if inst_id:
                                logger.info(f"Requesting LM Studio to unload model instance: {inst_id}")
                                unload_res = await client.post(url_unload, json={"instance_id": inst_id})
                                logger.info(f"LM Studio unload response for {inst_id}: {unload_res.status_code}")
        except Exception as e:
            logger.warning(f"Failed to request LM Studio VRAM cleanup: {e}")

    async def run_analysis(
        self,
        project_id: str,
        job_id: str,
        client_id: str,
        progress_callback: Callable[[str, int, str], Awaitable[None]]
    ):
        """Run the real analysis pipeline using Faster-Whisper, VRAM cleaning, and Gemma/Fallback selection."""
        logger.info(f"Starting real shorts analysis pipeline for project {project_id}, job {job_id}")
        self.active_jobs.add(job_id)
        try:
            # 1. Initialize
            if progress_callback:
                await progress_callback("shorts:init", 5, "Inicializando recursos de análise e carregando metadados do vídeo...")
            store.update_job_status(project_id, job_id, "analyzing")
            
            job_data = store.get_job(project_id, job_id)
            filename = job_data["filename"]
            video_path = UPLOADS_DIR / filename
            work_dir = PROCESSED_DIR / project_id / "shorts"
            work_dir.mkdir(parents=True, exist_ok=True)

            if not video_path.exists():
                raise FileNotFoundError(f"Video file not found at {video_path}")

            # Get video duration
            metadata = ffmpeg_svc.get_video_info(str(video_path))
            duration = float(metadata.get("duration") or 60.0)

            # Get configuration settings
            config = job_data.get("config", {})
            whisper_model_size = config.get("whisperModel", "small")
            target_duration = float(config.get("targetDuration", 30.0))
            clip_count = int(config.get("clipCount", 3))
            language = config.get("language", "pt")
            dynamic_clip_count = bool(config.get("dynamicClipCount", False))

            # 2. Extract Audio for Whisper
            if progress_callback:
                await progress_callback("shorts:extract_audio", 10, "Iniciando extração do áudio (Conversão para WAV 16kHz Mono)...")
                
            audio_path = work_dir / "audio_16k.wav"
            # Extract mono WAV 16kHz audio
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(
                None,
                lambda: ffmpeg_svc.extract_audio(str(video_path), str(audio_path), sample_rate=16000)
            )

            if progress_callback:
                await progress_callback("shorts:extract_audio", 25, "Áudio extraído com sucesso! Preparando para decodificação.")

            # 3. Transcribe with Faster-Whisper on GPU
            if progress_callback:
                await progress_callback("shorts:transcribe", 30, f"Carregando modelo Faster-Whisper ({whisper_model_size}) na memória...")

            # Load model via ModelManager (handles CUDA/CPU and float16/int8 logic)
            model = await loop.run_in_executor(
                None,
                lambda: ModelManager.load_whisper(whisper_model_size)
            )
            
            if progress_callback:
                await progress_callback("shorts:transcribe", 30, "Modelo carregado com sucesso. Iniciando decodificação do áudio...")

            # Transcribe audio file with word-level timestamps
            logger.info("Starting transcription...")
            def _run_transcription():
                segments_gen, info = model.transcribe(
                    str(audio_path),
                    language=language,
                    word_timestamps=True,
                    beam_size=5
                )
                
                segments = []
                total_duration = info.duration if info and info.duration else 1.0
                for idx, seg in enumerate(segments_gen):
                    if job_id in self.cancelled_jobs:
                        raise asyncio.CancelledError("Transcrição cancelada pelo usuário.")
                    words = []
                    for w in getattr(seg, "words", []) or []:
                        words.append({
                            "word": w.word,
                            "start": round(w.start, 2),
                            "end": round(w.end, 2),
                            "probability": getattr(w, "probability", 0.0)
                        })
                    
                    seg_data = {
                        "id": idx,
                        "start": round(seg.start, 2),
                        "end": round(seg.end, 2),
                        "text": seg.text.strip(),
                        "words": words
                    }
                    segments.append(seg_data)
                    
                    # Calculate transcription progress (from 30% to 55%)
                    pct = int(30 + (seg.end / total_duration) * 25)
                    pct = min(55, max(30, pct))
                    
                    # Yield real-time transcription segment text in log
                    log_msg = f"[Whisper] {seg.start:.1f}s - {seg.end:.1f}s: \"{seg.text.strip()}\""
                    asyncio.run_coroutine_threadsafe(
                        progress_callback("shorts:transcribe", pct, log_msg),
                        loop
                    )
                return {"segments": segments}

            transcription = await loop.run_in_executor(None, _run_transcription)
            
            if job_id in self.cancelled_jobs:
                raise asyncio.CancelledError()

            # Save transcription as artifact
            trans_file = work_dir / "transcription.json"
            with open(trans_file, "w", encoding="utf-8") as f:
                json.dump(transcription, f, indent=2, ensure_ascii=False)
                
            store.save_artifact(project_id, job_id, "shorts:transcribe", str(trans_file))
            
            # Clean up temporary audio file
            audio_path.unlink(missing_ok=True)
            
            # Unload Whisper model from VRAM immediately to free up GPU memory
            await loop.run_in_executor(
                None,
                lambda: ModelManager.clean_vram()
            )

            if job_id in self.cancelled_jobs:
                raise asyncio.CancelledError()

            # 4. Group segments semantically
            if progress_callback:
                await progress_callback("shorts:group", 60, "Transcrição completa! Iniciando agrupamento semântico de frases...")

            segments_for_grouping = []
            for seg in transcription.get("segments", []):
                segments_for_grouping.append({
                    "start_sec": float(seg["start"]),
                    "end_sec": float(seg["end"]),
                    "text": seg["text"]
                })
            
            grouped_paragraphs = group_segments_semantically(segments_for_grouping)
            
            if progress_callback:
                await progress_callback("shorts:group", 75, f"Agrupamento concluído: {len(segments_for_grouping)} falas consolidadas em {len(grouped_paragraphs)} blocos narrativos.")
            
            grouped_text = ""
            for p in grouped_paragraphs:
                grouped_text += f"[{p['start_sec']:.1f}s - {p['end_sec']:.1f}s]: {p['text']}\n"
                
            # Save grouped transcription to disk for debugging
            grouped_file = work_dir / "transcript_grouped.txt"
            grouped_file.write_text(grouped_text, encoding="utf-8")
            
            if job_id in self.cancelled_jobs:
                raise asyncio.CancelledError()

            # 5. Selection Stage (Gemma / Fallback)
            if progress_callback:
                await progress_callback("shorts:select", 80, "Enviando blocos de áudio para avaliação do modelo Gemma (LM Studio)...")

            selected_shorts = []
            
            # Form prompts
            rigorous_instruction = (
                "\nSeja extremamente rigoroso na avaliação do potencial viral de cada clipe. "
                "Priorize qualidade sobre quantidade: selecione apenas trechos que sejam de fato muito interessantes, "
                "com ganchos fortes e storytelling claro. Não hesite em descartar partes mornas."
                if dynamic_clip_count else ""
            )

            system_prompt = (
                "Você é um editor de vídeos virais especializado em Reels/Shorts/TikTok. "
                "Seu trabalho é analisar o áudio transcrito de um vídeo e selecionar os melhores "
                "trechos curtos focando em Storytelling estruturado. "
                "Cada corte DEVE conter:\n"
                "1. Gancho Inicial (Hook): Os primeiros segundos precisam introduzir o tema de forma impactante.\n"
                "2. Desenvolvimento: Apresentação da ideia principal de forma clara e fluida.\n"
                "3. Fechamento: O raciocínio precisa terminar de forma satisfatória e lógica (evitando cortes bruscos no meio de frases).\n"
                f"{rigorous_instruction}\n"
                f"Duração ideal: ~{target_duration} segundos. Limite máximo estrito: 60 segundos.\n"
                "A duração ideal é apenas um guia, estenda ou encurte para completar a história."
            )

            quantity_instruction = (
                f"extrair quantos clipes de alta qualidade você conseguir identificar (no mínimo {clip_count} clipes, se possível)"
                if dynamic_clip_count else
                f"extrair exatamente {clip_count} propostas de Shorts"
            )

            user_prompt = (
                f"Por favor, analise a seguinte transcrição estruturada em parágrafos semânticos e tente "
                f"{quantity_instruction} focadas em storytelling completo (início, meio e fim).\n\n"
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

            lm_studio_url = "http://localhost:1234/v1/chat/completions"
            payload = {
                "model": "google/gemma-4-e2b",
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                "temperature": 0.3
            }

            # Attempt LLM selection call
            try:
                logger.info("Attempting selection using LM Studio (Gemma)...")
                # Wait up to 60 seconds
                async with httpx.AsyncClient(timeout=60.0) as client:
                    response = await client.post(lm_studio_url, json=payload)
                    response.raise_for_status()
                    result_data = response.json()
                    
                    content = result_data["choices"][0]["message"]["content"]
                    json_match = re.search(r"\{.*\}", content, re.DOTALL)
                    json_str = json_match.group(0) if json_match else content

                    parsed_data = json.loads(json_str)
                    raw_shorts = parsed_data.get("shorts", [])
                    
                    if raw_shorts:
                        logger.info(f"Successfully selected {len(raw_shorts)} shorts using Gemma.")
                        # Format list
                        for idx, item in enumerate(raw_shorts):
                            selected_shorts.append({
                                "id": f"{job_id}_{idx+1}",
                                "start_sec": float(item["start_sec"]),
                                "end_sec": float(item["end_sec"]),
                                "score": round(0.95 - (idx * 0.05), 2),  # Mock high scores for LLM choices
                                "headline": item.get("headline", f"Corte #{idx+1}"),
                                "storytelling_structure": item.get("storytelling_structure", ""),
                                "status": "pending"
                            })
            except Exception as llm_exc:
                logger.warning(f"LM Studio call failed or was unavailable: {llm_exc}. Falling back to local algorithm...")
                if progress_callback:
                    await progress_callback("shorts:select", 85, "LM Studio (Gemma) indisponível. Executando algoritmo de fallback local...")
                
            # If Gemma selection failed or returned nothing, run local fallback
            if not selected_shorts:
                fallback_clips = select_shorts_fallback(
                    segments_for_grouping, 
                    clip_count, 
                    target_duration, 
                    duration
                )
                for idx, clip in enumerate(fallback_clips):
                    selected_shorts.append({
                        "id": f"{job_id}_{idx+1}",
                        "start_sec": clip["start_sec"],
                        "end_sec": clip["end_sec"],
                        "score": round(0.85 - (idx * 0.05), 2),
                        "headline": clip["headline"],
                        "storytelling_structure": clip["storytelling_structure"],
                        "status": "pending"
                    })

            if job_id in self.cancelled_jobs:
                raise asyncio.CancelledError()

            # Save clips to database
            if progress_callback:
                await progress_callback("shorts:done", 95, "Salvando metadados dos clipes selecionados no SQLite local...")
            store.save_clips(project_id, job_id, selected_shorts)

            # Complete analysis
            store.update_job_status(project_id, job_id, "ready")
            if progress_callback:
                await progress_callback("shorts:done", 100, "Processamento concluído com sucesso!")

        except asyncio.CancelledError:
            logger.info(f"Shorts analysis job {job_id} cancelled by user.")
            store.update_job_status(project_id, job_id, "cancelled")
            if progress_callback:
                await progress_callback("shorts:error", 0, "Análise cancelada pelo usuário.")
            # Clean VRAM and temp files
            await loop.run_in_executor(None, lambda: ModelManager.clean_vram())
            try:
                (work_dir / "audio_16k.wav").unlink(missing_ok=True)
            except Exception:
                pass
            self.cancelled_jobs.discard(job_id)
        except Exception as e:
            logger.exception(f"Error in ShortsPipeline for job {job_id}")
            store.update_job_status(project_id, job_id, "error")
            if progress_callback:
                await progress_callback("shorts:error", 0, f"Erro na análise: {str(e)}")
            self.cancelled_jobs.discard(job_id)
            raise
        finally:
            self.active_jobs.discard(job_id)
            await self.unload_lm_studio_models()
