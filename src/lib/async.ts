// Tiện ích bất đồng bộ dùng chung.

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Làm tròn rồi kẹp vào [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.round(value), min), max);
}

/** Nhớ kết quả của hàm async (chỉ chạy một lần); lỗi thì quên đi để lần gọi sau thử lại. */
export function memoAsync<T>(fn: () => Promise<T>): () => Promise<T> {
  let result: Promise<T> | undefined;
  return () =>
    (result ??= fn().catch((err: unknown) => {
      result = undefined;
      throw err;
    }));
}

/** Giới hạn số việc chạy song song (ví dụ số lần hỏi link YouTube cùng lúc). `new Semaphore(1)` = chạy lần lượt. */
export class Semaphore {
  private waiting: (() => void)[] = [];
  private running = 0;

  constructor(private readonly size: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.running >= this.size) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.running += 1;
    try {
      return await task();
    } finally {
      this.running -= 1;
      this.waiting.shift()?.();
    }
  }
}
