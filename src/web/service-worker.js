// Service worker của bản web (Melo PWA). vite.config.ts điền danh sách file và phiên bản lúc build → /sw.js.
// - Giao diện (HTML/JS/CSS/icon) lưu sẵn khi cài → mở app từ màn hình chính được cả khi không có mạng.
// - Ảnh bìa trên mạng: lưu lại khi đã xem (tối đa MAX_IMAGES ảnh) để offline vẫn thấy.
// - Nhạc không đi qua đây: bài đã tải nằm trong IndexedDB (phát bằng blob:), bài nghe online đi thẳng ra mạng.
const VERSION = '__MELO_VERSION__';
const PRECACHE = __MELO_PRECACHE__;
const SHELL = `melo-shell-${VERSION}`;
const IMAGES = 'melo-images';
const MAX_IMAGES = 200;
const NAVIGATION_TIMEOUT_MS = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith('melo-shell-') && key !== SHELL) await caches.delete(key);
      }
      await self.clients.claim();
    })()
  );
});

/** Trang: lấy bản mới trên mạng (có giới hạn thời gian), không được thì dùng bản đã lưu. */
async function navigation(request) {
  const cache = await caches.open(SHELL);
  try {
    const response = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NAVIGATION_TIMEOUT_MS))
    ]);
    if (response.ok) return response;
  } catch {
    // offline hoặc mạng quá chậm
  }
  return (await cache.match('/index.html')) ?? Response.error();
}

/** Ảnh bìa: dùng ảnh đã lưu ngay, đồng thời cập nhật ở nền. */
async function image(request) {
  const cache = await caches.open(IMAGES);
  const cached = await cache.match(request);
  const fresh = fetch(request)
    .then(async (response) => {
      if (response.ok || response.type === 'opaque') {
        await cache.put(request, response.clone());
        const keys = await cache.keys();
        for (const old of keys.slice(0, Math.max(0, keys.length - MAX_IMAGES))) await cache.delete(old);
      }
      return response;
    })
    .catch(() => undefined);
  return cached ?? (await fresh) ?? Response.error();
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    if (request.mode === 'navigate') return event.respondWith(navigation(request));
    return event.respondWith(caches.match(request).then((hit) => hit ?? fetch(request)));
  }
  if (request.destination === 'image') event.respondWith(image(request));
});
