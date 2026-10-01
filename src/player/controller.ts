// Nối giao diện ↔ plugin MeloPlayer (native giữ hàng chờ và tự chuyển bài khi khoá máy).
// JS lo phần cần mạng: lấy sẵn link cho ~20 bài tới, xin link mới khi native báo `needsUrl`,
// nối radio khi sắp hết bài, lưu hàng chờ để mở app là nghe tiếp, ghi lịch sử.
import { Network } from '@capacitor/network';
import {
  MeloPlayer,
  type NeedsUrlEvent,
  type PlayerErrorEvent,
  type PlayerItem,
  type PlayerState,
  type RepeatMode
} from 'capacitor-melo-player';
import { db, rememberTracks } from '@/lib/db';
import { joinArtists } from '@/lib/format';
import { log } from '@/lib/log';
import { isOnline, setNetworkStatus } from '@/lib/network';
import { getUpNext } from '@/youtube/music';
import { clearAudioCache, getCachedAudio, resolveAudio, StreamError } from '@/youtube/stream';
import type { Track } from '@/youtube/types';
import {
  freshRadioTracks,
  insertPosition,
  makeEntries,
  parseSnapshot,
  serializeSnapshot,
  shouldAppendRadio,
  shuffleKeepingCurrent,
  upcomingIndices,
  type PlayContext,
  type QueueEntry
} from './queue';
import { currentEntry, initialPlayerState, usePlayer, type PlayerStore } from './store';

/** Link sống ~6 giờ: chuẩn bị sẵn 20 bài ≈ 1–1,5 giờ nghe khi khoá máy. */
export const PRERESOLVE_AHEAD = 20;
/** 3 bài tới chuẩn bị ngay, các bài sau giãn ra để YouTube không chặn. */
const PRERESOLVE_URGENT = 3;
const PRERESOLVE_GAP_MS = 1500;
const SNAPSHOT_KEY = 'melo.queue';
const SNAPSHOT_THROTTLE_MS = 5000;
const HISTORY_DEDUPE_MS = 60_000;

type FileUrlProvider = (trackId: string) => Promise<string | undefined>;

let fileUrlProvider: FileUrlProvider = async () => undefined;
let artworkFileProvider: FileUrlProvider = async () => undefined;
/** Phần tải về cung cấp đường dẫn file đã tải để native phát offline. */
export function setFileUrlProvider(provider: FileUrlProvider) {
  fileUrlProvider = provider;
}
/** Ảnh bìa đã tải (file://) cho màn hình khoá khi không có mạng. */
export function setArtworkFileProvider(provider: FileUrlProvider) {
  artworkFileProvider = provider;
}

/** Link đã gửi cho native theo id (để không gửi lại và biết bài nào còn thiếu). */
const sentUrls = new Map<string, string>();
const localFiles = new Set<string>();
let resolveGeneration = 0;
let radioBusy = false;
let radioFailedSeed: string | undefined;
let lastHistory: { id: string; at: number } | undefined;
let lastSnapshotAt = 0;
let snapshotTimer: ReturnType<typeof setTimeout> | undefined;
let lastConnectionType: string | undefined;
/** Số bài liên tiếp không lấy được link (để không chuyển bài mãi khi mất mạng). */
let consecutiveResolveFailures = 0;
let initialized: Promise<void> | undefined;
let sleepFn: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function set(partial: Partial<PlayerStore>) {
  usePlayer.setState(partial);
}

function errorMessage(err: unknown): string {
  if (err instanceof StreamError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

// ---------- Chuyển Track → PlayerItem ----------

async function toItem(track: Track): Promise<PlayerItem> {
  const fileUrl = await fileUrlProvider(track.id).catch(() => undefined);
  const localArt = fileUrl ? await artworkFileProvider(track.id).catch(() => undefined) : undefined;
  if (fileUrl) localFiles.add(track.id);
  else localFiles.delete(track.id);
  const cached = getCachedAudio(track.id);
  if (cached) sentUrls.set(track.id, cached.url);
  return {
    id: track.id,
    url: cached?.url ?? '',
    fileUrl,
    headers: cached?.headers,
    title: track.title,
    artist: joinArtists(track.artists),
    album: track.album?.name,
    artwork: (isOnline() ? track.thumbnail : localArt) || track.thumbnail || localArt || undefined,
    duration: track.duration > 0 ? track.duration : undefined
  };
}

function toItems(entries: QueueEntry[]): Promise<PlayerItem[]> {
  return Promise.all(entries.map((e) => toItem(e.track)));
}

// ---------- Lấy sẵn link ----------

/** `force`: native đang đợi link của bài này nên luôn gửi, kể cả link đã gửi trước đó. */
async function sendUrl(trackId: string, options: { refresh?: boolean; force?: boolean } = {}) {
  const audio = await resolveAudio(trackId, { refresh: options.refresh });
  if (!options.force && sentUrls.get(trackId) === audio.url) return;
  sentUrls.set(trackId, audio.url);
  await MeloPlayer.updateItem({ id: trackId, url: audio.url, headers: audio.headers });
}

/** Chuẩn bị link cho bài hiện tại và PRERESOLVE_AHEAD bài sau. Lần gọi mới huỷ vòng cũ. */
export function ensureUpcomingUrls(): Promise<void> {
  const generation = ++resolveGeneration;
  return (async () => {
    const { entries, index, repeat } = usePlayer.getState();
    const ids: string[] = [];
    for (const i of upcomingIndices(entries.length, index, PRERESOLVE_AHEAD, repeat)) {
      const id = entries[i].track.id;
      if (!ids.includes(id)) ids.push(id);
    }
    let count = 0;
    for (const id of ids) {
      if (generation !== resolveGeneration) return;
      if (localFiles.has(id)) continue;
      const cached = getCachedAudio(id);
      if (cached && sentUrls.get(id) === cached.url) continue;
      if (count >= PRERESOLVE_URGENT) await sleepFn(PRERESOLVE_GAP_MS);
      if (generation !== resolveGeneration) return;
      count += 1;
      try {
        await sendUrl(id);
      } catch (err) {
        // Bài lỗi sẽ được xử lý khi tới lượt (needsUrl → error → bỏ qua).
        log.warn('player', `chuẩn bị link ${id} lỗi:`, errorMessage(err));
      }
    }
  })();
}

// ---------- Sự kiện từ native ----------

function onState(state: PlayerState) {
  const current = usePlayer.getState();
  if (state.playing && !state.buffering) consecutiveResolveFailures = 0;
  set({
    index: state.index < current.entries.length ? state.index : current.index,
    playing: state.playing,
    buffering: state.buffering,
    position: state.position,
    duration: state.duration,
    positionAt: Date.now(),
    repeat: state.repeat,
    sleepTimerEndsAt: state.sleepTimerEndsAt,
    sleepAtEndOfItem: state.sleepAtEndOfItem
  });
  scheduleSnapshot();
}

function onItemChanged({ index, id }: { index: number; id: string }) {
  const { entries } = usePlayer.getState();
  if (entries[index]?.track.id !== id) {
    log.warn('player', `hàng chờ lệch native: ${index}/${id}`);
    return;
  }
  set({ index, position: 0, positionAt: Date.now() });
  recordHistory(entries[index].track);
  void ensureUpcomingUrls();
  void maybeAppendRadio();
  saveSnapshot();
}

async function onNeedsUrl({ index, id, reason }: NeedsUrlEvent) {
  try {
    await sendUrl(id, { refresh: reason === 'failed', force: true });
  } catch (err) {
    const message = errorMessage(err);
    log.error('player', `không lấy được link ${id}:`, message);
    set({ error: message });
    // Native đang đợi link cho bài này: bỏ qua sang bài sau, trừ khi cả hàng chờ đều lỗi.
    consecutiveResolveFailures += 1;
    const state = await MeloPlayer.getState();
    if (state.index !== index || state.id !== id) return;
    if (consecutiveResolveFailures >= Math.max(1, usePlayer.getState().entries.length)) {
      consecutiveResolveFailures = 0;
      set({ error: 'Không lấy được bài nào, kiểm tra kết nối mạng rồi thử lại' });
      await MeloPlayer.pause();
      return;
    }
    await MeloPlayer.next();
  }
}

function onError({ id, message }: PlayerErrorEvent) {
  log.error('player', `lỗi phát ${id}:`, message);
  set({ error: 'Không phát được bài này, chuyển sang bài sau' });
}

async function onQueueEnded() {
  // Radio chưa kịp nối (mất mạng…): thử lại một lần rồi phát tiếp.
  const { entries } = usePlayer.getState();
  const before = entries.length;
  radioFailedSeed = undefined;
  if (await maybeAppendRadio()) await MeloPlayer.skipTo({ index: before });
}

// ---------- Radio ----------

/** Còn ≤3 bài thì nối radio (YouTube Music automix) từ bài cuối hàng chờ. */
export async function maybeAppendRadio(): Promise<boolean> {
  const { entries, index, repeat, autoplay } = usePlayer.getState();
  if (!autoplay || radioBusy || !isOnline() || !shouldAppendRadio(entries.length, index, repeat)) return false;
  const seed = entries[entries.length - 1].track;
  if (radioFailedSeed === seed.id) return false;
  radioBusy = true;
  try {
    const tracks = freshRadioTracks(await getUpNext(seed.id), entries.map((e) => e.track));
    if (!tracks.length) {
      radioFailedSeed = seed.id;
      return false;
    }
    await insertEntries(makeEntries(tracks, 'radio'), usePlayer.getState().entries.length, 'radio');
    log.info('player', `nối radio ${tracks.length} bài từ ${seed.id}`);
    return true;
  } catch (err) {
    radioFailedSeed = seed.id;
    log.warn('player', 'nối radio lỗi:', errorMessage(err));
    return false;
  } finally {
    radioBusy = false;
  }
}

// ---------- Lịch sử & lưu hàng chờ ----------

function recordHistory(track: Track) {
  const now = Date.now();
  if (lastHistory && lastHistory.id === track.id && now - lastHistory.at < HISTORY_DEDUPE_MS) return;
  lastHistory = { id: track.id, at: now };
  void rememberTracks([track])
    .then(() => db.history.add({ trackId: track.id, playedAt: now }))
    .catch((err) => log.warn('player', 'ghi lịch sử lỗi:', err));
}

export function saveSnapshot() {
  clearTimeout(snapshotTimer);
  snapshotTimer = undefined;
  lastSnapshotAt = Date.now();
  const s = usePlayer.getState();
  try {
    if (!s.entries.length) {
      localStorage.removeItem(SNAPSHOT_KEY);
      return;
    }
    localStorage.setItem(
      SNAPSHOT_KEY,
      serializeSnapshot({
        entries: s.entries,
        index: s.index,
        position: s.position,
        repeat: s.repeat,
        shuffle: s.shuffle,
        originalOrder: s.originalOrder,
        context: s.context
      })
    );
  } catch (err) {
    log.warn('player', 'lưu hàng chờ lỗi:', err);
  }
}

function scheduleSnapshot() {
  if (snapshotTimer) return;
  const wait = Math.max(0, SNAPSHOT_THROTTLE_MS - (Date.now() - lastSnapshotAt));
  snapshotTimer = setTimeout(saveSnapshot, wait);
}

// ---------- Thay đổi hàng chờ ----------

async function replaceQueue(entries: QueueEntry[], startIndex: number, options: { position?: number; play?: boolean; keepCurrent?: boolean } = {}) {
  const items = await toItems(entries);
  await MeloPlayer.setQueue({
    items,
    startIndex,
    startPosition: options.position ?? 0,
    playWhenReady: options.play ?? true,
    keepCurrent: options.keepCurrent ?? false
  });
}

type InsertMode = 'next' | 'queue' | 'radio';

/** Vị trí trong thứ tự gốc (khi đang trộn bài) cho bài mới thêm, theo cùng quy tắc với hàng chờ hiện tại. */
function originalInsertIndex(state: PlayerStore, mode: InsertMode): number {
  const order = state.originalOrder ?? [];
  const current = currentEntry(state);
  const at = current ? order.indexOf(current.uid) : -1;
  if (mode === 'radio' || at < 0) return order.length;
  if (mode === 'next') return at + 1;
  const origins = new Map(state.entries.map((e) => [e.uid, e.origin]));
  let i = at + 1;
  while (i < order.length && origins.get(order[i]) === 'queue') i++;
  return i;
}

async function insertEntries(newEntries: QueueEntry[], at: number, mode: InsertMode) {
  if (!newEntries.length) return;
  const items = await toItems(newEntries);
  const state = usePlayer.getState();
  const position = Math.min(Math.max(at, 0), state.entries.length);
  const entries = [...state.entries.slice(0, position), ...newEntries, ...state.entries.slice(position)];
  const index = state.index >= 0 && position <= state.index ? state.index + newEntries.length : state.index;
  let originalOrder = state.originalOrder;
  if (originalOrder) {
    const insertAt = originalInsertIndex(state, mode);
    originalOrder = [...originalOrder.slice(0, insertAt), ...newEntries.map((e) => e.uid), ...originalOrder.slice(insertAt)];
  }
  set({ entries, index, originalOrder });
  await MeloPlayer.addItems({ items, index: position });
  saveSnapshot();
  void ensureUpcomingUrls();
}

/** Phát danh sách bài (album, playlist, kết quả tìm kiếm…) từ `startIndex`. */
/** Không có mạng: chỉ giữ các bài đã tải. Bài được chọn chưa tải thì không phát gì. */
async function offlinePlayable(tracks: Track[], startIndex: number): Promise<{ tracks: Track[]; startIndex: number; error?: string }> {
  const available = await Promise.all(tracks.map(async (t) => Boolean(await fileUrlProvider(t.id).catch(() => undefined))));
  if (!available[startIndex]) return { tracks: [], startIndex: 0, error: 'Không có mạng. Bài này chưa được tải về máy.' };
  const kept = tracks.filter((_, i) => available[i]);
  return { tracks: kept, startIndex: kept.indexOf(tracks[startIndex]) };
}

export async function playTracks(tracks: Track[], startIndex = 0, options: { context?: PlayContext; shuffle?: boolean } = {}) {
  if (!tracks.length) return;
  if (!isOnline()) {
    const playable = await offlinePlayable(tracks, Math.min(Math.max(startIndex, 0), tracks.length - 1));
    if (playable.error) {
      set({ error: playable.error });
      return;
    }
    ({ tracks, startIndex } = playable);
  }
  const shuffle = options.shuffle ?? usePlayer.getState().shuffle;
  let entries = makeEntries(tracks);
  let index = Math.min(Math.max(startIndex, 0), entries.length - 1);
  let originalOrder: string[] | undefined;
  if (shuffle) {
    originalOrder = entries.map((e) => e.uid);
    entries = shuffleKeepingCurrent(entries, index);
    index = 0;
  }
  radioFailedSeed = undefined;
  set({ entries, index, shuffle, originalOrder, context: options.context, position: 0, positionAt: Date.now(), error: undefined });
  void rememberTracks(tracks).catch(() => undefined);
  await replaceQueue(entries, index);
  saveSnapshot();
  void ensureUpcomingUrls();
  void maybeAppendRadio();
}

/** Bắt đầu radio từ một bài. */
export function playRadio(track: Track) {
  return playTracks([track], 0, { context: { type: 'radio', id: track.id, title: `Radio ${track.title}` }, shuffle: false });
}

export async function playNext(tracks: Track[]) {
  const { entries, index } = usePlayer.getState();
  if (index < 0) return playTracks(tracks);
  await insertEntries(makeEntries(tracks, 'queue'), insertPosition(entries, index, 'next'), 'next');
}

export async function addToQueue(tracks: Track[]) {
  const { entries, index } = usePlayer.getState();
  if (index < 0) return playTracks(tracks);
  await insertEntries(makeEntries(tracks, 'queue'), insertPosition(entries, index, 'queue'), 'queue');
}

export async function removeAt(position: number) {
  const state = usePlayer.getState();
  const removed = state.entries[position];
  if (!removed) return;
  const entries = state.entries.filter((_, i) => i !== position);
  let index = state.index;
  if (position < index) index -= 1;
  else if (position === index && index >= entries.length) index = entries.length - 1;
  set({ entries, index, originalOrder: state.originalOrder?.filter((uid) => uid !== removed.uid) });
  await MeloPlayer.removeItem({ index: position });
  saveSnapshot();
  void ensureUpcomingUrls();
}

export async function move(from: number, to: number) {
  const state = usePlayer.getState();
  const { entries } = state;
  if (from === to || from < 0 || to < 0 || from >= entries.length || to >= entries.length) return;
  const next = [...entries];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  let index = state.index;
  if (index === from) index = to;
  else if (from < index && to >= index) index -= 1;
  else if (from > index && to <= index) index += 1;
  set({ entries: next, index });
  await MeloPlayer.moveItem({ from, to });
  saveSnapshot();
  void ensureUpcomingUrls();
}

export async function toggleShuffle() {
  const state = usePlayer.getState();
  const current = currentEntry(state);
  if (!state.entries.length || !current) {
    set({ shuffle: !state.shuffle });
    return;
  }
  let entries: QueueEntry[];
  let originalOrder: string[] | undefined;
  if (state.shuffle && state.originalOrder) {
    const byUid = new Map(state.entries.map((e) => [e.uid, e]));
    entries = state.originalOrder.map((uid) => byUid.get(uid)).filter((e): e is QueueEntry => Boolean(e));
    // Bài thêm vào mà thiếu trong thứ tự gốc thì giữ ở cuối.
    const known = new Set(state.originalOrder);
    entries.push(...state.entries.filter((e) => !known.has(e.uid)));
    originalOrder = undefined;
  } else {
    originalOrder = state.entries.map((e) => e.uid);
    entries = shuffleKeepingCurrent(state.entries, state.index);
  }
  const index = entries.findIndex((e) => e.uid === current.uid);
  set({ entries, index, shuffle: !state.shuffle, originalOrder });
  await replaceQueue(entries, index, { keepCurrent: true, play: state.playing });
  saveSnapshot();
  void ensureUpcomingUrls();
}

export async function setRepeat(mode: RepeatMode) {
  set({ repeat: mode });
  await MeloPlayer.setRepeat({ mode });
  void ensureUpcomingUrls();
}

export function cycleRepeat() {
  const order: RepeatMode[] = ['off', 'all', 'one'];
  const { repeat } = usePlayer.getState();
  return setRepeat(order[(order.indexOf(repeat) + 1) % order.length]);
}

const AUTOPLAY_KEY = 'melo.autoplay';

export function setAutoplay(autoplay: boolean) {
  set({ autoplay });
  try {
    localStorage.setItem(AUTOPLAY_KEY, autoplay ? '1' : '0');
  } catch {
    // bỏ qua
  }
  if (autoplay) void maybeAppendRadio();
}

export const togglePlay = () => (usePlayer.getState().playing ? MeloPlayer.pause() : MeloPlayer.play());
export const play = () => MeloPlayer.play();
export const pause = () => MeloPlayer.pause();
export const next = () => MeloPlayer.next();
export const previous = () => MeloPlayer.previous();
export const skipTo = (index: number) => MeloPlayer.skipTo({ index });
export const setSleepTimer = (minutes: number, endOfItem = false) => MeloPlayer.setSleepTimer({ minutes, endOfItem });

export function seekTo(position: number) {
  set({ position, positionAt: Date.now() });
  return MeloPlayer.seekTo({ position });
}

export function clearError() {
  set({ error: undefined });
}

/** Một bài vừa tải xong hoặc bị xoá: báo native để lần phát sau dùng file / dùng link. */
export async function refreshLocalFile(trackId: string) {
  const fileUrl = await fileUrlProvider(trackId).catch(() => undefined);
  if (fileUrl) localFiles.add(trackId);
  else localFiles.delete(trackId);
  await MeloPlayer.updateItem({ id: trackId, fileUrl: fileUrl ?? '' });
  if (!fileUrl) void ensureUpcomingUrls();
}

// ---------- Khởi động ----------

async function restoreSnapshot() {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(SNAPSHOT_KEY);
  } catch {
    return;
  }
  const snapshot = parseSnapshot(raw);
  if (!snapshot) return;
  set({
    entries: snapshot.entries,
    index: snapshot.index,
    position: snapshot.position,
    positionAt: Date.now(),
    repeat: snapshot.repeat,
    shuffle: snapshot.shuffle,
    originalOrder: snapshot.originalOrder,
    context: snapshot.context
  });
  const native = await MeloPlayer.getState();
  const sameQueue =
    native.queueLength === snapshot.entries.length && native.index >= 0 && native.id === snapshot.entries[native.index]?.track.id;
  if (sameQueue) {
    // WebView tải lại trong lúc native vẫn đang phát: giữ nguyên, chỉ đồng bộ.
    onState(native);
  } else {
    await replaceQueue(snapshot.entries, snapshot.index, { position: snapshot.position, play: false });
    await MeloPlayer.setRepeat({ mode: snapshot.repeat });
  }
  void ensureUpcomingUrls();
}

async function watchNetwork() {
  try {
    const status = await Network.getStatus();
    lastConnectionType = status.connectionType;
    setNetworkStatus(status.connected, status.connectionType);
    await Network.addListener('networkStatusChange', (s) => {
      const changed = s.connectionType !== lastConnectionType;
      lastConnectionType = s.connectionType;
      setNetworkStatus(s.connected, s.connectionType);
      if (!changed || !s.connected) return;
      // Link YouTube gắn với IP: đổi Wi-Fi ↔ 4G thì link cũ hỏng, phải lấy lại.
      log.info('player', `mạng đổi sang ${s.connectionType}: lấy lại link`);
      clearAudioCache();
      sentUrls.clear();
      radioFailedSeed = undefined;
      void ensureUpcomingUrls();
      void maybeAppendRadio();
    });
  } catch (err) {
    log.warn('player', 'không theo dõi được mạng:', err);
  }
}

/** Gọi một lần khi app khởi động. */
export function initPlayer(): Promise<void> {
  initialized ??= (async () => {
    try {
      if (localStorage.getItem(AUTOPLAY_KEY) === '0') set({ autoplay: false });
    } catch {
      // bỏ qua
    }
    // Mỗi listener là một hàm riêng (Capacitor gỡ listener theo tham chiếu hàm).
    await MeloPlayer.addListener('state', (s) => onState(s));
    await MeloPlayer.addListener('itemChanged', (e) => onItemChanged(e));
    await MeloPlayer.addListener('needsUrl', (e) => void onNeedsUrl(e));
    await MeloPlayer.addListener('error', (e) => onError(e));
    await MeloPlayer.addListener('queueEnded', () => void onQueueEnded());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') saveSnapshot();
    });
    await watchNetwork();
    await restoreSnapshot().catch((err) => log.warn('player', 'khôi phục hàng chờ lỗi:', err));
  })();
  return initialized;
}

/** Chỉ dùng trong test. */
export function __resetPlayerForTests(options: { sleep?: (ms: number) => Promise<void> } = {}) {
  sentUrls.clear();
  localFiles.clear();
  resolveGeneration = 0;
  radioBusy = false;
  radioFailedSeed = undefined;
  consecutiveResolveFailures = 0;
  lastHistory = undefined;
  lastSnapshotAt = 0;
  clearTimeout(snapshotTimer);
  snapshotTimer = undefined;
  initialized = undefined;
  fileUrlProvider = async () => undefined;
  artworkFileProvider = async () => undefined;
  setNetworkStatus(true, 'unknown');
  sleepFn = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  usePlayer.setState({ ...initialPlayerState }, true);
}
