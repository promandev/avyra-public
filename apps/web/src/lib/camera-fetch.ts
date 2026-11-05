/**
 * HTTP client utilities for fetching data from cameras on the local network.
 *
 * Node.js's built-in fetch() (undici) has compatibility issues with the minimal
 * HTTP servers on yi-hack cameras (mini_httpd). The undici client times out on
 * connections that work fine with Node.js's legacy http module. This module
 * wraps the http module to provide reliable camera communication.
 */
import http from 'node:http';

const DEFAULT_TIMEOUT_MS = 8_000;

/**
 * Fetch JSON from a camera HTTP endpoint using Node.js http module.
 * Returns null on any error (timeout, parse error, non-2xx status).
 */
export async function cameraFetchJson<T>(
  url: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T | null> {
  const r = await cameraFetchJsonResult<T>(url, timeoutMs);
  return r.ok ? r.data : null;
}

export type CameraFetchResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/**
 * Igual que cameraFetchJson, pero conserva el motivo del fallo (timeout,
 * conexión rechazada, HTTP 5xx, JSON inválido…) para poder registrarlo.
 */
export async function cameraFetchJsonResult<T>(
  url: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<CameraFetchResult<T>> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (r: CameraFetchResult<T>) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      if (!res.statusCode || res.statusCode >= 400) {
        res.resume();
        done({ ok: false, error: `HTTP ${res.statusCode ?? '?'}` });
        return;
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { done({ ok: true, data: JSON.parse(data) as T }); } catch { done({ ok: false, error: 'JSON inválido' }); }
      });
      res.on('error', (e) => done({ ok: false, error: e.message }));
    });
    req.on('timeout', () => { req.destroy(); done({ ok: false, error: 'timeout' }); });
    req.on('error', (e: NodeJS.ErrnoException) => done({ ok: false, error: e.code ?? e.message }));
  });
}

/**
 * Proxy a binary file (video/image) from a camera, returning a Response suitable
 * for Next.js route handlers. Supports Range requests for video seeking.
 */
export async function cameraProxyStream(
  url: string,
  options: {
    timeoutMs?: number;
    rangeHeader?: string | null;
    contentType?: string;
  } = {},
): Promise<Response> {
  const { timeoutMs = 30_000, rangeHeader, contentType = 'video/mp4' } = options;

  return new Promise((resolve) => {
    const reqOptions: http.RequestOptions = {
      timeout: timeoutMs,
      headers: {} as Record<string, string>,
    };
    if (rangeHeader) {
      (reqOptions.headers as Record<string, string>)['Range'] = rangeHeader;
    }

    const req = http.get(url, reqOptions, (res) => {
      const status = res.statusCode ?? 500;
      if (status >= 400) {
        res.resume();
        resolve(new Response('Segment unavailable', { status }));
        return;
      }

      const headers = new Headers({
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=3600',
        'Accept-Ranges': 'bytes',
      });
      if (res.headers['content-length']) {
        headers.set('Content-Length', res.headers['content-length']);
      }
      if (res.headers['content-range']) {
        headers.set('Content-Range', res.headers['content-range']);
      }

      // Convert Node.js readable stream to web ReadableStream
      const readable = new ReadableStream({
        start(controller) {
          res.on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
          res.on('end', () => controller.close());
          res.on('error', () => controller.close());
        },
        cancel() {
          res.destroy();
        },
      });

      resolve(new Response(readable, { status, headers }));
    });

    req.on('timeout', () => {
      req.destroy();
      resolve(new Response('Camera timeout', { status: 504 }));
    });
    req.on('error', () => {
      resolve(new Response('Proxy error', { status: 502 }));
    });
  });
}
