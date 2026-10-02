// YouTube cho bản web: tìm kiếm và thông tin bài qua YouTube Data API v3 (trình duyệt gọi thẳng được, cần khoá API
// miễn phí của người dùng), phát bằng trình phát YouTube nhúng (xem plugins/player/src/youtube-engine.ts).
// Không tải về được: YouTube không cho phép, và trang web không có máy chủ trung gian.
// Hạn mức miễn phí 10.000 đơn vị/ngày: tìm kiếm tốn 100, các lệnh đọc khác tốn 1 → không gọi YouTube lúc đang gõ.
import { getSetting, setSetting } from '@/lib/db';
import { cleanArtist } from '@/lib/text';
import { apiErrorReason, bestThumbnail, decodeEntities, isoDuration, type Thumbnails } from '@/lib/youtube-data';
import type { ArtistPage, Card, PlaylistPage, Shelf, Track } from '@/youtube/types';
import { settleShelves, trackItems } from './shelves';

const API = 'https://www.googleapis.com/youtube/v3';
const KEY_SETTING = 'youtubeApiKey';
/** id trong Melo = "yt-" + id YouTube (video, kênh hoặc playlist). */
export const YOUTUBE_PREFIX = 'yt-';
/** Link phát của bài YouTube: trình phát của bản web nhận ra tiền tố này và dùng trình phát nhúng. */
export const YOUTUBE_SCHEME = 'youtube:';
const MUSIC_CATEGORY = '10';
const REGION = 'VN';
/** Playlist dài thì chỉ đọc 200 bài đầu (4 lần gọi). */
const PLAYLIST_PAGES = 4;

export class YouTubeError extends Error {
  constructor(
    message: string,
    readonly needsSetup = false
  ) {
    super(message);
    this.name = 'YouTubeError';
  }
}

// ---------- Khoá API ----------

export const isValidYouTubeApiKey = (value: string) => /^AIza[\w-]{35}$/.test(value.trim());

/** Khoá nhập trong Cài đặt (chỉ lưu trong trình duyệt này), hoặc gắn lúc build (VITE_YOUTUBE_API_KEY trên Vercel). */
export async function getYouTubeApiKey(): Promise<string | undefined> {
  const saved = await getSetting<string>(KEY_SETTING, '');
  const value = saved || (import.meta.env.VITE_YOUTUBE_API_KEY as string | undefined) || '';
  return isValidYouTubeApiKey(value) ? value.trim() : undefined;
}

export async function setYouTubeApiKey(value: string): Promise<void> {
  await setSetting(KEY_SETTING, value.trim());
}

const NO_KEY = 'Chưa có khoá API YouTube. Vào Cài đặt → Nguồn nhạc → YouTube để thêm (miễn phí, làm một lần).';

// ---------- Gọi API ----------

/** Lỗi Google → câu tiếng Việt người dùng làm theo được. */
function explain(status: number, reason: string | undefined, message: string | undefined): YouTubeError {
  switch (reason) {
    case 'quotaExceeded':
    case 'RATE_LIMIT_EXCEEDED':
      return new YouTubeError('Hết lượt dùng YouTube hôm nay (Google cho 10.000 đơn vị/ngày, mỗi lần tìm tốn 100). Khoảng 14–15 giờ chiều mai (giờ Việt Nam) dùng lại được.');
    case 'keyInvalid':
    case 'API_KEY_INVALID':
      return new YouTubeError('Khoá API YouTube không đúng. Kiểm tra lại trong Cài đặt → Nguồn nhạc → YouTube.', true);
    case 'API_KEY_HTTP_REFERRER_BLOCKED':
      return new YouTubeError('Khoá API YouTube đang chặn trang này. Trong Google Cloud, thêm địa chỉ web của Melo vào mục "Website restrictions" của khoá.', true);
    case 'API_KEY_SERVICE_BLOCKED':
    case 'accessNotConfigured':
    case 'SERVICE_DISABLED':
      return new YouTubeError('Khoá API chưa được dùng YouTube Data API v3. Bật API này trong Google Cloud (xem hướng dẫn).', true);
    default:
      return new YouTubeError(`YouTube báo lỗi: ${message ?? `HTTP ${status}`}`);
  }
}

async function call<T>(path: string, params: Record<string, string | number | undefined>): Promise<T> {
  const key = await getYouTubeApiKey();
  if (!key) throw new YouTubeError(NO_KEY, true);
  const query = new URLSearchParams({ key });
  for (const [name, value] of Object.entries(params)) if (value !== undefined && value !== '') query.set(name, String(value));
  let res: Response;
  try {
    // Trang gửi "Referrer-Policy: no-referrer"; riêng YouTube cần biết địa chỉ trang để khoá giới hạn theo website hoạt động.
    res = await fetch(`${API}${path}?${query}`, { referrerPolicy: 'strict-origin-when-cross-origin' });
  } catch {
    throw new YouTubeError('Không kết nối được YouTube. Kiểm tra mạng rồi thử lại.');
  }
  const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) throw explain(res.status, apiErrorReason(body), body.error?.message);
  return body;
}

interface Page<T> {
  items?: T[];
  nextPageToken?: string;
}

// ---------- Chuyển dữ liệu YouTube → kiểu của app ----------

interface Snippet {
  title?: string;
  channelTitle?: string;
  channelId?: string;
  description?: string;
  thumbnails?: Thumbnails;
  publishedAt?: string;
  videoOwnerChannelTitle?: string;
  videoOwnerChannelId?: string;
  liveBroadcastContent?: string;
}

interface RawVideo {
  id: string;
  snippet?: Snippet;
  contentDetails?: { duration?: string };
  status?: { embeddable?: boolean; privacyStatus?: string };
  statistics?: { viewCount?: string };
}

interface RawSearchResult {
  id?: { kind?: string; videoId?: string; channelId?: string; playlistId?: string };
  snippet?: Snippet;
}

interface RawPlaylistItem {
  snippet?: Snippet;
  contentDetails?: { videoId?: string };
}

interface RawChannel {
  id: string;
  snippet?: Snippet;
  contentDetails?: { relatedPlaylists?: { uploads?: string } };
}

interface RawPlaylist {
  id: string;
  snippet?: Snippet;
}

const rawId = (id: string) => id.replace(YOUTUBE_PREFIX, '');
const VIDEO_PARTS = 'snippet,contentDetails,status';

/** Video phát được trong trình phát nhúng (bỏ video chặn nhúng, riêng tư, đang phát trực tiếp). */
const playable = (v: RawVideo) => v.status?.embeddable !== false && v.status?.privacyStatus !== 'private' && v.snippet?.liveBroadcastContent !== 'live';

export function toTrack(v: RawVideo): Track {
  const channel = v.snippet?.channelTitle ? cleanArtist(v.snippet.channelTitle) : '';
  return {
    id: `${YOUTUBE_PREFIX}${v.id}`,
    title: decodeEntities(v.snippet?.title ?? 'Video YouTube'),
    artists: channel ? [{ id: v.snippet?.channelId ? `${YOUTUBE_PREFIX}${v.snippet.channelId}` : undefined, name: channel }] : [],
    duration: isoDuration(v.contentDetails?.duration),
    thumbnail: bestThumbnail(v.snippet?.thumbnails) || `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
    isVideo: true
  };
}

/** Bài tối thiểu khi chưa có khoá API (dán link): trình phát nhúng vẫn phát được. */
export function bareTrack(videoId: string): Track {
  return { id: `${YOUTUBE_PREFIX}${videoId}`, title: 'Video YouTube', artists: [], duration: 0, thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, isVideo: true };
}

/** Đọc đủ thông tin (thời lượng, có cho nhúng không) của các video, giữ thứ tự; 50 video mỗi lần gọi (1 đơn vị). */
async function videos(ids: string[], parts = VIDEO_PARTS): Promise<RawVideo[]> {
  const unique = [...new Set(ids)];
  const found = new Map<string, RawVideo>();
  for (let i = 0; i < unique.length; i += 50) {
    const page = await call<Page<RawVideo>>('/videos', { part: parts, id: unique.slice(i, i + 50).join(','), maxResults: 50 });
    for (const v of page.items ?? []) found.set(v.id, v);
  }
  return unique.flatMap((id) => (found.has(id) ? [found.get(id)!] : []));
}

const tracksOf = (raws: RawVideo[]) => raws.filter(playable).map(toTrack);

// ---------- Trang chủ: bảng xếp hạng (1 đơn vị mỗi hàng) ----------

async function chart(region: string): Promise<Track[]> {
  const page = await call<Page<RawVideo>>('/videos', { part: VIDEO_PARTS, chart: 'mostPopular', videoCategoryId: MUSIC_CATEGORY, regionCode: region, maxResults: 30 });
  return tracksOf(page.items ?? []);
}

export async function getHome(): Promise<Shelf[]> {
  return settleShelves([
    chart(REGION).then((tracks) => ({ title: 'Nhạc thịnh hành trên YouTube', items: trackItems(tracks) })),
    chart('US').then((tracks) => ({ title: 'Thịnh hành US-UK trên YouTube', items: trackItems(tracks) }))
  ]);
}

// ---------- Tìm kiếm (100 đơn vị mỗi lần) ----------

/** `music`: chỉ video thể loại Âm nhạc (tab Bài hát); không thì mọi video (tab Video). */
export async function searchVideos(query: string, music: boolean): Promise<Track[]> {
  const found = await call<Page<RawSearchResult>>('/search', {
    part: 'snippet',
    q: query,
    type: 'video',
    videoEmbeddable: 'true',
    videoSyndicated: 'true',
    videoCategoryId: music ? MUSIC_CATEGORY : undefined,
    regionCode: REGION,
    maxResults: 25
  });
  const ids = (found.items ?? []).flatMap((r) => (r.id?.videoId ? [r.id.videoId] : []));
  return ids.length ? tracksOf(await videos(ids)) : [];
}

export async function searchCards(kind: 'artist' | 'playlist', query: string): Promise<Card[]> {
  const found = await call<Page<RawSearchResult>>('/search', { part: 'snippet', q: query, type: kind === 'artist' ? 'channel' : 'playlist', regionCode: REGION, maxResults: 20 });
  return (found.items ?? []).flatMap((r): Card[] => {
    const id = kind === 'artist' ? r.id?.channelId : r.id?.playlistId;
    if (!id) return [];
    const title = decodeEntities(r.snippet?.title ?? '');
    const channel = decodeEntities(r.snippet?.channelTitle ?? '');
    return [
      {
        kind,
        id: `${YOUTUBE_PREFIX}${id}`,
        title: kind === 'artist' ? cleanArtist(title) : title,
        subtitle: kind === 'artist' ? 'Kênh YouTube' : channel ? `Playlist • ${channel}` : 'Playlist YouTube',
        thumbnail: bestThumbnail(r.snippet?.thumbnails)
      }
    ];
  });
}

// ---------- Kênh, playlist (vài đơn vị) ----------

async function playlistVideoIds(playlistId: string, pages = PLAYLIST_PAGES): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  for (let i = 0; i < pages; i++) {
    const page = await call<Page<RawPlaylistItem>>('/playlistItems', { part: 'contentDetails', playlistId, maxResults: 50, pageToken });
    ids.push(...(page.items ?? []).flatMap((item) => (item.contentDetails?.videoId ? [item.contentDetails.videoId] : [])));
    pageToken = page.nextPageToken;
    if (!pageToken) break;
  }
  return ids;
}

export async function getPlaylist(id: string): Promise<PlaylistPage> {
  const playlistId = rawId(id);
  const [info, ids] = await Promise.all([call<Page<RawPlaylist>>('/playlists', { part: 'snippet', id: playlistId }), playlistVideoIds(playlistId)]);
  const snippet = info.items?.[0]?.snippet;
  if (!snippet) throw new YouTubeError('Playlist này không còn trên YouTube hoặc để riêng tư.');
  const tracks = tracksOf(await videos(ids));
  return {
    id,
    title: decodeEntities(snippet.title ?? 'Playlist'),
    subtitle: snippet.channelTitle ? `Playlist của ${decodeEntities(snippet.channelTitle)}` : 'Playlist YouTube',
    description: snippet.description || undefined,
    thumbnail: bestThumbnail(snippet.thumbnails) || tracks[0]?.thumbnail || '',
    tracks
  };
}

/** Video mới nhất của kênh (danh sách "uploads" của kênh: 1 đơn vị + 1 đơn vị đọc thông tin video). */
async function channelUploads(channelId: string, withViews = false): Promise<{ channel?: RawChannel; uploads: RawVideo[] }> {
  const channels = await call<Page<RawChannel>>('/channels', { part: 'snippet,contentDetails', id: channelId });
  const channel = channels.items?.[0];
  const uploads = channel?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) return { channel, uploads: [] };
  const ids = await playlistVideoIds(uploads, 1);
  return { channel, uploads: (await videos(ids, withViews ? `${VIDEO_PARTS},statistics` : VIDEO_PARTS)).filter(playable) };
}

export async function getArtist(id: string): Promise<ArtistPage> {
  const { channel, uploads } = await channelUploads(rawId(id), true);
  if (!channel) throw new YouTubeError('Kênh này không còn trên YouTube.');
  const popular = [...uploads].sort((a, b) => Number(b.statistics?.viewCount ?? 0) - Number(a.statistics?.viewCount ?? 0));
  const latest = uploads.map(toTrack);
  return {
    id,
    name: cleanArtist(decodeEntities(channel.snippet?.title ?? 'Kênh YouTube')),
    description: channel.snippet?.description || undefined,
    thumbnail: bestThumbnail(channel.snippet?.thumbnails),
    topTracks: popular.slice(0, 20).map(toTrack),
    shelves: latest.length ? [{ title: 'Video mới nhất', items: trackItems(latest) }] : []
  };
}

/** Một video theo id (link người dùng dán). */
export async function getTrack(videoId: string): Promise<Track | undefined> {
  const [video] = await videos([videoId]);
  return video ? toTrack(video) : undefined;
}

/**
 * Radio (YouTube bỏ API "video liên quan" từ 2023): bài gốc + video khác của cùng kênh, xen kẽ với nhạc thịnh hành.
 * Tốn khoảng 5 đơn vị.
 */
export async function getRadio(seedId: string): Promise<Track[]> {
  const [seed] = await videos([rawId(seedId)]);
  if (!seed) return [];
  const [sameChannel, trending] = await Promise.all([
    seed.snippet?.channelId ? channelUploads(seed.snippet.channelId).then((r) => r.uploads.map(toTrack)) : Promise.resolve([]),
    chart(REGION).catch(() => [])
  ]);
  const out = [toTrack(seed)];
  const seen = new Set(out.map((t) => t.id));
  for (let i = 0; i < Math.max(sameChannel.length, trending.length); i++) {
    for (const track of [sameChannel[i], trending[i]]) {
      if (!track || seen.has(track.id)) continue;
      seen.add(track.id);
      out.push(track);
    }
  }
  return out;
}

export const youtubeStreamUrl = (id: string) => `${YOUTUBE_SCHEME}${rawId(id)}`;
