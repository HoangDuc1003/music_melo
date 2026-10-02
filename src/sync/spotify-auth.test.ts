import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => new Map<string, unknown>());
const http = vi.hoisted(() => ({ appFetch: vi.fn() }));

vi.mock('@/lib/secure', () => ({
  secureGet: async (key: string) => store.get(key),
  secureSet: async (key: string, value: unknown) => void store.set(key, structuredClone(value)),
  secureRemove: async (key: string) => void store.delete(key)
}));
vi.mock('@/youtube/http', () => ({ appFetch: http.appFetch }));

import { db } from '@/lib/db';
import {
  __resetSpotifyAuthForTests,
  authorizeUrl,
  codeChallenge,
  completeSpotifyLogin,
  getAccessToken,
  isSpotifyCallback,
  isSpotifyConnected,
  isValidClientId,
  prepareSpotifyLogin,
  randomString,
  setClientId,
  SpotifyAuthError
} from './spotify-auth';

const CLIENT = '0123456789abcdef0123456789abcdef';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const formOf = (call: unknown[]) => new URLSearchParams(String((call[1] as RequestInit).body));

beforeEach(async () => {
  store.clear();
  localStorage.clear();
  http.appFetch.mockReset();
  __resetSpotifyAuthForTests();
  await db.settings.clear();
  await setClientId(CLIENT);
});

/** Đi hết luồng đăng nhập (giả Spotify), trả về body của request đổi mã. */
async function login(tokens = { access_token: 'A1', refresh_token: 'R1', expires_in: 3600, scope: 'user-library-read' }) {
  const url = new URL(await prepareSpotifyLogin());
  const state = url.searchParams.get('state')!;
  http.appFetch.mockResolvedValueOnce(json(tokens));
  await completeSpotifyLogin(`com.melo.music://spotify/callback?code=CODE&state=${state}`);
  return { url, body: formOf(http.appFetch.mock.calls[0]) };
}

describe('PKCE', () => {
  it('code_challenge đúng ví dụ RFC 7636', async () => {
    expect(await codeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('chuỗi ngẫu nhiên đủ dài, chỉ gồm ký tự hợp lệ, không lặp', () => {
    const a = randomString(64);
    expect(a).toMatch(/^[A-Za-z0-9\-._~]{64}$/);
    expect(randomString(64)).not.toBe(a);
  });

  it('link đăng nhập có đủ tham số, chỉ xin quyền đọc', () => {
    const url = new URL(authorizeUrl({ clientId: CLIENT, redirect: 'com.melo.music://spotify/callback', state: 'S', challenge: 'C' }));
    expect(url.origin + url.pathname).toBe('https://accounts.spotify.com/authorize');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: CLIENT,
      response_type: 'code',
      redirect_uri: 'com.melo.music://spotify/callback',
      code_challenge_method: 'S256',
      code_challenge: 'C',
      state: 'S'
    });
    expect(url.searchParams.get('scope')!.split(' ').every((s) => s.endsWith('-read') || s.startsWith('playlist-read'))).toBe(true);
  });

  it('kiểm tra Client ID', async () => {
    expect(isValidClientId(CLIENT)).toBe(true);
    expect(isValidClientId('abc')).toBe(false);
    await expect(setClientId('không hợp lệ')).rejects.toThrow(/32 ký tự/);
  });
});

describe('đăng nhập', () => {
  it('đổi mã bằng code_verifier khớp code_challenge, lưu token vào Keychain', async () => {
    const { url, body } = await login();
    expect(http.appFetch.mock.calls[0][0]).toBe('https://accounts.spotify.com/api/token');
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('CODE');
    expect(body.get('client_id')).toBe(CLIENT);
    expect(body.get('client_secret')).toBeNull();
    expect(await codeChallenge(body.get('code_verifier')!)).toBe(url.searchParams.get('code_challenge'));
    expect(await isSpotifyConnected()).toBe(true);
    expect(store.get('spotify.tokens')).toMatchObject({ accessToken: 'A1', refreshToken: 'R1', clientId: CLIENT });
    // verifier chỉ dùng một lần
    expect(localStorage.getItem('melo.spotify.pending')).toBeNull();
  });

  it('chặn link có state sai, link cũ, và khi người dùng từ chối', async () => {
    await prepareSpotifyLogin();
    await expect(completeSpotifyLogin('com.melo.music://spotify/callback?code=X&state=gia')).rejects.toThrow(/không hợp lệ/);
    // pending đã bị huỷ sau lần thử trên: dùng lại link cũ cũng bị chặn
    await expect(completeSpotifyLogin('com.melo.music://spotify/callback?code=X&state=gia')).rejects.toThrow(/hết hạn/);
    await prepareSpotifyLogin();
    await expect(completeSpotifyLogin('com.melo.music://spotify/callback?error=access_denied')).rejects.toThrow(/không cho Melo/);
    expect(http.appFetch).not.toHaveBeenCalled();
    expect(await isSpotifyConnected()).toBe(false);
  });

  it('nhận đúng link callback', () => {
    expect(isSpotifyCallback('com.melo.music://spotify/callback?code=1&state=2')).toBe(true);
    expect(isSpotifyCallback('com.melo.music://khac?code=1')).toBe(false);
    expect(isSpotifyCallback(`${location.origin}/spotify/callback?code=1`)).toBe(true);
    expect(isSpotifyCallback('https://evil.example/spotify/callback?code=1')).toBe(false);
  });
});

describe('token', () => {
  it('còn hạn thì dùng luôn; sắp hết hạn thì làm mới một lần dù nhiều lời gọi cùng lúc', async () => {
    await login({ access_token: 'A1', refresh_token: 'R1', expires_in: 3600, scope: '' });
    http.appFetch.mockClear();
    expect(await getAccessToken()).toBe('A1');
    expect(http.appFetch).not.toHaveBeenCalled();

    __resetSpotifyAuthForTests();
    store.set('spotify.tokens', { ...(store.get('spotify.tokens') as object), expiresAt: Date.now() + 10_000 });
    http.appFetch.mockResolvedValueOnce(json({ access_token: 'A2', refresh_token: 'R2', expires_in: 3600 }));
    const [a, b] = await Promise.all([getAccessToken(), getAccessToken()]);
    expect([a, b]).toEqual(['A2', 'A2']);
    expect(http.appFetch).toHaveBeenCalledTimes(1);
    const body = formOf(http.appFetch.mock.calls[0]);
    expect(Object.fromEntries(body)).toEqual({ grant_type: 'refresh_token', refresh_token: 'R1', client_id: CLIENT });
    expect(store.get('spotify.tokens')).toMatchObject({ accessToken: 'A2', refreshToken: 'R2' });
  });

  it('refresh token không xoay vòng thì giữ cái cũ', async () => {
    await login();
    http.appFetch.mockResolvedValueOnce(json({ access_token: 'A2', expires_in: 3600 }));
    expect(await getAccessToken(true)).toBe('A2');
    expect(store.get('spotify.tokens')).toMatchObject({ refreshToken: 'R1' });
  });

  it('refresh token hết hạn (quá 6 tháng) thì ngắt kết nối và báo đăng nhập lại', async () => {
    await login();
    http.appFetch.mockResolvedValueOnce(json({ error: 'invalid_grant', error_description: 'Refresh token revoked' }, 400));
    await expect(getAccessToken(true)).rejects.toBeInstanceOf(SpotifyAuthError);
    expect(await isSpotifyConnected()).toBe(false);
    await expect(getAccessToken()).rejects.toThrow(/Chưa kết nối/);
  });
});
