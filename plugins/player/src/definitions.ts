import type { PluginListenerHandle } from '@capacitor/core';

/** Bản web: id phần tử ứng dụng vẽ sẵn để đặt trình phát YouTube nhúng (link "youtube:<id>"). */
export const VIDEO_SLOT_ID = 'melo-video-slot';

export interface PlayerItem {
  /** videoId — dùng để khớp khi cập nhật link */
  id: string;
  /** Link phát (https://… hoặc file://…). Để rỗng nếu chưa có: native sẽ báo `needsUrl`. */
  url: string;
  /** File đã tải/cache (file://…). Native ưu tiên dùng nếu file tồn tại. */
  fileUrl?: string;
  /** Header gửi kèm khi tải link https (ví dụ User-Agent). */
  headers?: Record<string, string>;
  /** Cách native tự xin link mới khi `url` hết lượt (chỉ có với link bị giới hạn ~1 MiB). */
  refresh?: StreamRefresh;
  title: string;
  artist: string;
  album?: string;
  /** Ảnh bìa (https://… hoặc file://…) cho màn hình khoá. */
  artwork?: string;
  /** giây */
  duration?: number;
}

/**
 * Yêu cầu `/player` (InnerTube) mà native gửi lại để lấy link mới của định dạng cùng `itag`, khi link không PO token
 * hết ~1 MiB giữa bài (kể cả lúc tắt màn hình, khi iOS tạm dừng JS). Native chỉ gửi tới máy chủ InnerTube.
 */
export interface StreamRefresh {
  url: string;
  headers: Record<string, string>;
  body: string;
  itag: number;
}

export type RepeatMode = 'off' | 'all' | 'one';

export interface PlayerState {
  index: number;
  id?: string;
  playing: boolean;
  buffering: boolean;
  /** giây */
  position: number;
  /** giây */
  duration: number;
  repeat: RepeatMode;
  queueLength: number;
  /** epoch ms khi hẹn giờ tắt kết thúc */
  sleepTimerEndsAt?: number;
  /** hẹn giờ "hết bài này thì dừng" */
  sleepAtEndOfItem?: boolean;
}

export interface ItemChangedEvent {
  index: number;
  id: string;
}

export type NeedsUrlReason = 'missing' | 'failed';

export interface NeedsUrlEvent {
  index: number;
  id: string;
  reason: NeedsUrlReason;
}

export interface PlayerErrorEvent {
  index: number;
  id: string;
  message: string;
}

export interface SetQueueOptions {
  items: PlayerItem[];
  startIndex: number;
  /** giây */
  startPosition?: number;
  playWhenReady?: boolean;
  /** Nếu bài ở startIndex trùng bài đang phát thì giữ nguyên, không phát lại từ đầu (dùng khi trộn bài). */
  keepCurrent?: boolean;
}

export interface MeloPlayerPlugin {
  setQueue(options: SetQueueOptions): Promise<void>;
  addItems(options: { items: PlayerItem[]; index?: number }): Promise<void>;
  removeItem(options: { index: number }): Promise<void>;
  moveItem(options: { from: number; to: number }): Promise<void>;
  /** Cập nhật link/file cho mọi mục có cùng id. */
  updateItem(options: { id: string; url?: string; fileUrl?: string; headers?: Record<string, string>; refresh?: StreamRefresh }): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seekTo(options: { position: number }): Promise<void>;
  skipTo(options: { index: number }): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  setRepeat(options: { mode: RepeatMode }): Promise<void>;
  /** minutes = 0 để huỷ. endOfItem = true: dừng khi hết bài hiện tại. */
  setSleepTimer(options: { minutes: number; endOfItem?: boolean }): Promise<void>;
  getState(): Promise<PlayerState>;

  /** Keychain iOS cho token đăng nhập (bản web: localStorage, chỉ để chạy thử). */
  keychainGet(options: { key: string }): Promise<{ value: string | null }>;
  keychainSet(options: { key: string; value: string }): Promise<void>;
  keychainRemove(options: { key: string }): Promise<void>;

  /**
   * iPhone: tải file nhạc về `path` (file:// trong thư mục Library của app) theo từng đoạn Range ≤ 1 MiB, bắt đầu từ
   * byte `offset` (mặc định 0 = tải lại từ đầu; > 0 = tải tiếp bằng link mới). Có `refresh` thì link hết lượt giữa
   * chừng được native tự đổi (`rotations` = số lần đổi). Lỗi HTTP: `message` "HTTP <mã>", `data.httpStatus`,
   * `data.bytes` = số byte đã có trong file.
   */
  downloadFile(options: {
    id: string;
    url: string;
    path: string;
    headers?: Record<string, string>;
    offset?: number;
    refresh?: StreamRefresh;
  }): Promise<{ bytes: number; rotations?: number }>;

  addListener(eventName: 'state', listener: (state: PlayerState) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'itemChanged', listener: (event: ItemChangedEvent) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'needsUrl', listener: (event: NeedsUrlEvent) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'error', listener: (event: PlayerErrorEvent) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'queueEnded', listener: () => void): Promise<PluginListenerHandle>;
  /** iPhone: dòng nhật ký của trình phát native (lỗi AVPlayer, lỗi tải đoạn nhạc…) để ghi vào Nhật ký trong app. */
  addListener(eventName: 'log', listener: (event: { message: string }) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'downloadProgress', listener: (event: { id: string; bytes: number; total: number }) => void): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}
