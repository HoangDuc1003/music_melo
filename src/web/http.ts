// Bản web của src/youtube/http.ts: gọi thẳng bằng fetch của trình duyệt (các nguồn đều cho phép CORS).
export const appFetch: typeof fetch = (input, init) => fetch(input, init);

export function devProxyUrl(url: string): string {
  return url;
}
