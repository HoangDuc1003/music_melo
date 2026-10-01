// Bản giả của src/youtube/music.ts cho `npm run dev:mock`.
import type { AlbumPage, ArtistPage, PlaylistPage, SearchSuggestions, SearchType, Shelf, ShelfItem, Track } from '../types';
import { album, ALBUM_CARDS, ARTIST_CARDS, artist, HOME, playlist, PLAYLIST_CARDS, TRACKS } from './fixtures';

export { parseYouTubeLink } from '../links';

const delay = <T>(value: T, ms = 350) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));
const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/đ/g, 'd').toLowerCase();

export function getHome(): Promise<Shelf[]> {
  return delay(HOME, 600);
}

export function search(query: string, type: SearchType): Promise<ShelfItem[]> {
  const q = fold(query);
  const match = (text: string) => fold(text).includes(q) || q.length < 2;
  let items: ShelfItem[];
  if (type === 'song' || type === 'video') {
    items = TRACKS.filter((t) => match(t.title) || match(t.artists[0].name)).map((track) => ({
      type: 'track',
      track: type === 'video' ? { ...track, isVideo: true } : track
    }));
  } else {
    const cards = type === 'album' ? ALBUM_CARDS : type === 'artist' ? ARTIST_CARDS : PLAYLIST_CARDS;
    items = cards.filter((c) => match(c.title) || match(c.subtitle)).map((card) => ({ type: 'card', card }));
  }
  return delay(items);
}

export function getSuggestions(input: string): Promise<SearchSuggestions> {
  const q = fold(input);
  const tracks = TRACKS.filter((t) => fold(t.title).includes(q)).slice(0, 3);
  return delay({ queries: tracks.map((t) => t.title.toLowerCase()), items: tracks.map((track) => ({ type: 'track', track })) }, 120);
}

export const getAlbum = (id: string): Promise<AlbumPage> => delay(album(id));
export const getArtist = (id: string): Promise<ArtistPage> => delay(artist(id));
export const getPlaylist = (id: string): Promise<PlaylistPage> => delay(playlist(id));

export function getUpNext(videoId: string): Promise<Track[]> {
  const start = Math.max(0, TRACKS.findIndex((t) => t.id === videoId));
  return delay([...TRACKS.slice(start), ...TRACKS.slice(0, start)].slice(0, 12));
}

export function getYouTubeLyrics(): Promise<{ text: string; source?: string } | undefined> {
  return delay({ text: 'Lời bài hát mẫu\n(không chạy theo nhạc)', source: 'Nguồn: dữ liệu mẫu' });
}
