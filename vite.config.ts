/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative URLs, so the build works under any path (GitHub Pages project page,
  // custom domain, or a plain folder).
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
  // three.js alone is ~600 kB minified; the app is a single-page tool, so one chunk is fine.
  build: { chunkSizeWarningLimit: 1200 },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
