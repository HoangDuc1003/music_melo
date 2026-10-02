import { beforeEach, describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => ({ appFetch: vi.fn() }));
// Không đợi thật khi Spotify bảo thử lại sau: chỉ ghi lại thời gian chờ.
const sleeps = vi.hoisted(() => [] as number[]);
vi.mock('@/lib/async', async (original) => ({ ...(await original<object>()), sleep: async (ms: number) => void sleeps.push(ms) }));
const auth = vi.hoisted(() => ({ getAccessToken: vi.fn(async (force?: boolean) => (force ? 'NEW' : 'OLD')) }));
vi.mock('@/youtube/http', () => ({ appFetch: http.appFetch }));
vi.mock('./spotify-auth', () => auth);

import { getMe, getPlaylists, getPlaylistTracks, getSavedTracks, SpotifyApiError, toSourceTrack } from './spotify-api';

const API = 'https://api.spotify.com/v1';
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const track = (id: string, extra: object = {}) => ({ id, type: 'track', name: `Bài ${id}`, duration_ms: 200_000, artists: [{ name: 'Ca sĩ' }], album: { name: 'Album' }, ...extra });

beforeEach(() => {
  http.appFetch.mockReset();
  auth.getAccessToken.mockClear();
  sleeps.length = 0;
});

describe('gọi API', () => {
  it('gửi token, đọc hồ sơ', async () => {
    http.appFetch.mockResolvedValueOnce(json({ id: 'u1', display_name: 'Hoàng' }));
    expect(await getMe()).toEqual({ id: 'u1', name: 'Hoàng' });
    expect(http.appFetch.mock.calls[0][0]).toBe(`${API}/me`);
    expect((http.appFetch.mock.calls[0][1] as RequestInit).headers).toMatchObject({ authorization: 'Bearer OLD' });
  });

  it('401 thì làm mới token và thử lại một lần', async () => {
    http.appFetch.mockResolvedValueOnce(json({ error: { message: 'expired' } }, 401)).mockResolvedValueOnce(json({ id: 'u1' }));
    expect(await getMe()).toEqual({ id: 'u1', name: 'u1' });
    expect(auth.getAccessToken.mock.calls.map((c) => c[0])).toEqual([false, true]);
    expect((http.appFetch.mock.calls[1][1] as RequestInit).headers).toMatchObject({ authorization: 'Bearer NEW' });
  });

  it('429 thì đợi theo Retry-After rồi thử lại; lỗi khác báo rõ', async () => {
    http.appFetch.mockResolvedValueOnce(json({}, 429, { 'retry-after': '3' })).mockResolvedValueOnce(json({ id: 'u1' }));
    await getMe();
    expect(sleeps).toEqual([3000]);

    http.appFetch.mockResolvedValueOnce(json({ error: { status: 403, message: 'Forbidden' } }, 403));
    const err = await getMe().catch((e) => e);
    expect(err).toBeInstanceOf(SpotifyApiError);
    expect(err).toMatchObject({ status: 403, message: 'Spotify: Forbidden' });
  });
});

describe('phân trang', () => {
  it('đọc hết các trang playlist, lấy tổng số bài ở cả trường mới (items) và cũ (tracks)', async () => {
    http.appFetch
      .mockResolvedValueOnce(
        json({
          items: [{ id: 'p1', name: 'Đi tàu', snapshot_id: 's1', owner: { id: 'u1' }, images: [{ url: 'https://i.scdn.co/a' }], items: { total: 3 } }, null],
          next: `${API}/me/playlists?offset=50&limit=50`
        })
      )
      .mockResolvedValueOnce(json({ items: [{ id: 'p2', name: 'Chung', snapshot_id: 's2', owner: { id: 'u2' }, collaborative: true, tracks: { total: 7 } }], next: null }));
    expect(await getPlaylists()).toEqual([
      { id: 'p1', name: 'Đi tàu', snapshotId: 's1', ownerId: 'u1', collaborative: false, image: 'https://i.scdn.co/a', total: 3 },
      { id: 'p2', name: 'Chung', snapshotId: 's2', ownerId: 'u2', collaborative: true, image: undefined, total: 7 }
    ]);
    expect(http.appFetch.mock.calls[1][0]).toBe(`${API}/me/playlists?offset=50&limit=50`);
  });

  it('bài trong playlist: dùng /items và trường `item` (bản cũ `track`), bỏ podcast/bài trên máy/bài đã gỡ', async () => {
    http.appFetch.mockResolvedValueOnce(
      json({
        items: [{ item: track('t1') }, { track: track('t2') }, { item: { ...track('ep'), type: 'episode' } }, { item: track('local', { is_local: true }) }, { item: null }],
        next: null
      })
    );
    const tracks = await getPlaylistTracks('p 1');
    expect(http.appFetch.mock.calls[0][0]).toBe(`${API}/playlists/p%201/items?limit=50&additional_types=track`);
    expect(tracks.map((t) => t.key)).toEqual(['t1', 't2']);
    expect(tracks[0]).toEqual({ key: 't1', title: 'Bài t1', artists: ['Ca sĩ'], album: 'Album', durationMs: 200_000 });
  });

  it('Bài hát đã thích', async () => {
    http.appFetch.mockResolvedValueOnce(json({ items: [{ track: track('a') }, { track: track('b') }], next: null }));
    expect((await getSavedTracks()).map((t) => t.key)).toEqual(['a', 'b']);
    expect(http.appFetch.mock.calls[0][0]).toBe(`${API}/me/tracks?limit=50`);
  });

  it('không gửi token tới host khác dù link `next` trỏ ra ngoài', async () => {
    http.appFetch.mockResolvedValueOnce(json({ items: [], next: 'https://evil.example/steal' }));
    await expect(getSavedTracks()).rejects.toThrow(/không hợp lệ/);
    expect(http.appFetch).toHaveBeenCalledTimes(1);
  });

  it('toSourceTrack bỏ mục thiếu id/tên', () => {
    expect(toSourceTrack(undefined)).toBeUndefined();
    expect(toSourceTrack({ id: null, name: 'x' })).toBeUndefined();
    expect(toSourceTrack({ id: 'x' })).toBeUndefined();
  });
});
