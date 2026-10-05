// Lấy link file nhạc (m4a/AAC) cho một videoId.
// Thử lần lượt nhiều "client" của YouTube; mỗi link được kiểm tra một đoạn nhỏ sau mốc 1MB trước khi dùng.
// Link không có PO token (trừ VISIONOS) chỉ được tải khoảng 1 MiB rồi bị 403 (đo trên iPhone 10/2026: phát ~1 phút
// rồi đứng; bước kiểm tra nhỏ vẫn qua nên không phát hiện được) → trình phát/trình tải iPhone tự xin link mới và tải
// tiếp (MeloStreamLoader, MeloDownloader). Chỉ client tải trọn được mới được nhớ để ưu tiên lần sau.
import { log } from '@/lib/log';
import { getPoStreamSession, getStreamSession } from './client';
import { appFetch } from './http';
import { playerRequestFor } from './player-requests';
import type { ResolvedAudio } from './types';

interface ClientSpec {
  name: 'VISIONOS' | 'TV_SIMPLY' | 'IOS' | 'ANDROID_VR' | 'MWEB' | 'YTMUSIC';
  needsPoToken: boolean;
  /** Tải trọn file bằng một link (không bị giới hạn ~1 MiB). */
  full: boolean;
}

// Kết quả đo 10/2026: VISIONOS tải trọn file không cần token (máy tính; trên iPhone của người dùng thì bị
// "xác nhận không phải robot"); TV_SIMPLY + PO token tải trọn; IOS / ANDROID_VR không token chỉ ~1 MiB mỗi link.
const CLIENTS: ClientSpec[] = [
  { name: 'VISIONOS', needsPoToken: false, full: true },
  { name: 'TV_SIMPLY', needsPoToken: true, full: true },
  { name: 'IOS', needsPoToken: false, full: false },
  { name: 'ANDROID_VR', needsPoToken: false, full: false },
  { name: 'MWEB', needsPoToken: true, full: true },
  { name: 'YTMUSIC', needsPoToken: true, full: true }
];

/** Client bị YouTube đòi đăng nhập ("không phải robot") / tạo PO token lỗi: tạm bỏ qua chừng này. */
const CLIENT_COOLDOWN_MS = 30 * 60_000;
/** Tạo PO token (BotGuard) quá lâu thì bỏ, thử client khác. */
const PO_TOKEN_TIMEOUT_MS = 12_000;
const skipUntil = new Map<ClientSpec['name'] | 'PO_TOKEN', number>();
const skipped = (name: ClientSpec['name'] | 'PO_TOKEN') => (skipUntil.get(name) ?? 0) > Date.now();

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
/** Tăng mỗi lần xoá cache: lượt lấy link bắt đầu trước đó (gắn IP cũ) không được ghi vào cache nữa. */
let epoch = 0;

function orderedClients(): ClientSpec[] {
  const preferred = localStorage.getItem(PREFERRED_KEY);
  const first = CLIENTS.find((c) => c.name === preferred && c.full);
  const ordered = first ? [first, ...CLIENTS.filter((c) => c !== first)] : CLIENTS;
  // Client đang bị tạm bỏ qua xếp cuối (vẫn thử nếu mọi client khác đều hỏng).
  return [...ordered.filter((c) => !isSkipped(c)), ...ordered.filter(isSkipped)];
}

const isSkipped = (c: ClientSpec) => skipped(c.name) || (c.needsPoToken && skipped('PO_TOKEN'));

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/** Chỉ dùng trong test. */
export function __resetClientCooldownsForTests() {
  skipUntil.clear();
}

function isFresh(audio: ResolvedAudio | undefined, marginMs = EXPIRY_MARGIN_MS): audio is ResolvedAudio {
  return Boolean(audio && audio.expiresAt - Date.now() > marginMs);
}

/** Mọi bài YouTube đều tải về được trong app iPhone (bản web: chỉ bài Audius/Jamendo). */
export const canDownload = (_id: string) => true;

export function getCachedAudio(videoId: string): ResolvedAudio | undefined {
  const audio = cache.get(videoId);
  return isFresh(audio) ? audio : undefined;
}

/** Xoá link đã nhớ (khi đổi mạng Wi-Fi ↔ 4G link cũ gắn IP cũ sẽ hỏng). */
export function clearAudioCache() {
  epoch += 1;
  cache.clear();
  inflight.clear();
}

/** `download` không có tác dụng ở đây: link YouTube dùng được cho cả phát lẫn tải (khác bản web, xem src/web/stream.ts). */
export function resolveAudio(videoId: string, options: { refresh?: boolean; download?: boolean } = {}): Promise<ResolvedAudio> {
  if (options.refresh) cache.delete(videoId);
  const cached = getCachedAudio(videoId);
  if (cached) return Promise.resolve(cached);
  let pending = inflight.get(videoId);
  if (!pending) {
    const started = doResolve(videoId, epoch).finally(() => {
      if (inflight.get(videoId) === started) inflight.delete(videoId);
    });
    inflight.set(videoId, started);
    pending = started;
  }
  return pending;
}

async function doResolve(videoId: string, startedEpoch: number): Promise<ResolvedAudio> {
  const started = performance.now();
  let lastError: StreamError | undefined;
  for (const client of orderedClients()) {
    try {
      const audio = await tryClient(videoId, client);
      if (audio) {
        // Mạng đổi trong lúc chờ: link này gắn IP cũ, lấy lại theo mạng mới.
        if (startedEpoch !== epoch) return resolveAudio(videoId);
        cache.set(videoId, audio);
        // Link bị giới hạn ~1 MiB vẫn dùng được (iPhone tự đổi link), nhưng không nhớ để lần sau còn thử client tải trọn.
        if (client.full) localStorage.setItem(PREFERRED_KEY, client.name);
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
        if (client.needsPoToken && /PO token|BotGuard|integrity/i.test(String((err as Error)?.message ?? err))) {
          skipUntil.set('PO_TOKEN', Date.now() + CLIENT_COOLDOWN_MS);
        }
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
    const tokens = await withTimeout(getPoTokens(videoId), PO_TOKEN_TIMEOUT_MS, 'Tạo PO token (BotGuard) quá lâu');
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
    // Bị đòi "xác nhận không phải robot" thì client này hỏng với cả các bài khác: tạm bỏ qua.
    if (status === 'LOGIN_REQUIRED') skipUntil.set(client.name, Date.now() + CLIENT_COOLDOWN_MS);
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
    client: client.name,
    refresh: refreshRecipe(videoId, client, format, url)
  };
}

/**
 * Link bị giới hạn ~1 MiB mà YouTube trả sẵn (không mã hoá chữ ký, không tham số n): đưa yêu cầu `/player` cho native
 * gửi lại khi link hết lượt (native không chạy được player JS nên link cần giải mã thì phải nhờ JS).
 */
function refreshRecipe(
  videoId: string,
  client: ClientSpec,
  format: { itag: number; url?: string; signature_cipher?: string; cipher?: string },
  url: string
): ResolvedAudio['refresh'] {
  if (client.full || client.needsPoToken || !format.url || format.signature_cipher || format.cipher) return undefined;
  if (new URL(url).searchParams.has('n')) return undefined;
  const request = playerRequestFor(videoId, client.name);
  return request && { ...request, itag: format.itag };
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
