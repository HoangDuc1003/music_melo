import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => new Map<string, unknown>());
const http = vi.hoisted(() => ({ appFetch: vi.fn() }));
vi.mock('@/lib/secure', () => ({
  secureGet: async (key: string) => store.get(key),
  secureSet: async (key: string, value: unknown) => void store.set(key, structuredClone(value)),
  secureRemove: async (key: string) => void store.delete(key)
}));
vi.mock('@/youtube/http', () => ({ appFetch: http.appFetch }));
vi.mock('@/lib/async', async (original) => ({ ...(await original<object>()), sleep: async () => undefined }));

import { db } from '@/lib/db';
import {
  __resetGoogleAuthForTests,
  disconnectGoogleAuth,
  emailFromIdToken,
  getGoogleAccessToken,
  googleEmail,
  isGoogleConnected,
  isValidGoogleClientId,
  setGoogleClient,
  startDeviceLogin,
  waitForDeviceLogin
} from './google-auth';

const CLIENT = '1234-abc.apps.googleusercontent.com';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const form = (call: unknown[]) => Object.fromEntries(new URLSearchParams(String((call[1] as RequestInit).body)));
const idToken = (payload: object) => `x.${btoa(JSON.stringify(payload)).replace(/=+$/, '')}.y`;

beforeEach(async () => {
  store.clear();
  http.appFetch.mockReset();
  __resetGoogleAuthForTests();
  await db.settings.clear();
  await setGoogleClient(CLIENT, 'bi-mat');
});

describe('đăng nhập Google bằng mã thiết bị', () => {
  it('kiểm tra Client ID, chưa nhập thì báo cần cài đặt', async () => {
    expect(isValidGoogleClientId(CLIENT)).toBe(true);
    expect(isValidGoogleClientId('abc')).toBe(false);
    store.clear();
    await expect(startDeviceLogin()).rejects.toThrow(/Client ID/);
  });

  it('lấy mã, chờ người dùng nhập (pending, slow_down), nhận token + email; client secret nằm trong Keychain', async () => {
    http.appFetch
      .mockResolvedValueOnce(json({ device_code: 'dev', user_code: 'ABCD-EFGH', verification_url: 'https://www.google.com/device', interval: 5, expires_in: 1800 }))
      .mockResolvedValueOnce(json({ error: 'authorization_pending' }, 428))
      .mockResolvedValueOnce(json({ error: 'slow_down' }, 403))
      .mockResolvedValueOnce(json({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600, id_token: idToken({ email: 'ban@gmail.com' }) }));
    const login = await startDeviceLogin();
    expect(login).toMatchObject({ userCode: 'ABCD-EFGH', verificationUrl: 'https://www.google.com/device', interval: 5 });
    expect(form(http.appFetch.mock.calls[0])).toEqual({ client_id: CLIENT, scope: 'openid email https://www.googleapis.com/auth/youtube.readonly' });

    expect(await waitForDeviceLogin(login)).toBe('ban@gmail.com');
    expect(form(http.appFetch.mock.calls[1])).toMatchObject({ client_id: CLIENT, client_secret: 'bi-mat', device_code: 'dev', grant_type: 'urn:ietf:params:oauth:grant-type:device_code' });
    expect(store.get('google.clientSecret')).toBe('bi-mat');
    expect(await isGoogleConnected()).toBe(true);
    expect(await googleEmail()).toBe('ban@gmail.com');
    expect(await getGoogleAccessToken()).toBe('AT');
  });

  it('người dùng từ chối / mã hết hạn / huỷ', async () => {
    const login = { userCode: 'X', verificationUrl: '', deviceCode: 'd', interval: 1, expiresAt: Date.now() + 60_000 };
    http.appFetch.mockResolvedValueOnce(json({ error: 'access_denied' }, 403));
    await expect(waitForDeviceLogin(login)).rejects.toThrow(/từ chối/);
    http.appFetch.mockResolvedValueOnce(json({ error: 'expired_token' }, 403));
    await expect(waitForDeviceLogin(login)).rejects.toThrow(/hết hạn/);
    await expect(waitForDeviceLogin(login, () => true)).rejects.toThrow(/huỷ/);
    expect(await isGoogleConnected()).toBe(false);
  });

  it('token hết hạn thì tự làm mới (giữ refresh token); invalid_grant thì đăng xuất', async () => {
    store.set('google.tokens', { accessToken: 'old', refreshToken: 'RT', expiresAt: Date.now() - 1, email: 'ban@gmail.com' });
    http.appFetch.mockResolvedValueOnce(json({ access_token: 'new', expires_in: 3600 }));
    expect(await getGoogleAccessToken()).toBe('new');
    expect(form(http.appFetch.mock.calls[0])).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'RT', client_secret: 'bi-mat' });
    expect(store.get('google.tokens')).toMatchObject({ accessToken: 'new', refreshToken: 'RT' });

    http.appFetch.mockResolvedValueOnce(json({ error: 'invalid_grant' }, 400));
    await expect(getGoogleAccessToken(true)).rejects.toThrow(/hết hạn/);
    expect(await isGoogleConnected()).toBe(false);
  });

  it('đăng xuất thì thu hồi quyền và xoá token', async () => {
    store.set('google.tokens', { accessToken: 'AT', refreshToken: 'RT', expiresAt: Date.now() + 3600_000 });
    http.appFetch.mockResolvedValueOnce(json({}));
    await disconnectGoogleAuth(true);
    expect(store.has('google.tokens')).toBe(false);
    expect(String(http.appFetch.mock.calls[0][0])).toContain('/revoke');
    expect(form(http.appFetch.mock.calls[0])).toEqual({ token: 'RT' });
  });

  it('đọc email trong id_token (có ký tự tiếng Việt)', () => {
    const encoded = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify({ email: 'hoàng@gmail.com' }))));
    expect(emailFromIdToken(`a.${encoded.replace(/\+/g, '-').replace(/\//g, '_')}.b`)).toBe('hoàng@gmail.com');
    expect(emailFromIdToken('rác')).toBeUndefined();
  });
});
