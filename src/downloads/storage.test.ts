// Tải file trên iPhone (NativeStorage): link hết lượt giữa chừng thì lấy link mới rồi tải tiếp từ chỗ dừng.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  downloadFile: vi.fn(),
  size: 0
}));
vi.mock('@/lib/platform', () => ({ isNative: true }));
vi.mock('capacitor-melo-player', () => ({
  MeloPlayer: { downloadFile: native.downloadFile, addListener: vi.fn(async () => ({ remove: async () => undefined })) }
}));
vi.mock('@capacitor/filesystem', () => ({
  Directory: { LibraryNoCloud: 'LIBRARY_NO_CLOUD' },
  Encoding: { UTF8: 'utf8' },
  Filesystem: {
    mkdir: vi.fn(async () => undefined),
    getUri: vi.fn(async () => ({ uri: 'file:///app/Library/NoCloud/music/' })),
    stat: vi.fn(async () => ({ type: 'file', size: native.size })),
    deleteFile: vi.fn(async () => undefined),
    rename: vi.fn(async () => undefined)
  }
}));
vi.mock('@capacitor/file-transfer', () => ({ FileTransfer: { downloadFile: vi.fn() } }));

import { getStorage, setStorageForTests } from './storage';

const refresh = { url: 'https://youtubei.googleapis.com/youtubei/v1/player', headers: {}, body: '{}', itag: 140 };
const expired = (bytes: number) => Object.assign(new Error('HTTP 403'), { data: { httpStatus: 403, bytes } });

beforeEach(() => {
  setStorageForTests(undefined);
  native.downloadFile.mockReset();
  native.size = 3_000_000;
});

describe('tải file trên iPhone', () => {
  it('gửi kèm cách tự đổi link; native không đổi được thì lấy link mới bằng JS và tải tiếp từ byte đã có', async () => {
    native.downloadFile.mockRejectedValueOnce(expired(1_048_576)).mockResolvedValueOnce({ bytes: 3_000_000, rotations: 1 });
    const refreshUrl = vi.fn(async () => ({ url: 'https://rr1.googlevideo.com/videoplayback?v=2', refresh: { ...refresh, body: '{"v":2}' } }));
    const bytes = await getStorage().saveAudio({
      id: 'abcdefghijk',
      url: 'https://rr1.googlevideo.com/videoplayback?v=1',
      expectedBytes: 3_000_000,
      onProgress: () => undefined,
      refresh,
      refreshUrl
    });
    expect(bytes).toBe(3_000_000);
    expect(refreshUrl).toHaveBeenCalledTimes(1);
    expect(native.downloadFile.mock.calls.map(([o]) => [o.url, o.offset, o.refresh?.body])).toEqual([
      ['https://rr1.googlevideo.com/videoplayback?v=1', 0, '{}'],
      ['https://rr1.googlevideo.com/videoplayback?v=2', 1_048_576, '{"v":2}']
    ]);
  });

  it('link lấy từ bộ nhớ đã hết lượt (bị từ chối ngay byte đầu): đổi link một lần rồi tải từ đầu', async () => {
    native.downloadFile.mockRejectedValueOnce(expired(0)).mockResolvedValueOnce({ bytes: 3_000_000 });
    const refreshUrl = vi.fn(async () => ({ url: 'https://rr1.googlevideo.com/videoplayback?v=2' }));
    await getStorage().saveAudio({ id: 'abcdefghijk', url: 'https://rr1.googlevideo.com/videoplayback?v=1', onProgress: () => undefined, refreshUrl });
    expect(native.downloadFile.mock.calls.map(([o]) => [o.url, o.offset])).toEqual([
      ['https://rr1.googlevideo.com/videoplayback?v=1', 0],
      ['https://rr1.googlevideo.com/videoplayback?v=2', 0]
    ]);
  });

  it('link mới bị từ chối ngay (chưa tải thêm byte nào) thì báo lỗi, không đổi link mãi', async () => {
    native.downloadFile.mockRejectedValueOnce(expired(1_048_576)).mockRejectedValueOnce(expired(1_048_576));
    const refreshUrl = vi.fn(async () => ({ url: 'https://rr1.googlevideo.com/videoplayback?v=2' }));
    await expect(
      getStorage().saveAudio({ id: 'abcdefghijk', url: 'https://rr1.googlevideo.com/videoplayback?v=1', onProgress: () => undefined, refreshUrl })
    ).rejects.toThrow('HTTP 403');
    expect(refreshUrl).toHaveBeenCalledTimes(1);
  });
});
