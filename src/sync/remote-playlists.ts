// Playlist đồng bộ từ tài khoản khác (Spotify, YouTube) → playlist Melo. Dùng chung cho spotify-sync và youtube-sync.
import { db, type PlaylistRow } from '@/lib/db';

export type RemoteSource = 'spotify' | 'youtube';

/** Trường lưu id playlist gốc của từng nguồn. */
const remoteIdOf = (source: RemoteSource, p: PlaylistRow) => (source === 'spotify' ? p.spotifyId : p.ytId);
const withRemoteId = (source: RemoteSource, id: string) => (source === 'spotify' ? { spotifyId: id } : { ytId: id });

export async function remotePlaylistsById(source: RemoteSource): Promise<Map<string, PlaylistRow>> {
  const rows = await db.playlists.filter((p) => p.source === source).toArray();
  return new Map(rows.flatMap((p) => (remoteIdOf(source, p) ? [[remoteIdOf(source, p)!, p] as const] : [])));
}

export interface RemotePlaylist {
  remoteId: string;
  name: string;
  snapshotId?: string;
  image?: string;
  /** undefined: danh sách bài không đổi so với lần trước (chỉ cập nhật tên, ảnh) */
  trackIds?: string[];
  /** số bài không tìm thấy (Spotify → YouTube) */
  unmatched?: number;
}

const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

/** Thêm / cập nhật playlist. Danh sách bài không đổi thì giữ `updatedAt` (thứ tự trong Thư viện không bị xáo). */
export async function writeRemotePlaylists(source: RemoteSource, lists: readonly RemotePlaylist[], existing: Map<string, PlaylistRow>): Promise<void> {
  await db.transaction('rw', db.playlists, async () => {
    const now = Date.now();
    for (const list of lists) {
      const local = existing.get(list.remoteId);
      const name = list.name.slice(0, 100);
      const cover = list.image ?? local?.cover;
      if (!list.trackIds) {
        if (local && (local.name !== name || local.cover !== cover)) await db.playlists.update(local.id!, { name, cover });
        continue;
      }
      const fields = { name, cover, trackIds: list.trackIds, snapshotId: list.snapshotId, unmatched: list.unmatched };
      if (!local) await db.playlists.add({ ...fields, source, ...withRemoteId(source, list.remoteId), createdAt: now, updatedAt: now });
      else await db.playlists.update(local.id!, sameIds(local.trackIds, list.trackIds) ? fields : { ...fields, updatedAt: now });
    }
  });
}

/** Xoá playlist không còn trên tài khoản gốc (`present`), trừ những playlist `keep` trả về true. */
export async function removeMissingPlaylists(
  existing: Map<string, PlaylistRow>,
  present: ReadonlySet<string>,
  keep: (p: PlaylistRow) => boolean = () => false
): Promise<void> {
  const removed = [...existing].filter(([id, p]) => !present.has(id) && !keep(p)).map(([, p]) => p.id!);
  await db.playlists.bulkDelete(removed);
}

/** "Snapshot" cho danh sách không có mã phiên bản (bài đã thích): băm danh sách id theo thứ tự. */
export function listSnapshot(ids: readonly string[]): string {
  let h = 0x811c9dc5;
  for (const id of ids) {
    for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193) >>> 0;
    h = Math.imul(h ^ 0x2c, 0x01000193) >>> 0;
  }
  return `${ids.length}:${h.toString(16)}`;
}
