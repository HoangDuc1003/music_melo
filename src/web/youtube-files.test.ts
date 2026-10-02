import { beforeEach, describe, expect, it, vi } from 'vitest';

const player = vi.hoisted(() => ({ refreshLocalFile: vi.fn(async (_id: string) => undefined) }));
vi.mock('@/player/controller', () => ({
  refreshLocalFile: player.refreshLocalFile,
  setFileUrlProvider: vi.fn(),
  setArtworkFileProvider: vi.fn()
}));

import { __resetDownloadsForTests } from '@/downloads/manager';
import { setStorageForTests } from '@/downloads/storage';
import { db } from '@/lib/db';
import type { Track } from '@/youtube/types';
import { attachFileToTrack, importAudioFiles } from './local-files';
import { cleanFileName, converterLink, getPendingTracks, isValidConverterUrl, markPending, matchPending, removePending, setConverterUrl, getConverterUrl } from './youtube-files';

const video = (id: string, title: string, duration = 245, artist = 'Sơn Tùng M-TP'): Track => ({
  id: `yt-${id}`,
  title,
  artists: [{ id: 'yt-UCson', name: artist }],
  duration,
  thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
  isVideo: true
});
const LAC_TROI = video('Llw9Q6akRo4', 'SƠN TÙNG M-TP | LẠC TRÔI | OFFICIAL MUSIC VIDEO', 272);
const HIEN_TAI = video('psZ1g9fMfeo', 'Chúng Ta Của Hiện Tại (Official MV)', 302);
const DUNG_LAM = video('aaaaaaaaaaa', 'Đừng Làm Trái Tim Anh Đau', 326);
const info = (fileName: string, extra: { title?: string; artist?: string; duration?: number } = {}) => ({
  fileName,
  title: extra.title ?? cleanFileName(fileName),
  artist: extra.artist,
  duration: extra.duration ?? 0
});
const mp3 = (name: string) => new File([new Uint8Array(64).fill(1)], name, { type: 'audio/mpeg' });

beforeEach(async () => {
  let n = 0;
  URL.createObjectURL = vi.fn(() => `blob:test/${++n}`);
  URL.revokeObjectURL = vi.fn();
  await Promise.all(db.tables.map((t) => t.clear()));
  setStorageForTests(undefined);
  __resetDownloadsForTests();
  player.refreshLocalFile.mockClear();
});

describe('trang chuyển đổi', () => {
  it('địa chỉ https, thay {url} / {id}', async () => {
    expect(isValidConverterUrl('https://yt2.example.com')).toBe(true);
    expect(isValidConverterUrl('https://yt2.example.com/?url={url}')).toBe(true);
    expect(isValidConverterUrl('http://yt2.example.com')).toBe(false);
    expect(isValidConverterUrl('javascript:alert(1)')).toBe(false);
    expect(converterLink('https://yt2.example.com/?url={url}', 'yt-Llw9Q6akRo4')).toBe(
      'https://yt2.example.com/?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DLlw9Q6akRo4'
    );
    expect(converterLink('https://yt2.example.com/watch/{id}', 'yt-Llw9Q6akRo4')).toBe('https://yt2.example.com/watch/Llw9Q6akRo4');
    expect(converterLink('https://yt2.example.com', 'yt-Llw9Q6akRo4')).toBe('https://yt2.example.com');
    await setConverterUrl(' https://yt2.example.com ');
    expect(await getConverterUrl()).toBe('https://yt2.example.com');
  });
});

describe('khớp file tải về với bài đang chờ', () => {
  const pending = [LAC_TROI, HIEN_TAI, DUNG_LAM];

  it('bỏ phần thừa trong tên file của trang chuyển đổi', () => {
    expect(cleanFileName('y2mate.com - SƠN TÙNG MTP  LẠC TRÔI  OFFICIAL MUSIC VIDEO_128kbps.mp3')).toBe('SƠN TÙNG MTP LẠC TRÔI OFFICIAL MUSIC VIDEO');
    expect(cleanFileName('yt1s.io - Chúng Ta Của Hiện Tại (320 kbps).mp3')).toBe('Chúng Ta Của Hiện Tại');
  });

  it('theo tên (có/không dấu, có tên trang, có "Official MV"), theo id video trong tên file', () => {
    expect(matchPending(info('y2mate.com - SƠN TÙNG MTP  LẠC TRÔI  OFFICIAL MUSIC VIDEO_128kbps.mp3'), pending)).toBe(LAC_TROI);
    expect(matchPending(info('Chung Ta Cua Hien Tai.mp3'), pending)).toBe(HIEN_TAI);
    expect(matchPending(info('file.mp3', { title: 'Đừng Làm Trái Tim Anh Đau', artist: 'Sơn Tùng M-TP' }), pending)).toBe(DUNG_LAM);
    expect(matchPending(info('video [psZ1g9fMfeo].mp4'), pending)).toBe(HIEN_TAI);
  });

  it('không khớp: tên khác hẳn, hoặc thời lượng lệch nhiều', () => {
    expect(matchPending(info('Bài hát khác hoàn toàn.mp3'), pending)).toBeUndefined();
    expect(matchPending(info('Lạc Trôi.mp3', { duration: 272 + 60 }), pending)).toBeUndefined();
    expect(matchPending(info('Lạc Trôi.mp3', { duration: 270 }), pending)).toBe(LAC_TROI);
    expect(matchPending(info('Lạc Trôi.mp3'), [])).toBeUndefined();
  });
});

describe('gắn file vào bài YouTube', () => {
  it('danh sách chờ: mới nhất trước, bỏ bài đã có file', async () => {
    await markPending(LAC_TROI, Date.now() - 1000);
    await markPending(HIEN_TAI);
    expect((await getPendingTracks()).map((t) => t.id)).toEqual([HIEN_TAI.id, LAC_TROI.id]);
    await removePending(HIEN_TAI.id);
    expect((await getPendingTracks()).map((t) => t.id)).toEqual([LAC_TROI.id]);
  });

  it('chọn file cho bài: lưu như bài đã tải (giữ tên, ảnh của video), thôi chờ, báo trình phát dùng file', async () => {
    await markPending(LAC_TROI);
    await attachFileToTrack(LAC_TROI, mp3('bat-ky.mp3'), { duration: async () => 271 });
    expect(await db.downloads.get(LAC_TROI.id)).toMatchObject({ status: 'done' });
    expect(await db.tracks.get(LAC_TROI.id)).toMatchObject({ title: LAC_TROI.title, thumbnail: LAC_TROI.thumbnail });
    expect(await db.blobs.get(LAC_TROI.id)).toBeDefined();
    expect(await getPendingTracks()).toEqual([]);
    expect(player.refreshLocalFile).toHaveBeenCalledWith(LAC_TROI.id);
    // Chọn lại file khác thì thay file cũ.
    await attachFileToTrack(LAC_TROI, mp3('file-moi.mp3'), { duration: async () => 271 });
    expect(await db.downloads.count()).toBe(1);
    await expect(attachFileToTrack(LAC_TROI, new File(['x'], 'ghi-chu.txt'))).rejects.toThrow(/không phải file nhạc/);
  });

  it('Thêm nhạc từ máy: file khớp bài đang chờ thì gắn vào bài YouTube, còn lại thành bài mới', async () => {
    await markPending(LAC_TROI);
    await markPending(HIEN_TAI);
    const result = await importAudioFiles([mp3('y2mate.com - Lac Troi Official MV_128kbps.mp3'), mp3('Hà Anh - Bài Của Tôi.mp3'), new File(['x'], 'a.txt')], {
      duration: async () => 0
    });
    expect(result).toEqual({ added: 1, attached: 1, skipped: 1 });
    expect(await db.downloads.get(LAC_TROI.id)).toMatchObject({ status: 'done' });
    expect((await getPendingTracks()).map((t) => t.id)).toEqual([HIEN_TAI.id]);
    expect((await db.tracks.toArray()).filter((t) => t.id.startsWith('lf-')).map((t) => t.title)).toEqual(['Bài Của Tôi']);
  });
});
