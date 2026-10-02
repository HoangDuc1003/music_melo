import { describe, expect, it } from 'vitest';
import { AdaptiveLimiter, classifyFailure, HARD_MAX } from './concurrency';

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

/** Mô phỏng: mạng có băng thông `capacity` byte/giây chia đều cho các lượt đang chạy. */
function feed(limiter: AdaptiveLimiter, c: ReturnType<typeof clock>, bytesPerSecond: number, ms = 1000) {
  for (let i = 0; i < ms / 100; i++) {
    c.advance(100);
    limiter.recordBytes(bytesPerSecond / 10);
  }
}

describe('AdaptiveLimiter', () => {
  it('tăng dần từng lượt khi tốc độ tổng còn tăng, tới mức tối đa', () => {
    const c = clock();
    const limiter = new AdaptiveLimiter({ initial: 3, max: 15, now: c.now });
    for (let round = 0; round < 30; round++) {
      // Mỗi lượt thêm ~1 MB/s (mạng còn dư): tốc độ tăng theo số lượt.
      feed(limiter, c, limiter.limit * 1_000_000, 4000);
      limiter.onSuccess(true);
    }
    expect(limiter.limit).toBe(15);
  });

  it('dừng tăng khi chạm đỉnh băng thông, lùi lại khi thêm lượt làm tụt tốc độ', () => {
    const c = clock();
    const limiter = new AdaptiveLimiter({ initial: 3, max: 15, now: c.now });
    const capacity = 6_000_000; // đỉnh 6 MB/s, đạt được với 6 lượt (mỗi lượt tối đa 1 MB/s)
    const speedFor = (n: number) => (n <= 6 ? n * 1_000_000 : capacity * (1 - (n - 6) * 0.3));
    for (let round = 0; round < 40; round++) {
      feed(limiter, c, speedFor(limiter.limit), 4000);
      limiter.onSuccess(true);
    }
    expect(limiter.limit).toBeGreaterThanOrEqual(6);
    expect(limiter.limit).toBeLessThanOrEqual(8);
  });

  it('không tăng khi chưa dùng hết lượt cho phép', () => {
    const c = clock();
    const limiter = new AdaptiveLimiter({ initial: 3, max: 15, now: c.now });
    feed(limiter, c, 5_000_000);
    limiter.onSuccess(false);
    expect(limiter.limit).toBe(3);
  });

  it('bị chặn thì giảm một nửa và nghỉ, nghỉ lâu dần nếu bị chặn liên tiếp', () => {
    const c = clock();
    const limiter = new AdaptiveLimiter({ initial: 12, max: 15, baseCooldownMs: 5000, now: c.now });
    limiter.onFailure('blocked');
    expect(limiter.limit).toBe(6);
    expect(limiter.canStart(0)).toBe(false);
    expect(limiter.cooldownRemaining()).toBe(5000);
    c.advance(5000);
    expect(limiter.canStart(0)).toBe(true);
    expect(limiter.canStart(6)).toBe(false);

    limiter.onFailure('blocked');
    expect(limiter.limit).toBe(3);
    expect(limiter.cooldownRemaining()).toBe(10_000);
    limiter.onFailure('blocked');
    limiter.onFailure('blocked');
    expect(limiter.limit).toBe(1);
    expect(limiter.cooldownRemaining()).toBe(40_000);

    // Tải được lại thì hết đếm liên tiếp.
    c.advance(40_000);
    limiter.onSuccess(false);
    limiter.onFailure('blocked');
    expect(limiter.cooldownRemaining()).toBe(5000);
  });

  it('lỗi mạng chỉ bớt 1 lượt, không nghỉ', () => {
    const limiter = new AdaptiveLimiter({ initial: 5 });
    limiter.onFailure('network');
    expect(limiter.limit).toBe(4);
    expect(limiter.canStart(0)).toBe(true);
    limiter.onFailure('other');
    expect(limiter.limit).toBe(4);
  });

  it('giới hạn theo cài đặt và mức trần 15', () => {
    const limiter = new AdaptiveLimiter({ initial: 10, max: 99 });
    expect(limiter.max).toBe(HARD_MAX);
    limiter.setMax(6); // chuyển sang 4G/5G
    expect(limiter.limit).toBe(6);
    limiter.setFixed(2);
    expect(limiter.limit).toBe(2);
    expect(limiter.max).toBe(2);
    limiter.setFixed(0);
    expect(limiter.limit).toBe(1);
  });
});

describe('classifyFailure', () => {
  it('nhận ra bị chặn, lỗi mạng, lỗi khác', () => {
    expect(classifyFailure({ message: 'x', data: { httpStatus: 403 } })).toBe('blocked');
    expect(classifyFailure(new Error('HTTP 429'))).toBe('blocked');
    expect(classifyFailure({ message: 'YouTube đang chặn', reason: 'blocked' })).toBe('blocked');
    expect(classifyFailure(new Error('The request timed out.'))).toBe('network');
    expect(classifyFailure(new Error('The Internet connection appears to be offline.'))).toBe('network');
    expect(classifyFailure(new Error('Tải chưa trọn (100/200 byte)'))).toBe('other');
  });
});
