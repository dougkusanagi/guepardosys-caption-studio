import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve, join, extname } from 'node:path';
import { existsSync, createReadStream, statSync } from 'node:fs';
import os from 'node:os';

const backendHost = 'http://127.0.0.1:3000';

const mimeTypes = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.m4v': 'video/x-m4v',
  '.flv': 'video/x-flv',
  '.wmv': 'video/x-ms-wmv',
  '.json': 'application/json',
  '.wav': 'audio/wav',
  '.srt': 'text/plain',
  '.ass': 'text/plain',
};

function tauriFileServer() {
  const appDataDir = join(os.homedir(), 'AppData', 'Roaming', 'com.studiocut.app');

  return {
    name: 'tauri-file-server',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const match = req.url?.match(/^\/(uploads|processed)\/(.+)/);
        if (!match) return next();

        const [, folder, filename] = match;
        const filePath = join(appDataDir, folder, filename);

        if (!existsSync(filePath)) {
          res.statusCode = 404;
          res.end(`File not found: ${filePath}`);
          return;
        }

        const ext = extname(filePath).toLowerCase();
        const mime = mimeTypes[ext] || 'application/octet-stream';
        const stat = statSync(filePath);

        res.setHeader('Content-Type', mime);
        res.setHeader('Content-Length', stat.size);
        res.setHeader('Accept-Ranges', 'bytes');

        const range = req.headers.range;
        if (range) {
          const parts = range.replace(/bytes=/, '').split('-');
          const start = parseInt(parts[0], 10);
          const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
          const chunkSize = end - start + 1;

          res.statusCode = 206;
          res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
          res.setHeader('Content-Length', chunkSize);
          createReadStream(filePath, { start, end }).pipe(res);
        } else {
          createReadStream(filePath).pipe(res);
        }
      });
    },
  };
}

export default defineConfig({
  root: resolve(__dirname),
  plugins: [react(), tauriFileServer()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': backendHost,
      '/ws': {
        target: 'ws://127.0.0.1:3000',
        ws: true,
      },
    },
  },
  build: {
    outDir: resolve(__dirname, '../dist'),
    emptyOutDir: true,
  },
});
