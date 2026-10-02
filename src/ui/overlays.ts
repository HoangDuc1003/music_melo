// Các lớp phủ dùng chung: trình phát toàn màn hình, hàng chờ, lời bài hát, menu của bài, chọn playlist, thông báo.
import { create } from 'zustand';
import { toggleLike } from '@/lib/library';
import { errorMessage, log } from '@/lib/log';
import type { Track } from '@/youtube/types';

export type PlayerPanel = 'none' | 'queue' | 'lyrics';

export interface TrackMenuTarget {
  track: Track;
  /** vị trí trong hàng chờ (khi mở từ danh sách hàng chờ) */
  queueIndex?: number;
  /** uid của mục trong hàng chờ (tìm lại đúng bài nếu hàng chờ đã đổi) */
  queueUid?: string;
  /** vị trí trong playlist tự tạo (để hiện "Xoá khỏi playlist") */
  playlist?: { id: number; index: number };
}

export interface Toast {
  id: number;
  message: string;
}

interface OverlayState {
  playerOpen: boolean;
  panel: PlayerPanel;
  menu?: TrackMenuTarget;
  /** các bài đang chờ chọn playlist để thêm vào */
  picker?: Track[];
  sleepOpen: boolean;
  toasts: Toast[];
}

export const useOverlays = create<OverlayState>(() => ({
  playerOpen: false,
  panel: 'none',
  sleepOpen: false,
  toasts: []
}));

export const openPlayer = (panel: PlayerPanel = 'none') => useOverlays.setState({ playerOpen: true, panel });
export const closePlayer = () => useOverlays.setState({ playerOpen: false, panel: 'none' });
export const setPanel = (panel: PlayerPanel) => useOverlays.setState({ panel });
export const openTrackMenu = (menu: TrackMenuTarget) => useOverlays.setState({ menu });
export const closeTrackMenu = () => useOverlays.setState({ menu: undefined });
export const openPlaylistPicker = (tracks: Track[]) => useOverlays.setState({ picker: tracks, menu: undefined });
export const closePlaylistPicker = () => useOverlays.setState({ picker: undefined });
export const openSleepTimer = () => useOverlays.setState({ sleepOpen: true });
export const closeSleepTimer = () => useOverlays.setState({ sleepOpen: false });

let toastId = 0;
const TOAST_MS = 2600;

export function toast(message: string) {
  const id = ++toastId;
  useOverlays.setState((s) => ({ toasts: [...s.toasts.slice(-2), { id, message }] }));
  setTimeout(() => useOverlays.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), TOAST_MS);
}

/** Chạy thao tác người dùng bấm: xong thì báo `done`; lỗi thì ghi nhật ký và báo lỗi (không bao giờ im lặng). */
export function runAction(action: () => unknown, done?: string): Promise<void> {
  return Promise.resolve()
    .then(action)
    .then(() => {
      if (done) toast(done);
    })
    .catch((err) => {
      log.error('ui', err);
      toast(errorMessage(err, 'Có lỗi xảy ra'));
    });
}

/** Hỏi lại trước thao tác khó hoàn tác (xoá…), đồng ý thì `runAction`. */
export function confirmAction(question: string, action: () => unknown, done?: string) {
  if (window.confirm(question)) void runAction(action, done);
}

/** Thích / bỏ thích một bài, báo kết quả. */
export function toggleLikeWithToast(track: Track): Promise<void> {
  return runAction(async () => toast((await toggleLike(track)) ? 'Đã thêm vào Bài hát đã thích' : 'Đã bỏ thích'));
}

export function copyText(text: string, done: string, failed = 'Không copy được') {
  navigator.clipboard.writeText(text).then(
    () => toast(done),
    () => toast(failed)
  );
}
