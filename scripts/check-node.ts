/**
 * Node-only smoke test for the local server. Run with `node scripts/check-node.ts`.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = await realpath(await mkdtemp(join(tmpdir(), '4dgen-node-')));
const dataDir = join(fixture, 'data');
const configPath = join(fixture, 'missing-skin-manager.json');

async function isFile(path: string): Promise<boolean> {
  return stat(path)
    .then((info) => info.isFile())
    .catch(() => false);
}

const configuredDist = process.env.FOURDGEN_WEB_DIST;
const defaultDist = configuredDist ?? join(root, '.cache', 'web-dist');
const env: NodeJS.ProcessEnv = {
  ...process.env,
  PORT: '0',
  FOURDGEN_DATA_DIR: dataDir,
  FOURDGEN_CONFIG_DIR: fixture,
  SKIN_MANAGER_CONFIG: configPath,
};
delete env.FOURDGEN_DESKTOP;
delete env.FOURDGEN_DESKTOP_TOKEN;
delete env.FOURDGEN_PARENT_PID;
delete env.ELECTRON_RUN_AS_NODE;

if (await isFile(join(defaultDist, 'index.html'))) {
  env.FOURDGEN_SKIP_WEB_BUILD = '1';
  if (configuredDist) env.FOURDGEN_WEB_DIST = configuredDist;
} else {
  // A tiny static fixture keeps the smoke test independent of the Vite build.
  const dist = join(fixture, 'web-dist');
  await mkdir(dist, { recursive: true });
  await writeFile(
    join(dist, 'index.html'),
    '<!doctype html><html><body>4DGen node smoke</body></html>',
  );
  env.FOURDGEN_WEB_DIST = dist;
  env.FOURDGEN_SKIP_WEB_BUILD = '1';
}

const nodeBinary = process.execPath;

const child = spawn(nodeBinary, [join(root, 'server', 'start.ts')], {
  cwd: root,
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});

let stdout = '';
let stderr = '';
child.stdout!.setEncoding('utf8');
child.stderr!.setEncoding('utf8');
child.stdout!.on('data', (chunk: string) => {
  stdout += chunk;
});
child.stderr!.on('data', (chunk: string) => {
  stderr += chunk;
});

async function waitForPort(): Promise<number> {
  return new Promise<number>((resolvePort, reject) => {
    const timer = setTimeout(() => {
      reject(Error(`Server did not become ready: ${stdout}${stderr}`));
    }, 30_000);
    const check = () => {
      const match = stdout.match(/本地工作台：http:\/\/127\.0\.0\.1:(\d+)/);
      if (!match) return false;
      clearTimeout(timer);
      resolvePort(Number(match[1]));
      return true;
    };
    child.stdout!.on('data', check);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(
        Error(`Server exited before ready (${code}): ${stdout}${stderr}`),
      );
    });
    check();
  });
}

try {
  const port = await waitForPort();
  assert.ok(port > 0);
  const base = `http://127.0.0.1:${port}`;
  const get = (path: string) => fetch(base + path);

  const storageResponse = await get('/api/storage');
  assert.equal(storageResponse.status, 200);
  const storage = (await storageResponse.json()) as { root: string };
  assert.equal(await realpath(storage.root), dataDir);

  const settingsResponse = await get('/api/settings');
  assert.equal(settingsResponse.status, 200);
  const settings = (await settingsResponse.json()) as {
    dataRoot: string;
    environment: boolean;
    gameConfigured: boolean;
    managerError: string;
  };
  assert.equal(await realpath(settings.dataRoot), dataDir);
  assert.equal(settings.environment, true);
  assert.equal(settings.gameConfigured, false);
  assert.match(settings.managerError, /missing-skin-manager\.json/);

  const packsResponse = await get('/api/packs');
  assert.equal(packsResponse.status, 200);
  const packs = (await packsResponse.json()) as {
    configured: boolean;
    gameConfigured: boolean;
    root: string;
    stateDir: string;
  };
  assert.equal(packs.configured, true);
  assert.equal(packs.gameConfigured, false);
  assert.equal(
    resolve(packs.root).toLowerCase(),
    resolve(dataDir, 'game-targets').toLowerCase(),
  );

  const homeResponse = await get('/');
  assert.equal(homeResponse.status, 200);
  assert.match(homeResponse.headers.get('content-type') ?? '', /text\/html/);
  assert.match(await homeResponse.text(), /4DGen|<!doctype html/i);

  const missingOrigin = await fetch(base + '/api/storage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: dataDir }),
  });
  assert.equal(missingOrigin.status, 403);

  const sameOrigin = await fetch(base + '/api/storage', {
    method: 'POST',
    headers: { Origin: base, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: dataDir }),
  });
  assert.equal(sameOrigin.status, 400);

  const modelPath = join(fixture, 'triangle.obj');
  await writeFile(modelPath, 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n');
  const importResponse = await fetch(base + '/api/local-import', {
    method: 'POST',
    headers: { Origin: base, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: modelPath }),
  });
  assert.equal(importResponse.status, 200);
  const session = (await importResponse.json()) as { id: string };
  assert.ok(session.id);

  const convertResponse = await fetch(base + '/api/convert', {
    method: 'POST',
    headers: { Origin: base, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session: session.id,
      excluded: [],
      binding: 'static',
      ratio: 0.5,
      maxError: 0.01,
      height: 32,
      profile: null,
    }),
  });
  assert.equal(convertResponse.status, 200);
  const job = (await convertResponse.json()) as { id: string };

  let jobStatus: { status: string; message: string } | undefined;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    jobStatus = (await (await fetch(`${base}/api/job/${job.id}`)).json()) as {
      status: string;
      message: string;
    };
    if (jobStatus.status !== 'running') break;
    await delay(100);
  }
  assert.equal(jobStatus?.status, 'done', jobStatus?.message ?? 'job did not finish');

  const download = await fetch(`${base}/api/job/${job.id}/download`);
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('content-type'), 'application/zip');
  await download.arrayBuffer();

  console.log(`PASS: Node server on ${base} (isolated data, no game config)`);
} finally {
  const hasExited = () =>
    child.exitCode !== null || child.signalCode !== null;
  if (!hasExited()) {
    child.kill('SIGTERM');
    await Promise.race([
      once(child, 'exit'),
      new Promise((resolveTimeout) => setTimeout(resolveTimeout, 5000)),
    ]);
    if (!hasExited()) {
      child.kill('SIGKILL');
      await Promise.race([
        once(child, 'exit'),
        new Promise((resolveTimeout) => setTimeout(resolveTimeout, 2000)),
      ]);
    }
  }
  await rm(fixture, { recursive: true, force: true });
}
