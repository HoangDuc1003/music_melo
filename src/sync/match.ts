// Tìm bài Spotify tương ứng trên YouTube Music: so tên bài, nghệ sĩ, thời lượng.
// Kết quả lưu vào db.spotifyMatches để lần đồng bộ sau không phải tìm lại.
import { Semaphore } from '@/lib/async';
import { db, rememberTracks } from '@/lib/db';
import { log } from '@/lib/log';
import { cleanArtist, cleanTitle, fold } from '@/lib/text';
import { search } from '@/youtube/music';
import { tracksOf } from '@/youtube/normalize';
import type { Track } from '@/youtube/types';
import type { SourceTrack } from './spotify-api';

/** Không tìm thấy: 7 ngày sau mới thử lại (YouTube có thể đã có bài). */
const MISS_RETRY_MS = 7 * 24 * 3600_000;
/** Tìm 2 bài cùng lúc, đủ nhanh mà YouTube không chặn. */
const MATCH_PARALLEL = 2;
const MIN_SCORE = 0.7;
const MIN_ARTIST = 0.4;

/** Bỏ phần phụ trong tên bài Spotify: "(feat. X)", "(with X)", " - Remastered 2011", " - Live". */
export function cleanSpotifyTitle(title: string): string {
  return title
    .replace(/\s*[([](feat\.?|ft\.?|with|featuring)\s[^)\]]*[)\]]/gi, '')
    .replace(/\s+-\s+[^-]*\b(remaster(ed)?|version|live|edit|mix|mono|stereo|acoustic|instrumental|ver)\b.*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Độ giống nhau 0..1 theo từ (hệ số Dice); chuỗi này nằm trọn trong chuỗi kia thì ≥ 0.9. */
export function similarity(a: string, b: string): number {
  const A = fold(a);
  const B = fold(b);
  if (!A || !B) return 0;
  if (A === B) return 1;
  const ta = A.split(' ');
  const tb = B.split(' ');
  const pool = new Map<string, number>();
  for (const t of tb) pool.set(t, (pool.get(t) ?? 0) + 1);
  let common = 0;
  for (const t of ta) {
    const left = pool.get(t) ?? 0;
    if (left > 0) {
      common += 1;
      pool.set(t, left - 1);
    }
  }
  const dice = (2 * common) / (ta.length + tb.length);
  const contained = ` ${B} `.includes(` ${A} `) || ` ${A} `.includes(` ${B} `);
  return contained ? Math.max(dice, 0.9) : dice;
}

export interface MatchScore {
  total: number;
  title: number;
  artist: number;
}

/** Điểm của một kết quả YouTube cho bài Spotify `src`. */
function scoreCandidate(src: SourceTrack, cand: Track): MatchScore {
  const title = similarity(cleanSpotifyTitle(src.title), cleanTitle(cand.title));
  const candArtists = cand.artists.map((a) => cleanArtist(a.name));
  let artist = src.artists.length ? 0 : 0.5;
  for (const sa of src.artists) {
    for (const ca of candArtists) artist = Math.max(artist, similarity(sa, ca));
    // Video thường ghi "Nghệ sĩ - Tên bài" ngay trong tiêu đề.
    if (similarity(sa, cand.title) >= 0.9) artist = Math.max(artist, 0.8);
  }
  let duration = 0.5;
  if (src.durationMs > 0 && cand.duration > 0) {
    const diff = Math.abs(src.durationMs / 1000 - cand.duration);
    duration = diff <= 3 ? 1 : diff <= 10 ? 0.7 : diff <= 30 ? 0.3 : 0;
  }
  return { total: 0.55 * title + 0.3 * artist + 0.15 * duration, title, artist };
}

/** Kết quả tốt nhất đủ điểm, hoặc undefined (thà bỏ còn hơn ghép nhầm bài khác / bản cover). */
export function pickBest(src: SourceTrack, candidates: Track[]): Track | undefined {
  let best: { track: Track; score: MatchScore } | undefined;
  for (const track of candidates) {
    const score = scoreCandidate(src, track);
    if (!best || score.total > best.score.total) best = { track, score };
  }
  if (!best || best.score.total < MIN_SCORE || best.score.artist < MIN_ARTIST) return undefined;
  return best.track;
}

/** Tìm bài hát trước, không thấy thì tìm trong video (bài chỉ có MV). */
export async function findOnYouTube(src: SourceTrack): Promise<Track | undefined> {
  const query = `${cleanSpotifyTitle(src.title)} ${src.artists[0] ?? ''}`.trim();
  const top = async (type: 'song' | 'video') => tracksOf(await search(query, type)).slice(0, 8);
  return pickBest(src, await top('song')) ?? pickBest(src, await top('video'));
}

export interface MatchOptions {
  onProgress?: (done: number, total: number) => void;
  /** Tối đa số bài tìm mới trong lượt này (thư viện lớn: phần còn lại để lượt sau, tránh YouTube chặn). */
  maxSearches?: number;
  /** Trả về true thì dừng (người dùng ngắt kết nối). */
  cancelled?: () => boolean;
}

export interface MatchResult {
  /** key Spotify → videoId */
  matches: Map<string, string>;
  /** số bài chưa tìm trong lượt này (vượt `maxSearches` hoặc bị dừng) */
  pending: number;
}

/**
 * Ghép nhiều bài (bỏ trùng). Bài đã ghép trước đó dùng lại kết quả; lỗi mạng thì không ghi nhớ là "không tìm thấy".
 */
export async function matchTracks(tracks: SourceTrack[], options: MatchOptions = {}): Promise<MatchResult> {
  const { onProgress, maxSearches = Infinity, cancelled = () => false } = options;
  const unique = [...new Map(tracks.map((t) => [t.key, t])).values()];
  const cached = await db.spotifyMatches.bulkGet(unique.map((t) => t.key));
  const matches = new Map<string, string>();
  const todo: SourceTrack[] = [];
  const now = Date.now();
  unique.forEach((track, i) => {
    const row = cached[i];
    if (row?.videoId) matches.set(track.key, row.videoId);
    else if (!row || now - row.checkedAt >= MISS_RETRY_MS) todo.push(track);
  });
  const batch = todo.slice(0, maxSearches);
  let pending = todo.length - batch.length;
  const total = unique.length - pending;
  let done = total - batch.length;
  onProgress?.(done, total);
  const gate = new Semaphore(MATCH_PARALLEL);
  await Promise.all(
    batch.map((track) =>
      gate.run(async () => {
        if (cancelled()) {
          pending += 1;
          return;
        }
        try {
          const found = await findOnYouTube(track);
          if (found) {
            await rememberTracks([found]);
            matches.set(track.key, found.id);
          }
          await db.spotifyMatches.put({ id: track.key, videoId: found?.id, checkedAt: Date.now() });
        } catch (err) {
          log.warn('spotify', `tìm "${track.title}" lỗi:`, err);
        } finally {
          done += 1;
          onProgress?.(done, total);
        }
      })
    )
  );
  return { matches, pending };
}
