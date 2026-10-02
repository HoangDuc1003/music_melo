// "Máy phát" của bản web: thẻ <audio> cho file nhạc/link MP3, trình phát YouTube nhúng cho link "youtube:<id>".
// Plugin web (web.ts) giữ hàng chờ và chọn máy phát theo link của từng bài.

/** Báo cho plugin khi máy phát đổi trạng thái. */
export interface EngineEvents {
  /** đổi trạng thái phát/dừng/đang tải/thời lượng */
  change(): void;
  /** vị trí phát tiến lên (gọi thường xuyên) */
  tick(): void;
  ended(): void;
  /** `retryable`: có thể do link hết hạn → plugin xin link mới một lần trước khi bỏ qua bài. */
  error(message: string, retryable: boolean): void;
}

export interface Engine {
  readonly paused: boolean;
  readonly buffering: boolean;
  /** giây */
  readonly currentTime: number;
  /** giây, NaN nếu chưa biết */
  readonly duration: number;
  load(src: string, position: number, play: boolean): void;
  play(): Promise<void>;
  pause(): void;
  seek(position: number): void;
  /** Dừng hẳn và bỏ bài (khi chuyển sang máy phát khác hoặc hàng chờ trống). */
  stop(): void;
}

export class AudioEngine implements Engine {
  private readonly audio: HTMLAudioElement;

  constructor(private readonly events: EngineEvents) {
    this.audio = new Audio();
    this.audio.preload = 'auto';
    for (const name of ['playing', 'pause', 'waiting', 'durationchange', 'seeked']) this.audio.addEventListener(name, () => events.change());
    this.audio.addEventListener('timeupdate', () => events.tick());
    this.audio.addEventListener('ended', () => events.ended());
    this.audio.addEventListener('error', () => {
      // Lỗi khi đã bỏ link (stop) thì không tính.
      if (this.audio.getAttribute('src')) events.error(this.audio.error?.message || 'Không phát được bài này', true);
    });
  }

  get paused() {
    return this.audio.paused;
  }

  get buffering() {
    return this.audio.readyState < 3;
  }

  get currentTime() {
    return this.audio.currentTime || 0;
  }

  get duration() {
    return this.audio.duration;
  }

  load(src: string, position: number, play: boolean) {
    this.audio.src = src;
    if (position > 0) this.audio.addEventListener('loadedmetadata', () => (this.audio.currentTime = position), { once: true });
    // Trình duyệt chặn tự phát: báo lại trạng thái để nút Phát/Tạm dừng đúng.
    if (play) void this.audio.play().catch(() => this.events.change());
  }

  async play() {
    await this.audio.play().catch(() => undefined);
  }

  pause() {
    this.audio.pause();
  }

  seek(position: number) {
    this.audio.currentTime = position;
  }

  stop() {
    this.audio.pause();
    this.audio.removeAttribute('src');
  }
}
