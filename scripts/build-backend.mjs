import { spawnSync } from 'node:child_process';
import { renameSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const platform = process.platform;
let triple = '';
if (platform === 'win32') {
  triple = 'x86_64-pc-windows-msvc';
} else if (platform === 'darwin') {
  triple = process.arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
} else {
  triple = process.arch === 'arm64' ? 'aarch64-unknown-linux-gnu' : 'x86_64-unknown-linux-gnu';
}

const binariesDir = join(process.cwd(), 'src-tauri', 'binaries');
if (!existsSync(binariesDir)) {
  mkdirSync(binariesDir, { recursive: true });
}

console.log('Compilando backend Python com PyInstaller...');
// Executa o PyInstaller usando 'uv run'
const pyinstallerResult = spawnSync('uv', [
  'run',
  'pyinstaller',
  '--onefile',
  '--name',
  'backend',
  '--distpath',
  binariesDir,
  'web/server.py'
], { stdio: 'inherit', shell: true });

if (pyinstallerResult.status !== 0) {
  console.error('Falha ao compilar com PyInstaller.');
  process.exit(1);
}

// Renomeia o binário para incluir o target triple exigido pelo Tauri
const exe = platform === 'win32' ? '.exe' : '';
const src = join(binariesDir, `backend${exe}`);
const dest = join(binariesDir, `backend-${triple}${exe}`);

if (existsSync(src)) {
  renameSync(src, dest);
  console.log(`Backend compilado e renomeado para: ${dest}`);
} else {
  console.error(`Não foi possível encontrar o executável gerado em: ${src}`);
  process.exit(1);
}
