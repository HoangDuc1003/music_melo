// Đọc link YouTube / YouTube Music người dùng dán vào (thuần, không cần youtubei.js).

/** "VLPL…" (browseId của playlist) → "PL…". */
export function playlistIdFromBrowseId(id: string): string {
  return id.startsWith('VL') ? id.slice(2) : id;
}

const VIDEO_ID = /^[\w-]{11}$/;
const PLAYLIST_ID = /^[\w-]{10,64}$/;

/** Lấy id playlist / video từ link YouTube hoặc YouTube Music; chỉ nhận id đúng định dạng. */
export function parseYouTubeLink(input: string): { playlistId?: string; videoId?: string } | undefined {
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > 2048) return undefined;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    // Dán thẳng id playlist.
    if (/^(PL|OLAK5uy_|RD|VL)[\w-]{10,62}$/.test(trimmed)) return { playlistId: playlistIdFromBrowseId(trimmed) };
    return undefined;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
  if (!/(^|\.)youtube\.com$|^youtu\.be$/.test(url.hostname)) return undefined;

  let videoId = url.searchParams.get('v') ?? undefined;
  if (url.hostname === 'youtu.be') videoId = url.pathname.split('/')[1];
  const pathMatch = /^\/(?:shorts|embed|live)\/([\w-]{11})/.exec(url.pathname);
  if (pathMatch) videoId = pathMatch[1];
  let playlistId = url.searchParams.get('list') ?? undefined;
  const browse = /^\/browse\/(VL[\w-]+)/.exec(url.pathname);
  if (browse) playlistId = playlistIdFromBrowseId(browse[1]);

  const result = {
    videoId: videoId && VIDEO_ID.test(videoId) ? videoId : undefined,
    playlistId: playlistId && PLAYLIST_ID.test(playlistId) ? playlistId : undefined
  };
  return result.videoId || result.playlistId ? result : undefined;
}
