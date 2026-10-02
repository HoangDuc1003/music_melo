// Đồng bộ thư viện Spotify → playlist trong Melo (một chiều, Spotify là gốc).
// - Playlist mình tạo / cùng chỉnh sửa + "Bài hát đã thích" → playlist Melo (nguồn 'spotify').
// - Mỗi bài được ghép với YouTube Music (match.ts); bài không tìm thấy được đếm và thử lại sau.
// - Tự đồng bộ khi mở app nếu lần trước đã quá 12 giờ; có nút "Đồng bộ ngay".
// - Không có Spotify Premium (không tạo được app Spotify): nhập từ file dữ liệu Spotify gửi qua email.
import { App } from '@capacitor/app';
import { create } from 'zustand';
import { Semaphore } from '@/lib/async';
import { db, getSetting, setSetting, type PlaylistRow } from '@/lib/db';
import { errorMessage, log } from '@/lib/log';
import { isOnline } from '@/lib/network';
import { isNative } from '@/lib/platform';
import { fold } from '@/lib/text';
import { getMe, getPlaylists, getPlaylistTracks, getSavedTracks, type SourceTrack } from '@/sync/spotify-api';
import {
  disconnectSpotifyAuth,
  isSpotifyConnected,
  listenSpotifyCallbacks,
  setClientId,
  SpotifyAuthError,
  startSpotifyLogin
} from '@/sync/spotify-auth';
import { matchTracks } from './match';

const LIKED_ID = 'liked';
export const LIKED_NAME = 'Bài hát đã thích trên Spotify';
const EXPORT_PREFIX = 'export:';
const AUTO_SYNC_EVERY_MS = 12 * 3600_000;
/** Mỗi lượt tìm tối đa chừng này bài mới trên YouTube (~2–3 phút); thư viện lớn đồng bộ dần qua vài lượt. */
const MAX_SEARCHES_PER_RUN = 400;
/** Đọc 3 playlist cùng lúc (Spotify trả 429 thì spotify-api tự đợi rồi thử lại). */
const PLAYLIST_READ_PARALLEL = 3;
const LAST_SYNC_SETTING = 'spotifyLastSync';
const AUTO_SYNC_SETTING = 'spotifyAutoSync';
const USER_SETTING = 'spotifyUser';

export interface SpotifyState {
  connected: boolean;
  user?: string;
  syncing: boolean;
  /** đang làm gì (hiện dưới nút đồng bộ) */
  phase?: string;
  done: number;
  total: number;
  lastSyncAt?: number;
  /** tóm tắt lần đồng bộ gần nhất */
  lastResult?: string;
  error?: string;
  autoSync: boolean;
}

const initialState = (): SpotifyState => ({ connected: false, syncing: false, done: 0, total: 0, autoSync: true });
export const useSpotify = create<SpotifyState>(initialState);
const set = (partial: Partial<SpotifyState>) => useSpotify.setState(partial);

/** Một nguồn cần ghi thành playlist Melo. `tracks` undefined = không đổi từ lần trước, giữ nguyên. */
interface SourceList {
  spotifyId: string;
  name: string;
  snapshotId?: string;
  image?: string;
  tracks?: SourceTrack[];
}

/** "Snapshot" cho Bài hát đã thích (Spotify không có snapshot_id cho danh sách này): băm danh sách id. */
export function listSnapshot(tracks: SourceTrack[]): string {
  let h = 0x811c9dc5;
  for (const t of tracks) {
    for (let i = 0; i < t.key.length; i++) h = Math.imul(h ^ t.key.charCodeAt(i), 0x01000193) >>> 0;
    h = Math.imul(h ^ 0x2c, 0x01000193) >>> 0;
  }
  return `${tracks.length}:${h.toString(16)}`;
}

async function spotifyPlaylistsById(): Promise<Map<string, PlaylistRow>> {
  const rows = await db.playlists.filter((p) => p.source === 'spotify').toArray();
  return new Map(rows.map((p) => [p.spotifyId!, p]));
}

const isFromExportFile = (p: PlaylistRow) => Boolean(p.spotifyId?.startsWith(EXPORT_PREFIX));
/** Cùng snapshot và đủ bài: không cần đọc lại danh sách bài (bài thiếu thì đọc lại để tìm lại). */
const isUnchanged = (local: PlaylistRow | undefined, snapshotId: string) => local?.snapshotId === snapshotId && !local.unmatched;
const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

interface WriteResult {
  matched: number;
  missing: number;
}

/** Ghi các danh sách đã ghép thành playlist Melo. */
async function writePlaylists(lists: SourceList[], matches: Map<string, string>, existing: Map<string, PlaylistRow>): Promise<WriteResult> {
  const result: WriteResult = { matched: 0, missing: 0 };
  await db.transaction('rw', db.playlists, async () => {
    const now = Date.now();
    for (const list of lists) {
      const local = existing.get(list.spotifyId);
      const name = list.name.slice(0, 100);
      const cover = list.image ?? local?.cover;
      if (!list.tracks) {
        if (!local) continue;
        result.matched += local.trackIds.length;
        result.missing += local.unmatched ?? 0;
        if (local.name !== name || local.cover !== cover) await db.playlists.update(local.id!, { name, cover });
        continue;
      }
      const trackIds = [...new Set(list.tracks.map((t) => matches.get(t.key)).filter((id): id is string => Boolean(id)))];
      const unmatched = list.tracks.filter((t) => !matches.has(t.key)).length;
      result.matched += trackIds.length;
      result.missing += unmatched;
      const fields = { name, cover, trackIds, snapshotId: list.snapshotId, unmatched };
      if (!local) await db.playlists.add({ ...fields, source: 'spotify', spotifyId: list.spotifyId, createdAt: now, updatedAt: now });
      // Danh sách bài không đổi thì giữ `updatedAt` (thứ tự trong Thư viện không bị xáo).
      else await db.playlists.update(local.id!, sameIds(local.trackIds, trackIds) ? fields : { ...fields, updatedAt: now });
    }
  });
  return result;
}

/** Đọc thư viện Spotify; playlist không đổi từ lần trước thì không đọc lại danh sách bài. */
async function readLists(existing: Map<string, PlaylistRow>): Promise<{ lists: SourceList[]; skipped: number }> {
  const [me, all, liked] = await Promise.all([getMe(), getPlaylists(), getSavedTracks()]);
  set({ user: me.name });
  await setSetting(USER_SETTING, me.name);
  // Development Mode chỉ đọc được bài trong playlist mình sở hữu hoặc cùng chỉnh sửa.
  const readable = all.filter((p) => p.ownerId === me.id || p.collaborative);

  const likedSnapshot = listSnapshot(liked);
  const likedList: SourceList = {
    spotifyId: LIKED_ID,
    name: LIKED_NAME,
    snapshotId: likedSnapshot,
    tracks: isUnchanged(existing.get(LIKED_ID), likedSnapshot) ? undefined : liked
  };

  const changed = readable.filter((p) => !isUnchanged(existing.get(p.id), p.snapshotId));
  const gate = new Semaphore(PLAYLIST_READ_PARALLEL);
  let read = 0;
  const tracksById = new Map(
    await Promise.all(
      changed.map((p) =>
        gate.run(async () => {
          const tracks = await getPlaylistTracks(p.id);
          set({ phase: `Đang đọc playlist ${++read}/${changed.length}` });
          return [p.id, tracks] as const;
        })
      )
    )
  );
  const lists = readable.map((p): SourceList => ({ spotifyId: p.id, name: p.name, snapshotId: p.snapshotId, image: p.image, tracks: tracksById.get(p.id) }));
  return { lists: [likedList, ...lists], skipped: all.length - readable.length };
}

function summary({ lists, matched, missing, pending = 0, skipped = 0 }: WriteResult & { lists: number; pending?: number; skipped?: number }): string {
  const parts = [`${lists} playlist`, `${matched} bài`];
  // Bài chưa kịp tìm (lượt sau tìm tiếp) không tính là "chưa có".
  if (missing - pending > 0) parts.push(`${missing - pending} bài chưa có trên YouTube Music`);
  if (pending) parts.push(`còn ${pending} bài sẽ tìm ở lần đồng bộ sau`);
  if (skipped) parts.push(`bỏ qua ${skipped} playlist của người khác`);
  return parts.join(' • ');
}

/** Ghép bài sang YouTube Music rồi ghi playlist (dùng chung cho đồng bộ và nhập từ file). */
async function matchAndWrite(lists: SourceList[], existing: Map<string, PlaylistRow>, cancelled?: () => boolean): Promise<WriteResult & { pending: number }> {
  set({ phase: 'Đang tìm bài trên YouTube Music…' });
  const { matches, pending } = await matchTracks(lists.flatMap((l) => l.tracks ?? []), {
    onProgress: (done, total) => set({ done, total }),
    maxSearches: MAX_SEARCHES_PER_RUN,
    cancelled
  });
  // Lượt đã huỷ (ngắt kết nối giữa chừng) không được ghi gì; runSync bỏ qua lỗi của lượt đã huỷ.
  if (cancelled?.()) throw new Error('Đã huỷ đồng bộ');
  return { ...(await writePlaylists(lists, matches, existing)), pending };
}

/** Đồng bộ và nhập từ file chạy lần lượt (không ghi chồng playlist của nhau). */
const lock = new Semaphore(1);

/** Chạy một lượt đồng bộ/nhập: hiện tiến độ trong lúc chạy. */
async function withProgress<T>(phase: string, fn: () => Promise<T>): Promise<T> {
  return lock.run(async () => {
    set({ syncing: true, error: undefined, phase, done: 0, total: 0 });
    try {
      return await fn();
    } finally {
      set({ syncing: false, phase: undefined });
    }
  });
}

/** Tăng khi ngắt kết nối: lượt đồng bộ đang chạy thấy khác thì dừng, không ghi gì nữa. */
let generation = 0;

async function runSync(): Promise<void> {
  const gen = generation;
  const cancelled = () => gen !== generation;
  try {
    const existing = await spotifyPlaylistsById();
    const { lists, skipped } = await readLists(existing);
    if (cancelled()) return;
    const written = await matchAndWrite(lists, existing, cancelled);
    // Playlist đã xoá / bỏ theo dõi trên Spotify thì xoá theo (không đụng playlist nhập từ file).
    const keep = new Set(lists.map((l) => l.spotifyId));
    const removed = [...existing.values()].filter((p) => !isFromExportFile(p) && !keep.has(p.spotifyId!));
    await db.playlists.bulkDelete(removed.map((p) => p.id!));
    const now = Date.now();
    await setSetting(LAST_SYNC_SETTING, now);
    const result = summary({ ...written, lists: lists.length, skipped });
    set({ lastSyncAt: now, lastResult: result });
    log.info('spotify', `đồng bộ xong: ${result}`);
  } catch (err) {
    if (cancelled()) return;
    log.warn('spotify', 'đồng bộ lỗi:', err);
    if (err instanceof SpotifyAuthError) {
      set({ connected: false });
      await setSetting(USER_SETTING, '');
    }
    set({ error: errorMessage(err) });
  }
}

let running: Promise<void> | undefined;

/** Đồng bộ ngay (gọi nhiều lần cùng lúc chỉ chạy một lượt). Lỗi hiện trong `useSpotify().error`. */
export function syncSpotify(): Promise<void> {
  running ??= withProgress('Đang đọc thư viện Spotify…', runSync).finally(() => {
    running = undefined;
  });
  return running;
}

function syncIfStale() {
  const { connected, autoSync, lastSyncAt, syncing } = useSpotify.getState();
  if (connected && autoSync && !syncing && isOnline() && Date.now() - (lastSyncAt ?? 0) > AUTO_SYNC_EVERY_MS) void syncSpotify();
}

// ---------- Kết nối ----------

/** Lưu Client ID (nếu có) rồi mở trang đăng nhập Spotify. */
export async function connectSpotify(clientId?: string): Promise<void> {
  if (clientId !== undefined) await setClientId(clientId);
  set({ error: undefined });
  await startSpotifyLogin();
}

/** Ngắt kết nối: xoá token. `removePlaylists`: xoá luôn các playlist đã đồng bộ (giữ playlist nhập từ file). */
export async function disconnectSpotify(removePlaylists = false): Promise<void> {
  generation += 1;
  await disconnectSpotifyAuth();
  if (removePlaylists) {
    const synced = [...(await spotifyPlaylistsById()).values()].filter((p) => !isFromExportFile(p));
    await db.playlists.bulkDelete(synced.map((p) => p.id!));
  }
  await setSetting(USER_SETTING, '');
  await setSetting(LAST_SYNC_SETTING, 0);
  set({ connected: false, user: undefined, lastSyncAt: undefined, lastResult: undefined, error: undefined });
}

export async function setSpotifyAutoSync(autoSync: boolean): Promise<void> {
  set({ autoSync });
  await setSetting(AUTO_SYNC_SETTING, autoSync);
  if (autoSync) syncIfStale();
}

// ---------- Nhập từ file dữ liệu Spotify (không cần Premium) ----------

interface ExportPlaylist {
  name?: string;
  items?: { track?: { trackName?: string; artistName?: string; albumName?: string; trackUri?: string } | null }[];
}
interface ExportLibrary {
  tracks?: { track?: string; artist?: string; album?: string; uri?: string }[];
}

function exportKey(uri: string | undefined, title: string, artist: string): string {
  const id = uri?.match(/^spotify:track:([A-Za-z0-9]+)$/)?.[1];
  return id ?? `${fold(title)}|${fold(artist)}`;
}

function exportTrack(title: string | undefined, artist: string | undefined, album: string | undefined, uri: string | undefined): SourceTrack | undefined {
  if (!title) return undefined;
  return { key: exportKey(uri, title, artist ?? ''), title, artists: artist ? [artist] : [], album, durationMs: 0 };
}

/** Đọc Playlist1.json / YourLibrary.json trong gói "Dữ liệu tài khoản" Spotify gửi qua email. */
export function parseSpotifyExport(text: string): SourceList[] {
  let json: { playlists?: ExportPlaylist[] } & ExportLibrary;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('File không phải JSON');
  }
  const lists: SourceList[] = [];
  for (const p of json.playlists ?? []) {
    const tracks = (p.items ?? [])
      .map((i) => exportTrack(i.track?.trackName, i.track?.artistName, i.track?.albumName, i.track?.trackUri))
      .filter((t): t is SourceTrack => Boolean(t));
    const name = p.name?.trim() || 'Playlist Spotify';
    if (tracks.length) lists.push({ spotifyId: `${EXPORT_PREFIX}${name}`, name, tracks });
  }
  const liked = (json.tracks ?? []).map((t) => exportTrack(t.track, t.artist, t.album, t.uri)).filter((t): t is SourceTrack => Boolean(t));
  if (liked.length) lists.push({ spotifyId: `${EXPORT_PREFIX}${LIKED_ID}`, name: LIKED_NAME, tracks: liked });
  return lists;
}

/** Nhập các file .json đã chọn. Trả về câu tóm tắt để hiện cho người dùng. */
export async function importSpotifyExport(files: { name: string; text(): Promise<string> }[]): Promise<string> {
  const lists: SourceList[] = [];
  for (const file of files) {
    try {
      lists.push(...parseSpotifyExport(await file.text()));
    } catch (err) {
      throw new Error(`${file.name}: ${errorMessage(err)}`);
    }
  }
  if (!lists.length) throw new Error('Không thấy playlist hay bài hát nào. Hãy chọn file Playlist1.json hoặc YourLibrary.json');
  const written = await withProgress('Đang tìm bài trên YouTube Music…', async () => matchAndWrite(lists, await spotifyPlaylistsById()));
  return `Đã nhập ${summary({ ...written, lists: lists.length })}${written.pending ? ' (nhập lại file để tìm tiếp)' : ''}`;
}

// ---------- Khởi động ----------

let initialized: Promise<void> | undefined;

/** Gọi một lần khi app mở. */
export function initSpotify(): Promise<void> {
  initialized ??= init();
  return initialized;
}

async function init() {
  const [connected, lastSyncAt, autoSync, user] = await Promise.all([
    isSpotifyConnected(),
    getSetting<number>(LAST_SYNC_SETTING, 0),
    getSetting<boolean>(AUTO_SYNC_SETTING, true),
    getSetting<string>(USER_SETTING, '')
  ]);
  set({ connected, lastSyncAt: lastSyncAt || undefined, autoSync, user: connected ? user || undefined : undefined });
  await listenSpotifyCallbacks((error) => {
    if (error) {
      set({ error: errorMessage(error) });
      return;
    }
    set({ connected: true, error: undefined });
    void syncSpotify();
  });
  if (isNative) await App.addListener('resume', () => syncIfStale());
  syncIfStale();
}

/** Chỉ dùng trong test. */
export function __resetSpotifySyncForTests() {
  running = undefined;
  initialized = undefined;
  generation = 0;
  useSpotify.setState(initialState(), true);
}
