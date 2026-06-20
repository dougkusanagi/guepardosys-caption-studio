"""
Whisper AI Service — Transcription and speech interval detection.
Runs Whisper natively in Python (no subprocess).
"""

from __future__ import annotations

from typing import Any

import whisper


_model_cache: dict[str, Any] = {}


def _get_model(model_name: str) -> Any:
    """Cache loaded Whisper models to avoid reloading."""
    if model_name not in _model_cache:
        _model_cache[model_name] = whisper.load_model(model_name)
    return _model_cache[model_name]


def transcribe(
    audio_path: str,
    model_name: str = "small",
    language: str | None = "pt",
) -> dict:
    """Transcribe audio with word-level timestamps."""
    model = _get_model(model_name)
    result = model.transcribe(
        audio_path,
        language=language,
        word_timestamps=True,
        verbose=False,
        fp16=False,
    )

    # Convert numpy types to native Python for JSON serialization
    return _clean(result)


def collect_speech_intervals(
    transcription: dict,
    duration: float,
    pad_start: float = 0.12,
    pad_end: float = 0.18,
) -> list[tuple[float, float]]:
    """Extract speech intervals from transcription result."""
    intervals: list[tuple[float, float]] = []

    for segment in transcription.get("segments", []):
        words = segment.get("words") or []
        if words:
            for word in words:
                start = word.get("start")
                end = word.get("end")
                if start is None or end is None:
                    continue
                s = max(0.0, min(float(start) - pad_start, duration))
                e = max(0.0, min(float(end) + pad_end, duration))
                if e > s:
                    intervals.append((s, e))
        else:
            start = segment.get("start")
            end = segment.get("end")
            if start is None or end is None:
                continue
            s = max(0.0, min(float(start) - pad_start, duration))
            e = max(0.0, min(float(end) + pad_end, duration))
            if e > s:
                intervals.append((s, e))

    return intervals


def merge_intervals(
    intervals: list[tuple[float, float]],
    min_gap: float = 0.8,
) -> list[tuple[float, float]]:
    """Merge overlapping/close intervals."""
    sorted_intervals = sorted(intervals, key=lambda x: x[0])
    if not sorted_intervals:
        return []

    merged = [list(sorted_intervals[0])]
    for cur_start, cur_end in sorted_intervals[1:]:
        last = merged[-1]
        if cur_start - last[1] <= min_gap:
            last[1] = max(last[1], cur_end)
        else:
            merged.append([cur_start, cur_end])

    return [(s, e) for s, e in merged]


def drop_tiny_intervals(
    intervals: list[tuple[float, float]],
    min_keep: float = 0.12,
) -> list[tuple[float, float]]:
    """Remove intervals shorter than min_keep."""
    return [(s, e) for s, e in intervals if (e - s) >= min_keep]


def get_subtitle_segments(transcription: dict) -> list[dict]:
    """Extract subtitle segments from transcription."""
    subtitles = []
    for segment in transcription.get("segments", []):
        text = (segment.get("text") or "").strip()
        if text:
            words = []
            for w in segment.get("words") or []:
                w_start = w.get("start")
                w_end = w.get("end")
                w_word = w.get("word")
                if w_start is not None and w_end is not None and w_word is not None:
                    words.append({
                        "word": str(w_word),
                        "start": float(w_start),
                        "end": float(w_end),
                    })
            subtitles.append({
                "start": float(segment["start"]),
                "end": float(segment["end"]),
                "text": text,
                "words": words,
            })
    return subtitles


def _clean(obj: Any) -> Any:
    """Convert numpy/torch types to native Python for JSON serialization."""
    if isinstance(obj, dict):
        return {k: _clean(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_clean(v) for v in obj]
    if hasattr(obj, "item"):
        return obj.item()
    return obj
