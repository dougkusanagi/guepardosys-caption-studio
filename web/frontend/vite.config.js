import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

const backendHost = 'http://127.0.0.1:3000';

export default defineConfig({
  root: resolve(__dirname),
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': backendHost,
      '/uploads': backendHost,
      '/processed': backendHost,
      '/css': backendHost,
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
