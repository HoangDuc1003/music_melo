// Đăng nhập Spotify bằng Authorization Code + PKCE: không cần client secret, không cần server.
// Trang đăng nhập mở trong Safari của app (có "Tiếp tục bằng Google"), Spotify trả về
// com.melo.music://spotify/callback, app đổi mã lấy token rồi cất token vào Keychain.
// Mỗi người tự tạo app Spotify riêng (Development Mode) và nhập Client ID: xem docs/SPOTIFY.md.
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { getSetting, setSetting } from '@/lib/db';
import { log } from '@/lib/log';
import { isNative } from '@/lib/platform';
import { secureGet, secureRemove, secureSet } from '@/lib/secure';
import { appFetch } from '@/youtube/http';

export const SPOTIFY_SCOPES = ['playlist-read-private', 'playlist-read-collaborative', 'user-library-read'];
export const NATIVE_REDIRECT = 'com.melo.music://spotify/callback';
const WEB_CALLBACK_PATH = '/spotify/callback';
const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const TOKEN_KEY = 'spotify.tokens';
const PENDING_KEY = 'melo.spotify.pending';
const PENDING_TTL_MS = 10 * 60_000;
const CLIENT_ID_SETTING = 'spotifyClientId';
const CLIENT_ID = /^[0-9a-f]{32}$/i;

export interface SpotifyTokens {
  accessToken: string;
  refreshToken: string;
  /** ms */
  expiresAt: number;
  scope: string;
  clientId: string;
}

interface PendingLogin {
  verifier: string;
  state: string;
  clientId: string;
  redirect: string;
  at: number;
}

/** Cần đăng nhập lại (chưa kết nối, bị thu hồi, hoặc token quá 6 tháng). */
export class SpotifyAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpotifyAuthError';
  }
}

// ---------- Client ID ----------

export function isValidClientId(value: string): boolean {
  return CLIENT_ID.test(value.trim());
}

/** Client ID nhập trong Cài đặt, hoặc gắn sẵn lúc build (VITE_SPOTIFY_CLIENT_ID). Không phải bí mật. */
export async function getClientId(): Promise<string | undefined> {
  const saved = await getSetting<string>(CLIENT_ID_SETTING, '');
  const value = saved || (import.meta.env.VITE_SPOTIFY_CLIENT_ID as string | undefined) || '';
  return isValidClientId(value) ? value.trim() : undefined;
}

export async function setClientId(value: string): Promise<void> {
  if (!isValidClientId(value)) throw new Error('Client ID phải gồm 32 ký tự 0-9, a-f');
  await setSetting(CLIENT_ID_SETTING, value.trim());
}

// ---------- PKCE ----------

const UNRESERVED = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

/** Chuỗi ngẫu nhiên an toàn (crypto) chỉ gồm ký tự hợp lệ cho code_verifier. */
export function randomString(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  // 66 ký tự: lấy theo 0..197 (3×66) để không lệch phân bố.
  let out = '';
  for (const b of bytes) out += b < 198 ? UNRESERVED[b % 66] : '';
  return out.length >= length ? out.slice(0, length) : out + randomString(length - out.length);
}

function base64Url(bytes: ArrayBuffer): string {
  let binary = '';
  for (const b of new Uint8Array(bytes)) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function codeChallenge(verifier: string): Promise<string> {
  return base64Url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
}

export function redirectUri(): string {
  return isNative ? NATIVE_REDIRECT : `${location.origin}${WEB_CALLBACK_PATH}`;
}

export function authorizeUrl(options: { clientId: string; redirect: string; state: string; challenge: string }): string {
  const params = new URLSearchParams({
    client_id: options.clientId,
    response_type: 'code',
    redirect_uri: options.redirect,
    code_challenge_method: 'S256',
    code_challenge: options.challenge,
    state: options.state,
    scope: SPOTIFY_SCOPES.join(' ')
  });
  return `${AUTHORIZE_URL}?${params}`;
}

// ---------- Token ----------

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

async function requestToken(body: Record<string, string>): Promise<TokenResponse> {
  const res = await appFetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString()
  });
  let json: TokenResponse;
  try {
    json = (await res.json()) as TokenResponse;
  } catch {
    throw new Error(`Spotify trả lỗi ${res.status}`);
  }
  if (!res.ok || !json.access_token) {
    // invalid_grant: refresh token bị thu hồi hoặc đã quá 6 tháng.
    if (json.error === 'invalid_grant') throw new SpotifyAuthError('Phiên Spotify đã hết hạn, hãy kết nối lại');
    if (json.error === 'invalid_client') throw new SpotifyAuthError('Client ID hoặc Redirect URI chưa đúng (xem hướng dẫn)');
    throw new Error(`Spotify: ${json.error_description || json.error || res.status}`);
  }
  return json;
}

let cached: SpotifyTokens | undefined;
let refreshing: Promise<SpotifyTokens> | undefined;

async function loadTokens(): Promise<SpotifyTokens | undefined> {
  cached ??= await secureGet<SpotifyTokens>(TOKEN_KEY);
  return cached;
}

async function saveTokens(tokens: SpotifyTokens) {
  cached = tokens;
  await secureSet(TOKEN_KEY, tokens);
}

function toTokens(json: TokenResponse, clientId: string, previousRefresh?: string): SpotifyTokens {
  return {
    accessToken: json.access_token,
    // Spotify có thể trả refresh token mới (xoay vòng); không có thì giữ cái cũ.
    refreshToken: json.refresh_token ?? previousRefresh ?? '',
    expiresAt: Date.now() + json.expires_in * 1000,
    scope: json.scope ?? '',
    clientId
  };
}

export async function isSpotifyConnected(): Promise<boolean> {
  return Boolean(await loadTokens());
}

async function refresh(tokens: SpotifyTokens): Promise<SpotifyTokens> {
  refreshing ??= (async () => {
    try {
      const json = await requestToken({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken, client_id: tokens.clientId });
      const next = toTokens(json, tokens.clientId, tokens.refreshToken);
      await saveTokens(next);
      return next;
    } catch (err) {
      if (err instanceof SpotifyAuthError) await disconnectSpotifyAuth();
      throw err;
    } finally {
      refreshing = undefined;
    }
  })();
  return refreshing;
}

/** Access token còn hạn (tự làm mới khi còn dưới 1 phút). `force`: làm mới ngay (sau lỗi 401). */
export async function getAccessToken(force = false): Promise<string> {
  const tokens = await loadTokens();
  if (!tokens) throw new SpotifyAuthError('Chưa kết nối Spotify');
  if (!force && tokens.expiresAt - 60_000 > Date.now()) return tokens.accessToken;
  return (await refresh(tokens)).accessToken;
}

export async function disconnectSpotifyAuth(): Promise<void> {
  cached = undefined;
  await secureRemove(TOKEN_KEY);
}

// ---------- Đăng nhập ----------

/** Tạo verifier/state cho lần đăng nhập này (giữ tối đa 10 phút) và trả về link trang đăng nhập Spotify. */
export async function prepareSpotifyLogin(): Promise<string> {
  const clientId = await getClientId();
  if (!clientId) throw new Error('Chưa nhập Client ID của app Spotify (xem hướng dẫn)');
  const pending: PendingLogin = { verifier: randomString(64), state: randomString(24), clientId, redirect: redirectUri(), at: Date.now() };
  localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  return authorizeUrl({ clientId, redirect: pending.redirect, state: pending.state, challenge: await codeChallenge(pending.verifier) });
}

/** Mở trang đăng nhập Spotify. Kết quả về qua `completeSpotifyLogin` (link mở app / trang callback). */
export async function startSpotifyLogin(): Promise<void> {
  const url = await prepareSpotifyLogin();
  if (isNative) await Browser.open({ url, presentationStyle: 'popover' });
  else location.assign(url);
}

export function isSpotifyCallback(url: string): boolean {
  if (url.startsWith(`${NATIVE_REDIRECT}?`)) return true;
  try {
    const u = new URL(url);
    return u.origin === location.origin && u.pathname === WEB_CALLBACK_PATH;
  } catch {
    return false;
  }
}

function takePending(): PendingLogin | undefined {
  const raw = localStorage.getItem(PENDING_KEY);
  localStorage.removeItem(PENDING_KEY);
  if (!raw) return undefined;
  try {
    const pending = JSON.parse(raw) as PendingLogin;
    return Date.now() - pending.at <= PENDING_TTL_MS ? pending : undefined;
  } catch {
    return undefined;
  }
}

/** Đổi mã trong link callback lấy token. Kiểm tra `state` để chặn link giả. */
export async function completeSpotifyLogin(callbackUrl: string): Promise<void> {
  const params = new URL(callbackUrl).searchParams;
  const pending = takePending();
  const error = params.get('error');
  if (error) throw new Error(error === 'access_denied' ? 'Bạn đã không cho Melo đọc thư viện Spotify' : `Spotify báo lỗi: ${error}`);
  if (!pending) throw new Error('Phiên đăng nhập đã hết hạn, hãy bấm Kết nối lại');
  if (params.get('state') !== pending.state) throw new Error('Link đăng nhập không hợp lệ');
  const code = params.get('code');
  if (!code) throw new Error('Spotify không trả mã đăng nhập');
  const json = await requestToken({
    grant_type: 'authorization_code',
    code,
    redirect_uri: pending.redirect,
    client_id: pending.clientId,
    code_verifier: pending.verifier
  });
  await saveTokens(toTokens(json, pending.clientId));
}

/**
 * Lắng nghe kết quả đăng nhập: link com.melo.music://… (iPhone) hoặc trang /spotify/callback (PC).
 * `onDone(error?)` được gọi sau mỗi lần đăng nhập xong hoặc lỗi.
 */
export async function listenSpotifyCallbacks(onDone: (error?: unknown) => void): Promise<void> {
  const handle = async (url: string) => {
    try {
      await completeSpotifyLogin(url);
      onDone();
    } catch (err) {
      log.warn('spotify', 'đăng nhập lỗi:', err);
      onDone(err);
    }
  };
  if (isNative) {
    await App.addListener('appUrlOpen', ({ url }) => {
      if (!isSpotifyCallback(url)) return;
      void Browser.close().catch(() => undefined);
      void handle(url);
    });
  } else if (isSpotifyCallback(location.href)) {
    const url = location.href;
    history.replaceState(null, '', '/');
    await handle(url);
  }
}

/** Chỉ dùng trong test. */
export function __resetSpotifyAuthForTests() {
  cached = undefined;
  refreshing = undefined;
}
