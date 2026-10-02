// Trạng thái mạng cho giao diện và logic phát/tải. Trình phát, phần tải về, Spotify theo dõi `useNetwork`.
import { Network } from '@capacitor/network';
import { create } from 'zustand';
import { log } from './log';

interface NetworkState {
  online: boolean;
  /** 'wifi' | 'cellular' | 'none' | 'unknown' */
  connectionType: string;
}

export const useNetwork = create<NetworkState>(() => ({
  online: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
  connectionType: 'unknown'
}));

export function setNetworkStatus(online: boolean, connectionType: string) {
  useNetwork.setState({ online, connectionType });
}

export function isOnline(): boolean {
  return useNetwork.getState().online;
}

/** Gọi một lần khi mở app, trước các phần khác. */
export async function initNetwork() {
  try {
    const status = await Network.getStatus();
    setNetworkStatus(status.connected, status.connectionType);
    await Network.addListener('networkStatusChange', (s) => setNetworkStatus(s.connected, s.connectionType));
  } catch (err) {
    log.warn('network', 'không theo dõi được mạng:', err);
  }
}
