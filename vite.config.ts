/// <reference types="vitest/config" />
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { fileURLToPath, URL } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Chỉ dùng khi chạy thử trên PC (npm run dev): trình duyệt không gọi thẳng YouTube được (CORS),
// nên mọi request được chuyển qua /__proxy/<host>/<path>. Trên iPhone, app gọi bằng HTTP native nên không cần.
const PROXY_PREFIX = '/__proxy/';
const ALLOWED_HOST = /(^|\.)(youtube\.com|googlevideo\.com|googleapis\.com|ytimg\.com|googleusercontent\.com|gstatic\.com|google\.com|lrclib\.net|accounts\.spotify\.com|api\.spotify\.com)$/;
const DROP_REQUEST_HEADERS = new Set(['host', 'connection', 'origin', 'referer', 'cookie', 'accept-encoding', 'content-length', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest']);
const DROP_RESPONSE_HEADERS = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'set-cookie', 'alt-svc', 'strict-transport-security']);

async function readBody(req: IncomingMessage): Promise<Buffer | undefined> {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

function devProxy(): Plugin {
  return {
    name: 'melo-dev-proxy',
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        if (!req.url?.startsWith(PROXY_PREFIX)) return next();
        const rest = req.url.slice(PROXY_PREFIX.length);
        const slash = rest.indexOf('/');
        const host = (slash === -1 ? rest : rest.slice(0, slash)).toLowerCase();
        const target = `https://${host}${slash === -1 ? '/' : rest.slice(slash)}`;
        // Chỉ nhận tên miền thuần (không @ ? # : …) và URL dựng ra phải trỏ đúng tên miền đó (chống SSRF).
        let targetHost = '';
        try {
          targetHost = new URL(target).hostname;
        } catch {
          // để targetHost rỗng → bị chặn bên dưới
        }
        if (!/^[a-z0-9.-]+$/.test(host) || !ALLOWED_HOST.test(host) || targetHost !== host) {
          res.statusCode = 403;
          res.end('host not allowed');
          return;
        }
        const headers: Record<string, string> = {};
        for (const [key, value] of Object.entries(req.headers)) {
          if (!DROP_REQUEST_HEADERS.has(key) && typeof value === 'string') headers[key] = value;
        }
        try {
          const body = await readBody(req);
          const upstream = await fetch(target, { method: req.method, headers, body: body ? new Uint8Array(body) : undefined, redirect: "follow" });
          res.statusCode = upstream.status;
          upstream.headers.forEach((value, key) => {
            if (!DROP_RESPONSE_HEADERS.has(key) && !key.startsWith('access-control-')) res.setHeader(key, value);
          });
          res.setHeader('access-control-allow-origin', '*');
          if (!upstream.body) return void res.end();
          Readable.fromWeb(upstream.body as never).pipe(res);
        } catch (err) {
          res.statusCode = 502;
          res.end(String(err));
        }
      });
    }
  };
}

/**
 * Content-Security-Policy cho bản build (không áp dụng lúc dev vì Vite cần script nội tuyến cho HMR).
 * App iPhone:
 * - script: chỉ file của app; 'unsafe-eval' bắt buộc cho youtubei.js (giải mã link) và BotGuard (PO token).
 * - connect: mọi request mạng đi qua HTTP native (CapacitorHttp/FileTransfer), WebView không cần gọi ra ngoài.
 * - img/media: ảnh bìa từ máy chủ ảnh của Google (https), ảnh/nhạc đã tải (blob:, capacitor://localhost).
 * Bản web: không có youtubei.js nên bỏ 'unsafe-eval'; trình duyệt tự gọi YouTube Data API/Audius/Jamendo/LRCLIB (https);
 * video YouTube phát bằng trình phát nhúng chính thức (script iframe_api + khung www.youtube.com).
 */
function csp(webApp: boolean): string {
  return [
    "default-src 'self'",
    webApp ? "script-src 'self' https://www.youtube.com https://s.ytimg.com" : "script-src 'self' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https:",
    "font-src 'self' data:",
    webApp ? "connect-src 'self' blob: data: https:" : "connect-src 'self' blob: data:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    webApp ? "frame-src https://www.youtube.com" : "frame-src 'none'",
    "worker-src 'self' blob:",
    "manifest-src 'self'"
  ].join('; ');
}

function contentSecurityPolicy(webApp: boolean): Plugin {
  return {
    name: 'melo-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${csp(webApp)}" />`);
    }
  };
}

/** Thẻ để iPhone coi trang là app khi "Thêm vào MH chính" (toàn màn hình, icon riêng). */
const PWA_HEAD = [
  '<link rel="manifest" href="/manifest.webmanifest" />',
  '<link rel="apple-touch-icon" href="/apple-touch-icon.png" />',
  '<meta name="apple-mobile-web-app-capable" content="yes" />',
  '<meta name="mobile-web-app-capable" content="yes" />',
  '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />',
  '<meta name="apple-mobile-web-app-title" content="Melo" />'
].join('\n    ');

const MANIFEST = {
  name: 'Melo',
  short_name: 'Melo',
  description: 'Nghe nhạc Creative Commons và nhạc của bạn, tải về nghe offline',
  lang: 'vi',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  orientation: 'portrait',
  background_color: '#121212',
  theme_color: '#121212',
  icons: [
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }
  ]
};

/**
 * Bản web (`--mode web`): manifest, icon cho iPhone và service worker (`/sw.js`) lưu sẵn mọi file của bản build
 * để mở app khi không có mạng. Phiên bản service worker = mã băm danh sách file → bản build mới tự cập nhật.
 */
function progressiveWebApp(): Plugin {
  return {
    name: 'melo-pwa',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<title>', `${PWA_HEAD}\n    <title>`);
    },
    generateBundle(_options, bundle) {
      const icon = readFileSync(new URL('./docs/icon-512.png', import.meta.url));
      this.emitFile({ type: 'asset', fileName: 'icon-512.png', source: icon });
      this.emitFile({ type: 'asset', fileName: 'apple-touch-icon.png', source: icon });
      this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: JSON.stringify(MANIFEST, null, 2) });
      const files = ['/', '/index.html', '/icon.svg', '/icon-512.png', '/apple-touch-icon.png', '/manifest.webmanifest'];
      for (const name of Object.keys(bundle)) if (!name.endsWith('.map') && name !== 'index.html') files.push(`/${name}`);
      const precache = [...new Set(files)].sort();
      const version = createHash('sha256').update(precache.join('\n')).digest('hex').slice(0, 12);
      const template = readFileSync(new URL('./src/web/service-worker.js', import.meta.url), 'utf8');
      const source = template.replace('__MELO_VERSION__', version).replace('__MELO_PRECACHE__', JSON.stringify(precache));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    }
  };
}

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
const src = fileURLToPath(new URL('./src', import.meta.url));

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), devProxy(), contentSecurityPolicy(mode === 'web'), ...(mode === 'web' ? [progressiveWebApp()] : [])],
  resolve: {
    alias: [
      // `vite --mode mock`: dữ liệu mẫu thay cho YouTube (chạy thử/chụp giao diện khi không vào được YouTube).
      ...(mode === 'mock'
        ? [
            { find: /^@\/youtube\/music$/, replacement: `${src}/youtube/mock/music.ts` },
            { find: /^@\/youtube\/stream$/, replacement: `${src}/youtube/mock/stream.ts` },
            { find: /^@\/youtube\/http$/, replacement: `${src}/youtube/mock/http.ts` },
            { find: /^@\/sync\/(spotify-auth|spotify-api|google-auth|youtube-api)$/, replacement: `${src}/sync/mock/$1.ts` }
          ]
        : []),
      // `vite --mode web`: bản web (PWA) lấy nhạc từ Jamendo thay cho YouTube, xem src/web/.
      ...(mode === 'web' ? [{ find: /^@\/youtube\/(music|stream|http|client)$/, replacement: `${src}/web/$1.ts` }] : []),
      { find: '@', replacement: src }
    ]
  },
  define: {
    __WEB_APP__: JSON.stringify(mode === 'web'),
    __APP_VERSION__: JSON.stringify(`${pkg.version}${process.env.GITHUB_RUN_NUMBER ? ` (build ${process.env.GITHUB_RUN_NUMBER})` : ' (dev)'}`)
  },
  build: {
    target: ['es2022', 'safari15'],
    chunkSizeWarningLimit: 2500
  },
  // Mặc định chỉ mở trên máy này; MELO_LAN=1 để mở cho điện thoại cùng Wi-Fi thử (proxy dev cũng lộ ra mạng LAN).
  server: { host: process.env.MELO_LAN === '1', port: 5173 },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.mjs'],
    passWithNoTests: true
  }
}));
