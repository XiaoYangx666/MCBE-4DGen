import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { Readable } from 'node:stream';

const CONTENT_TYPES: Record<string, string> = {
  '.bin': 'application/octet-stream',
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.htm': 'text/html; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.otf': 'font/otf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

export function contentType(path: string): string {
  return (
    CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
  );
}

export async function fileExists(path: string): Promise<boolean> {
  return stat(path)
    .then((info) => info.isFile())
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false;
      throw error;
    });
}

/** True for files, directories, and any other existing path. */
export async function pathExists(path: string): Promise<boolean> {
  return stat(path)
    .then(() => true)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false;
      throw error;
    });
}

export async function readFileBytes(path: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(path));
}

export async function readFileText(path: string): Promise<string> {
  return readFile(path, 'utf8');
}

/** Stream a file with the same content type Bun.file infers from its extension. */
export async function fileResponse(
  path: string,
  init: { status?: number; headers?: HeadersInit } = {},
): Promise<Response> {
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) return new Response('Not found', { status: 404 });
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type'))
    headers.set('Content-Type', contentType(path));
  headers.set('Content-Length', String(info.size));
  const body = Readable.toWeb(
    createReadStream(path),
  ) as unknown as ReadableStream<Uint8Array>;
  return new Response(body, { status: init.status ?? 200, headers });
}
