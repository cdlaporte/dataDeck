import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';

/**
 * Builds only the presenter-only viewer (present.html) into dist-viewer/, with relative
 * asset paths so the folder can be copied anywhere on another site.
 */
export default mergeConfig(
  base,
  defineConfig({
    base: './',
    publicDir: false,
    build: {
      outDir: 'dist-viewer',
      emptyOutDir: true,
      rollupOptions: { input: 'present.html' },
    },
  }),
);
