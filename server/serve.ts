import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export interface ServeOptions {
  hostname: string;
  port: number;
  /** Idle socket timeout in seconds, matching Bun.serve's option. */
  idleTimeout?: number;
  /** Best-effort request body cap; Content-Length is rejected before reading. */
  maxRequestBodySize?: number;
  fetch: (req: Request) => Promise<Response>;
}

export interface RunningServer {
  readonly port: number;
  /** Stop accepting requests, then wait briefly for in-flight responses. */
  stop(): Promise<void>;
}

const DEFAULT_IDLE_TIMEOUT = 255;
const DEFAULT_MAX_BODY = 256 * 1024 * 1024;
const SHUTDOWN_GRACE_MS = 5000;

function limitBody(
  stream: ReadableStream<Uint8Array>,
  limit: number,
  onExceed: () => void,
): ReadableStream<Uint8Array> {
  let total = 0;
  return stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        total += chunk.byteLength;
        if (total > limit) {
          onExceed();
          controller.error(Error('Request body too large'));
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
}

function requestHeaders(req: IncomingMessage): Headers {
  const headers = new Headers();
  for (let index = 0; index < req.rawHeaders.length; index += 2)
    headers.append(req.rawHeaders[index]!, req.rawHeaders[index + 1]!);
  return headers;
}

async function toRequest(
  req: IncomingMessage,
  hostname: string,
  port: number,
  maxBody: number,
  markTooLarge: () => void,
): Promise<Request> {
  const host = req.headers.host ?? `${hostname}:${port}`;
  const url = new URL(req.url ?? '/', `http://${host}`);
  const headers = requestHeaders(req);
  const contentLength = Number(headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBody) {
    markTooLarge();
    req.resume();
    return new Request(url, { method: req.method, headers });
  }
  if (req.method === 'GET' || req.method === 'HEAD')
    return new Request(url, { method: req.method, headers });

  const body = limitBody(
    Readable.toWeb(req) as unknown as ReadableStream<Uint8Array>,
    maxBody,
    markTooLarge,
  );
  return new Request(url, {
    method: req.method,
    headers,
    body: body as BodyInit,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
}

async function writeResponse(
  res: ServerResponse,
  response: Response,
  method: string | undefined,
): Promise<void> {
  res.statusCode = response.status;
  if (response.statusText) res.statusMessage = response.statusText;
  for (const [name, value] of response.headers) {
    if (name === 'set-cookie') continue;
    res.setHeader(name, value);
  }
  const cookies = response.headers.getSetCookie?.() ?? [];
  if (cookies.length) res.setHeader('set-cookie', cookies);

  if (!response.body || method === 'HEAD') {
    if (method === 'HEAD' && response.body)
      await response.body.cancel().catch(() => {});
    res.end();
    return;
  }
  try {
    await pipeline(
      Readable.fromWeb(
        response.body as unknown as Parameters<typeof Readable.fromWeb>[0],
      ),
      res,
    );
  } catch (error) {
    // The client may disconnect while a large response is streaming.
    if (!res.destroyed) res.destroy(error as Error);
  }
}

/** Runtime-neutral replacement for Bun.serve's fetch listener. */
export function serve(options: ServeOptions): Promise<RunningServer> {
  const maxBody = options.maxRequestBodySize ?? DEFAULT_MAX_BODY;
  const server = createServer((req, res) => {
    let tooLarge = false;
    void (async () => {
      try {
        const request = await toRequest(
          req,
          options.hostname,
          (server.address() as { port: number } | null)?.port ?? options.port,
          maxBody,
          () => {
            tooLarge = true;
          },
        );
        const response = tooLarge
          ? new Response('Payload Too Large', { status: 413 })
          : await options.fetch(request);
        if (tooLarge) {
          await response.body?.cancel().catch(() => {});
          res.statusCode = 413;
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end('Payload Too Large');
          return;
        }
        await writeResponse(res, response, req.method);
      } catch (error) {
        req.resume();
        if (res.headersSent) {
          if (!res.destroyed) res.destroy(error as Error);
          return;
        }
        res.statusCode = 500;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end(error instanceof Error ? error.message : String(error));
      }
    })();
  });

  const idleMs = (options.idleTimeout ?? DEFAULT_IDLE_TIMEOUT) * 1000;
  server.timeout = idleMs;
  // Bun's idleTimeout is inactivity-based; a total request deadline would cut
  // off large uploads that are still making progress.
  server.requestTimeout = 0;
  server.keepAliveTimeout = idleMs;
  server.headersTimeout = idleMs;

  let stopping: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    if (stopping) return stopping;
    stopping = new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        server.closeAllConnections?.();
      }, SHUTDOWN_GRACE_MS);
      timer.unref();
      server.close(() => {
        clearTimeout(timer);
        resolve();
      });
      server.closeIdleConnections?.();
    });
    return stopping;
  };

  return new Promise<RunningServer>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      const address = server.address();
      const port =
        typeof address === 'object' && address ? address.port : options.port;
      resolve({ port, stop });
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(options.port, options.hostname);
  });
}
