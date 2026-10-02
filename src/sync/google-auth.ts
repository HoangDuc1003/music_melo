// Đăng nhập Google (Gmail) bằng "device flow": app hiện một mã ngắn, người dùng mở google.com/device
// (ngay trên iPhone, chọn tài khoản Gmail), nhập mã và đồng ý cho Melo *chỉ đọc* thư viện YouTube.
// Không cần server, không cần redirect về app. Token cất trong Keychain (lib/secure.ts).
// Mỗi người tự tạo OAuth client loại "TVs and Limited Input devices" và nhập Client ID + Client secret
// trong Cài đặt (không gắn vào bản build: IPA công khai trên GitHub Releases). Xem docs/GOOGLE.md.
import { getSetting, setSetting } from '@/lib/db';
import { sleep } from '@/lib/async';
import { secureGet, secureRemove, secureSet } from '@/lib/secure';
import { appFetch } from '@/youtube/http';

export const GOOGLE_SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/youtube.readonly'];
const DEVICE_CODE_URL = 'https://oauth2.googleapis.com/device/code';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const TOKEN_KEY = 'google.tokens';
const SECRET_KEY = 'google.clientSecret';
const CLIENT_ID_SETTING = 'googleClientId';
const CLIENT_ID = /^[\w-]+\.apps\.googleusercontent\.com$/;

/** Cần đăng nhập lại (chưa kết nối, bị thu hồi, hoặc refresh token hết hạn). */
export class GoogleAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoogleAuthError';
  }
}

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string;
  /** ms */
  expiresAt: number;
  email?: string;
}

// ---------- Client ID / secret (người dùng tự tạo) ----------

export const isValidGoogleClientId = (value: string) => CLIENT_ID.test(value.trim());

export interface GoogleClient {
  clientId: string;
  clientSecret: string;
}

export async function getGoogleClient(): Promise<GoogleClient | undefined> {
  const [clientId, clientSecret] = await Promise.all([getSetting<string>(CLIENT_ID_SETTING, ''), secureGet<string>(SECRET_KEY)]);
  return isValidGoogleClientId(clientId) && clientSecret ? { clientId: clientId.trim(), clientSecret } : undefined;
}

/** Client ID không phải bí mật (lưu cùng cài đặt); Client secret cất trong Keychain. */
export async function setGoogleClient(clientId: string, clientSecret: string): Promise<void> {
  await setSetting(CLIENT_ID_SETTING, clientId.trim());
  await secureSet(SECRET_KEY, clientSecret.trim());
}

// ---------- Gọi máy chủ OAuth ----------

interface OAuthResponse {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  device_code?: string;
  user_code?: string;
  verification_url?: string;
  interval?: number;
  error?: string;
  error_description?: string;
}

async function post(url: string, body: Record<string, string>): Promise<{ status: number; json: OAuthResponse }> {
  const res = await appFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString()
  });
  const json = (await res.json().catch(() => ({}))) as OAuthResponse;
  return { status: res.status, json };
}

/** Email trong id_token (JWT): chỉ để hiện "Đã đăng nhập: …", không dùng để xác thực. */
export function emailFromIdToken(idToken: string | undefined): string | undefined {
  const payload = idToken?.split('.')[1];
  if (!payload) return undefined;
  try {
    const json = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(payload.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))));
    return typeof json.email === 'string' ? json.email : undefined;
  } catch {
    return undefined;
  }
}

function clientError(error: string | undefined): GoogleAuthError | undefined {
  if (error === 'invalid_client' || error === 'unauthorized_client') return new GoogleAuthError('Client ID hoặc Client secret chưa đúng (xem hướng dẫn)');
  if (error === 'invalid_grant') return new GoogleAuthError('Phiên Google đã hết hạn, hãy đăng nhập lại');
  return undefined;
}

// ---------- Đăng nhập bằng mã thiết bị ----------

export interface DeviceLogin {
  /** mã người dùng nhập ở google.com/device */
  userCode: string;
  verificationUrl: string;
  deviceCode: string;
  /** giây giữa hai lần hỏi */
  interval: number;
  /** ms */
  expiresAt: number;
}

export async function startDeviceLogin(): Promise<DeviceLogin> {
  const client = await getGoogleClient();
  if (!client) throw new GoogleAuthError('Chưa nhập Client ID / Client secret của Google (xem hướng dẫn)');
  const { json } = await post(DEVICE_CODE_URL, { client_id: client.clientId, scope: GOOGLE_SCOPES.join(' ') });
  if (!json.device_code || !json.user_code) {
    throw clientError(json.error) ?? new Error(`Google: ${json.error_description || json.error || 'không lấy được mã đăng nhập'}`);
  }
  return {
    userCode: json.user_code,
    verificationUrl: json.verification_url || 'https://www.google.com/device',
    deviceCode: json.device_code,
    interval: Math.max(1, json.interval ?? 5),
    expiresAt: Date.now() + (json.expires_in ?? 1800) * 1000
  };
}

/**
 * Đợi người dùng nhập mã và đồng ý (hỏi Google mỗi `interval` giây như Google yêu cầu).
 * `cancelled` trả về true thì dừng (người dùng bấm Huỷ). Trả về email đã đăng nhập.
 */
export async function waitForDeviceLogin(login: DeviceLogin, cancelled: () => boolean = () => false): Promise<string | undefined> {
  const client = await getGoogleClient();
  if (!client) throw new GoogleAuthError('Chưa nhập Client ID / Client secret của Google');
  let interval = login.interval;
  while (Date.now() < login.expiresAt) {
    await sleep(interval * 1000);
    if (cancelled()) throw new GoogleAuthError('Đã huỷ đăng nhập');
    const { json } = await post(TOKEN_URL, {
      client_id: client.clientId,
      client_secret: client.clientSecret,
      device_code: login.deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
    });
    if (json.access_token) {
      const tokens: GoogleTokens = {
        accessToken: json.access_token,
        refreshToken: json.refresh_token ?? '',
        expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
        email: emailFromIdToken(json.id_token)
      };
      await saveTokens(tokens);
      return tokens.email;
    }
    if (json.error === 'authorization_pending') continue;
    if (json.error === 'slow_down') {
      interval += 5;
      continue;
    }
    if (json.error === 'access_denied') throw new GoogleAuthError('Bạn đã từ chối cho Melo đọc thư viện YouTube');
    if (json.error === 'expired_token') break;
    throw clientError(json.error) ?? new Error(`Google: ${json.error_description || json.error || 'đăng nhập lỗi'}`);
  }
  throw new GoogleAuthError('Mã đăng nhập đã hết hạn, hãy thử lại');
}

// ---------- Token ----------

let cached: GoogleTokens | undefined;
let refreshing: Promise<GoogleTokens> | undefined;

async function loadTokens(): Promise<GoogleTokens | undefined> {
  cached ??= await secureGet<GoogleTokens>(TOKEN_KEY);
  return cached;
}

async function saveTokens(tokens: GoogleTokens) {
  cached = tokens;
  await secureSet(TOKEN_KEY, tokens);
}

export async function isGoogleConnected(): Promise<boolean> {
  return Boolean(await loadTokens());
}

export async function googleEmail(): Promise<string | undefined> {
  return (await loadTokens())?.email;
}

async function refresh(tokens: GoogleTokens): Promise<GoogleTokens> {
  refreshing ??= (async () => {
    try {
      const client = await getGoogleClient();
      if (!client || !tokens.refreshToken) throw new GoogleAuthError('Phiên Google đã hết hạn, hãy đăng nhập lại');
      const { json } = await post(TOKEN_URL, {
        client_id: client.clientId,
        client_secret: client.clientSecret,
        refresh_token: tokens.refreshToken,
        grant_type: 'refresh_token'
      });
      if (!json.access_token) throw clientError(json.error) ?? new Error(`Google: ${json.error_description || json.error || 'làm mới phiên lỗi'}`);
      const next = { ...tokens, accessToken: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 };
      await saveTokens(next);
      return next;
    } catch (err) {
      if (err instanceof GoogleAuthError) await disconnectGoogleAuth();
      throw err;
    } finally {
      refreshing = undefined;
    }
  })();
  return refreshing;
}

/** Access token còn hạn (tự làm mới khi còn dưới 1 phút). `force`: làm mới ngay (sau lỗi 401). */
export async function getGoogleAccessToken(force = false): Promise<string> {
  const tokens = await loadTokens();
  if (!tokens) throw new GoogleAuthError('Chưa đăng nhập Google');
  if (!force && tokens.expiresAt - 60_000 > Date.now()) return tokens.accessToken;
  return (await refresh(tokens)).accessToken;
}

/** Đăng xuất: thu hồi quyền ở phía Google (nếu được) và xoá token khỏi máy. */
export async function disconnectGoogleAuth(revoke = false): Promise<void> {
  const tokens = cached ?? (await secureGet<GoogleTokens>(TOKEN_KEY));
  cached = undefined;
  await secureRemove(TOKEN_KEY);
  if (revoke && tokens) await post(REVOKE_URL, { token: tokens.refreshToken || tokens.accessToken }).catch(() => undefined);
}

/** Chỉ dùng trong test. */
export function __resetGoogleAuthForTests() {
  cached = undefined;
  refreshing = undefined;
}
