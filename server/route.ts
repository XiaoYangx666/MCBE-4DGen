import type { Studio } from './studio.ts';

export interface RouteContext {
  studio: Studio;
  req: Request;
  url: URL;
  /** Values captured from `:name` segments in the route path. */
  params: Record<string, string>;
}

export type RouteHandler = (context: RouteContext) => Promise<Response | null>;

export interface Route {
  method: string;
  segments: string[];
  handler: RouteHandler;
}

/** Declare one HTTP route; `:name` segments become `params.name`. */
export function route(
  method: string,
  path: string,
  handler: RouteHandler,
): Route {
  return {
    method,
    segments: path.split('/').filter(Boolean),
    handler,
  };
}

/**
 * Build a dispatcher for a flat route table. Paths and methods are matched
 * literally, so handlers no longer have to inspect `parts` themselves. The
 * first matching route wins; declare parameterized routes after exact ones
 * when both could match.
 */
export function createRouteMatcher(routes: Route[]) {
  return async function dispatch(
    studio: Studio,
    req: Request,
    url: URL,
  ): Promise<Response | null> {
    const parts = url.pathname.split('/').filter(Boolean);
    for (const candidate of routes) {
      if (
        candidate.method !== req.method &&
        !(candidate.method === 'GET' && req.method === 'HEAD') &&
        candidate.method !== '*'
      )
        continue;
      if (candidate.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let matched = true;
      for (let index = 0; index < parts.length; index++) {
        const expected = candidate.segments[index]!;
        if (expected.startsWith(':')) params[expected.slice(1)] = parts[index]!;
        else if (expected !== parts[index]) {
          matched = false;
          break;
        }
      }
      if (!matched) continue;
      return candidate.handler({ studio, req, url, params });
    }
    return null;
  };
}
