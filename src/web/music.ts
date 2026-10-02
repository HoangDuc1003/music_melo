// Bản web của src/youtube/music.ts (`vite --mode web`): cùng các hàm, nhạc lấy từ YouTube (khi có khoá API),
// Audius (luôn có, không cần đăng ký) và Jamendo (khi có Client ID). Trang kênh/nghệ sĩ/playlist và radio chọn nguồn
// theo tiền tố id: "yt-" YouTube, "au-" Audius, còn lại Jamendo ("lf-" là file tự thêm, không có radio).
import { parseYouTubeLink as parseLink } from '@/youtube/links';
import { log } from '@/lib/log';
import { toast } from '@/ui/overlays';
import type { AlbumPage, ArtistPage, Card, PlaylistPage, SearchSuggestions, SearchType, Shelf, ShelfItem, Track } from '@/youtube/types';
import * as audius from './audius';
import * as jamendo from './jamendo';
import { alternate, cardItems, trackItems } from './shelves';
import * as youtube from './youtube';

const isAudius = (id: string) => id.startsWith(audius.AUDIUS_PREFIX);
const isYouTube = (id: string) => id.startsWith(youtube.YOUTUBE_PREFIX);

/** Nguồn nào đang dùng được (YouTube cần khoá API, Jamendo cần Client ID). */
async function enabledSources() {
  const [youtubeKey, jamendoId] = await Promise.all([youtube.getYouTubeApiKey(), jamendo.getJamendoClientId()]);
  return { youtube: Boolean(youtubeKey), jamendo: Boolean(jamendoId) };
}

// Một nguồn lỗi nhưng nguồn khác vẫn có kết quả: báo lỗi của YouTube (hết lượt, khoá sai) để người dùng biết vì sao
// không thấy bài YouTube, mỗi lỗi tối đa 10 phút một lần.
const warnedAt = new Map<string, number>();
function warnPartial(err: unknown) {
  log.warn('music', 'một nguồn nhạc lỗi:', err);
  if (!(err instanceof youtube.YouTubeError)) return;
  const last = warnedAt.get(err.message) ?? 0;
  if (Date.now() - last < 10 * 60_000) return;
  warnedAt.set(err.message, Date.now());
  toast(err.message);
}

/**
 * Hỏi các nguồn cùng lúc, xen kẽ kết quả theo thứ tự nguồn (YouTube trước). Nguồn lỗi thì bỏ qua (có báo);
 * tất cả đều lỗi thì báo lỗi của nguồn đầu tiên.
 */
async function fromSources<T>(sources: (() => Promise<T[]>)[], key: (item: T) => string): Promise<T[]> {
  const settled = await Promise.allSettled(sources.map((run) => run()));
  const lists = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));
  if (!lists.length) throw (settled[0] as PromiseRejectedResult).reason;
  for (const s of settled) if (s.status === 'rejected') warnPartial(s.reason);
  return alternate(lists, key);
}

/** Trang chủ: hàng của YouTube (nếu có khoá), rồi Audius, rồi Jamendo (nếu có Client ID). */
export async function getHome(): Promise<Shelf[]> {
  const on = await enabledSources();
  const parts = await Promise.allSettled([
    on.youtube ? youtube.getHome() : Promise.resolve([]),
    audius.getHome(),
    on.jamendo ? jamendo.getHome() : Promise.resolve([])
  ]);
  const shelves = parts.flatMap((s) => (s.status === 'fulfilled' ? s.value : []));
  const failed = parts.flatMap((s) => (s.status === 'rejected' ? [s.reason as unknown] : []));
  if (!shelves.length && failed.length) throw failed[0];
  failed.forEach(warnPartial);
  return shelves;
}

export async function search(query: string, type: SearchType): Promise<ShelfItem[]> {
  const on = await enabledSources();
  const byId = (item: { id: string }) => item.id;
  // Chỉ YouTube có video; chưa có khoá thì báo cách thêm khoá.
  if (type === 'video') return trackItems(await youtube.searchVideos(query, false));
  if (type === 'song') {
    const tracks = await fromSources<Track>(
      [
        ...(on.youtube ? [() => youtube.searchVideos(query, true)] : []),
        () => audius.searchTracks(query),
        ...(on.jamendo ? [() => jamendo.searchTracks(query)] : [])
      ],
      byId
    );
    return trackItems(tracks);
  }
  const cards = await fromSources<Card>(
    [
      ...(on.youtube && type !== 'album' ? [() => youtube.searchCards(type, query)] : []),
      () => audius.searchCards(type, query),
      ...(on.jamendo ? [() => jamendo.searchCards(type, query)] : [])
    ],
    byId
  );
  return cardItems(cards);
}

/** Gợi ý khi gõ: chỉ Audius/Jamendo (mỗi lần tìm trên YouTube tốn 100 đơn vị hạn mức). */
export async function getSuggestions(input: string): Promise<SearchSuggestions> {
  const on = await enabledSources();
  const [completions, tracks] = await Promise.all([
    on.jamendo ? jamendo.autocomplete(input) : [],
    fromSources<Track>([() => audius.searchTracks(input, 5), ...(on.jamendo ? [() => jamendo.searchTracks(input, 5)] : [])], (t) => t.id).catch(() => [])
  ]);
  // Audius không có gợi ý từ khoá: dùng thêm tên các bài tìm được.
  const queries = [...new Set([...completions, ...tracks.map((t) => t.title.toLowerCase())])].slice(0, 6);
  return { queries, items: trackItems(tracks.slice(0, 3)) };
}

export const getAlbum = (id: string): Promise<AlbumPage> => (isAudius(id) ? audius.getAlbum(id) : jamendo.getAlbum(id));

export function getArtist(id: string): Promise<ArtistPage> {
  if (isYouTube(id)) return youtube.getArtist(id);
  return isAudius(id) ? audius.getArtist(id) : jamendo.getArtist(id);
}

export function getPlaylist(id: string): Promise<PlaylistPage> {
  if (isYouTube(id)) return youtube.getPlaylist(id);
  return isAudius(id) ? audius.getPlaylist(id) : jamendo.getPlaylist(id);
}

/** Radio từ một bài. File nhạc tự thêm không thuộc nguồn nào nên không có radio. */
export async function getUpNext(trackId: string): Promise<Track[]> {
  if (isYouTube(trackId)) {
    // Chưa có khoá API (ví dụ mở link dán vào): vẫn phát được chính video đó bằng trình phát nhúng.
    return youtube.getRadio(trackId).catch((err: unknown) => {
      if (err instanceof youtube.YouTubeError && err.needsSetup) return [youtube.bareTrack(trackId.slice(youtube.YOUTUBE_PREFIX.length))];
      throw err;
    });
  }
  if (isAudius(trackId)) return audius.getRadio(trackId);
  if (trackId.startsWith(jamendo.JAMENDO_PREFIX)) return jamendo.getRadio(trackId);
  return [];
}

/** Lời bài hát chỉ lấy từ LRCLIB (bản web không đọc phụ đề YouTube). */
export async function getYouTubeLyrics(): Promise<{ text: string; source?: string } | undefined> {
  return undefined;
}

/** Link YouTube / YouTube Music dán vào ô tìm kiếm → id trong Melo ("yt-…"). */
export function parseYouTubeLink(input: string): { playlistId?: string; videoId?: string } | undefined {
  const link = parseLink(input);
  if (!link) return undefined;
  const prefixed = (id: string | undefined) => (id ? `${youtube.YOUTUBE_PREFIX}${id}` : undefined);
  return { playlistId: prefixed(link.playlistId), videoId: prefixed(link.videoId) };
}
