import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerItem } from 'capacitor-melo-player';
import type { Track } from '@/youtube/types';

// ---- Bản giả của plugin native: giữ hàng chờ theo đúng quy ước của bản Swift/web ----
const native = vi.hoisted(() => {
  type Listener = (data: any) => void;
  const listeners = new Map<string, Listener[]>();
  const state = { items: [] as PlayerItem[], index: -1, repeat: 'off' };
  const api = {
    state,
    listeners,
    emit(event: string, data: unknown = {}) {
      for (const fn of listeners.get(event) ?? []) fn(data);
    },
    reset() {
      listeners.clear();
      state.items = [];
      state.index = -1;
      state.repeat = 'off';
    },
    ids() {
      return state.items.map((i) => i.id);
    },
    plugin: {
      addListener: vi.fn(async (event: string, fn: Listener) => {
        listeners.set(event, [...(listeners.get(event) ?? []), fn]);
        return { remove: async () => undefined };
      }),
      setQueue: vi.fn(async (o: { items: PlayerItem[]; startIndex: number; keepCurrent?: boolean }) => {
        const keep = o.keepCurrent && state.items[state.index]?.id === o.items[o.startIndex]?.id;
        state.items = o.items.map((i) => ({ ...i }));
        state.index = o.items.length ? o.startIndex : -1;
        void keep;
      }),
      addItems: vi.fn(async (o: { items: PlayerItem[]; index?: number }) => {
        const at = o.index ?? state.items.length;
        state.items.splice(at, 0, ...o.items.map((i) => ({ ...i })));
        if (state.index !== -1 && at <= state.index) state.index += o.items.length;
      }),
      removeItem: vi.fn(async ({ index }: { index: number }) => {
        state.items.splice(index, 1);
        if (index < state.index) state.index -= 1;
        else if (index === state.index && state.index >= state.items.length) state.index = state.items.length - 1;
      }),
      moveItem: vi.fn(async ({ from, to }: { from: number; to: number }) => {
        const [moved] = state.items.splice(from, 1);
        state.items.splice(to, 0, moved);
        if (state.index === from) state.index = to;
        else if (from < state.index && to >= state.index) state.index -= 1;
        else if (from > state.index && to <= state.index) state.index += 1;
      }),
      updateItem: vi.fn(async (o: { id: string; url?: string; fileUrl?: string }) => {
        for (const item of state.items) {
          if (item.id !== o.id) continue;
          if (o.url !== undefined) item.url = o.url;
          if (o.fileUrl !== undefined) item.fileUrl = o.fileUrl;
        }
      }),
      getState: vi.fn(async () => ({
        index: state.index,
        id: state.items[state.index]?.id,
        playing: false,
        buffering: false,
        position: 0,
        duration: 0,
        repeat: state.repeat,
        queueLength: state.items.length
      })),
      play: vi.fn(async () => undefined),
      pause: vi.fn(async () => undefined),
      next: vi.fn(async () => undefined),
      previous: vi.fn(async () => undefined),
      skipTo: vi.fn(async () => undefined),
      seekTo: vi.fn(async () => undefined),
      setRepeat: vi.fn(async ({ mode }: { mode: string }) => {
        state.repeat = mode;
      }),
      setSleepTimer: vi.fn(async () => undefined)
    }
  };
  return api;
});

const youtube = vi.hoisted(() => {
  class StreamError extends Error {
    constructor(
      message: string,
      readonly reason: string
    ) {
      super(message);
    }
  }
  const cache = new Map<string, { url: string; expiresAt: number }>();
  let version = 0;
  return {
    StreamError,
    cache,
    failing: new Set<string>(),
    bump() {
      version += 1;
    },
    resetVersion() {
      version = 0;
    },
    resolveAudio: vi.fn(async (id: string, options: { refresh?: boolean } = {}) => {
      if (youtube.failing.has(id)) throw new StreamError('Video không còn khả dụng', 'unavailable');
      if (options.refresh) cache.delete(id);
      let audio = cache.get(id);
      if (!audio) {
        audio = { url: `https://audio.test/${id}?v=${version}`, expiresAt: Date.now() + 3600_000 };
        cache.set(id, audio);
      }
      return { ...audio, mimeType: 'audio/mp4', client: 'TEST' };
    }),
    getCachedAudio: vi.fn((id: string) => {
      const audio = cache.get(id);
      return audio ? { ...audio, mimeType: 'audio/mp4', client: 'TEST' } : undefined;
    }),
    clearAudioCache: vi.fn(() => cache.clear()),
    getUpNext: vi.fn(async (_id: string): Promise<Track[]> => [])
  };
});

const network = vi.hoisted(() => {
  const listeners: ((s: { connected: boolean; connectionType: string }) => void)[] = [];
  return {
    listeners,
    Network: {
      getStatus: vi.fn(async () => ({ connected: true, connectionType: 'wifi' })),
      addListener: vi.fn(async (_event: string, fn: (s: { connected: boolean; connectionType: string }) => void) => {
        listeners.push(fn);
        return { remove: async () => undefined };
      })
    }
  };
});

vi.mock('capacitor-melo-player', () => ({ MeloPlayer: native.plugin }));
vi.mock('@capacitor/network', () => ({ Network: network.Network }));
vi.mock('@/youtube/stream', () => ({
  StreamError: youtube.StreamError,
  resolveAudio: youtube.resolveAudio,
  getCachedAudio: youtube.getCachedAudio,
  clearAudioCache: youtube.clearAudioCache
}));
vi.mock('@/youtube/music', () => ({ getUpNext: youtube.getUpNext }));

import * as player from './controller';
import { usePlayer } from './store';

const track = (id: string): Track => ({ id, title: `Bài ${id}`, artists: [{ name: 'Ca sĩ' }], duration: 180, thumbnail: `https://img/${id}` });
const tracks = (...ids: string[]) => ids.map(track);
const storeIds = () => usePlayer.getState().entries.map((e) => e.track.id);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function settle() {
  for (let i = 0; i < 10; i++) await flush();
}

beforeEach(async () => {
  localStorage.clear();
  native.reset();
  youtube.cache.clear();
  youtube.resetVersion();
  youtube.failing.clear();
  youtube.getUpNext.mockReset();
  youtube.getUpNext.mockResolvedValue([]);
  network.listeners.length = 0;
  vi.clearAllMocks();
  player.__resetPlayerForTests({ sleep: async () => undefined });
  await player.initPlayer();
});

afterEach(async () => {
  await settle();
});

describe('playTracks', () => {
  it('gửi hàng chờ cho native và chuẩn bị link các bài tới', async () => {
    await player.playTracks(tracks('a', 'b', 'c'), 1);
    expect(native.plugin.setQueue).toHaveBeenCalledWith(
      expect.objectContaining({ startIndex: 1, playWhenReady: true, keepCurrent: false })
    );
    const items = native.plugin.setQueue.mock.calls[0][0].items as PlayerItem[];
    expect(items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(items[0]).toMatchObject({ title: 'Bài a', artist: 'Ca sĩ', artwork: 'https://img/a', duration: 180, url: '' });
    expect(storeIds()).toEqual(['a', 'b', 'c']);
    expect(usePlayer.getState().index).toBe(1);

    await settle();
    // Bài hiện tại và các bài sau (không lấy bài đã qua).
    expect(youtube.resolveAudio.mock.calls.map((c) => c[0])).toEqual(['b', 'c']);
    expect(native.state.items.map((i) => i.url)).toEqual(['', 'https://audio.test/b?v=0', 'https://audio.test/c?v=0']);
  });

  it('dùng link còn hạn trong cache ngay khi tạo hàng chờ', async () => {
    await youtube.resolveAudio('a');
    youtube.resolveAudio.mockClear();
    await player.playTracks(tracks('a'));
    const items = native.plugin.setQueue.mock.calls[0][0].items as PlayerItem[];
    expect(items[0].url).toBe('https://audio.test/a?v=0');
    await settle();
    expect(native.plugin.updateItem).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
  });

  it('bài đã tải dùng file, không cần lấy link', async () => {
    player.setFileUrlProvider(async (id) => (id === 'b' ? 'file:///music/b.m4a' : undefined));
    await player.playTracks(tracks('a', 'b'));
    await settle();
    expect(native.state.items[1].fileUrl).toBe('file:///music/b.m4a');
    expect(youtube.resolveAudio.mock.calls.map((c) => c[0])).toEqual(['a']);
  });

  it('trộn bài: bài được chọn phát đầu tiên', async () => {
    await player.playTracks(tracks('a', 'b', 'c', 'd'), 2, { shuffle: true });
    expect(storeIds()[0]).toBe('c');
    expect(usePlayer.getState().index).toBe(0);
    expect([...storeIds()].sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(native.ids()).toEqual(storeIds());
  });
});

describe('needsUrl', () => {
  it('link hỏng thì lấy link mới (refresh) và gửi lại', async () => {
    await player.playTracks(tracks('a'));
    await settle();
    youtube.bump();
    native.emit('needsUrl', { index: 0, id: 'a', reason: 'failed' });
    await settle();
    expect(youtube.resolveAudio).toHaveBeenCalledWith('a', { refresh: true });
    expect(native.state.items[0].url).toBe('https://audio.test/a?v=1');
  });

  it('luôn gửi link khi native đang đợi, kể cả link đã gửi', async () => {
    await player.playTracks(tracks('a'));
    await settle();
    native.plugin.updateItem.mockClear();
    native.emit('needsUrl', { index: 0, id: 'a', reason: 'missing' });
    await settle();
    expect(native.plugin.updateItem).toHaveBeenCalledWith(expect.objectContaining({ id: 'a', url: 'https://audio.test/a?v=0' }));
  });

  it('không lấy được link thì báo lỗi và sang bài', async () => {
    youtube.failing.add('a');
    await player.playTracks(tracks('a', 'b'));
    native.emit('needsUrl', { index: 0, id: 'a', reason: 'missing' });
    await settle();
    expect(usePlayer.getState().error).toBe('Video không còn khả dụng');
    expect(native.plugin.next).toHaveBeenCalledTimes(1);
  });

  it('cả hàng chờ đều không lấy được link thì dừng, không chuyển bài mãi', async () => {
    youtube.failing.add('a');
    youtube.failing.add('b');
    await player.playTracks(tracks('a', 'b'));
    native.emit('needsUrl', { index: 0, id: 'a', reason: 'missing' });
    await settle();
    native.state.index = 1;
    native.emit('needsUrl', { index: 1, id: 'b', reason: 'missing' });
    await settle();
    expect(native.plugin.next).toHaveBeenCalledTimes(1);
    expect(native.plugin.pause).toHaveBeenCalledTimes(1);
    expect(usePlayer.getState().error).toMatch(/kết nối mạng/);
  });
});

describe('radio', () => {
  it('hàng chờ một bài thì nối radio ngay, bỏ bài trùng', async () => {
    youtube.getUpNext.mockResolvedValue(tracks('a', 'r1', 'r2', 'r1'));
    await player.playTracks(tracks('a'));
    await settle();
    expect(youtube.getUpNext).toHaveBeenCalledWith('a');
    expect(storeIds()).toEqual(['a', 'r1', 'r2']);
    expect(usePlayer.getState().entries.slice(1).every((e) => e.origin === 'radio')).toBe(true);
    expect(native.ids()).toEqual(storeIds());
  });

  it('không nối khi còn nhiều bài hoặc đang lặp', async () => {
    await player.playTracks(tracks('a', 'b', 'c', 'd', 'e', 'f'));
    await settle();
    expect(youtube.getUpNext).not.toHaveBeenCalled();
    await player.setRepeat('all');
    native.emit('itemChanged', { index: 5, id: 'f' });
    await settle();
    expect(youtube.getUpNext).not.toHaveBeenCalled();
  });

  it('nối thêm khi phát tới gần cuối, không gọi lại seed đã lỗi', async () => {
    await player.playTracks(tracks('a', 'b', 'c', 'd', 'e'));
    await settle();
    youtube.getUpNext.mockRejectedValueOnce(new Error('mạng'));
    native.emit('itemChanged', { index: 1, id: 'b' });
    await settle();
    expect(youtube.getUpNext).toHaveBeenCalledTimes(1);
    native.emit('itemChanged', { index: 2, id: 'c' });
    await settle();
    expect(youtube.getUpNext).toHaveBeenCalledTimes(1);

    // Hết hàng chờ: thử lại một lần rồi phát bài radio đầu tiên.
    youtube.getUpNext.mockResolvedValue(tracks('r1'));
    native.emit('queueEnded');
    await settle();
    expect(storeIds()).toEqual(['a', 'b', 'c', 'd', 'e', 'r1']);
    expect(native.plugin.skipTo).toHaveBeenCalledWith({ index: 5 });
  });
});

describe('sửa hàng chờ', () => {
  it('Phát tiếp / Thêm vào hàng chờ / xoá / kéo thả luôn khớp với native', async () => {
    youtube.getUpNext.mockResolvedValue(tracks('r1', 'r2'));
    await player.playTracks(tracks('a', 'b'));
    await settle();
    expect(storeIds()).toEqual(['a', 'b', 'r1', 'r2']);

    await player.addToQueue(tracks('q1'));
    await player.addToQueue(tracks('q2'));
    expect(storeIds()).toEqual(['a', 'q1', 'q2', 'b', 'r1', 'r2']);
    await player.playNext(tracks('n1'));
    expect(storeIds()).toEqual(['a', 'n1', 'q1', 'q2', 'b', 'r1', 'r2']);
    expect(native.ids()).toEqual(storeIds());

    await player.move(6, 0);
    expect(usePlayer.getState().index).toBe(1);
    await player.removeAt(1);
    expect(storeIds()).toEqual(['r2', 'n1', 'q1', 'q2', 'b', 'r1']);
    expect(usePlayer.getState().index).toBe(1);
    await player.removeAt(0);
    expect(usePlayer.getState().index).toBe(0);
    expect(native.ids()).toEqual(storeIds());
    expect(native.state.index).toBe(usePlayer.getState().index);
  });

  it('bật/tắt trộn bài giữ bài đang phát và khôi phục thứ tự gốc', async () => {
    await player.playTracks(tracks('a', 'b', 'c', 'd', 'e'), 2);
    await player.toggleShuffle();
    expect(usePlayer.getState().shuffle).toBe(true);
    expect(storeIds()[usePlayer.getState().index]).toBe('c');
    expect(native.plugin.setQueue).toHaveBeenLastCalledWith(expect.objectContaining({ keepCurrent: true }));

    await player.addToQueue(tracks('q'));
    await player.toggleShuffle();
    expect(usePlayer.getState().shuffle).toBe(false);
    expect(storeIds()).toEqual(['a', 'b', 'c', 'q', 'd', 'e']);
    expect(storeIds()[usePlayer.getState().index]).toBe('c');
    expect(native.ids()).toEqual(storeIds());
  });
});

describe('lưu và khôi phục', () => {
  it('mở lại app thì nạp hàng chờ cũ ở vị trí cũ, không tự phát', async () => {
    await player.playTracks(tracks('a', 'b', 'c'), 1);
    native.emit('state', { index: 1, id: 'b', playing: true, buffering: false, position: 77, duration: 180, repeat: 'off', queueLength: 3 });
    player.saveSnapshot();

    native.reset();
    player.__resetPlayerForTests({ sleep: async () => undefined });
    await player.initPlayer();

    expect(storeIds()).toEqual(['a', 'b', 'c']);
    expect(native.plugin.setQueue).toHaveBeenLastCalledWith(
      expect.objectContaining({ startIndex: 1, startPosition: 77, playWhenReady: false })
    );
    expect(native.ids()).toEqual(['a', 'b', 'c']);
  });

  it('native vẫn đang phát đúng hàng chờ thì không nạp lại', async () => {
    await player.playTracks(tracks('a', 'b'));
    player.saveSnapshot();
    native.plugin.setQueue.mockClear();
    player.__resetPlayerForTests({ sleep: async () => undefined });
    await player.initPlayer();
    expect(native.plugin.setQueue).not.toHaveBeenCalled();
    expect(storeIds()).toEqual(['a', 'b']);
  });
});

describe('mạng', () => {
  it('đổi Wi-Fi ↔ 4G thì xoá link cũ và lấy lại', async () => {
    await player.playTracks(tracks('a', 'b'));
    await settle();
    youtube.bump();
    youtube.resolveAudio.mockClear();
    for (const fn of network.listeners) fn({ connected: true, connectionType: 'cellular' });
    await settle();
    expect(youtube.clearAudioCache).toHaveBeenCalled();
    expect(youtube.resolveAudio.mock.calls.map((c) => c[0])).toEqual(['a', 'b']);
    expect(native.state.items[1].url).toBe('https://audio.test/b?v=1');
  });

  it('mất mạng thì không làm gì', async () => {
    for (const fn of network.listeners) fn({ connected: false, connectionType: 'none' });
    await settle();
    expect(youtube.clearAudioCache).not.toHaveBeenCalled();
  });
});

describe('offline', () => {
  it('không có mạng thì chỉ phát bài đã tải', async () => {
    player.setFileUrlProvider(async (id) => (id === 'b' || id === 'c' ? `file:///music/${id}.m4a` : undefined));
    for (const fn of network.listeners) fn({ connected: false, connectionType: 'none' });
    await player.playTracks(tracks('a', 'b', 'c'), 2);
    expect(storeIds()).toEqual(['b', 'c']);
    expect(usePlayer.getState().index).toBe(1);
    expect(native.state.items.map((i) => i.fileUrl)).toEqual(['file:///music/b.m4a', 'file:///music/c.m4a']);

    native.plugin.setQueue.mockClear();
    await player.playTracks(tracks('a', 'b', 'c'), 0);
    expect(native.plugin.setQueue).not.toHaveBeenCalled();
    expect(usePlayer.getState().error).toMatch(/chưa được tải/);
    expect(youtube.getUpNext).not.toHaveBeenCalled();
  });
});

describe('lịch sử', () => {
  it('ghi lịch sử khi đổi bài, không ghi trùng khi nạp lại cùng bài', async () => {
    const { db } = await import('@/lib/db');
    await db.history.clear();
    await player.playTracks(tracks('a', 'b'));
    native.emit('itemChanged', { index: 0, id: 'a' });
    native.emit('itemChanged', { index: 0, id: 'a' });
    native.emit('itemChanged', { index: 1, id: 'b' });
    await settle();
    const rows = await db.history.orderBy('playedAt').toArray();
    expect(rows.map((r) => r.trackId)).toEqual(['a', 'b']);
    expect(await db.tracks.get('b')).toMatchObject({ title: 'Bài b' });
  });
});
