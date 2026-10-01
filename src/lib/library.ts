// Thư viện trên máy: bài đã thích, playlist tự tạo, lịch sử nghe, lịch sử tìm kiếm (IndexedDB qua Dexie).
import { useLiveQuery } from 'dexie-react-hooks';
import type { Track } from '@/youtube/types';
import { db, getTracks, rememberTracks, type PlaylistRow } from './db';

// ---------- Bài đã thích ----------

export async function isLiked(id: string): Promise<boolean> {
  return (await db.likes.get(id)) !== undefined;
}

/** Đổi trạng thái thích; trả về trạng thái mới. */
export async function toggleLike(track: Track): Promise<boolean> {
  return db.transaction('rw', db.likes, db.tracks, async () => {
    if (await db.likes.get(track.id)) {
      await db.likes.delete(track.id);
      return false;
    }
    await db.tracks.put(track);
    await db.likes.put({ id: track.id, likedAt: Date.now() });
    return true;
  });
}

export async function likedTracks(): Promise<Track[]> {
  const rows = await db.likes.orderBy('likedAt').reverse().toArray();
  return getTracks(rows.map((r) => r.id));
}

export function useIsLiked(id: string | undefined): boolean {
  return useLiveQuery(async () => (id ? isLiked(id) : false), [id], false);
}

export function useLikedTracks(): Track[] | undefined {
  return useLiveQuery(likedTracks, []);
}

export function useLikedCount(): number {
  return useLiveQuery(() => db.likes.count(), [], 0);
}

// ---------- Playlist tự tạo ----------

export async function createPlaylist(name: string, tracks: Track[] = []): Promise<number> {
  const now = Date.now();
  const trimmed = name.trim() || 'Playlist mới';
  return db.transaction('rw', db.playlists, db.tracks, async () => {
    await rememberTracks(tracks);
    const id = await db.playlists.add({
      name: trimmed.slice(0, 100),
      source: 'local',
      trackIds: tracks.map((t) => t.id),
      createdAt: now,
      updatedAt: now
    });
    return id as number;
  });
}

/** Thêm bài vào playlist, bỏ qua bài đã có. Trả về số bài thêm mới. */
export async function addToPlaylist(playlistId: number, tracks: Track[]): Promise<number> {
  return db.transaction('rw', db.playlists, db.tracks, async () => {
    const playlist = await db.playlists.get(playlistId);
    if (!playlist) throw new Error('Playlist không còn tồn tại');
    const existing = new Set(playlist.trackIds);
    const fresh = tracks.filter((t) => {
      if (existing.has(t.id)) return false;
      existing.add(t.id);
      return true;
    });
    if (!fresh.length) return 0;
    await rememberTracks(fresh);
    await db.playlists.update(playlistId, {
      trackIds: [...playlist.trackIds, ...fresh.map((t) => t.id)],
      updatedAt: Date.now()
    });
    return fresh.length;
  });
}

export async function removeFromPlaylist(playlistId: number, index: number) {
  await db.transaction('rw', db.playlists, async () => {
    const playlist = await db.playlists.get(playlistId);
    if (!playlist || index < 0 || index >= playlist.trackIds.length) return;
    const trackIds = playlist.trackIds.filter((_, i) => i !== index);
    await db.playlists.update(playlistId, { trackIds, updatedAt: Date.now() });
  });
}

export async function renamePlaylist(playlistId: number, name: string) {
  const trimmed = name.trim();
  if (!trimmed) return;
  await db.playlists.update(playlistId, { name: trimmed.slice(0, 100), updatedAt: Date.now() });
}

export async function deletePlaylist(playlistId: number) {
  await db.playlists.delete(playlistId);
}

/** Playlist mới sửa trước; ảnh bìa mặc định là ảnh bài đầu tiên. */
export async function listPlaylists(): Promise<PlaylistRow[]> {
  const rows = await db.playlists.orderBy('updatedAt').reverse().toArray();
  const firsts = await db.tracks.bulkGet(rows.map((r) => r.trackIds[0] ?? ''));
  return rows.map((row, i) => ({ ...row, cover: row.cover ?? firsts[i]?.thumbnail }));
}

export function usePlaylists(): PlaylistRow[] | undefined {
  return useLiveQuery(listPlaylists, []);
}

export interface PlaylistWithTracks {
  playlist: PlaylistRow;
  tracks: Track[];
}

export async function playlistWithTracks(playlistId: number): Promise<PlaylistWithTracks | undefined> {
  const playlist = await db.playlists.get(playlistId);
  if (!playlist) return undefined;
  const rows = await db.tracks.bulkGet(playlist.trackIds);
  return { playlist, tracks: rows.filter((t): t is Track => Boolean(t)) };
}

/** `null` khi playlist đã bị xoá, `undefined` khi đang tải. */
export function usePlaylist(playlistId: number): PlaylistWithTracks | null | undefined {
  return useLiveQuery(async () => (await playlistWithTracks(playlistId)) ?? null, [playlistId]);
}

// ---------- Lịch sử nghe ----------

/** Các bài nghe gần đây, không trùng, mới nhất trước. */
export async function recentTracks(limit = 50): Promise<Track[]> {
  const ids: string[] = [];
  const seen = new Set<string>();
  await db.history
    .orderBy('playedAt')
    .reverse()
    .until(() => ids.length >= limit)
    .each((row) => {
      if (seen.has(row.trackId)) return;
      seen.add(row.trackId);
      ids.push(row.trackId);
    });
  return getTracks(ids);
}

export function useRecentTracks(limit = 50): Track[] | undefined {
  return useLiveQuery(() => recentTracks(limit), [limit]);
}

export async function clearHistory() {
  await db.history.clear();
}

/** Lịch sử chỉ giữ chừng này lượt nghe mới nhất, để IndexedDB không phình mãi. */
export const MAX_HISTORY = 2000;

/** Gọi khi mở app. Trả về số dòng đã xoá. */
export async function pruneHistory(max = MAX_HISTORY): Promise<number> {
  return db.transaction('rw', db.history, async () => {
    const count = await db.history.count();
    if (count <= max) return 0;
    const old = await db.history.orderBy('playedAt').limit(count - max).primaryKeys();
    await db.history.bulkDelete(old);
    return old.length;
  });
}

// ---------- Lịch sử tìm kiếm ----------

const MAX_SEARCHES = 20;

export async function recordSearch(query: string) {
  const q = query.trim();
  if (!q) return;
  await db.transaction('rw', db.searches, async () => {
    await db.searches.put({ query: q, at: Date.now() });
    const count = await db.searches.count();
    if (count > MAX_SEARCHES) {
      const old = await db.searches.orderBy('at').limit(count - MAX_SEARCHES).primaryKeys();
      await db.searches.bulkDelete(old);
    }
  });
}

export async function removeSearch(query: string) {
  await db.searches.delete(query);
}

export async function clearSearches() {
  await db.searches.clear();
}

export function useRecentSearches(): string[] {
  return useLiveQuery(async () => (await db.searches.orderBy('at').reverse().toArray()).map((r) => r.query), [], []);
}
