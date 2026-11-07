import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), tailwindcss()],
  build: { outDir: resolve(import.meta.dirname, '../../../dist/perf/frontend'), emptyOutDir: true },
  preview: { host: '127.0.0.1', port: 54820, strictPort: true },
});
