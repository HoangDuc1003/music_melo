// Dữ liệu lưu trên máy (IndexedDB qua Dexie): thư viện, playlist, bài đã tải, lịch sử, lời bài hát.
import Dexie, { type EntityTable } from 'dexie';
import type { LyricsLine, Track } from '@/youtube/types';

export interface LikeRow {
  id: string;
  likedAt: number;
}

export interface PlaylistRow {
  id?: number;
  name: string;
  description?: string;
  /** Ảnh bìa tự chọn; mặc định lấy ảnh bài đầu */
  cover?: string;
  /** 'youtube' / 'spotify' = nhập từ tài khoản đó (đồng bộ lại sẽ ghi đè danh sách bài) */
  source: 'local' | 'youtube' | 'spotify';
  /** id playlist gốc trên YouTube (để nhập lại không bị trùng) */
  ytId?: string;
  /** id playlist gốc trên Spotify ('liked' = Bài hát đã thích, 'export:<tên>' = nhập từ file) */
  spotifyId?: string;
  /** snapshot_id của Spotify: không đổi thì không cần tải lại danh sách bài */
  snapshotId?: string;
  /** số bài Spotify không tìm thấy trên YouTube Music */
  unmatched?: number;
  trackIds: string[];
  createdAt: number;
  updatedAt: number;
}

export type DownloadStatus = 'queued' | 'downloading' | 'done' | 'error';

export interface DownloadRow {
  id: string;
  status: DownloadStatus;
  /** byte đã tải */
  bytes: number;
  /** tổng byte, 0 nếu chưa biết */
  total: number;
  error?: string;
  createdAt: number;
  completedAt?: number;
}

/** Chỉ dùng khi chạy thử trên trình duyệt: file nhạc lưu dạng Blob. */
export interface BlobRow {
  id: string;
  audio: Blob;
  artwork?: Blob;
}

export interface HistoryRow {
  key?: number;
  trackId: string;
  playedAt: number;
}

export interface SearchRow {
  query: string;
  at: number;
}

export interface LyricsRow {
  id: string;
  plain: string;
  synced?: LyricsLine[];
  source?: string;
  fetchedAt: number;
}

/** Kết quả ghép một bài Spotify với YouTube Music (không có `videoId` = chưa tìm thấy, thử lại sau). */
export interface SpotifyMatchRow {
  /** id bài trên Spotify, hoặc "tên|nghệ sĩ" khi nhập từ file không có id */
  id: string;
  videoId?: string;
  checkedAt: number;
}

export interface SettingRow {
  key: string;
  value: unknown;
}

export class MeloDB extends Dexie {
  tracks!: EntityTable<Track, 'id'>;
  likes!: EntityTable<LikeRow, 'id'>;
  playlists!: EntityTable<PlaylistRow, 'id'>;
  downloads!: EntityTable<DownloadRow, 'id'>;
  blobs!: EntityTable<BlobRow, 'id'>;
  history!: EntityTable<HistoryRow, 'key'>;
  searches!: EntityTable<SearchRow, 'query'>;
  lyrics!: EntityTable<LyricsRow, 'id'>;
  settings!: EntityTable<SettingRow, 'key'>;
  spotifyMatches!: EntityTable<SpotifyMatchRow, 'id'>;

  constructor() {
    super('melo');
    this.version(1).stores({
      tracks: 'id',
      likes: 'id, likedAt',
      playlists: '++id, name, updatedAt, ytId',
      downloads: 'id, status, createdAt, completedAt',
      blobs: 'id',
      history: '++key, trackId, playedAt',
      searches: 'query, at',
      lyrics: 'id',
      settings: 'key'
    });
    // v2: đồng bộ Spotify
    this.version(2).stores({
      playlists: '++id, name, updatedAt, ytId, spotifyId',
      spotifyMatches: 'id, checkedAt'
    });
  }
}

export const db = new MeloDB();

/** Lưu thông tin bài (để thư viện/bài đã tải hiển thị được khi offline). */
export async function rememberTracks(tracks: Track[]) {
  if (!tracks.length) return;
  await db.tracks.bulkPut(tracks);
}

export async function getTracks(ids: string[]): Promise<Track[]> {
  const rows = await db.tracks.bulkGet(ids);
  return rows.filter((t): t is Track => Boolean(t));
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db.settings.get(key);
  return row ? (row.value as T) : fallback;
}

export async function setSetting(key: string, value: unknown) {
  await db.settings.put({ key, value });
}
