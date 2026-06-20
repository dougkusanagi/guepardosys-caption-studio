# Sugestões de Melhorias — StudioCut (remove-silence)

Este documento contém uma análise aprofundada do codebase atual e sugere melhorias estruturais, correções de bugs em tempo de execução e ideias de novas funcionalidades para elevar o nível do projeto.

---

## 1. Melhorias Técnicas e de Performance

### Processamento Assíncrono com FFmpeg
> [!IMPORTANT]
> Atualmente, os processos do FFmpeg e ffprobe em `ffmpeg_svc.py` são executados usando `subprocess.run(...)` de forma síncrona/bloqueante, mesmo sendo envelopados em threads pelo FastAPI. 
- **Melhoria**: Mudar para `asyncio.create_subprocess_exec` no backend. Isso permite que o loop de eventos gerencie os processos nativamente sem bloquear threads do Python e economiza recursos do servidor.

### Otimização da Geração de Waveforms (Forma de Onda)
- **Problema**: O método `generate_waveform` grava um arquivo raw de áudio gigante (`pcm_s16le`) em disco e depois lê byte por byte usando loops em Python puro e a biblioteca `struct`. Em vídeos longos, isso gera lentidão de CPU e uso excessivo de I/O em disco.
- **Melhoria**: Extrair os picos de áudio usando o próprio FFmpeg com filtros como `showwavespic` ou usar bibliotecas rápidas como `numpy` em buffers de leitura streaming (via pipes) para evitar gravar arquivos temporários imensos em disco.

### Gerenciamento de Memória e Modelos Whisper
- **Melhoria**: Armazenar os modelos Whisper de forma mais eficiente ou suportar a execução por meio de bibliotecas otimizadas como `whisper.cpp` (que tem bindings em Python de alta velocidade e menor consumo de RAM) ou permitir a conexão com APIs externas (como OpenAI Whisper API) para usuários que não têm placas de vídeo potentes.

### Banco de Dados para Persistência
- **Melhoria**: O projeto usa arquivos JSON locais (`presets.json` e arquivos de timeline avulsos). Uma migração para uma base de dados leve como **SQLite** (usando SQLAlchemy ou Tortoise-ORM) trará integridade referencial, velocidade de busca para múltiplos projetos e melhor controle de estados.

---

## 2. Refinamento de UI/UX e Visual

### Experiência de Zoom e Navegação na Timeline
- **Melhoria**: Implementar navegação avançada na timeline canvas:
  - Zoom fluído centralizado no ponteiro do mouse (usando `Ctrl + Roda do Mouse`).
  - Rolagem horizontal rápida (usando `Shift + Roda do Mouse`).
  - Arrastar lateral segurando o botão do meio do mouse (Pan).

### Animação Suave do Playhead (Ponteiro de Reprodução)
- **Problema**: A linha vermelha de progresso se move com pequenos "saltos" porque depende do evento `onTimeUpdate` dos vídeos do navegador, que é disparado de forma intermitente (cerca de 4 a 25 vezes por segundo).
- **Melhoria**: Usar `requestAnimationFrame` no React para interpolar o movimento do playhead com base no tempo de início e na taxa de quadros, gerando uma movimentação perfeitamente lisa a 60fps.

### Edição Manual de Cortes na Timeline
- **Melhoria**: Permitir que o usuário ajuste manualmente os cortes gerados pela IA direto na timeline canvas (arrastar as pontas de um segmento para encurtá-lo/alongá-lo, criar novos cortes com uma tecla de atalho como `C`, ou juntar segmentos vizinhos).

---

## 3. Correções de Bugs em Potencial e Estabilidade

### Vazamento de Arquivos Temporários
> [!WARNING]
> Se um processo de corte de vídeo ou geração de legenda falhar no meio da execução, arquivos de áudio extraídos (`audio_16k.wav`) ou raw-waveform permanecem na pasta `processed/` ocupando espaço desnecessariamente.
- **Correção**: Implementar blocos `try...finally` mais robustos no backend FastAPI para garantir a remoção de todos os arquivos `.tmp` e temporários sob qualquer cenário de erro. Adicionar um script de cron/limpeza diária de cache.

### Validação de Upload de Arquivos
- **Problema**: A rota de upload aceita qualquer arquivo sem validação de tamanho máximo ou cabeçalhos mágicos (mime-types).
- **Correção**: Adicionar limites de tamanho de arquivo no FastAPI e validar se o arquivo é um vídeo válido antes de tentar passá-lo para o ffprobe/FFmpeg para evitar travamentos ou ataques de negação de serviço por falta de disco.

---

## 4. Adições de Funcionalidades (Novas Features)

### Redução de Ruído Integrada (Audio Noise Gate)
- **Feature**: Adicionar um switch nas configurações de corte para aplicar filtros de áudio do FFmpeg (como `afftdn` ou `arnoise`) antes de detectar silêncios, limpando chiados de microfone de baixo custo e aumentando a precisão da detecção de voz do Whisper.

### Tradução Automática de Legendas
- **Feature**: Integrar APIs de tradução leves (como DeepL, Google Translate ou tradução local via modelos offline do HuggingFace) para traduzir instantaneamente as legendas geradas para outros idiomas (ex: PT-BR -> EN).

### Presets de Exportação para Redes Sociais
- **Feature**: Criar botões rápidos para preparar o vídeo para diferentes plataformas:
  - **TikTok/Reels (Vertical 9:16)**: Faz crop automático inteligente ou desfoca as bordas.
  - **YouTube (Horizontal 16:9)**: Mantém proporção e maximiza bitrate.
  - **Instagram Square (1:1)**.
