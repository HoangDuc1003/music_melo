// Bản web của plugin (dùng thẻ <audio>) để làm và thử giao diện trên PC.
// Cố ý mô phỏng đúng hành vi của bản Swift (hàng chờ, needsUrl, lặp lại, hẹn giờ).
import { WebPlugin } from '@capacitor/core';
import type { MeloPlayerPlugin, PlayerItem, PlayerState, RepeatMode, SetQueueOptions } from './definitions';

const secureKey = (key: string) => `melo.secure.${key}`;

export class MeloPlayerWeb extends WebPlugin implements MeloPlayerPlugin {
  private readonly audio: HTMLAudioElement;
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
    this.audio = new Audio();
    this.audio.preload = 'auto';
    const emit = () => this.emitState();
    this.audio.addEventListener('playing', emit);
    this.audio.addEventListener('pause', emit);
    this.audio.addEventListener('waiting', emit);
    this.audio.addEventListener('durationchange', emit);
    this.audio.addEventListener('seeked', emit);
    this.audio.addEventListener('timeupdate', () => {
      if (Date.now() - this.lastStateEmit > 900) this.emitState();
    });
    this.audio.addEventListener('ended', () => this.handleEnded());
    this.audio.addEventListener('error', () => this.handleError());
  }

  private get current(): PlayerItem | undefined {
    return this.items[this.index];
  }

  private buildState(): PlayerState {
    const duration = Number.isFinite(this.audio.duration) ? this.audio.duration : (this.current?.duration ?? 0);
    return {
      index: this.index,
      id: this.current?.id,
      playing: !this.audio.paused && !this.waitingForUrl,
      buffering: this.waitingForUrl || this.audio.readyState < 3,
      position: this.waitingForUrl ? this.resumeAt : this.audio.currentTime || 0,
      duration,
      repeat: this.repeat,
      queueLength: this.items.length,
      sleepTimerEndsAt: this.sleepTimerEndsAt,
      sleepAtEndOfItem: this.sleepAtEndOfItem
    };
  }

  private emitState() {
    this.lastStateEmit = Date.now();
    this.notifyListeners('state', this.buildState());
  }

  private load(index: number, position = 0, play = true) {
    this.index = index;
    const item = this.current;
    if (!item) {
      this.audio.pause();
      this.emitState();
      return;
    }
    this.notifyListeners('itemChanged', { index, id: item.id });
    const src = item.fileUrl || item.url;
    if (!src) {
      this.waitingForUrl = true;
      this.resumeAt = position;
      this.playWhenReady = play;
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.notifyListeners('needsUrl', { index, id: item.id, reason: 'missing' });
      this.emitState();
      return;
    }
    this.waitingForUrl = false;
    this.audio.src = src;
    if (position > 0) {
      this.audio.addEventListener('loadedmetadata', () => (this.audio.currentTime = position), { once: true });
    }
    if (play) void this.audio.play().catch(() => this.emitState());
    this.emitState();
  }

  private advance(manual: boolean) {
    if (this.index + 1 < this.items.length) return this.load(this.index + 1);
    if (this.repeat === 'all' && this.items.length) return this.load(0);
    if (!manual) this.notifyListeners('queueEnded', {});
    this.audio.pause();
    this.emitState();
  }

  private handleEnded() {
    if (this.sleepAtEndOfItem) {
      this.sleepAtEndOfItem = false;
      this.emitState();
      return;
    }
    if (this.repeat === 'one') {
      this.audio.currentTime = 0;
      void this.audio.play();
      return;
    }
    this.advance(false);
  }

  private handleError() {
    const item = this.current;
    if (!item || this.waitingForUrl) return;
    if (!this.retried.has(item.id)) {
      this.retried.add(item.id);
      this.waitingForUrl = true;
      this.resumeAt = this.audio.currentTime || 0;
      this.playWhenReady = true;
      this.notifyListeners('needsUrl', { index: this.index, id: item.id, reason: 'failed' });
      this.emitState();
      return;
    }
    this.notifyListeners('error', { index: this.index, id: item.id, message: this.audio.error?.message || 'Không phát được bài này' });
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
      const wasPlaying = !this.audio.paused;
      if (this.index < this.items.length) this.load(this.index, 0, wasPlaying);
      else if (this.items.length) this.load(this.items.length - 1, 0, false);
      else {
        this.audio.pause();
        this.audio.removeAttribute('src');
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
    for (const item of this.items) {
      if (item.id !== options.id) continue;
      if (options.url !== undefined) item.url = options.url;
      if (options.fileUrl !== undefined) item.fileUrl = options.fileUrl;
      if (options.headers !== undefined) item.headers = options.headers;
    }
    if (this.waitingForUrl && this.current?.id === options.id && (this.current.fileUrl || this.current.url)) {
      this.load(this.index, this.resumeAt, this.playWhenReady);
    }
  }

  async play(): Promise<void> {
    if (this.waitingForUrl) {
      this.playWhenReady = true;
      return;
    }
    if (this.index === -1 && this.items.length) return this.load(0);
    await this.audio.play().catch(() => undefined);
    this.emitState();
  }

  async pause(): Promise<void> {
    this.playWhenReady = false;
    this.audio.pause();
    this.emitState();
  }

  async seekTo(options: { position: number }): Promise<void> {
    if (this.waitingForUrl) this.resumeAt = options.position;
    else this.audio.currentTime = options.position;
    this.emitState();
  }

  async skipTo(options: { index: number }): Promise<void> {
    if (options.index >= 0 && options.index < this.items.length) this.load(options.index);
  }

  async next(): Promise<void> {
    this.advance(true);
  }

  async previous(): Promise<void> {
    if (this.audio.currentTime > 3 || this.index <= 0) {
      this.audio.currentTime = 0;
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
