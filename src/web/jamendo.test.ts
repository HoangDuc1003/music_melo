import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { __clearJamendoCacheForTests, getAlbum, getHome, getRadio, searchCards, searchTracks, setJamendoClientId, toTrack } from './jamendo';
import { getCachedAudio, resolveAudio } from './stream';
import { getUpNext } from './music';

const raw = (id: number, extra: object = {}) => ({
  id: String(id),
  name: `Bài ${id}`,
  duration: 200,
  artist_id: '7',
  artist_name: 'Ca sĩ CC',
  album_id: '9',
  album_name: 'Album CC',
  image: `https://usercontent.jamendo.com/?type=album&id=9&width=300`,
  audio: `https://prod-1.storage.jamendo.com/?trackid=${id}&format=mp32`,
  audiodownload: `https://prod-1.storage.jamendo.com/download/track/${id}/mp32/`,
  audiodownload_allowed: true,
  ...extra
});
const ok = (results: unknown[]) => new Response(JSON.stringify({ headers: { status: 'success', code: 0 }, results }), { status: 200 });

const fetchMock = vi.fn<typeof fetch>();
const calls = () => fetchMock.mock.calls.map(([url]) => new URL(String(url)));

beforeEach(async () => {
  await db.settings.clear();
  __clearJamendoCacheForTests();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  await setJamendoClientId('abcd1234');
});
afterEach(() => vi.unstubAllGlobals());

describe('Jamendo', () => {
  it('chưa có Client ID thì báo lỗi hướng dẫn vào Cài đặt, không gọi mạng', async () => {
    await setJamendoClientId('');
    await expect(getAlbum('9')).rejects.toMatchObject({ needsSetup: true, message: expect.stringMatching(/Cài đặt/) });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Client ID sai → lỗi cần cài đặt; mất mạng → lỗi dễ hiểu', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ headers: { status: 'failed', code: 5, error_message: 'Invalid client_id' } }), { status: 200 }));
    await expect(getAlbum('9')).rejects.toMatchObject({ needsSetup: true });
    fetchMock.mockRejectedValueOnce(new TypeError('Load failed'));
    await expect(getAlbum('9')).rejects.toThrow(/Không kết nối được Jamendo/);
  });

  it('chuyển bài Jamendo sang Track và nhớ link phát/tải', () => {
    const track = toTrack(raw(1));
    expect(track).toEqual({
      id: 'jm-1',
      title: 'Bài 1',
      artists: [{ id: '7', name: 'Ca sĩ CC' }],
      album: { id: '9', name: 'Album CC' },
      duration: 200,
      thumbnail: 'https://usercontent.jamendo.com/?type=album&id=9&width=300'
    });
    expect(getCachedAudio('jm-1')?.url).toBe('https://prod-1.storage.jamendo.com/?trackid=1&format=mp32');
  });

  it('trang chủ: các hàng lỗi riêng lẻ bị bỏ qua, hàng rỗng không hiện', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/albums/')) return new Response('{}', { status: 500 });
      if (url.searchParams.get('tags') === 'rock') return ok([]);
      return url.pathname.endsWith('/artists/') ? ok([{ id: '7', name: 'Ca sĩ CC', image: 'https://img/a' }]) : ok([raw(1), raw(2)]);
    });
    const shelves = await getHome(Date.parse('2026-10-02T12:00:00Z'));
    expect(shelves.map((s) => s.title)).toEqual(['Thịnh hành trên Jamendo', 'Mới phát hành trên Jamendo', 'Nghệ sĩ Jamendo được nghe nhiều', 'Acoustic thư giãn', 'Lounge & chill', 'Piano']);
    expect(calls().every((u) => u.searchParams.get('client_id') === 'abcd1234' && u.searchParams.get('format') === 'json')).toBe(true);
    // Mới phát hành: bài ra trong 60 ngày qua.
    expect(calls().find((u) => u.searchParams.has('datebetween'))?.searchParams.get('datebetween')).toBe('2026-08-03_2026-10-02');
  });

  it('album: bài lấy tên/ảnh album và nghệ sĩ từ phần đầu album', async () => {
    fetchMock.mockResolvedValueOnce(
      ok([{ id: '9', name: 'Album CC', artist_id: '7', artist_name: 'Ca sĩ CC', image: 'https://img/9', releasedate: '2024-05-01', tracks: [{ id: '5', name: 'Một', duration: 100, audio: 'https://a/5' }] }])
    );
    const album = await getAlbum('9');
    expect(album).toMatchObject({ title: 'Album CC', subtitle: 'Ca sĩ CC • 2024', thumbnail: 'https://img/9' });
    expect(album.tracks[0]).toMatchObject({ id: 'jm-5', artists: [{ id: '7', name: 'Ca sĩ CC' }], album: { id: '9', name: 'Album CC' }, thumbnail: 'https://img/9' });
  });

  it('tìm kiếm: bài, album, nghệ sĩ, playlist', async () => {
    fetchMock.mockResolvedValue(ok([raw(3)]));
    expect((await searchTracks('chill'))[0]).toMatchObject({ id: 'jm-3' });
    expect(calls().at(-1)?.searchParams.get('search')).toBe('chill');
    fetchMock.mockResolvedValue(ok([{ id: '9', name: 'Album CC', artist_name: 'Ca sĩ CC', image: 'https://img/9' }]));
    expect((await searchCards('album', 'chill'))[0]).toEqual({ kind: 'album', id: '9', title: 'Album CC', subtitle: 'Ca sĩ CC', thumbnail: 'https://img/9' });
    expect(calls().at(-1)?.searchParams.get('namesearch')).toBe('chill');
  });

  it('radio: bài gốc + bài cùng thể loại; file tự thêm thì không có radio', async () => {
    fetchMock.mockResolvedValueOnce(ok([raw(1, { musicinfo: { tags: { genres: ['lounge'] } } })])).mockResolvedValueOnce(ok([raw(1), raw(2), raw(3)]));
    expect((await getRadio('jm-1')).map((t) => t.id)).toEqual(['jm-1', 'jm-2', 'jm-3']);
    expect(calls()[1].searchParams.get('tags')).toBe('lounge');
    expect(await getUpNext('lf-abc')).toEqual([]);
  });

  it('link nhạc: phát dùng link nghe; tải dùng link tải, nghệ sĩ không cho tải thì báo', async () => {
    toTrack(raw(1));
    toTrack(raw(2, { audiodownload_allowed: false }));
    expect((await resolveAudio('jm-1')).url).toContain('trackid=1');
    expect((await resolveAudio('jm-1', { download: true })).url).toContain('/download/track/1/');
    await expect(resolveAudio('jm-2', { download: true })).rejects.toThrow(/không cho tải/);
    await expect(resolveAudio('lf-abc')).rejects.toThrow(/không còn trên máy/);
    // Mở lại app (bộ nhớ trong đã mất): hỏi lại API theo id.
    __clearJamendoCacheForTests();
    fetchMock.mockResolvedValueOnce(ok([raw(1)]));
    expect((await resolveAudio('jm-1')).url).toContain('trackid=1');
    expect(calls()[0].searchParams.get('id')).toBe('1');
  });
});
