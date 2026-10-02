import { describe, expect, it } from 'vitest';
import { formatBytes, formatClock, formatDuration, formatTotalDuration, formatWhen } from './format';

describe('định dạng', () => {
  it('thời lượng', () => {
    expect(formatDuration(245)).toBe('4:05');
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(formatTotalDuration(4320)).toBe('1 giờ 12 phút');
    expect(formatTotalDuration(2280)).toBe('38 phút');
  });

  it('thời điểm: hôm nay chỉ ghi giờ, ngày khác ghi thêm ngày', () => {
    const at = new Date(2026, 9, 2, 21, 5).getTime();
    expect(formatClock(at)).toMatch(/^21:05$/);
    expect(formatWhen(at, new Date(2026, 9, 2, 23, 0))).toBe(`lúc ${formatClock(at)} hôm nay`);
    expect(formatWhen(at, new Date(2026, 9, 3, 8, 0))).toBe(`${formatClock(at)} ${new Date(at).toLocaleDateString('vi-VN')}`);
  });

  it('dung lượng', () => {
    expect(formatBytes(0)).toBe('0 MB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(3 * 1024 ** 3)).toBe('3.00 GB');
  });
});
