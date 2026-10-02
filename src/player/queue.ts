// Logic hàng chờ phía JS (thuần, không gọi plugin) để test được bằng vitest.
import type { RepeatMode } from 'capacitor-melo-player';
import type { Track } from '@/youtube/types';

/**
 * Nguồn gốc của một bài trong hàng chờ: từ album/playlist đang phát, do người dùng thêm, radio tự nối,
 * hay bài gợi ý của Trộn thông minh (gỡ ra khi tắt trộn).
 */
export type EntryOrigin = 'context' | 'queue' | 'radio' | 'smart';

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
function newUid(): string {
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

export type InsertMode = 'next' | 'queue' | 'radio';

/**
 * Vị trí chèn kiểu Spotify:
 * - 'next' (Phát tiếp): ngay sau bài đang phát.
 * - 'queue' (Thêm vào hàng chờ): sau bài đang phát và các bài người dùng đã thêm trước đó,
 *   trước phần còn lại của album/playlist và radio.
 * - 'radio': cuối hàng chờ.
 */
export function insertPosition(entries: readonly { origin?: EntryOrigin }[], index: number, mode: InsertMode): number {
  if (mode === 'radio') return entries.length;
  if (mode === 'next' || index < 0) return Math.max(0, index + 1);
  let i = index + 1;
  while (i < entries.length && entries[i].origin === 'queue') i++;
  return i;
}

/** Đang trộn bài: chèn bài mới vào thứ tự gốc theo cùng quy tắc, để tắt trộn bài thì bài vẫn ở đúng chỗ. */
export function insertIntoOriginalOrder(
  order: readonly string[],
  entries: readonly QueueEntry[],
  currentUid: string | undefined,
  added: readonly QueueEntry[],
  mode: InsertMode
): string[] {
  const at = currentUid === undefined ? -1 : order.indexOf(currentUid);
  const origin = new Map(entries.map((e) => [e.uid, e.origin]));
  const position = at < 0 ? order.length : insertPosition(order.map((uid) => ({ origin: origin.get(uid) })), at, mode);
  return [...order.slice(0, position), ...added.map((e) => e.uid), ...order.slice(position)];
}

/** Chỉ số bài đang phát sau khi chèn `count` bài vào vị trí `at`. */
export function indexAfterInsert(index: number, at: number, count: number): number {
  return index >= 0 && at <= index ? index + count : index;
}

/** Chỉ số bài đang phát sau khi xoá bài ở `at` (còn lại `length` bài). */
export function indexAfterRemove(index: number, at: number, length: number): number {
  if (at < index) return index - 1;
  if (at === index && index >= length) return length - 1;
  return index;
}

/** Chỉ số bài đang phát sau khi kéo bài từ `from` tới `to`. */
export function indexAfterMove(index: number, from: number, to: number): number {
  if (index === from) return to;
  if (from < index && to >= index) return index - 1;
  if (from > index && to <= index) return index + 1;
  return index;
}

/** Trộn thông minh: chèn một bài gợi ý sau mỗi `every` bài sắp phát (bài đã qua giữ nguyên). */
export function withSmartPicks(entries: readonly QueueEntry[], index: number, picks: readonly QueueEntry[], every = 3): QueueEntry[] {
  const out = entries.slice(0, index + 1);
  let next = 0;
  entries.slice(index + 1).forEach((entry, i) => {
    out.push(entry);
    if ((i + 1) % every === 0 && next < picks.length) out.push(picks[next++]);
  });
  return out;
}

/** Tắt Trộn thông minh: bỏ các bài gợi ý, trừ bài đang phát (`keepUid`). */
export function withoutSmartPicks(entries: readonly QueueEntry[], keepUid?: string): QueueEntry[] {
  return entries.filter((e) => e.origin !== 'smart' || e.uid === keepUid);
}

/** Tắt trộn bài: về thứ tự gốc; bài thêm vào mà thiếu trong thứ tự gốc thì giữ ở cuối. */
export function unshuffle(entries: readonly QueueEntry[], originalOrder: readonly string[]): QueueEntry[] {
  const byUid = new Map(entries.map((e) => [e.uid, e]));
  const known = new Set(originalOrder);
  const ordered = originalOrder.map((uid) => byUid.get(uid)).filter((e): e is QueueEntry => Boolean(e));
  return [...ordered, ...entries.filter((e) => !known.has(e.uid))];
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
  /** Trộn thông minh (có bài gợi ý chèn vào) */
  smartShuffle?: boolean;
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
    const shuffle = Boolean(value.shuffle) && Boolean(originalOrder?.length);
    return {
      v: 1,
      entries,
      index,
      position: typeof value.position === 'number' && value.position > 0 ? value.position : 0,
      repeat,
      shuffle,
      smartShuffle: shuffle && Boolean(value.smartShuffle),
      originalOrder: originalOrder?.length ? originalOrder : undefined,
      context: value.context,
      savedAt: typeof value.savedAt === 'number' ? value.savedAt : 0
    };
  } catch {
    return undefined;
  }
}
