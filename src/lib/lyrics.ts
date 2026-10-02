// Lời bài hát: LRCLIB (có mốc thời gian, chạy theo nhạc) → không có thì lời của YouTube Music.
// Lời đã lấy được lưu vào IndexedDB để xem khi offline.
import { appFetch } from '@/youtube/http';
import { getYouTubeLyrics } from '@/youtube/music';
import type { Lyrics, LyricsLine, Track } from '@/youtube/types';
import { db } from './db';
import { isNative } from './platform';
import { log } from './log';
import { cleanArtist, cleanTitle } from './text';

const LRCLIB = 'https://lrclib.net/api';
/** Không tìm thấy lời: thử lại sau 7 ngày. */
const MISS_TTL_MS = 7 * 24 * 3600_000;

const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

/** Đọc định dạng LRC: "[01:23.45] lời", một dòng có thể có nhiều mốc; hỗ trợ [offset:±ms]. */
export function parseLrc(lrc: string): LyricsLine[] {
  const offsetMatch = /\[offset:\s*([+-]?\d+)\s*\]/i.exec(lrc);
  const offset = offsetMatch ? Number(offsetMatch[1]) / 1000 : 0;
  const lines: LyricsLine[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const times: number[] = [];
    let match: RegExpExecArray | null;
    TIME_TAG.lastIndex = 0;
    let last = 0;
    while ((match = TIME_TAG.exec(raw))) {
      if (match.index !== last) break; // mốc thời gian chỉ nằm ở đầu dòng
      const fraction = match[3] ? Number(match[3]) / 10 ** match[3].length : 0;
      times.push(Number(match[1]) * 60 + Number(match[2]) + fraction);
      last = TIME_TAG.lastIndex;
    }
    if (!times.length) continue;
    const text = raw.slice(last).trim();
    for (const time of times) lines.push({ time: Math.max(0, time - offset), text });
  }
  return lines.sort((a, b) => a.time - b.time);
}

/** Dòng đang hát ở vị trí `position` (giây); -1 nếu chưa tới dòng đầu. */
export function activeLineIndex(lines: readonly LyricsLine[], position: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= position + 0.15) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

interface LrclibRecord {
  trackName?: string;
  artistName?: string;
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

async function lrclib<T>(path: string, params: Record<string, string>): Promise<T | undefined> {
  const url = `${LRCLIB}${path}?${new URLSearchParams(params)}`;
  // Bản web gọi thẳng từ trình duyệt: header riêng sẽ cần xin phép CORS trước, nên chỉ gửi từ app iPhone.
  const res = await appFetch(url, isNative ? { headers: { 'Lrclib-Client': 'Melo (personal iPhone app)' } } : undefined);
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`LRCLIB ${res.status}`);
  return (await res.json()) as T;
}

function fromRecord(record: LrclibRecord | undefined): Lyrics | undefined {
  if (!record) return undefined;
  const synced = record.syncedLyrics ? parseLrc(record.syncedLyrics) : [];
  const plain = record.plainLyrics?.trim() || synced.map((l) => l.text).join('\n');
  if (!plain && !synced.length) return undefined;
  return { plain, synced: synced.length ? synced : undefined, source: 'LRCLIB' };
}

async function fromLrclib(track: Track): Promise<Lyrics | undefined> {
  const title = cleanTitle(track.title);
  const artist = cleanArtist(track.artists[0]?.name ?? '');
  if (!title) return undefined;
  if (artist && track.duration > 0) {
    const exact = fromRecord(
      await lrclib<LrclibRecord>('/get', { track_name: title, artist_name: artist, duration: String(Math.round(track.duration)) })
    );
    if (exact) return exact;
  }
  const results = (await lrclib<LrclibRecord[]>('/search', { q: `${title} ${artist}`.trim() })) ?? [];
  // Chọn bản có lời chạy theo nhạc và độ dài gần nhất (lệch ≤ 5 giây).
  const candidates = results.filter((r) => r.syncedLyrics || r.plainLyrics);
  const close = candidates.filter((r) => !track.duration || !r.duration || Math.abs(r.duration - track.duration) <= 5);
  const best = close.find((r) => r.syncedLyrics) ?? close[0];
  return fromRecord(best);
}

/** Lời bài hát (có cache). `undefined` = không tìm thấy. */
export async function getLyrics(track: Track): Promise<Lyrics | undefined> {
  const cached = await db.lyrics.get(track.id);
  if (cached) {
    if (cached.plain || cached.synced?.length) return { plain: cached.plain, synced: cached.synced, source: cached.source };
    if (Date.now() - cached.fetchedAt < MISS_TTL_MS) return undefined;
  }
  let lyrics: Lyrics | undefined;
  let lrclibFailed = false;
  try {
    lyrics = await fromLrclib(track);
  } catch (err) {
    lrclibFailed = true;
    log.warn('lyrics', 'LRCLIB lỗi:', err);
  }
  if (!lyrics) {
    try {
      const yt = await getYouTubeLyrics(track.id);
      if (yt) lyrics = { plain: yt.text, source: yt.source ?? 'YouTube Music' };
    } catch (err) {
      log.warn('lyrics', 'YouTube lyrics lỗi:', err);
      throw err;
    }
  }
  // Lỗi mạng ở LRCLIB thì không ghi nhớ "không có lời" (để lần sau thử lại).
  if (lyrics || !lrclibFailed) {
    await db.lyrics.put({ id: track.id, plain: lyrics?.plain ?? '', synced: lyrics?.synced, source: lyrics?.source, fetchedAt: Date.now() });
  }
  return lyrics;
}
