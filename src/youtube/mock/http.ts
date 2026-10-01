// Bản giả của src/youtube/http.ts cho `npm run dev:mock`: LRCLIB trả lời bài mẫu, mọi request khác báo 404.
import { LRC } from './fixtures';

export function devProxyUrl(url: string): string {
  return url;
}

export const appFetch: typeof fetch = async (input) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  await new Promise((resolve) => setTimeout(resolve, 200));
  if (url.hostname === 'lrclib.net' && url.pathname === '/api/get') {
    return new Response(JSON.stringify({ syncedLyrics: LRC, plainLyrics: LRC.replace(/\[[^\]]+\]/g, '') }), { status: 200 });
  }
  return new Response('{}', { status: 404 });
};

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
