import { resolve } from 'node:path';
import { build } from 'vite';
import { initializeStorage } from '../src/workspace-storage.ts';
import { createHandler } from './router.ts';
import { serve } from './serve.ts';
import { Studio } from './studio.ts';

if (process.env.FOURDGEN_PARENT_PID) {
  const parent = Number(process.env.FOURDGEN_PARENT_PID);
  if (!Number.isInteger(parent) || parent <= 0)
    throw Error('Invalid desktop parent');
  setInterval(() => {
    try {
      process.kill(parent, 0);
    } catch {
      process.exit(0);
    }
  }, 5000).unref();
}

await initializeStorage();
const studio = new Studio();

if (process.env.FOURDGEN_SKIP_WEB_BUILD !== '1')
  await build({
    root: resolve(studio.root, 'web'),
    configFile: false,
    logLevel: 'warn',
    build: { outDir: studio.dist, emptyOutDir: true },
  });

await studio.initialize();

const port = Number(process.env.PORT ?? 4173);
let listeningPort = port;
const server = await serve({
  hostname: '127.0.0.1',
  port,
  idleTimeout: 255,
  maxRequestBodySize: 256 * 1024 * 1024,
  fetch: createHandler(studio, () => listeningPort),
});
listeningPort = server.port;

const shutdown = () => {
  void server.stop().then(() => process.exit(0));
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

console.log(`4DGen 本地工作台：http://127.0.0.1:${listeningPort}`);
if (process.env.FOURDGEN_DESKTOP)
  console.log(`4DGEN_READY http://127.0.0.1:${listeningPort}`);
setTimeout(() => void studio.warmPresetPreviews(), 3000);
