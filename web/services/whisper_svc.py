"""
Whisper AI Service — Transcription and speech interval detection.
Runs Whisper natively in Python (no subprocess).
"""

from __future__ import annotations

import logging
import wave
from typing import Any
import numpy as np
import whisper

logger = logging.getLogger(__name__)

_model_cache: dict[str, Any] = {}


def _get_model(model_name: str) -> Any:
    """Cache loaded Whisper models to avoid reloading."""
    if model_name not in _model_cache:
        _model_cache[model_name] = whisper.load_model(model_name)
    return _model_cache[model_name]


def load_wav_samples(wav_path: str) -> tuple[np.ndarray, int]:
    """Read mono/stereo WAV frames using wave module and convert to float32 mono [-1, 1]."""
    with wave.open(wav_path, "rb") as w:
        sr = w.getframerate()
        n_channels = w.getnchannels()
        n_frames = w.getnframes()
        data = w.readframes(n_frames)
        # Parse PCM 16-bit
        samples = np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0
        # If stereo, average channels
        if n_channels > 1:
            samples = samples.reshape(-1, n_channels).mean(axis=1)
    return samples, sr


def refine_transcription_timestamps(transcription: dict, audio_path: str) -> dict:
    """Refine Whisper word-level timestamps using rolling window audio energy envelope."""
    try:
        samples, sr = load_wav_samples(audio_path)
    except Exception as e:
        logger.error(f"Failed to load WAV samples for energy refinement: {e}")
        return transcription

    # 1. Compute rolling envelope of absolute amplitude (20ms window)
    win_size = int(0.02 * sr)
    if win_size < 1:
        win_size = 1
    kernel = np.ones(win_size) / win_size
    envelope = np.convolve(np.abs(samples), kernel, mode="same")

    # 2. Dynamic silence threshold based on noise floor (10th percentile)
    noise_floor = np.percentile(envelope, 10)
    p95 = np.percentile(envelope, 95)
    threshold = noise_floor + 0.025 * (p95 - noise_floor)
    threshold = max(0.004, min(0.03, threshold)) # Safety boundaries

    duration = len(samples) / sr
    segments = transcription.get("segments", []) or []

    # 3. Refine word timestamps (preventing overlapping)
    # Collect all words across all segments
    all_words = []
    for seg in segments:
        for w in seg.get("words", []) or []:
            all_words.append(w)

    n_words = len(all_words)
    for idx, w in enumerate(all_words):
        w_start = float(w["start"])
        w_end = float(w["end"])

        # Determine boundaries relative to adjacent words
        prev_end = float(all_words[idx-1]["end"]) if idx > 0 else 0.0
        next_start = float(all_words[idx+1]["start"]) if idx + 1 < n_words else duration

        # Limit maximum extension (max 0.3s backward, 0.5s forward)
        min_start = max(prev_end, w_start - 0.3)
        max_end = min(next_start, w_end + 0.5)

        # Refine start (look backward)
        start_idx = int(w_start * sr)
        min_idx = int(min_start * sr)
        curr_idx = start_idx
        while curr_idx > min_idx:
            if curr_idx < len(envelope) and envelope[curr_idx] < threshold:
                break
            curr_idx -= 1
        w["start"] = round(curr_idx / sr, 2)

        # Refine end (look forward)
        end_idx = int(w_end * sr)
        max_idx = int(max_end * sr)
        curr_idx = end_idx
        while curr_idx < max_idx:
            if curr_idx < len(envelope) and envelope[curr_idx] < threshold:
                break
            curr_idx += 1
        w["end"] = round(curr_idx / sr, 2)

    # 4. Refine segment timestamps (fallback to segment level if word list is empty)
    for idx, seg in enumerate(segments):
        words = seg.get("words", []) or []
        if words:
            seg["start"] = words[0]["start"]
            seg["end"] = words[-1]["end"]
        else:
            seg_start = float(seg["start"])
            seg_end = float(seg["end"])

            prev_end = float(segments[idx-1]["end"]) if idx > 0 else 0.0
            next_start = float(segments[idx+1]["start"]) if idx + 1 < len(segments) else duration

            min_start = max(prev_end, seg_start - 0.3)
            max_end = min(next_start, seg_end + 0.5)

            # Refine start
            start_idx = int(seg_start * sr)
            min_idx = int(min_start * sr)
            curr_idx = start_idx
            while curr_idx > min_idx:
                if curr_idx < len(envelope) and envelope[curr_idx] < threshold:
                    break
                curr_idx -= 1
            seg["start"] = round(curr_idx / sr, 2)

            # Refine end
            end_idx = int(seg_end * sr)
            max_idx = int(max_end * sr)
            curr_idx = end_idx
            while curr_idx < max_idx:
                if curr_idx < len(envelope) and envelope[curr_idx] < threshold:
                    break
                curr_idx += 1
            seg["end"] = round(curr_idx / sr, 2)

    return transcription


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
    clean_res = _clean(result)
    
    # Refine timestamps using audio energy
    try:
        clean_res = refine_transcription_timestamps(clean_res, audio_path)
    except Exception as e:
        logger.error(f"Failed to refine transcription timestamps: {e}")

    return clean_res



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
