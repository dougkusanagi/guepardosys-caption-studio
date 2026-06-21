import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const binDir = path.join(rootDir, 'bin');

const platform = process.platform;
const arch = process.arch;

const URLS = {
  win32: {
    ffmpeg: 'https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v6.1/ffmpeg-6.1-win-64.zip',
    ffprobe: 'https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v6.1/ffprobe-6.1-win-64.zip',
    files: ['ffmpeg.exe', 'ffprobe.exe']
  },
  darwin: {
    ffmpeg: 'https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v6.1/ffmpeg-6.1-osx-64.zip',
    ffprobe: 'https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v6.1/ffprobe-6.1-osx-64.zip',
    files: ['ffmpeg', 'ffprobe']
  },
  linux: {
    ffmpeg: arch === 'arm64' 
      ? 'https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v6.1/ffmpeg-6.1-linux-arm-64.zip'
      : 'https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v6.1/ffmpeg-6.1-linux-64.zip',
    ffprobe: arch === 'arm64'
      ? 'https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v6.1/ffprobe-6.1-linux-arm-64.zip'
      : 'https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v6.1/ffprobe-6.1-linux-64.zip',
    files: ['ffmpeg', 'ffprobe']
  }
};

async function downloadFile(url, destPath) {
  console.log(`Baixando: ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Falha no download: ${res.statusText}`);
  const arrayBuffer = await res.arrayBuffer();
  fs.writeFileSync(destPath, Buffer.from(arrayBuffer));
}

function extractZip(zipPath, destDir) {
  console.log(`Extraindo ${path.basename(zipPath)} para ${destDir}...`);
  if (platform === 'win32') {
    const cmd = `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`;
    const result = spawnSync(cmd, { shell: true });
    if (result.status !== 0) {
      throw new Error(`Falha ao extrair com PowerShell: ${result.stderr?.toString()}`);
    }
  } else {
    const result = spawnSync('unzip', ['-o', zipPath, '-d', destDir]);
    if (result.status !== 0) {
      throw new Error(`Falha ao extrair com unzip: ${result.stderr?.toString()}`);
    }
  }
}

async function main() {
  const config = URLS[platform];
  if (!config) {
    console.error(`Plataforma não suportada: ${platform}`);
    process.exit(1);
  }

  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
  }

  const missingFiles = config.files.filter(f => !fs.existsSync(path.join(binDir, f)));
  if (missingFiles.length === 0) {
    console.log('FFmpeg e FFprobe já estão instalados localmente em bin/.');
    return;
  }

  console.log(`Dependências ausentes detectadas: ${missingFiles.join(', ')}`);

  try {
    for (const binary of ['ffmpeg', 'ffprobe']) {
      const expectedFile = platform === 'win32' ? `${binary}.exe` : binary;
      const targetPath = path.join(binDir, expectedFile);

      if (!fs.existsSync(targetPath)) {
        const zipPath = path.join(binDir, `${binary}.zip`);
        await downloadFile(config[binary], zipPath);
        extractZip(zipPath, binDir);
        fs.unlinkSync(zipPath); // remove o zip
      }
    }

    // No macOS e Linux, garante permissão de execução
    if (platform !== 'win32') {
      for (const file of config.files) {
        fs.chmodSync(path.join(binDir, file), 0o755);
      }
    }

    console.log('FFmpeg e FFprobe baixados e configurados com sucesso em bin/.');
  } catch (error) {
    console.error('Erro ao baixar FFmpeg/FFprobe:', error.message);
    process.exit(1);
  }
}

main();
