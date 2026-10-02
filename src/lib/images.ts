// Ảnh bìa đúng kích thước hiển thị: dòng 48px không cần ảnh 544px (tốn mạng, tốn bộ nhớ giải mã, cuộn kém mượt).
const RESIZABLE = /(^|\.)(googleusercontent\.com|ggpht\.com)$/;
const YTIMG = /(^|\.)ytimg\.com$/;
/** Các mức kích thước cố định để ảnh dùng lại được trong cache. */
const BUCKETS = [96, 144, 226, 320, 544];

export function bucket(px: number): number {
  return BUCKETS.find((b) => b >= px) ?? BUCKETS[BUCKETS.length - 1];
}

/** Ảnh googleusercontent/ggpht đổi kích thước bằng hậu tố "=w120-h120-…"; ảnh nơi khác giữ nguyên. */
export function resizeGoogleImage(url: string, size: number): string {
  try {
    if (!RESIZABLE.test(new URL(url).hostname)) return url;
  } catch {
    return url;
  }
  return `${url.replace(/=(w\d+-h\d+|s\d+)[^/]*$/, '')}=w${size}-h${size}-l90-rj`;
}

/** Đổi link ảnh sang kích thước gần nhất ≥ `px` điểm ảnh thật (đã nhân mật độ màn hình). */
export function sizedImage(url: string | undefined, px: number): string | undefined {
  if (!url || !/^https:\/\//.test(url)) return url;
  try {
    const parsed = new URL(url);
    if (RESIZABLE.test(parsed.hostname)) return resizeGoogleImage(url, bucket(px));
    if (YTIMG.test(parsed.hostname)) {
      const name = px <= 320 ? 'mqdefault' : 'hqdefault';
      return url.replace(/\/(default|mqdefault|hqdefault|sddefault|maxresdefault)(\.jpg|\.webp)/, `/${name}$2`);
    }
    return url;
  } catch {
    return url;
  }
}

export function devicePixels(cssPx: number): number {
  const dpr = typeof window === 'undefined' ? 2 : Math.min(window.devicePixelRatio || 2, 3);
  return Math.ceil(cssPx * dpr);
}
