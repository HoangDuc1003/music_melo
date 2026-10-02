// Bản web của src/youtube/music.ts (`vite --mode web`): cùng các hàm, dữ liệu lấy từ Jamendo.
import type { AlbumPage, ArtistPage, PlaylistPage, SearchSuggestions, SearchType, Shelf, ShelfItem, Track } from '@/youtube/types';
import * as jamendo from './jamendo';

export const getHome = (): Promise<Shelf[]> => jamendo.getHome();

export async function search(query: string, type: SearchType): Promise<ShelfItem[]> {
  if (type === 'song') return (await jamendo.searchTracks(query)).map((track) => ({ type: 'track', track }));
  // Jamendo không có video nhạc.
  if (type === 'video') return [];
  return (await jamendo.searchCards(type, query)).map((card) => ({ type: 'card', card }));
}

export async function getSuggestions(input: string): Promise<SearchSuggestions> {
  const [queries, tracks] = await Promise.all([jamendo.autocomplete(input), jamendo.searchTracks(input, 3).catch(() => [])]);
  return { queries, items: tracks.map((track) => ({ type: 'track', track })) };
}

export const getAlbum = (id: string): Promise<AlbumPage> => jamendo.getAlbum(id);
export const getArtist = (id: string): Promise<ArtistPage> => jamendo.getArtist(id);
export const getPlaylist = (id: string): Promise<PlaylistPage> => jamendo.getPlaylist(id);

/** Radio từ một bài. File nhạc tự thêm không có trên Jamendo nên không có radio. */
export function getUpNext(trackId: string): Promise<Track[]> {
  return trackId.startsWith(jamendo.JAMENDO_PREFIX) ? jamendo.getRadio(trackId) : Promise.resolve([]);
}

/** Lời bài hát chỉ lấy từ LRCLIB (không có YouTube). */
export async function getYouTubeLyrics(): Promise<{ text: string; source?: string } | undefined> {
  return undefined;
}

/** Bản web không mở link YouTube. */
export function parseYouTubeLink(): undefined {
  return undefined;
}
