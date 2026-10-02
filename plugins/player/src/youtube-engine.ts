// Phát video YouTube trong bản web bằng YouTube IFrame Player API, cách YouTube cho phép trên trang web.
// Theo điều khoản của YouTube: video phải hiện trên màn hình (không ẩn, không che, tối thiểu 200×200), không tách lấy
// tiếng, không tải về. iOS dừng video khi khoá màn hình hoặc chuyển app.
// Ứng dụng vẽ sẵn chỗ đặt trình phát (#melo-video-slot, xem src/components/VideoStage.tsx); trình phát được tạo một lần
// rồi dùng lại cho mọi video (iOS chỉ cho tự phát tiếp khi vẫn là trình phát người dùng đã chạm vào).
import { VIDEO_SLOT_ID } from './definitions';
import type { Engine, EngineEvents } from './engines';

export const YOUTUBE_SCHEME = 'youtube:';

interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  loadVideoById(options: { videoId: string; startSeconds?: number }): void;
  cueVideoById(options: { videoId: string; startSeconds?: number }): void;
  getCurrentTime(): number;
  getDuration(): number;
}

interface YTNamespace {
  Player: new (
    element: HTMLElement,
    options: { events: { onReady(): void; onStateChange(event: { data: number }): void; onError(event: { data: number }): void } }
  ) => YTPlayer;
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };

const ERRORS: Record<number, string> = {
  2: 'Link video YouTube không hợp lệ',
  5: 'Trình phát YouTube không phát được video này',
  100: 'Video không còn trên YouTube hoặc để riêng tư',
  101: 'Chủ video không cho phát ngoài YouTube',
  150: 'Chủ video không cho phát ngoài YouTube',
  152: 'YouTube từ chối trình phát nhúng (thiếu địa chỉ trang web)',
  153: 'YouTube từ chối trình phát nhúng (thiếu địa chỉ trang web)'
};

let api: Promise<YTNamespace> | undefined;

/** Nạp https://www.youtube.com/iframe_api một lần (CSP của bản web cho phép script từ www.youtube.com). */
function loadApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  api ??= new Promise<YTNamespace>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT) resolve(window.YT);
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => {
      api = undefined;
      script.remove();
      reject(new Error('Không tải được trình phát YouTube (kiểm tra mạng)'));
    };
    document.head.appendChild(script);
  });
  return api;
}

/** Chỗ đặt trình phát do ứng dụng vẽ (có thể chưa có ngay lúc mở app). */
function waitForSlot(timeoutMs = 15_000): Promise<HTMLElement> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const slot = document.getElementById(VIDEO_SLOT_ID);
      if (slot) return resolve(slot);
      if (Date.now() - started > timeoutMs) return reject(new Error('Không có chỗ hiện video YouTube'));
      setTimeout(check, 100);
    };
    check();
  });
}

interface Request {
  videoId: string;
  position: number;
  play: boolean;
}

export class YouTubeEngine implements Engine {
  private player?: YTPlayer;
  private ready = false;
  private creating?: Promise<void>;
  private state = STATE.UNSTARTED;
  private wantPlay = false;
  /** bài cần nạp khi trình phát sẵn sàng */
  private pending?: Request;
  private timer?: ReturnType<typeof setInterval>;

  constructor(private readonly events: EngineEvents) {}

  get paused() {
    return this.state !== STATE.PLAYING && this.state !== STATE.BUFFERING;
  }

  /** Đã bấm phát nhưng video chưa chạy: đang tải, hoặc iOS đợi người dùng chạm vào video lần đầu. */
  get buffering() {
    return this.state === STATE.BUFFERING || (this.wantPlay && this.paused && this.state !== STATE.ENDED);
  }

  get currentTime() {
    return this.ready ? this.player!.getCurrentTime() || 0 : (this.pending?.position ?? 0);
  }

  get duration() {
    const duration = this.ready ? this.player!.getDuration() : 0;
    return duration > 0 ? duration : NaN;
  }

  load(src: string, position: number, play: boolean) {
    const request = { videoId: src.slice(YOUTUBE_SCHEME.length), position, play };
    this.wantPlay = play;
    this.state = STATE.UNSTARTED;
    this.stopTimer();
    if (!this.ready) {
      this.pending = request;
      void this.create();
    } else {
      this.open(request);
    }
    this.events.change();
  }

  private open({ videoId, position, play }: Request) {
    const options = { videoId, startSeconds: position > 0 ? position : undefined };
    if (play) this.player!.loadVideoById(options);
    else this.player!.cueVideoById(options);
  }

  private create(): Promise<void> {
    this.creating ??= (async () => {
      try {
        const [YT, slot] = await Promise.all([loadApi(), waitForSlot()]);
        const first = this.pending;
        if (!first) return void (this.creating = undefined);
        const params = new URLSearchParams({ enablejsapi: '1', playsinline: '1', rel: '0', origin: location.origin });
        const frame = document.createElement('iframe');
        frame.src = `https://www.youtube.com/embed/${encodeURIComponent(first.videoId)}?${params}`;
        frame.title = 'Trình phát YouTube';
        frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
        frame.allowFullscreen = true;
        // Trang gửi "Referrer-Policy: no-referrer", nhưng trình phát nhúng của YouTube cần biết trang nào đang nhúng.
        frame.referrerPolicy = 'strict-origin-when-cross-origin';
        frame.style.cssText = 'display:block;width:100%;height:100%;border:0';
        slot.replaceChildren(frame);
        this.player = new YT.Player(frame, {
          events: {
            onReady: () => this.onReady(),
            onStateChange: (event) => this.onState(event.data),
            onError: (event) => this.events.error(ERRORS[event.data] ?? `Trình phát YouTube báo lỗi ${event.data}`, false)
          }
        });
      } catch (err) {
        this.creating = undefined;
        this.events.error(err instanceof Error ? err.message : 'Không mở được trình phát YouTube', false);
      }
    })();
    return this.creating;
  }

  private onReady() {
    this.ready = true;
    const request = this.pending;
    this.pending = undefined;
    // Nạp theo yêu cầu mới nhất (trong lúc chờ người dùng có thể đã đổi bài, tua, bấm dừng hoặc chuyển sang bài khác).
    if (request) this.open(request);
    else this.player!.stopVideo();
    this.events.change();
  }

  private onState(state: number) {
    this.state = state;
    if (state === STATE.PLAYING) this.startTimer();
    else this.stopTimer();
    this.events.change();
    if (state === STATE.ENDED) this.events.ended();
  }

  private startTimer() {
    this.timer ??= setInterval(() => this.events.tick(), 500);
  }

  private stopTimer() {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async play() {
    this.wantPlay = true;
    if (this.ready) this.player!.playVideo();
    else if (this.pending) this.pending.play = true;
    this.events.change();
  }

  pause() {
    this.wantPlay = false;
    if (this.ready) this.player!.pauseVideo();
    else if (this.pending) this.pending.play = false;
  }

  seek(position: number) {
    if (this.ready) this.player!.seekTo(position, true);
    else if (this.pending) this.pending.position = position;
  }

  stop() {
    this.wantPlay = false;
    this.state = STATE.UNSTARTED;
    this.stopTimer();
    if (this.ready) this.player!.stopVideo();
    else this.pending = undefined;
  }
}
