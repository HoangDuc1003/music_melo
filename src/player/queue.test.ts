import { describe, expect, it } from 'vitest';
import type { Track } from '@/youtube/types';
import {
  freshRadioTracks,
  insertPosition,
  makeEntries,
  parseSnapshot,
  serializeSnapshot,
  shouldAppendRadio,
  shuffleKeepingCurrent,
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
    ...makeEntries(tracks('a', 'b', 'c')),
    ...makeEntries(tracks('q1'), 'queue'),
    ...makeEntries(tracks('r1', 'r2'), 'radio')
  ];

  it('Phát tiếp: ngay sau bài đang phát', () => {
    expect(insertPosition(entries, 1, 'next')).toBe(2);
    expect(insertPosition([], -1, 'next')).toBe(0);
  });

  it('Thêm vào hàng chờ: trước bài radio', () => {
    expect(insertPosition(entries, 1, 'queue')).toBe(4);
    expect(insertPosition(entries, 5, 'queue')).toBe(6);
    expect(insertPosition(entries.slice(0, 3), 0, 'queue')).toBe(3);
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
