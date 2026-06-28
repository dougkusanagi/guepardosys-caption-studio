"""
FFmpeg Service — Video/Audio processing operations.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import struct
from pathlib import Path


REQUIRED_BINARIES = ("ffmpeg", "ffprobe")


class FFmpegServiceError(RuntimeError):
    """Base error for FFmpeg/ffprobe failures surfaced to the API layer."""

    status_code = 500

    def __init__(self, message: str, *, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code or self.status_code


class MissingBinaryError(FFmpegServiceError):
    """Raised when ffmpeg or ffprobe is not available in PATH."""

    status_code = 503

    def __init__(self, binary: str):
        self.binary = binary
        super().__init__(
            f"Dependência do sistema ausente: '{binary}' não está disponível no PATH. "
            "Instale o pacote 'ffmpeg' no sistema e reinicie o backend."
        )


import sys

def _resolve_binary(binary: str) -> str:
    # Resolve local bin relative to project root (2 levels up from web/services/ffmpeg_svc.py)
    local_bin_dir = Path(__file__).parents[2] / "bin"
    suffix = ".exe" if sys.platform == "win32" else ""
    local_binary = local_bin_dir / f"{binary}{suffix}"
    
    if local_binary.is_file():
        return str(local_binary)
        
    path_binary = shutil.which(binary)
    if path_binary:
        return path_binary
        
    raise MissingBinaryError(binary)


def get_missing_binaries() -> list[str]:
    missing = []
    for binary in REQUIRED_BINARIES:
        try:
            _resolve_binary(binary)
        except MissingBinaryError:
            missing.append(binary)
    return missing


def _ensure_binary(binary: str) -> None:
    _resolve_binary(binary)


def _stderr_summary(stderr: str, fallback: str) -> str:
    lines = [line.strip() for line in stderr.splitlines() if line.strip()]
    return lines[-1] if lines else fallback


def _run(cmd: list[str], *, error_message: str) -> subprocess.CompletedProcess[str]:
    resolved_cmd = list(cmd)
    resolved_cmd[0] = _resolve_binary(cmd[0])

    try:
        result = subprocess.run(
            resolved_cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=False,
        )

    except OSError as exc:
        detail = exc.strerror or str(exc)
        raise FFmpegServiceError(f"{error_message}: {detail}") from exc

    if result.returncode != 0:
        detail = _stderr_summary(
            result.stderr,
            f"o comando retornou código {result.returncode}",
        )
        raise FFmpegServiceError(f"{error_message}: {detail}")

    return result


def get_video_info(path: str | Path) -> dict:
    """Get detailed video metadata via ffprobe."""
    cmd = [
        "ffprobe", "-v", "error",
        "-show_format", "-show_streams",
        "-print_format", "json",
        str(path),
    ]
    result = _run(cmd, error_message="Não foi possível ler os metadados do vídeo")

    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise FFmpegServiceError("Não foi possível interpretar a resposta do ffprobe") from exc

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
    _run(cmd, error_message="Falha ao extrair áudio")


def generate_waveform(input_path: str | Path, output_path: str | Path) -> list[float]:
    """Generate waveform peaks as JSON for timeline visualization."""
    raw_path = str(output_path) + ".tmp.raw"

    cmd = [
        "ffmpeg", "-y", "-i", str(input_path),
        "-vn", "-ac", "1", "-ar", "400",
        "-f", "s16le", raw_path,
    ]
    _run(cmd, error_message="Falha ao gerar a waveform")

    raw_data = Path(raw_path).read_bytes()
    samples = []
    for i in range(0, len(raw_data), 2):
        if i + 1 < len(raw_data):
            val = struct.unpack_from("<h", raw_data, i)[0]
            samples.append(abs(val) / 32768.0)

    # Downsample to a dense-enough peak series for responsive but expressive rendering.
    target = min(len(samples), 6000)
    step = max(1, len(samples) // target)
    peaks = []
    for i in range(0, len(samples), step):
        chunk = samples[i:i + step]
        peaks.append(round(max(chunk) if chunk else 0, 3))

    non_zero_peaks = sorted(value for value in peaks if value > 0)
    reference_peak = _percentile(non_zero_peaks, 0.985) or max(peaks, default=1.0)
    normalized_peaks = []
    for peak in peaks:
        scaled_peak = min(peak / reference_peak, 1.0) if reference_peak > 0 else 0.0
        normalized_peaks.append(round(pow(scaled_peak, 0.62), 4) if scaled_peak > 0 else 0.0)

    Path(output_path).write_text(json.dumps(normalized_peaks), encoding="utf-8")
    Path(raw_path).unlink(missing_ok=True)
    return normalized_peaks


def _percentile(sorted_values: list[float], ratio: float) -> float:
    if not sorted_values:
        return 0.0
    index = min(len(sorted_values) - 1, max(0, int((len(sorted_values) - 1) * ratio)))
    return sorted_values[index]


def build_filter_complex(intervals: list[tuple[float, float]], audio_stream: str = "[0:a]") -> str:
    """Build FFmpeg filter_complex for trim/atrim + concat."""
    parts = []
    for i, (start, end) in enumerate(intervals):
        parts.append(f"[0:v]trim=start={start:.6f}:end={end:.6f},setpts=PTS-STARTPTS[v{i}]")
        parts.append(f"{audio_stream}atrim=start={start:.6f}:end={end:.6f},asetpts=PTS-STARTPTS[a{i}]")

    concat_inputs = "".join(f"[v{i}][a{i}]" for i in range(len(intervals)))
    parts.append(f"{concat_inputs}concat=n={len(intervals)}:v=1:a=1[outv][outa]")
    return ";".join(parts)


def cut_video(
    input_path: str | Path,
    output_path: str | Path,
    intervals: list[tuple[float, float]],
    crf: int = 18,
    preset: str = "medium",
    audio_path: str | Path = None,
) -> None:
    """Cut and concatenate video segments, optionally using an external audio source."""
    if not intervals:
        raise FFmpegServiceError("Nenhum intervalo disponível para processar")

    if audio_path:
        filter_complex = build_filter_complex(intervals, audio_stream="[1:a]")
        cmd = [
            "ffmpeg", "-y", "-i", str(input_path), "-i", str(audio_path),
            "-filter_complex", filter_complex,
            "-map", "[outv]", "-map", "[outa]",
            "-c:v", "libx264", "-preset", preset, "-crf", str(crf),
            "-c:a", "aac", "-b:a", "192k",
            str(output_path),
        ]
    else:
        filter_complex = build_filter_complex(intervals, audio_stream="[0:a]")
        cmd = [
            "ffmpeg", "-y", "-i", str(input_path),
            "-filter_complex", filter_complex,
            "-map", "[outv]", "-map", "[outa]",
            "-c:v", "libx264", "-preset", preset, "-crf", str(crf),
            "-c:a", "aac", "-b:a", "192k",
            str(output_path),
        ]
    _run(cmd, error_message="Falha ao cortar o vídeo")


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
    _run(cmd, error_message="Falha ao recortar o vídeo")


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
    _run(cmd, error_message="Falha ao aplicar as legendas")
