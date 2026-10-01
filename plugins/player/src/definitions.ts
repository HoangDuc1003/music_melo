import type { PluginListenerHandle } from '@capacitor/core';

export interface PlayerItem {
  /** videoId — dùng để khớp khi cập nhật link */
  id: string;
  /** Link phát (https://… hoặc file://…). Để rỗng nếu chưa có: native sẽ báo `needsUrl`. */
  url: string;
  /** File đã tải/cache (file://…). Native ưu tiên dùng nếu file tồn tại. */
  fileUrl?: string;
  /** Header gửi kèm khi tải link https (ví dụ User-Agent). */
  headers?: Record<string, string>;
  title: string;
  artist: string;
  album?: string;
  /** Ảnh bìa (https://… hoặc file://…) cho màn hình khoá. */
  artwork?: string;
  /** giây */
  duration?: number;
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
  updateItem(options: { id: string; url?: string; fileUrl?: string; headers?: Record<string, string> }): Promise<void>;
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

  addListener(eventName: 'state', listener: (state: PlayerState) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'itemChanged', listener: (event: ItemChangedEvent) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'needsUrl', listener: (event: NeedsUrlEvent) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'error', listener: (event: PlayerErrorEvent) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'queueEnded', listener: () => void): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}
