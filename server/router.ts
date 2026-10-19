import { checkRequest, json } from './http.ts';
import { handleConvert } from './routes/convert.ts';
import { handleModels } from './routes/models.ts';
import { handlePacks } from './routes/packs.ts';
import { handleSettings } from './routes/settings.ts';
import { serveStatic } from './routes/static.ts';
import { handleTemplates } from './routes/templates.ts';
import { handleUploads } from './routes/uploads.ts';
import type { Studio } from './studio.ts';

type Route = (
  studio: Studio,
  req: Request,
  url: URL,
  parts: string[],
) => Promise<Response | null>;

// Order mirrors the original route table: exact routes first, then parameterized ones.
const ROUTES: Route[] = [
  handleSettings,
  handleTemplates,
  handleModels,
  handleUploads,
  handleConvert,
  handlePacks,
];

export function createHandler(
  studio: Studio,
  port: () => number,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const url = new URL(req.url);
    const parts = url.pathname.split('/').filter(Boolean);
    try {
      const denied = checkRequest(req, url, port());
      if (denied) return denied;
      for (const route of ROUTES) {
        const response = await route(studio, req, url, parts);
        if (response) return response;
      }
      if (url.pathname.startsWith('/api/'))
        return json({ error: 'Unknown API' }, 404);
      return await serveStatic(studio, url);
    } catch (error) {
      return json(
        { error: error instanceof Error ? error.message : String(error) },
        400,
      );
    }
  };
}
