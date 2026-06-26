"""
FastAPI router for the AI Shorts module.
"""

import logging
import uuid
from typing import Any

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel, Field

from web.shorts import store
from web.shorts.pipeline import ShortsPipeline

logger = logging.getLogger(__name__)
router = APIRouter()
pipeline = ShortsPipeline()


class ShortsAnalyzeRequest(BaseModel):
    projectId: str
    filename: str
    clientId: str = ""
    clipCount: int = 3
    targetDuration: float = 30.0
    language: str = "pt"
    subtitleStyle: dict[str, Any] = Field(default_factory=dict)
    reframeMode: str = "smart"  # smart | blur | center


class GenerateClipsRequest(BaseModel):
    projectId: str
    jobId: str
    clipIds: list[str] = Field(default_factory=list)


class ExportClipRequest(BaseModel):
    projectId: str
    jobId: str
    clipId: str


@router.post("/analyze")
async def analyze_shorts(req: ShortsAnalyzeRequest, background_tasks: BackgroundTasks):
    """Start the automatic Shorts analysis pipeline in the background."""
    job_id = str(uuid.uuid4())
    config = {
        "clipCount": req.clipCount,
        "targetDuration": req.targetDuration,
        "language": req.language,
        "subtitleStyle": req.subtitleStyle,
        "reframeMode": req.reframeMode,
    }

    # Save initial job state in SQLite
    store.create_job(req.projectId, job_id, req.filename, config)

    # Inline helper to send progress through the global ConnectionManager in web.server.
    # This dynamic import avoids circular dependency issues.
    async def progress_cb(stage: str, progress: int, message: str):
        if not req.clientId:
            return
        try:
            from web.server import manager
            await manager.send(
                req.clientId,
                {
                    "type": "progress",
                    "stage": stage,
                    "progress": progress,
                    "message": message,
                },
            )
        except Exception as e:
            logger.debug(f"WS progress dispatch failed: {e}")

    # Launch pipeline background worker
    background_tasks.add_task(
        pipeline.run_analysis,
        req.projectId,
        job_id,
        req.clientId,
        progress_cb,
    )

    return {"jobId": job_id, "status": "pending"}


@router.get("/{projectId}/status")
async def get_shorts_status(projectId: str, jobId: str = None):
    """Get the status of a Shorts job and its generated clips."""
    if not jobId:
        # Fetch latest job ID for this project
        with store.get_db(projectId) as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT id FROM shorts_jobs WHERE project_id = ? ORDER BY created_at DESC LIMIT 1",
                (projectId,),
            )
            row = cursor.fetchone()
            if not row:
                return {
                    "job": None,
                    "clips": [],
                    "message": "Nenhum job de Shorts encontrado para este projeto.",
                }
            jobId = row["id"]

    job = store.get_job(projectId, jobId)
    if not job:
        raise HTTPException(status_code=404, detail="Job de Shorts não encontrado")

    clips = store.get_clips(projectId, jobId)
    return {"job": job, "clips": clips}


@router.post("/generate")
async def generate_shorts(req: GenerateClipsRequest):
    """Placeholder: queue selected clips for rendering, reframing, and subtitling."""
    logger.info(f"Generate shorts request received: {req}")
    return {"message": "Clips queued for generation", "clipIds": req.clipIds}


@router.post("/export")
async def export_short(req: ExportClipRequest):
    """Placeholder: export a rendered short clip to user local file system."""
    logger.info(f"Export short request received: {req}")
    return {"message": "Clip export initiated", "clipId": req.clipId}
