/**
 * Capture real UI screenshots through headless Chrome + CDP.
 *
 * Usage: node scripts/checks/capture-studio-cdp.mjs
 * Requires `npm run webapp:dev` on port 4176 and a model served from
 * webapp/public (default /e2e-kati.glb).
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import WebSocket from 'ws';

const CHROME =
  process.env.CHROME_PATH ??
  'C:/Program Files/Google/Chrome/Application/chrome.exe';
const STUDIO_URL = process.env.STUDIO_URL ?? 'http://localhost:4176/#model';
const MODEL = process.env.STUDIO_MODEL ?? '/e2e-kati.glb';
const OUT = resolve('docs/research/texture-studio-v1/images');
const PROFILE = resolve('.cache/chrome-studio-profile');
const PORT = 9333;

const wait = (ms) => new Promise((done) => setTimeout(done, ms));

async function getJson(path, init) {
  const response = await fetch(`http://127.0.0.1:${PORT}${path}`, init);
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.json();
}

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.id = 0;
    this.pending = new Map();
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails)
    throw new Error(result.exceptionDetails.text ?? 'evaluate failed');
  return result.result.value;
}

async function waitForExpression(cdp, expression, timeout = 120000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(cdp, expression)) return;
    await wait(250);
  }
  throw new Error(`timed out waiting for ${expression}`);
}

async function shot(cdp, name) {
  await wait(350);
  const result = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  });
  await writeFile(resolve(OUT, name), Buffer.from(result.data, 'base64'));
  console.log('wrote', name);
}

await mkdir(OUT, { recursive: true });
await rm(PROFILE, { recursive: true, force: true });
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--no-sandbox',
    '--window-size=1500,1000',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'ignore'] },
);

try {
  let version = null;
  for (let attempt = 0; attempt < 60 && !version; attempt++) {
    try {
      version = await getJson('/json/version');
    } catch {
      await wait(250);
    }
  }
  if (!version) throw new Error('Chrome did not start');
  const targets = await getJson('/json/list');
  const page = targets.find((target) => target.type === 'page');
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolvePromise, reject) => {
    socket.once('open', resolvePromise);
    socket.once('error', reject);
  });
  const cdp = new Cdp(socket);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1500,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdp.send('Page.navigate', { url: STUDIO_URL });
  await wait(1200);
  await evaluate(
    cdp,
    `(async () => {
      const target = [...document.querySelectorAll('.dropzone')][1];
      const response = await fetch(${JSON.stringify(MODEL)});
      const blob = await response.blob();
      const file = new File([blob], 'studio-model.glb', { type: 'model/gltf-binary' });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      for (const type of ['dragenter', 'dragover', 'drop'])
        target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }));
      return blob.size;
    })()`,
  );
  await waitForExpression(
    cdp,
    `document.querySelectorAll('.texture-part-row').length > 0`,
  );
  await shot(cdp, '01-studio-legacy.png');

  await evaluate(
    cdp,
    `(() => {
      document.querySelectorAll('.texture-studio-mode button')[1]?.click();
      const material = [...document.querySelectorAll('.shared-material-name')]
        .find((button) => button.textContent?.trim() === 'Face_');
      material?.click();
      return true;
    })()`,
  );
  await wait(350);
  await evaluate(
    cdp,
    `(() => {
      const preset = [...document.querySelectorAll('.texture-quality-actions button')]
        .find((button) => button.textContent?.trim() === '2×');
      preset?.click();
      return true;
    })()`,
  );
  await wait(350);
  await shot(cdp, '02-studio-budget-quality.png');
  await evaluate(
    cdp,
    `(() => {
      const scroll = document.querySelector('.studio-materials .panel-scroll');
      if (scroll) scroll.scrollTop = scroll.scrollHeight;
      return true;
    })()`,
  );
  console.log(
    'scroll',
    await evaluate(
      cdp,
      `(() => { const scroll = document.querySelector('.studio-materials .panel-scroll'); return { sh: scroll?.scrollHeight, ch: scroll?.clientHeight, top: scroll?.scrollTop, tuner: !!document.querySelector('.texture-quality-tuner') }; })()`,
    ),
  );
  await wait(300);
  await shot(cdp, '02b-quality-tuner.png');

  await evaluate(
    cdp,
    `(() => {
      const row = [...document.querySelectorAll('.texture-part-row')]
        .find((entry) => entry.querySelector('.texture-part-name')?.textContent?.trim() === 'Face__1');
      row?.querySelector('input[type=checkbox]')?.click();
      return true;
    })()`,
  );
  await wait(350);
  await evaluate(
    cdp,
    `(() => {
      [...document.querySelectorAll('button.primary')]
        .find((button) => button.textContent?.includes('转换'))?.click();
      return true;
    })()`,
  );
  await waitForExpression(
    cdp,
    `!!document.querySelector('.conversion-summary')`,
    180000,
  );
  await waitForExpression(
    cdp,
    `!document.querySelector('.busy-overlay')`,
    180000,
  );
  await wait(500);
  await shot(cdp, '03-studio-result.png');

  await evaluate(
    cdp,
    `(() => {
      [...document.querySelectorAll('button')]
        .find((entry) => entry.textContent?.includes('贴图分区'))?.click();
      return true;
    })()`,
  );
  await waitForExpression(cdp, `!!document.querySelector('.atlas-inspector')`);
  await wait(500);
  await shot(cdp, '04-atlas-diagnostics.png');

  await evaluate(
    cdp,
    `(() => {
      document.querySelector('[aria-label="关闭贴图分区"]')?.click();
      document.querySelectorAll('.texture-studio-mode button')[0]?.click();
      const scroll = document.querySelector('.studio-materials .panel-scroll');
      if (scroll) scroll.scrollTop = 0;
      return true;
    })()`,
  );
  await wait(400);
  await shot(cdp, '05-studio-legacy-after-budget.png');
  await cdp.send('Browser.close').catch(() => {});
  socket.close();
} finally {
  chrome.kill();
  await rm(PROFILE, { recursive: true, force: true }).catch(() => {});
}
