// Logic hàng chờ phía JS (thuần, không gọi plugin) để test được bằng vitest.
import type { RepeatMode } from 'capacitor-melo-player';
import type { Track } from '@/youtube/types';

/** Nguồn gốc của một bài trong hàng chờ: từ album/playlist đang phát, do người dùng thêm, hay radio tự nối. */
export type EntryOrigin = 'context' | 'queue' | 'radio';

export interface QueueEntry {
  /** khoá duy nhất (một bài có thể xuất hiện nhiều lần) */
  uid: string;
  track: Track;
  origin: EntryOrigin;
}

export interface PlayContext {
  type: 'album' | 'playlist' | 'artist' | 'search' | 'library' | 'radio' | 'other';
  id?: string;
  title: string;
}

let uidCounter = 0;
export function newUid(): string {
  uidCounter += 1;
  return `${Date.now().toString(36)}-${uidCounter.toString(36)}`;
}

export function makeEntries(tracks: Track[], origin: EntryOrigin = 'context'): QueueEntry[] {
  return tracks.map((track) => ({ uid: newUid(), track, origin }));
}

/** Fisher–Yates; bài ở `currentIndex` được đưa lên đầu, phần còn lại xáo trộn. */
export function shuffleKeepingCurrent<T>(items: readonly T[], currentIndex: number, random: () => number = Math.random): T[] {
  const rest = items.filter((_, i) => i !== currentIndex);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  const current = items[currentIndex];
  return current === undefined ? rest : [current, ...rest];
}

/**
 * Vị trí chèn kiểu Spotify:
 * - 'next' (Phát tiếp): ngay sau bài đang phát.
 * - 'queue' (Thêm vào hàng chờ): sau bài đang phát và các bài người dùng đã thêm trước đó,
 *   trước phần còn lại của album/playlist và radio.
 */
export function insertPosition(entries: readonly QueueEntry[], index: number, mode: 'next' | 'queue'): number {
  if (mode === 'next' || index < 0) return Math.max(0, index + 1);
  let i = index + 1;
  while (i < entries.length && entries[i].origin === 'queue') i++;
  return i;
}

/** Các chỉ số cần chuẩn bị link: bài hiện tại và `ahead` bài sau (vòng lại đầu nếu lặp cả danh sách). */
export function upcomingIndices(length: number, index: number, ahead: number, repeat: RepeatMode): number[] {
  if (length === 0 || index < 0) return [];
  const result: number[] = [];
  for (let step = 0; step <= ahead && result.length < length; step++) {
    const i = index + step;
    if (i < length) result.push(i);
    else if (repeat === 'all') result.push(i % length);
    else break;
  }
  return result;
}

/** Còn ít bài phía sau thì nối radio (hàng chờ 1 bài sẽ nối ngay). */
export function shouldAppendRadio(length: number, index: number, repeat: RepeatMode, threshold = 3): boolean {
  if (index < 0 || repeat !== 'off') return false;
  return length - 1 - index <= threshold;
}

/** Bỏ bài đã có trong hàng chờ và bài trùng nhau, tối đa `limit` bài. */
export function freshRadioTracks(candidates: readonly Track[], existing: readonly Track[], limit = 25): Track[] {
  const seen = new Set(existing.map((t) => t.id));
  const result: Track[] = [];
  for (const track of candidates) {
    if (seen.has(track.id)) continue;
    seen.add(track.id);
    result.push(track);
    if (result.length >= limit) break;
  }
  return result;
}

/** Hàng chờ lưu lại để mở app là nghe tiếp. */
export interface QueueSnapshot {
  v: 1;
  entries: QueueEntry[];
  index: number;
  position: number;
  repeat: RepeatMode;
  shuffle: boolean;
  /** thứ tự gốc (uid) trước khi trộn bài */
  originalOrder?: string[];
  context?: PlayContext;
  savedAt: number;
}

const MAX_SNAPSHOT_ENTRIES = 500;

export function serializeSnapshot(snapshot: Omit<QueueSnapshot, 'v' | 'savedAt'>, now = Date.now()): string {
  let { entries, index, originalOrder } = snapshot;
  if (entries.length > MAX_SNAPSHOT_ENTRIES) {
    // Giữ một ít bài trước bài đang phát, còn lại là các bài sau.
    const start = Math.max(0, Math.min(index - 50, entries.length - MAX_SNAPSHOT_ENTRIES));
    entries = entries.slice(start, start + MAX_SNAPSHOT_ENTRIES);
    index -= start;
    const kept = new Set(entries.map((e) => e.uid));
    originalOrder = originalOrder?.filter((uid) => kept.has(uid));
  }
  const value: QueueSnapshot = { ...snapshot, v: 1, entries, index, originalOrder, savedAt: now };
  return JSON.stringify(value);
}

export function parseSnapshot(raw: string | null | undefined): QueueSnapshot | undefined {
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as Partial<QueueSnapshot>;
    if (value?.v !== 1 || !Array.isArray(value.entries) || value.entries.length === 0) return undefined;
    const entries = value.entries.filter(
      (e): e is QueueEntry => Boolean(e && typeof e.uid === 'string' && e.track && typeof e.track.id === 'string')
    );
    if (!entries.length) return undefined;
    const index = Number.isInteger(value.index) ? Math.min(Math.max(value.index!, 0), entries.length - 1) : 0;
    const repeat: RepeatMode = value.repeat === 'all' || value.repeat === 'one' ? value.repeat : 'off';
    const uids = new Set(entries.map((e) => e.uid));
    const originalOrder = Array.isArray(value.originalOrder) ? value.originalOrder.filter((uid) => uids.has(uid)) : undefined;
    return {
      v: 1,
      entries,
      index,
      position: typeof value.position === 'number' && value.position > 0 ? value.position : 0,
      repeat,
      shuffle: Boolean(value.shuffle) && Boolean(originalOrder?.length),
      originalOrder: originalOrder?.length ? originalOrder : undefined,
      context: value.context,
      savedAt: typeof value.savedAt === 'number' ? value.savedAt : 0
    };
  } catch {
    return undefined;
  }
}
