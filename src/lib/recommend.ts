// Gợi ý tự động kiểu Spotify ("Dành cho bạn"), tính ngay trên máy từ lịch sử nghe và bài đã thích:
// - Nghe lại: bài nghe nhiều nhất 30 ngày qua.
// - Daily Mix 1–3: mỗi mix quanh một nghệ sĩ bạn hay nghe: bài quen xen với bài mới từ radio.
// - Khám phá hằng tuần: bài chưa nghe bao giờ, gợi ý từ những bài bạn thích nhất (đổi mỗi thứ Hai).
// - Nhạc theo giờ (daylist): bài bạn hay nghe vào buổi này trong ngày + bài tương tự.
// Mix được lưu lại theo ngày/tuần (mở lại hay khi offline vẫn thấy), bài mới lấy từ radio (`getUpNext`).
import { Semaphore } from './async';
import { db, getSetting, getTracks, rememberTracks, setSetting, type HistoryRow, type LikeRow } from './db';
import { log } from './log';
import { fold } from './text';
import type { Track } from '@/youtube/types';

export type MixKind = 'repeat' | 'daily' | 'discover' | 'daylist';

export interface Mix {
  id: string;
  kind: MixKind;
  title: string;
  subtitle: string;
  trackIds: string[];
  /** ảnh bìa của bài đầu tiên có ảnh (làm ảnh mix) */
  cover?: string;
  /** ngày / tuần / buổi tạo ra mix: khác kỳ hiện tại thì tạo lại */
  period: string;
}

const DAY = 24 * 3600_000;
const MIX_SIZE = 30;
const MIXES_SETTING = 'mixes';
const DAILY_MIXES = 3;
const DISCOVER_SEEDS = 5;
/** Bài thích nặng ký bằng chừng này lượt nghe. */
const LIKE_WEIGHT = 3;

// ---------- Thời gian ----------

const pad = (n: number) => String(n).padStart(2, '0');
export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Thứ Hai của tuần (giờ máy): mix "Khám phá hằng tuần" đổi mỗi thứ Hai như Spotify. */
export function weekKey(d: Date): string {
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
  return `w${dayKey(monday)}`;
}

export type DayPart = 'morning' | 'noon' | 'afternoon' | 'evening' | 'night';
export const DAY_PART_LABEL: Record<DayPart, string> = { morning: 'buổi sáng', noon: 'buổi trưa', afternoon: 'buổi chiều', evening: 'buổi tối', night: 'đêm khuya' };

export function dayPart(d: Date): DayPart {
  const h = d.getHours();
  if (h >= 5 && h < 11) return 'morning';
  if (h >= 11 && h < 14) return 'noon';
  if (h >= 14 && h < 18) return 'afternoon';
  if (h >= 18 && h < 23) return 'evening';
  return 'night';
}

export function currentPeriods(now: Date): Record<MixKind, string> {
  const day = dayKey(now);
  return { repeat: day, daily: day, discover: weekKey(now), daylist: `${day}-${dayPart(now)}` };
}

// ---------- Tín hiệu từ lịch sử ----------

export function playCounts(history: readonly HistoryRow[], since = 0, filter: (row: HistoryRow) => boolean = () => true): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of history) if (row.playedAt >= since && filter(row)) counts.set(row.trackId, (counts.get(row.trackId) ?? 0) + 1);
  return counts;
}

/** Điểm "thích" của từng bài: số lượt nghe + LIKE_WEIGHT nếu đã bấm thích. */
export function trackScores(counts: Map<string, number>, likes: readonly LikeRow[]): Map<string, number> {
  const scores = new Map(counts);
  for (const like of likes) scores.set(like.id, (scores.get(like.id) ?? 0) + LIKE_WEIGHT);
  return scores;
}

const byScore = (scores: Map<string, number>) => (a: string, b: string) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0);

const artistKey = (track: Track) => {
  const artist = track.artists[0];
  return artist ? artist.id || fold(artist.name) : '';
};

export interface ArtistTaste {
  key: string;
  name: string;
  score: number;
  /** bài của nghệ sĩ này bạn đã nghe/thích, điểm cao trước */
  trackIds: string[];
}

/** Nghệ sĩ bạn hay nghe nhất (tổng điểm các bài của họ). */
export function topArtists(scores: Map<string, number>, tracks: Map<string, Track>): ArtistTaste[] {
  const artists = new Map<string, ArtistTaste>();
  for (const [id, score] of scores) {
    const track = tracks.get(id);
    const key = track && artistKey(track);
    if (!track || !key) continue;
    const taste = artists.get(key) ?? { key, name: track.artists[0].name, score: 0, trackIds: [] };
    taste.score += score;
    taste.trackIds.push(id);
    artists.set(key, taste);
  }
  const list = [...artists.values()];
  for (const a of list) a.trackIds.sort(byScore(scores));
  return list.sort((a, b) => b.score - a.score);
}

/** Xen bài quen với bài mới theo tỉ lệ 1 quen : `fresh` mới (bỏ trùng), tối đa `size` bài. */
export function interleave(known: readonly string[], fresh: readonly string[], freshPerKnown = 2, size = MIX_SIZE): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (id: string | undefined) => {
    if (id && !seen.has(id) && out.length < size) {
      seen.add(id);
      out.push(id);
    }
  };
  let k = 0;
  let f = 0;
  while (out.length < size && (k < known.length || f < fresh.length)) {
    push(known[k++]);
    for (let i = 0; i < freshPerKnown; i++) push(fresh[f++]);
  }
  return out;
}

/** "Sơn Tùng M-TP, Đen Vâu, Hà Anh và nhiều nghệ sĩ khác" */
function artistsLine(ids: readonly string[], tracks: Map<string, Track>): string {
  const names: string[] = [];
  for (const id of ids) {
    const name = tracks.get(id)?.artists[0]?.name;
    if (name && !names.includes(name)) names.push(name);
    if (names.length === 3) break;
  }
  return names.length ? `${names.join(', ')} và nhiều nghệ sĩ khác` : 'Nhạc dành cho bạn';
}

// ---------- Tạo mix ----------

export interface Signals {
  history: readonly HistoryRow[];
  likes: readonly LikeRow[];
  /** thông tin các bài trong lịch sử / đã thích */
  tracks: Map<string, Track>;
  now: Date;
}

/** Radio từ một bài (YouTube Music; bản web: Audius / Jamendo). Lỗi mạng thì trả về mảng rỗng. */
export type Radio = (seed: Track) => Promise<Track[]>;

/**
 * Tạo các mix thuộc loại `kinds`. Trả về mix + các bài mới gặp (cần lưu thông tin bài để mở mix khi offline).
 * Chưa đủ dữ liệu (nghe quá ít) thì loại đó không có mix.
 */
export async function buildMixes(signals: Signals, radio: Radio, kinds: ReadonlySet<MixKind>): Promise<{ mixes: Mix[]; found: Track[] }> {
  const { history, likes, tracks, now } = signals;
  const periods = currentPeriods(now);
  const time = now.getTime();
  const scores = trackScores(playCounts(history, time - 90 * DAY), likes);
  const heard = new Set([...history.map((h) => h.trackId), ...likes.map((l) => l.id)]);
  const found = new Map<string, Track>();
  const gate = new Semaphore(2);
  const radioIds = (seed: Track | undefined, exclude: ReadonlySet<string>) =>
    seed
      ? gate.run(async () => {
          const list = await radio(seed).catch(() => []);
          for (const t of list) found.set(t.id, t);
          return list.map((t) => t.id).filter((id) => id !== seed.id && !exclude.has(id));
        })
      : Promise.resolve([]);
  const tasks: Promise<Mix | undefined>[] = [];

  if (kinds.has('repeat')) {
    const counts = playCounts(history, time - 30 * DAY);
    const ids = [...counts.keys()].filter((id) => (counts.get(id) ?? 0) >= 2 && tracks.has(id)).sort(byScore(counts)).slice(0, MIX_SIZE);
    if (ids.length >= 5) {
      tasks.push(Promise.resolve({ id: 'repeat', kind: 'repeat' as const, title: 'Nghe lại', subtitle: 'Những bài bạn nghe nhiều nhất dạo này', trackIds: ids, period: periods.repeat }));
    }
  }

  if (kinds.has('daily')) {
    const artists = topArtists(scores, tracks).filter((a) => a.trackIds.length >= 2).slice(0, DAILY_MIXES);
    artists.forEach((artist, i) => {
      tasks.push(
        radioIds(tracks.get(artist.trackIds[0]), new Set()).then((fresh) => {
          const trackIds = interleave(artist.trackIds.slice(0, 12), fresh);
          const subtitle = artistsLine(trackIds, new Map([...tracks, ...found]));
          return { id: `daily-${i + 1}`, kind: 'daily' as const, title: `Daily Mix ${i + 1}`, subtitle, trackIds, period: periods.daily };
        })
      );
    });
  }

  if (kinds.has('discover')) {
    const seeds = [...scores.keys()].filter((id) => tracks.has(id)).sort(byScore(scores)).slice(0, DISCOVER_SEEDS);
    if (seeds.length >= 2) {
      tasks.push(
        Promise.all(seeds.map((id) => radioIds(tracks.get(id), heard))).then((lists) => {
          // Bài được nhiều bài gốc cùng gợi ý lên trước; cùng số lần thì bài đứng đầu radio trước.
          const votes = new Map<string, number>();
          lists.forEach((list) => list.forEach((id, rank) => votes.set(id, (votes.get(id) ?? 0) + 100 - Math.min(rank, 99))));
          const trackIds = [...votes.keys()].sort((a, b) => (votes.get(b) ?? 0) - (votes.get(a) ?? 0)).slice(0, MIX_SIZE);
          if (trackIds.length < 5) return undefined;
          return { id: 'discover', kind: 'discover' as const, title: 'Khám phá hằng tuần', subtitle: 'Bài bạn chưa nghe, chọn theo gu của bạn. Đổi mỗi thứ Hai', trackIds, period: periods.discover };
        })
      );
    }
  }

  if (kinds.has('daylist')) {
    const part = dayPart(now);
    const counts = playCounts(history, time - 60 * DAY, (row) => dayPart(new Date(row.playedAt)) === part);
    const known = [...counts.keys()].filter((id) => tracks.has(id)).sort(byScore(counts)).slice(0, 10);
    if (known.length >= 3) {
      tasks.push(
        radioIds(tracks.get(known[0]), new Set(known)).then((fresh) => ({
          id: 'daylist',
          kind: 'daylist' as const,
          title: `Nhạc ${DAY_PART_LABEL[part]} của bạn`,
          subtitle: `Bạn hay nghe những bài này vào ${DAY_PART_LABEL[part]}`,
          trackIds: interleave(known, fresh, 1),
          period: periods.daylist
        }))
      );
    }
  }

  const mixes = (await Promise.all(tasks)).filter((m): m is Mix => Boolean(m && m.trackIds.length));
  const known = new Map([...tracks, ...found]);
  for (const mix of mixes) mix.cover = mix.trackIds.map((id) => known.get(id)?.thumbnail).find(Boolean);
  return { mixes, found: [...found.values()] };
}

// ---------- Lưu / đọc ----------

const ORDER: MixKind[] = ['daylist', 'daily', 'discover', 'repeat'];

/**
 * Mix hiện tại: loại nào hết kỳ (ngày/tuần/buổi) thì tạo lại, còn lại dùng bản đã lưu.
 * Tạo lại lỗi (mất mạng…) thì giữ bản cũ.
 */
export async function getMixes(radio: Radio, now = new Date()): Promise<Mix[]> {
  const cached = await getSetting<Mix[]>(MIXES_SETTING, []);
  const periods = currentPeriods(now);
  const stale = new Set(ORDER.filter((kind) => !cached.some((m) => m.kind === kind && m.period === periods[kind])));
  if (!stale.size) return cached;
  try {
    const [history, likes] = await Promise.all([db.history.where('playedAt').above(now.getTime() - 90 * DAY).toArray(), db.likes.toArray()]);
    const ids = [...new Set([...history.map((h) => h.trackId), ...likes.map((l) => l.id)])];
    const tracks = new Map((await getTracks(ids)).map((t) => [t.id, t]));
    const { mixes, found } = await buildMixes({ history, likes, tracks, now }, radio, stale);
    await rememberTracks(found);
    // Loại đã tạo lại thay hẳn bản cũ (kể cả khi không còn đủ dữ liệu); loại còn hạn giữ nguyên.
    const result = [...cached.filter((m) => !stale.has(m.kind)), ...mixes].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || a.id.localeCompare(b.id));
    await setSetting(MIXES_SETTING, result);
    return result;
  } catch (err) {
    log.warn('recommend', 'tạo mix lỗi:', err);
    return cached;
  }
}

/** Mix đã lưu theo id (mở trang mix). */
export async function getMix(id: string): Promise<Mix | undefined> {
  return (await getSetting<Mix[]>(MIXES_SETTING, [])).find((m) => m.id === id);
}
