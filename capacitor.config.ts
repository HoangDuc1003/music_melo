import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // Giữ cố định: đổi appId thì iPhone coi là app khác và nhạc đã tải sẽ mất.
  appId: 'com.melo.music',
  appName: 'Melo',
  webDir: 'dist',
  backgroundColor: '#121212',
  ios: {
    contentInset: 'never',
    backgroundColor: '#121212',
    scrollEnabled: false
  },
  plugins: {
    // Không vá fetch toàn cục: lớp YouTube tự gọi CapacitorHttp khi cần.
    CapacitorHttp: { enabled: false },
    StatusBar: { overlaysWebView: true, style: 'DARK' }
  }
};

export default config;
