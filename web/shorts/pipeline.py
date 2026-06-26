"""
Orchestrator for running Shorts pipeline skills in sequence.
"""

import asyncio
import logging
import uuid
from pathlib import Path
from typing import Callable, Awaitable

from web.services import ffmpeg_svc
from web.shorts import store
from web.shorts.skills.base import SkillContext

logger = logging.getLogger(__name__)

# The uploads directory is relative to the backend server directory
UPLOADS_DIR = Path(__file__).parent.parent / "uploads"
PROCESSED_DIR = Path(__file__).parent.parent / "processed"


class ShortsPipeline:
    """Manages the execution of the pipeline stages/skills."""

    def __init__(self):
        pass

    async def run_analysis(
        self,
        project_id: str,
        job_id: str,
        client_id: str,
        progress_callback: Callable[[str, int, str], Awaitable[None]]
    ):
        """Run the analysis pipeline (Fase 1: Mock implementation)."""
        logger.info(f"Starting shorts analysis pipeline for project {project_id}, job {job_id}")
        
        try:
            # 1. Update state to analyzing
            store.update_job_status(project_id, job_id, "analyzing")
            job_data = store.get_job(project_id, job_id)
            filename = job_data["filename"]
            video_path = UPLOADS_DIR / filename
            work_dir = PROCESSED_DIR / project_id / "shorts"
            work_dir.mkdir(parents=True, exist_ok=True)

            if not video_path.exists():
                raise FileNotFoundError(f"Video file not found at {video_path}")

            # Get video duration from ffmpeg_svc
            metadata = {}
            try:
                metadata = ffmpeg_svc.get_video_info(str(video_path))
            except Exception as e:
                logger.warning(f"Failed to read metadata: {e}")
            
            duration = float(metadata.get("duration") or 60.0)

            # Define mock stages for Fase 1
            stages = [
                ("shorts:transcribe", 15, "Transcrevendo áudio com Whisper..."),
                ("shorts:vad", 30, "Detectando silêncios e falas..."),
                ("shorts:scenes", 50, "Detectando mudanças de cena..."),
                ("shorts:detect", 70, "Detectando pessoas com YOLO..."),
                ("shorts:track", 85, "Calculando trajetórias de movimento..."),
                ("shorts:select", 95, "Escolhendo os melhores trechos..."),
            ]

            # Simulate work
            for stage, progress, message in stages:
                if progress_callback:
                    await progress_callback(stage, progress, message)
                await asyncio.sleep(1.0)  # Simulates visual work progress

            # 2. Generate mock clips based on video duration
            # Let's create a few mock shorts
            clips = []
            target_count = job_data["config"].get("clipCount", 3)
            clip_duration = job_data["config"].get("targetDuration", 30.0)
            
            # Make sure we don't exceed the total duration
            step = duration / (target_count + 1)
            for i in range(target_count):
                start = max(0.0, (i + 0.5) * step)
                end = min(duration, start + clip_duration)
                
                # Mock score from 0.70 to 0.95
                score = round(0.70 + (i * 0.08) % 0.25, 2)
                
                clips.append({
                    "id": f"{job_id}_{i+1}",
                    "start_sec": round(start, 2),
                    "end_sec": round(end, 2),
                    "score": score,
                    "status": "pending",
                })
            
            # Save clips to database
            store.save_clips(project_id, job_id, clips)

            # 3. Complete analysis
            store.update_job_status(project_id, job_id, "ready")
            if progress_callback:
                await progress_callback("shorts:done", 100, "Análise concluída com sucesso!")

        except Exception as e:
            logger.exception(f"Error in ShortsPipeline for job {job_id}")
            store.update_job_status(project_id, job_id, "error")
            if progress_callback:
                await progress_callback("shorts:error", 0, f"Erro na análise: {str(e)}")
            raise
