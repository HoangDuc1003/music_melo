// Lưu bí mật (token đăng nhập) trong Keychain của iPhone qua plugin MeloPlayer.
// Không dùng localStorage/Preferences/IndexedDB cho token. Bản web (chạy thử trên PC) dùng localStorage.
import { MeloPlayer } from 'capacitor-melo-player';

export async function secureGet<T>(key: string): Promise<T | undefined> {
  const { value } = await MeloPlayer.keychainGet({ key });
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

export function secureSet(key: string, value: unknown): Promise<void> {
  return MeloPlayer.keychainSet({ key, value: JSON.stringify(value) });
}

export function secureRemove(key: string): Promise<void> {
  return MeloPlayer.keychainRemove({ key });
}
