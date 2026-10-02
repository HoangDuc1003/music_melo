import { describe, expect, it } from 'vitest';
import { clamp, memoAsync, Semaphore, sleep } from './async';

describe('Semaphore', () => {
  it('không chạy quá số việc cho phép', async () => {
    const sem = new Semaphore(3);
    let running = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 10 }, () =>
        sem.run(async () => {
          running += 1;
          peak = Math.max(peak, running);
          await sleep(5);
          running -= 1;
        })
      )
    );
    expect(peak).toBe(3);
  });
});

describe('clamp', () => {
  it('làm tròn rồi kẹp vào khoảng', () => {
    expect(clamp(7.6, 1, 15)).toBe(8);
    expect(clamp(0, 1, 15)).toBe(1);
    expect(clamp(99, 1, 15)).toBe(15);
  });
});

describe('memoAsync', () => {
  it('chỉ chạy một lần; lỗi thì lần sau chạy lại', async () => {
    let calls = 0;
    const load = memoAsync(async () => {
      calls += 1;
      if (calls === 1) throw new Error('mạng lỗi');
      return calls;
    });
    await expect(load()).rejects.toThrow('mạng lỗi');
    expect(await Promise.all([load(), load()])).toEqual([2, 2]);
    expect(await load()).toBe(2);
    expect(calls).toBe(2);
  });
});
