# StudioCut

Editor de vídeo com IA para remoção automática de silêncios e geração de legendas.

## Instalação

Baixe o instalador para seu sistema na [página de Releases](../../releases):

- **Windows**: `StudioCut_x.x.x_x64-setup.exe`
- **macOS**: `StudioCut_x.x.x_aarch64.dmg`
- **Linux**: `StudioCut_x.x.x_amd64.deb` ou `.AppImage`

Instale e abra. Na primeira vez que usar a transcrição, o modelo Whisper será baixado automaticamente (~460 MB para o modelo `small`). Precisa de internet apenas nessa vez.

**Zero dependências externas.** Sem Python, sem FFmpeg para instalar, sem comandos no terminal.

## Funcionalidades

- **Remoção de silêncios** — Detecta trechos sem fala com Whisper e corta automaticamente
- **Geração de legendas** — Cria legendas SRT/ASS a partir do áudio
- **Queima de legendas** — Embute legendas estilizadas no vídeo
- **Crop de vídeo** — Recorte a região desejada
- **Timeline visual** — Edição com waveform e controles de playback
- **Presets de estilo** — Configure fonte, cor, posição e tamanho das legendas

## Para desenvolvedores

### Requisitos

- Node.js 22+
- Bun
- Rust (com `cargo`)
- **Linux**: `libgtk-3-dev libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libssl-dev libclang-dev pkg-config`

### Rodar em dev

**Modo app desktop (recomendado)** — compila Rust + abre janela do Tauri + hot-reload no frontend:

```bash
bun install
bun run dev:tauri
```

**Modo web (só frontend)** — abre o React no browser. Útil pra editar UI sem recompilar Rust:

```bash
bun run dev
```

> No modo web, o frontend usa um backend Python legado via proxy. Para testar a stack completa (whisper-rs, FFmpeg, etc), use `bun run dev:tauri`.

### Download do modelo Whisper (dev)

Na primeira transcrição, o app baixa o modelo automaticamente. Se quiser baixar antes:

```bash
# Dentro do app, vá em configurações e baixe o modelo desejado
# Ou coloque manualmente em:
#   Linux:   ~/.local/share/com.studiocut.app/whisper-models/ggml-small.bin
#   macOS:   ~/Library/Application Support/com.studiocut.app/whisper-models/ggml-small.bin
#   Windows: %APPDATA%\com.studiocut.app\whisper-models\ggml-small.bin
```

### Build de produção

```bash
bun run build:tauri
```

O CI/CD automatiza o build para Windows, macOS e Linux. Basta criar uma tag `v0.1.0` e push.

## Arquitetura

```
┌─────────────────────────────────────────┐
│            StudioCut App                 │
│  ┌─────────────┐    ┌─────────────────┐  │
│  │  WebView     │    │  Rust (Tauri)   │  │
│  │  (React)     │◄──►│                 │  │
│  │              │    │  whisper-rs     │  │
│  │  - Timeline  │    │  (whisper.cpp)  │  │
│  │  - Preview   │    │                 │  │
│  │  - Editor    │    │  FFmpeg sidecar │  │
│  └─────────────┘    └─────────────────┘  │
└─────────────────────────────────────────┘
```

Tudo em Rust. Whisper via `whisper-rs` (bindings do whisper.cpp). FFmpeg como sidecar bundlado. O instalador final tem ~100-200MB.

## Modelos Whisper

Os modelos são baixados sob demanda do [whisper.cpp](https://huggingface.co/ggerganov/whisper.cpp):

| Modelo | Tamanho | Velocidade | Qualidade |
|--------|---------|------------|-----------|
| base   | ~140 MB | Muito rápida | Boa |
| small  | ~466 MB | Rápida | Muito boa |
| medium | ~1.5 GB | Média | Excelente |
| large  | ~3.1 GB | Lenta | Máxima |

O modelo `small` é recomendado para a maioria dos usos. Todos suportam português brasileiro nativamente.
