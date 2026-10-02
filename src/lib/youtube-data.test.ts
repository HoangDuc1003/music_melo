import { describe, expect, it } from 'vitest';
import { apiErrorReason, bestThumbnail, decodeEntities, isoDuration } from './youtube-data';

describe('dữ liệu YouTube Data API', () => {
  it('thời lượng ISO 8601', () => {
    expect(isoDuration('PT3M5S')).toBe(185);
    expect(isoDuration('PT1H2M5S')).toBe(3725);
    expect(isoDuration('P1DT1S')).toBe(86401);
    expect(isoDuration(undefined)).toBe(0);
  });

  it('ảnh rộng nhất', () => {
    expect(bestThumbnail({ default: { url: 'a', width: 120 }, high: { url: 'c', width: 480 }, medium: { url: 'b', width: 320 } })).toBe('c');
    expect(bestThumbnail(undefined)).toBe('');
  });

  it('giải mã ký tự HTML trong tên video', () => {
    expect(decodeEntities('Tom &amp; Jerry &#39;Live&#39; &quot;MV&quot; &#x1F3B5; &lt;3')).toBe('Tom & Jerry \'Live\' "MV" 🎵 <3');
    expect(decodeEntities('&unknown; &#0;')).toBe('&unknown; &#0;');
  });

  it('lý do lỗi kiểu cũ và kiểu mới', () => {
    expect(apiErrorReason({ error: { errors: [{ reason: 'quotaExceeded' }] } })).toBe('quotaExceeded');
    expect(apiErrorReason({ error: { status: 'PERMISSION_DENIED', details: [{ '@type': 'x' }, { reason: 'API_KEY_HTTP_REFERRER_BLOCKED' }] } })).toBe('API_KEY_HTTP_REFERRER_BLOCKED');
    expect(apiErrorReason({})).toBeUndefined();
  });
});
