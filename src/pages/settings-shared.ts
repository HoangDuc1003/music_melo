// Phần dùng chung của các mục đồng bộ tài khoản trong Cài đặt (Spotify, Google/YouTube). Chỉ được nạp cùng các mục đó.
import { Browser } from '@capacitor/browser';
import { formatWhen } from '@/lib/format';
import { isNative } from '@/lib/platform';

/** Mở trang ngoài: trên iPhone mở Safari trong app (đóng là về Melo). */
export function openExternal(url: string) {
  if (isNative) void Browser.open({ url });
  else window.open(url, '_blank', 'noopener');
}

export interface SyncStatus {
  syncing: boolean;
  phase?: string;
  done: number;
  total: number;
  lastResult?: string;
  lastSyncAt?: number;
}

/** Dòng phụ dưới "Đồng bộ ngay": tiến độ, kết quả lần trước. */
export function syncDetail(s: SyncStatus): string {
  if (s.syncing) return `${s.phase ?? 'Đang đồng bộ…'}${s.total ? ` ${s.done}/${s.total}` : ''}`;
  if (s.lastResult) return s.lastSyncAt ? `${s.lastResult} • ${formatWhen(s.lastSyncAt)}` : s.lastResult;
  if (s.lastSyncAt) return `Lần cuối ${formatWhen(s.lastSyncAt)}`;
  return 'Chưa đồng bộ lần nào';
}
