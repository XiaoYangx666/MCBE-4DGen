/**
 * Capture the desktop workbench texture studio from the local server.
 *
 * Usage: node scripts/checks/capture-desktop-cdp.mjs
 * Requires `npm run dev` on port 4180 (or DESKTOP_URL).
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import WebSocket from 'ws';

const CHROME =
  process.env.CHROME_PATH ??
  'C:/Program Files/Google/Chrome/Application/chrome.exe';
const STUDIO_URL = process.env.DESKTOP_URL ?? 'http://127.0.0.1:4180/#/models';
const MODEL_NAME = process.env.DESKTOP_MODEL ?? 'Porsche 918 Spyder';
const OUT = resolve('docs/research/texture-studio-v1/images');
const PROFILE = resolve('.cache/chrome-desktop-profile');
const PORT = 9334;
const wait = (ms) => new Promise((done) => setTimeout(done, ms));

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

async function evaluate(cdp, script) {
  const result = await cdp.send('Runtime.evaluate', {
    expression: script,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

async function waitFor(cdp, expression, timeout = 120000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(cdp, expression)) return;
    await wait(250);
  }
  throw new Error(`timed out: ${expression}`);
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
      const response = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      version = await response.json();
    } catch {
      await wait(250);
    }
  }
  if (!version) throw new Error('Chrome did not start');
  const targets = await (
    await fetch(`http://127.0.0.1:${PORT}/json/list`)
  ).json();
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
  await waitFor(
    cdp,
    `document.body.innerText.includes(${JSON.stringify(MODEL_NAME)})`,
  );
  await evaluate(
    cdp,
    `(() => {
      [...document.querySelectorAll('button')]
        .find((button) => button.textContent?.includes(${JSON.stringify(MODEL_NAME)}))?.click();
      return true;
    })()`,
  );
  await waitFor(cdp, `document.body.innerText.includes('继续编辑')`);
  await evaluate(
    cdp,
    `(() => {
      [...document.querySelectorAll('button')]
        .find((button) => button.textContent?.includes('继续编辑'))?.click();
      return true;
    })()`,
  );
  await waitFor(cdp, `document.querySelectorAll('.texture-part-row').length > 0`);
  await shot(cdp, '06-desktop-workbench.png');

  await evaluate(
    cdp,
    `(() => {
      document.querySelectorAll('.texture-studio-mode button')[1]?.click();
      const material = document.querySelector('.shared-material-name');
      material?.click();
      const scroll = document.querySelector('.sidebar');
      if (scroll) scroll.scrollTop = scroll.scrollHeight;
      return true;
    })()`,
  );
  await wait(400);
  await shot(cdp, '07-desktop-budget.png');

  if (process.env.DESKTOP_PARTS_OFF === '1') {
    await evaluate(
      cdp,
      `(() => {
        const boxes = [...document.querySelectorAll('.texture-part-row input[type=checkbox]:checked')];
        for (const box of boxes) box.click();
        return boxes.length;
      })()`,
    );
    await wait(500);
    await shot(cdp, '08-desktop-parts-off.png');
  }
  await cdp.send('Browser.close').catch(() => {});
  socket.close();
} finally {
  chrome.kill();
  await rm(PROFILE, { recursive: true, force: true }).catch(() => {});
}
