import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAlbum, getArtist, getHome, getRadio, isPlayable, newReleases, searchCards, searchTracks, toTrack, type RawTrack } from './audius';
import { getCachedAudio, resolveAudio } from './stream';

vi.mock('@/lib/async', async (original) => ({ ...(await original<object>()), sleep: vi.fn(async () => undefined) }));

const NOW = Date.parse('2026-10-02T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW - d * 24 * 3600_000).toISOString();
const user = (id: string, extra: object = {}) => ({ id, name: `Ca sĩ ${id}`, handle: id, follower_count: 10, profile_picture: { '480x480': `https://img/u/${id}` }, ...extra });
const raw = (id: string, extra: Partial<RawTrack> = {}): RawTrack => ({
  id,
  title: `Bài ${id}`,
  duration: 180,
  genre: 'Pop',
  release_date: daysAgo(1),
  play_count: 100,
  artwork: { '150x150': `https://img/t/${id}/150`, '480x480': `https://img/t/${id}/480` },
  user: user('u1'),
  is_streamable: true,
  access: { stream: true },
  ...extra
});
const data = (body: unknown, status = 200) => new Response(JSON.stringify({ data: body }), { status });

const fetchMock = vi.fn<typeof fetch>();
const calls = () => fetchMock.mock.calls.map(([url]) => new URL(String(url)));
/** Trả lời theo đường dẫn API (bỏ "/v1"). */
const route = (handler: (path: string, params: URLSearchParams) => Response | Promise<Response>) =>
  fetchMock.mockImplementation(async (input) => {
    const url = new URL(String(input));
    return handler(url.pathname.replace('/v1', ''), url.searchParams);
  });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('Audius', () => {
  it('chuyển bài sang Track; bỏ bài trả phí, bài đã gỡ, bài không nghe được', () => {
    expect(toTrack(raw('D7KyD'))).toEqual({
      id: 'au-D7KyD',
      title: 'Bài D7KyD',
      artists: [{ id: 'au-u1', name: 'Ca sĩ u1' }],
      duration: 180,
      thumbnail: 'https://img/t/D7KyD/480'
    });
    expect(toTrack(raw('x', { artwork: null })).thumbnail).toBe('');
    expect(isPlayable(raw('a'))).toBe(true);
    expect(isPlayable(raw('b', { is_stream_gated: true }))).toBe(false);
    expect(isPlayable(raw('c', { is_streamable: false }))).toBe(false);
    expect(isPlayable(raw('d', { access: { stream: false } }))).toBe(false);
    expect(isPlayable(raw('e', { is_delete: true }))).toBe(false);
  });

  it('mới phát hành: bài 30 ngày qua, mới nhất trước; ít quá thì lấy tới 90 ngày; bỏ bài hẹn giờ phát hành sau', () => {
    const many = Array.from({ length: 9 }, (_, i) => raw(`n${i}`, { release_date: daysAgo(i + 1) }));
    const tracks = newReleases([raw('old', { release_date: daysAgo(60) }), ...many.reverse(), raw('future', { release_date: daysAgo(-3) })], NOW);
    expect(tracks.map((t) => t.id)).toEqual(Array.from({ length: 9 }, (_, i) => `au-n${i}`));
    const few = newReleases([raw('a', { release_date: daysAgo(2) }), raw('b', { release_date: daysAgo(60) }), raw('c', { release_date: daysAgo(200) })], NOW);
    expect(few.map((t) => t.id)).toEqual(['au-a', 'au-b']);
    // Không có ngày phát hành thì dùng ngày đăng.
    expect(newReleases([raw('d', { release_date: null, created_at: daysAgo(3) })], NOW).map((t) => t.id)).toEqual(['au-d']);
  });

  it('trang chủ: thịnh hành, mới phát hành, nghệ sĩ, playlist, thể loại; hàng lỗi bị bỏ; 429 thì đợi rồi thử lại', async () => {
    let throttled = false;
    route((path, params) => {
      if (path === '/playlists/trending') return data([{ id: 'p1', playlist_name: 'Đêm Sài Gòn', is_album: true, user: user('u2'), artwork: null }]);
      if (params.get('genre') === 'Lo-Fi') return new Response('{}', { status: 500 });
      if (params.get('genre') === 'Pop' && !throttled) {
        throttled = true;
        return new Response('{}', { status: 429 });
      }
      return data([raw('t1', { user: user('u1', { follower_count: 5 }) }), raw('t2', { user: user('u2', { follower_count: 50 }) }), raw('gated', { is_stream_gated: true })]);
    });
    const shelves = await getHome(NOW);
    expect(shelves.map((s) => s.title)).toEqual(['Thịnh hành tuần này', 'Mới phát hành', 'Nghệ sĩ đang nổi', 'Playlist thịnh hành', 'Pop', 'Hip-hop & Rap', 'Điện tử', 'R&B']);
    expect(shelves[0].items.map((i) => i.type === 'track' && i.track.id)).toEqual(['au-t1', 'au-t2']);
    expect(shelves[2].items.map((i) => i.type === 'card' && i.card.title)).toEqual(['Ca sĩ u2', 'Ca sĩ u1']);
    expect(shelves[3].items[0]).toEqual({ type: 'card', card: { kind: 'album', id: 'au-p1', title: 'Đêm Sài Gòn', subtitle: 'Ca sĩ u2', thumbnail: '' } });
    expect(calls().every((u) => u.origin === 'https://api.audius.co' && u.searchParams.get('app_name') === 'Melo')).toBe(true);
  });

  it('mất mạng, máy chủ lỗi: báo lỗi tiếng Việt', async () => {
    fetchMock.mockRejectedValue(new TypeError('Load failed'));
    await expect(getHome(NOW)).rejects.toThrow(/Không kết nối được Audius/);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response('{}', { status: 429 }));
    await expect(searchTracks('a')).rejects.toThrow(/đang bận/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('tìm kiếm: bài, nghệ sĩ, album và playlist (album là một loại playlist)', async () => {
    route((path) => {
      if (path === '/tracks/search') return data([raw('t1'), raw('paid', { is_stream_gated: true })]);
      if (path === '/users/search') return data([user('u1'), user('gone', { is_deactivated: true })]);
      return data([
        { id: 'a1', playlist_name: 'Album A', is_album: true, user: user('u1') },
        { id: 'p1', playlist_name: 'Playlist P', is_album: false, user: user('u2') }
      ]);
    });
    expect((await searchTracks('mưa')).map((t) => t.id)).toEqual(['au-t1']);
    expect(calls()[0].searchParams.get('query')).toBe('mưa');
    expect((await searchCards('artist', 'x')).map((c) => c.id)).toEqual(['au-u1']);
    expect(await searchCards('album', 'x')).toEqual([{ kind: 'album', id: 'au-a1', title: 'Album A', subtitle: 'Ca sĩ u1', thumbnail: '' }]);
    expect(await searchCards('playlist', 'x')).toEqual([{ kind: 'playlist', id: 'au-p1', title: 'Playlist P', subtitle: 'Playlist • Ca sĩ u2', thumbnail: '' }]);
  });

  it('album: bài thiếu ảnh dùng ảnh album; không còn trên Audius thì báo', async () => {
    route((path) =>
      path.endsWith('/tracks')
        ? data([raw('t1', { artwork: null }), raw('t2')])
        : data([{ id: 'a1', playlist_name: 'Album A', is_album: true, user: user('u1'), artwork: { '480x480': 'https://img/a1' }, release_date: '2026-09-01T00:00:00Z' }])
    );
    const album = await getAlbum('au-a1');
    expect(album).toMatchObject({ title: 'Album A', subtitle: 'Ca sĩ u1 • 2026', thumbnail: 'https://img/a1', artists: [{ id: 'au-u1', name: 'Ca sĩ u1' }] });
    expect(album.tracks.map((t) => [t.id, t.thumbnail, t.album?.name])).toEqual([
      ['au-t1', 'https://img/a1', 'Album A'],
      ['au-t2', 'https://img/t/t2/480', 'Album A']
    ]);
    expect(calls().map((u) => u.pathname).sort()).toEqual(['/v1/playlists/a1', '/v1/playlists/a1/tracks']);

    fetchMock.mockResolvedValue(new Response('{}', { status: 404 }));
    await expect(getAlbum('au-gone')).rejects.toThrow(/Không tìm thấy trên Audius/);
  });

  it('nghệ sĩ: bài nổi bật theo lượt nghe, mới nhất, album, nghệ sĩ tương tự (hàng lỗi/rỗng bị bỏ)', async () => {
    route((path, params) => {
      if (path === '/users/u1') return data(user('u1'));
      if (path === '/users/u1/tracks' && params.get('sort') === 'plays') return data([raw('few', { play_count: 5 }), raw('hit', { play_count: 9000 })]);
      if (path === '/users/u1/tracks') return data([raw('older', { release_date: daysAgo(30) }), raw('newest', { release_date: daysAgo(1) })]);
      if (path === '/users/u1/related') return data([user('u9')]);
      return new Response('{}', { status: 500 });
    });
    const artist = await getArtist('au-u1');
    expect(artist).toMatchObject({ id: 'au-u1', name: 'Ca sĩ u1', thumbnail: 'https://img/u/u1' });
    expect(artist.topTracks.map((t) => t.id)).toEqual(['au-hit', 'au-few']);
    expect(artist.shelves.map((s) => s.title)).toEqual(['Mới nhất', 'Nghệ sĩ tương tự']);
    expect(artist.shelves[0].items.map((i) => i.type === 'track' && i.track.id)).toEqual(['au-newest', 'au-older']);
  });

  it('radio: bài gốc, bài cùng thể loại, cứ 4 bài xen 1 bài cùng nghệ sĩ, không trùng', async () => {
    route((path) => {
      if (path === '/tracks/seed') return data(raw('seed', { genre: 'Electronic' }));
      if (path === '/tracks/trending') return data(['g1', 'g2', 'seed', 'g3', 'g4', 'g5'].map((id) => raw(id)));
      return data([raw('a1'), raw('g2'), raw('a2')]);
    });
    expect((await getRadio('au-seed')).map((t) => t.id.replace('au-', ''))).toEqual(['seed', 'g1', 'g2', 'g3', 'a1', 'g4', 'g5', 'a2']);
    expect(calls().find((u) => u.pathname === '/v1/tracks/trending')?.searchParams.get('genre')).toBe('Electronic');
  });

  it('link nhạc: nghe và tải đều qua /stream (không hết hạn); tải về không tính lượt nghe', async () => {
    const play = await resolveAudio('au-D7KyD');
    expect(play).toMatchObject({ url: 'https://api.audius.co/v1/tracks/D7KyD/stream?app_name=Melo', mimeType: 'audio/mpeg', client: 'AUDIUS' });
    expect((await resolveAudio('au-D7KyD', { download: true })).url).toBe('https://api.audius.co/v1/tracks/D7KyD/stream?app_name=Melo&skip_play_count=true');
    expect(getCachedAudio('au-D7KyD')?.url).toBe(play.url);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('Audius: giới hạn số lần gọi', () => {
  it('quá 4 lần trong 1,1 giây thì lần sau phải đợi', async () => {
    const { sleep } = await import('@/lib/async');
    const waits: number[] = [];
    vi.mocked(sleep).mockImplementation(async (ms) => void waits.push(ms));
    // Đồng hồ giả ở sau mọi lần gọi đã hẹn của các test trước (sleep giả nên các lần đó không đợi thật).
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 3600_000);
    const { throttle } = await import('./audius');
    for (let i = 0; i < 9; i++) await throttle();
    now.mockRestore();
    expect(waits).toEqual([1100, 1100, 1100, 1100, 2200]);
  });
});
