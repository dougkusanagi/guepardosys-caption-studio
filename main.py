#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Remove trechos sem fala de um vídeo usando Whisper local + FFmpeg.

Como funciona:
1. Extrai o áudio do vídeo em WAV mono 16 kHz.
2. Roda o Whisper local com timestamps por palavra.
3. Cria intervalos de fala com padding.
4. Une intervalos próximos para preservar pausas curtas.
5. Usa FFmpeg para recortar e concatenar apenas os trechos com fala.

Requisitos:
- ffmpeg e ffprobe no PATH
- Python 3.10+
- uv add openai-whisper torch

Exemplo:
uv run main.py \
  --input input.mp4 \
  --output output.mp4 \
  --model small \
  --min-gap 0.8 \
  --pad-start 0.12 \
  --pad-end 0.18
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Iterable

try:
    import whisper
except ImportError:
    print(
        "Erro: pacote 'whisper' não encontrado. Instale com: uv add openai-whisper torch",
        file=sys.stderr,
    )
    sys.exit(1)


Interval = tuple[float, float]


import sys

def _resolve_binary(binary: str) -> str:
    local_binary = Path(__file__).parent / "bin" / (f"{binary}.exe" if sys.platform == "win32" else binary)
    if local_binary.is_file():
        return str(local_binary)
    
    path_binary = shutil.which(binary)
    if path_binary:
        return path_binary
    
    print(f"Erro: '{binary}' não está no PATH nem na pasta local bin/.", file=sys.stderr)
    sys.exit(1)


def run_cmd(cmd: list[str], check: bool = True) -> subprocess.CompletedProcess:
    resolved_cmd = list(cmd)
    resolved_cmd[0] = _resolve_binary(cmd[0])
    return subprocess.run(
        resolved_cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        check=check,
    )


def ensure_binary(name: str) -> None:
    _resolve_binary(name)



def get_video_duration(input_file: Path) -> float:
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(input_file),
    ]
    result = run_cmd(cmd)
    try:
        return float(result.stdout.strip())
    except ValueError as exc:
        raise RuntimeError(
            "Não foi possível obter a duração do vídeo com ffprobe."
        ) from exc


def extract_audio_to_wav(input_file: Path, wav_file: Path) -> None:
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(input_file),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        str(wav_file),
    ]
    result = run_cmd(cmd, check=False)
    if result.returncode != 0:
        raise RuntimeError(f"Falha ao extrair áudio:\n{result.stderr}")


def transcribe_words(
    audio_file: Path,
    model_name: str,
    language: str | None,
    device: str | None,
    fp16: bool,
) -> dict:
    model = whisper.load_model(model_name, device=device)
    result = model.transcribe(
        str(audio_file),
        language=language,
        word_timestamps=True,
        verbose=False,
        fp16=fp16,
    )
    return result


def clamp(value: float, min_value: float, max_value: float) -> float:
    return max(min_value, min(value, max_value))


def collect_speech_intervals(
    transcription: dict,
    duration: float,
    pad_start: float,
    pad_end: float,
) -> list[Interval]:
    intervals: list[Interval] = []

    segments = transcription.get("segments", []) or []

    for segment in segments:
        words = segment.get("words") or []

        if words:
            for word in words:
                start = word.get("start")
                end = word.get("end")

                if start is None or end is None:
                    continue

                start = clamp(float(start) - pad_start, 0.0, duration)
                end = clamp(float(end) + pad_end, 0.0, duration)

                if end > start:
                    intervals.append((start, end))
        else:
            start = segment.get("start")
            end = segment.get("end")

            if start is None or end is None:
                continue

            start = clamp(float(start) - pad_start, 0.0, duration)
            end = clamp(float(end) + pad_end, 0.0, duration)

            if end > start:
                intervals.append((start, end))

    return intervals


def merge_intervals(intervals: Iterable[Interval], min_gap: float) -> list[Interval]:
    sorted_intervals = sorted(intervals, key=lambda x: x[0])

    if not sorted_intervals:
        return []

    merged: list[Interval] = [sorted_intervals[0]]

    for current_start, current_end in sorted_intervals[1:]:
        last_start, last_end = merged[-1]

        if current_start - last_end <= min_gap:
            merged[-1] = (last_start, max(last_end, current_end))
        else:
            merged.append((current_start, current_end))

    return merged


def drop_tiny_intervals(intervals: Iterable[Interval], min_keep: float) -> list[Interval]:
    return [(start, end) for start, end in intervals if (end - start) >= min_keep]


def build_filter_complex(intervals: list[Interval]) -> str:
    """
    Monta o filter_complex usando trim/atrim + concat.

    IMPORTANTE:
    O concat precisa receber os inputs intercalados:
    [v0][a0][v1][a1]...
    e não:
    [v0][v1][a0][a1]
    """
    parts: list[str] = []

    for i, (start, end) in enumerate(intervals):
        parts.append(
            f"[0:v]trim=start={start:.6f}:end={end:.6f},setpts=PTS-STARTPTS[v{i}]"
        )
        parts.append(
            f"[0:a]atrim=start={start:.6f}:end={end:.6f},asetpts=PTS-STARTPTS[a{i}]"
        )

    concat_inputs = "".join(f"[v{i}][a{i}]" for i in range(len(intervals)))
    parts.append(
        f"{concat_inputs}concat=n={len(intervals)}:v=1:a=1[outv][outa]"
    )

    return ";".join(parts)


def save_intervals_json(intervals: list[Interval], path: Path) -> None:
    data = [
        {
            "start": round(start, 3),
            "end": round(end, 3),
            "duration": round(end - start, 3),
        }
        for start, end in intervals
    ]
    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def cut_video(
    input_file: Path,
    output_file: Path,
    intervals: list[Interval],
    reencode_crf: int,
    preset: str,
) -> None:
    if not intervals:
        raise RuntimeError("Nenhum trecho de fala foi detectado. Nada para exportar.")

    filter_complex = build_filter_complex(intervals)

    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(input_file),
        "-filter_complex",
        filter_complex,
        "-map",
        "[outv]",
        "-map",
        "[outa]",
        "-c:v",
        "libx264",
        "-preset",
        preset,
        "-crf",
        str(reencode_crf),
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        str(output_file),
    ]

    result = run_cmd(cmd, check=False)
    if result.returncode != 0:
        raise RuntimeError(f"Falha ao gerar vídeo final:\n{result.stderr}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Remove trechos sem fala de um vídeo usando Whisper local + FFmpeg."
    )
    parser.add_argument("--input", required=True, help="Arquivo de vídeo de entrada")
    parser.add_argument("--output", required=True, help="Arquivo de vídeo de saída")
    parser.add_argument(
        "--model",
        default="small",
        help="Modelo Whisper: tiny, base, small, medium, large",
    )
    parser.add_argument(
        "--language",
        default=None,
        help="Idioma fixo, ex: pt, en. Se omitido, auto-detecta.",
    )
    parser.add_argument(
        "--device",
        default=None,
        help="Device do Whisper, ex: cuda ou cpu",
    )
    parser.add_argument(
        "--fp16",
        action="store_true",
        help="Usa fp16 no Whisper. Útil em GPU compatível.",
    )
    parser.add_argument(
        "--min-gap",
        type=float,
        default=0.8,
        help="Lacuna mínima sem fala para cortar. Pausas menores serão preservadas.",
    )
    parser.add_argument(
        "--pad-start",
        type=float,
        default=0.12,
        help="Padding antes de cada trecho de fala.",
    )
    parser.add_argument(
        "--pad-end",
        type=float,
        default=0.18,
        help="Padding depois de cada trecho de fala.",
    )
    parser.add_argument(
        "--min-keep",
        type=float,
        default=0.12,
        help="Descarta trechos de fala muito curtos após merge.",
    )
    parser.add_argument(
        "--crf",
        type=int,
        default=18,
        help="Qualidade do vídeo H.264 final. Menor = mais qualidade.",
    )
    parser.add_argument(
        "--preset",
        default="medium",
        help="Preset do x264: ultrafast, superfast, veryfast, faster, fast, medium, slow, slower, veryslow",
    )
    parser.add_argument(
        "--save-json",
        default=None,
        help="Se informado, salva os intervalos mantidos em JSON.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    ensure_binary("ffmpeg")
    ensure_binary("ffprobe")

    input_file = Path(args.input).expanduser().resolve()
    output_file = Path(args.output).expanduser().resolve()

    if not input_file.exists():
        print(f"Erro: arquivo não encontrado: {input_file}", file=sys.stderr)
        sys.exit(1)

    with tempfile.TemporaryDirectory(prefix="whisper_cut_") as tmpdir:
        tmpdir_path = Path(tmpdir)
        wav_file = tmpdir_path / "audio.wav"

        print("Extraindo áudio...")
        extract_audio_to_wav(input_file, wav_file)

        duration = get_video_duration(input_file)
        print(f"Duração original: {duration:.2f}s")

        print("Transcrevendo com Whisper...")
        transcription = transcribe_words(
            audio_file=wav_file,
            model_name=args.model,
            language=args.language,
            device=args.device,
            fp16=args.fp16,
        )

        raw_intervals = collect_speech_intervals(
            transcription=transcription,
            duration=duration,
            pad_start=args.pad_start,
            pad_end=args.pad_end,
        )

        merged_intervals = merge_intervals(raw_intervals, min_gap=args.min_gap)
        final_intervals = drop_tiny_intervals(merged_intervals, min_keep=args.min_keep)

        if not final_intervals:
            print("Erro: nenhuma fala útil foi detectada.", file=sys.stderr)
            sys.exit(1)

        kept_duration = sum(end - start for start, end in final_intervals)
        removed_duration = max(0.0, duration - kept_duration)

        print(f"Trechos mantidos: {len(final_intervals)}")
        print(f"Tempo mantido: {kept_duration:.2f}s")
        print(f"Tempo removido: {removed_duration:.2f}s")

        if args.save_json:
            save_intervals_json(final_intervals, Path(args.save_json).expanduser().resolve())

        print("Gerando vídeo final...")
        cut_video(
            input_file=input_file,
            output_file=output_file,
            intervals=final_intervals,
            reencode_crf=args.crf,
            preset=args.preset,
        )

        print(f"Concluído: {output_file}")


if __name__ == "__main__":
    main()
