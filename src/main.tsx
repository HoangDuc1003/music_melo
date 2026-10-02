import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { connectDownloadsToPlayer, initDownloads } from '@/downloads/manager';
import { pruneHistory } from '@/lib/library';
import { installGlobalErrorLogging, log } from '@/lib/log';
import { initNetwork } from '@/lib/network';
import { initPlayer } from '@/player/controller';
import { registerServiceWorker, requestPersistentStorage } from '@/web/pwa';
import { preloadYouTube } from '@/youtube/client';
import App from './App';
import './styles.css';

/** Một bước khởi động: lỗi thì ghi nhật ký, các bước sau vẫn chạy. */
const step = (tag: string, fn: () => unknown) => Promise.resolve().then(fn).catch((err) => log.error(tag, 'khởi động lỗi:', err));

installGlobalErrorLogging();
// Bài đã tải phát từ file ngay cả trong hàng chờ khôi phục lúc mở app → nối trước khi khởi động trình phát.
connectDownloadsToPlayer();
const ready = step('network', initNetwork)
  .then(() => step('player', initPlayer))
  .then(() => step('download', initDownloads));
void step('library', pruneHistory);
if (__WEB_APP__) {
  // Bản web: lưu giao diện để mở được khi offline, xin giữ nhạc đã tải lâu dài.
  void step('pwa', registerServiceWorker);
  void step('pwa', requestPersistentStorage);
} else {
  // Đồng bộ tài khoản nạp riêng (không làm nặng lúc mở app), chạy sau khi phần phát/tải đã sẵn sàng.
  void ready.then(() => step('spotify', () => import('@/sync/spotify-sync').then((m) => m.initSpotify())));
  void ready.then(() => step('youtube', () => import('@/sync/youtube-sync').then((m) => m.initYouTubeSync())));
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 10 * 60_000, gcTime: 60 * 60_000, retry: 1, refetchOnWindowFocus: false }
  }
});

// Giao diện hiện trước, youtubei.js nạp ngay sau đó.
requestAnimationFrame(() => setTimeout(preloadYouTube, 0));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>
);
