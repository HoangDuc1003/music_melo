// Phần dùng chung cho các nguồn nhạc của bản web (Audius, Jamendo).
import type { Card, Shelf, ShelfItem, Track } from '@/youtube/types';

export const trackItems = (tracks: Track[]): ShelfItem[] => tracks.map((track) => ({ type: 'track', track }));
export const cardItems = (cards: Card[]): ShelfItem[] => cards.map((card) => ({ type: 'card', card }));

/** Chờ các hàng nhạc: hàng lỗi hoặc rỗng thì bỏ qua; không hàng nào tải được thì báo lỗi đầu tiên. */
export async function settleShelves(shelves: Promise<Shelf>[]): Promise<Shelf[]> {
  const settled = await Promise.allSettled(shelves);
  const ok = settled.flatMap((s) => (s.status === 'fulfilled' && s.value.items.length ? [s.value] : []));
  if (!ok.length) {
    const failed = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected');
    if (failed) throw failed.reason;
  }
  return ok;
}

/** Xen kẽ các danh sách (a1, b1, a2, b2, …), bỏ phần tử trùng `key`. */
export function alternate<T>(lists: readonly (readonly T[])[], key: (item: T) => string): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest; i++) {
    for (const list of lists) {
      const item = list[i];
      if (item === undefined || seen.has(key(item))) continue;
      seen.add(key(item));
      out.push(item);
    }
  }
  return out;
}
