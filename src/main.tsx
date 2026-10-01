import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { installGlobalErrorLogging, log } from '@/lib/log';
import { initDownloads } from '@/downloads/manager';
import { initPlayer } from '@/player/controller';
import App from './App';
import './styles.css';

installGlobalErrorLogging();
void initPlayer()
  .catch((err) => log.error('player', 'khởi động trình phát lỗi:', err))
  .then(() => initDownloads())
  .catch((err) => log.error('download', 'khởi động phần tải về lỗi:', err));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 10 * 60_000, gcTime: 60 * 60_000, retry: 1, refetchOnWindowFocus: false }
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>
);
