// Audius: nền tảng nhạc mở, nghệ sĩ tự đăng bài nên có bài mới mỗi ngày. API công khai: không cần đăng ký hay
// Client ID, cho trang web gọi thẳng (CORS) và nghe trọn bài. Bản web của Melo dùng làm nguồn chính.
// Tài liệu API: https://docs.audius.org/developers/api — mã nguồn máy chủ: github.com/AudiusProject/api
import { sleep } from '@/lib/async';
import type { AlbumPage, ArtistPage, Card, PlaylistPage, Shelf, Track } from '@/youtube/types';
import { cardItems, settleShelves, trackItems } from './shelves';

const API = 'https://api.audius.co/v1';
/** Audius đề nghị app bên thứ ba ghi tên app trong mỗi lần gọi. */
const APP_NAME = 'Melo';
/** id bài/nghệ sĩ/album trong Melo = "au-" + id Audius (không trùng Jamendo "jm-…", file tự thêm "lf-…"). */
export const AUDIUS_PREFIX = 'au-';
const DAY = 24 * 3600_000;

/** Lỗi đã viết sẵn bằng tiếng Việt để hiện thẳng cho người dùng. */
export class AudiusError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'AudiusError';
  }
}

// ---------- Gọi API ----------

// Không có API key thì Audius cho mỗi IP 5 lần gọi trong 1 giây (cửa sổ trượt). Melo giãn ra 4 lần / 1,1 giây (chừa chỗ
// cho trình phát nhạc tự gọi /stream); vẫn bị từ chối (429) thì đợi rồi thử lại.
const PER_WINDOW = 4;
const WINDOW_MS = 1100;
const RETRIES_429 = 2;
/** Giờ bắt đầu đã hẹn của các lần gọi gần nhất (chỉ cần giữ PER_WINDOW lần). */
let starts: number[] = [];

/** Hẹn giờ cho lần gọi tiếp theo: bắt đầu sau lần gọi đứng trước nó PER_WINDOW lần ít nhất WINDOW_MS. */
export async function throttle(): Promise<void> {
  const now = Date.now();
  const start = starts.length < PER_WINDOW ? now : Math.max(now, starts[starts.length - PER_WINDOW] + WINDOW_MS);
  starts = [...starts, start].slice(-PER_WINDOW);
  if (start > now) await sleep(start - now);
}

async function call<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T | undefined> {
  const query = new URLSearchParams({ app_name: APP_NAME });
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') query.set(key, String(value));
  const url = `${API}${path}?${query}`;
  for (let attempt = 0; ; attempt++) {
    await throttle();
    let res: Response;
    try {
      res = await fetch(url);
    } catch {
      throw new AudiusError('Không kết nối được Audius. Kiểm tra mạng rồi thử lại.');
    }
    if (res.status === 429 && attempt < RETRIES_429) {
      await sleep(1000 * (attempt + 1));
      continue;
    }
    if (res.status === 404) throw new AudiusError('Không tìm thấy trên Audius (có thể đã bị gỡ).', 404);
    if (!res.ok) throw new AudiusError(res.status === 429 ? 'Audius đang bận, thử lại sau ít phút.' : `Audius báo lỗi (HTTP ${res.status}).`, res.status);
    const body = (await res.json().catch(() => ({}))) as { data?: T };
    return body.data;
  }
}

/** Lấy danh sách (`data` là mảng). */
const list = async <T>(path: string, params?: Record<string, string | number | undefined>): Promise<T[]> => {
  const data = await call<T[]>(path, params);
  return Array.isArray(data) ? data : [];
};

/** Lấy một mục: tuỳ endpoint, `data` là object hoặc mảng một phần tử. */
const one = async <T>(path: string, params?: Record<string, string | number | undefined>): Promise<T | undefined> => {
  const data = await call<T | T[]>(path, params);
  return Array.isArray(data) ? data[0] : data;
};

// ---------- Chuyển dữ liệu Audius → kiểu của app ----------

type Images = Partial<Record<'150x150' | '480x480' | '1000x1000', string | null>> | null;

export interface RawUser {
  id: string;
  name: string;
  handle?: string;
  profile_picture?: Images;
  follower_count?: number;
  is_deactivated?: boolean;
}

export interface RawTrack {
  id: string;
  title: string;
  duration?: number;
  genre?: string | null;
  release_date?: string | null;
  created_at?: string | null;
  play_count?: number;
  artwork?: Images;
  user?: RawUser;
  is_streamable?: boolean;
  is_stream_gated?: boolean;
  is_delete?: boolean;
  access?: { stream?: boolean };
}

export interface RawPlaylist {
  id: string;
  playlist_name: string;
  is_album?: boolean;
  artwork?: Images;
  user?: RawUser;
  description?: string | null;
  release_date?: string | null;
  created_at?: string | null;
}

const image = (images: Images | undefined) => images?.['480x480'] || images?.['1000x1000'] || images?.['150x150'] || '';
const rawId = (id: string) => encodeURIComponent(id.replace(AUDIUS_PREFIX, ''));
const releasedAt = (raw: { release_date?: string | null; created_at?: string | null }) => Date.parse(raw.release_date || raw.created_at || '') || 0;

/** Bài nghe được mà không cần đăng nhập/mua (bỏ bài trả phí, bài đã gỡ). */
export const isPlayable = (raw: RawTrack) => raw.is_streamable !== false && !raw.is_stream_gated && !raw.is_delete && raw.access?.stream !== false;

const artistRef = (user: RawUser) => ({ id: `${AUDIUS_PREFIX}${user.id}`, name: user.name });

export function toTrack(raw: RawTrack): Track {
  return {
    id: `${AUDIUS_PREFIX}${raw.id}`,
    title: raw.title,
    artists: raw.user ? [artistRef(raw.user)] : [],
    duration: Number(raw.duration) || 0,
    thumbnail: image(raw.artwork)
  };
}

/** Chỉ giữ bài nghe được, bỏ bài trùng. */
function tracksOf(raws: RawTrack[]): Track[] {
  const seen = new Set<string>();
  return raws.filter((r) => isPlayable(r) && !seen.has(r.id) && seen.add(r.id)).map(toTrack);
}

const userCard = (user: RawUser): Card => ({ kind: 'artist', id: `${AUDIUS_PREFIX}${user.id}`, title: user.name, subtitle: 'Nghệ sĩ', thumbnail: image(user.profile_picture) });
const playlistCard = (p: RawPlaylist): Card => ({
  kind: p.is_album ? 'album' : 'playlist',
  id: `${AUDIUS_PREFIX}${p.id}`,
  title: p.playlist_name,
  subtitle: p.is_album ? (p.user?.name ?? 'Album') : p.user ? `Playlist • ${p.user.name}` : 'Playlist',
  thumbnail: image(p.artwork)
});

// ---------- Trang chủ ----------

const GENRES: [genre: string, title: string][] = [
  ['Pop', 'Pop'],
  ['Hip-Hop/Rap', 'Hip-hop & Rap'],
  ['Electronic', 'Điện tử'],
  ['R&B/Soul', 'R&B'],
  ['Lo-Fi', 'Lo-fi thư giãn']
];

/** Bài mới ra trong 30 ngày (ít quá thì 90 ngày) trong số các bài đang được nghe, mới nhất trước. */
export function newReleases(raws: RawTrack[], now: number, size = 20): Track[] {
  const dated = raws.filter((r) => releasedAt(r) <= now);
  for (const days of [30, 90]) {
    const recent = dated.filter((r) => releasedAt(r) >= now - days * DAY);
    if (recent.length >= 8 || days === 90) return tracksOf(recent.sort((a, b) => releasedAt(b) - releasedAt(a))).slice(0, size);
  }
  return [];
}

/** Nghệ sĩ của các bài đang thịnh hành, nhiều người theo dõi trước. */
function risingArtists(raws: RawTrack[], size = 12): Card[] {
  const users = new Map<string, RawUser>();
  for (const r of raws) if (r.user && !r.user.is_deactivated && isPlayable(r)) users.set(r.user.id, r.user);
  return [...users.values()]
    .sort((a, b) => (b.follower_count ?? 0) - (a.follower_count ?? 0))
    .slice(0, size)
    .map(userCard);
}

export async function getHome(now = Date.now()): Promise<Shelf[]> {
  const week = list<RawTrack>('/tracks/trending', { time: 'week', limit: 50 });
  const month = list<RawTrack>('/tracks/trending', { time: 'month', limit: 100 });
  return settleShelves([
    week.then((raws) => ({ title: 'Thịnh hành tuần này', items: trackItems(tracksOf(raws).slice(0, 20)) })),
    Promise.all([week, month.catch(() => [])]).then(([w, m]) => ({ title: 'Mới phát hành', items: trackItems(newReleases([...w, ...m], now)) })),
    week.then((raws) => ({ title: 'Nghệ sĩ đang nổi', items: cardItems(risingArtists(raws)) })),
    list<RawPlaylist>('/playlists/trending', { time: 'week', limit: 12 }).then((r) => ({ title: 'Playlist thịnh hành', items: cardItems(r.map(playlistCard)) })),
    ...GENRES.map(([genre, title]) => list<RawTrack>('/tracks/trending', { genre, time: 'week', limit: 15 }).then((r) => ({ title, items: trackItems(tracksOf(r)) })))
  ]);
}

// ---------- Tìm kiếm ----------

export async function searchTracks(query: string, limit = 30): Promise<Track[]> {
  return tracksOf(await list<RawTrack>('/tracks/search', { query, limit }));
}

export async function searchCards(kind: Card['kind'], query: string): Promise<Card[]> {
  if (kind === 'artist') return (await list<RawUser>('/users/search', { query, limit: 20 })).filter((u) => !u.is_deactivated).map(userCard);
  // Album trên Audius là một loại playlist.
  const found = await list<RawPlaylist>('/playlists/search', { query, limit: 30 });
  return found.filter((p) => Boolean(p.is_album) === (kind === 'album')).map(playlistCard);
}

// ---------- Album / playlist / nghệ sĩ ----------

async function getCollection(id: string): Promise<{ info: RawPlaylist; tracks: Track[] }> {
  const [info, raws] = await Promise.all([one<RawPlaylist>(`/playlists/${rawId(id)}`), list<RawTrack>(`/playlists/${rawId(id)}/tracks`)]);
  if (!info) throw new AudiusError('Playlist này không còn trên Audius.');
  const cover = image(info.artwork);
  return { info, tracks: tracksOf(raws).map((t) => ({ ...t, thumbnail: t.thumbnail || cover })) };
}

export async function getAlbum(id: string): Promise<AlbumPage> {
  const { info, tracks } = await getCollection(id);
  const year = info.release_date?.slice(0, 4) || info.created_at?.slice(0, 4);
  return {
    id,
    title: info.playlist_name,
    subtitle: [info.user?.name, year].filter(Boolean).join(' • '),
    artists: info.user ? [artistRef(info.user)] : [],
    thumbnail: image(info.artwork),
    tracks: tracks.map((t) => ({ ...t, album: { id, name: info.playlist_name } }))
  };
}

export async function getPlaylist(id: string): Promise<PlaylistPage> {
  const { info, tracks } = await getCollection(id);
  return {
    id,
    title: info.playlist_name,
    subtitle: info.user ? `Playlist của ${info.user.name}` : 'Playlist trên Audius',
    description: info.description ?? undefined,
    thumbnail: image(info.artwork) || tracks[0]?.thumbnail || '',
    tracks
  };
}

export async function getArtist(id: string): Promise<ArtistPage> {
  const user = rawId(id);
  const [info, popular, latest, albums, related] = await Promise.all([
    one<RawUser>(`/users/${user}`),
    list<RawTrack>(`/users/${user}/tracks`, { sort: 'plays', limit: 30 }),
    list<RawTrack>(`/users/${user}/tracks`, { sort: 'date', limit: 20 }).catch(() => []),
    list<RawPlaylist>(`/users/${user}/albums`, { limit: 20 }).catch(() => []),
    list<RawUser>(`/users/${user}/related`, { limit: 12 }).catch(() => [])
  ]);
  if (!info) throw new AudiusError('Nghệ sĩ này không còn trên Audius.');
  // Sắp xếp lại ở máy, phòng khi máy chủ bỏ qua tham số `sort`.
  const top = tracksOf([...popular].sort((a, b) => (b.play_count ?? 0) - (a.play_count ?? 0))).slice(0, 20);
  const newest = tracksOf([...latest].sort((a, b) => releasedAt(b) - releasedAt(a)));
  const shelves: Shelf[] = [
    { title: 'Mới nhất', items: trackItems(newest) },
    { title: 'Album', items: cardItems(albums.map(playlistCard)) },
    { title: 'Nghệ sĩ tương tự', items: cardItems(related.filter((u) => !u.is_deactivated).map(userCard)) }
  ];
  return {
    id,
    name: info.name,
    thumbnail: image(info.profile_picture) || top[0]?.thumbnail || '',
    topTracks: top,
    shelves: shelves.filter((s) => s.items.length)
  };
}

// ---------- Radio + link nhạc ----------

/** Radio: bài gốc + bài cùng thể loại đang thịnh hành, cứ 4 bài thì xen 1 bài khác của cùng nghệ sĩ. */
export async function getRadio(seedId: string): Promise<Track[]> {
  const seed = await one<RawTrack>(`/tracks/${rawId(seedId)}`);
  if (!seed) return [];
  const [genre, artist] = await Promise.all([
    seed.genre ? list<RawTrack>('/tracks/trending', { genre: seed.genre, time: 'month', limit: 50 }).catch(() => []) : [],
    seed.user ? list<RawTrack>(`/users/${encodeURIComponent(seed.user.id)}/tracks`, { sort: 'plays', limit: 10 }).catch(() => []) : []
  ]);
  const similar = tracksOf(genre);
  const sameArtist = tracksOf(artist);
  const out = [toTrack(seed)];
  const seen = new Set([seedId]);
  let s = 0;
  let a = 0;
  while (s < similar.length || a < sameArtist.length) {
    const fromArtist = a < sameArtist.length && (out.length % 4 === 0 || s >= similar.length);
    const next = fromArtist ? sameArtist[a++] : similar[s++];
    if (seen.has(next.id)) continue;
    seen.add(next.id);
    out.push(next);
  }
  return out;
}

/**
 * Link nghe trọn bài: Audius chuyển hướng (302) sang máy chủ nội dung đang chạy, link ký mới mỗi lần nên không hết hạn.
 * Tải về để nghe offline thì không tính là một lượt nghe (`skip_play_count`).
 */
export function streamUrl(id: string, download = false): string {
  const query = new URLSearchParams({ app_name: APP_NAME });
  if (download) query.set('skip_play_count', 'true');
  return `${API}/tracks/${rawId(id)}/stream?${query}`;
}
