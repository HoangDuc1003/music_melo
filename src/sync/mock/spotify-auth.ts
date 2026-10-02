// Bản giả của src/sync/spotify-auth.ts cho `npm run dev:mock`: bấm Kết nối là "đăng nhập" ngay, không gọi Spotify.
export { isValidClientId, NATIVE_REDIRECT, SPOTIFY_SCOPES, SpotifyAuthError } from '../spotify-auth';

const MOCK_CLIENT_ID = '0123456789abcdef0123456789abcdef';
let connected = false;
let onLogin: ((error?: unknown) => void) | undefined;

export const redirectUri = () => `${location.origin}/spotify/callback`;
export const getClientId = async () => MOCK_CLIENT_ID;
export const setClientId = async () => undefined;
export const isSpotifyConnected = async () => connected;
export const getAccessToken = async () => 'mock-token';

export async function disconnectSpotifyAuth() {
  connected = false;
}

export async function startSpotifyLogin() {
  connected = true;
  setTimeout(() => onLogin?.(), 300);
}

export async function listenSpotifyCallbacks(onDone: (error?: unknown) => void) {
  onLogin = onDone;
}
