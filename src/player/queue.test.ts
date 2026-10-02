import { describe, expect, it } from 'vitest';
import type { Track } from '@/youtube/types';
import {
  freshRadioTracks,
  indexAfterInsert,
  indexAfterMove,
  indexAfterRemove,
  insertIntoOriginalOrder,
  insertPosition,
  makeEntries,
  parseSnapshot,
  serializeSnapshot,
  shouldAppendRadio,
  shuffleKeepingCurrent,
  unshuffle,
  upcomingIndices,
  type QueueEntry
} from './queue';

const track = (id: string): Track => ({ id, title: id, artists: [{ name: 'A' }], duration: 200, thumbnail: '' });
const tracks = (...ids: string[]) => ids.map(track);

describe('shuffleKeepingCurrent', () => {
  it('đưa bài hiện tại lên đầu và giữ đủ các bài', () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f'];
    for (let run = 0; run < 20; run++) {
      const out = shuffleKeepingCurrent(items, 3);
      expect(out[0]).toBe('d');
      expect([...out].sort()).toEqual([...items].sort());
    }
  });

  it('xáo trộn thật sự (random cố định)', () => {
    let seed = 1;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const out = shuffleKeepingCurrent(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], 0, random);
    expect(out[0]).toBe('a');
    expect(out.slice(1)).not.toEqual(['b', 'c', 'd', 'e', 'f', 'g', 'h']);
  });

  it('chỉ số ngoài danh sách thì chỉ xáo trộn', () => {
    expect(shuffleKeepingCurrent(['a'], -1)).toEqual(['a']);
    expect(shuffleKeepingCurrent([], 0)).toEqual([]);
  });
});

describe('insertPosition', () => {
  const entries: QueueEntry[] = [
    ...makeEntries(tracks('a', 'b')),
    ...makeEntries(tracks('q1', 'q2'), 'queue'),
    ...makeEntries(tracks('c')),
    ...makeEntries(tracks('r1', 'r2'), 'radio')
  ];

  it('Phát tiếp: ngay sau bài đang phát', () => {
    expect(insertPosition(entries, 1, 'next')).toBe(2);
    expect(insertPosition([], -1, 'next')).toBe(0);
  });

  it('Thêm vào hàng chờ: sau các bài đã thêm, trước phần còn lại của danh sách', () => {
    expect(insertPosition(entries, 1, 'queue')).toBe(4);
    expect(insertPosition(entries, 0, 'queue')).toBe(1);
    expect(insertPosition(entries, 4, 'queue')).toBe(5);
    expect(insertPosition(entries, 6, 'queue')).toBe(7);
  });

  it('radio: cuối hàng chờ', () => {
    expect(insertPosition(entries, 1, 'radio')).toBe(entries.length);
  });

  it('đang trộn bài: chèn vào thứ tự gốc theo cùng quy tắc', () => {
    const [a, b, c] = makeEntries(tracks('a', 'b', 'c'));
    const [q] = makeEntries(tracks('q'), 'queue');
    const [n] = makeEntries(tracks('n'), 'queue');
    // Hàng chờ đã trộn: c, a, b (đang phát c); thứ tự gốc a, b, c, q (q đã thêm sau c).
    const order = [a.uid, b.uid, c.uid, q.uid];
    const shuffled = [c, a, b, q];
    expect(insertIntoOriginalOrder(order, shuffled, c.uid, [n], 'next')).toEqual([a.uid, b.uid, c.uid, n.uid, q.uid]);
    expect(insertIntoOriginalOrder(order, shuffled, c.uid, [n], 'queue')).toEqual([a.uid, b.uid, c.uid, q.uid, n.uid]);
    expect(insertIntoOriginalOrder(order, shuffled, a.uid, [n], 'radio')).toEqual([...order, n.uid]);
    expect(insertIntoOriginalOrder(order, shuffled, undefined, [n], 'next')).toEqual([...order, n.uid]);
  });
});

describe('chỉ số bài đang phát sau khi đổi hàng chờ', () => {
  it('chèn', () => {
    expect(indexAfterInsert(2, 1, 3)).toBe(5);
    expect(indexAfterInsert(2, 2, 1)).toBe(3);
    expect(indexAfterInsert(2, 3, 1)).toBe(2);
    expect(indexAfterInsert(-1, 0, 2)).toBe(-1);
  });

  it('xoá', () => {
    expect(indexAfterRemove(3, 1, 4)).toBe(2);
    expect(indexAfterRemove(1, 3, 4)).toBe(1);
    expect(indexAfterRemove(2, 2, 4)).toBe(2);
    expect(indexAfterRemove(4, 4, 4)).toBe(3);
  });

  it('kéo thả', () => {
    expect(indexAfterMove(2, 2, 5)).toBe(5);
    expect(indexAfterMove(2, 0, 3)).toBe(1);
    expect(indexAfterMove(2, 4, 1)).toBe(3);
    expect(indexAfterMove(2, 3, 5)).toBe(2);
  });

  it('tắt trộn bài: về thứ tự gốc, bài thiếu trong thứ tự gốc để cuối', () => {
    const [a, b, c, x] = makeEntries(tracks('a', 'b', 'c', 'x'));
    expect(unshuffle([c, x, a, b], [a.uid, b.uid, c.uid])).toEqual([a, b, c, x]);
  });
});

describe('upcomingIndices', () => {
  it('lấy bài hiện tại và các bài sau', () => {
    expect(upcomingIndices(10, 2, 3, 'off')).toEqual([2, 3, 4, 5]);
    expect(upcomingIndices(4, 2, 5, 'off')).toEqual([2, 3]);
    expect(upcomingIndices(4, 2, 5, 'one')).toEqual([2, 3]);
  });

  it('vòng lại đầu khi lặp cả danh sách, không lặp chỉ số', () => {
    expect(upcomingIndices(4, 2, 5, 'all')).toEqual([2, 3, 0, 1]);
    expect(upcomingIndices(5, 3, 2, 'all')).toEqual([3, 4, 0]);
  });

  it('hàng chờ rỗng', () => {
    expect(upcomingIndices(0, 0, 5, 'off')).toEqual([]);
    expect(upcomingIndices(3, -1, 5, 'off')).toEqual([]);
  });
});

describe('shouldAppendRadio', () => {
  it('còn ≤3 bài phía sau thì nối, hàng chờ 1 bài nối ngay', () => {
    expect(shouldAppendRadio(1, 0, 'off')).toBe(true);
    expect(shouldAppendRadio(10, 6, 'off')).toBe(true);
    expect(shouldAppendRadio(10, 5, 'off')).toBe(false);
  });

  it('không nối khi đang lặp hoặc chưa phát', () => {
    expect(shouldAppendRadio(1, 0, 'all')).toBe(false);
    expect(shouldAppendRadio(1, 0, 'one')).toBe(false);
    expect(shouldAppendRadio(0, -1, 'off')).toBe(false);
  });
});

describe('freshRadioTracks', () => {
  it('bỏ bài đã có, bỏ trùng, giới hạn số bài', () => {
    const out = freshRadioTracks(tracks('a', 'x', 'y', 'x', 'z', 'w'), tracks('a', 'b'), 3);
    expect(out.map((t) => t.id)).toEqual(['x', 'y', 'z']);
  });
});

describe('snapshot', () => {
  it('lưu rồi đọc lại được', () => {
    const entries = makeEntries(tracks('a', 'b', 'c'));
    const raw = serializeSnapshot({
      entries,
      index: 1,
      position: 42.5,
      repeat: 'all',
      shuffle: true,
      originalOrder: [entries[2].uid, entries[0].uid, entries[1].uid, 'mất'],
      context: { type: 'album', id: 'MPREb_1', title: 'Album' }
    });
    const snapshot = parseSnapshot(raw)!;
    expect(snapshot.entries.map((e) => e.track.id)).toEqual(['a', 'b', 'c']);
    expect(snapshot.index).toBe(1);
    expect(snapshot.position).toBe(42.5);
    expect(snapshot.repeat).toBe('all');
    expect(snapshot.shuffle).toBe(true);
    expect(snapshot.originalOrder).toEqual([entries[2].uid, entries[0].uid, entries[1].uid]);
    expect(snapshot.context?.title).toBe('Album');
  });

  it('bỏ qua dữ liệu hỏng', () => {
    expect(parseSnapshot(null)).toBeUndefined();
    expect(parseSnapshot('{')).toBeUndefined();
    expect(parseSnapshot('{"v":2,"entries":[]}')).toBeUndefined();
    expect(parseSnapshot('{"v":1,"entries":[{"uid":1}]}')).toBeUndefined();
    const fixed = parseSnapshot(
      JSON.stringify({ v: 1, entries: makeEntries(tracks('a')), index: 9, position: -3, repeat: 'x', shuffle: true })
    )!;
    expect(fixed.index).toBe(0);
    expect(fixed.position).toBe(0);
    expect(fixed.repeat).toBe('off');
    expect(fixed.shuffle).toBe(false);
  });

  it('cắt bớt hàng chờ quá dài quanh bài đang phát', () => {
    const entries = makeEntries(Array.from({ length: 700 }, (_, i) => track(`t${i}`)));
    const snapshot = parseSnapshot(
      serializeSnapshot({ entries, index: 600, position: 0, repeat: 'off', shuffle: false })
    )!;
    expect(snapshot.entries).toHaveLength(500);
    expect(snapshot.entries[snapshot.index].track.id).toBe('t600');
  });
});
