// Đọc thư viện YouTube / YouTube Music của chính người dùng qua YouTube Data API v3 (quyền chỉ đọc).
// Playlist tạo trên YouTube Music cũng là playlist YouTube nên đọc chung được; bài là videoId nên phát thẳng,
// không cần ghép như Spotify.
import { sleep } from '@/lib/async';
import { cleanArtist } from '@/lib/text';
import { apiErrorReason, bestThumbnail, isoDuration, type Thumbnails } from '@/lib/youtube-data';
import { appFetch } from '@/youtube/http';
import type { Track } from '@/youtube/types';
import { getGoogleAccessToken } from './google-auth';

const API = 'https://www.googleapis.com/youtube/v3';
/** Tối đa 50 × 100 = 5000 mục mỗi danh sách. */
const MAX_PAGES = 100;

export class YouTubeApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'YouTubeApiError';
  }
}

async function request<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = `${API}${path}?${new URLSearchParams(params)}`;
  let forceRefresh = false;
  for (let attempt = 0; ; attempt++) {
    const token = await getGoogleAccessToken(forceRefresh);
    const res = await appFetch(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } });
    if (res.ok) return (await res.json()) as T;
    if (res.status === 401 && !forceRefresh) {
      forceRefresh = true;
      continue;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    const reason = apiErrorReason(body);
    if (reason === 'quotaExceeded') throw new YouTubeApiError(res.status, 'Hết lượt đọc YouTube hôm nay (giới hạn của Google), mai đồng bộ tiếp');
    if (reason === 'accessNotConfigured') throw new YouTubeApiError(res.status, 'Chưa bật "YouTube Data API v3" trong Google Cloud (xem hướng dẫn)');
    throw new YouTubeApiError(res.status, `YouTube: ${body.error?.message ?? `lỗi ${res.status}`}`);
  }
}

interface Page<T> {
  items?: T[];
  nextPageToken?: string;
}

async function collect<T>(path: string, params: Record<string, string>): Promise<T[]> {
  const all: T[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await request<Page<T>>(path, { ...params, maxResults: '50', ...(pageToken ? { pageToken } : {}) });
    all.push(...(result.items ?? []));
    pageToken = result.nextPageToken;
    if (!pageToken) break;
  }
  return all;
}

// ---------- Chuyển dữ liệu ----------

export interface YouTubePlaylist {
  id: string;
  title: string;
  /** đổi khi playlist đổi (dùng như snapshot) */
  etag: string;
  thumbnail: string;
  itemCount: number;
}

interface RawPlaylist {
  id: string;
  etag: string;
  snippet?: { title?: string; thumbnails?: Thumbnails };
  contentDetails?: { itemCount?: number };
}

interface RawPlaylistItem {
  snippet?: { title?: string; videoOwnerChannelTitle?: string; videoOwnerChannelId?: string; thumbnails?: Thumbnails };
  contentDetails?: { videoId?: string };
  status?: { privacyStatus?: string };
}

interface RawVideo {
  id: string;
  snippet?: { title?: string; channelTitle?: string; channelId?: string; categoryId?: string; thumbnails?: Thumbnails };
  contentDetails?: { duration?: string };
}

const MUSIC_CATEGORY = '10';

function videoTrack(id: string, title: string, channel: string | undefined, channelId: string | undefined, thumbnails: Thumbnails | undefined, duration = 0): Track {
  const artist = channel ? cleanArtist(channel) : '';
  return {
    id,
    title,
    artists: artist ? [{ id: channelId, name: artist }] : [],
    duration,
    thumbnail: bestThumbnail(thumbnails) || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
  };
}

// ---------- API ----------

/** Playlist của chính bạn (gồm playlist tạo trên YouTube Music). */
export async function getMyPlaylists(): Promise<YouTubePlaylist[]> {
  const raw = await collect<RawPlaylist>('/playlists', { part: 'snippet,contentDetails', mine: 'true' });
  return raw.map((p) => ({
    id: p.id,
    title: p.snippet?.title ?? 'Playlist',
    etag: p.etag,
    thumbnail: bestThumbnail(p.snippet?.thumbnails),
    itemCount: p.contentDetails?.itemCount ?? 0
  }));
}

/** Thời lượng các video (playlistItems không có), 50 video mỗi lần gọi. */
async function durations(ids: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 50) {
    const page = await request<Page<RawVideo>>('/videos', { part: 'contentDetails', id: ids.slice(i, i + 50).join(','), maxResults: '50' });
    for (const v of page.items ?? []) result.set(v.id, isoDuration(v.contentDetails?.duration));
  }
  return result;
}

/** Các bài trong playlist (bỏ video đã xoá / riêng tư). */
export async function getPlaylistTracks(playlistId: string): Promise<Track[]> {
  const raw = await collect<RawPlaylistItem>('/playlistItems', { part: 'snippet,contentDetails,status', playlistId });
  const items = raw.filter((i) => i.contentDetails?.videoId && i.status?.privacyStatus !== 'private' && i.snippet?.title !== 'Deleted video');
  const lengths = await durations([...new Set(items.map((i) => i.contentDetails!.videoId!))]);
  return items.map((i) => {
    const id = i.contentDetails!.videoId!;
    return videoTrack(id, i.snippet?.title ?? '', i.snippet?.videoOwnerChannelTitle, i.snippet?.videoOwnerChannelId, i.snippet?.thumbnails, lengths.get(id));
  });
}

/** Bài đã thích: các video đã bấm thích thuộc thể loại Âm nhạc (YouTube Music dùng chung lượt thích). */
export async function getLikedMusic(): Promise<Track[]> {
  const raw = await collect<RawVideo>('/videos', { part: 'snippet,contentDetails', myRating: 'like' });
  return raw
    .filter((v) => v.snippet?.categoryId === MUSIC_CATEGORY)
    .map((v) => videoTrack(v.id, v.snippet?.title ?? '', v.snippet?.channelTitle, v.snippet?.channelId, v.snippet?.thumbnails, isoDuration(v.contentDetails?.duration)));
}
