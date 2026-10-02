// Các phiên InnerTube (youtubei.js) dùng trong app.
// - browse: tìm kiếm, trang chủ, album… (không tải player JS → khởi động nhanh)
// - stream: có player JS để giải mã link nhạc (tham số n / chữ ký)
// - poStream: như stream nhưng kèm PO token (dự phòng khi YouTube đòi)
//
// youtubei.js (~900 KB) được nạp riêng (dynamic import) để giao diện hiện ra ngay khi mở app,
// không phải đợi trình duyệt đọc xong thư viện này.
import type { Innertube } from 'youtubei.js/web';
import { memoAsync } from '@/lib/async';
import { log } from '@/lib/log';
import { appFetch } from './http';

type YouTubeJs = typeof import('youtubei.js/web');

const loadLibrary = memoAsync(async () => {
  const yt: YouTubeJs = await import('youtubei.js/web');
  // youtubei.js không kèm bộ chạy JS để giải mã link; WebView có sẵn nên dùng new Function.
  yt.Platform.shim.eval = async (data) => new Function(data.output)();
  return { yt, options: { lang: 'vi', location: 'VN', fetch: appFetch, cache: new yt.UniversalCache(true) } };
});

/** Bắt đầu nạp youtubei.js sớm (gọi sau khi giao diện đã hiện). */
export function preloadYouTube() {
  void loadLibrary().catch(() => undefined);
}

const poStreams = new Map<string, Promise<Innertube>>();

async function create(label: string, extra: Parameters<typeof Innertube.create>[0]): Promise<Innertube> {
  const started = performance.now();
  const { yt, options } = await loadLibrary();
  return yt.Innertube.create({ ...options, ...extra }).then(
    (yt) => {
      log.info('innertube', `${label} ready in ${Math.round(performance.now() - started)}ms`);
      return yt;
    },
    (err) => {
      log.error('innertube', `${label} failed`, err);
      throw err;
    }
  );
}

export const getBrowseSession = memoAsync(() => create('browse', { retrieve_player: false }));
export const getStreamSession = memoAsync(() => create('stream', { retrieve_player: true }));

/** Phiên có PO token gắn với visitorData (token "GVS" để tải trọn file). */
export function getPoStreamSession(visitorData: string, sessionPoToken: string): Promise<Innertube> {
  const key = `${visitorData}:${sessionPoToken}`;
  let session = poStreams.get(key);
  if (!session) {
    poStreams.clear();
    session = create('poStream', { retrieve_player: true, visitor_data: visitorData, po_token: sessionPoToken }).catch(
      (err) => {
        poStreams.delete(key);
        throw err;
      }
    );
    poStreams.set(key, session);
  }
  return session;
}

