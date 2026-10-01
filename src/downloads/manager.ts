// Hàng đợi tải bài về máy: tối đa 2 bài cùng lúc (để YouTube không chặn), lưu trạng thái trong IndexedDB
// nên tắt app rồi mở lại vẫn tải tiếp. Bài đã tải được trình phát dùng thay cho link (nghe offline).
import { liveQuery } from 'dexie';
import { create } from 'zustand';
import { db, getSetting, rememberTracks, setSetting, type DownloadRow } from '@/lib/db';
import { log } from '@/lib/log';
import { getLyrics } from '@/lib/lyrics';
import { isOnline, useNetwork } from '@/lib/network';
import { refreshLocalFile, setArtworkFileProvider, setFileUrlProvider } from '@/player/controller';
import { resolveAudio } from '@/youtube/stream';
import type { Track } from '@/youtube/types';
import { getStorage, SAFE_ID, withRange, type DownloadProgress } from './storage';

export const MAX_CONCURRENT = 2;
const AUTO_LIKED_KEY = 'autoDownloadLiked';

interface DownloadIndex {
  /** trạng thái mọi bài trong bảng downloads (cập nhật trực tiếp từ IndexedDB) */
  rows: Map<string, DownloadRow>;
  /** tiến độ đang tải (chỉ trong bộ nhớ, không ghi DB mỗi lần) */
  progress: Map<string, DownloadProgress>;
  /** ảnh bìa đã lưu (để xem offline) */
  artwork: Map<string, string>;
}

export const useDownloads = create<DownloadIndex>(() => ({ rows: new Map(), progress: new Map(), artwork: new Map() }));

const active = new Set<string>();
let started = false;
const cleanups: (() => void)[] = [];

function setProgress(id: string, p: DownloadProgress | undefined) {
  useDownloads.setState((s) => {
    const progress = new Map(s.progress);
    if (p) progress.set(id, p);
    else progress.delete(id);
    return { progress };
  });
}

function errorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message);
  return String(err);
}

/** Tải một bài: lấy link → tải file (.part rồi đổi tên) → ảnh bìa → file .json → lời bài hát. */
async function downloadOne(id: string) {
  const track = await db.tracks.get(id);
  if (!track) throw new Error('Thiếu thông tin bài');
  const storage = getStorage();
  let attempt = 0;
  let bytes = 0;
  let mimeType: string | undefined;
  for (;;) {
    try {
      // Lần thử lại thì lấy link mới (link cũ có thể đã hết hạn hoặc gắn IP cũ).
      const audio = await resolveAudio(id, { refresh: attempt > 0 });
      const { url, headers } = withRange(audio.url, audio.contentLength);
      mimeType = audio.mimeType;
      bytes = await storage.saveAudio({
        id,
        url,
        headers: { ...audio.headers, ...headers },
        expectedBytes: audio.contentLength,
        onProgress: (p) => setProgress(id, { bytes: p.bytes, total: p.total || audio.contentLength || 0 })
      });
      break;
    } catch (err) {
      attempt += 1;
      if (attempt >= 2) throw err;
      log.warn('download', `${id} lỗi, thử lại:`, errorMessage(err));
    }
  }
  if (track.thumbnail) await storage.saveArtwork(id, track.thumbnail);
  await storage.saveSidecar(id, { track, downloadedAt: Date.now(), bytes, mimeType });
  await getLyrics(track).catch(() => undefined);
  return bytes;
}

async function run(id: string) {
  if (active.has(id)) return;
  active.add(id);
  await db.downloads.update(id, { status: 'downloading', error: undefined });
  try {
    const bytes = await downloadOne(id);
    // Bài có thể đã bị xoá khỏi danh sách tải trong lúc đang tải.
    if (!(await db.downloads.get(id))) {
      await getStorage().remove(id);
      return;
    }
    await db.downloads.update(id, { status: 'done', bytes, total: bytes, path: `music/${id}.m4a`, artworkPath: `music/${id}.jpg`, completedAt: Date.now() });
    const art = await getStorage().artworkUrl(id);
    if (art) useDownloads.setState((s) => ({ artwork: new Map(s.artwork).set(id, art) }));
    await refreshLocalFile(id).catch(() => undefined);
    log.info('download', `xong ${id} (${Math.round(bytes / 1024)} KB)`);
  } catch (err) {
    const message = errorMessage(err);
    log.error('download', `${id}:`, message);
    if (await db.downloads.get(id)) await db.downloads.update(id, { status: 'error', error: message });
  } finally {
    active.delete(id);
    setProgress(id, undefined);
    void pump();
  }
}

/** Bắt đầu các bài đang chờ cho tới khi đủ MAX_CONCURRENT bài đang tải. */
export async function pump() {
  if (!isOnline() || active.size >= MAX_CONCURRENT) return;
  const queued = await db.downloads.where('status').equals('queued').sortBy('createdAt');
  // Chọn và đánh dấu "đang tải" trong cùng một đoạn đồng bộ: hai lần pump chạy song song không tải trùng một bài.
  for (const row of queued) {
    if (active.size >= MAX_CONCURRENT) break;
    if (!active.has(row.id)) void run(row.id);
  }
}

/** Thêm bài vào hàng đợi tải; bỏ qua bài đã tải/đang tải. Trả về số bài mới thêm. */
export async function enqueueDownloads(tracks: Track[]): Promise<number> {
  const valid = tracks.filter((t) => SAFE_ID.test(t.id));
  if (!valid.length) return 0;
  await rememberTracks(valid);
  const now = Date.now();
  let added = 0;
  await db.transaction('rw', db.downloads, async () => {
    for (const [i, track] of valid.entries()) {
      const row = await db.downloads.get(track.id);
      if (row && row.status !== 'error') continue;
      await db.downloads.put({ id: track.id, status: 'queued', bytes: 0, total: 0, createdAt: now + i });
      added += 1;
    }
  });
  void pump();
  return added;
}

export async function retryDownload(id: string) {
  await db.downloads.update(id, { status: 'queued', error: undefined });
  void pump();
}

export async function removeDownload(id: string) {
  await db.downloads.delete(id);
  if (!active.has(id)) await getStorage().remove(id).catch((err) => log.warn('download', err));
  useDownloads.setState((s) => {
    const artwork = new Map(s.artwork);
    artwork.delete(id);
    return { artwork };
  });
  await refreshLocalFile(id).catch(() => undefined);
}

export async function removeDownloads(ids: string[]) {
  for (const id of ids) await removeDownload(id);
}

export async function removeAllDownloads() {
  const ids = (await db.downloads.toCollection().primaryKeys()) as string[];
  await removeDownloads(ids);
}

/** Link file cho trình phát nếu bài đã tải xong. */
export async function localFileUrl(id: string): Promise<string | undefined> {
  const row = useDownloads.getState().rows.get(id) ?? (await db.downloads.get(id));
  if (row?.status !== 'done') return undefined;
  return getStorage().audioUrl(id);
}

/** Ảnh bìa đã lưu (dùng khi ảnh trên mạng không tải được). */
export function localArtwork(id: string): string | undefined {
  return useDownloads.getState().artwork.get(id);
}

export async function localArtworkFile(id: string): Promise<string | undefined> {
  const row = useDownloads.getState().rows.get(id);
  return row?.status === 'done' ? getStorage().artworkFileUrl(id) : undefined;
}

export function totalDownloadedBytes(rows: Iterable<DownloadRow>): number {
  let total = 0;
  for (const row of rows) if (row.status === 'done') total += row.bytes;
  return total;
}

export const getAutoDownloadLiked = () => getSetting(AUTO_LIKED_KEY, false);
export const setAutoDownloadLiked = (value: boolean) => setSetting(AUTO_LIKED_KEY, value);

/** Dữ liệu app bị mất nhưng file còn: dựng lại danh sách bài đã tải từ các file .json. */
async function reconcile() {
  try {
    const sidecars = await getStorage().listSidecars();
    const known = new Set((await db.downloads.toCollection().primaryKeys()) as string[]);
    const missing = sidecars.filter((s) => !known.has(s.track.id));
    if (!missing.length) return;
    await rememberTracks(missing.map((s) => s.track));
    await db.downloads.bulkPut(
      missing.map((s) => ({ id: s.track.id, status: 'done' as const, bytes: s.bytes, total: s.bytes, path: `music/${s.track.id}.m4a`, createdAt: s.downloadedAt, completedAt: s.downloadedAt }))
    );
    log.info('download', `khôi phục ${missing.length} bài đã tải từ file .json`);
  } catch (err) {
    log.warn('download', 'không đọc được thư mục nhạc:', err);
  }
}

async function loadArtwork(rows: DownloadRow[]) {
  const storage = getStorage();
  const artwork = new Map<string, string>();
  for (const row of rows) {
    if (row.status !== 'done') continue;
    const url = await storage.artworkUrl(row.id).catch(() => undefined);
    if (url) artwork.set(row.id, url);
  }
  useDownloads.setState({ artwork });
}

/** Gọi một lần khi app khởi động (sau initPlayer). */
export async function initDownloads() {
  if (started) return;
  started = true;
  setFileUrlProvider(localFileUrl);
  setArtworkFileProvider(localArtworkFile);
  await reconcile();
  // Lần trước tắt app giữa chừng: tải lại từ đầu các bài đang dở.
  await db.downloads.where('status').equals('downloading').modify({ status: 'queued' });
  const subscription = liveQuery(() => db.downloads.toArray()).subscribe({
    next: (rows) => useDownloads.setState({ rows: new Map(rows.map((r) => [r.id, r])) }),
    error: (err) => log.error('download', err)
  });
  cleanups.push(() => subscription.unsubscribe());
  void loadArtwork(await db.downloads.toArray());
  // Thích một bài → tự tải (nếu bật trong Cài đặt).
  const onLike = (id: unknown) => {
    // Chạy sau khi giao dịch "thích" ghi xong.
    setTimeout(() => {
      void getAutoDownloadLiked().then(async (on) => {
        if (!on) return;
        const track = await db.tracks.get(id as string);
        if (track) await enqueueDownloads([track]);
      });
    }, 0);
  };
  db.likes.hook('creating', onLike);
  cleanups.push(() => db.likes.hook('creating').unsubscribe(onLike));
  // Có mạng lại thì tải tiếp.
  cleanups.push(
    useNetwork.subscribe((state, prev) => {
      if (state.online && !prev.online) void pump();
    })
  );
  void pump();
}

/** Chỉ dùng trong test. */
export function __resetDownloadsForTests() {
  active.clear();
  started = false;
  cleanups.splice(0).forEach((fn) => fn());
  useDownloads.setState({ rows: new Map(), progress: new Map(), artwork: new Map() }, true);
}

export async function waitForIdleForTests() {
  for (let i = 0; i < 1000 && (active.size > 0 || (await db.downloads.where('status').equals('queued').count()) > 0); i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
