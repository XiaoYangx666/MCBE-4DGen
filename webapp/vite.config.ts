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
  optimizeDeps: {
    // libassimp locates its Wasm/glue files with import.meta.url; pre-bundling
    // would rewrite those URLs and break the browser runtime.
    exclude: ['libassimp'],
  },
  server: {
    // The app has no backend, so binding to the LAN is safe and lets phones
    // open the same URL while testing.
    host: '0.0.0.0',
    port: 4174,
    // Accept the temporary Cloudflare Quick Tunnel host name.
    allowedHosts: ['.trycloudflare.com'],
  },
  preview: {
    host: '0.0.0.0',
    port: 4174,
    allowedHosts: ['.trycloudflare.com'],
  },
});
