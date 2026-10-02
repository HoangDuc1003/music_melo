// Đồng bộ thư viện Spotify → playlist trong Melo (một chiều, Spotify là gốc).
// - Playlist mình tạo / cùng chỉnh sửa + "Bài hát đã thích" → playlist Melo (nguồn 'spotify').
// - Mỗi bài được ghép với YouTube Music (match.ts); bài không tìm thấy được đếm và thử lại sau.
// - Tự đồng bộ khi mở app nếu lần trước đã quá 12 giờ; có nút "Đồng bộ ngay".
// - Không có Spotify Premium (không tạo được app Spotify): nhập từ file dữ liệu Spotify gửi qua email.
import { App } from '@capacitor/app';
import { create } from 'zustand';
import { db, getSetting, setSetting, type PlaylistRow } from '@/lib/db';
import { log } from '@/lib/log';
import { isOnline } from '@/lib/network';
import { isNative } from '@/lib/platform';
import { getMe, getPlaylists, getPlaylistTracks, getSavedTracks, type SourceTrack } from '@/sync/spotify-api';
import {
  disconnectSpotifyAuth,
  isSpotifyConnected,
  listenSpotifyCallbacks,
  setClientId,
  SpotifyAuthError,
  startSpotifyLogin
} from '@/sync/spotify-auth';
import { fold, matchTracks } from './match';

export const LIKED_ID = 'liked';
export const LIKED_NAME = 'Bài hát đã thích trên Spotify';
const EXPORT_PREFIX = 'export:';
const AUTO_SYNC_EVERY_MS = 12 * 3600_000;
/** Mỗi lượt tìm tối đa chừng này bài mới trên YouTube (~2–3 phút); thư viện lớn đồng bộ dần qua vài lượt. */
const MAX_SEARCHES_PER_RUN = 400;
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

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

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

async function spotifyPlaylists(): Promise<PlaylistRow[]> {
  return db.playlists.filter((p) => p.source === 'spotify').toArray();
}

/** Ghi các danh sách đã ghép thành playlist Melo. Trả về [số bài ghép được, số bài không tìm thấy]. */
async function writePlaylists(lists: SourceList[], matches: Map<string, string>, existing: Map<string, PlaylistRow>): Promise<[number, number]> {
  let matched = 0;
  let missing = 0;
  await db.transaction('rw', db.playlists, async () => {
    const now = Date.now();
    for (const list of lists) {
      const local = existing.get(list.spotifyId);
      if (!list.tracks) {
        if (local) {
          matched += local.trackIds.length;
          missing += local.unmatched ?? 0;
          if (local.name !== list.name || (list.image && local.cover !== list.image)) {
            await db.playlists.update(local.id!, { name: list.name, cover: list.image ?? local.cover });
          }
        }
        continue;
      }
      const trackIds = [...new Set(list.tracks.map((t) => matches.get(t.key)).filter((id): id is string => Boolean(id)))];
      const unmatched = list.tracks.filter((t) => !matches.has(t.key)).length;
      matched += trackIds.length;
      missing += unmatched;
      const fields = { name: list.name.slice(0, 100), trackIds, snapshotId: list.snapshotId, unmatched, updatedAt: now };
      if (local) await db.playlists.update(local.id!, { ...fields, cover: list.image ?? local.cover });
      else await db.playlists.add({ ...fields, source: 'spotify', spotifyId: list.spotifyId, cover: list.image, createdAt: now });
    }
  });
  return [matched, missing];
}

async function readLists(): Promise<{ lists: SourceList[]; existing: Map<string, PlaylistRow>; skipped: number }> {
  const me = await getMe();
  set({ user: me.name });
  await setSetting(USER_SETTING, me.name);
  const existing = new Map((await spotifyPlaylists()).map((p) => [p.spotifyId!, p]));
  const all = await getPlaylists();
  // Development Mode chỉ đọc được bài trong playlist mình sở hữu hoặc cùng chỉnh sửa.
  const readable = all.filter((p) => p.ownerId === me.id || p.collaborative);
  const lists: SourceList[] = [];

  set({ phase: 'Đang đọc Bài hát đã thích…' });
  const liked = await getSavedTracks();
  const likedSnapshot = listSnapshot(liked);
  const likedLocal = existing.get(LIKED_ID);
  const likedSame = likedLocal?.snapshotId === likedSnapshot && !likedLocal.unmatched;
  lists.push({ spotifyId: LIKED_ID, name: LIKED_NAME, snapshotId: likedSnapshot, tracks: likedSame ? undefined : liked });

  for (const [i, p] of readable.entries()) {
    const local = existing.get(p.id);
    const same = local?.snapshotId === p.snapshotId && !local.unmatched;
    if (!same) set({ phase: `Đang đọc playlist ${i + 1}/${readable.length}: ${p.name}` });
    lists.push({ spotifyId: p.id, name: p.name, snapshotId: p.snapshotId, image: p.image, tracks: same ? undefined : await getPlaylistTracks(p.id) });
  }
  return { lists, existing, skipped: all.length - readable.length };
}

function summary(lists: number, matched: number, missing: number, skipped = 0, pending = 0): string {
  const parts = [`${lists} playlist`, `${matched} bài`];
  // Bài chưa kịp tìm (lượt sau tìm tiếp) không tính là "chưa có".
  if (missing - pending > 0) parts.push(`${missing - pending} bài chưa có trên YouTube Music`);
  if (pending) parts.push(`còn ${pending} bài sẽ tìm ở lần đồng bộ sau`);
  if (skipped) parts.push(`bỏ qua ${skipped} playlist của người khác`);
  return parts.join(' • ');
}

/** Tăng khi ngắt kết nối: lượt đồng bộ đang chạy thấy khác thì dừng, không ghi gì nữa. */
let generation = 0;

async function runSync(): Promise<void> {
  const gen = generation;
  const cancelled = () => gen !== generation;
  set({ syncing: true, error: undefined, phase: 'Đang đọc thư viện Spotify…', done: 0, total: 0 });
  try {
    const { lists, existing, skipped } = await readLists();
    if (cancelled()) return;
    set({ phase: 'Đang tìm bài trên YouTube Music…' });
    const { matches, pending } = await matchTracks(lists.flatMap((l) => l.tracks ?? []), {
      onProgress: (done, total) => set({ done, total }),
      maxSearches: MAX_SEARCHES_PER_RUN,
      cancelled
    });
    if (cancelled()) return;
    const [matched, missing] = await writePlaylists(lists, matches, existing);
    // Playlist đã xoá / bỏ theo dõi trên Spotify thì xoá theo (không đụng playlist nhập từ file).
    const keep = new Set(lists.map((l) => l.spotifyId));
    const removed = [...existing.values()].filter((p) => !p.spotifyId!.startsWith(EXPORT_PREFIX) && !keep.has(p.spotifyId!));
    await db.playlists.bulkDelete(removed.map((p) => p.id!));
    const now = Date.now();
    await setSetting(LAST_SYNC_SETTING, now);
    const result = summary(lists.length, matched, missing, skipped, pending);
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
  } finally {
    set({ syncing: false, phase: undefined });
  }
}

let running: Promise<void> | undefined;

/** Đồng bộ ngay (gọi nhiều lần cùng lúc chỉ chạy một lượt). Lỗi hiện trong `useSpotify().error`. */
export function syncSpotify(): Promise<void> {
  running ??= runSync().finally(() => {
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
    const synced = (await spotifyPlaylists()).filter((p) => !p.spotifyId?.startsWith(EXPORT_PREFIX));
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
  if (useSpotify.getState().syncing) throw new Error('Đang đồng bộ, đợi xong rồi nhập');
  const lists: SourceList[] = [];
  for (const file of files) {
    try {
      lists.push(...parseSpotifyExport(await file.text()));
    } catch (err) {
      throw new Error(`${file.name}: ${errorMessage(err)}`);
    }
  }
  if (!lists.length) throw new Error('Không thấy playlist hay bài hát nào. Hãy chọn file Playlist1.json hoặc YourLibrary.json');
  set({ syncing: true, error: undefined, phase: 'Đang tìm bài trên YouTube Music…', done: 0, total: 0 });
  try {
    const existing = new Map((await spotifyPlaylists()).map((p) => [p.spotifyId!, p]));
    const { matches, pending } = await matchTracks(lists.flatMap((l) => l.tracks ?? []), {
      onProgress: (done, total) => set({ done, total }),
      maxSearches: MAX_SEARCHES_PER_RUN
    });
    const [matched, missing] = await writePlaylists(lists, matches, existing);
    return `Đã nhập ${summary(lists.length, matched, missing, 0, pending)}${pending ? ' (nhập lại file để tìm tiếp)' : ''}`;
  } finally {
    set({ syncing: false, phase: undefined });
  }
}

// ---------- Khởi động ----------

/** Gọi một lần khi app mở. */
export async function initSpotify(): Promise<void> {
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
  generation = 0;
  useSpotify.setState(initialState(), true);
}
