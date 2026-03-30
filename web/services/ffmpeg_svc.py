"""
FFmpeg Service — Video/Audio processing operations.
"""

from __future__ import annotations

import json
import subprocess
import struct
from pathlib import Path


def _run(cmd: list[str], check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=check
    )


def get_video_info(path: str | Path) -> dict:
    """Get detailed video metadata via ffprobe."""
    cmd = [
        "ffprobe", "-v", "error",
        "-show_format", "-show_streams",
        "-print_format", "json",
        str(path),
    ]
    result = _run(cmd)
    data = json.loads(result.stdout)

    fmt = data.get("format", {})
    video_stream = next((s for s in data.get("streams", []) if s["codec_type"] == "video"), None)
    audio_stream = next((s for s in data.get("streams", []) if s["codec_type"] == "audio"), None)

    # Parse frame rate
    fps = 30.0
    if video_stream and "/" in str(video_stream.get("r_frame_rate", "")):
        num, den = video_stream["r_frame_rate"].split("/")
        fps = int(num) / max(1, int(den))

    return {
        "duration": float(fmt.get("duration", 0)),
        "size": int(fmt.get("size", 0)),
        "bitrate": int(fmt.get("bit_rate", 0)),
        "format": fmt.get("format_name", ""),
        "video": {
            "codec": video_stream.get("codec_name", ""),
            "width": video_stream.get("width", 0),
            "height": video_stream.get("height", 0),
            "fps": round(fps, 2),
        } if video_stream else None,
        "audio": {
            "codec": audio_stream.get("codec_name", ""),
            "sampleRate": int(audio_stream.get("sample_rate", 44100)),
            "channels": int(audio_stream.get("channels", 2)),
        } if audio_stream else None,
    }


def extract_audio(input_path: str | Path, output_path: str | Path, sample_rate: int = 44100) -> None:
    """Extract mono WAV audio from video."""
    cmd = [
        "ffmpeg", "-y", "-i", str(input_path),
        "-vn", "-ac", "1", "-ar", str(sample_rate),
        "-c:a", "pcm_s16le", str(output_path),
    ]
    result = _run(cmd, check=False)
    if result.returncode != 0:
        raise RuntimeError(f"Audio extraction failed:\n{result.stderr}")


def generate_waveform(input_path: str | Path, output_path: str | Path) -> list[float]:
    """Generate waveform peaks as JSON for timeline visualization."""
    raw_path = str(output_path) + ".tmp.raw"

    cmd = [
        "ffmpeg", "-y", "-i", str(input_path),
        "-vn", "-ac", "1", "-ar", "200",
        "-f", "s16le", raw_path,
    ]
    result = _run(cmd, check=False)
    if result.returncode != 0:
        raise RuntimeError(f"Waveform generation failed:\n{result.stderr}")

    raw_data = Path(raw_path).read_bytes()
    samples = []
    for i in range(0, len(raw_data), 2):
        if i + 1 < len(raw_data):
            val = struct.unpack_from("<h", raw_data, i)[0]
            samples.append(abs(val) / 32768.0)

    # Downsample to ~4000 points max
    target = min(len(samples), 4000)
    step = max(1, len(samples) // target)
    peaks = []
    for i in range(0, len(samples), step):
        chunk = samples[i:i + step]
        peaks.append(round(max(chunk) if chunk else 0, 3))

    Path(output_path).write_text(json.dumps(peaks), encoding="utf-8")
    Path(raw_path).unlink(missing_ok=True)
    return peaks


def build_filter_complex(intervals: list[tuple[float, float]]) -> str:
    """Build FFmpeg filter_complex for trim/atrim + concat."""
    parts = []
    for i, (start, end) in enumerate(intervals):
        parts.append(f"[0:v]trim=start={start:.6f}:end={end:.6f},setpts=PTS-STARTPTS[v{i}]")
        parts.append(f"[0:a]atrim=start={start:.6f}:end={end:.6f},asetpts=PTS-STARTPTS[a{i}]")

    concat_inputs = "".join(f"[v{i}][a{i}]" for i in range(len(intervals)))
    parts.append(f"{concat_inputs}concat=n={len(intervals)}:v=1:a=1[outv][outa]")
    return ";".join(parts)


def cut_video(
    input_path: str | Path,
    output_path: str | Path,
    intervals: list[tuple[float, float]],
    crf: int = 18,
    preset: str = "medium",
) -> None:
    """Cut and concatenate video segments."""
    if not intervals:
        raise RuntimeError("No intervals to process")

    filter_complex = build_filter_complex(intervals)
    cmd = [
        "ffmpeg", "-y", "-i", str(input_path),
        "-filter_complex", filter_complex,
        "-map", "[outv]", "-map", "[outa]",
        "-c:v", "libx264", "-preset", preset, "-crf", str(crf),
        "-c:a", "aac", "-b:a", "192k",
        str(output_path),
    ]
    result = _run(cmd, check=False)
    if result.returncode != 0:
        raise RuntimeError(f"Video cut failed:\n{result.stderr}")


def crop_video(
    input_path: str | Path,
    output_path: str | Path,
    x: int, y: int, width: int, height: int,
    crf: int = 18,
) -> None:
    """Crop video to region."""
    cmd = [
        "ffmpeg", "-y", "-i", str(input_path),
        "-vf", f"crop={width}:{height}:{x}:{y}",
        "-c:v", "libx264", "-preset", "medium", "-crf", str(crf),
        "-c:a", "aac", "-b:a", "192k",
        str(output_path),
    ]
    result = _run(cmd, check=False)
    if result.returncode != 0:
        raise RuntimeError(f"Crop failed:\n{result.stderr}")


def burn_subtitles(
    input_path: str | Path,
    ass_path: str | Path,
    output_path: str | Path,
    crf: int = 18,
) -> None:
    """Burn ASS subtitles into video."""
    escaped = str(ass_path).replace("\\", "/").replace(":", "\\:")
    cmd = [
        "ffmpeg", "-y", "-i", str(input_path),
        "-vf", f"ass='{escaped}'",
        "-c:v", "libx264", "-preset", "medium", "-crf", str(crf),
        "-c:a", "aac", "-b:a", "192k",
        str(output_path),
    ]
    result = _run(cmd, check=False)
    if result.returncode != 0:
        raise RuntimeError(f"Subtitle burn failed:\n{result.stderr}")
