// Trạng thái mạng cho giao diện và logic phát/tải (cập nhật từ @capacitor/network trong player/controller.ts).
import { create } from 'zustand';

interface NetworkState {
  online: boolean;
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
