import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { setJamendoClientId } from './jamendo';
import { getAlbum, getHome, getSuggestions, getUpNext, search } from './music';

vi.mock('@/lib/async', async (original) => ({ ...(await original<object>()), sleep: async () => undefined }));

// Hai nguồn giả: Audius (api.audius.co, {data}) và Jamendo (api.jamendo.com, {headers, results}).
const auTrack = (id: string) => ({ id, title: `Audius ${id}`, duration: 100, release_date: new Date(Date.now() - 86_400_000).toISOString(), user: { id: 'u1', name: 'Ca sĩ Audius' }, is_streamable: true });
const jmTrack = (id: string) => ({ id, name: `Jamendo ${id}`, duration: 100, artist_id: '7', artist_name: 'Ca sĩ CC', audio: `https://a/${id}`, audiodownload_allowed: true });
const audiusOk = (body: unknown) => new Response(JSON.stringify({ data: body }), { status: 200 });
const jamendoOk = (results: unknown[]) => new Response(JSON.stringify({ headers: { status: 'success' }, results }), { status: 200 });

const state = vi.hoisted(() => ({ audiusDown: false, jamendoDown: false }));
const fetchMock = vi.fn<typeof fetch>(async (input) => {
  const url = new URL(String(input));
  if (url.hostname === 'api.audius.co') {
    if (state.audiusDown) throw new TypeError('Load failed');
    if (url.pathname.includes('/playlists/')) return audiusOk(url.pathname.endsWith('/tracks') ? [auTrack('a9')] : [{ id: 'p1', playlist_name: 'Album Audius', is_album: true }]);
    return audiusOk([auTrack('a1'), auTrack('a2'), auTrack('a3')]);
  }
  if (state.jamendoDown) throw new TypeError('Load failed');
  if (url.pathname.endsWith('/autocomplete/')) return jamendoOk([{ tracks: ['mưa rơi'] }]);
  if (url.pathname.endsWith('/albums/tracks/')) return jamendoOk([{ id: '9', name: 'Album Jamendo', tracks: [jmTrack('5')] }]);
  return jamendoOk([jmTrack('1'), jmTrack('2')]);
});
const hosts = () => fetchMock.mock.calls.map(([url]) => new URL(String(url)).hostname);
const ids = (items: { type: string; track?: { id: string }; card?: { id: string } }[]) => items.map((i) => i.track?.id ?? i.card?.id);

beforeEach(async () => {
  await db.settings.clear();
  state.audiusDown = false;
  state.jamendoDown = false;
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('bản web: gộp Audius + Jamendo', () => {
  it('chưa có Client ID Jamendo: chỉ dùng Audius, không gọi Jamendo', async () => {
    expect(ids(await search('mưa', 'song'))).toEqual(['au-a1', 'au-a2', 'au-a3']);
    const home = await getHome();
    expect(home[0].title).toBe('Thịnh hành tuần này');
    expect(home.some((s) => s.title.includes('Jamendo'))).toBe(false);
    expect(hosts().every((h) => h === 'api.audius.co')).toBe(true);
  });

  it('có Client ID: kết quả tìm kiếm xen kẽ hai nguồn; trang chủ có hàng của cả hai', async () => {
    await setJamendoClientId('abcd1234');
    expect(ids(await search('mưa', 'song'))).toEqual(['au-a1', 'jm-1', 'au-a2', 'jm-2', 'au-a3']);
    const titles = (await getHome()).map((s) => s.title);
    expect(titles.indexOf('Thịnh hành tuần này')).toBeLessThan(titles.indexOf('Thịnh hành trên Jamendo'));
    expect(titles).toContain('Mới phát hành');
    expect(titles).toContain('Mới phát hành trên Jamendo');
    expect(new Set(titles).size).toBe(titles.length);
  });

  it('một nguồn lỗi thì dùng nguồn kia; cả hai lỗi thì báo lỗi của Audius', async () => {
    await setJamendoClientId('abcd1234');
    state.audiusDown = true;
    expect(ids(await search('mưa', 'song'))).toEqual(['jm-1', 'jm-2']);
    expect((await getHome()).every((s) => s.title.includes('Jamendo') || ['Acoustic thư giãn', 'Lounge & chill', 'Piano', 'Rock'].includes(s.title))).toBe(true);
    state.jamendoDown = true;
    await expect(search('mưa', 'song')).rejects.toThrow(/Không kết nối được Audius/);
    await setJamendoClientId('');
    await expect(getHome()).rejects.toThrow(/Không kết nối được Audius/);
  });

  it('gợi ý khi gõ: từ khoá Jamendo + tên bài tìm được, 3 bài đầu', async () => {
    await setJamendoClientId('abcd1234');
    const suggestions = await getSuggestions('mưa');
    expect(suggestions.queries).toEqual(['mưa rơi', 'audius a1', 'jamendo 1', 'audius a2', 'jamendo 2', 'audius a3']);
    expect(ids(suggestions.items)).toEqual(['au-a1', 'jm-1', 'au-a2']);
    expect(await search('mưa', 'video')).toEqual([]);
  });

  it('trang album và radio chọn nguồn theo tiền tố id; file tự thêm không có radio', async () => {
    await setJamendoClientId('abcd1234');
    expect((await getAlbum('au-p1')).tracks.map((t) => t.id)).toEqual(['au-a9']);
    expect((await getAlbum('9')).tracks.map((t) => t.id)).toEqual(['jm-5']);
    expect(await getUpNext('lf-abc')).toEqual([]);
  });
});
