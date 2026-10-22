import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { SOURCE_DOMAINS } from '../../src/source-sites.ts';
import { storage } from '../../src/workspace-storage.ts';
import { route } from '../route.ts';

const CACHE_DIR = resolve(storage.cache, 'source-icons');
const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 3500;
const FALLBACK_HOST = 'icons.duckduckgo.com';
const PLACEHOLDER = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  ),
);

function imageType(bytes: Uint8Array): string | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e) {
    return 'image/png';
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0) {
    return 'image/x-icon';
  }
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return 'image/gif';
  }
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46
  ) {
    return 'image/webp';
  }
  const head = new TextDecoder()
    .decode(bytes.subarray(0, 256))
    .trim()
    .toLowerCase();
  if (head.startsWith('<svg') || head.startsWith('<?xml')) {
    return 'image/svg+xml';
  }
  return null;
}

function iconResponse(
  bytes: Uint8Array,
  type: string,
  maxAge = 604800,
): Response {
  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': type,
      'Cache-Control': `public, max-age=${maxAge}`,
    },
  });
}

async function download(
  target: URL,
  domain: string,
  sameSite: boolean,
): Promise<{ bytes: Uint8Array; type: string } | null> {
  const response = await fetch(target, {
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'User-Agent': '4DGen/0.1 local-model-workbench' },
  }).catch(() => null);
  if (!response?.ok) return null;
  if (sameSite) {
    const finalHost = new URL(response.url).hostname.toLowerCase();
    if (finalHost !== domain && !finalHost.endsWith('.' + domain)) return null;
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_BYTES) return null;
  const type =
    imageType(bytes) ??
    (response.headers.get('content-type')?.startsWith('image/')
      ? response.headers.get('content-type')!
      : null);
  return type ? { bytes, type } : null;
}

/**
 * Favicon proxy for the source directory. Chromium in the desktop build only
 * allows `img-src 'self'`, so external icons are fetched and cached here.
 */
export const sourceRoutes = [
  route('GET', '/api/source-icon', async ({ url }) => {
    const domain = (url.searchParams.get('domain') ?? '').trim().toLowerCase();
    if (!SOURCE_DOMAINS.has(domain))
      return iconResponse(PLACEHOLDER, 'image/png', 1800);
    const file = resolve(
      CACHE_DIR,
      createHash('sha256').update(domain).digest('hex') + '.img',
    );
    const cached = await readFile(file).catch(() => null);
    if (cached) {
      const type = imageType(cached);
      if (type) return iconResponse(cached, type);
    }

    let icon = await download(
      new URL(`https://${domain}/favicon.ico`),
      domain,
      true,
    );
    if (!icon)
      icon = await download(
        new URL(`https://${FALLBACK_HOST}/ip3/${domain}.ico`),
        domain,
        false,
      );
    if (!icon) return iconResponse(PLACEHOLDER, 'image/png', 1800);
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(file, icon.bytes).catch(() => {});
    return iconResponse(icon.bytes, icon.type);
  }),
];
