// Hàng đợi tải bài về máy, lưu trạng thái trong IndexedDB nên tắt app rồi mở lại vẫn tải tiếp.
// Số bài tải cùng lúc tự điều chỉnh 1–15 theo tốc độ mạng và phản ứng của YouTube (xem concurrency.ts).
// Bài đã tải được trình phát dùng thay cho link (nghe offline).
import { liveQuery } from 'dexie';
import { create } from 'zustand';
import { clamp, Semaphore, sleep } from '@/lib/async';
import { db, getSetting, rememberTracks, setSetting, type DownloadRow } from '@/lib/db';
import { errorMessage, log } from '@/lib/log';
import { getLyrics } from '@/lib/lyrics';
import { isOnline, useNetwork } from '@/lib/network';
import { refreshLocalFile, setArtworkFileProvider, setFileUrlProvider } from '@/player/controller';
import { canDownload, resolveAudio } from '@/youtube/stream';
import type { Track } from '@/youtube/types';
import { AdaptiveLimiter, classifyFailure, HARD_MAX } from './concurrency';
import { getStorage, SAFE_ID, withRange, type DownloadProgress } from './storage';

const AUTO_LIKED_KEY = 'autoDownloadLiked';
const CONCURRENCY_KEY = 'downloadConcurrency';
const CELLULAR_KEY = 'downloadOnCellular';
/** Trên 4G/5G tối đa chừng này lượt (đỡ tốn pin, đỡ bị nhà mạng bóp). */
export const CELLULAR_MAX = 6;
/** Hỏi link YouTube tối đa 3 bài cùng lúc (tránh dồn dập request tới InnerTube). */
const RESOLVE_PARALLEL = 3;
/** Giãn cách giữa hai lần bắt đầu tải. */
const START_GAP_MS = 150;
const INITIAL_LIMIT = 3;

export type ConcurrencySetting = 'auto' | number;

export interface DownloadSettings {
  concurrency: ConcurrencySetting;
  /** cho tải bằng dữ liệu di động */
  cellular: boolean;
  /** thích bài nào thì tự tải bài đó */
  autoLiked: boolean;
}

interface DownloadIndex {
  /** trạng thái mọi bài trong bảng downloads (cập nhật trực tiếp từ IndexedDB) */
  rows: Map<string, DownloadRow>;
  /** tiến độ đang tải (chỉ trong bộ nhớ, không ghi DB mỗi lần) */
  progress: Map<string, DownloadProgress>;
  /** ảnh bìa đã lưu (để xem offline) */
  artwork: Map<string, string>;
  /** số lượt tải cho phép lúc này */
  limit: number;
  /** tốc độ tổng (byte/giây) */
  speed: number;
  /** ms còn phải nghỉ do YouTube hạn chế */
  cooldown: number;
  /** đang chờ Wi‑Fi (không cho tải bằng dữ liệu di động) */
  waitingForWifi: boolean;
  settings: DownloadSettings;
}

const DEFAULT_SETTINGS: DownloadSettings = { concurrency: 'auto', cellular: true, autoLiked: false };
const SETTING_KEYS: Record<keyof DownloadSettings, string> = {
  concurrency: CONCURRENCY_KEY,
  cellular: CELLULAR_KEY,
  autoLiked: AUTO_LIKED_KEY
};

const initialIndex = (): DownloadIndex => ({
  rows: new Map(),
  progress: new Map(),
  artwork: new Map(),
  limit: INITIAL_LIMIT,
  speed: 0,
  cooldown: 0,
  waitingForWifi: false,
  settings: { ...DEFAULT_SETTINGS }
});

export const useDownloads = create<DownloadIndex>(initialIndex);

const newLimiter = () => new AdaptiveLimiter({ initial: INITIAL_LIMIT, max: HARD_MAX });

const active = new Set<string>();
let started = false;
/** Bảng `rows` trong bộ nhớ đã nạp từ IndexedDB lần đầu. */
let indexLoaded = false;
const cleanups: (() => void)[] = [];
let limiter = newLimiter();
const resolveGate = new Semaphore(RESOLVE_PARALLEL);
const lastBytes = new Map<string, number>();
let lastStartAt = 0;
let pumpTimer: ReturnType<typeof setTimeout> | undefined;
let ticker: ReturnType<typeof setInterval> | undefined;
let startGapMs = START_GAP_MS;

/**
 * 15 bài tải cùng lúc có thể bắn hàng trăm sự kiện tiến độ mỗi giây: gom lại, cập nhật giao diện tối đa 4 lần/giây.
 * Lần đầu (hiện thanh tiến độ) và lúc xong (bỏ thanh) thì cập nhật ngay.
 */
const PROGRESS_FLUSH_MS = 250;
const pendingProgress = new Map<string, DownloadProgress | undefined>();
let progressTimer: ReturnType<typeof setTimeout> | undefined;

function flushProgress() {
  clearTimeout(progressTimer);
  progressTimer = undefined;
  if (!pendingProgress.size) return;
  const updates = [...pendingProgress];
  pendingProgress.clear();
  useDownloads.setState((s) => {
    const progress = new Map(s.progress);
    for (const [id, p] of updates) {
      if (p) progress.set(id, p);
      else progress.delete(id);
    }
    return { progress };
  });
}

function setProgress(id: string, p: DownloadProgress | undefined) {
  if (p) {
    const delta = p.bytes - (lastBytes.get(id) ?? 0);
    lastBytes.set(id, p.bytes);
    limiter.recordBytes(delta);
  } else {
    lastBytes.delete(id);
  }
  pendingProgress.set(id, p);
  if (!p || !useDownloads.getState().progress.has(id)) flushProgress();
  else progressTimer ??= setTimeout(flushProgress, PROGRESS_FLUSH_MS);
}

/** Lấy link rồi tải file nhạc (.part rồi đổi tên); lỗi thì thử lại một lần với link mới. */
async function downloadAudio(id: string): Promise<{ bytes: number; mimeType?: string }> {
  for (let attempt = 0; ; attempt++) {
    try {
      // Lần thử lại thì lấy link mới (link cũ có thể đã hết hạn hoặc gắn IP cũ).
      const audio = await resolveGate.run(() => resolveAudio(id, { refresh: attempt > 0, download: true }));
      const { url, headers } = withRange(audio.url, audio.contentLength);
      const bytes = await getStorage().saveAudio({
        id,
        url,
        headers: { ...audio.headers, ...headers },
        expectedBytes: audio.contentLength,
        onProgress: (p) => setProgress(id, { bytes: p.bytes, total: p.total || audio.contentLength || 0 })
      });
      return { bytes, mimeType: audio.mimeType };
    } catch (err) {
      if (attempt >= 1) throw err;
      const kind = classifyFailure(err);
      log.warn('download', `${id} lỗi (${kind}), thử lại:`, errorMessage(err));
      limiter.onFailure(kind);
      // Bị YouTube chặn: đợi hết thời gian nghỉ rồi mới thử lại.
      await limiter.waitCooldown();
    }
  }
}

/** Tải một bài: file nhạc → ảnh bìa → file .json → lời bài hát. */
async function downloadOne(id: string) {
  const track = await db.tracks.get(id);
  if (!track) throw new Error('Thiếu thông tin bài');
  const storage = getStorage();
  const { bytes, mimeType } = await downloadAudio(id);
  if (track.thumbnail) await storage.saveArtwork(id, track.thumbnail);
  await storage.saveSidecar(id, { track, downloadedAt: Date.now(), bytes, mimeType });
  await getLyrics(track).catch(() => undefined);
  return bytes;
}

async function run(id: string) {
  if (active.has(id)) return;
  active.add(id);
  lastStartAt = Date.now();
  startTicker();
  await db.downloads.update(id, { status: 'downloading', error: undefined });
  try {
    const bytes = await downloadOne(id);
    limiter.onSuccess(active.size >= limiter.limit);
    // Bài có thể đã bị xoá khỏi danh sách tải trong lúc đang tải.
    if (!(await db.downloads.get(id))) {
      await getStorage().remove(id);
      return;
    }
    await db.downloads.update(id, { status: 'done', bytes, total: bytes, completedAt: Date.now() });
    const art = await getStorage().artworkUrl(id);
    if (art) useDownloads.setState((s) => ({ artwork: new Map(s.artwork).set(id, art) }));
    await refreshLocalFile(id).catch(() => undefined);
    log.info('download', `xong ${id} (${Math.round(bytes / 1024)} KB), ${limiter.limit} lượt`);
  } catch (err) {
    const message = errorMessage(err);
    const kind = classifyFailure(err);
    limiter.onFailure(kind);
    log.error('download', `${id} (${kind}, còn ${limiter.limit} lượt):`, message);
    if (await db.downloads.get(id)) await db.downloads.update(id, { status: 'error', error: message });
  } finally {
    active.delete(id);
    setProgress(id, undefined);
    publishStats();
    void pump();
  }
}

function cellularBlocked(): boolean {
  const { settings } = useDownloads.getState();
  return !settings.cellular && useNetwork.getState().connectionType === 'cellular';
}

function schedulePump(delay: number) {
  if (pumpTimer) return;
  pumpTimer = setTimeout(() => {
    pumpTimer = undefined;
    void pump();
  }, delay);
}

/** Bắt đầu các bài đang chờ cho tới khi đủ số lượt cho phép (giãn cách mỗi lần bắt đầu). */
export async function pump() {
  publishStats();
  if (!isOnline() || cellularBlocked() || active.size >= limiter.limit) return;
  const cooldown = limiter.cooldownRemaining();
  if (cooldown > 0) return schedulePump(cooldown + 10);
  const queued = await db.downloads.where('status').equals('queued').sortBy('createdAt');
  // Chọn và đánh dấu "đang tải" trong cùng một đoạn đồng bộ: hai lần pump chạy song song không tải trùng một bài.
  for (const row of queued) {
    if (!limiter.canStart(active.size)) break;
    if (active.has(row.id)) continue;
    const wait = lastStartAt + startGapMs - Date.now();
    if (wait > 0) return schedulePump(wait);
    void run(row.id);
  }
}

function publishStats() {
  const stats = {
    limit: limiter.limit,
    speed: active.size ? limiter.throughput() : 0,
    cooldown: limiter.cooldownRemaining(),
    waitingForWifi: cellularBlocked()
  };
  // Không đổi gì thì không báo (đỡ chạy lại selector của mọi dòng bài đang hiện).
  const s = useDownloads.getState();
  if (s.limit === stats.limit && s.speed === stats.speed && s.cooldown === stats.cooldown && s.waitingForWifi === stats.waitingForWifi) return;
  useDownloads.setState(stats);
}

/** Cập nhật tốc độ trên giao diện mỗi giây khi đang tải. */
function startTicker() {
  if (ticker) return;
  ticker = setInterval(() => {
    publishStats();
    if (!active.size) {
      clearInterval(ticker);
      ticker = undefined;
    }
  }, 1000);
}

/** Áp dụng cài đặt + loại mạng hiện tại vào bộ điều chỉnh. */
function applyLimits() {
  const { settings } = useDownloads.getState();
  const cellular = useNetwork.getState().connectionType === 'cellular';
  if (settings.concurrency === 'auto') limiter.setMax(cellular ? CELLULAR_MAX : HARD_MAX);
  else limiter.setFixed(cellular ? Math.min(settings.concurrency, CELLULAR_MAX) : settings.concurrency);
  publishStats();
}

const normalizeConcurrency = (value: unknown): ConcurrencySetting => (typeof value === 'number' ? clamp(value, 1, HARD_MAX) : 'auto');

export async function setDownloadSettings(partial: Partial<DownloadSettings>) {
  const settings = { ...useDownloads.getState().settings, ...partial };
  settings.concurrency = normalizeConcurrency(settings.concurrency);
  useDownloads.setState({ settings });
  for (const key of Object.keys(partial) as (keyof DownloadSettings)[]) await setSetting(SETTING_KEYS[key], settings[key]);
  applyLimits();
  void pump();
}

async function loadSettings() {
  const [concurrency, cellular, autoLiked] = await Promise.all([
    getSetting<unknown>(CONCURRENCY_KEY, DEFAULT_SETTINGS.concurrency),
    getSetting(CELLULAR_KEY, DEFAULT_SETTINGS.cellular),
    getSetting(AUTO_LIKED_KEY, DEFAULT_SETTINGS.autoLiked)
  ]);
  useDownloads.setState({ settings: { concurrency: normalizeConcurrency(concurrency), cellular, autoLiked } });
  applyLimits();
}

/** Thêm bài vào hàng đợi tải; bỏ qua bài đã tải/đang tải và bài không tải được (video YouTube ở bản web). Trả về số bài mới thêm. */
export async function enqueueDownloads(tracks: Track[]): Promise<number> {
  const valid = [...new Map(tracks.filter((t) => SAFE_ID.test(t.id) && canDownload(t.id)).map((t) => [t.id, t])).values()];
  if (!valid.length) return 0;
  await rememberTracks(valid);
  const now = Date.now();
  const added = await db.transaction('rw', db.downloads, async () => {
    const existing = await db.downloads.bulkGet(valid.map((t) => t.id));
    const rows = valid
      .map((track, i) => ({ id: track.id, status: 'queued' as const, bytes: 0, total: 0, createdAt: now + i }))
      .filter((_, i) => !existing[i] || existing[i].status === 'error');
    await db.downloads.bulkPut(rows);
    return rows.length;
  });
  void pump();
  return added;
}

export async function retryDownload(id: string) {
  await db.downloads.update(id, { status: 'queued', error: undefined });
  void pump();
}

/** File nhạc người dùng tự chọn trên máy (bản web). */
export interface LocalFile {
  track: Track;
  audio: Blob;
  artwork?: Blob;
}

/** Lưu file nhạc người dùng tự chọn như bài đã tải xong (bỏ qua file đã thêm trước đó). Trả về số bài mới. */
export async function addLocalFiles(files: LocalFile[]): Promise<number> {
  const storage = getStorage();
  const existing = await db.downloads.bulkGet(files.map((f) => f.track.id));
  const fresh = files.filter((f, i) => !existing[i] && SAFE_ID.test(f.track.id));
  if (!fresh.length) return 0;
  for (const file of fresh) await storage.saveFile(file.track.id, file.audio, file.artwork);
  await rememberTracks(fresh.map((f) => f.track));
  const now = Date.now();
  await db.downloads.bulkPut(
    fresh.map((f, i) => ({ id: f.track.id, status: 'done' as const, bytes: f.audio.size, total: f.audio.size, createdAt: now + i, completedAt: now + i }))
  );
  const covers = await Promise.all(fresh.filter((f) => f.artwork).map(async (f) => [f.track.id, await storage.artworkUrl(f.track.id)] as const));
  useDownloads.setState((s) => {
    const artwork = new Map(s.artwork);
    for (const [id, url] of covers) if (url) artwork.set(id, url);
    return { artwork };
  });
  return fresh.length;
}

export const removeDownload = (id: string) => removeDownloads([id]);

/** Xoá khỏi danh sách tải và xoá file (bài đang tải dở thì `run` tự xoá file khi xong). */
export async function removeDownloads(ids: string[]) {
  await db.downloads.bulkDelete(ids);
  useDownloads.setState((s) => {
    const artwork = new Map(s.artwork);
    for (const id of ids) artwork.delete(id);
    return { artwork };
  });
  const files = new Semaphore(4);
  await Promise.all(
    ids.map((id) =>
      files.run(async () => {
        if (!active.has(id)) await getStorage().remove(id).catch((err) => log.warn('download', err));
        await refreshLocalFile(id).catch(() => undefined);
      })
    )
  );
}

export async function removeAllDownloads() {
  const ids = (await db.downloads.toCollection().primaryKeys()) as string[];
  await removeDownloads(ids);
}

async function isDownloaded(id: string): Promise<boolean> {
  const row = useDownloads.getState().rows.get(id);
  if (row?.status === 'done') return true;
  if (!row && indexLoaded) return false;
  // Bảng trong bộ nhớ chưa nạp (lúc mở app) hoặc trễ một nhịp sau khi ghi: hỏi IndexedDB.
  return (await db.downloads.get(id))?.status === 'done';
}

/** Link file cho trình phát nếu bài đã tải xong. */
export async function localFileUrl(id: string): Promise<string | undefined> {
  return (await isDownloaded(id)) ? getStorage().audioUrl(id) : undefined;
}

async function localArtworkFile(id: string): Promise<string | undefined> {
  return (await isDownloaded(id)) ? getStorage().artworkFileUrl(id) : undefined;
}

/**
 * Cho trình phát dùng file đã tải. Gọi trước `initPlayer` để cả hàng chờ khôi phục lúc mở app
 * cũng phát từ file (không tốn mạng, nghe được offline).
 */
export function connectDownloadsToPlayer() {
  setFileUrlProvider(localFileUrl);
  setArtworkFileProvider(localArtworkFile);
}

/** Phần đã tải 0..1 (0 khi chưa biết dung lượng). */
export function progressRatio(p: DownloadProgress | undefined): number {
  return p && p.total > 0 ? Math.min(1, p.bytes / p.total) : 0;
}

export function totalDownloadedBytes(rows: Iterable<DownloadRow>): number {
  let total = 0;
  for (const row of rows) if (row.status === 'done') total += row.bytes;
  return total;
}

/** Dữ liệu app bị mất nhưng file còn: dựng lại danh sách bài đã tải từ các file .json. */
async function reconcile() {
  try {
    const known = new Set((await db.downloads.toCollection().primaryKeys()) as string[]);
    const missing = await getStorage().listSidecars(known);
    if (!missing.length) return;
    await rememberTracks(missing.map((s) => s.track));
    await db.downloads.bulkPut(
      missing.map((s) => ({ id: s.track.id, status: 'done' as const, bytes: s.bytes, total: s.bytes, createdAt: s.downloadedAt, completedAt: s.downloadedAt }))
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

/** Thích một bài → tự tải (nếu bật trong Cài đặt). */
function watchLikes(): () => void {
  const onLike = (id: unknown) => {
    if (!useDownloads.getState().settings.autoLiked) return;
    // Chạy sau khi giao dịch "thích" ghi xong.
    setTimeout(async () => {
      const track = await db.tracks.get(id as string);
      if (track) await enqueueDownloads([track]).catch((err) => log.warn('download', err));
    }, 0);
  };
  db.likes.hook('creating', onLike);
  return () => db.likes.hook('creating').unsubscribe(onLike);
}

/** Có mạng lại / đổi Wi‑Fi ↔ 4G: áp lại giới hạn và tải tiếp. */
function watchNetwork(): () => void {
  return useNetwork.subscribe((state, prev) => {
    if (state.connectionType !== prev.connectionType) applyLimits();
    if (state.online && (!prev.online || state.connectionType !== prev.connectionType)) void pump();
  });
}

/** Bảng trạng thái tải trong bộ nhớ, luôn khớp IndexedDB. */
function watchRows(): () => void {
  const subscription = liveQuery(() => db.downloads.toArray()).subscribe({
    next: (rows) => {
      indexLoaded = true;
      useDownloads.setState({ rows: new Map(rows.map((r) => [r.id, r])) });
    },
    error: (err) => log.error('download', err)
  });
  return () => subscription.unsubscribe();
}

/** Gọi một lần khi app khởi động (sau initPlayer). */
export async function initDownloads() {
  if (started) return;
  started = true;
  await loadSettings();
  await reconcile();
  // Lần trước tắt app giữa chừng: tải lại từ đầu các bài đang dở.
  await db.downloads.where('status').equals('downloading').modify({ status: 'queued' });
  cleanups.push(watchRows(), watchLikes(), watchNetwork());
  void loadArtwork(await db.downloads.toArray());
  void pump();
}

/** Chỉ dùng trong test. */
export function __resetDownloadsForTests(options: { limiter?: AdaptiveLimiter; startGapMs?: number } = {}) {
  active.clear();
  lastBytes.clear();
  started = false;
  indexLoaded = false;
  cleanups.splice(0).forEach((fn) => fn());
  clearTimeout(pumpTimer);
  pumpTimer = undefined;
  clearInterval(ticker);
  ticker = undefined;
  clearTimeout(progressTimer);
  progressTimer = undefined;
  pendingProgress.clear();
  lastStartAt = 0;
  startGapMs = options.startGapMs ?? 0;
  limiter = options.limiter ?? newLimiter();
  useDownloads.setState(initialIndex(), true);
}

export function activeCountForTests(): number {
  return active.size;
}

export async function waitForIdleForTests() {
  for (let i = 0; i < 1000 && (active.size > 0 || (await db.downloads.where('status').equals('queued').count()) > 0); i++) {
    await sleep(5);
  }
}
