// Bản web của src/youtube/stream.ts: link nhạc Jamendo (MP3, không hết hạn, không gắn IP).
import type { ResolvedAudio } from '@/youtube/types';
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

const toResolved = (url: string): ResolvedAudio => ({ url, expiresAt: Date.now() + 24 * 3600_000, mimeType: 'audio/mpeg', client: 'JAMENDO' });

export function getCachedAudio(id: string): ResolvedAudio | undefined {
  const links = getKnownAudioLinks(id);
  return links ? toResolved(links.stream) : undefined;
}

/** Link Jamendo không gắn với mạng nên đổi Wi‑Fi ↔ 4G không cần làm gì. */
export function clearAudioCache() {}

/** `download`: lấy link tải về (nghệ sĩ có thể chỉ cho nghe online). */
export async function resolveAudio(id: string, options: { refresh?: boolean; download?: boolean } = {}): Promise<ResolvedAudio> {
  if (!id.startsWith(JAMENDO_PREFIX)) throw new StreamError('File nhạc này không còn trên máy', 'unavailable');
  const links = await fetchAudioLinks(id);
  if (!links) throw new StreamError('Bài này không còn trên Jamendo', 'unavailable');
  if (!options.download) return toResolved(links.stream);
  if (!links.download) throw new StreamError('Nghệ sĩ không cho tải bài này về máy, chỉ nghe online được', 'unavailable');
  return toResolved(links.download);
}
