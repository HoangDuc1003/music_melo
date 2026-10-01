// Trạng thái trình phát cho giao diện (Zustand). Chỉ controller.ts được ghi vào store này.
import { create } from 'zustand';
import type { RepeatMode } from 'capacitor-melo-player';
import type { PlayContext, QueueEntry } from './queue';

export interface PlayerStore {
  /** hàng chờ theo thứ tự đang phát (bản sao của hàng chờ native) */
  entries: QueueEntry[];
  index: number;
  playing: boolean;
  buffering: boolean;
  /** giây */
  position: number;
  /** giây */
  duration: number;
  /** thời điểm (ms) nhận `position`, để giao diện tự nội suy thanh tua */
  positionAt: number;
  repeat: RepeatMode;
  shuffle: boolean;
  /** thứ tự gốc (uid) trước khi trộn bài */
  originalOrder?: string[];
  context?: PlayContext;
  /** tự nối radio khi hết hàng chờ */
  autoplay: boolean;
  sleepTimerEndsAt?: number;
  sleepAtEndOfItem?: boolean;
  /** thông báo lỗi gần nhất (giao diện hiện rồi xoá) */
  error?: string;
}

export const initialPlayerState: PlayerStore = {
  entries: [],
  index: -1,
  playing: false,
  buffering: false,
  position: 0,
  duration: 0,
  positionAt: 0,
  repeat: 'off',
  shuffle: false,
  autoplay: true
};

export const usePlayer = create<PlayerStore>(() => ({ ...initialPlayerState }));

export function currentEntry(state: PlayerStore = usePlayer.getState()): QueueEntry | undefined {
  return state.entries[state.index];
}

/** Vị trí hiện tại (giây) có nội suy theo thời gian kể từ lần cập nhật cuối. */
export function livePosition(state: PlayerStore, now = Date.now()): number {
  if (!state.playing || state.buffering) return state.position;
  const elapsed = (now - state.positionAt) / 1000;
  const position = state.position + Math.max(0, elapsed);
  return state.duration > 0 ? Math.min(position, state.duration) : position;
}
