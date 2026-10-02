// Đọc thư viện Spotify của chính người dùng (Web API, Development Mode).
// Theo đợt đổi API tháng 2/2026: danh sách bài của playlist ở /playlists/{id}/items (mỗi mục có `item`,
// bản cũ là `track`), và chỉ đọc được playlist mình sở hữu hoặc cùng chỉnh sửa.
import { appFetch } from '@/youtube/http';
import { getAccessToken } from './spotify-auth';

const API = 'https://api.spotify.com/v1';
/** Chặn vòng lặp vô hạn nếu `next` hỏng: 400 trang × 50 = 20.000 bài. */
const MAX_PAGES = 400;

export interface SpotifyUser {
  id: string;
  name: string;
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  snapshotId: string;
  ownerId: string;
  collaborative: boolean;
  image?: string;
  total: number;
}

/** Thông tin đủ để tìm bài tương ứng trên YouTube Music. */
export interface SourceTrack {
  /** id Spotify, hoặc khoá tự tạo khi nhập từ file */
  key: string;
  title: string;
  artists: string[];
  album?: string;
  /** ms, 0 nếu không biết */
  durationMs: number;
}

export class SpotifyApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'SpotifyApiError';
  }
}

let sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function request<T>(url: string): Promise<T> {
  // Không bao giờ gửi token tới host khác (link `next` lấy từ phản hồi).
  if (!url.startsWith(`${API}/`)) throw new SpotifyApiError(0, 'Link Spotify không hợp lệ');
  let forceRefresh = false;
  for (let attempt = 0; ; attempt++) {
    const token = await getAccessToken(forceRefresh);
    const res = await appFetch(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } });
    if (res.ok) return (await res.json()) as T;
    if (res.status === 401 && !forceRefresh) {
      forceRefresh = true;
      continue;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      const retryAfter = Number(res.headers.get('retry-after'));
      await sleep(Math.min(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt, 30_000));
      continue;
    }
    let message = `Spotify trả lỗi ${res.status}`;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body.error?.message) message = `Spotify: ${body.error.message}`;
    } catch {
      // bỏ qua
    }
    throw new SpotifyApiError(res.status, message);
  }
}

interface Page<T> {
  items: T[];
  next: string | null;
}

async function* pages<T>(path: string): AsyncGenerator<T[]> {
  let url: string | null = `${API}${path}`;
  for (let i = 0; url && i < MAX_PAGES; i++) {
    const page: Page<T> = await request<Page<T>>(url);
    yield page.items ?? [];
    url = page.next;
  }
}

async function collect<T, R>(path: string, map: (item: T) => R | undefined): Promise<R[]> {
  const out: R[] = [];
  for await (const items of pages<T>(path)) {
    for (const item of items) {
      const mapped = map(item);
      if (mapped !== undefined) out.push(mapped);
    }
  }
  return out;
}

export async function getMe(): Promise<SpotifyUser> {
  const me = await request<{ id: string; display_name?: string | null }>(`${API}/me`);
  return { id: me.id, name: me.display_name || me.id };
}

interface RawPlaylist {
  id: string;
  name: string;
  snapshot_id: string;
  owner?: { id?: string };
  collaborative?: boolean;
  images?: { url: string }[] | null;
  items?: { total?: number };
  tracks?: { total?: number };
}

export function getPlaylists(): Promise<SpotifyPlaylist[]> {
  return collect<RawPlaylist | null, SpotifyPlaylist>('/me/playlists?limit=50', (p) =>
    p?.id
      ? {
          id: p.id,
          name: p.name || 'Playlist Spotify',
          snapshotId: p.snapshot_id,
          ownerId: p.owner?.id ?? '',
          collaborative: Boolean(p.collaborative),
          image: p.images?.[0]?.url,
          total: p.items?.total ?? p.tracks?.total ?? 0
        }
      : undefined
  );
}

interface RawTrack {
  id?: string | null;
  type?: string;
  name?: string;
  is_local?: boolean;
  duration_ms?: number;
  artists?: { name?: string }[];
  album?: { name?: string };
}

/** Bỏ podcast, bài file trên máy (không có id) và bài đã bị gỡ. */
export function toSourceTrack(raw: RawTrack | null | undefined): SourceTrack | undefined {
  if (!raw?.id || raw.is_local || (raw.type && raw.type !== 'track') || !raw.name) return undefined;
  return {
    key: raw.id,
    title: raw.name,
    artists: (raw.artists ?? []).map((a) => a.name ?? '').filter(Boolean),
    album: raw.album?.name,
    durationMs: raw.duration_ms ?? 0
  };
}

type RawEntry = { item?: RawTrack | null; track?: RawTrack | null } | null;

export function getPlaylistTracks(playlistId: string): Promise<SourceTrack[]> {
  return collect<RawEntry, SourceTrack>(`/playlists/${encodeURIComponent(playlistId)}/items?limit=50&additional_types=track`, (e) =>
    toSourceTrack(e?.item ?? e?.track)
  );
}

/** "Bài hát đã thích", mới thích trước. */
export function getSavedTracks(): Promise<SourceTrack[]> {
  return collect<RawEntry, SourceTrack>('/me/tracks?limit=50', (e) => toSourceTrack(e?.track ?? e?.item));
}

/** Chỉ dùng trong test. */
export function __setSpotifySleepForTests(fn: (ms: number) => Promise<void>) {
  sleep = fn;
}
