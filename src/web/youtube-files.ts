// Bản web: tải nhạc YouTube về máy qua trang chuyển đổi.
// Trang web không tự lấy được file nhạc của YouTube (không có máy chủ trung gian), nên Melo mở trang chuyển đổi người dùng
// tự chọn kèm link video. Người dùng tải file MP3 về app Tệp rồi chọn file đó trong Melo: file được gắn vào đúng bài
// YouTube (cùng id "yt-…") như bài đã tải, nghe offline và tắt màn hình vẫn phát (thẻ <audio>, không cần trình phát nhúng).
import { addLocalFiles, removeDownloads, type LocalFile } from '@/downloads/manager';
import { db, getSetting, getTracks, rememberTracks, setSetting } from '@/lib/db';
import { fold, similarity } from '@/lib/text';
import { refreshLocalFile } from '@/player/controller';
import type { Track } from '@/youtube/types';
import { YOUTUBE_PREFIX } from './youtube';

const CONVERTER_SETTING = 'ytConverterUrl';
const PENDING_SETTING = 'ytPendingFiles';
/** Bài chờ file quá 7 ngày thì bỏ khỏi danh sách chờ. */
const PENDING_MS = 7 * 24 * 3600_000;
const MAX_PENDING = 50;

export const isYouTubeVideo = (id: string) => id.startsWith(YOUTUBE_PREFIX);
const videoId = (trackId: string) => trackId.slice(YOUTUBE_PREFIX.length);
export const watchUrl = (trackId: string) => `https://www.youtube.com/watch?v=${videoId(trackId)}`;

// ---------- Trang chuyển đổi ----------

export function isValidConverterUrl(value: string): boolean {
  try {
    const url = new URL(value.trim().replace(/\{(url|id)\}/g, 'x'));
    return url.protocol === 'https:' && url.hostname.includes('.');
  } catch {
    return false;
  }
}

export async function getConverterUrl(): Promise<string> {
  return getSetting<string>(CONVERTER_SETTING, '');
}

export async function setConverterUrl(value: string): Promise<void> {
  await setSetting(CONVERTER_SETTING, value.trim());
}

/** Địa chỉ mở trang chuyển đổi: "{url}" = link video (đã mã hoá), "{id}" = id video; không có thì mở nguyên trang. */
export function converterLink(template: string, trackId: string): string {
  return template.replace(/\{url\}/g, encodeURIComponent(watchUrl(trackId))).replace(/\{id\}/g, videoId(trackId));
}

// ---------- Danh sách bài đang chờ file ----------

interface PendingRow {
  id: string;
  at: number;
}

async function pendingRows(now = Date.now()): Promise<PendingRow[]> {
  const rows = await getSetting<PendingRow[]>(PENDING_SETTING, []);
  return rows.filter((r) => isYouTubeVideo(r.id) && now - r.at < PENDING_MS);
}

/** Đánh dấu bài đang chờ file (người dùng vừa mở trang chuyển đổi cho bài này). */
export async function markPending(track: Track, now = Date.now()): Promise<void> {
  await rememberTracks([track]);
  const rows = (await pendingRows(now)).filter((r) => r.id !== track.id);
  await setSetting(PENDING_SETTING, [{ id: track.id, at: now }, ...rows].slice(0, MAX_PENDING));
}

export async function removePending(id: string): Promise<void> {
  await setSetting(
    PENDING_SETTING,
    (await pendingRows()).filter((r) => r.id !== id)
  );
}

/** Bài đang chờ file, mới nhất trước (bài đã có file thì thôi chờ). */
export async function getPendingTracks(): Promise<Track[]> {
  const rows = await pendingRows();
  const done = await db.downloads.bulkGet(rows.map((r) => r.id));
  return getTracks(rows.filter((_, i) => done[i]?.status !== 'done').map((r) => r.id));
}

// ---------- Khớp file với bài đang chờ ----------

/** Phần thừa trong tên file của các trang chuyển đổi: "y2mate.com - …", "…_128kbps", tên trang. */
const FILE_JUNK = [
  /^[\w-]+(\.[\w-]+)*\.[a-z]{2,6}\s*[-_–—]\s*/i,
  /[\s_-]*[([]?\b\d{2,3}\s?kbps\b[)\]]?/gi,
  /\b(y2mate|y2meta|yt1s|ytmp3|yt2mp3|savefrom|ssyoutube|mp3juices?|tomp3)\b/gi
];

export function cleanFileName(name: string): string {
  let text = name.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/_/g, ' ');
  for (const junk of FILE_JUNK) text = text.replace(junk, ' ');
  return text.replace(/\s{2,}/g, ' ').trim();
}

export interface FileInfo {
  fileName: string;
  /** tên bài đọc trong thẻ ID3 (hoặc từ tên file) */
  title: string;
  artist?: string;
  /** giây, 0 nếu không đọc được */
  duration: number;
}

const MIN_SCORE = 0.75;
/** Chữ không nói lên bài nào: "Official Music Video", "Lyrics", "4K"… */
const FILLER = new Set(['official', 'music', 'video', 'mv', 'audio', 'lyric', 'lyrics', 'hd', '4k', 'karaoke', 'vietsub', 'engsub', 'ft', 'feat', 'prod', 'visualizer', 'topic', 'vevo']);

/** Phần lõi của tên bài: bỏ chữ thừa và tên nghệ sĩ (tên file thường có hoặc không có tên ca sĩ). */
function core(text: string, artistWords: Set<string>): string {
  return fold(text)
    .split(' ')
    .filter((w) => w && !FILLER.has(w) && !artistWords.has(w))
    .join(' ');
}

function nameScore(file: FileInfo, track: Track): number {
  const artists = [...track.artists.map((a) => a.name), file.artist ?? ''];
  const artistWords = new Set(artists.flatMap((name) => fold(name).split(' ')).filter(Boolean));
  const fileNames = [cleanFileName(file.fileName), file.title].map((n) => core(n, artistWords)).filter(Boolean);
  // Tên video kiểu "SƠN TÙNG M-TP | LẠC TRÔI | OFFICIAL MUSIC VIDEO": so cả từng đoạn.
  const trackNames = [track.title, ...track.title.split(/[|｜]/)].map((n) => core(n, artistWords)).filter(Boolean);
  let best = 0;
  for (const a of fileNames) for (const b of trackNames) best = Math.max(best, similarity(a, b));
  return best;
}

/** Thời lượng lệch quá nhiều (đều biết) thì không phải cùng bài. */
function durationFits(file: FileInfo, track: Track): boolean {
  if (!file.duration || !track.duration) return true;
  return Math.abs(file.duration - track.duration) <= Math.max(10, track.duration * 0.05);
}

/**
 * Bài đang chờ ứng với file vừa chọn: tên file có id video thì chắc chắn; không thì so tên (≥ 0.75, hơn hẳn bài thứ hai)
 * và thời lượng. Chỉ so với các bài đang chờ nên ít khi nhầm.
 */
export function matchPending(file: FileInfo, pending: Track[]): Track | undefined {
  const byId = pending.find((t) => file.fileName.includes(videoId(t.id)));
  if (byId) return byId;
  const scored = pending
    .filter((t) => durationFits(file, t))
    .map((track) => ({ track, score: nameScore(file, track) }))
    .sort((a, b) => b.score - a.score);
  const [best, second] = scored;
  if (!best || best.score < MIN_SCORE) return undefined;
  if (second && best.score < 1 && best.score - second.score < 0.1) return undefined;
  return best.track;
}

// ---------- Gắn file vào bài YouTube ----------

/** Lưu file như bản đã tải của bài YouTube (giữ tên, ảnh, nghệ sĩ của video); bài đang phát thì chuyển sang file ngay. */
export async function attachToVideo(track: Track, file: LocalFile): Promise<void> {
  if (!isYouTubeVideo(track.id)) throw new Error('Chỉ gắn file cho bài YouTube');
  if (await db.downloads.get(track.id)) await removeDownloads([track.id]);
  const video = { ...track, duration: track.duration || file.track.duration };
  await addLocalFiles([{ track: video, audio: file.audio, artwork: file.artwork }]);
  await removePending(track.id);
  await refreshLocalFile(track.id).catch(() => undefined);
}
