import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileResponse } from '../fs.ts';
import type { Studio } from '../studio.ts';

/** Serve the built web client, refusing paths outside the output folder. */
export async function serveStatic(studio: Studio, url: URL): Promise<Response> {
  const target = resolve(
    studio.dist,
    url.pathname === '/'
      ? 'index.html'
      : '.' + decodeURIComponent(url.pathname),
  );
  const actual = await realpath(target).catch(() => null);
  const dist = await realpath(studio.dist).catch(() => studio.dist);
  if (
    !actual ||
    !(actual.startsWith(dist + '\\') || actual.startsWith(dist + '/'))
  )
    return new Response('Not found', { status: 404 });
  return fileResponse(actual);
}
