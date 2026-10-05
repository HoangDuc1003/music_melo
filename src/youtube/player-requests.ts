// Ghi lại yêu cầu `/player` gần đây (theo bài + client) để trình phát iPhone tự gửi lại khi link hết lượt.
// Link client IOS / ANDROID_VR chỉ tải được ~1 MiB; lúc tắt màn hình iOS có thể tạm dừng JS nên native phải tự xin
// link mới (xem StreamRefresh.swift). Chỉ giữ trong bộ nhớ, không ghi nhật ký.
import type { StreamRefresh } from 'capacitor-melo-player';

type PlayerRequest = Omit<StreamRefresh, 'itag'>;

const PLAYER_PATH = /\/youtubei\/v1\/player$/;
const MAX_REMEMBERED = 50;
/** Header không gửi lại từ native (native tự dùng cookie của app). */
const DROPPED_HEADERS = new Set(['cookie', 'authorization']);
const remembered = new Map<string, PlayerRequest>();

const key = (videoId: string, clientName: string) => `${videoId}|${clientName}`;

function remember(url: string, headers: HeadersInit | undefined, body: string) {
  let payload: { videoId?: unknown; context?: { client?: { clientName?: unknown } } };
  try {
    payload = JSON.parse(body);
  } catch {
    return;
  }
  const videoId = payload.videoId;
  const clientName = payload.context?.client?.clientName;
  if (typeof videoId !== 'string' || typeof clientName !== 'string') return;
  const plain: Record<string, string> = {};
  new Headers(headers).forEach((value, name) => {
    if (!DROPPED_HEADERS.has(name)) plain[name] = value;
  });
  const id = key(videoId, clientName);
  remembered.delete(id);
  remembered.set(id, { url, headers: plain, body });
  if (remembered.size > MAX_REMEMBERED) remembered.delete(remembered.keys().next().value!);
}

/** Bọc fetch của youtubei.js: nhớ các yêu cầu `/player` (body JSON dạng chuỗi), còn lại chuyển nguyên. */
export function recordPlayerRequests(inner: typeof fetch): typeof fetch {
  return (input, init) => {
    const body = init?.body;
    if (typeof body === 'string') {
      const url = input instanceof Request ? input.url : String(input);
      if (PLAYER_PATH.test(url.split('?')[0])) {
        remember(url, init?.headers ?? (input instanceof Request ? input.headers : undefined), body);
      }
    }
    return inner(input, init);
  };
}

/** Yêu cầu `/player` gần nhất của bài này với client này (tên client InnerTube, ví dụ "IOS"). */
export function playerRequestFor(videoId: string, clientName: string): PlayerRequest | undefined {
  return remembered.get(key(videoId, clientName));
}

/** Chỉ dùng trong test. */
export function __resetPlayerRequestsForTests() {
  remembered.clear();
}
