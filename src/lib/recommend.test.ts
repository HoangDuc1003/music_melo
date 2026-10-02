import { beforeEach, describe, expect, it } from 'vitest';
import type { Track } from '@/youtube/types';
import { db } from './db';
import { buildMixes, dayPart, getMix, getMixes, interleave, topArtists, trackScores, playCounts, weekKey, type Radio } from './recommend';

const DAY = 24 * 3600_000;
const NOW = new Date(2026, 9, 7, 8, 30); // thứ Tư, 8:30 sáng
const track = (id: string, artist: string): Track => ({ id, title: `Bài ${id}`, artists: [{ id: `ch-${artist}`, name: artist }], duration: 200, thumbnail: '' });
const plays = (id: string, times: number, at = NOW.getTime() - DAY) => Array.from({ length: times }, (_, i) => ({ trackId: id, playedAt: at - i * 60_000 }));

// Radio giả: mỗi bài gốc gợi ý 3 bài mới r-<gốc>-1..3 + một bài trùng chung "r-chung".
const radio: Radio = async (seed) => [seed, ...[1, 2, 3].map((n) => track(`r-${seed.id}-${n}`, 'Nghệ sĩ mới')), track('r-chung', 'Nghệ sĩ mới')];

const library = {
  a1: track('a1', 'An'),
  a2: track('a2', 'An'),
  a3: track('a3', 'An'),
  b1: track('b1', 'Bình'),
  b2: track('b2', 'Bình'),
  c1: track('c1', 'Chi'),
  c2: track('c2', 'Chi'),
  d1: track('d1', 'Dũng')
};
const tracks = new Map(Object.values(library).map((t) => [t.id, t]));
const history = [...plays('a1', 6), ...plays('a2', 4), ...plays('a3', 2), ...plays('b1', 3), ...plays('b2', 2), ...plays('c1', 2), ...plays('d1', 1)];
const likes = [{ id: 'c2', likedAt: 1 }];

describe('tín hiệu nghe nhạc', () => {
  it('buổi trong ngày, tuần bắt đầu thứ Hai', () => {
    expect(dayPart(new Date(2026, 0, 1, 7))).toBe('morning');
    expect(dayPart(new Date(2026, 0, 1, 12))).toBe('noon');
    expect(dayPart(new Date(2026, 0, 1, 2))).toBe('night');
    expect(weekKey(NOW)).toBe('w2026-10-05');
    expect(weekKey(new Date(2026, 9, 11, 23))).toBe('w2026-10-05'); // Chủ Nhật cùng tuần
    expect(weekKey(new Date(2026, 9, 12))).toBe('w2026-10-12');
  });

  it('nghệ sĩ hay nghe nhất: cộng lượt nghe, bài thích nặng ký hơn', () => {
    const scores = trackScores(playCounts(history), likes);
    expect(scores.get('c2')).toBe(3);
    const top = topArtists(scores, tracks);
    expect(top.map((a) => [a.name, a.score])).toEqual([
      ['An', 12],
      ['Bình', 5],
      ['Chi', 5],
      ['Dũng', 1]
    ]);
    expect(top[0].trackIds).toEqual(['a1', 'a2', 'a3']);
  });

  it('xen bài quen với bài mới, bỏ trùng, giới hạn số bài', () => {
    expect(interleave(['k1', 'k2'], ['f1', 'f2', 'f3', 'k1'])).toEqual(['k1', 'f1', 'f2', 'k2', 'f3']);
    expect(interleave(['k'], ['f1', 'f2', 'f3'], 2, 3)).toEqual(['k', 'f1', 'f2']);
  });
});

describe('tạo mix', () => {
  it('Nghe lại, Daily Mix theo nghệ sĩ, Khám phá (chỉ bài chưa nghe), nhạc theo giờ', async () => {
    const { mixes, found } = await buildMixes({ history, likes, tracks, now: NOW }, radio, new Set(['repeat', 'daily', 'discover', 'daylist']));
    const byId = new Map(mixes.map((m) => [m.id, m]));

    expect(byId.get('repeat')?.trackIds).toEqual(['a1', 'a2', 'b1', 'a3', 'b2', 'c1']);
    expect(byId.get('daily-1')).toMatchObject({ title: 'Daily Mix 1', trackIds: ['a1', 'r-a1-1', 'r-a1-2', 'a2', 'r-a1-3', 'r-chung', 'a3'] });
    expect(byId.get('daily-1')?.subtitle).toBe('An, Nghệ sĩ mới và nhiều nghệ sĩ khác');
    expect([...byId.keys()].filter((id) => id.startsWith('daily-'))).toHaveLength(3); // Dũng chỉ có 1 bài: không đủ làm mix

    const discover = byId.get('discover')!;
    expect(discover.trackIds[0]).toBe('r-chung'); // nhiều bài gốc cùng gợi ý → lên đầu
    expect(discover.trackIds.some((id) => tracks.has(id))).toBe(false); // không có bài đã nghe
    expect(discover.period).toBe('w2026-10-05');

    expect(byId.get('daylist')).toMatchObject({ title: 'Nhạc buổi sáng của bạn', period: '2026-10-07-morning' });
    expect(found.some((t) => t.id === 'r-chung')).toBe(true);
  });

  it('nghe quá ít thì chưa có mix; radio lỗi thì Daily Mix chỉ có bài quen', async () => {
    const few = await buildMixes({ history: plays('a1', 1), likes: [], tracks, now: NOW }, radio, new Set(['repeat', 'daily', 'discover', 'daylist']));
    expect(few.mixes).toEqual([]);
    const offline: Radio = async () => {
      throw new Error('offline');
    };
    const { mixes } = await buildMixes({ history, likes, tracks, now: NOW }, offline, new Set(['daily', 'discover']));
    expect(mixes.find((m) => m.id === 'daily-1')?.trackIds).toEqual(['a1', 'a2', 'a3']);
    expect(mixes.find((m) => m.id === 'discover')).toBeUndefined();
  });
});

describe('lưu mix', () => {
  beforeEach(async () => {
    await Promise.all([db.history.clear(), db.likes.clear(), db.tracks.clear(), db.settings.clear()]);
    await db.tracks.bulkPut(Object.values(library));
    await db.history.bulkAdd(history);
    await db.likes.bulkAdd(likes);
  });

  it('trong cùng ngày dùng lại bản đã lưu; sang buổi khác chỉ tạo lại mix theo giờ', async () => {
    let calls = 0;
    const counting: Radio = async (seed) => {
      calls += 1;
      return radio(seed);
    };
    const first = await getMixes(counting, NOW);
    expect(first.map((m) => m.id)).toEqual(['daylist', 'daily-1', 'daily-2', 'daily-3', 'discover', 'repeat']);
    expect(await db.tracks.get('r-chung')).toBeTruthy(); // bài mới được lưu để mở khi offline
    const afterFirst = calls;

    expect(await getMixes(counting, new Date(NOW.getTime() + 3600_000))).toEqual(first);
    expect(calls).toBe(afterFirst);

    const evening = await getMixes(counting, new Date(2026, 9, 7, 20));
    expect(evening.find((m) => m.kind === 'daylist')).toBeUndefined(); // buổi tối chưa nghe gì
    expect(evening.find((m) => m.id === 'discover')).toEqual(first.find((m) => m.id === 'discover'));
    expect(calls).toBe(afterFirst);
    expect((await getMix('daily-1'))?.title).toBe('Daily Mix 1');
  });
});
