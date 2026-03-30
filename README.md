# video-silence-remover

Remove trechos sem fala de vídeos usando Whisper local e FFmpeg.

## Requisitos

- Python 3.10+
- `ffmpeg` e `ffprobe` instalados no sistema
- `uv` instalado

## Instalação

```bash
uv venv
source .venv/bin/activate
uv sync
```

## Dependências do sistema

No Ubuntu/Debian:

```bash
sudo apt install -y ffmpeg
```

## Estrutura sugerida

```text
video-silence-remover/
├── .gitignore
├── .python-version
├── pyproject.toml
├── README.md
└── cut_silence_with_whisper.py
```

## Execução

```bash
uv run python cut_silence_with_whisper.py \
  --input video.mp4 \
  --output video_sem_silencios.mp4 \
  --model small \
  --language pt
```

## Observações

- `ffmpeg` e `ffprobe` não entram no `pyproject.toml`, porque são dependências do sistema.
- O arquivo `uv.lock` será gerado automaticamente quando você rodar `uv sync`.
