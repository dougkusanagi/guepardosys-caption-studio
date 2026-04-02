import { spawnSync } from 'node:child_process';

const platform = process.platform;

function commandExists(command, args = ['--version']) {
  const result = spawnSync(command, args, { stdio: 'ignore' });
  return result.error?.code !== 'ENOENT';
}

function ffmpegInstallHint() {
  if (platform === 'darwin') {
    return 'brew install ffmpeg';
  }
  if (platform === 'win32') {
    return 'Install the ffmpeg package for Windows and ensure ffmpeg.exe and ffprobe.exe are on PATH.';
  }
  return 'sudo apt install -y ffmpeg';
}

const missing = [];

if (!commandExists('uv')) {
  missing.push({
    name: 'uv',
    reason: "Instale o utilitário 'uv' e garanta que ele esteja no PATH.",
  });
}

if (!commandExists('ffmpeg', ['-version'])) {
  missing.push({
    name: 'ffmpeg',
    reason: `Instale o pacote do sistema: ${ffmpegInstallHint()}`,
  });
}

if (!commandExists('ffprobe', ['-version'])) {
  missing.push({
    name: 'ffprobe',
    reason: `Ele vem com o pacote 'ffmpeg': ${ffmpegInstallHint()}`,
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
