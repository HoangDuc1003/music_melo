// Jamendo: kho nhạc Creative Commons có API cho app bên thứ ba. Bản web của Melo dùng nguồn này
// (trình duyệt không gọi thẳng YouTube được, và Melo không có server trung gian).
// Tài liệu API: https://developer.jamendo.com/v3.0
import { getSetting, setSetting } from '@/lib/db';
import type { AlbumPage, ArtistPage, Card, PlaylistPage, Shelf, ShelfItem, Track } from '@/youtube/types';

const API = 'https://api.jamendo.com/v3.0';
const CLIENT_ID_SETTING = 'jamendoClientId';
const IMAGE_SIZE = 300;
/** id bài trong Melo = "jm-" + id Jamendo (không trùng file nhạc tự thêm "lf-…"). */
export const JAMENDO_PREFIX = 'jm-';
export const DEVPORTAL_URL = 'https://devportal.jamendo.com';

/** Lỗi đã viết sẵn bằng tiếng Việt để hiện thẳng cho người dùng. */
export class JamendoError extends Error {
  constructor(
    message: string,
    readonly needsSetup = false
  ) {
    super(message);
    this.name = 'JamendoError';
  }
}

// ---------- Client ID ----------

export const isValidJamendoClientId = (value: string) => /^[A-Za-z0-9]{6,40}$/.test(value.trim());

/** Client ID nhập trong Cài đặt, hoặc gắn lúc build (biến VITE_JAMENDO_CLIENT_ID trên Vercel). Không phải bí mật. */
export async function getJamendoClientId(): Promise<string | undefined> {
  const saved = await getSetting<string>(CLIENT_ID_SETTING, '');
  const value = saved || (import.meta.env.VITE_JAMENDO_CLIENT_ID as string | undefined) || '';
  return isValidJamendoClientId(value) ? value.trim() : undefined;
}

export async function setJamendoClientId(value: string): Promise<void> {
  await setSetting(CLIENT_ID_SETTING, value.trim());
}

// ---------- Gọi API ----------

interface Envelope<T> {
  headers?: { status?: string; code?: number; error_message?: string };
  results?: T[];
}

async function call<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T[]> {
  const clientId = await getJamendoClientId();
  if (!clientId) throw new JamendoError('Chưa có Client ID Jamendo. Vào Cài đặt → Nguồn nhạc để nhập (miễn phí, làm một lần).', true);
  const query = new URLSearchParams({ client_id: clientId, format: 'json' });
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') query.set(key, String(value));
  let res: Response;
  try {
    res = await fetch(`${API}${path}?${query}`);
  } catch {
    throw new JamendoError('Không kết nối được Jamendo. Kiểm tra mạng rồi thử lại.');
  }
  const body = (await res.json().catch(() => ({}))) as Envelope<T>;
  if (!res.ok || body.headers?.status === 'failed') {
    const message = body.headers?.error_message ?? `HTTP ${res.status}`;
    if (/client.?id/i.test(message)) throw new JamendoError('Client ID Jamendo không đúng. Kiểm tra lại trong Cài đặt → Nguồn nhạc.', true);
    throw new JamendoError(`Jamendo báo lỗi: ${message}`);
  }
  return body.results ?? [];
}

// ---------- Chuyển dữ liệu Jamendo → kiểu của app ----------

interface RawTrack {
  id: string;
  name: string;
  duration?: number;
  artist_id?: string;
  artist_name?: string;
  album_id?: string;
  album_name?: string;
  album_image?: string;
  image?: string;
  audio?: string;
  audiodownload?: string;
  audiodownload_allowed?: boolean;
  musicinfo?: { tags?: { genres?: string[] } };
}

interface RawAlbum {
  id: string;
  name: string;
  artist_id?: string;
  artist_name?: string;
  image?: string;
  releasedate?: string;
  tracks?: RawTrack[];
}

interface RawArtist {
  id: string;
  name: string;
  image?: string;
  tracks?: RawTrack[];
}

interface RawPlaylist {
  id: string;
  name: string;
  user_name?: string;
  tracks?: RawTrack[];
}

/** Link phát / tải của các bài đã gặp (để bắt đầu phát ngay, không phải hỏi lại API). */
export interface AudioLinks {
  stream: string;
  /** undefined: nghệ sĩ không cho tải về */
  download?: string;
}
const audioLinks = new Map<string, AudioLinks>();

export const getKnownAudioLinks = (id: string) => audioLinks.get(id);

/** Bài Jamendo → Track. `album`: bài lấy từ trang album thường thiếu tên/ảnh album. */
export function toTrack(raw: RawTrack, album?: Partial<RawAlbum>): Track {
  const id = `${JAMENDO_PREFIX}${raw.id}`;
  if (raw.audio) audioLinks.set(id, { stream: raw.audio, download: raw.audiodownload_allowed === false ? undefined : raw.audiodownload || raw.audio });
  const artistId = raw.artist_id ?? album?.artist_id;
  const artistName = raw.artist_name ?? album?.artist_name;
  const albumId = raw.album_id ?? album?.id;
  const albumName = raw.album_name ?? album?.name;
  return {
    id,
    title: raw.name,
    artists: artistName ? [{ id: artistId, name: artistName }] : [],
    album: albumName ? { id: albumId, name: albumName } : undefined,
    duration: Number(raw.duration) || 0,
    thumbnail: raw.image || raw.album_image || album?.image || ''
  };
}

const albumCard = (a: RawAlbum): Card => ({ kind: 'album', id: a.id, title: a.name, subtitle: a.artist_name ?? 'Album', thumbnail: a.image ?? '' });
const artistCard = (a: RawArtist): Card => ({ kind: 'artist', id: a.id, title: a.name, subtitle: 'Nghệ sĩ', thumbnail: a.image ?? '' });
const playlistCard = (p: RawPlaylist): Card => ({
  kind: 'playlist',
  id: p.id,
  title: p.name,
  subtitle: p.user_name ? `Playlist • ${p.user_name}` : 'Playlist',
  thumbnail: p.tracks?.[0]?.image ?? ''
});
const trackItems = (raws: RawTrack[]): ShelfItem[] => raws.map((r) => ({ type: 'track', track: toTrack(r) }));
const cardItems = (cards: Card[]): ShelfItem[] => cards.map((card) => ({ type: 'card', card }));

/** Tham số chung cho danh sách bài: ảnh vừa đủ, MP3 chất lượng cao. */
const TRACK_PARAMS = { imagesize: IMAGE_SIZE, audioformat: 'mp32', audiodlformat: 'mp32' };
const rawId = (id: string) => id.replace(JAMENDO_PREFIX, '');

// ---------- Các trang ----------

const GENRES: [tag: string, title: string][] = [
  ['pop', 'Pop'],
  ['acoustic', 'Acoustic thư giãn'],
  ['lounge', 'Lounge & chill'],
  ['electronic', 'Điện tử'],
  ['piano', 'Piano'],
  ['rock', 'Rock']
];

export async function getHome(): Promise<Shelf[]> {
  const shelves: Promise<Shelf>[] = [
    call<RawTrack>('/tracks/', { ...TRACK_PARAMS, order: 'popularity_week', limit: 20 }).then((r) => ({ title: 'Thịnh hành tuần này', items: trackItems(r) })),
    call<RawAlbum>('/albums/', { imagesize: IMAGE_SIZE, order: 'popularity_month', limit: 12 }).then((r) => ({ title: 'Album nổi bật', items: cardItems(r.map(albumCard)) })),
    call<RawArtist>('/artists/', { imagesize: IMAGE_SIZE, order: 'popularity_month', limit: 12 }).then((r) => ({ title: 'Nghệ sĩ được nghe nhiều', items: cardItems(r.map(artistCard)) })),
    ...GENRES.map(([tag, title]) =>
      call<RawTrack>('/tracks/', { ...TRACK_PARAMS, tags: tag, order: 'popularity_month', limit: 12 }).then((r) => ({ title, items: trackItems(r) }))
    )
  ];
  const settled = await Promise.allSettled(shelves);
  const ok = settled.flatMap((s) => (s.status === 'fulfilled' && s.value.items.length ? [s.value] : []));
  if (!ok.length) {
    const failed = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected');
    if (failed) throw failed.reason;
  }
  return ok;
}

export async function searchTracks(query: string, limit = 30): Promise<Track[]> {
  return (await call<RawTrack>('/tracks/', { ...TRACK_PARAMS, search: query, limit })).map((r) => toTrack(r));
}

export async function searchCards(kind: Card['kind'], query: string): Promise<Card[]> {
  if (kind === 'album') return (await call<RawAlbum>('/albums/', { imagesize: IMAGE_SIZE, namesearch: query, limit: 20 })).map(albumCard);
  if (kind === 'artist') return (await call<RawArtist>('/artists/', { imagesize: IMAGE_SIZE, namesearch: query, limit: 20 })).map(artistCard);
  return (await call<RawPlaylist>('/playlists/', { namesearch: query, limit: 20 })).map(playlistCard);
}

/** Gợi ý khi gõ: tên bài/nghệ sĩ/album bắt đầu bằng chữ đã gõ. */
export async function autocomplete(prefix: string): Promise<string[]> {
  const [result] = await call<Record<string, (string | { match?: string })[]>>('/autocomplete/', { prefix, limit: 4, entity: 'tracks+artists+albums' }).catch(() => []);
  const words = Object.values(result ?? {})
    .flat()
    .map((w) => (typeof w === 'string' ? w : (w?.match ?? '')))
    .filter(Boolean);
  return [...new Set(words.map((w) => w.toLowerCase()))].slice(0, 6);
}

export async function getAlbum(id: string): Promise<AlbumPage> {
  const [album] = await call<RawAlbum>('/albums/tracks/', { ...TRACK_PARAMS, id });
  if (!album) throw new JamendoError('Album này không còn trên Jamendo.');
  return {
    id,
    title: album.name,
    subtitle: [album.artist_name, album.releasedate?.slice(0, 4)].filter(Boolean).join(' • '),
    artists: album.artist_name ? [{ id: album.artist_id, name: album.artist_name }] : [],
    thumbnail: album.image ?? '',
    tracks: (album.tracks ?? []).map((t) => toTrack(t, album))
  };
}

export async function getArtist(id: string): Promise<ArtistPage> {
  const [[artist], top, albums] = await Promise.all([
    call<RawArtist>('/artists/', { imagesize: 500, id }),
    call<RawTrack>('/tracks/', { ...TRACK_PARAMS, artist_id: id, order: 'popularity_total', limit: 20 }),
    call<RawAlbum>('/albums/', { imagesize: IMAGE_SIZE, artist_id: id, order: 'releasedate_desc', limit: 20 })
  ]);
  if (!artist) throw new JamendoError('Nghệ sĩ này không còn trên Jamendo.');
  return {
    id,
    name: artist.name,
    thumbnail: artist.image || top[0]?.album_image || '',
    topTracks: top.map((t) => toTrack(t)),
    shelves: albums.length ? [{ title: 'Album', items: cardItems(albums.map(albumCard)) }] : []
  };
}

export async function getPlaylist(id: string): Promise<PlaylistPage> {
  const [playlist] = await call<RawPlaylist>('/playlists/tracks/', { ...TRACK_PARAMS, id });
  if (!playlist) throw new JamendoError('Playlist này không còn trên Jamendo.');
  const tracks = (playlist.tracks ?? []).map((t) => toTrack(t));
  return {
    id,
    title: playlist.name,
    subtitle: playlist.user_name ? `Playlist của ${playlist.user_name}` : 'Playlist trên Jamendo',
    thumbnail: tracks[0]?.thumbnail ?? '',
    tracks
  };
}

/** Radio: bài gốc + các bài cùng thể loại được nghe nhiều (Jamendo không có API "bài tương tự"). */
export async function getRadio(seedId: string): Promise<Track[]> {
  const [seed] = await call<RawTrack>('/tracks/', { ...TRACK_PARAMS, id: rawId(seedId), include: 'musicinfo' });
  if (!seed) return [];
  const genre = seed.musicinfo?.tags?.genres?.[0];
  const similar = genre
    ? await call<RawTrack>('/tracks/', { ...TRACK_PARAMS, tags: genre, order: 'popularity_month', limit: 40 })
    : await call<RawTrack>('/tracks/', { ...TRACK_PARAMS, artist_id: seed.artist_id, order: 'popularity_total', limit: 20 });
  return [toTrack(seed), ...similar.filter((t) => t.id !== seed.id).map((t) => toTrack(t))];
}

/** Link phát/tải của một bài (sau khi mở lại app thì bộ nhớ trong đã mất, hỏi lại API). */
export async function fetchAudioLinks(id: string): Promise<AudioLinks | undefined> {
  const known = audioLinks.get(id);
  if (known) return known;
  const [raw] = await call<RawTrack>('/tracks/', { ...TRACK_PARAMS, id: rawId(id) });
  if (raw) toTrack(raw);
  return audioLinks.get(id);
}

/** Chỉ dùng trong test. */
export function __clearJamendoCacheForTests() {
  audioLinks.clear();
}
