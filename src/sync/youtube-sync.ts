// Đồng bộ thư viện YouTube / YouTube Music (đăng nhập Gmail) → playlist Melo (một chiều, YouTube là gốc).
// - Playlist của bạn (kể cả playlist tạo trên YouTube Music) + "Đã thích trên YouTube" (bài thể loại Âm nhạc đã
//   bấm thích) → playlist nguồn 'youtube' trong Thư viện. Bài là videoId nên phát / tải được ngay, không cần ghép.
// - Playlist không đổi (etag) thì không đọc lại; playlist đã xoá trên YouTube thì xoá theo.
// - Tự đồng bộ khi mở app nếu lần trước đã quá 12 giờ; có nút "Đồng bộ ngay".
import { App } from '@capacitor/app';
import { create } from 'zustand';
import { Semaphore } from '@/lib/async';
import { getSetting, rememberTracks, setSetting } from '@/lib/db';
import { errorMessage, log } from '@/lib/log';
import { isOnline } from '@/lib/network';
import { isNative } from '@/lib/platform';
import { disconnectGoogleAuth, GoogleAuthError, googleEmail, isGoogleConnected, startDeviceLogin, waitForDeviceLogin } from '@/sync/google-auth';
import { getLikedMusic, getMyPlaylists, getPlaylistTracks } from '@/sync/youtube-api';
import type { Track } from '@/youtube/types';
import { listSnapshot, remotePlaylistsById, removeMissingPlaylists, writeRemotePlaylists, type RemotePlaylist } from './remote-playlists';

const LIKED_ID = 'liked';
export const YT_LIKED_NAME = 'Đã thích trên YouTube';
const AUTO_SYNC_EVERY_MS = 12 * 3600_000;
const PLAYLIST_READ_PARALLEL = 3;
const LAST_SYNC_SETTING = 'youtubeLastSync';
const AUTO_SYNC_SETTING = 'youtubeAutoSync';

export interface YouTubeSyncState {
  connected: boolean;
  email?: string;
  /** đang chờ người dùng nhập mã ở google.com/device */
  login?: { userCode: string; verificationUrl: string };
  syncing: boolean;
  phase?: string;
  done: number;
  total: number;
  lastSyncAt?: number;
  lastResult?: string;
  error?: string;
  autoSync: boolean;
}

const initialState = (): YouTubeSyncState => ({ connected: false, syncing: false, done: 0, total: 0, autoSync: true });
export const useYouTubeSync = create<YouTubeSyncState>(initialState);
const set = (partial: Partial<YouTubeSyncState>) => useYouTubeSync.setState(partial);

/** Tăng khi đăng xuất / huỷ đăng nhập: việc đang chạy thấy khác thì dừng, không ghi gì nữa. */
let generation = 0;

// ---------- Đăng nhập ----------

/** Lấy mã đăng nhập (hiện cho người dùng), đợi họ nhập ở google.com/device, rồi đồng bộ luôn. */
export async function connectGoogle(): Promise<void> {
  const gen = ++generation;
  set({ error: undefined });
  const login = await startDeviceLogin();
  set({ login: { userCode: login.userCode, verificationUrl: login.verificationUrl } });
  try {
    const email = await waitForDeviceLogin(login, () => gen !== generation);
    set({ connected: true, email, login: undefined });
    void syncYouTube();
  } catch (err) {
    if (gen === generation) set({ login: undefined, error: errorMessage(err) });
  }
}

export function cancelGoogleLogin() {
  generation += 1;
  set({ login: undefined });
}

/** Đăng xuất: thu hồi quyền và xoá token. `removePlaylists`: xoá luôn các playlist đã đồng bộ. */
export async function disconnectGoogle(removePlaylists = false): Promise<void> {
  generation += 1;
  await disconnectGoogleAuth(true);
  if (removePlaylists) await removeMissingPlaylists(await remotePlaylistsById('youtube'), new Set());
  await setSetting(LAST_SYNC_SETTING, 0);
  set({ connected: false, email: undefined, login: undefined, lastSyncAt: undefined, lastResult: undefined, error: undefined });
}

export async function setYouTubeAutoSync(autoSync: boolean): Promise<void> {
  set({ autoSync });
  await setSetting(AUTO_SYNC_SETTING, autoSync);
  if (autoSync) syncIfStale();
}

// ---------- Đồng bộ ----------

async function runSync(): Promise<void> {
  const gen = generation;
  const cancelled = () => gen !== generation;
  set({ syncing: true, error: undefined, phase: 'Đang đọc thư viện YouTube…', done: 0, total: 0 });
  try {
    const existing = await remotePlaylistsById('youtube');
    const [playlists, liked] = await Promise.all([getMyPlaylists(), getLikedMusic()]);
    if (cancelled()) return;
    const found: Track[] = [...liked];
    const remote: RemotePlaylist[] = [];

    if (liked.length) {
      const ids = liked.map((t) => t.id);
      const snapshotId = listSnapshot(ids);
      remote.push({ remoteId: LIKED_ID, name: YT_LIKED_NAME, snapshotId, image: liked[0].thumbnail, trackIds: existing.get(LIKED_ID)?.snapshotId === snapshotId ? undefined : ids });
    }

    const changed = playlists.filter((p) => existing.get(p.id)?.snapshotId !== p.etag);
    set({ phase: 'Đang đọc playlist…', done: 0, total: changed.length });
    const gate = new Semaphore(PLAYLIST_READ_PARALLEL);
    const trackIds = new Map(
      await Promise.all(
        changed.map((p) =>
          gate.run(async () => {
            const tracks = cancelled() ? [] : await getPlaylistTracks(p.id);
            found.push(...tracks);
            set({ done: useYouTubeSync.getState().done + 1 });
            return [p.id, [...new Set(tracks.map((t) => t.id))]] as [string, string[]];
          })
        )
      )
    );
    if (cancelled()) return;
    for (const p of playlists) remote.push({ remoteId: p.id, name: p.title, snapshotId: p.etag, image: p.thumbnail || undefined, trackIds: trackIds.get(p.id) });

    await rememberTracks(found);
    await writeRemotePlaylists('youtube', remote, existing);
    await removeMissingPlaylists(existing, new Set(remote.map((r) => r.remoteId)));
    const now = Date.now();
    await setSetting(LAST_SYNC_SETTING, now);
    const result = `${playlists.length} playlist${liked.length ? ` • ${liked.length} bài đã thích` : ''}`;
    set({ lastSyncAt: now, lastResult: result });
    log.info('youtube', `đồng bộ xong: ${result}`);
  } catch (err) {
    if (cancelled()) return;
    log.warn('youtube', 'đồng bộ lỗi:', err);
    if (err instanceof GoogleAuthError) set({ connected: false, email: undefined });
    set({ error: errorMessage(err) });
  } finally {
    set({ syncing: false, phase: undefined });
  }
}

let running: Promise<void> | undefined;

/** Đồng bộ ngay (gọi nhiều lần cùng lúc chỉ chạy một lượt). Lỗi hiện trong `useYouTubeSync().error`. */
export function syncYouTube(): Promise<void> {
  running ??= runSync().finally(() => {
    running = undefined;
  });
  return running;
}

function syncIfStale() {
  const { connected, autoSync, lastSyncAt, syncing } = useYouTubeSync.getState();
  if (connected && autoSync && !syncing && isOnline() && Date.now() - (lastSyncAt ?? 0) > AUTO_SYNC_EVERY_MS) void syncYouTube();
}

// ---------- Khởi động ----------

let initialized: Promise<void> | undefined;

/** Gọi một lần khi app mở (chỉ app iPhone; bản web không có YouTube). */
export function initYouTubeSync(): Promise<void> {
  initialized ??= (async () => {
    const [connected, email, lastSyncAt, autoSync] = await Promise.all([
      isGoogleConnected(),
      googleEmail(),
      getSetting<number>(LAST_SYNC_SETTING, 0),
      getSetting<boolean>(AUTO_SYNC_SETTING, true)
    ]);
    set({ connected, email: connected ? email : undefined, lastSyncAt: lastSyncAt || undefined, autoSync });
    if (isNative) await App.addListener('resume', () => syncIfStale());
    syncIfStale();
  })();
  return initialized;
}

/** Chỉ dùng trong test. */
export function __resetYouTubeSyncForTests() {
  running = undefined;
  initialized = undefined;
  generation = 0;
  useYouTubeSync.setState(initialState(), true);
}
