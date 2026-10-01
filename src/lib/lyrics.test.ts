import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '@/youtube/types';

const mocks = vi.hoisted(() => ({
  appFetch: vi.fn(),
  getYouTubeLyrics: vi.fn()
}));
vi.mock('@/youtube/http', () => ({ appFetch: mocks.appFetch }));
vi.mock('@/youtube/music', () => ({ getYouTubeLyrics: mocks.getYouTubeLyrics }));

import { db } from './db';
import { activeLineIndex, cleanArtist, cleanTitle, getLyrics, parseLrc } from './lyrics';

const track: Track = { id: 'abc', title: 'Lạc Trôi (Official Music Video)', artists: [{ name: 'Sơn Tùng M-TP' }], duration: 233, thumbnail: '' };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe('cleanTitle / cleanArtist', () => {
  it('bỏ phần thừa trong tên bài YouTube', () => {
    expect(cleanTitle('Lạc Trôi (Official Music Video)')).toBe('Lạc Trôi');
    expect(cleanTitle('Hãy Trao Cho Anh [MV] | Sơn Tùng')).toBe('Hãy Trao Cho Anh');
    expect(cleanTitle('Song ft. Someone')).toBe('Song');
    expect(cleanTitle('Em Của Ngày Hôm Qua (Lyrics Video)')).toBe('Em Của Ngày Hôm Qua');
    expect(cleanTitle('Nơi Này Có Anh')).toBe('Nơi Này Có Anh');
    expect(cleanArtist('Sơn Tùng M-TP - Topic')).toBe('Sơn Tùng M-TP');
  });
});

describe('parseLrc', () => {
  it('đọc mốc thời gian, nhiều mốc trên một dòng, offset', () => {
    const lines = parseLrc('[ar:x]\n[00:12.30]Dòng một\n[00:05.5][01:00.00]Điệp khúc\nkhông có mốc\n[00:20]  Dòng hai  ');
    expect(lines).toEqual([
      { time: 5.5, text: 'Điệp khúc' },
      { time: 12.3, text: 'Dòng một' },
      { time: 20, text: 'Dòng hai' },
      { time: 60, text: 'Điệp khúc' }
    ]);
    expect(parseLrc('[offset:+500]\n[00:10.00]a')[0].time).toBeCloseTo(9.5);
  });

  it('tìm dòng đang hát', () => {
    const lines = parseLrc('[00:05.00]a\n[00:10.00]b\n[00:15.00]c');
    expect(activeLineIndex(lines, 0)).toBe(-1);
    expect(activeLineIndex(lines, 5)).toBe(0);
    expect(activeLineIndex(lines, 12)).toBe(1);
    expect(activeLineIndex(lines, 99)).toBe(2);
    expect(activeLineIndex([], 3)).toBe(-1);
  });
});

describe('getLyrics', () => {
  beforeEach(async () => {
    await db.lyrics.clear();
    mocks.appFetch.mockReset();
    mocks.getYouTubeLyrics.mockReset();
  });

  it('lấy lời chạy theo nhạc từ LRCLIB (tên đã làm sạch) và lưu lại', async () => {
    mocks.appFetch.mockResolvedValueOnce(json(200, { syncedLyrics: '[00:01.00]Xin chào', plainLyrics: 'Xin chào' }));
    const lyrics = await getLyrics(track);
    expect(lyrics).toEqual({ plain: 'Xin chào', synced: [{ time: 1, text: 'Xin chào' }], source: 'LRCLIB' });
    const url = new URL(mocks.appFetch.mock.calls[0][0]);
    expect(url.pathname).toBe('/api/get');
    expect(url.searchParams.get('track_name')).toBe('Lạc Trôi');
    expect(url.searchParams.get('duration')).toBe('233');

    mocks.appFetch.mockClear();
    expect(await getLyrics(track)).toEqual(lyrics);
    expect(mocks.appFetch).not.toHaveBeenCalled();
  });

  it('không khớp chính xác thì tìm kiếm, chọn bản có độ dài gần nhất', async () => {
    mocks.appFetch
      .mockResolvedValueOnce(json(404, {}))
      .mockResolvedValueOnce(
        json(200, [
          { duration: 300, syncedLyrics: '[00:01.00]sai' },
          { duration: 231, plainLyrics: 'chỉ có lời' },
          { duration: 235, syncedLyrics: '[00:02.00]đúng' }
        ])
      );
    const lyrics = await getLyrics(track);
    expect(lyrics?.synced?.[0].text).toBe('đúng');
  });

  it('LRCLIB không có thì dùng lời YouTube Music', async () => {
    mocks.appFetch.mockResolvedValueOnce(json(404, {})).mockResolvedValueOnce(json(200, []));
    mocks.getYouTubeLyrics.mockResolvedValueOnce({ text: 'Lời YT', source: 'Nguồn: Musixmatch' });
    expect(await getLyrics(track)).toEqual({ plain: 'Lời YT', source: 'Nguồn: Musixmatch' });
  });

  it('không có lời: nhớ lại, nhưng lỗi mạng thì lần sau thử lại', async () => {
    mocks.appFetch.mockRejectedValueOnce(new Error('offline'));
    mocks.getYouTubeLyrics.mockResolvedValueOnce(undefined);
    expect(await getLyrics(track)).toBeUndefined();
    expect(await db.lyrics.get('abc')).toBeUndefined();

    mocks.appFetch.mockResolvedValueOnce(json(404, {})).mockResolvedValueOnce(json(200, []));
    mocks.getYouTubeLyrics.mockResolvedValueOnce(undefined);
    expect(await getLyrics(track)).toBeUndefined();
    expect(await db.lyrics.get('abc')).toMatchObject({ plain: '' });
    mocks.appFetch.mockClear();
    expect(await getLyrics(track)).toBeUndefined();
    expect(mocks.appFetch).not.toHaveBeenCalled();
  });
});
