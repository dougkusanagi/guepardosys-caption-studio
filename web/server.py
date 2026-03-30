"""
StudioCut — FastAPI Web Server

Video editor with AI silence removal and subtitle generation.
Uses WebSocket for real-time progress updates during processing.

Run:
    uv run uvicorn web.server:app --reload --port 3000
"""

from __future__ import annotations

import asyncio
import json
import shutil
import uuid
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from web.services import ffmpeg_svc, whisper_svc, subtitle_svc

# --- Paths ---
BASE_DIR = Path(__file__).parent
PUBLIC_DIR = BASE_DIR / "public"
DIST_DIR = BASE_DIR / "dist"
DIST_ASSETS_DIR = DIST_DIR / "assets"
UPLOADS_DIR = BASE_DIR / "uploads"
PROCESSED_DIR = BASE_DIR / "processed"

PROJECTS_DIR = BASE_DIR / "projects"

UPLOADS_DIR.mkdir(exist_ok=True)
PROCESSED_DIR.mkdir(exist_ok=True)
PROJECTS_DIR.mkdir(exist_ok=True)

# --- App ---
app = FastAPI(title="StudioCut", version="1.0.0")

# Static files
app.mount("/css", StaticFiles(directory=str(PUBLIC_DIR / "css")), name="css")
app.mount("/js", StaticFiles(directory=str(PUBLIC_DIR / "js")), name="js")
app.mount("/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")
app.mount("/processed", StaticFiles(directory=str(PROCESSED_DIR)), name="processed")


# --- WebSocket Manager ---
class ConnectionManager:
    def __init__(self):
        self.connections: dict[str, WebSocket] = {}

    async def connect(self, ws: WebSocket) -> str:
        await ws.accept()
        client_id = str(uuid.uuid4())
        self.connections[client_id] = ws
        await ws.send_json({"type": "connected", "clientId": client_id})
        return client_id

    def disconnect(self, client_id: str):
        self.connections.pop(client_id, None)

    async def send(self, client_id: str, data: dict):
        ws = self.connections.get(client_id)
        if ws:
            try:
                await ws.send_json(data)
            except Exception:
                self.disconnect(client_id)


manager = ConnectionManager()


# --- Request Models ---
class RemoveSilenceRequest(BaseModel):
    filename: str
    projectId: str
    clientId: str = ""
    model: str = "small"
    language: str = "pt"
    minGap: float = 0.8
    padStart: float = 0.12
    padEnd: float = 0.18
    minKeep: float = 0.12


class SubtitleRequest(BaseModel):
    filename: str
    projectId: str
    clientId: str = ""
    model: str = "small"
    language: str = "pt"
    style: dict = {}


class BurnSubtitleRequest(BaseModel):
    filename: str
    projectId: str
    clientId: str = ""
    style: dict = {}


class CropRequest(BaseModel):
    filename: str
    projectId: str
    clientId: str = ""
    x: int
    y: int
    width: int
    height: int


class ExportRequest(BaseModel):
    projectId: str
    sourceFile: str


class SpectrogramAudioRequest(BaseModel):
    projectId: str
    filename: str


# --- Helper to send progress ---
async def send_progress(client_id: str, stage: str, progress: int, message: str):
    await manager.send(client_id, {
        "type": "progress",
        "stage": stage,
        "progress": progress,
        "message": message,
    })


# --- Routes ---

def _frontend_index() -> Path:
    dist_index = DIST_DIR / "index.html"
    if dist_index.exists():
        return dist_index
    return PUBLIC_DIR / "index.html"


@app.get("/")
async def index():
    return FileResponse(str(_frontend_index()))


@app.get("/assets/{asset_path:path}")
async def frontend_assets(asset_path: str):
    asset = DIST_ASSETS_DIR / asset_path
    if asset.is_file():
        return FileResponse(str(asset))
    return JSONResponse({"error": "Asset not found"}, status_code=404)


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    client_id = await manager.connect(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(client_id)


@app.post("/api/upload")
async def upload_video(video: UploadFile = File(...)):
    """Upload a video file and extract metadata + waveform."""
    ext = Path(video.filename or "video.mp4").suffix
    allowed = {".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v", ".flv", ".wmv"}
    if ext.lower() not in allowed:
        return JSONResponse({"error": "Formato não suportado"}, status_code=400)

    # Save file
    file_id = str(uuid.uuid4())
    filename = f"{file_id}{ext}"
    file_path = UPLOADS_DIR / filename

    with open(file_path, "wb") as f:
        shutil.copyfileobj(video.file, f)

    # Create project
    project_id = str(uuid.uuid4())
    project_dir = PROCESSED_DIR / project_id
    project_dir.mkdir(parents=True, exist_ok=True)

    # Get video info
    info = ffmpeg_svc.get_video_info(str(file_path))

    # Generate waveform
    waveform_path = project_dir / "waveform.json"
    waveform = ffmpeg_svc.generate_waveform(str(file_path), str(waveform_path))

    return {
        "projectId": project_id,
        "file": {
            "originalName": video.filename,
            "filename": filename,
            "path": f"/uploads/{filename}",
            "size": file_path.stat().st_size,
        },
        "info": info,
        "waveform": waveform,
    }


@app.post("/api/project/spectrogram-audio")
async def ensure_spectrogram_audio(req: SpectrogramAudioRequest):
    """Generate spectrogram audio on demand so upload stays responsive."""
    input_path = UPLOADS_DIR / req.filename
    if not input_path.exists():
        return JSONResponse({"error": "Arquivo não encontrado"}, status_code=404)

    project_dir = PROCESSED_DIR / req.projectId
    project_dir.mkdir(parents=True, exist_ok=True)
    audio_path = project_dir / "audio.wav"

    if not audio_path.exists():
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(
            None,
            lambda: ffmpeg_svc.extract_audio(str(input_path), str(audio_path))
        )

    return {"audioPath": f"/processed/{req.projectId}/audio.wav"}


@app.post("/api/process/remove-silence")
async def remove_silence(req: RemoveSilenceRequest):
    """AI-powered silence removal using Whisper."""
    input_path = UPLOADS_DIR / req.filename
    if not input_path.exists():
        return JSONResponse({"error": "Arquivo não encontrado"}, status_code=404)

    project_dir = PROCESSED_DIR / req.projectId
    project_dir.mkdir(parents=True, exist_ok=True)

    # Send initial progress
    await send_progress(req.clientId, "transcribe", 0, "Extraindo áudio...")

    # Extract 16kHz audio for Whisper
    audio_path = project_dir / "audio_16k.wav"
    ffmpeg_svc.extract_audio(str(input_path), str(audio_path), sample_rate=16000)

    await send_progress(req.clientId, "transcribe", 10, "Transcrevendo com Whisper...")

    # Transcribe (runs in thread pool to not block event loop)
    loop = asyncio.get_event_loop()
    transcription = await loop.run_in_executor(
        None,
        lambda: whisper_svc.transcribe(str(audio_path), req.model, req.language)
    )

    await send_progress(req.clientId, "transcribe", 80, "Analisando intervalos de fala...")

    # Collect and process intervals
    info = ffmpeg_svc.get_video_info(str(input_path))
    duration = info["duration"]

    intervals = whisper_svc.collect_speech_intervals(
        transcription, duration, req.padStart, req.padEnd
    )
    merged = whisper_svc.merge_intervals(intervals, req.minGap)
    final = whisper_svc.drop_tiny_intervals(merged, req.minKeep)

    if not final:
        return JSONResponse({"error": "Nenhuma fala detectada no vídeo"}, status_code=400)

    kept = sum(e - s for s, e in final)

    await send_progress(req.clientId, "cut", 0, "Cortando vídeo...")

    # Cut video
    output_name = f"processed_{uuid.uuid4().hex[:8]}.mp4"
    output_path = project_dir / output_name

    await loop.run_in_executor(
        None,
        lambda: ffmpeg_svc.cut_video(str(input_path), str(output_path), final)
    )

    # Generate new waveform
    new_waveform_path = project_dir / "waveform_processed.json"
    new_waveform = ffmpeg_svc.generate_waveform(str(output_path), str(new_waveform_path))

    await send_progress(req.clientId, "done", 100, "Concluído!")

    return {
        "outputPath": f"/processed/{req.projectId}/{output_name}",
        "intervals": [
            {"start": round(s, 3), "end": round(e, 3), "duration": round(e - s, 3)}
            for s, e in final
        ],
        "stats": {
            "originalDuration": duration,
            "keptDuration": round(kept, 2),
            "removedDuration": round(duration - kept, 2),
            "segmentCount": len(final),
        },
        "waveform": new_waveform,
        "transcription": transcription,
    }


@app.post("/api/process/subtitles")
async def generate_subtitles(req: SubtitleRequest):
    """Generate subtitles using Whisper AI."""
    input_path = UPLOADS_DIR / req.filename
    if not input_path.exists():
        return JSONResponse({"error": "Arquivo não encontrado"}, status_code=404)

    project_dir = PROCESSED_DIR / req.projectId
    project_dir.mkdir(parents=True, exist_ok=True)

    await send_progress(req.clientId, "subtitles", 0, "Extraindo áudio...")

    audio_path = project_dir / "audio_sub.wav"
    ffmpeg_svc.extract_audio(str(input_path), str(audio_path), sample_rate=16000)

    await send_progress(req.clientId, "subtitles", 10, "Gerando legendas com IA...")

    loop = asyncio.get_event_loop()
    transcription = await loop.run_in_executor(
        None,
        lambda: whisper_svc.transcribe(str(audio_path), req.model, req.language)
    )

    subtitles = whisper_svc.get_subtitle_segments(transcription)

    # Write files
    srt_path = project_dir / "subtitles.srt"
    ass_path = project_dir / "subtitles.ass"
    subtitle_svc.write_srt(subtitles, str(srt_path))
    subtitle_svc.write_ass(subtitles, str(ass_path), req.style or None)

    await send_progress(req.clientId, "subtitles", 100, "Legendas geradas!")

    return {
        "subtitles": subtitles,
        "srtPath": f"/processed/{req.projectId}/subtitles.srt",
        "assPath": f"/processed/{req.projectId}/subtitles.ass",
    }


@app.post("/api/process/burn-subtitles")
async def burn_subtitles(req: BurnSubtitleRequest):
    """Burn subtitles into the video."""
    input_path = UPLOADS_DIR / req.filename
    project_dir = PROCESSED_DIR / req.projectId
    ass_path = project_dir / "subtitles.ass"

    if not ass_path.exists():
        return JSONResponse({"error": "Gere as legendas primeiro"}, status_code=400)

    # Re-write ASS with latest style
    if req.style:
        srt_data = json.loads((project_dir / "subtitles.srt").read_text("utf-8")) if False else None
        # Re-read subtitles from existing SRT
        subtitles = _parse_srt(project_dir / "subtitles.srt")
        subtitle_svc.write_ass(subtitles, str(ass_path), req.style)

    await send_progress(req.clientId, "burn", 0, "Aplicando legendas...")

    output_name = f"subtitled_{uuid.uuid4().hex[:8]}.mp4"
    output_path = project_dir / output_name

    loop = asyncio.get_event_loop()
    await loop.run_in_executor(
        None,
        lambda: ffmpeg_svc.burn_subtitles(str(input_path), str(ass_path), str(output_path))
    )

    await send_progress(req.clientId, "done", 100, "Legendas aplicadas!")

    return {"outputPath": f"/processed/{req.projectId}/{output_name}"}


@app.post("/api/process/crop")
async def crop_video(req: CropRequest):
    """Crop video to specified region."""
    input_path = UPLOADS_DIR / req.filename
    if not input_path.exists():
        return JSONResponse({"error": "Arquivo não encontrado"}, status_code=404)

    project_dir = PROCESSED_DIR / req.projectId
    project_dir.mkdir(parents=True, exist_ok=True)

    await send_progress(req.clientId, "crop", 0, "Cortando vídeo...")

    output_name = f"cropped_{uuid.uuid4().hex[:8]}.mp4"
    output_path = project_dir / output_name

    loop = asyncio.get_event_loop()
    await loop.run_in_executor(
        None,
        lambda: ffmpeg_svc.crop_video(
            str(input_path), str(output_path), req.x, req.y, req.width, req.height
        )
    )

    info = ffmpeg_svc.get_video_info(str(output_path))

    await send_progress(req.clientId, "done", 100, "Corte concluído!")

    return {"outputPath": f"/processed/{req.projectId}/{output_name}", "info": info}


@app.post("/api/export")
async def export_video(req: ExportRequest):
    """Download the processed video."""
    source = BASE_DIR / req.sourceFile.lstrip("/")
    if not source.exists():
        return JSONResponse({"error": "Arquivo não encontrado"}, status_code=404)
    return FileResponse(str(source), filename=f"studiocut_export.mp4", media_type="video/mp4")


# --- Project Management ---

@app.post("/api/project/save")
async def save_project_endpoint(data: dict):
    """Save project state to JSON file."""
    name = data.get("name", "untitled").strip()
    if not name:
        return JSONResponse({"error": "Nome do projeto é obrigatório"}, status_code=400)

    # Sanitize filename
    safe_name = "".join(c if c.isalnum() or c in " _-" else "_" for c in name)
    file_path = PROJECTS_DIR / f"{safe_name}.json"

    from datetime import datetime, timezone
    data["savedAt"] = datetime.now(tz=timezone.utc).isoformat()

    file_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    return {"ok": True, "name": name}


@app.get("/api/project/list")
async def list_projects_endpoint():
    """List all saved projects."""
    projects = []
    for f in sorted(PROJECTS_DIR.glob("*.json"), key=lambda x: x.stat().st_mtime, reverse=True):
        try:
            data = json.loads(f.read_text("utf-8"))
            projects.append({
                "name": data.get("name", f.stem),
                "originalName": data.get("originalName", ""),
                "date": data.get("savedAt", ""),
                "file": f.name,
            })
        except Exception:
            continue
    return projects


@app.get("/api/project/load/{project_name}")
async def load_project_endpoint(project_name: str):
    """Load a project by name."""
    safe_name = "".join(c if c.isalnum() or c in " _-" else "_" for c in project_name)
    file_path = PROJECTS_DIR / f"{safe_name}.json"

    if not file_path.exists():
        return JSONResponse({"error": "Projeto não encontrado"}, status_code=404)

    data = json.loads(file_path.read_text("utf-8"))
    return data


@app.delete("/api/project/delete/{project_name}")
async def delete_project_endpoint(project_name: str):
    """Delete a saved project."""
    safe_name = "".join(c if c.isalnum() or c in " _-" else "_" for c in project_name)
    file_path = PROJECTS_DIR / f"{safe_name}.json"

    if file_path.exists():
        file_path.unlink()

    return {"ok": True}


@app.get("/{full_path:path}")
async def spa_fallback(full_path: str):
    """Serve the Vite SPA in production while keeping legacy static files reachable."""
    reserved = ("api/", "uploads/", "processed/", "css/", "js/", "assets/", "ws")
    if not full_path or full_path.startswith(reserved):
        return JSONResponse({"error": "Not found"}, status_code=404)

    dist_file = DIST_DIR / full_path
    public_file = PUBLIC_DIR / full_path

    if dist_file.is_file():
        return FileResponse(str(dist_file))
    if public_file.is_file():
        return FileResponse(str(public_file))

    return FileResponse(str(_frontend_index()))


# --- Helpers ---
def _parse_srt(path: Path) -> list[dict]:
    """Parse SRT file back to subtitle list."""
    text = path.read_text("utf-8")
    subtitles = []
    blocks = text.strip().split("\n\n")
    for block in blocks:
        lines = block.strip().split("\n")
        if len(lines) >= 3:
            times = lines[1].split(" --> ")
            subtitles.append({
                "start": _srt_to_seconds(times[0].strip()),
                "end": _srt_to_seconds(times[1].strip()),
                "text": " ".join(lines[2:]),
            })
    return subtitles


def _srt_to_seconds(ts: str) -> float:
    parts = ts.replace(",", ".").split(":")
    return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])


# --- Run ---
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("web.server:app", host="0.0.0.0", port=3000, reload=True)
