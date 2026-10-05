// Nối giao diện ↔ plugin MeloPlayer (native giữ hàng chờ và tự chuyển bài khi khoá máy).
// JS lo phần cần mạng: lấy sẵn link cho ~20 bài tới, xin link mới khi native báo `needsUrl`,
// nối radio khi sắp hết bài, lưu hàng chờ để mở app là nghe tiếp, ghi lịch sử.
import {
  MeloPlayer,
  type NeedsUrlEvent,
  type PlayerErrorEvent,
  type PlayerItem,
  type PlayerState,
  type RepeatMode
} from 'capacitor-melo-player';
import { sleep } from '@/lib/async';
import { db, rememberTracks } from '@/lib/db';
import { joinArtists } from '@/lib/format';
import { errorMessage, log } from '@/lib/log';
import { isOnline, setNetworkStatus, useNetwork } from '@/lib/network';
import { getUpNext } from '@/youtube/music';
import { clearAudioCache, getCachedAudio, resolveAudio } from '@/youtube/stream';
import type { Track } from '@/youtube/types';
import {
  freshRadioTracks,
  indexAfterInsert,
  indexAfterMove,
  indexAfterRemove,
  insertIntoOriginalOrder,
  insertPosition,
  makeEntries,
  parseSnapshot,
  serializeSnapshot,
  shouldAppendRadio,
  shuffleKeepingCurrent,
  unshuffle,
  upcomingIndices,
  withoutSmartPicks,
  withSmartPicks,
  type InsertMode,
  type PlayContext,
  type QueueEntry
} from './queue';
import { currentEntry, initialPlayerState, usePlayer, type PlayerStore } from './store';

/** Link sống ~6 giờ: chuẩn bị sẵn 20 bài ≈ 1–1,5 giờ nghe khi khoá máy. */
const PRERESOLVE_AHEAD = 20;
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
/** Lượt nối radio đang chạy (người gọi sau đợi chung kết quả, không chạy lượt thứ hai). */
let radioInFlight: Promise<boolean> | undefined;
let radioFailedSeed: string | undefined;
let lastHistory: { id: string; at: number } | undefined;
let lastSnapshotAt = 0;
let snapshotTimer: ReturnType<typeof setTimeout> | undefined;
/** Số bài liên tiếp không lấy được link (để không chuyển bài mãi khi mất mạng). */
let consecutiveResolveFailures = 0;
let initialized: Promise<void> | undefined;
let unwatchNetwork: (() => void) | undefined;

function set(partial: Partial<PlayerStore>) {
  usePlayer.setState(partial);
}

/**
 * Mọi thay đổi hàng chờ chạy lần lượt: lệnh sau chỉ bắt đầu khi lệnh trước đã gửi xong cho native.
 * Chạm nhanh (phát album này rồi album khác, "Phát tiếp" khi hàng chờ đang tạo…) nên không làm hàng chờ JS lệch native.
 * Hàm chạy bên trong khoá không được `await` một hàm khác cũng lấy khoá (sẽ treo).
 */
let queueLock: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = queueLock.then(fn);
  queueLock = run.catch(() => undefined);
  return run;
}

// ---------- Chuyển Track → PlayerItem ----------

/** File đã tải của bài (nếu có); ghi nhớ để không lấy link YouTube cho bài này. */
async function lookupLocalFile(trackId: string): Promise<string | undefined> {
  const fileUrl = await fileUrlProvider(trackId).catch(() => undefined);
  if (fileUrl) localFiles.add(trackId);
  else localFiles.delete(trackId);
  return fileUrl;
}

async function toItem(track: Track): Promise<PlayerItem> {
  const fileUrl = await lookupLocalFile(track.id);
  const localArt = fileUrl ? await artworkFileProvider(track.id).catch(() => undefined) : undefined;
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
function ensureUpcomingUrls(): Promise<void> {
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
      if (count >= PRERESOLVE_URGENT) await sleep(PRERESOLVE_GAP_MS);
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

/** Còn ≤3 bài thì nối radio (YouTube Music automix) từ bài cuối hàng chờ. Trả về true nếu đã nối thêm bài. */
function maybeAppendRadio(): Promise<boolean> {
  radioInFlight ??= appendRadio().finally(() => (radioInFlight = undefined));
  return radioInFlight;
}

async function appendRadio(): Promise<boolean> {
  const { entries, index, repeat, autoplay } = usePlayer.getState();
  if (!autoplay || !isOnline() || !shouldAppendRadio(entries.length, index, repeat)) return false;
  const last = entries[entries.length - 1];
  const seed = last.track;
  if (radioFailedSeed === seed.id) return false;
  try {
    const tracks = freshRadioTracks(await getUpNext(seed.id), entries.map((e) => e.track));
    if (!tracks.length) {
      radioFailedSeed = seed.id;
      return false;
    }
    // Trong lúc chờ mạng người dùng có thể đã đổi hàng chờ: chỉ nối khi bài cuối vẫn là bài làm gốc.
    const added = await exclusive(async () => {
      const current = usePlayer.getState().entries;
      if (current[current.length - 1]?.uid !== last.uid) return false;
      await insertEntries(makeEntries(tracks, 'radio'), 'radio');
      return true;
    });
    if (!added) return false;
    log.info('player', `nối radio ${tracks.length} bài từ ${seed.id}`);
    return true;
  } catch (err) {
    radioFailedSeed = seed.id;
    log.warn('player', 'nối radio lỗi:', errorMessage(err));
    return false;
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
        smartShuffle: s.smartShuffle,
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

/** Sau mỗi thay đổi hàng chờ: lưu lại và chuẩn bị link cho các bài tới. */
function afterQueueChange() {
  saveSnapshot();
  void ensureUpcomingUrls();
}

/** Chạy trong khoá. Vị trí tính từ trạng thái mới nhất, sau khi đã chuẩn bị xong item (bước có `await`). */
async function insertEntries(newEntries: QueueEntry[], mode: InsertMode) {
  if (!newEntries.length) return;
  const items = await toItems(newEntries);
  const state = usePlayer.getState();
  const position = insertPosition(state.entries, state.index, mode);
  set({
    entries: [...state.entries.slice(0, position), ...newEntries, ...state.entries.slice(position)],
    index: indexAfterInsert(state.index, position, newEntries.length),
    originalOrder: state.originalOrder && insertIntoOriginalOrder(state.originalOrder, state.entries, currentEntry(state)?.uid, newEntries, mode)
  });
  await MeloPlayer.addItems({ items, index: position });
  afterQueueChange();
}

/** Không có mạng: chỉ giữ các bài đã tải. Bài được chọn chưa tải thì không phát gì. */
async function offlinePlayable(tracks: Track[], startIndex: number): Promise<{ tracks: Track[]; startIndex: number; error?: string }> {
  const available = await Promise.all(tracks.map(async (t) => Boolean(await fileUrlProvider(t.id).catch(() => undefined))));
  if (!available[startIndex]) return { tracks: [], startIndex: 0, error: 'Không có mạng. Bài này chưa được tải về máy.' };
  const kept = tracks.filter((_, i) => available[i]);
  return { tracks: kept, startIndex: kept.indexOf(tracks[startIndex]) };
}

type PlayOptions = { context?: PlayContext; shuffle?: boolean };

/** Phát danh sách bài (album, playlist, kết quả tìm kiếm…) từ `startIndex`. */
export function playTracks(tracks: Track[], startIndex = 0, options: PlayOptions = {}): Promise<void> {
  return exclusive(() => playTracksLocked(tracks, startIndex, options));
}

async function playTracksLocked(tracks: Track[], startIndex: number, options: PlayOptions) {
  if (!tracks.length) return;
  startIndex = Math.min(Math.max(startIndex, 0), tracks.length - 1);
  if (!isOnline()) {
    const playable = await offlinePlayable(tracks, startIndex);
    if (playable.error) {
      set({ error: playable.error });
      return;
    }
    ({ tracks, startIndex } = playable);
  }
  const shuffle = options.shuffle ?? usePlayer.getState().shuffle;
  let entries = makeEntries(tracks);
  let index = startIndex;
  let originalOrder: string[] | undefined;
  if (shuffle) {
    originalOrder = entries.map((e) => e.uid);
    entries = shuffleKeepingCurrent(entries, index);
    index = 0;
  }
  radioFailedSeed = undefined;
  set({ entries, index, shuffle, smartShuffle: false, originalOrder, context: options.context, position: 0, positionAt: Date.now(), error: undefined });
  void rememberTracks(tracks).catch(() => undefined);
  await replaceQueue(entries, index);
  afterQueueChange();
  void maybeAppendRadio();
}

/** Bắt đầu radio từ một bài. */
export function playRadio(track: Track) {
  return playTracks([track], 0, { context: { type: 'radio', id: track.id, title: `Radio ${track.title}` }, shuffle: false });
}

function enqueue(tracks: Track[], mode: 'next' | 'queue'): Promise<void> {
  return exclusive(async () => {
    if (usePlayer.getState().index < 0) return playTracksLocked(tracks, 0, {});
    await insertEntries(makeEntries(tracks, 'queue'), mode);
  });
}

export const playNext = (tracks: Track[]) => enqueue(tracks, 'next');
export const addToQueue = (tracks: Track[]) => enqueue(tracks, 'queue');

/**
 * Vị trí giao diện đưa vào có thể đã cũ nếu lệnh trước đó (đang đợi khoá) làm đổi hàng chờ.
 * Có `uid` thì tìm lại đúng bài; không còn bài đó thì trả về -1.
 */
function resolvePosition(entries: readonly QueueEntry[], position: number, uid?: string): number {
  if (!uid || entries[position]?.uid === uid) return position;
  return entries.findIndex((e) => e.uid === uid);
}

export function removeAt(position: number, uid?: string): Promise<void> {
  return exclusive(async () => {
    const state = usePlayer.getState();
    const at = resolvePosition(state.entries, position, uid);
    const removed = state.entries[at];
    if (!removed) return;
    const entries = state.entries.filter((_, i) => i !== at);
    set({ entries, index: indexAfterRemove(state.index, at, entries.length), originalOrder: state.originalOrder?.filter((u) => u !== removed.uid) });
    await MeloPlayer.removeItem({ index: at });
    afterQueueChange();
  });
}

/** `uid`: bài đang kéo; hàng chờ đổi trước khi lệnh chạy thì dời cả `to` theo. */
export function move(from: number, to: number, uid?: string): Promise<void> {
  return exclusive(async () => {
    const { entries, index } = usePlayer.getState();
    const source = resolvePosition(entries, from, uid);
    if (source < 0 || source >= entries.length) return;
    // Bài đã dời chỗ (lệnh trước đổi hàng chờ): đích dời theo cùng khoảng.
    const target = Math.min(Math.max(to + source - from, 0), entries.length - 1);
    if (source === target) return;
    const next = [...entries];
    const [moved] = next.splice(source, 1);
    next.splice(target, 0, moved);
    set({ entries: next, index: indexAfterMove(index, source, target) });
    await MeloPlayer.moveItem({ from: source, to: target });
    afterQueueChange();
  });
}

/** Bật/tắt trộn bài (tắt thì gỡ luôn bài gợi ý của Trộn thông minh). */
export function toggleShuffle(): Promise<void> {
  return exclusive(() => setShuffleLocked(!usePlayer.getState().shuffle));
}

async function setShuffleLocked(on: boolean) {
  const state = usePlayer.getState();
  const current = currentEntry(state);
  if (!state.entries.length || !current) {
    set({ shuffle: on, smartShuffle: false });
    return;
  }
  if (on === state.shuffle) return;
  let entries: QueueEntry[];
  if (on) {
    entries = shuffleKeepingCurrent(state.entries, state.index);
  } else {
    const base = withoutSmartPicks(state.entries, current.uid);
    entries = state.originalOrder ? unshuffle(base, state.originalOrder) : base;
  }
  const index = entries.findIndex((e) => e.uid === current.uid);
  set({ entries, index, shuffle: on, smartShuffle: false, originalOrder: on ? state.entries.map((e) => e.uid) : undefined });
  await replaceQueue(entries, index, { keepCurrent: true, play: state.playing });
  afterQueueChange();
}

// ---------- Trộn thông minh (Smart Shuffle kiểu Spotify Premium) ----------

/** Một bài gợi ý sau mỗi chừng này bài, tối đa SMART_MAX bài. */
const SMART_EVERY = 3;
const SMART_MAX = 20;

/** Bài gợi ý: radio từ bài đang phát và 2 bài khác trong danh sách, lấy xen kẽ cho đa dạng, bỏ bài đã có. */
async function smartPicks(entries: readonly QueueEntry[], index: number): Promise<Track[]> {
  const upcoming = entries.slice(index + 1);
  const want = Math.min(SMART_MAX, Math.ceil(upcoming.length / SMART_EVERY));
  if (!want || !isOnline()) return [];
  const seeds = [entries[index], ...shuffleKeepingCurrent(upcoming, -1).slice(0, 2)].filter(Boolean).map((e) => e.track);
  const lists = await Promise.all(seeds.map((seed) => getUpNext(seed.id).catch(() => [])));
  const taken = new Set(entries.map((e) => e.track.id));
  const picks: Track[] = [];
  for (let i = 0; picks.length < want && lists.some((list) => i < list.length); i++) {
    for (const list of lists) {
      const track = list[i];
      if (!track || taken.has(track.id) || picks.length >= want) continue;
      taken.add(track.id);
      picks.push(track);
    }
  }
  return picks;
}

export type ShuffleMode = 'off' | 'shuffle' | 'smart';

export const shuffleMode = (state = usePlayer.getState()): ShuffleMode => (state.smartShuffle ? 'smart' : state.shuffle ? 'shuffle' : 'off');

/**
 * Nút trộn kiểu Spotify: tắt → trộn → trộn thông minh → tắt.
 * Không lấy được bài gợi ý (mất mạng…) thì tắt trộn luôn và báo `smartUnavailable`.
 */
export async function cycleShuffle(): Promise<{ mode: ShuffleMode; smartUnavailable?: boolean }> {
  const mode = shuffleMode();
  if (mode !== 'shuffle') {
    await toggleShuffle();
    return { mode: shuffleMode() };
  }
  const { entries, index } = usePlayer.getState();
  const picks = await smartPicks(entries, index);
  return exclusive(async () => {
    const state = usePlayer.getState();
    if (!state.shuffle || state.smartShuffle) return { mode: shuffleMode(state) };
    if (!picks.length) {
      await setShuffleLocked(false);
      return { mode: 'off' as const, smartUnavailable: true };
    }
    const added = makeEntries(picks, 'smart');
    const next = withSmartPicks(state.entries, state.index, added, SMART_EVERY);
    void rememberTracks(picks).catch(() => undefined);
    set({ entries: next, smartShuffle: true });
    await replaceQueue(next, state.index, { keepCurrent: true, play: state.playing });
    afterQueueChange();
    return { mode: 'smart' as const };
  });
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
  const fileUrl = await lookupLocalFile(trackId);
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
    smartShuffle: snapshot.smartShuffle ?? false,
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

/** Link YouTube gắn với IP: đổi Wi‑Fi ↔ 4G thì link cũ hỏng, phải lấy lại. */
function watchNetwork(): () => void {
  return useNetwork.subscribe((state, prev) => {
    // 'unknown' → loại mạng thật: chỉ là lần đọc trạng thái đầu tiên lúc mở app.
    if (!state.online || state.connectionType === prev.connectionType || prev.connectionType === 'unknown') return;
    log.info('player', `mạng đổi sang ${state.connectionType}: lấy lại link`);
    clearAudioCache();
    sentUrls.clear();
    radioFailedSeed = undefined;
    void ensureUpcomingUrls();
    void maybeAppendRadio();
  });
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
    await MeloPlayer.addListener('log', (e) => log.info('native', e.message));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') saveSnapshot();
    });
    unwatchNetwork = watchNetwork();
    await exclusive(restoreSnapshot).catch((err) => log.warn('player', 'khôi phục hàng chờ lỗi:', err));
  })();
  return initialized;
}

/** Chỉ dùng trong test. */
export function __resetPlayerForTests() {
  sentUrls.clear();
  localFiles.clear();
  resolveGeneration = 0;
  radioInFlight = undefined;
  radioFailedSeed = undefined;
  consecutiveResolveFailures = 0;
  lastHistory = undefined;
  lastSnapshotAt = 0;
  clearTimeout(snapshotTimer);
  snapshotTimer = undefined;
  initialized = undefined;
  unwatchNetwork?.();
  unwatchNetwork = undefined;
  queueLock = Promise.resolve();
  fileUrlProvider = async () => undefined;
  artworkFileProvider = async () => undefined;
  setNetworkStatus(true, 'unknown');
  usePlayer.setState({ ...initialPlayerState }, true);
}
