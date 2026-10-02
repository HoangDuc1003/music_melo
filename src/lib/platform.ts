import { Capacitor } from '@capacitor/core';

/** true khi chạy trong app iPhone (Capacitor), false khi chạy thử trên trình duyệt PC. */
export const isNative = Capacitor.isNativePlatform();
