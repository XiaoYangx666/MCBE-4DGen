import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
  },
  server: {
    // The app has no backend, so binding to the LAN is safe and lets phones
    // open the same URL while testing.
    host: '0.0.0.0',
    port: 4174,
  },
  preview: {
    host: '0.0.0.0',
    port: 4174,
  },
});
