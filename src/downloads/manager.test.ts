import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '@/youtube/types';

const mocks = vi.hoisted(() => ({
  resolveAudio: vi.fn(),
  getLyrics: vi.fn(async () => undefined),
  refreshLocalFile: vi.fn(async () => undefined),
  setFileUrlProvider: vi.fn(),
  setArtworkFileProvider: vi.fn()
}));
vi.mock('@/youtube/stream', () => ({ resolveAudio: mocks.resolveAudio }));
vi.mock('@/lib/lyrics', () => ({ getLyrics: mocks.getLyrics }));
vi.mock('@/player/controller', () => ({
  refreshLocalFile: mocks.refreshLocalFile,
  setFileUrlProvider: mocks.setFileUrlProvider,
  setArtworkFileProvider: mocks.setArtworkFileProvider
}));

import { db } from '@/lib/db';
import { setNetworkStatus } from '@/lib/network';
import {
  __resetDownloadsForTests,
  connectDownloadsToPlayer,
  enqueueDownloads,
  initDownloads,
  activeCountForTests,
  localFileUrl,
  pump,
  removeDownload,
  retryDownload,
  setDownloadSettings,
  useDownloads,
  waitForIdleForTests
} from './manager';
import { AdaptiveLimiter } from './concurrency';
import { setStorageForTests, withRange, type DownloadRequest, type DownloadStorage, type SidecarInfo } from './storage';

const track = (n: number): Track => ({ id: `vid${String(n).padStart(8, '0')}`, title: `Bài ${n}`, artists: [{ name: 'A' }], duration: 200, thumbnail: `https://img/${n}` });

/** Nơi lưu giả: ghi nhận thao tác, có thể bắt tải chậm/lỗi. */
class FakeStorage implements DownloadStorage {
  files = new Map<string, number>();
  sidecars = new Map<string, SidecarInfo>();
  artwork = new Set<string>();
  running = 0;
  maxRunning = 0;
  failTimes = new Map<string, number>();
  gate?: Promise<void>;
  delayMs = 2;
  requests: DownloadRequest[] = [];

  async saveAudio(request: DownloadRequest) {
    this.requests.push(request);
    this.running += 1;
    this.maxRunning = Math.max(this.maxRunning, this.running);
    try {
      request.onProgress({ bytes: 500, total: 1000 });
      await (this.gate ?? new Promise((r) => setTimeout(r, this.delayMs)));
      request.onProgress({ bytes: 1000, total: 1000 });
      const fails = this.failTimes.get(request.id) ?? 0;
      if (fails > 0) {
        this.failTimes.set(request.id, fails - 1);
        throw new Error('HTTP 403');
      }
      this.files.set(request.id, 1000);
      return 1000;
    } finally {
      this.running -= 1;
    }
  }
  async saveArtwork(id: string) {
    this.artwork.add(id);
    return true;
  }
  async saveSidecar(id: string, info: SidecarInfo) {
    this.sidecars.set(id, info);
  }
  async remove(id: string) {
    this.files.delete(id);
    this.sidecars.delete(id);
    this.artwork.delete(id);
  }
  async audioUrl(id: string) {
    return this.files.has(id) ? `file:///music/${id}.m4a` : undefined;
  }
  async artworkUrl(id: string) {
    return this.artwork.has(id) ? `capacitor://localhost/_capacitor_file_/music/${id}.jpg` : undefined;
  }
  async artworkFileUrl(id: string) {
    return this.artwork.has(id) ? `file:///music/${id}.jpg` : undefined;
  }
  async listSidecars(known: ReadonlySet<string>) {
    return [...this.sidecars.values()].filter((s) => !known.has(s.track.id));
  }
}

let storage: FakeStorage;

async function waitUntil(condition: () => boolean, timeoutMs = 3000) {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error('hết thời gian chờ');
    await new Promise((r) => setTimeout(r, 5));
  }
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  // Mặc định trong test: cố định 2 lượt, thời gian nghỉ ngắn để test chạy nhanh.
  __resetDownloadsForTests({ limiter: new AdaptiveLimiter({ initial: 2, max: 2, baseCooldownMs: 20 }) });
  storage = new FakeStorage();
  setStorageForTests(storage);
  setNetworkStatus(true, 'wifi');
  vi.clearAllMocks();
  mocks.resolveAudio.mockImplementation(async (id: string, options: { refresh?: boolean } = {}) => ({
    url: `https://rr.googlevideo.com/videoplayback?id=${id}&refresh=${Boolean(options.refresh)}`,
    contentLength: 1000,
    expiresAt: Date.now() + 3600_000,
    mimeType: 'audio/mp4',
    client: 'TEST'
  }));
});

describe('withRange', () => {
  it('thêm &range khi biết dung lượng, không thì dùng header Range', () => {
    expect(withRange('https://x.googlevideo.com/v?a=1', 1000)).toEqual({ url: 'https://x.googlevideo.com/v?a=1&range=0-999', headers: {} });
    expect(withRange('https://x.googlevideo.com/v?a=1', undefined)).toEqual({ url: 'https://x.googlevideo.com/v?a=1', headers: { Range: 'bytes=0-' } });
  });
});

describe('hàng đợi tải', () => {
  it('không vượt số lượt cho phép, lưu file + ảnh + .json + lời, báo trình phát dùng file', async () => {
    const MAX_CONCURRENT = 2;
    const tracks = [1, 2, 3, 4, 5].map(track);
    // Giữ các lượt tải lại để kiểm tra giới hạn không phụ thuộc tốc độ máy.
    let release!: () => void;
    storage.gate = new Promise((r) => (release = r));
    expect(await enqueueDownloads(tracks)).toBe(5);
    await waitUntil(() => storage.running === MAX_CONCURRENT);
    await new Promise((r) => setTimeout(r, 30)); // nếu có lỗi, bài thứ 3 sẽ bắt đầu trong lúc này
    expect(storage.running).toBe(MAX_CONCURRENT);
    expect(storage.requests).toHaveLength(MAX_CONCURRENT);
    release();
    await waitForIdleForTests();

    expect(storage.maxRunning).toBe(MAX_CONCURRENT);
    const rows = await db.downloads.toArray();
    expect(rows.every((r) => r.status === 'done' && r.bytes === 1000)).toBe(true);
    expect([...storage.sidecars.keys()].sort()).toEqual(tracks.map((t) => t.id));
    expect(storage.sidecars.get(tracks[0].id)?.track.title).toBe('Bài 1');
    expect(storage.artwork.size).toBe(5);
    expect(mocks.getLyrics).toHaveBeenCalledTimes(5);
    expect(mocks.refreshLocalFile).toHaveBeenCalledTimes(5);
    expect(storage.requests[0].url).toContain('range=0-999');
    expect(await localFileUrl(tracks[0].id)).toBe(`file:///music/${tracks[0].id}.m4a`);
    expect(await db.tracks.get(tracks[0].id)).toMatchObject({ title: 'Bài 1' });
  });

  it('không thêm trùng, bỏ qua id không hợp lệ', async () => {
    expect(await enqueueDownloads([track(1), track(1)])).toBe(1);
    await waitForIdleForTests();
    expect(await enqueueDownloads([track(1)])).toBe(0);
    const bad = { ...track(9), id: '../../etc/passwd' };
    expect(await enqueueDownloads([bad])).toBe(0);
    expect(await db.downloads.count()).toBe(1);
  });

  it('lỗi lần đầu thì lấy link mới và thử lại', async () => {
    storage.failTimes.set(track(1).id, 1);
    await enqueueDownloads([track(1)]);
    await waitForIdleForTests();
    expect(mocks.resolveAudio).toHaveBeenLastCalledWith(track(1).id, { refresh: true });
    expect((await db.downloads.get(track(1).id))?.status).toBe('done');
  });

  it('lỗi hai lần thì báo lỗi; bấm thử lại thì tải lại', async () => {
    storage.failTimes.set(track(1).id, 2);
    await enqueueDownloads([track(1)]);
    await waitForIdleForTests();
    expect(await db.downloads.get(track(1).id)).toMatchObject({ status: 'error', error: 'HTTP 403' });
    expect(await localFileUrl(track(1).id)).toBeUndefined();

    await retryDownload(track(1).id);
    await waitForIdleForTests();
    expect((await db.downloads.get(track(1).id))?.status).toBe('done');
    // Bài lỗi cũng được thêm lại khi bấm tải lần nữa.
    storage.failTimes.set(track(2).id, 2);
    await enqueueDownloads([track(2)]);
    await waitForIdleForTests();
    expect(await enqueueDownloads([track(2)])).toBe(1);
  });

  it('gom sự kiện tiến độ: hiện thanh ngay, sau đó tối đa 4 lần/giây', async () => {
    let release!: () => void;
    storage.gate = new Promise((r) => (release = r));
    await enqueueDownloads([track(1)]);
    await waitUntil(() => storage.running === 1);
    const id = track(1).id;
    expect(useDownloads.getState().progress.get(id)).toEqual({ bytes: 500, total: 1000 });

    let updates = 0;
    const unsubscribe = useDownloads.subscribe((s, prev) => {
      if (s.progress !== prev.progress) updates += 1;
    });
    for (let bytes = 501; bytes <= 900; bytes++) storage.requests[0].onProgress({ bytes, total: 1000 });
    expect(updates).toBe(0);
    await waitUntil(() => useDownloads.getState().progress.get(id)?.bytes === 900);
    expect(updates).toBe(1);
    unsubscribe();
    release();
    await waitForIdleForTests();
    expect(useDownloads.getState().progress.has(id)).toBe(false);
  });

  it('xoá trong lúc đang tải thì không giữ file', async () => {
    let release!: () => void;
    storage.gate = new Promise((r) => (release = r));
    await enqueueDownloads([track(1)]);
    await waitUntil(() => storage.running === 1);
    expect(useDownloads.getState().progress.get(track(1).id)).toEqual({ bytes: 500, total: 1000 });
    await removeDownload(track(1).id);
    release();
    await waitUntil(() => activeCountForTests() === 0);
    expect(await db.downloads.get(track(1).id)).toBeUndefined();
    expect(storage.files.has(track(1).id)).toBe(false);
  });

  it('không có mạng thì chờ, có mạng lại thì tải tiếp', async () => {
    await initDownloads();
    setNetworkStatus(false, 'none');
    await enqueueDownloads([track(1)]);
    await new Promise((r) => setTimeout(r, 10));
    expect(storage.requests).toHaveLength(0);
    setNetworkStatus(true, 'wifi');
    await waitForIdleForTests();
    expect((await db.downloads.get(track(1).id))?.status).toBe('done');
  });
});

describe('tải song song tự điều chỉnh', () => {
  it('chạy đúng số lượt cố định người dùng chọn (ví dụ 5)', async () => {
    __resetDownloadsForTests({ limiter: new AdaptiveLimiter({ initial: 3, max: 15, baseCooldownMs: 20 }) });
    let release!: () => void;
    storage.gate = new Promise((r) => (release = r));
    await setDownloadSettings({ concurrency: 5 });
    await enqueueDownloads(Array.from({ length: 12 }, (_, i) => track(i + 1)));
    await waitUntil(() => storage.running === 5);
    await new Promise((r) => setTimeout(r, 30));
    expect(storage.running).toBe(5);
    expect(useDownloads.getState().limit).toBe(5);
    release();
    await waitForIdleForTests();
    expect(storage.maxRunning).toBe(5);
    expect(await db.downloads.where('status').equals('done').count()).toBe(12);
  });

  it('tự động: tăng dần số lượt khi tải trơn tru, không quá 15', async () => {
    __resetDownloadsForTests({ limiter: new AdaptiveLimiter({ initial: 3, max: 15, baseCooldownMs: 20 }) });
    storage.delayMs = 15;
    await enqueueDownloads(Array.from({ length: 40 }, (_, i) => track(i + 1)));
    await waitForIdleForTests();
    expect(storage.maxRunning).toBeGreaterThan(3);
    expect(storage.maxRunning).toBeLessThanOrEqual(15);
    expect(await db.downloads.where('status').equals('done').count()).toBe(40);
  });

  it('bị chặn (403) thì giảm một nửa và tạm nghỉ, hết nghỉ thì tải tiếp', async () => {
    let t = 0;
    const limiter = new AdaptiveLimiter({ initial: 8, max: 8, baseCooldownMs: 60_000, now: () => t });
    __resetDownloadsForTests({ limiter });
    storage.failTimes.set(track(1).id, 2);
    await enqueueDownloads([track(1)]);
    await waitUntil(() => limiter.limit === 4);
    expect(limiter.cooldownRemaining()).toBe(60_000);
    // Đang nghỉ: bài mới thêm không được bắt đầu, bài lỗi cũng chưa thử lại.
    await enqueueDownloads([track(2), track(3)]);
    await new Promise((r) => setTimeout(r, 40));
    expect(storage.requests.map((r) => r.id)).toEqual([track(1).id]);
    expect(useDownloads.getState().cooldown).toBeGreaterThan(0);
    // Hết nghỉ → thử lại bài 1, lại bị chặn → còn 2 lượt, nghỉ lâu hơn.
    t += 60_000;
    await waitUntil(() => limiter.limit === 2);
    expect(limiter.cooldownRemaining()).toBe(120_000);
    // Hết nghỉ lần hai → các bài còn lại tải tiếp.
    t += 120_000;
    await pump();
    await waitForIdleForTests();
    expect((await db.downloads.get(track(1).id))?.status).toBe('error');
    expect((await db.downloads.get(track(2).id))?.status).toBe('done');
    expect((await db.downloads.get(track(3).id))?.status).toBe('done');
  });

  it('không cho tải bằng 4G/5G thì chờ Wi‑Fi; tự động trên 4G tối đa 6 lượt', async () => {
    __resetDownloadsForTests({ limiter: new AdaptiveLimiter({ initial: 3, max: 15, baseCooldownMs: 20 }) });
    await initDownloads();
    setNetworkStatus(true, 'cellular');
    expect(useDownloads.getState().limit).toBeLessThanOrEqual(6);
    await setDownloadSettings({ cellular: false });
    await enqueueDownloads([track(1)]);
    await new Promise((r) => setTimeout(r, 20));
    expect(storage.requests).toHaveLength(0);
    expect(useDownloads.getState().waitingForWifi).toBe(true);
    setNetworkStatus(true, 'wifi');
    await waitForIdleForTests();
    expect((await db.downloads.get(track(1).id))?.status).toBe('done');
    expect(activeCountForTests()).toBe(0);
  });
});

describe('khởi động', () => {
  it('nối với trình phát trước khi nạp danh sách tải: hàng chờ khôi phục vẫn phát từ file', async () => {
    await db.downloads.put({ id: track(2).id, status: 'done', bytes: 1000, total: 1000, createdAt: 1 });
    storage.files.set(track(2).id, 1000);
    storage.artwork.add(track(2).id);
    connectDownloadsToPlayer();
    const [fileUrl] = mocks.setFileUrlProvider.mock.lastCall as unknown as [(id: string) => Promise<string | undefined>];
    const [artworkFile] = mocks.setArtworkFileProvider.mock.lastCall as unknown as [(id: string) => Promise<string | undefined>];
    expect(await fileUrl(track(2).id)).toBe(`file:///music/${track(2).id}.m4a`);
    expect(await artworkFile(track(2).id)).toBe(`file:///music/${track(2).id}.jpg`);
    expect(await fileUrl(track(3).id)).toBeUndefined();
  });

  it('tải tiếp bài đang dở và dựng lại danh sách từ file .json', async () => {
    await db.tracks.put(track(1));
    await db.downloads.put({ id: track(1).id, status: 'downloading', bytes: 0, total: 0, createdAt: 1 });
    storage.files.set(track(7).id, 1234);
    storage.sidecars.set(track(7).id, { track: track(7), downloadedAt: 5, bytes: 1234 });

    await initDownloads();
    await waitForIdleForTests();

    expect((await db.downloads.get(track(1).id))?.status).toBe('done');
    expect(await db.downloads.get(track(7).id)).toMatchObject({ status: 'done', bytes: 1234 });
    expect(await db.tracks.get(track(7).id)).toMatchObject({ title: 'Bài 7' });
    await waitUntil(() => useDownloads.getState().rows.get(track(7).id)?.status === 'done');
  });

  it('thích bài thì tự tải nếu bật', async () => {
    const { toggleLike } = await import('@/lib/library');
    await initDownloads();
    await setDownloadSettings({ autoLiked: true });
    await toggleLike(track(3));
    let status: string | undefined;
    await waitUntil(() => {
      void db.downloads.get(track(3).id).then((row) => (status = row?.status));
      return status === 'done';
    });
    expect(status).toBe('done');
  });
});
