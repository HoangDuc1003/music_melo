import { beforeEach, describe, expect, it, vi } from 'vitest';

// API YouTube giả (dữ liệu thô như Google trả về) qua appFetch; đăng nhập giả qua Keychain giả.
const store = vi.hoisted(() => new Map<string, unknown>());
const yt = vi.hoisted(() => ({
  playlists: [] as { id: string; etag: string; snippet: { title: string; thumbnails: object }; contentDetails: { itemCount: number } }[],
  items: new Map<string, { videoId: string; title: string; channel: string; privacy?: string }[]>(),
  liked: [] as { id: string; title: string; channel: string; categoryId: string; duration: string }[],
  calls: [] as string[],
  status: 200
}));
vi.mock('@/lib/secure', () => ({
  secureGet: async (key: string) => store.get(key),
  secureSet: async (key: string, value: unknown) => void store.set(key, structuredClone(value)),
  secureRemove: async (key: string) => void store.delete(key)
}));
vi.mock('@/lib/async', async (original) => ({ ...(await original<object>()), sleep: async () => undefined }));
vi.mock('@/youtube/http', () => ({
  appFetch: vi.fn(async (input: string) => {
    const url = new URL(input);
    yt.calls.push(`${url.pathname.replace('/youtube/v3', '')}${url.searchParams.get('playlistId') ? `:${url.searchParams.get('playlistId')}` : ''}`);
    const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (url.hostname === 'oauth2.googleapis.com') return ok({});
    if (yt.status !== 200) return new Response(JSON.stringify({ error: { message: 'x', errors: [{ reason: 'quotaExceeded' }] } }), { status: yt.status });
    if (url.pathname.endsWith('/playlists')) {
      // Trả 2 trang để kiểm tra phân trang.
      const page = url.searchParams.get('pageToken') ? 1 : 0;
      return ok({ items: yt.playlists.slice(page, page + 1), nextPageToken: page === 0 && yt.playlists.length > 1 ? 'p2' : undefined });
    }
    if (url.pathname.endsWith('/playlistItems')) {
      const items = yt.items.get(url.searchParams.get('playlistId')!) ?? [];
      return ok({
        items: items.map((i) => ({ snippet: { title: i.title, videoOwnerChannelTitle: i.channel, thumbnails: {} }, contentDetails: { videoId: i.videoId }, status: { privacyStatus: i.privacy ?? 'public' } }))
      });
    }
    if (url.pathname.endsWith('/videos') && url.searchParams.get('myRating') === 'like') {
      return ok({
        items: yt.liked.map((v) => ({ id: v.id, snippet: { title: v.title, channelTitle: v.channel, categoryId: v.categoryId, thumbnails: { high: { url: `https://i/${v.id}`, width: 480 } } }, contentDetails: { duration: v.duration } }))
      });
    }
    if (url.pathname.endsWith('/videos')) return ok({ items: url.searchParams.get('id')!.split(',').map((id) => ({ id, contentDetails: { duration: 'PT3M5S' } })) });
    return new Response('{}', { status: 404 });
  })
}));

import { db } from '@/lib/db';
import { __resetGoogleAuthForTests } from './google-auth';
import { __resetYouTubeSyncForTests, disconnectGoogle, syncYouTube, useYouTubeSync, YT_LIKED_NAME } from './youtube-sync';

const playlist = (id: string, title: string, etag = 'e1') => ({ id, etag, snippet: { title, thumbnails: {} }, contentDetails: { itemCount: 0 } });
const rows = () => db.playlists.filter((p) => p.source === 'youtube').sortBy('name');

beforeEach(async () => {
  store.clear();
  store.set('google.tokens', { accessToken: 'AT', refreshToken: 'RT', expiresAt: Date.now() + 3600_000, email: 'ban@gmail.com' });
  await Promise.all([db.playlists.clear(), db.tracks.clear(), db.settings.clear()]);
  __resetGoogleAuthForTests();
  __resetYouTubeSyncForTests();
  useYouTubeSync.setState({ connected: true });
  yt.playlists = [playlist('PL1', 'Nhạc đi tàu'), playlist('PL2', 'Chill')];
  yt.items = new Map([
    ['PL1', [{ videoId: 'aaaaaaaaaaa', title: 'Lạc Trôi', channel: 'Sơn Tùng M-TP - Topic' }, { videoId: 'ddddddddddd', title: 'Deleted video', channel: '' }, { videoId: 'ppppppppppp', title: 'Riêng tư', channel: 'X', privacy: 'private' }]],
    ['PL2', [{ videoId: 'bbbbbbbbbbb', title: 'Chill Lofi', channel: 'Lofi Girl' }]]
  ]);
  yt.liked = [
    { id: 'ccccccccccc', title: 'Bài đã thích', channel: 'Hà Anh - Topic', categoryId: '10', duration: 'PT4M1S' },
    { id: 'vvvvvvvvvvv', title: 'Video hài', channel: 'Kênh hài', categoryId: '23', duration: 'PT10M' }
  ];
  yt.calls = [];
  yt.status = 200;
});

describe('đồng bộ YouTube', () => {
  it('playlist của bạn (mọi trang) + bài đã thích thuộc thể loại Âm nhạc; bỏ video đã xoá/riêng tư', async () => {
    await syncYouTube();
    expect(useYouTubeSync.getState()).toMatchObject({ syncing: false, error: undefined, lastResult: '2 playlist • 1 bài đã thích' });
    expect((await rows()).map((r) => [r.name, r.trackIds])).toEqual([
      ['Chill', ['bbbbbbbbbbb']],
      ['Nhạc đi tàu', ['aaaaaaaaaaa']],
      [YT_LIKED_NAME, ['ccccccccccc']]
    ]);
    expect(await db.tracks.get('aaaaaaaaaaa')).toMatchObject({ title: 'Lạc Trôi', artists: [{ name: 'Sơn Tùng M-TP' }], duration: 185 });
    expect(await db.tracks.get('ccccccccccc')).toMatchObject({ duration: 241, thumbnail: 'https://i/ccccccccccc' });
    expect(await db.tracks.get('vvvvvvvvvvv')).toBeUndefined();
  });

  it('playlist không đổi (etag) thì không đọc lại; đổi tên/xoá trên YouTube thì cập nhật/xoá theo', async () => {
    await syncYouTube();
    yt.calls = [];
    yt.playlists = [{ ...playlist('PL1', 'Nhạc đi tàu Bắc Nam') }];
    await syncYouTube();
    expect(yt.calls.filter((c) => c.startsWith('/playlistItems'))).toEqual([]);
    expect((await rows()).map((r) => r.name)).toEqual(['Nhạc đi tàu Bắc Nam', YT_LIKED_NAME]);

    yt.playlists = [playlist('PL1', 'Nhạc đi tàu Bắc Nam', 'e2')];
    yt.items.set('PL1', [{ videoId: 'eeeeeeeeeee', title: 'Bài mới', channel: 'A' }]);
    await syncYouTube();
    expect((await rows())[0].trackIds).toEqual(['eeeeeeeeeee']);
  });

  it('hết lượt đọc của Google thì báo lỗi dễ hiểu, giữ playlist cũ', async () => {
    await syncYouTube();
    yt.status = 403;
    await syncYouTube();
    expect(useYouTubeSync.getState().error).toMatch(/Hết lượt đọc YouTube/);
    expect(await rows()).toHaveLength(3);
  });

  it('đăng xuất: thu hồi quyền, tuỳ chọn xoá playlist đã đồng bộ', async () => {
    await syncYouTube();
    await disconnectGoogle(true);
    expect(store.has('google.tokens')).toBe(false);
    expect(await rows()).toHaveLength(0);
    expect(useYouTubeSync.getState()).toMatchObject({ connected: false, email: undefined });
  });
});
