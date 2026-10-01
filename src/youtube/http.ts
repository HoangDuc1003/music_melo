// fetch dùng cho mọi request tới YouTube/Google/LRCLIB.
// - Trên iPhone: đi qua CapacitorHttp (URLSession native) → không bị CORS, dùng đúng IP của máy.
// - Khi chạy thử trên PC: đi qua proxy dev của Vite (/__proxy/<host>/…), xem vite.config.ts.
import { CapacitorHttp } from '@capacitor/core';
import { isNative } from '@/lib/platform';

const NULL_BODY_STATUS = new Set([101, 103, 204, 205, 304]);

function headersToObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

async function nativeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init);
  const headers = headersToObject(request.headers);
  let data: string | undefined;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    data = await request.text();
    // CapacitorHttp chỉ gắn body khi có Content-Type.
    if (!('content-type' in headers)) headers['content-type'] = 'text/plain;charset=UTF-8';
  }
  const res = await CapacitorHttp.request({
    url: request.url,
    method: request.method,
    headers,
    data,
    responseType: 'text',
    connectTimeout: 20_000,
    readTimeout: 30_000
  });
  // CapacitorHttp tự parse JSON khi Content-Type là JSON → chuyển lại thành chuỗi.
  const raw = res.data;
  const body = NULL_BODY_STATUS.has(res.status) ? null : raw == null ? '' : typeof raw === 'string' ? raw : JSON.stringify(raw);
  const responseHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(res.headers ?? {})) responseHeaders[key] = String(value);
  return new Response(body, { status: res.status || 200, headers: responseHeaders });
}

/** Đổi https://host/path → /__proxy/host/path (chỉ dùng lúc phát triển trên PC). */
export function devProxyUrl(url: string): string {
  const u = new URL(url);
  if (u.origin === location.origin) return url;
  return `${location.origin}/__proxy/${u.host}${u.pathname}${u.search}`;
}

async function devFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init);
  const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.text();
  return fetch(devProxyUrl(request.url), {
    method: request.method,
    headers: request.headers,
    body,
    signal: init?.signal ?? undefined
  });
}

export const appFetch: typeof fetch = isNative ? nativeFetch : devFetch;

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await appFetch(url, init);
  if (!res.ok) throw new HttpError(res.status, `${res.status} ${url.split('?')[0]}`);
  return (await res.json()) as T;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'HttpError';
  }
}
