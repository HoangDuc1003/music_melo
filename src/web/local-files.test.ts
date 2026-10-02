import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/player/controller', () => ({
  refreshLocalFile: vi.fn(async () => undefined),
  setFileUrlProvider: vi.fn(),
  setArtworkFileProvider: vi.fn()
}));

import { __resetDownloadsForTests, localFileUrl, useDownloads } from '@/downloads/manager';
import { setStorageForTests } from '@/downloads/storage';
import { db } from '@/lib/db';
import { importAudioFiles, isAudioFile } from './local-files';

const latin1 = (s: string) => [...s].map((c) => c.charCodeAt(0));
const syncsafe = (n: number) => [(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f];
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
function mp3WithTags(title: string, artist: string): Uint8Array<ArrayBuffer> {
  const frame = (id: string, body: number[]) => [...latin1(id), ...be32(body.length), 0, 0, ...body];
  const text = (s: string) => [3, ...new TextEncoder().encode(s)];
  // APIC: mã hoá 0, mime "image/png", loại ảnh 3, mô tả rỗng, rồi dữ liệu ảnh
  const frames = [...frame('TIT2', text(title)), ...frame('TPE1', text(artist)), ...frame('APIC', [0, ...latin1('image/png'), 0, 3, 0, 137, 80, 78, 71])];
  return Uint8Array.from([...latin1('ID3'), 3, 0, 0, ...syncsafe(frames.length), ...frames, ...new Array(64).fill(1)]);
}

const duration = async () => 185;

beforeEach(async () => {
  // jsdom không có URL.createObjectURL cho Blob của nó.
  let n = 0;
  URL.createObjectURL = vi.fn(() => `blob:test/${++n}`);
  URL.revokeObjectURL = vi.fn();
  await Promise.all(db.tables.map((t) => t.clear()));
  setStorageForTests(undefined); // trình duyệt: lưu Blob trong IndexedDB
  __resetDownloadsForTests();
});

describe('thêm nhạc từ máy', () => {
  it('nhận đúng file nhạc', () => {
    expect(isAudioFile(new File([], 'a.mp3'))).toBe(true);
    expect(isAudioFile(new File([], 'ghi âm', { type: 'audio/x-m4a' }))).toBe(true);
    expect(isAudioFile(new File([], 'anh.jpg', { type: 'image/jpeg' }))).toBe(false);
  });

  it('đọc thẻ / tên file, lưu như bài đã tải, chọn lại không thêm trùng', async () => {
    const files = [
      new File([mp3WithTags('Mưa Tháng Sáu', 'Văn Mai Hương')], 'track01.mp3', { type: 'audio/mpeg', lastModified: 1 }),
      new File([new Uint8Array(100)], 'Đen Vâu - Bài Này Chill Phết.m4a', { type: 'audio/mp4', lastModified: 2 }),
      new File(['không phải nhạc'], 'ghi-chu.txt', { type: 'text/plain' })
    ];
    expect(await importAudioFiles(files, { duration })).toEqual({ added: 2, attached: 0, skipped: 1 });

    const tracks = await db.tracks.toArray();
    expect(tracks.map((t) => [t.title, t.artists[0]?.name, t.duration]).sort()).toEqual([
      ['Bài Này Chill Phết', 'Đen Vâu', 185],
      ['Mưa Tháng Sáu', 'Văn Mai Hương', 185]
    ]);
    expect(tracks.every((t) => /^lf-[0-9a-f]{20}$/.test(t.id))).toBe(true);
    const rows = await db.downloads.toArray();
    expect(rows.every((r) => r.status === 'done')).toBe(true);
    const tagged = tracks.find((t) => t.title === 'Mưa Tháng Sáu')!;
    // (IndexedDB giả trong test không giữ kiểu Blob, chỉ kiểm tra có lưu ảnh bìa)
    expect((await db.blobs.get(tagged.id))?.artwork).toBeTruthy();
    expect(useDownloads.getState().artwork.has(tagged.id)).toBe(true);
    expect(await localFileUrl(tagged.id)).toMatch(/^blob:/);

    expect(await importAudioFiles(files, { duration })).toEqual({ added: 0, attached: 0, skipped: 3 });
    expect(await db.downloads.count()).toBe(2);
  });
});
