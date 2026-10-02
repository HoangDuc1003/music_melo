// Bản web của src/youtube/stream.ts: link MP3 của Audius / Jamendo (không hết hạn, không gắn IP).
import type { ResolvedAudio } from '@/youtube/types';
import { AUDIUS_PREFIX, streamUrl, throttle } from './audius';
import { fetchAudioLinks, getKnownAudioLinks, JAMENDO_PREFIX } from './jamendo';

export type StreamErrorReason = 'age' | 'unavailable' | 'network' | 'blocked';

export class StreamError extends Error {
  constructor(
    message: string,
    readonly reason: StreamErrorReason
  ) {
    super(message);
    this.name = 'StreamError';
  }
}

const toResolved = (url: string, client: string): ResolvedAudio => ({ url, expiresAt: Date.now() + 24 * 3600_000, mimeType: 'audio/mpeg', client });

export function getCachedAudio(id: string): ResolvedAudio | undefined {
  if (id.startsWith(AUDIUS_PREFIX)) return toResolved(streamUrl(id), 'AUDIUS');
  const links = getKnownAudioLinks(id);
  return links ? toResolved(links.stream, 'JAMENDO') : undefined;
}

/** Link không gắn với mạng nên đổi Wi‑Fi ↔ 4G không cần làm gì. */
export function clearAudioCache() {}

/** `download`: link để tải về nghe offline (nghệ sĩ Jamendo có thể chỉ cho nghe online). */
export async function resolveAudio(id: string, options: { refresh?: boolean; download?: boolean } = {}): Promise<ResolvedAudio> {
  // Audius: bài trả phí/đã gỡ không hiện trong app, bài còn lại nghe và lưu offline trong app được.
  // Link suy ra từ id nên không phải hỏi API; riêng khi tải về thì trình tải gọi /stream ngay → tính vào giới hạn gọi.
  if (id.startsWith(AUDIUS_PREFIX)) {
    if (options.download) await throttle();
    return toResolved(streamUrl(id, options.download), 'AUDIUS');
  }
  if (!id.startsWith(JAMENDO_PREFIX)) throw new StreamError('File nhạc này không còn trên máy', 'unavailable');
  const links = await fetchAudioLinks(id);
  if (!links) throw new StreamError('Bài này không còn trên Jamendo', 'unavailable');
  if (!options.download) return toResolved(links.stream, 'JAMENDO');
  if (!links.download) throw new StreamError('Nghệ sĩ không cho tải bài này về máy, chỉ nghe online được', 'unavailable');
  return toResolved(links.download, 'JAMENDO');
}
