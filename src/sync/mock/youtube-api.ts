// Bản giả của src/sync/youtube-api.ts cho `npm run dev:mock`: playlist và bài đã thích lấy từ dữ liệu mẫu.
import { TRACKS } from '@/youtube/mock/fixtures';
import type { Track } from '@/youtube/types';
export { isoDuration, YouTubeApiError, type YouTubePlaylist } from '../youtube-api';

const delay = <T>(value: T, ms = 400) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

const PLAYLISTS = [
  { id: 'PLmock1', title: 'Nhạc chạy bộ', from: 0, count: 8 },
  { id: 'PLmock2', title: 'Ballad buồn', from: 8, count: 6 }
];

export const getMyPlaylists = () =>
  delay(PLAYLISTS.map((p) => ({ id: p.id, title: p.title, etag: 'v1', thumbnail: TRACKS[p.from].thumbnail, itemCount: p.count })));

export function getPlaylistTracks(id: string): Promise<Track[]> {
  const p = PLAYLISTS.find((x) => x.id === id);
  return delay(p ? TRACKS.slice(p.from, p.from + p.count) : []);
}

export const getLikedMusic = (): Promise<Track[]> => delay(TRACKS.slice(14, 20));
