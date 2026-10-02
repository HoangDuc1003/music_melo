/// <reference types="vite/client" />

/** Phiên bản app (package.json + số build của GitHub Actions), gắn lúc build. */
declare const __APP_VERSION__: string;

/**
 * true ở bản web (PWA, `vite --mode web`): nhạc từ Jamendo + file của người dùng, không có YouTube/Spotify.
 * Hằng số thay lúc build nên phần code của bản kia bị loại khỏi bundle.
 */
declare const __WEB_APP__: boolean;
