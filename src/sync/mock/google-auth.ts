// Bản giả của src/sync/google-auth.ts cho `npm run dev:mock`: hiện mã đăng nhập, 2 giây sau coi như đã đăng nhập.
export { emailFromIdToken, GOOGLE_SCOPES, GoogleAuthError, isValidGoogleClientId } from '../google-auth';
import type { DeviceLogin } from '../google-auth';

let connected = false;
const EMAIL = 'ban.melo@gmail.com';

export const getGoogleClient = async () => ({ clientId: 'mock.apps.googleusercontent.com', clientSecret: 'mock' });
export const setGoogleClient = async () => undefined;
export const isGoogleConnected = async () => connected;
export const googleEmail = async () => (connected ? EMAIL : undefined);
export const getGoogleAccessToken = async () => 'mock-token';

export async function startDeviceLogin(): Promise<DeviceLogin> {
  return { userCode: 'MELO-2026', verificationUrl: 'https://www.google.com/device', deviceCode: 'mock', interval: 1, expiresAt: Date.now() + 600_000 };
}

export async function waitForDeviceLogin(_login: DeviceLogin, cancelled: () => boolean = () => false): Promise<string> {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  if (cancelled()) throw new Error('Đã huỷ đăng nhập');
  connected = true;
  return EMAIL;
}

export async function disconnectGoogleAuth() {
  connected = false;
}
