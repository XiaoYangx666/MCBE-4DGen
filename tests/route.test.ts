import { describe, expect, it } from 'vitest';
import { createRouteMatcher, route } from '../server/route.ts';
import type { Studio } from '../server/studio.ts';

const studio = {} as Studio;

async function call(
  routes: ReturnType<typeof route>[],
  method: string,
  path: string,
) {
  const url = new URL('http://127.0.0.1' + path);
  return createRouteMatcher(routes)(
    studio,
    new Request(url, { method }),
    url,
  );
}

describe('server route table', () => {
  it('matches exact paths and methods', async () => {
    const response = await call(
      [route('GET', '/api/models', async () => Response.json('ok'))],
      'GET',
      '/api/models',
    );
    expect(await response?.json()).toBe('ok');
  });

  it('captures :params and ignores query strings', async () => {
    const response = await call(
      [
        route('GET', '/api/packs/:id/skins', async ({ params }) =>
          Response.json(params),
        ),
      ],
      'GET',
      '/api/packs/pack-1/skins?skin=2',
    );
    expect(await response?.json()).toEqual({ id: 'pack-1' });
  });

  it('does not match another method', async () => {
    const response = await call(
      [route('POST', '/api/models', async () => Response.json('ok'))],
      'GET',
      '/api/models',
    );
    expect(response).toBeNull();
  });

  it('serves GET routes for HEAD requests', async () => {
    const response = await call(
      [route('GET', '/api/models', async () => Response.json('ok'))],
      'HEAD',
      '/api/models',
    );
    expect(response?.status).toBe(200);
  });

  it('uses declaration order when several routes match', async () => {
    const response = await call(
      [
        route('GET', '/api/:value/items', async () => Response.json('first')),
        route('GET', '/api/models/items', async () => Response.json('second')),
      ],
      'GET',
      '/api/models/items',
    );
    expect(await response?.json()).toBe('first');
  });
});
