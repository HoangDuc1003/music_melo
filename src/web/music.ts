// Bản web của src/youtube/music.ts (`vite --mode web`): cùng các hàm, nhạc lấy từ Audius (luôn có, không cần đăng ký)
// và Jamendo (khi người dùng đã nhập Client ID). Trang album/nghệ sĩ/playlist và radio chọn nguồn theo tiền tố id.
import type { AlbumPage, ArtistPage, PlaylistPage, SearchSuggestions, SearchType, Shelf, ShelfItem, Track } from '@/youtube/types';
import * as audius from './audius';
import * as jamendo from './jamendo';
import { alternate, cardItems, trackItems } from './shelves';

const isAudius = (id: string) => id.startsWith(audius.AUDIUS_PREFIX);

/**
 * Hỏi Audius và Jamendo (nếu đã có Client ID) cùng lúc, xen kẽ kết quả. Một nguồn lỗi thì dùng nguồn còn lại;
 * cả hai đều lỗi thì báo lỗi của Audius.
 */
async function fromBoth<T>(fromAudius: () => Promise<T[]>, fromJamendo: () => Promise<T[]>, key: (item: T) => string): Promise<T[]> {
  const useJamendo = Boolean(await jamendo.getJamendoClientId());
  const settled = await Promise.allSettled(useJamendo ? [fromAudius(), fromJamendo()] : [fromAudius()]);
  const lists = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));
  if (!lists.length) throw (settled[0] as PromiseRejectedResult).reason;
  return alternate(lists, key);
}

/** Trang chủ: các hàng của Audius trước, sau đó các hàng của Jamendo (nếu có Client ID). */
export async function getHome(): Promise<Shelf[]> {
  const [fromAudius, fromJamendo] = await Promise.allSettled([audius.getHome(), jamendo.getJamendoClientId().then((id) => (id ? jamendo.getHome() : []))]);
  const shelves = [fromAudius, fromJamendo].flatMap((s) => (s.status === 'fulfilled' ? s.value : []));
  if (!shelves.length && fromAudius.status === 'rejected') throw fromAudius.reason;
  return shelves;
}

const searchTracks = (query: string, limit = 30) =>
  fromBoth(
    () => audius.searchTracks(query, limit),
    () => jamendo.searchTracks(query, limit),
    (t) => t.id
  );

export async function search(query: string, type: SearchType): Promise<ShelfItem[]> {
  if (type === 'song') return trackItems(await searchTracks(query));
  // Hai nguồn đều không có video nhạc.
  if (type === 'video') return [];
  const cards = await fromBoth(
    () => audius.searchCards(type, query),
    () => jamendo.searchCards(type, query),
    (c) => c.id
  );
  return cardItems(cards);
}

export async function getSuggestions(input: string): Promise<SearchSuggestions> {
  const [completions, tracks] = await Promise.all([
    jamendo.getJamendoClientId().then((id) => (id ? jamendo.autocomplete(input) : [])),
    searchTracks(input, 5).catch(() => [])
  ]);
  // Audius không có gợi ý từ khoá: dùng thêm tên các bài tìm được.
  const queries = [...new Set([...completions, ...tracks.map((t) => t.title.toLowerCase())])].slice(0, 6);
  return { queries, items: trackItems(tracks.slice(0, 3)) };
}

export const getAlbum = (id: string): Promise<AlbumPage> => (isAudius(id) ? audius.getAlbum(id) : jamendo.getAlbum(id));
export const getArtist = (id: string): Promise<ArtistPage> => (isAudius(id) ? audius.getArtist(id) : jamendo.getArtist(id));
export const getPlaylist = (id: string): Promise<PlaylistPage> => (isAudius(id) ? audius.getPlaylist(id) : jamendo.getPlaylist(id));

/** Radio từ một bài. File nhạc tự thêm không thuộc nguồn nào nên không có radio. */
export function getUpNext(trackId: string): Promise<Track[]> {
  if (isAudius(trackId)) return audius.getRadio(trackId);
  if (trackId.startsWith(jamendo.JAMENDO_PREFIX)) return jamendo.getRadio(trackId);
  return Promise.resolve([]);
}

/** Lời bài hát chỉ lấy từ LRCLIB (không có YouTube). */
export async function getYouTubeLyrics(): Promise<{ text: string; source?: string } | undefined> {
  return undefined;
}

/** Bản web không mở link YouTube. */
export function parseYouTubeLink(): undefined {
  return undefined;
}
