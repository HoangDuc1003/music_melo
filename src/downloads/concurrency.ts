// Tự điều chỉnh số bài tải cùng lúc theo AIMD (giống cách TCP tránh nghẽn mạng):
// - Mỗi bài tải xong mà tốc độ tổng vẫn tăng → thêm 1 lượt (cộng dồn) cho tới mức tối đa.
// - Tốc độ tổng không tăng nữa (đã chạm "đỉnh" băng thông) → giữ nguyên; tụt rõ rệt → bớt 1 lượt.
// - YouTube chặn (403/429) → giảm một nửa (nhân) và tạm nghỉ, nghỉ lâu dần nếu bị chặn liên tiếp.
// Logic thuần (đồng hồ tiêm vào) để test chính xác.

export type FailureKind = 'blocked' | 'network' | 'other';

export interface LimiterOptions {
  min?: number;
  max?: number;
  initial?: number;
  /** cửa sổ đo tốc độ (ms) */
  windowMs?: number;
  /** thời gian nghỉ đầu tiên khi bị chặn (ms), nhân đôi mỗi lần liên tiếp */
  baseCooldownMs?: number;
  maxCooldownMs?: number;
  now?: () => number;
}

export const HARD_MAX = 15;

interface Sample {
  t: number;
  bytes: number;
}

export class AdaptiveLimiter {
  readonly min: number;
  private maxLimit: number;
  private current: number;
  private readonly windowMs: number;
  private readonly baseCooldownMs: number;
  private readonly maxCooldownMs: number;
  private readonly now: () => number;
  private samples: Sample[] = [];
  private cooldownUntil = 0;
  private consecutiveBlocks = 0;
  /** tốc độ đo được lúc tăng lượt gần nhất (byte/giây) */
  private baseline = 0;

  constructor(options: LimiterOptions = {}) {
    this.min = Math.max(1, options.min ?? 1);
    this.maxLimit = clamp(options.max ?? 10, this.min, HARD_MAX);
    this.current = clamp(options.initial ?? 3, this.min, this.maxLimit);
    this.windowMs = options.windowMs ?? 4000;
    this.baseCooldownMs = options.baseCooldownMs ?? 5000;
    this.maxCooldownMs = options.maxCooldownMs ?? 120_000;
    this.now = options.now ?? (() => Date.now());
  }

  get limit(): number {
    return this.current;
  }

  get max(): number {
    return this.maxLimit;
  }

  /** Đổi mức tối đa (Cài đặt, hoặc khi chuyển sang 4G/5G). */
  setMax(max: number) {
    this.maxLimit = clamp(max, this.min, HARD_MAX);
    this.current = Math.min(this.current, this.maxLimit);
  }

  /** Cố định số lượt (người dùng chọn số cụ thể thay vì Tự động). */
  setFixed(value: number) {
    this.maxLimit = clamp(value, this.min, HARD_MAX);
    this.current = this.maxLimit;
  }

  /** Còn bao lâu nữa mới được bắt đầu lượt mới (0 = được ngay). */
  cooldownRemaining(): number {
    return Math.max(0, this.cooldownUntil - this.now());
  }

  /** Đợi hết thời gian nghỉ (kiểm tra lại theo đồng hồ của bộ điều chỉnh mỗi `pollMs`). */
  async waitCooldown(pollMs = 250): Promise<void> {
    for (let remaining = this.cooldownRemaining(); remaining > 0; remaining = this.cooldownRemaining()) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(remaining, pollMs)));
    }
  }

  canStart(active: number): boolean {
    return active < this.current && this.cooldownRemaining() === 0;
  }

  /** Ghi nhận số byte vừa nhận được (từ sự kiện tiến độ). */
  recordBytes(bytes: number) {
    if (bytes <= 0) return;
    const t = this.now();
    this.samples.push({ t, bytes });
    this.trim(t);
  }

  /** Tốc độ tổng hiện tại (byte/giây) trong cửa sổ đo. */
  throughput(): number {
    const t = this.now();
    this.trim(t);
    const total = this.samples.reduce((sum, s) => sum + s.bytes, 0);
    return (total * 1000) / this.windowMs;
  }

  /**
   * Một bài tải xong. `saturated` = lúc đó đang chạy đủ số lượt cho phép
   * (chỉ khi đã dùng hết lượt mà vẫn nhanh mới đáng thử thêm lượt).
   */
  onSuccess(saturated: boolean) {
    this.consecutiveBlocks = 0;
    const speed = this.throughput();
    if (this.baseline > 0 && speed < this.baseline * 0.75 && this.current > this.min) {
      // Thêm lượt mà tổng tốc độ lại tụt: đã quá đỉnh băng thông → lùi một lượt.
      this.current -= 1;
      this.baseline = speed;
      return;
    }
    if (saturated && this.current < this.maxLimit && (this.baseline === 0 || speed >= this.baseline * 0.95)) {
      this.current += 1;
      this.baseline = speed;
    }
  }

  onFailure(kind: FailureKind) {
    if (kind === 'blocked') {
      // YouTube chặn tạm thời: giảm một nửa và nghỉ, lâu dần nếu bị chặn liên tiếp.
      this.consecutiveBlocks += 1;
      this.current = Math.max(this.min, Math.floor(this.current / 2));
      const cooldown = Math.min(this.maxCooldownMs, this.baseCooldownMs * 2 ** (this.consecutiveBlocks - 1));
      this.cooldownUntil = this.now() + cooldown;
      this.baseline = 0;
    } else if (kind === 'network') {
      this.current = Math.max(this.min, this.current - 1);
    }
  }

  private trim(t: number) {
    const from = t - this.windowMs;
    while (this.samples.length && this.samples[0].t < from) this.samples.shift();
  }
}

/** Phân loại lỗi tải: bị YouTube chặn (403/429), lỗi mạng, hay lỗi khác. */
export function classifyFailure(err: unknown): FailureKind {
  const status = Number((err as { data?: { httpStatus?: unknown } })?.data?.httpStatus);
  const message = String((err as { message?: unknown })?.message ?? err ?? '');
  const reason = (err as { reason?: unknown })?.reason;
  if (status === 403 || status === 429 || reason === 'blocked' || /\b(403|429)\b/.test(message)) return 'blocked';
  if (reason === 'network' || /network|timed? ?out|offline|connection|internet|kết nối|mạng/i.test(message)) return 'network';
  return 'other';
}

/** Giới hạn số việc chạy song song (ví dụ số lần hỏi link YouTube cùng lúc). */
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.round(value), min), max);
}
