// Bản giả của src/sync/spotify-api.ts cho `npm run dev:mock`: thư viện Spotify mẫu lấy từ bài trong dữ liệu mẫu,
// thêm vài bài không có trên "YouTube" mẫu để thấy dòng "chưa có trên YouTube Music".
import { TRACKS } from '@/youtube/mock/fixtures';
import type { SourceTrack, SpotifyPlaylist, SpotifyUser } from '../spotify-api';

export type { SourceTrack, SpotifyPlaylist, SpotifyUser } from '../spotify-api';
export { SpotifyApiError, toSourceTrack } from '../spotify-api';

const delay = <T>(value: T, ms = 300) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

const source = (i: number): SourceTrack => {
  const t = TRACKS[i % TRACKS.length];
  return { key: `sp-${t.id}`, title: t.title, artists: t.artists.map((a) => a.name), durationMs: t.duration * 1000 };
};
const missing = (title: string): SourceTrack => ({ key: `sp-missing-${title}`, title, artists: ['Nghệ sĩ nước ngoài'], durationMs: 210_000 });

const LISTS: Record<string, SourceTrack[]> = {
  'sp-pl-tau': [4, 22, 3, 14, 0, 6].map(source),
  'sp-pl-chill': [10, 8, 17, 21, 7, 1, 13].map(source).concat(missing('Midnight Drive')),
  'sp-pl-hoc': [12, 19, 11, 16, 2].map(source)
};

export const getMe = (): Promise<SpotifyUser> => delay({ id: 'mock-user', name: 'Bạn (dữ liệu mẫu)' });

export const getPlaylists = (): Promise<SpotifyPlaylist[]> =>
  delay([
    { id: 'sp-pl-tau', name: 'Đi tàu Bắc Nam', snapshotId: 'v1', ownerId: 'mock-user', collaborative: false, total: 6 },
    { id: 'sp-pl-chill', name: 'Chill tối thứ 7', snapshotId: 'v1', ownerId: 'mock-user', collaborative: false, total: 8 },
    { id: 'sp-pl-hoc', name: 'Học bài', snapshotId: 'v1', ownerId: 'mock-user', collaborative: false, total: 5 },
    { id: 'sp-pl-ban', name: 'Playlist của bạn bè', snapshotId: 'v1', ownerId: 'friend', collaborative: false, total: 20 }
  ]);

export const getPlaylistTracks = (id: string): Promise<SourceTrack[]> => delay(LISTS[id] ?? []);

export const getSavedTracks = (): Promise<SourceTrack[]> => delay([20, 5, 9, 15, 18, 23].map(source).concat(missing('Late Night Jazz')));
