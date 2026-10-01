// Lấy link file nhạc (m4a/AAC) cho một videoId.
// Thử lần lượt nhiều "client" của YouTube; mỗi link được kiểm tra đoạn sau 1MB (YouTube hay chặn
// từ byte thứ 1.048.576 nếu thiếu PO token) trước khi dùng. Client chạy được sẽ được ưu tiên lần sau.
import { log } from '@/lib/log';
import { getPoStreamSession, getStreamSession } from './client';
import { appFetch } from './http';
import type { ResolvedAudio } from './types';

interface ClientSpec {
  name: 'VISIONOS' | 'TV_SIMPLY' | 'IOS' | 'ANDROID_VR' | 'MWEB' | 'YTMUSIC';
  needsPoToken: boolean;
}

// Kết quả đo 10/2026 (scripts/probe-download.mjs): VISIONOS tải trọn file không cần token;
// TV_SIMPLY cần PO token; các client còn lại để dự phòng.
const CLIENTS: ClientSpec[] = [
  { name: 'VISIONOS', needsPoToken: false },
  { name: 'TV_SIMPLY', needsPoToken: true },
  { name: 'IOS', needsPoToken: false },
  { name: 'ANDROID_VR', needsPoToken: false },
  { name: 'MWEB', needsPoToken: true },
  { name: 'YTMUSIC', needsPoToken: true }
];

const PREFERRED_KEY = 'melo.preferredClient';
/** Coi link là hết hạn sớm hơn 20 phút để còn thời gian phát hết bài. */
const EXPIRY_MARGIN_MS = 20 * 60_000;
const ONE_MB = 1_048_576;

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

const cache = new Map<string, ResolvedAudio>();
const inflight = new Map<string, Promise<ResolvedAudio>>();

function orderedClients(): ClientSpec[] {
  const preferred = localStorage.getItem(PREFERRED_KEY);
  const first = CLIENTS.find((c) => c.name === preferred);
  return first ? [first, ...CLIENTS.filter((c) => c !== first)] : CLIENTS;
}

export function isFresh(audio: ResolvedAudio | undefined, marginMs = EXPIRY_MARGIN_MS): audio is ResolvedAudio {
  return Boolean(audio && audio.expiresAt - Date.now() > marginMs);
}

export function getCachedAudio(videoId: string): ResolvedAudio | undefined {
  const audio = cache.get(videoId);
  return isFresh(audio) ? audio : undefined;
}

/** Xoá link đã nhớ (khi đổi mạng Wi-Fi ↔ 4G link cũ gắn IP cũ sẽ hỏng). */
export function clearAudioCache(videoId?: string) {
  if (videoId) cache.delete(videoId);
  else cache.clear();
}

export function resolveAudio(videoId: string, options: { refresh?: boolean } = {}): Promise<ResolvedAudio> {
  if (options.refresh) cache.delete(videoId);
  const cached = getCachedAudio(videoId);
  if (cached) return Promise.resolve(cached);
  let pending = inflight.get(videoId);
  if (!pending) {
    pending = doResolve(videoId).finally(() => inflight.delete(videoId));
    inflight.set(videoId, pending);
  }
  return pending;
}

async function doResolve(videoId: string): Promise<ResolvedAudio> {
  const started = performance.now();
  let lastError: StreamError | undefined;
  for (const client of orderedClients()) {
    try {
      const audio = await tryClient(videoId, client);
      if (audio) {
        cache.set(videoId, audio);
        localStorage.setItem(PREFERRED_KEY, client.name);
        log.info('stream', `${videoId} via ${client.name} in ${Math.round(performance.now() - started)}ms`);
        return audio;
      }
    } catch (err) {
      if (err instanceof StreamError) {
        lastError = err;
        if (err.reason === 'age') break;
      } else {
        log.warn('stream', `${client.name} failed for ${videoId}:`, err);
        lastError = new StreamError('Lỗi mạng khi lấy link nhạc', 'network');
      }
    }
  }
  throw lastError ?? new StreamError('YouTube đang chặn bài này, thử lại sau', 'blocked');
}

async function tryClient(videoId: string, client: ClientSpec): Promise<ResolvedAudio | undefined> {
  let poToken: string | undefined;
  let session;
  if (client.needsPoToken) {
    // BotGuard chỉ cần khi client không cần token bị chặn → nạp khi cần.
    const { getPoTokens } = await import('./potoken');
    const tokens = await getPoTokens(videoId);
    session = await getPoStreamSession(tokens.visitorData, tokens.sessionToken);
    poToken = tokens.contentToken;
  } else {
    session = await getStreamSession();
  }

  const info = await session.getBasicInfo(videoId, { client: client.name, po_token: poToken });
  const status = info.playability_status?.status;
  if (status !== 'OK') {
    const reason = String(info.playability_status?.reason ?? status ?? '');
    if (status === 'LOGIN_REQUIRED' && /tuổi|age/i.test(reason)) {
      throw new StreamError('Bài này bị giới hạn độ tuổi nên không phát được', 'age');
    }
    if (status === 'ERROR') throw new StreamError(reason || 'Video không còn khả dụng', 'unavailable');
    log.warn('stream', `${client.name} ${status}: ${reason}`);
    return undefined;
  }

  let format;
  try {
    format = info.chooseFormat({ type: 'audio', quality: 'best', format: 'mp4' });
  } catch {
    log.warn('stream', `${client.name}: không có audio mp4`);
    return undefined;
  }
  const url = await format.decipher(session.session.player);
  if (!url) return undefined;
  const contentLength = format.content_length ? Number(format.content_length) : undefined;

  if (!(await isUrlUsable(url, contentLength))) {
    log.warn('stream', `${client.name}: link bị chặn sau 1MB`);
    return undefined;
  }

  const expireParam = Number(new URL(url).searchParams.get('expire'));
  return {
    url,
    expiresAt: expireParam > 0 ? expireParam * 1000 : Date.now() + 5 * 3600_000,
    mimeType: format.mime_type,
    contentLength,
    bitrate: format.bitrate,
    client: client.name
  };
}

/** Đọc thử 256 byte ở sau mốc 1MB: nếu YouTube chặn sẽ trả 403. */
async function isUrlUsable(url: string, contentLength: number | undefined): Promise<boolean> {
  const start = contentLength && contentLength > ONE_MB + 4096 ? ONE_MB : 0;
  try {
    const res = await appFetch(url, { headers: { Range: `bytes=${start}-${start + 255}` } });
    return res.status === 206 || res.status === 200;
  } catch (err) {
    log.warn('stream', 'probe failed', err);
    return false;
  }
}
