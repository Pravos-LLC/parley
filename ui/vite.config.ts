import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: import.meta.dirname,
  base: './',
  plugins: [react()],
  build: { outDir: '../dist/ui', emptyOutDir: true, chunkSizeWarningLimit: 800 },
  server: { proxy: { '/api': 'http://127.0.0.1:4317' } },
});
