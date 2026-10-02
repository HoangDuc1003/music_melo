// Phần riêng của bản web lúc chạy: service worker (mở app khi không có mạng) và bộ nhớ của trình duyệt.
import { log } from '@/lib/log';

export async function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  await navigator.serviceWorker.register('/sw.js');
}

/** Xin trình duyệt không tự xoá dữ liệu (nhạc đã tải) khi máy thiếu dung lượng. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (await navigator.storage?.persisted?.()) return true;
    const granted = (await navigator.storage?.persist?.()) ?? false;
    if (!granted) log.info('pwa', 'trình duyệt chưa cho lưu dữ liệu lâu dài');
    return granted;
  } catch {
    return false;
  }
}

export interface StorageUsage {
  used: number;
  quota: number;
  persisted: boolean;
}

export async function storageUsage(): Promise<StorageUsage | undefined> {
  try {
    const estimate = await navigator.storage?.estimate?.();
    if (!estimate) return undefined;
    return { used: estimate.usage ?? 0, quota: estimate.quota ?? 0, persisted: Boolean(await navigator.storage.persisted?.()) };
  } catch {
    return undefined;
  }
}
