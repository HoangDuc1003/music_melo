// Bản web của plugin: để thử giao diện trên PC, và là trình phát của Melo bản web (PWA).
// Cố ý mô phỏng đúng hành vi của bản Swift (hàng chờ, needsUrl, lặp lại, hẹn giờ).
// Phát bằng thẻ <audio>, riêng link "youtube:<id>" phát bằng trình phát YouTube nhúng (engines.ts, youtube-engine.ts).
// Màn hình khoá / Trung tâm điều khiển của iPhone dùng Media Session (tên bài, ảnh bìa, nút phát/chuyển bài).
import { WebPlugin } from '@capacitor/core';
import type { MeloPlayerPlugin, PlayerItem, PlayerState, RepeatMode, SetQueueOptions } from './definitions';
import { AudioEngine, type Engine, type EngineEvents } from './engines';
import { YOUTUBE_SCHEME, YouTubeEngine } from './youtube-engine';

const secureKey = (key: string) => `melo.secure.${key}`;

export class MeloPlayerWeb extends WebPlugin implements MeloPlayerPlugin {
  private readonly audio: AudioEngine;
  private youtube?: YouTubeEngine;
  /** máy phát của bài hiện tại */
  private engine: Engine;
  private items: PlayerItem[] = [];
  private index = -1;
  private repeat: RepeatMode = 'off';
  private waitingForUrl = false;
  private resumeAt = 0;
  private playWhenReady = true;
  private readonly retried = new Set<string>();
  private sleepTimer?: ReturnType<typeof setTimeout>;
  private sleepTimerEndsAt?: number;
  private sleepAtEndOfItem = false;
  private lastStateEmit = 0;

  constructor() {
    super();
    const audio: AudioEngine = new AudioEngine(this.listen(() => audio));
    this.audio = audio;
    this.engine = audio;
    this.setupMediaSession();
  }

  /** Sự kiện của một máy phát; bỏ qua sự kiện của máy phát không còn dùng (ví dụ <audio> sau khi chuyển sang YouTube). */
  private listen(engine: () => Engine): EngineEvents {
    const active = () => engine() === this.engine;
    return {
      change: () => active() && this.emitState(),
      tick: () => active() && Date.now() - this.lastStateEmit > 900 && this.emitState(),
      ended: () => active() && this.handleEnded(),
      error: (message, retryable) => active() && this.handleError(message, retryable)
    };
  }

  private engineFor(src: string): Engine {
    if (!src.startsWith(YOUTUBE_SCHEME)) return this.audio;
    if (!this.youtube) {
      const youtube: YouTubeEngine = new YouTubeEngine(this.listen(() => youtube));
      this.youtube = youtube;
    }
    return this.youtube;
  }

  private setupMediaSession() {
    const session = typeof navigator === 'undefined' ? undefined : navigator.mediaSession;
    if (!session) return;
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', () => void this.play()],
      ['pause', () => void this.pause()],
      ['previoustrack', () => void this.previous()],
      ['nexttrack', () => void this.next()],
      ['seekto', (details) => details.seekTime !== undefined && void this.seekTo({ position: details.seekTime })]
    ];
    for (const [action, handler] of handlers) {
      try {
        session.setActionHandler(action, handler);
      } catch {
        // trình duyệt không hỗ trợ nút này
      }
    }
  }

  private updateMediaSession(state: PlayerState) {
    const session = typeof navigator === 'undefined' ? undefined : navigator.mediaSession;
    if (!session) return;
    session.playbackState = state.playing ? 'playing' : this.current ? 'paused' : 'none';
    if (state.duration > 0 && Number.isFinite(state.duration)) {
      try {
        session.setPositionState({ duration: state.duration, position: Math.min(state.position, state.duration), playbackRate: 1 });
      } catch {
        // vị trí không hợp lệ trong lúc chuyển bài
      }
    }
  }

  private showNowPlaying(item: PlayerItem) {
    if (typeof navigator === 'undefined' || !navigator.mediaSession || typeof MediaMetadata === 'undefined') return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: item.title,
      artist: item.artist ?? '',
      album: item.album ?? '',
      artwork: item.artwork ? [{ src: item.artwork, sizes: '512x512' }] : []
    });
  }

  private get current(): PlayerItem | undefined {
    return this.items[this.index];
  }

  private buildState(): PlayerState {
    const known = this.engine.duration;
    const duration = Number.isFinite(known) && known > 0 ? known : (this.current?.duration ?? 0);
    return {
      index: this.index,
      id: this.current?.id,
      playing: !this.engine.paused && !this.waitingForUrl,
      buffering: this.waitingForUrl || this.engine.buffering,
      position: this.waitingForUrl ? this.resumeAt : this.engine.currentTime,
      duration,
      repeat: this.repeat,
      queueLength: this.items.length,
      sleepTimerEndsAt: this.sleepTimerEndsAt,
      sleepAtEndOfItem: this.sleepAtEndOfItem
    };
  }

  private emitState() {
    this.lastStateEmit = Date.now();
    const state = this.buildState();
    this.notifyListeners('state', state);
    this.updateMediaSession(state);
  }

  private load(index: number, position = 0, play = true) {
    this.index = index;
    const item = this.current;
    if (!item) {
      this.engine.pause();
      this.emitState();
      return;
    }
    this.notifyListeners('itemChanged', { index, id: item.id });
    this.showNowPlaying(item);
    const src = item.fileUrl || item.url;
    if (!src) {
      this.waitingForUrl = true;
      this.resumeAt = position;
      this.playWhenReady = play;
      this.engine.stop();
      this.notifyListeners('needsUrl', { index, id: item.id, reason: 'missing' });
      this.emitState();
      return;
    }
    this.waitingForUrl = false;
    const engine = this.engineFor(src);
    if (engine !== this.engine) {
      this.engine.stop();
      this.engine = engine;
    }
    engine.load(src, position, play);
    this.emitState();
  }

  private advance(manual: boolean) {
    if (this.index + 1 < this.items.length) return this.load(this.index + 1);
    if (this.repeat === 'all' && this.items.length) return this.load(0);
    if (!manual) this.notifyListeners('queueEnded', {});
    this.engine.pause();
    this.emitState();
  }

  private handleEnded() {
    if (this.sleepAtEndOfItem) {
      this.sleepAtEndOfItem = false;
      this.emitState();
      return;
    }
    if (this.repeat === 'one') {
      this.engine.seek(0);
      void this.engine.play();
      return;
    }
    this.advance(false);
  }

  /** `retryable`: lỗi của link (có thể đã hết hạn) → xin link mới một lần; lỗi khác (video YouTube bị chặn…) thì bỏ qua bài. */
  private handleError(message: string, retryable: boolean) {
    const item = this.current;
    if (!item || this.waitingForUrl) return;
    if (retryable && !this.retried.has(item.id)) {
      this.retried.add(item.id);
      this.waitingForUrl = true;
      this.resumeAt = this.engine.currentTime;
      this.playWhenReady = true;
      this.notifyListeners('needsUrl', { index: this.index, id: item.id, reason: 'failed' });
      this.emitState();
      return;
    }
    this.notifyListeners('error', { index: this.index, id: item.id, message });
    this.advance(false);
  }

  async setQueue(options: SetQueueOptions): Promise<void> {
    const { items, startIndex, startPosition = 0, playWhenReady = true, keepCurrent = false } = options;
    const sameCurrent = keepCurrent && this.current && items[startIndex]?.id === this.current.id;
    this.items = items.map((i) => ({ ...i }));
    this.retried.clear();
    if (sameCurrent) {
      this.index = startIndex;
      this.emitState();
      return;
    }
    this.load(startIndex, startPosition, playWhenReady);
  }

  async addItems(options: { items: PlayerItem[]; index?: number }): Promise<void> {
    const at = options.index === undefined ? this.items.length : Math.max(0, Math.min(options.index, this.items.length));
    this.items.splice(at, 0, ...options.items.map((i) => ({ ...i })));
    if (this.index !== -1 && at <= this.index) this.index += options.items.length;
    this.emitState();
  }

  async removeItem(options: { index: number }): Promise<void> {
    const { index } = options;
    if (index < 0 || index >= this.items.length) return;
    this.items.splice(index, 1);
    if (index < this.index) this.index -= 1;
    else if (index === this.index) {
      const wasPlaying = !this.engine.paused;
      if (this.index < this.items.length) this.load(this.index, 0, wasPlaying);
      else if (this.items.length) this.load(this.items.length - 1, 0, false);
      else {
        this.engine.stop();
        this.index = -1;
      }
    }
    this.emitState();
  }

  async moveItem(options: { from: number; to: number }): Promise<void> {
    const { from, to } = options;
    if (from === to || from < 0 || to < 0 || from >= this.items.length || to >= this.items.length) return;
    const [moved] = this.items.splice(from, 1);
    this.items.splice(to, 0, moved);
    if (this.index === from) this.index = to;
    else if (from < this.index && to >= this.index) this.index -= 1;
    else if (from > this.index && to <= this.index) this.index += 1;
    this.emitState();
  }

  async updateItem(options: { id: string; url?: string; fileUrl?: string; headers?: Record<string, string> }): Promise<void> {
    // Video YouTube đang phát vừa có file tải về (bản web): chuyển sang phát file ngay, giữ vị trí.
    const toFile = Boolean(options.fileUrl) && this.current?.id === options.id && this.engine === this.youtube && !this.waitingForUrl;
    for (const item of this.items) {
      if (item.id !== options.id) continue;
      if (options.url !== undefined) item.url = options.url;
      if (options.fileUrl !== undefined) item.fileUrl = options.fileUrl;
      if (options.headers !== undefined) item.headers = options.headers;
    }
    if (this.waitingForUrl && this.current?.id === options.id && (this.current.fileUrl || this.current.url)) {
      this.load(this.index, this.resumeAt, this.playWhenReady);
    }
    if (toFile) this.load(this.index, this.engine.currentTime, !this.engine.paused || this.engine.buffering);
  }

  async play(): Promise<void> {
    if (this.waitingForUrl) {
      this.playWhenReady = true;
      return;
    }
    if (this.index === -1 && this.items.length) return this.load(0);
    await this.engine.play();
    this.emitState();
  }

  async pause(): Promise<void> {
    this.playWhenReady = false;
    this.engine.pause();
    this.emitState();
  }

  async seekTo(options: { position: number }): Promise<void> {
    if (this.waitingForUrl) this.resumeAt = options.position;
    else this.engine.seek(options.position);
    this.emitState();
  }

  async skipTo(options: { index: number }): Promise<void> {
    if (options.index >= 0 && options.index < this.items.length) this.load(options.index);
  }

  async next(): Promise<void> {
    this.advance(true);
  }

  async previous(): Promise<void> {
    if (this.engine.currentTime > 3 || this.index <= 0) {
      this.engine.seek(0);
      this.emitState();
      return;
    }
    this.load(this.index - 1);
  }

  async setRepeat(options: { mode: RepeatMode }): Promise<void> {
    this.repeat = options.mode;
    this.emitState();
  }

  async setSleepTimer(options: { minutes: number; endOfItem?: boolean }): Promise<void> {
    clearTimeout(this.sleepTimer);
    this.sleepTimer = undefined;
    this.sleepTimerEndsAt = undefined;
    this.sleepAtEndOfItem = Boolean(options.endOfItem);
    if (options.minutes > 0) {
      this.sleepTimerEndsAt = Date.now() + options.minutes * 60_000;
      this.sleepTimer = setTimeout(() => {
        this.sleepTimerEndsAt = undefined;
        void this.pause();
      }, options.minutes * 60_000);
    }
    this.emitState();
  }

  async getState(): Promise<PlayerState> {
    return this.buildState();
  }

  // Trình duyệt không có Keychain: dùng localStorage, chỉ để chạy thử trên PC.
  async keychainGet({ key }: { key: string }): Promise<{ value: string | null }> {
    return { value: localStorage.getItem(secureKey(key)) };
  }

  async keychainSet({ key, value }: { key: string; value: string }): Promise<void> {
    localStorage.setItem(secureKey(key), value);
  }

  async keychainRemove({ key }: { key: string }): Promise<void> {
    localStorage.removeItem(secureKey(key));
  }
}
