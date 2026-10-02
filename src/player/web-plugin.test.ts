// Plugin phát nhạc bản web (plugins/player/src/web.ts): chuyển giữa thẻ <audio> và trình phát YouTube nhúng.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VIDEO_SLOT_ID, type PlayerItem, type PlayerState } from 'capacitor-melo-player';
import { MeloPlayerWeb } from '../../plugins/player/src/web';

/** Trình phát YouTube giả: ghi lại lệnh, cho test tự đổi trạng thái. */
class FakeYTPlayer {
  static last?: FakeYTPlayer;
  calls: string[] = [];
  time = 0;
  constructor(
    readonly frame: HTMLIFrameElement,
    readonly options: { events: { onReady(): void; onStateChange(e: { data: number }): void; onError(e: { data: number }): void } }
  ) {
    FakeYTPlayer.last = this;
  }
  playVideo = () => this.calls.push('play');
  pauseVideo = () => this.calls.push('pause');
  stopVideo = () => this.calls.push('stop');
  seekTo = (t: number) => this.calls.push(`seek ${t}`);
  loadVideoById = (o: { videoId: string; startSeconds?: number }) => this.calls.push(`load ${o.videoId}${o.startSeconds ? ` @${o.startSeconds}` : ''}`);
  cueVideoById = (o: { videoId: string }) => this.calls.push(`cue ${o.videoId}`);
  getCurrentTime = () => this.time;
  getDuration = () => 245;
  ready = () => this.options.events.onReady();
  state = (data: number) => this.options.events.onStateChange({ data });
  error = (data: number) => this.options.events.onError({ data });
}

const item = (id: string, url: string): PlayerItem => ({ id, url, title: id, artist: 'A' });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

let plugin: MeloPlayerWeb;
let states: PlayerState[];
let events: string[];

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  window.YT = { Player: FakeYTPlayer as never };
  document.body.innerHTML = `<div id="${VIDEO_SLOT_ID}"></div>`;
  FakeYTPlayer.last = undefined;
  plugin = new MeloPlayerWeb();
  states = [];
  events = [];
  void plugin.addListener('state', (s) => states.push(s));
  void plugin.addListener('itemChanged', (e) => events.push(`item ${e.id}`));
  void plugin.addListener('error', (e) => events.push(`error ${e.id}: ${e.message}`));
  void plugin.addListener('needsUrl', (e) => events.push(`needsUrl ${e.id}`));
});
afterEach(() => {
  vi.restoreAllMocks();
  delete window.YT;
});

describe('plugin phát nhạc bản web', () => {
  it('bài YouTube: tạo trình phát nhúng trong khung của ứng dụng (gửi địa chỉ trang), nạp bài khi sẵn sàng', async () => {
    await plugin.setQueue({ items: [item('yt-a', 'youtube:aaaaaaaaaaa'), item('au-1', 'https://api.audius.co/v1/tracks/1/stream')], startIndex: 0 });
    await flush();
    const player = FakeYTPlayer.last!;
    const frame = document.getElementById(VIDEO_SLOT_ID)!.querySelector('iframe')!;
    expect(frame.src).toMatch(/^https:\/\/www\.youtube\.com\/embed\/aaaaaaaaaaa\?enablejsapi=1&playsinline=1/);
    expect(frame.referrerPolicy).toBe('strict-origin-when-cross-origin');
    // Chưa sẵn sàng: đang chờ, chưa phát.
    expect(states.at(-1)).toMatchObject({ id: 'yt-a', playing: false, buffering: true });
    player.ready();
    expect(player.calls).toEqual(['load aaaaaaaaaaa']);
    player.state(1);
    expect(states.at(-1)).toMatchObject({ playing: true, buffering: false, duration: 245 });
  });

  it('hết video thì sang bài Audius bằng thẻ <audio>, trình phát YouTube dừng hẳn', async () => {
    await plugin.setQueue({ items: [item('yt-a', 'youtube:aaaaaaaaaaa'), item('au-1', 'https://api.audius.co/v1/tracks/1/stream')], startIndex: 0 });
    await flush();
    const player = FakeYTPlayer.last!;
    player.ready();
    player.state(1);
    player.state(0);
    expect(events).toEqual(['item yt-a', 'item au-1']);
    expect(player.calls).toEqual(['load aaaaaaaaaaa', 'stop']);
    // Sự kiện muộn của trình phát cũ không ảnh hưởng bài hiện tại.
    player.state(1);
    expect(states.at(-1)).toMatchObject({ id: 'au-1' });
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it('video chặn phát ngoài YouTube: báo lỗi và sang bài sau, không xin link mới', async () => {
    await plugin.setQueue({ items: [item('yt-a', 'youtube:aaaaaaaaaaa'), item('yt-b', 'youtube:bbbbbbbbbbb')], startIndex: 0 });
    await flush();
    const player = FakeYTPlayer.last!;
    player.ready();
    player.error(150);
    expect(events).toEqual(['item yt-a', 'error yt-a: Chủ video không cho phát ngoài YouTube', 'item yt-b']);
    expect(player.calls.at(-1)).toBe('load bbbbbbbbbbb');
  });

  it('đổi bài, tua, dừng trong lúc trình phát chưa sẵn sàng: nạp theo yêu cầu cuối cùng', async () => {
    await plugin.setQueue({ items: [item('yt-a', 'youtube:aaaaaaaaaaa'), item('yt-b', 'youtube:bbbbbbbbbbb')], startIndex: 0 });
    await plugin.skipTo({ index: 1 });
    await plugin.seekTo({ position: 30 });
    await plugin.pause();
    await flush();
    FakeYTPlayer.last!.ready();
    expect(FakeYTPlayer.last!.calls).toEqual(['cue bbbbbbbbbbb']);
    await plugin.play();
    expect(FakeYTPlayer.last!.calls.at(-1)).toBe('play');
    // Lặp một bài: hết video thì tua về đầu và phát lại.
    await plugin.setRepeat({ mode: 'one' });
    FakeYTPlayer.last!.state(0);
    expect(FakeYTPlayer.last!.calls.slice(-2)).toEqual(['seek 0', 'play']);
  });

  it('video đang phát vừa có file tải về: chuyển sang phát file (thẻ <audio>) ở đúng vị trí', async () => {
    await plugin.setQueue({ items: [item('yt-a', 'youtube:aaaaaaaaaaa')], startIndex: 0 });
    await flush();
    const player = FakeYTPlayer.last!;
    player.ready();
    player.state(1);
    player.time = 42;
    await plugin.updateItem({ id: 'yt-a', fileUrl: 'blob:melo/1' });
    expect(player.calls.at(-1)).toBe('stop');
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    expect(states.at(-1)).toMatchObject({ id: 'yt-a' });
    // Bài khác có file thì không đổi bài đang phát.
    const before = player.calls.length;
    await plugin.updateItem({ id: 'yt-khac', fileUrl: 'blob:melo/2' });
    expect(player.calls.length).toBe(before);
  });
});
