import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { installGlobalErrorLogging, log } from '@/lib/log';
import { initDownloads } from '@/downloads/manager';
import { pruneHistory } from '@/lib/library';
import { initPlayer } from '@/player/controller';
import { preloadYouTube } from '@/youtube/client';
import App from './App';
import './styles.css';

installGlobalErrorLogging();
void initPlayer()
  .catch((err) => log.error('player', 'khởi động trình phát lỗi:', err))
  .then(() => initDownloads())
  .catch((err) => log.error('download', 'khởi động phần tải về lỗi:', err))
  .then(() => pruneHistory())
  .catch((err) => log.warn('library', 'dọn lịch sử lỗi:', err))
  .then(() => import('@/sync/spotify-sync'))
  .then((spotify) => spotify.initSpotify())
  .catch((err) => log.warn('spotify', 'khởi động đồng bộ Spotify lỗi:', err));

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
