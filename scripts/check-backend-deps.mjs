import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const platform = process.platform;

function commandExists(command, args = ['--version']) {
  const result = spawnSync(command, args, { stdio: 'ignore' });
  return result.error?.code !== 'ENOENT';
}

function hasBinary(name) {
  const exe = platform === 'win32' ? `${name}.exe` : name;
  const localExists = existsSync(join(process.cwd(), 'bin', exe));
  if (localExists) return true;
  return commandExists(name, ['-version']);
}

// Se não achar localmente nem no PATH, tenta baixar
if (!hasBinary('ffmpeg') || !hasBinary('ffprobe')) {
  console.log('FFmpeg/FFprobe não encontrados localmente ou no PATH. Iniciando download automático...');
  const downloadResult = spawnSync(process.execPath, ['scripts/download-ffmpeg.mjs'], { stdio: 'inherit' });
  if (downloadResult.status !== 0) {
    console.error('Erro ao baixar FFmpeg/FFprobe automaticamente.');
    process.exit(1);
  }
}

// Garante que o arquivo do sidecar existe no dev para evitar erro de compilação do Tauri
const binariesDir = join(process.cwd(), 'src-tauri', 'binaries');
if (!existsSync(binariesDir)) {
  mkdirSync(binariesDir, { recursive: true });
}
let triple = '';
if (platform === 'win32') {
  triple = 'x86_64-pc-windows-msvc';
} else if (platform === 'darwin') {
  triple = process.arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
} else {
  triple = process.arch === 'arm64' ? 'aarch64-unknown-linux-gnu' : 'x86_64-unknown-linux-gnu';
}
const exe = platform === 'win32' ? '.exe' : '';
const sidecarPath = join(binariesDir, `backend-${triple}${exe}`);
if (!existsSync(sidecarPath)) {
  console.log('Criando arquivo dummy para o sidecar (necessário para compilação)...');
  writeFileSync(sidecarPath, '');
}


const missing = [];

if (!commandExists('uv')) {
  missing.push({
    name: 'uv',
    reason: "Instale o utilitário 'uv' e garanta que ele esteja no PATH.",
  });
}

// Duplo check para garantir que tudo deu certo após a tentativa de download
if (!hasBinary('ffmpeg')) {
  missing.push({
    name: 'ffmpeg',
    reason: 'Não foi possível encontrar nem instalar o FFmpeg.',
  });
}

if (!hasBinary('ffprobe')) {
  missing.push({
    name: 'ffprobe',
    reason: 'Não foi possível encontrar nem instalar o FFprobe.',
  });
}

if (missing.length > 0) {
  console.error('Dependências ausentes para iniciar o backend em modo dev:\n');
  for (const item of missing) {
    console.error(`- ${item.name}: ${item.reason}`);
  }
  console.error('\nCorrija as dependências acima e rode `bun run dev` novamente.');
  process.exit(1);
}

