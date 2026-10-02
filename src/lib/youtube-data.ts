// Phần thuần dùng chung khi đọc YouTube Data API v3 (đồng bộ Gmail trên app iPhone, nguồn YouTube của bản web).

export interface Thumbnails {
  [size: string]: { url?: string; width?: number } | undefined;
}

/** Ảnh rộng nhất trong danh sách ảnh YouTube trả về. */
export function bestThumbnail(thumbnails: Thumbnails | undefined): string {
  const list = Object.values(thumbnails ?? {}).filter((t): t is { url: string; width?: number } => Boolean(t?.url));
  list.sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  return list[0]?.url ?? '';
}

/** "PT1H2M5S" → 3725 giây. */
export function isoDuration(value: string | undefined): number {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value ?? '');
  if (!m) return 0;
  const [, d, h, min, s] = m.map((x) => Number(x) || 0);
  return d * 86400 + h * 3600 + min * 60 + s;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Tên video trong kết quả tìm kiếm bị mã hoá HTML ("Tom &amp; Jerry", "&#39;"): đổi về chữ thường. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] !== '#') return ENTITIES[code.toLowerCase()] ?? match;
    const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : match;
  });
}

/** Lý do lỗi Google trả về: kiểu cũ `errors[0].reason` hoặc kiểu mới `details[].reason`. */
export function apiErrorReason(body: unknown): string | undefined {
  const error = (body as { error?: { errors?: { reason?: string }[]; details?: { reason?: string }[]; status?: string } } | undefined)?.error;
  return error?.details?.find((d) => d.reason)?.reason ?? error?.errors?.[0]?.reason ?? error?.status;
}
