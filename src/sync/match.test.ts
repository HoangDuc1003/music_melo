import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '@/youtube/types';

const yt = vi.hoisted(() => ({ search: vi.fn() }));
vi.mock('@/youtube/music', () => ({ search: yt.search }));

import { db } from '@/lib/db';
import type { SourceTrack } from './spotify-api';
import { cleanSpotifyTitle, findOnYouTube, fold, matchTracks, pickBest, similarity } from './match';

const yTrack = (id: string, title: string, artist: string, duration = 200, isVideo = false): Track => ({
  id,
  title,
  artists: [{ name: artist }],
  duration,
  thumbnail: `https://img/${id}`,
  isVideo
});
const src = (key: string, title: string, artist: string, durationMs = 200_000): SourceTrack => ({ key, title, artists: [artist], durationMs });
const results = (...tracks: Track[]) => tracks.map((track) => ({ type: 'track' as const, track }));

beforeEach(async () => {
  yt.search.mockReset();
  await db.spotifyMatches.clear();
  await db.tracks.clear();
});

describe('so khớp', () => {
  it('bỏ dấu, ký tự đặc biệt', () => {
    expect(fold('Sơn Tùng M-TP')).toBe('son tung m tp');
    expect(fold('Đen Vâu')).toBe('den vau');
  });

  it('bỏ phần phụ trong tên bài Spotify nhưng giữ dấu gạch hợp lệ', () => {
    expect(cleanSpotifyTitle('Shape of You (feat. Someone)')).toBe('Shape of You');
    expect(cleanSpotifyTitle('Yesterday - Remastered 2009')).toBe('Yesterday');
    expect(cleanSpotifyTitle('Hello - Live at Abbey Road')).toBe('Hello');
    expect(cleanSpotifyTitle('Anh - Em')).toBe('Anh - Em');
  });

  it('độ giống nhau', () => {
    expect(similarity('Mưa Tháng Sáu', 'mua thang sau')).toBe(1);
    expect(similarity('Shape of You', 'Ed Sheeran - Shape of You')).toBeGreaterThanOrEqual(0.9);
    expect(similarity('Hello', 'Goodbye')).toBe(0);
  });

  it('chọn đúng bài, bỏ bản cover của người khác và bản lệch quá', () => {
    const s = src('1', 'Lạc Trôi', 'Sơn Tùng M-TP', 233_000);
    const right = yTrack('ok', 'Lạc Trôi', 'Sơn Tùng M-TP', 234);
    const cover = yTrack('cover', 'Lạc Trôi (Cover)', 'Ca sĩ khác', 233);
    const other = yTrack('other', 'Nơi Này Có Anh', 'Sơn Tùng M-TP', 260);
    expect(pickBest(s, [cover, other, right])?.id).toBe('ok');
    expect(pickBest(s, [cover, other])).toBeUndefined();
  });

  it('video "Nghệ sĩ - Tên bài (Official MV)" vẫn khớp', () => {
    const s = src('1', 'Hẹn Em Ở Huế', 'Ban Nhạc Gió', 240_000);
    expect(pickBest(s, [yTrack('mv', 'Ban Nhạc Gió - Hẹn Em Ở Huế (Official MV)', 'BanNhacGio Official', 250, true)])?.id).toBe('mv');
  });

  it('không có trong bài hát thì tìm trong video', async () => {
    yt.search.mockResolvedValueOnce(results(yTrack('x', 'Bài khác', 'Ai đó'))).mockResolvedValueOnce(results(yTrack('mv', 'Biển Xanh (Official MV)', 'Ban Nhạc Gió', 200, true)));
    const found = await findOnYouTube(src('1', 'Biển Xanh', 'Ban Nhạc Gió'));
    expect(found?.id).toBe('mv');
    expect(yt.search.mock.calls).toEqual([
      ['Biển Xanh Ban Nhạc Gió', 'song'],
      ['Biển Xanh Ban Nhạc Gió', 'video']
    ]);
  });
});

describe('ghép nhiều bài', () => {
  it('bỏ trùng, nhớ kết quả (lần sau không tìm lại), nhớ cả bài không tìm thấy', async () => {
    yt.search.mockImplementation(async (q: string) =>
      q.startsWith('Có') ? results(yTrack('v1', 'Có Bài', 'A')) : results(yTrack('z', 'Hoàn toàn khác', 'B'))
    );
    const progress: [number, number][] = [];
    const { matches: map, pending } = await matchTracks([src('s1', 'Có Bài', 'A'), src('s1', 'Có Bài', 'A'), src('s2', 'Không Có', 'C')], {
      onProgress: (d, t) => progress.push([d, t])
    });
    expect([...map]).toEqual([['s1', 'v1']]);
    expect(pending).toBe(0);
    expect(progress.at(-1)).toEqual([2, 2]);
    expect(await db.tracks.get('v1')).toMatchObject({ title: 'Có Bài' });
    expect(await db.spotifyMatches.get('s2')).toMatchObject({ videoId: undefined });

    yt.search.mockClear();
    const again = await matchTracks([src('s1', 'Có Bài', 'A'), src('s2', 'Không Có', 'C')]);
    expect([...again.matches]).toEqual([['s1', 'v1']]);
    expect(yt.search).not.toHaveBeenCalled();
  });

  it('lỗi mạng thì không ghi nhớ là "không tìm thấy"', async () => {
    yt.search.mockRejectedValue(new Error('offline'));
    const { matches } = await matchTracks([src('s3', 'Bài', 'A')]);
    expect(matches.size).toBe(0);
    expect(await db.spotifyMatches.get('s3')).toBeUndefined();
  });

  it('thư viện lớn: mỗi lượt chỉ tìm tối đa `maxSearches` bài, lượt sau tìm tiếp phần còn lại', async () => {
    yt.search.mockImplementation(async (q: string) => results(yTrack(`v-${q.split(' ')[1]}`, q.split(' A')[0], 'A')));
    const many = Array.from({ length: 5 }, (_, i) => src(`k${i}`, `Bài ${i}`, 'A'));
    const first = await matchTracks(many, { maxSearches: 3 });
    expect(first.matches.size).toBe(3);
    expect(first.pending).toBe(2);
    yt.search.mockClear();
    const second = await matchTracks(many, { maxSearches: 3 });
    expect(second.matches.size).toBe(5);
    expect(second.pending).toBe(0);
    expect(yt.search).toHaveBeenCalledTimes(2);
  });

  it('dừng giữa chừng khi bị huỷ', async () => {
    let stop = false;
    yt.search.mockImplementation(async () => {
      stop = true;
      return [];
    });
    const { pending } = await matchTracks(
      Array.from({ length: 6 }, (_, i) => src(`c${i}`, `Bài ${i}`, 'A')),
      { cancelled: () => stop }
    );
    expect(yt.search.mock.calls.length).toBeLessThanOrEqual(2);
    expect(pending).toBeGreaterThanOrEqual(4);
  });
});
