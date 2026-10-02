import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '@/youtube/types';

const fake = vi.hoisted(() => ({
  playlists: [] as { id: string; name: string; snapshotId: string; ownerId: string; collaborative: boolean; image?: string; total: number }[],
  items: new Map<string, { key: string; title: string; artists: string[]; durationMs: number }[]>(),
  liked: [] as { key: string; title: string; artists: string[]; durationMs: number }[],
  connected: true,
  failMe: undefined as Error | undefined
}));

vi.mock('@/sync/spotify-api', () => ({
  getMe: vi.fn(async () => {
    if (fake.failMe) throw fake.failMe;
    return { id: 'me', name: 'Hoàng' };
  }),
  getPlaylists: vi.fn(async () => fake.playlists),
  getPlaylistTracks: vi.fn(async (id: string) => fake.items.get(id) ?? []),
  getSavedTracks: vi.fn(async () => fake.liked)
}));
vi.mock('@/sync/spotify-auth', () => {
  class SpotifyAuthError extends Error {}
  return {
    SpotifyAuthError,
    isSpotifyConnected: vi.fn(async () => fake.connected),
    disconnectSpotifyAuth: vi.fn(async () => {
      fake.connected = false;
    }),
    listenSpotifyCallbacks: vi.fn(async () => undefined),
    setClientId: vi.fn(async () => undefined),
    startSpotifyLogin: vi.fn(async () => undefined)
  };
});
// YouTube Music giả: tìm thấy mọi bài trừ bài có tên bắt đầu bằng "Hiếm".
vi.mock('@/youtube/music', () => ({
  search: vi.fn(async (q: string) => {
    if (q.startsWith('Hiếm')) return [];
    const title = q.split(' Ca sĩ')[0];
    const track: Track = { id: `yt-${title}`, title, artists: [{ name: 'Ca sĩ' }], duration: 200, thumbnail: '' };
    return [{ type: 'track', track }];
  })
}));

import { db } from '@/lib/db';
import * as api from '@/sync/spotify-api';
import * as auth from '@/sync/spotify-auth';
import { search } from '@/youtube/music';
import {
  __resetSpotifySyncForTests,
  disconnectSpotify,
  importSpotifyExport,
  LIKED_NAME,
  listSnapshot,
  parseSpotifyExport,
  syncSpotify,
  useSpotify
} from './spotify-sync';

const t = (key: string, title = `Bài ${key}`) => ({ key, title, artists: ['Ca sĩ'], durationMs: 200_000 });
const playlist = (id: string, name: string, snapshotId = 's1', ownerId = 'me') => ({ id, name, snapshotId, ownerId, collaborative: false, total: 0 });
const spotifyRows = () => db.playlists.filter((p) => p.source === 'spotify').sortBy('name');

beforeEach(async () => {
  await Promise.all([db.playlists.clear(), db.spotifyMatches.clear(), db.tracks.clear(), db.settings.clear()]);
  fake.playlists = [playlist('p1', 'Đi tàu'), playlist('p2', 'Của bạn bè', 's9', 'friend')];
  fake.items = new Map([
    ['p1', [t('a'), t('b'), t('h', 'Hiếm có')]],
    ['p2', [t('x')]]
  ]);
  fake.liked = [t('b'), t('c')];
  fake.connected = true;
  fake.failMe = undefined;
  vi.clearAllMocks();
  __resetSpotifySyncForTests();
  useSpotify.setState({ connected: true });
});

describe('đồng bộ', () => {
  it('tạo playlist từ Spotify + Bài hát đã thích, bỏ qua playlist của người khác, đếm bài không tìm thấy', async () => {
    await syncSpotify();
    const s = useSpotify.getState();
    expect(s.error).toBeUndefined();
    expect(s.syncing).toBe(false);
    expect(s.user).toBe('Hoàng');
    expect(s.lastResult).toBe('2 playlist • 4 bài • 1 bài chưa có trên YouTube Music • bỏ qua 1 playlist của người khác');

    const rows = await spotifyRows();
    expect(rows.map((r) => [r.name, r.trackIds, r.unmatched])).toEqual([
      [LIKED_NAME, ['yt-Bài b', 'yt-Bài c'], 0],
      ['Đi tàu', ['yt-Bài a', 'yt-Bài b'], 1]
    ]);
    expect(api.getPlaylistTracks).not.toHaveBeenCalledWith('p2');
    // Bài "b" có ở 2 danh sách nhưng chỉ tìm một lần.
    expect(vi.mocked(search).mock.calls.filter(([q]) => q.startsWith('Bài b'))).toHaveLength(1);
  });

  it('playlist không đổi (cùng snapshot, đủ bài) thì không tải lại; đổi tên/xoá trên Spotify thì cập nhật/xoá theo', async () => {
    fake.items.set('p1', [t('a')]);
    fake.playlists.push(playlist('p3', 'Sẽ bị xoá'));
    fake.items.set('p3', [t('d')]);
    await syncSpotify();
    expect((await spotifyRows()).map((r) => r.name)).toEqual([LIKED_NAME, 'Sẽ bị xoá', 'Đi tàu']);

    vi.mocked(api.getPlaylistTracks).mockClear();
    vi.mocked(search).mockClear();
    fake.playlists = [{ ...playlist('p1', 'Đi tàu Bắc Nam'), image: 'https://i.scdn.co/cover' }];
    await syncSpotify();
    expect(api.getPlaylistTracks).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
    const rows = await spotifyRows();
    expect(rows.map((r) => r.name)).toEqual([LIKED_NAME, 'Đi tàu Bắc Nam']);
    expect(rows[1].cover).toBe('https://i.scdn.co/cover');

    // Snapshot đổi → đọc lại danh sách bài.
    fake.playlists = [playlist('p1', 'Đi tàu Bắc Nam', 's2')];
    fake.items.set('p1', [t('a'), t('e')]);
    await syncSpotify();
    expect((await spotifyRows())[1].trackIds).toEqual(['yt-Bài a', 'yt-Bài e']);
  });

  it('Bài hát đã thích: snapshot theo danh sách id', () => {
    expect(listSnapshot([t('a'), t('b')])).toBe(listSnapshot([t('a'), t('b')]));
    expect(listSnapshot([t('a'), t('b')])).not.toBe(listSnapshot([t('b'), t('a')]));
    expect(listSnapshot([t('ab')])).not.toBe(listSnapshot([t('a'), t('b')]));
  });

  it('bấm nhiều lần cùng lúc chỉ chạy một lượt', async () => {
    await Promise.all([syncSpotify(), syncSpotify(), syncSpotify()]);
    expect(api.getMe).toHaveBeenCalledTimes(1);
  });

  it('hết phiên đăng nhập thì báo lỗi và chuyển sang chưa kết nối, không xoá playlist', async () => {
    await syncSpotify();
    fake.failMe = new auth.SpotifyAuthError('Phiên Spotify đã hết hạn, hãy kết nối lại');
    await syncSpotify();
    expect(useSpotify.getState()).toMatchObject({ connected: false, syncing: false, error: 'Phiên Spotify đã hết hạn, hãy kết nối lại' });
    expect(await spotifyRows()).toHaveLength(2);
  });

  it('ngắt kết nối trong lúc đang đồng bộ: lượt đó dừng, không ghi playlist', async () => {
    const syncing = syncSpotify();
    await disconnectSpotify(true);
    await syncing;
    expect(await spotifyRows()).toHaveLength(0);
    expect(useSpotify.getState()).toMatchObject({ connected: false, syncing: false });
    expect(useSpotify.getState().error).toBeUndefined();
  });

  it('ngắt kết nối: tuỳ chọn xoá playlist đã đồng bộ', async () => {
    await syncSpotify();
    await disconnectSpotify(true);
    expect(auth.disconnectSpotifyAuth).toHaveBeenCalled();
    expect(useSpotify.getState()).toMatchObject({ connected: false, user: undefined });
    expect(await spotifyRows()).toHaveLength(0);
  });
});

describe('nhập từ file dữ liệu Spotify', () => {
  const playlistJson = JSON.stringify({
    playlists: [
      {
        name: 'Nhạc đi tàu',
        lastModifiedDate: '2026-01-01',
        items: [
          { track: { trackName: 'Bài 1', artistName: 'Ca sĩ', albumName: 'A', trackUri: 'spotify:track:abc123' }, episode: null },
          { track: null, episode: { episodeName: 'Podcast' } },
          { track: { trackName: 'Hiếm lắm', artistName: 'Ca sĩ', albumName: 'A', trackUri: 'spotify:track:zzz' } }
        ]
      }
    ]
  });
  const libraryJson = JSON.stringify({ tracks: [{ artist: 'Ca sĩ', album: 'A', track: 'Bài 2', uri: 'spotify:track:def456' }], albums: [] });

  it('đọc Playlist1.json và YourLibrary.json', () => {
    expect(parseSpotifyExport(playlistJson)).toEqual([
      {
        spotifyId: 'export:Nhạc đi tàu',
        name: 'Nhạc đi tàu',
        tracks: [
          { key: 'abc123', title: 'Bài 1', artists: ['Ca sĩ'], album: 'A', durationMs: 0 },
          { key: 'zzz', title: 'Hiếm lắm', artists: ['Ca sĩ'], album: 'A', durationMs: 0 }
        ]
      }
    ]);
    expect(parseSpotifyExport(libraryJson)[0]).toMatchObject({ spotifyId: 'export:liked', name: LIKED_NAME });
    expect(() => parseSpotifyExport('không phải json')).toThrow(/JSON/);
  });

  it('nhập thành playlist; đồng bộ API sau đó không xoá playlist nhập từ file', async () => {
    const file = (name: string, text: string) => ({ name, text: async () => text });
    const message = await importSpotifyExport([file('Playlist1.json', playlistJson), file('YourLibrary.json', libraryJson)]);
    expect(message).toBe('Đã nhập 2 playlist • 2 bài • 1 bài chưa có trên YouTube Music');
    await syncSpotify();
    expect((await spotifyRows()).map((r) => r.spotifyId).sort()).toEqual(['export:Nhạc đi tàu', 'export:liked', 'liked', 'p1']);
    await expect(importSpotifyExport([file('rong.json', '{}')])).rejects.toThrow(/Không thấy playlist/);
  });

  it('nhập file đúng lúc đang đồng bộ: hai việc chạy lần lượt, không ghi chồng nhau', async () => {
    const file = { name: 'Playlist1.json', text: async () => playlistJson };
    const [, message] = await Promise.all([syncSpotify(), importSpotifyExport([file])]);
    expect(message).toMatch(/^Đã nhập 1 playlist/);
    expect(useSpotify.getState()).toMatchObject({ syncing: false, error: undefined });
    expect((await spotifyRows()).map((r) => r.spotifyId).sort()).toEqual(['export:Nhạc đi tàu', 'liked', 'p1']);
  });
});
