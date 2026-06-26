# Plano Técnico — Módulo de Geração Automática de Shorts/Reels/TikToks

> Documento de arquitetura para integrar geração automática de vídeos verticais ao **Guepardosys Caption Studio**, reutilizando a infraestrutura existente e evoluindo o produto de forma incremental — no espírito de como editores como CapCut adicionam novos recursos sem reestruturar a base.

**Data:** 25/06/2025  
**Escopo:** Novo módulo isolado; funcionalidades atuais (remoção de silêncio, legendas, export) permanecem intactas.

---

## Sumário

1. [Estado atual do projeto](#1-estado-atual-do-projeto)
2. [Fluxo alvo da nova funcionalidade](#2-fluxo-alvo-da-nova-funcionalidade)
3. [Estratégia de integração (mínimo impacto)](#3-estratégia-de-integração-mínimo-impacto)
4. [O que reaproveitar, adaptar e criar](#4-o-que-reaproveitar-adaptar-e-criar)
5. [Organização do novo módulo](#5-organização-do-novo-módulo)
6. [Sistema de Skills (interno ao módulo)](#6-sistema-de-skills-interno-ao-módulo)
7. [Avaliação: pipeline vs. agente de IA](#7-avaliação-pipeline-vs-agente-de-ia)
8. [Stack tecnológica e restrições de GPU 6 GB](#8-stack-tecnológica-e-restrições-de-gpu-6-gb)
9. [Comunicação, progresso e persistência](#9-comunicação-progresso-e-persistência)
10. [Frontend: nova ferramenta sem reescrever o editor](#10-frontend-nova-ferramenta-sem-reescrever-o-editor)
11. [Roadmap incremental](#11-roadmap-incremental)
12. [Riscos e mitigações](#12-riscos-e-mitigações)
13. [Referências ao código existente](#13-referências-ao-código-existente)

---

## 1. Estado atual do projeto

### 1.1 Stack real (verificada no código)

| Camada | Tecnologia | Evidência |
|--------|------------|-----------|
| Desktop shell | Tauri 2 (Rust) | `src-tauri/src/lib.rs`, `tauri.conf.json` |
| Backend | FastAPI + Uvicorn (:3000) | `web/server.py` |
| Frontend | **React 19 + Vite 8** (SPA, não Next.js) | `web/frontend/`, `package.json` |
| Transcrição | OpenAI Whisper + PyTorch | `web/services/whisper_svc.py`, `pyproject.toml` |
| Vídeo | FFmpeg/FFprobe embutidos em `bin/` | `web/services/ffmpeg_svc.py`, `scripts/download-ffmpeg.mjs` |
| Empacotamento | PyInstaller → sidecar Tauri | `backend.spec`, `scripts/build-backend.mjs` |

### 1.2 Arquitetura de comunicação

```
┌─────────────────────────────────────────────────────────────┐
│  Tauri WebView — React SPA                                  │
│  Dev: localhost:5173  │  Prod: web/dist servido pelo FastAPI │
└──────────────┬──────────────────────────────┬───────────────┘
               │ HTTP REST + WebSocket /ws     │ invoke (1 cmd)
               ▼                               ▼
┌──────────────────────────────┐    ┌─────────────────────────┐
│  FastAPI (Python sidecar)    │◄───│  Rust: export nativo    │
│  uvicorn / PyInstaller       │    │  export_video_to_local  │
└──────────────┬───────────────┘    └─────────────────────────┘
               │ subprocess
               ▼
┌──────────────────────────────┐
│  FFmpeg + Whisper (local)    │
└──────────────────────────────┘
```

**Padrões já estabelecidos:**

- Rotas `POST /api/process/*` com modelos Pydantic e `clientId` para progresso via WebSocket (`ConnectionManager` em `web/server.py`, linhas 64–88 e 152–158).
- Operações CPU/GPU pesadas em `asyncio.get_event_loop().run_in_executor()` (ex.: `remove_silence`, linhas 275–307).
- Armazenamento por projeto em `web/processed/{projectId}/` e uploads em `web/uploads/`.
- Cliente REST centralizado em `web/frontend/src/lib/api.js`; detecção Tauri para `BASE_URL = http://127.0.0.1:3000`.
- Hook `useWsClient` em `App.jsx` (linha ~2434) alimenta `ProcessingModal`.

**Papel mínimo do Rust:** lifecycle do sidecar + diálogo nativo de exportação (`export_video_to_local` em `src-tauri/src/lib.rs`). Não há IPC Rust↔Python além de HTTP local.

### 1.3 Funcionalidades existentes e seus fluxos

#### Remoção de silêncio (`POST /api/process/remove-silence`)

1. Extrai áudio 16 kHz → `ffmpeg_svc.extract_audio`
2. Transcreve → `whisper_svc.transcribe`
3. Deriva intervalos de fala → `collect_speech_intervals`, `merge_intervals`, `drop_tiny_intervals`
4. Corta e concatena → `ffmpeg_svc.cut_video`
5. Retorna waveform, intervalos e transcrição completa

#### Legendas (`POST /api/process/subtitles` + `burn-subtitles`)

1. Mesma extração + transcrição Whisper
2. Segmentos → `whisper_svc.get_subtitle_segments`
3. SRT/ASS → `subtitle_svc.write_srt` / `write_ass` com `play_res` do vídeo fonte
4. Queima → `ffmpeg_svc.burn_subtitles`

#### Crop (`POST /api/process/crop`)

- Backend funcional via `ffmpeg_svc.crop_video`
- **Gap:** frontend React chama apenas toast em `handleCropChange` (linha 674 de `App.jsx`) — não invoca `cropVideoRequest`

### 1.4 O que **não** existe hoje

| Lacuna | Impacto para Shorts |
|--------|---------------------|
| Conversão de aspect ratio (9:16, blur/pad) | Bloqueante |
| Segmentação em múltiplos clips exportáveis | Bloqueante |
| Detecção de cena, pessoas, tracking | Bloqueante para reframe inteligente |
| Fila de jobs / cancelamento | Importante para batch |
| Cache de análise (SQLite) | Importante para reprocessamento |
| Seleção automática de “melhores trechos” | Core da feature |
| Preview 9:16 no editor | UX |
| Presets de plataforma (TikTok/Reels) | UX (mencionado em `project_suggestions.md`, não implementado) |

### 1.5 Gerenciamento de tarefas atual

Não há fila de jobs. Cada request HTTP bloqueia até concluir (com offload para thread pool). O WebSocket envia marcos fixos de progresso. Para Shorts com pipeline longo (transcrição + VAD + cenas + YOLO + export batch), será necessário **estender** esse padrão — não substituí-lo.

---

## 2. Fluxo alvo da nova funcionalidade

```
Receber vídeo
    ↓
Analisar vídeo (metadata, duração, fps)
    ↓
Gerar transcrição (Whisper / Faster-Whisper)
    ↓
Detectar silêncios (Silero VAD + intervalos Whisper existentes)
    ↓
Detectar mudanças de cena (PySceneDetect)
    ↓
Detectar pessoas (YOLOv11)
    ↓
Rastrear rostos/corpos (ByteTrack)
    ↓
Selecionar automaticamente os melhores trechos
    ↓
Reenquadrar para 9:16 (crop dinâmico ou blur)
    ↓
Gerar legendas (reutilizar subtitle_svc)
    ↓
Exportar N Shorts
```

Cada etapa produz artefatos persistidos em `processed/{projectId}/shorts/` para permitir retomada, preview parcial e re-export sem re-analisar tudo.

---

## 3. Estratégia de integração (mínimo impacto)

### Princípio: nova ferramenta, mesma base

O produto hoje opera como **SPA monolítica** (`App.jsx`, ~3300 linhas) com fluxo: upload → editor → ferramentas na toolbar. A integração deve seguir o mesmo padrão de “ferramenta adicional”, não um redesign arquitetural.

### 3.1 Backend — ponto de entrada único

Adicionar namespace de rotas **sem alterar rotas existentes**:

| Rota | Responsabilidade |
|------|------------------|
| `POST /api/shorts/analyze` | Pipeline de análise (transcrição → tracking) |
| `GET /api/shorts/{projectId}/status` | Estado do job / artefatos prontos |
| `POST /api/shorts/generate` | Seleção + reframe + legendas |
| `POST /api/shorts/export` | Export de um ou N clips |
| `POST /api/shorts/export/batch` | Export em lote (fase posterior) |

Registro em `web/server.py` via import de um router dedicado:

```python
# web/server.py (adicionar)
from web.shorts.router import router as shorts_router
app.include_router(shorts_router, prefix="/api/shorts", tags=["shorts"])
```

Isso isola o módulo e evita inflar ainda mais `server.py`.

### 3.2 Python — pacote autônomo

Novo pacote `web/shorts/` com pipeline, skills e modelos. Os serviços legados (`web/services/`) permanecem; o módulo Shorts **importa** deles, não os modifica agressivamente.

### 3.3 Frontend — modo ferramenta

Introduzir estado `activeTool: 'editor' | 'shorts'` na raiz de `App.jsx` (ou extrair para `web/frontend/src/features/shorts/` quando o código crescer). A tela inicial (`UploadScreen`) ganha um segundo cartão: **“Gerar Shorts automáticos”**, reutilizando `uploadVideo()` de `api.js`.

### 3.4 Tauri — sem mudanças obrigatórias na Fase 1

O comando `export_video_to_local` já aceita qualquer `sourceFile` em `processed/`. Para batch, estender com sucesso `-short-01` no `default_name` — alteração mínima em Rust, opcional na Fase 5.

### 3.5 Refatorações recomendadas (somente facilitadoras)

| Refatoração | Motivo | Escopo |
|-------------|--------|--------|
| Extrair `send_progress` + padrão executor para `web/services/job_svc.py` | Evitar duplicação entre legendas e Shorts | ~80 linhas |
| Adicionar `play_res` override em `subtitle_svc.write_ass` | Legendas verticais 1080×1920 | Já suportado via parâmetro |
| Conectar `handleCropChange` → `cropVideoRequest` | Corrigir gap existente; útil para ajuste manual pós-auto | Frontend only |
| Extrair `_model_cache` Whisper para módulo compartilhado | Faster-Whisper e Whisper atual coexistirem | Fase 2 |

Nenhuma dessas refatorações altera comportamento das ferramentas atuais se feita com wrappers backward-compatible.

---

## 4. O que reaproveitar, adaptar e criar

### 4.1 Reaproveitar diretamente (sem alteração)

| Componente | Arquivo | Uso no módulo Shorts |
|------------|---------|----------------------|
| Upload + metadata + waveform | `web/server.py` → `/api/upload` | Entrada de vídeo |
| Resolução FFmpeg local | `ffmpeg_svc._resolve_binary`, `get_video_info` | Metadata e dimensões |
| Extração de áudio | `ffmpeg_svc.extract_audio` | Transcrição e VAD |
| Intervalos de fala | `whisper_svc.collect/merge/drop_*` | Cortes e seleção de trechos |
| Segmentos de legenda | `whisper_svc.get_subtitle_segments` | Legendas por clip |
| Geração SRT/ASS | `subtitle_svc.write_srt`, `write_ass` | Com `play_res=(1080, 1920)` |
| Queima de legendas | `ffmpeg_svc.burn_subtitles` | Export final |
| Corte por coordenadas | `ffmpeg_svc.crop_video` | Reframe estático |
| Corte por intervalos | `ffmpeg_svc.cut_video`, `build_filter_complex` | Extrair trechos |
| Progresso WebSocket | `ConnectionManager`, `useWsClient` | Pipeline longo |
| Cliente HTTP | `web/frontend/src/lib/api.js` | Novas funções espelhando padrão existente |
| Export nativo Tauri | `export_video_to_local` | Salvar Shorts |
| Presets de estilo | `preset_svc.py` + `PresetSelector` | Preset “TikTok Vertical” |
| Persistência de projeto | `/api/project/save` | Campo opcional `shortsJob` |
| Empacotamento | `backend.spec`, `build-backend.mjs` | Incluir novos dados/modelos |

### 4.2 Adaptar (pequenas mudanças)

| Componente | Adaptação necessária | Justificativa |
|------------|---------------------|---------------|
| `whisper_svc.py` | Wrapper `transcribe_faster()` ou flag `engine=faster-whisper`; extrair cache de modelos | VRAM e velocidade; reuso de `get_subtitle_segments` |
| `ffmpeg_svc.py` | Novas funções: `scale_pad_vertical`, `reframe_with_crop_path`, `extract_frames`, `concat_clips` | 9:16 e export batch |
| `subtitle_svc.py` | Preset default “Shorts” com `fontSize` maior, `positionY` ajustado para safe zone mobile | Legibilidade vertical |
| `preset_svc.py` | Entrada default TikTok/Reels em `DEFAULT_PRESETS` | UX imediata |
| `App.jsx` | Modo Shorts + wiring crop (bug existente) | Nova ferramenta |
| `api.js` | Funções `analyzeShorts`, `generateShorts`, `exportShort` | Padrão `postJson` |
| `backend.spec` | Incluir `datas` para modelos ONNX/YOLO se empacotados | Distribuição |
| `pyproject.toml` | Dependências opcionais em grupo `shorts` | Instalação modular |

### 4.3 Criar do zero

| Módulo | Responsabilidade |
|--------|------------------|
| `web/shorts/pipeline.py` | Orquestrador sequencial do fluxo |
| `web/shorts/skills/*.py` | Skills isoladas (ver seção 6) |
| `web/shorts/selection/` | Heurísticas + scoring de trechos |
| `web/shorts/reframe/` | Crop dinâmico a partir de tracks |
| `web/shorts/store.py` | SQLite: análise, clips, status |
| `web/shorts/router.py` | Rotas FastAPI |
| `web/shorts/models/` | Download/cache de pesos (YOLO, Silero, Gemma) |
| `web/frontend/src/features/shorts/` | UI do wizard Shorts |

---

## 5. Organização do novo módulo

```
web/
├── services/                    # INALTERADO (serviços compartilhados)
│   ├── ffmpeg_svc.py            # + funções de reframe/export
│   ├── whisper_svc.py           # + adapter faster-whisper
│   ├── subtitle_svc.py
│   └── job_svc.py               # NOVO (opcional): progress + executor
│
└── shorts/                      # NOVO MÓDULO
    ├── __init__.py
    ├── router.py                # Rotas /api/shorts/*
    ├── pipeline.py              # Orquestrador
    ├── store.py                 # SQLite (análise, clips, jobs)
    ├── config.py                # Defaults: duração max, resolução, thresholds
    │
    ├── skills/
    │   ├── base.py              # Skill ABC, contexto, progress callback
    │   ├── transcribe.py        # TranscribeSkill
    │   ├── vad.py               # VADSkill
    │   ├── scene_detection.py   # SceneDetectionSkill
    │   ├── person_detection.py  # PersonDetectionSkill (YOLO)
    │   ├── face_tracking.py     # FaceTrackingSkill (ByteTrack)
    │   ├── selection.py         # ShortSelectionSkill
    │   ├── reframing.py         # ReframingSkill
    │   ├── subtitle.py          # SubtitleSkill (wrap subtitle_svc)
    │   └── export.py            # ExportSkill
    │
    ├── selection/
    │   ├── scorer.py            # Score composto (energia, fala, cena, rosto)
    │   └── planner.py           # Divide vídeo em N clips ≤60s
    │
    ├── reframe/
    │   ├── crop_path.py         # Trajetória de crop por frame
    │   └── ffmpeg_builder.py    # filter_complex dinâmico
    │
    ├── ai/
    │   └── gemma_ranker.py      # Opcional: rerank semântico de trechos
    │
    └── models/
        └── registry.py          # Paths, download, unload GPU
```

**Frontend (crescimento controlado):**

```
web/frontend/src/
├── features/
│   └── shorts/
│       ├── ShortsWizard.jsx       # Fluxo principal
│       ├── ShortsConfigPanel.jsx  # Duração, quantidade, estilo
│       ├── ShortsClipList.jsx     # Lista de clips gerados
│       ├── ShortsPreview.jsx      # Preview 9:16
│       └── useShortsJob.js        # Poll status + WS progress
├── lib/
│   └── api.js                     # + funções shorts
└── App.jsx                        # Roteamento por activeTool
```

---

## 6. Sistema de Skills (interno ao módulo)

### 6.1 Contrato base

```python
# web/shorts/skills/base.py (conceitual)
class SkillContext:
    project_id: str
    video_path: Path
    work_dir: Path
    client_id: str
    metadata: dict          # ffprobe info
    artifacts: dict         # outputs acumulados

class BaseSkill(ABC):
    name: str
    async def run(self, ctx: SkillContext) -> SkillResult: ...
```

Cada skill:
- Lê artefatos de skills anteriores via `ctx.artifacts`
- Persiste resultado em SQLite + JSON em disco
- Emite progresso via callback injetado (mesmo formato WS atual)
- Pode ser **pulada** se artefato válido já existir (cache)

### 6.2 Skills propostas

| Skill | Entrada | Saída | Reutiliza |
|-------|---------|-------|-----------|
| **TranscribeSkill** | áudio 16 kHz | `transcription.json`, segmentos | `whisper_svc` ou faster-whisper |
| **VADSkill** | áudio | `speech_regions.json` | Silero + merge com intervalos Whisper |
| **SceneDetectionSkill** | vídeo | `scenes.json` | PySceneDetect |
| **PersonDetectionSkill** | frames amostrados | `detections.json` | YOLOv11n (ONNX) |
| **FaceTrackingSkill** | detections | `tracks.json` | ByteTrack |
| **ShortSelectionSkill** | transcrição + VAD + cenas + tracks | `candidates.json` | Heurísticas + Gemma opcional |
| **ReframingSkill** | candidates + tracks | `crop_paths/*.json`, previews | OpenCV + ffmpeg |
| **SubtitleSkill** | clip + transcrição recortada | `.ass` por clip | `subtitle_svc` |
| **ExportSkill** | clip + ass | `.mp4` final | `ffmpeg_svc.burn_subtitles` |

### 6.3 Ordem de execução e paralelismo

```
TranscribeSkill ──┬── VADSkill (paralelo após áudio)
                  │
SceneDetectionSkill (paralelo com VAD, I/O bound)
                  │
PersonDetectionSkill (GPU) ── FaceTrackingSkill
                  │
         ShortSelectionSkill
                  │
    ┌─────────────┴─────────────┐
    Reframing → Subtitle → Export   (por clip, sequencial na GPU)
```

**Regra de GPU 6 GB:** nunca manter Whisper + YOLO + Gemma carregados simultaneamente. O `models/registry.py` implementa `load()` / `unload()` entre skills.

---

## 7. Avaliação: pipeline vs. agente de IA

### Recomendação: **pipeline tradicional na v1**

| Critério | Pipeline | Agente/planner |
|----------|----------|----------------|
| Previsibilidade | Alta — mesma entrada, mesma saída | Variável |
| Debug | Logs por skill, artefatos em disco | Difícil rastrear decisões |
| Tempo de dev | Menor | Maior (prompts, tools, fallbacks) |
| GPU 6 GB | Controle fino de carga | Risco de reprocessamento |
| Manutenção | Alinhado ao restante do app | Novo paradigma no projeto |

O fluxo de Shorts é **sequencial e bem definido** (12 etapas fixas). Não há necessidade de replanejamento dinâmico na primeira versão.

### Onde um agente **pode** agregar valor (fase futura, opcional)

Apenas dentro de `ShortSelectionSkill`, como **reranker semântico**:

- **Entrada:** lista de candidatos com transcrição, duração, presença de rosto, score de energia
- **Papel:** Gemma 3n quantizado escolhe/ranqueia trechos “mais virais” com base em prompt estruturado
- **Implementação:** chamada única por lote de candidatos — **não** um loop agentic
- **Fallback:** se Gemma indisponível, heurísticas puras continuam funcionando

Isso **não** exige framework de agentes (LangChain, etc.). Um script com prompt + JSON schema é suficiente e mantém o módulo isolado.

---

## 8. Stack tecnológica e restrições de GPU 6 GB

### 8.1 Tecnologias desejadas — decisões

| Tecnologia | Decisão | Motivo |
|------------|---------|--------|
| **Faster-Whisper** | ✅ Adotar como engine default no módulo Shorts | 4–8× mais rápido, menor VRAM que `openai-whisper`; API compatível; `int8` cabe em 6 GB |
| **OpenAI Whisper (atual)** | ✅ Manter para ferramentas existentes | Zero regressão; migrar legendas/silêncio depois, se desejado |
| **Silero VAD** | ✅ Adotar | Detecta silêncio sem GPU; complementa intervalos Whisper; útil para boundaries de clips |
| **PySceneDetect** | ✅ Adotar | Leve, CPU; evita cortes no meio de cena |
| **YOLOv11n** | ✅ Adotar via **ONNX Runtime** | Modelo nano ~6 MB; batch pequeno de frames; cabe com Faster-Whisper se sequencial |
| **ByteTrack** | ✅ Adotar | Tracking leve sobre detecções YOLO; estável para crop path |
| **OpenCV** | ✅ Adotar | Amostragem de frames, suavização de crop path |
| **FFmpeg** | ✅ Estender `ffmpeg_svc` | Já embutido; NVENC opcional (`h264_nvenc`) se disponível |
| **SQLite** | ✅ Adotar | Cache de análise; evita reprocessar vídeo longo |
| **ONNX Runtime** | ✅ Adotar | YOLO + Silero ONNX; CUDA EP quando disponível |
| **Gemma 3n quantizado** | ⚠️ Opcional (Fase 4+) | Ranking semântico; `gemma-3n-E2B-it-q4` ~2–3 GB; carregar só na seleção, descarregar antes do YOLO |

### 8.2 Alternativas consideradas

| Em vez de | Alternativa | Por que não (para este projeto) |
|-----------|-------------|----------------------------------|
| YOLOv11 | MediaPipe Face Detection | Mais leve, mas pior com múltiplas pessoas / corpo inteiro |
| ByteTrack | DeepSORT | Mais pesado; ByteTrack suficiente para crop centrado |
| Gemma | Embeddings + cosine similarity | Menos interpretável para “hook” narrativo |
| SQLite | JSON puro | JSON ok para projetos editor; Shorts gera muitos artefatos intermediários |
| Agente LLM | Pipeline + scorer | Ver seção 7 |

### 8.3 Orçamento de VRAM (sequencial)

```
Faster-Whisper small int8     ~1.0 GB
YOLOv11n ONNX                 ~0.5 GB
Gemma 3n q4 (opcional)        ~2.5 GB
Margem CUDA                   ~1.5 GB
─────────────────────────────────────
Pico (com Gemma)              ~4.5 GB  ✅ cabe em 6 GB
Pico (sem Gemma)              ~2.0 GB  ✅ confortável
```

### 8.4 Dependências Python sugeridas (grupo opcional)

```toml
# pyproject.toml — dependency-groups.shorts
[dependency-groups]
shorts = [
  "faster-whisper>=1.0.0",
  "onnxruntime-gpu>=1.17.0",  # ou onnxruntime para CPU-only
  "opencv-python-headless>=4.9.0",
  "scenedetect[opencv]>=0.6.4",
  "ultralytics>=8.3.0",         # export YOLO → ONNX
  "filterpy",                   # ByteTrack deps
  "numpy>=1.26.0",
]
# Gemma: llama-cpp-python ou transformers + bitsandbytes (fase 4)
```

---

## 9. Comunicação, progresso e persistência

### 9.1 Reutilizar WebSocket existente

Manter formato de mensagem:

```json
{ "type": "progress", "stage": "shorts:scene_detection", "progress": 45, "message": "Detectando cenas..." }
```

Estágios sugeridos: `shorts:transcribe`, `shorts:vad`, `shorts:scenes`, `shorts:detect`, `shorts:track`, `shorts:select`, `shorts:reframe`, `shorts:subtitle`, `shorts:export`.

### 9.2 SQLite — schema mínimo

```sql
-- web/shorts/store.py
CREATE TABLE shorts_jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  status TEXT NOT NULL,  -- pending|analyzing|ready|generating|done|error
  config_json TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE shorts_artifacts (
  job_id TEXT,
  skill_name TEXT,
  path TEXT,
  checksum TEXT,
  PRIMARY KEY (job_id, skill_name)
);

CREATE TABLE shorts_clips (
  id TEXT PRIMARY KEY,
  job_id TEXT,
  index_num INTEGER,
  start_sec REAL,
  end_sec REAL,
  score REAL,
  output_path TEXT,
  status TEXT
);
```

Arquivo: `web/processed/{projectId}/shorts/job.db` — co-localizado com artefatos, sem afetar JSON de projetos existentes.

### 9.3 Compartilhar infra sem duplicar

| Infra | Como compartilhar |
|-------|-------------------|
| Config FFmpeg | Import de `ffmpeg_svc._resolve_binary` |
| Modelos IA | `web/shorts/models/registry.py` centraliza; Whisper legado continua em `whisper_svc._model_cache` até unificação |
| Logs | `logging.getLogger("web.shorts")` |
| Cache | SQLite artifacts + skip se checksum bater |
| Progress | Callback injetado → `send_progress()` de `server.py` |
| Upload | Mesmo `/api/upload`; Shorts recebe `projectId` + `filename` |

---

## 10. Frontend: nova ferramenta sem reescrever o editor

### 10.1 Fluxo UX proposto

1. **Tela inicial:** dois cartões — “Editor de legendas” (fluxo atual) e “Gerar Shorts” (novo)
2. **Upload:** reutiliza `uploadVideo()` — mesmo `projectId`
3. **Wizard Shorts:**
   - Config: quantidade de clips (1–10), duração alvo (15–60s), idioma, estilo legenda, modo reframe (crop inteligente / blur)
   - Botão “Analisar” → `POST /api/shorts/analyze`
   - Lista de candidatos com score + preview thumbnail
   - Ajuste manual opcional (in/out, excluir clip)
   - “Gerar e exportar” → progress modal existente (`ProcessingModal`)
4. **Export:** reutiliza `export_video_to_local` via Tauri ou download browser

### 10.2 Componentes reutilizados

| Componente | Arquivo | Uso |
|------------|---------|-----|
| `ProcessingModal` | `App.jsx` ~2315 | Progresso |
| `useWsClient` | `App.jsx` ~2434 | clientId |
| `PresetSelector` | `components/preset-selector.jsx` | Estilo legenda Shorts |
| UI Radix | `components/ui/*` | Layout wizard |
| Toast system | `App.jsx` | Feedback |

### 10.3 Preview 9:16

Novo `ShortsPreview.jsx`: container CSS `aspect-ratio: 9/16` com vídeo HTML5. Não depende de `shouldUseDockedPreview` (que só detecta vídeo já vertical — linha ~678 em `App.jsx`).

---

## 11. Roadmap incremental

### Fase 1 — Infraestrutura do módulo

| Item | Detalhe |
|------|---------|
| **Objetivo** | Esqueleto `web/shorts/`, router, store SQLite, registro no `server.py`, entrada no frontend |
| **Impacto** | Zero nas ferramentas atuais |
| **Dificuldade** | Baixa |
| **Dependências** | Nenhuma |
| **Esforço** | 3–5 dias |

Entregáveis:
- Router com `POST /api/shorts/analyze` stub (retorna metadata)
- SQLite + estrutura de pastas
- Cartão “Shorts” na tela inicial
- Funções em `api.js`

---

### Fase 2 — Análise do vídeo

| Item | Detalhe |
|------|---------|
| **Objetivo** | TranscribeSkill + VADSkill + SceneDetectionSkill |
| **Impacto** | Novas deps Python (grupo `shorts`); Faster-Whisper paralelo ao Whisper atual |
| **Dificuldade** | Média |
| **Dependências** | Fase 1 |
| **Esforço** | 5–8 dias |

Entregáveis:
- Artefatos: `transcription.json`, `speech_regions.json`, `scenes.json`
- Progress WS por skill
- UI: painel “Análise concluída” com estatísticas (tempo de fala, N cenas)

---

### Fase 3 — Seleção automática de trechos

| Item | Detalhe |
|------|---------|
| **Objetivo** | ShortSelectionSkill — heurísticas sem GPU pesada |
| **Impacto** | Core de valor da feature |
| **Dificuldade** | Média-alta |
| **Dependências** | Fase 2 |
| **Esforço** | 5–7 dias |

Heurísticas v1 (sem Gemma):
- Preferir trechos com densidade de fala alta (VAD)
- Evitar cortes dentro de cena (PySceneDetect)
- Duração alvo 30–60s (configurável)
- Descartar trechos com silêncio > 2s no início
- Score = `w1*speech_density + w2*scene_coherence + w3*hook_keyword` (keywords opcionais PT)

Entregáveis:
- `candidates.json` com 3–10 propostas
- UI lista editável de candidatos

---

### Fase 4 — Detecção, tracking e reenquadramento inteligente

| Item | Detalhe |
|------|---------|
| **Objetivo** | PersonDetectionSkill + FaceTrackingSkill + ReframingSkill |
| **Impacto** | Maior uso de GPU; requer unload de modelos |
| **Dificuldade** | Alta |
| **Dependências** | Fase 3 |
| **Esforço** | 10–15 dias |

Entregáveis:
- YOLOv11n ONNX + ByteTrack → `tracks.json`
- Crop path suavizado (OpenCV moving average)
- `ffmpeg_svc.reframe_vertical()` com crop dinâmico ou fallback blur (`split` + `crop` + `boxblur` + `overlay`)
- Preview 9:16 por candidato
- Modo fallback: crop central estático (funciona sem GPU)

---

### Fase 5 — Legendas e exportação

| Item | Detalhe |
|------|---------|
| **Objetivo** | SubtitleSkill + ExportSkill + preset TikTok |
| **Impacto** | Reutiliza 80% de subtitle_svc / burn_subtitles |
| **Dificuldade** | Média |
| **Dependências** | Fase 4 |
| **Esforço** | 4–6 dias |

Entregáveis:
- Legendas com `play_res=(1080, 1920)`, fonte 42px, safe zone inferior
- Export MP4 H.264 1080×1920 por clip
- Nomenclatura: `{original}-short-{01}.mp4`
- Integração Tauri export (single + batch folder)

Ajustes em `subtitle_svc`:
- Recortar timestamps de legendas ao intervalo do clip (`start -= clip.start`)
- Preset “TikTok” em `preset_svc.DEFAULT_PRESETS`

---

### Fase 6 — Melhorias futuras

| Item | Detalhe |
|------|---------|
| **Objetivo** | Gemma rerank, cancelamento, NVENC, templates, A/B de hooks |
| **Impacto** | Opcional; não bloqueia v1 |
| **Dificuldade** | Variável |
| **Dependências** | Fases 1–5 |
| **Esforço** | Contínuo |

Itens:
- **GemmaRanker** na seleção semântica
- Cancelamento de job (`POST /api/shorts/cancel`)
- Fila de jobs leve (asyncio.Queue) para batch overnight
- NVENC quando CUDA disponível
- Thumbnails automáticos por clip
- Conectar crop manual existente (`handleCropChange` → API) para refinamento pós-auto
- Migrar ferramentas legadas para Faster-Whisper (unificação)

---

## 12. Riscos e mitigações

| Risco | Mitigação |
|-------|-----------|
| `App.jsx` monolítico cresce demais | Extrair `features/shorts/` desde Fase 1 |
| VRAM estoura com modelos simultâneos | `models/registry.py` com unload agressivo |
| PyInstaller infla demais | Modelos ONNX baixados on-first-use (como Whisper hoje) |
| Vídeos longos (>2h) demoram | Amostragem de frames (1 fps para YOLO); cache SQLite |
| Crop instável com movimento | Suavização OpenCV + fallback blur |
| Regressão em legendas/silêncio | Módulo isolado; zero alteração de rotas existentes |
| CPU-only (sem NVIDIA) | ONNX Runtime CPU EP; crop central; Faster-Whisper CPU |

---

## 13. Referências ao código existente

### Backend

| Arquivo | Linhas / símbolos relevantes |
|---------|------------------------------|
| `web/server.py` | Rotas process (255–444), WebSocket (64–88), upload (210–253), `send_progress` (152–158) |
| `web/services/ffmpeg_svc.py` | `get_video_info`, `extract_audio`, `cut_video`, `crop_video`, `burn_subtitles` |
| `web/services/whisper_svc.py` | `transcribe`, `collect_speech_intervals`, `get_subtitle_segments`, `_model_cache` |
| `web/services/subtitle_svc.py` | `write_ass(..., play_res=)` |
| `web/services/preset_svc.py` | `DEFAULT_PRESETS`, CRUD JSON |
| `main.py` | Algoritmo original de intervalos (referência para VADSkill) |

### Frontend

| Arquivo | Símbolos relevantes |
|---------|---------------------|
| `web/frontend/src/App.jsx` | `useWsClient`, `ProcessingModal`, `handleCropChange` (gap), `UploadScreen`, fluxos `removeSilence` / `generateSubtitles` |
| `web/frontend/src/lib/api.js` | Padrão `postJson`, detecção Tauri `BASE_URL` |

### Desktop / build

| Arquivo | Papel |
|---------|-------|
| `src-tauri/src/lib.rs` | Sidecar lifecycle, `export_video_to_local` |
| `backend.spec` | PyInstaller — incluir novos `datas` quando necessário |
| `scripts/build-backend.mjs` | Rename sidecar por triple |
| `pyproject.toml` | Deps atuais: whisper, torch, fastapi |

### Documentação existente

| Arquivo | Relação |
|---------|---------|
| `project_suggestions.md` | Menciona presets TikTok/Reels 9:16 — alinhado a este plano, ainda não implementado |
| `AGENTS.md` | Build MSI rápido para testes |

---

## Conclusão

A incorporação do módulo de Shorts **não exige reestruturar** o Guepardosys Caption Studio. A arquitetura Tauri → FastAPI → serviços Python → FFmpeg/Whisper já resolve execução local, comunicação e export nativo.

**Reaproveitamento estimado:** ~60% da infraestrutura (upload, progresso WS, transcrição, legendas, FFmpeg base, export Tauri, presets, UI components).

**Desenvolvimento novo:** pipeline de análise visual (YOLO, tracking, cenas), seleção de trechos, reframe 9:16 dinâmico, store SQLite e wizard frontend.

**Abordagem recomendada:** pipeline sequencial com Skills isoladas em `web/shorts/`, entregue em 6 fases incrementais, com agente LLM **apenas** como reranker opcional na seleção — nunca como orquestrador principal.

Este plano preserva as ferramentas existentes, adiciona valor de produto no estilo “novo recurso do CapCut”, e mantém complexidade arquitetural sob controle.
