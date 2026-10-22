import { checkRequest, HttpError, json } from './http.ts';
import { createRouteMatcher } from './route.ts';
import { convertRoutes } from './routes/convert.ts';
import { modelRoutes } from './routes/models.ts';
import { packRoutes } from './routes/packs/index.ts';
import { settingsRoutes } from './routes/settings.ts';
import { serveStatic } from './routes/static.ts';
import { templateRoutes } from './routes/templates.ts';
import { uploadRoutes } from './routes/uploads.ts';
import type { Studio } from './studio.ts';

const dispatch = createRouteMatcher([
  ...settingsRoutes,
  ...templateRoutes,
  ...modelRoutes,
  ...uploadRoutes,
  ...convertRoutes,
  ...packRoutes,
]);

export function createHandler(
  studio: Studio,
  port: () => number,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const url = new URL(req.url);
    try {
      const denied = checkRequest(req, url, port());
      if (denied) return denied;
      const response = await dispatch(studio, req, url);
      if (response) return response;
      if (url.pathname.startsWith('/api/'))
        return json({ error: 'Unknown API' }, 404);
      return await serveStatic(studio, url);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 400;
      if (status >= 500) console.error('API 请求失败：', error);
      return json(
        { error: error instanceof Error ? error.message : String(error) },
        status,
      );
    }
  };
}
