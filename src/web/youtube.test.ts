import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { getCachedAudio, resolveAudio, canDownload } from './stream';
import { getArtist, getHome, getPlaylist, getRadio, searchCards, searchVideos, setYouTubeApiKey } from './youtube';
import { getUpNext, parseYouTubeLink, search } from './music';

vi.mock('@/lib/async', async (original) => ({ ...(await original<object>()), sleep: async () => undefined }));
vi.mock('@/ui/overlays', () => ({ toast: vi.fn() }));

const KEY = `AIza${'x'.repeat(35)}`;
const video = (id: string, extra: { channelId?: string; embeddable?: boolean; views?: number; title?: string } = {}) => ({
  id,
  snippet: {
    title: extra.title ?? `MV ${id} &amp; bạn`,
    channelTitle: 'Sơn Tùng M-TP - Topic',
    channelId: extra.channelId ?? 'UCson',
    thumbnails: { high: { url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, width: 480 } }
  },
  contentDetails: { duration: 'PT4M5S' },
  status: { embeddable: extra.embeddable ?? true, privacyStatus: 'public' },
  statistics: { viewCount: String(extra.views ?? 0) }
});
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const googleError = (status: number, reason: string) => new Response(JSON.stringify({ error: { code: status, message: 'x', errors: [{ reason }] } }), { status });

const fetchMock = vi.fn<typeof fetch>();
const calls = () => fetchMock.mock.calls.map(([url]) => new URL(String(url)));
const route = (handler: (path: string, params: URLSearchParams) => Response) =>
  fetchMock.mockImplementation(async (input) => {
    const url = new URL(String(input));
    if (url.hostname !== 'www.googleapis.com') return ok({ data: [] });
    return handler(url.pathname.replace('/youtube/v3', ''), url.searchParams);
  });

beforeEach(async () => {
  await db.settings.clear();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  await setYouTubeApiKey(KEY);
});
afterEach(() => vi.unstubAllGlobals());

describe('YouTube (bản web)', () => {
  it('tìm bài: 1 lần tìm + 1 lần đọc thời lượng; bỏ video chặn nhúng; tên được giải mã; gửi địa chỉ trang cho khoá giới hạn website', async () => {
    route((path) =>
      path === '/search'
        ? ok({ items: [{ id: { videoId: 'aaaaaaaaaaa' } }, { id: { videoId: 'bbbbbbbbbbb' } }, { id: { videoId: 'ccccccccccc' } }] })
        : ok({ items: [video('ccccccccccc'), video('aaaaaaaaaaa'), video('bbbbbbbbbbb', { embeddable: false })] })
    );
    const tracks = await searchVideos('lạc trôi', true);
    expect(tracks).toEqual([
      {
        id: 'yt-aaaaaaaaaaa',
        title: 'MV aaaaaaaaaaa & bạn',
        artists: [{ id: 'yt-UCson', name: 'Sơn Tùng M-TP' }],
        duration: 245,
        thumbnail: 'https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg',
        isVideo: true
      },
      expect.objectContaining({ id: 'yt-ccccccccccc' })
    ]);
    const [find, details] = calls();
    expect(Object.fromEntries(find.searchParams)).toMatchObject({ key: KEY, q: 'lạc trôi', type: 'video', videoEmbeddable: 'true', videoCategoryId: '10', regionCode: 'VN' });
    expect(details.searchParams.get('id')).toBe('aaaaaaaaaaa,bbbbbbbbbbb,ccccccccccc');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ referrerPolicy: 'strict-origin-when-cross-origin' });
    // Tab Video: mọi thể loại.
    await searchVideos('vlog', false);
    expect(calls()[2].searchParams.has('videoCategoryId')).toBe(false);
  });

  it('lỗi của Google thành câu tiếng Việt; khoá sai / chặn website thì cần cài đặt', async () => {
    fetchMock.mockResolvedValueOnce(googleError(403, 'quotaExceeded'));
    await expect(searchVideos('a', true)).rejects.toMatchObject({ needsSetup: false, message: expect.stringMatching(/Hết lượt dùng YouTube hôm nay/) });
    fetchMock.mockResolvedValueOnce(googleError(400, 'keyInvalid'));
    await expect(searchVideos('a', true)).rejects.toMatchObject({ needsSetup: true, message: expect.stringMatching(/không đúng/) });
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 403, status: 'PERMISSION_DENIED', details: [{ reason: 'API_KEY_HTTP_REFERRER_BLOCKED' }] } }), { status: 403 })
    );
    await expect(searchVideos('a', true)).rejects.toMatchObject({ needsSetup: true, message: expect.stringMatching(/Website restrictions/) });
    fetchMock.mockRejectedValueOnce(new TypeError('Load failed'));
    await expect(searchVideos('a', true)).rejects.toThrow(/Không kết nối được YouTube/);
    await setYouTubeApiKey('');
    await expect(searchVideos('a', true)).rejects.toMatchObject({ needsSetup: true });
  });

  it('trang chủ: nhạc thịnh hành Việt Nam và US-UK (1 đơn vị mỗi hàng)', async () => {
    route((_path, params) => ok({ items: [video(params.get('regionCode') === 'VN' ? 'vnvnvnvnvn1' : 'ususususus1')] }));
    const shelves = await getHome();
    expect(shelves.map((s) => [s.title, s.items.length])).toEqual([
      ['Nhạc thịnh hành trên YouTube', 1],
      ['Thịnh hành US-UK trên YouTube', 1]
    ]);
    expect(calls().every((u) => u.pathname.endsWith('/videos') && u.searchParams.get('chart') === 'mostPopular' && u.searchParams.get('videoCategoryId') === '10')).toBe(true);
  });

  it('kênh: video phổ biến nhất trước, hàng "Video mới nhất" theo thứ tự đăng', async () => {
    route((path) => {
      if (path === '/channels') return ok({ items: [{ id: 'UCson', snippet: { title: 'Sơn Tùng M-TP Official', thumbnails: {} }, contentDetails: { relatedPlaylists: { uploads: 'UUson' } } }] });
      if (path === '/playlistItems') return ok({ items: ['newnewnew01', 'hithithit01'].map((videoId) => ({ contentDetails: { videoId } })) });
      return ok({ items: [video('newnewnew01', { views: 10 }), video('hithithit01', { views: 9_000_000 })] });
    });
    const artist = await getArtist('yt-UCson');
    expect(artist.name).toBe('Sơn Tùng M-TP Official');
    expect(artist.topTracks.map((t) => t.id)).toEqual(['yt-hithithit01', 'yt-newnewnew01']);
    expect(artist.shelves[0].items.map((i) => i.type === 'track' && i.track.id)).toEqual(['yt-newnewnew01', 'yt-hithithit01']);
    expect(calls().find((u) => u.pathname.endsWith('/playlistItems'))?.searchParams.get('playlistId')).toBe('UUson');
  });

  it('playlist: đọc nhiều trang, riêng tư thì báo', async () => {
    route((path, params) => {
      if (path === '/playlists') return ok({ items: [{ id: 'PLx', snippet: { title: 'Top V-Pop', channelTitle: 'Melo', thumbnails: {} } }] });
      if (path === '/playlistItems')
        return params.get('pageToken')
          ? ok({ items: [{ contentDetails: { videoId: 'bbbbbbbbbbb' } }] })
          : ok({ items: [{ contentDetails: { videoId: 'aaaaaaaaaaa' } }], nextPageToken: 'p2' });
      return ok({ items: params.get('id')!.split(',').map((id) => video(id)) });
    });
    const playlist = await getPlaylist('yt-PLx');
    expect(playlist).toMatchObject({ title: 'Top V-Pop', subtitle: 'Playlist của Melo' });
    expect(playlist.tracks.map((t) => t.id)).toEqual(['yt-aaaaaaaaaaa', 'yt-bbbbbbbbbbb']);
    route(() => ok({ items: [] }));
    await expect(getPlaylist('yt-PLgone')).rejects.toThrow(/riêng tư/);
  });

  it('tìm kênh và playlist', async () => {
    route((_path, params) =>
      ok({
        items:
          params.get('type') === 'channel'
            ? [{ id: { channelId: 'UCson' }, snippet: { title: 'Sơn Tùng M-TP - Topic', thumbnails: {} } }]
            : [{ id: { playlistId: 'PLx' }, snippet: { title: 'Nhạc &quot;chill&quot;', channelTitle: 'Melo', thumbnails: {} } }]
      })
    );
    expect(await searchCards('artist', 'sơn tùng')).toEqual([{ kind: 'artist', id: 'yt-UCson', title: 'Sơn Tùng M-TP', subtitle: 'Kênh YouTube', thumbnail: '' }]);
    expect(await searchCards('playlist', 'chill')).toEqual([{ kind: 'playlist', id: 'yt-PLx', title: 'Nhạc "chill"', subtitle: 'Playlist • Melo', thumbnail: '' }]);
  });

  it('radio: bài gốc, xen kẽ video cùng kênh và nhạc thịnh hành, không trùng', async () => {
    route((path, params) => {
      if (path === '/channels') return ok({ items: [{ id: 'UCson', contentDetails: { relatedPlaylists: { uploads: 'UUson' } } }] });
      if (path === '/playlistItems') return ok({ items: ['seedseedsee', 'same1same1s', 'same2same2s'].map((videoId) => ({ contentDetails: { videoId } })) });
      if (params.get('chart')) return ok({ items: [video('hot1hot1hot'), video('same1same1s')] });
      return ok({ items: params.get('id')!.split(',').map((id) => video(id)) });
    });
    expect((await getRadio('yt-seedseedsee')).map((t) => t.id.slice(3))).toEqual(['seedseedsee', 'hot1hot1hot', 'same1same1s', 'same2same2s']);
  });

  it('phát bằng trình phát nhúng (link youtube:), không tải về được', async () => {
    expect(getCachedAudio('yt-aaaaaaaaaaa')).toMatchObject({ url: 'youtube:aaaaaaaaaaa', mimeType: 'video/youtube' });
    expect((await resolveAudio('yt-aaaaaaaaaaa')).url).toBe('youtube:aaaaaaaaaaa');
    await expect(resolveAudio('yt-aaaaaaaaaaa', { download: true })).rejects.toThrow(/trang chuyển đổi/);
    expect(canDownload('yt-aaaaaaaaaaa')).toBe(false);
    expect(canDownload('au-D7KyD')).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('YouTube trong phần gộp nguồn', () => {
  it('tìm bài: YouTube đứng trước, xen kẽ với Audius; YouTube lỗi thì vẫn có kết quả Audius', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.hostname === 'api.audius.co') return ok({ data: [{ id: 'A1', title: 'Audius', user: { id: 'u', name: 'DJ' } }] });
      if (url.pathname.endsWith('/search')) return ok({ items: [{ id: { videoId: 'aaaaaaaaaaa' } }] });
      return ok({ items: [video('aaaaaaaaaaa')] });
    });
    expect((await search('lạc trôi', 'song')).map((i) => i.type === 'track' && i.track.id)).toEqual(['yt-aaaaaaaaaaa', 'au-A1']);
    fetchMock.mockImplementation(async (input) =>
      new URL(String(input)).hostname === 'api.audius.co' ? ok({ data: [{ id: 'A1', title: 'Audius', user: { id: 'u', name: 'DJ' } }] }) : googleError(403, 'quotaExceeded')
    );
    expect((await search('lạc trôi 2', 'song')).map((i) => i.type === 'track' && i.track.id)).toEqual(['au-A1']);
    const { toast } = await import('@/ui/overlays');
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/Hết lượt dùng YouTube/));
  });

  it('dán link: id có tiền tố yt-; chưa có khoá vẫn phát được chính video đó', async () => {
    expect(parseYouTubeLink('https://youtu.be/aaaaaaaaaaa')).toEqual({ videoId: 'yt-aaaaaaaaaaa', playlistId: undefined });
    expect(parseYouTubeLink('https://www.youtube.com/playlist?list=PLabcdefghij')).toEqual({ videoId: undefined, playlistId: 'yt-PLabcdefghij' });
    await setYouTubeApiKey('');
    expect(await getUpNext('yt-aaaaaaaaaaa')).toEqual([expect.objectContaining({ id: 'yt-aaaaaaaaaaa', title: 'Video YouTube', isVideo: true })]);
  });
});
