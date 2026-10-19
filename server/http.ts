import type { Studio } from './studio.ts';

export const json = (value: unknown, status = 200) =>
  Response.json(value, { status });

/** Stable JSON keeps cache keys independent of object property order. */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
        )
      : item,
  );
}

/** Reject empty, parent and absolute segments before writing uploaded files. */
export function safeName(name: string): string {
  const parts = name.replaceAll('\\', '/').split('/');
  if (
    parts.some(
      (part) =>
        !part || part === '.' || part === '..' || /[:\x00-\x1f]/.test(part),
    )
  )
    throw Error('文件路径无效');
  return parts.join('/');
}

/**
 * Serialize expensive studio operations. The long-running conversion route
 * manages `busy` itself because its work continues after the response.
 */
export async function withBusy(
  studio: Studio,
  handler: () => Promise<Response>,
): Promise<Response> {
  if (studio.busy) return json({ error: '已有任务正在运行' }, 409);
  studio.busy = true;
  try {
    return await handler();
  } finally {
    studio.busy = false;
  }
}

export function checkRequest(
  req: Request,
  url: URL,
  port: number,
): Response | null {
  const token = process.env.FOURDGEN_DESKTOP_TOKEN;
  if (
    token &&
    req.headers.get('authorization') !== 'Bearer ' + token &&
    !req.headers
      .get('cookie')
      ?.split(';')
      .some((value) => value.trim() === '4dgen_session=' + token)
  )
    return json({ error: 'Desktop session required' }, 403);
  if (
    req.headers.get('host') !== `127.0.0.1:${port}` &&
    req.headers.get('host') !== `localhost:${port}`
  )
    return json({ error: 'Invalid host' }, 403);
  if (req.method !== 'GET' && req.headers.get('origin') !== url.origin)
    return json({ error: '同源请求校验失败' }, 403);
  return null;
}
