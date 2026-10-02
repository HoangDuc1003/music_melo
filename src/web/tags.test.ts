import { describe, expect, it } from 'vitest';
import { readTags, tagsFromFileName } from './tags';

const bytes = (...parts: (number[] | Uint8Array | string)[]) =>
  Uint8Array.from(parts.flatMap((p) => (typeof p === 'string' ? [...new TextEncoder().encode(p)] : [...p])));
const latin1 = (s: string) => [...s].map((c) => c.charCodeAt(0));
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const syncsafe = (n: number) => [(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f];
const utf16le = (s: string) => [0xff, 0xfe, ...[...s].flatMap((c) => [c.charCodeAt(0) & 0xff, c.charCodeAt(0) >> 8])];

/** Khung ID3v2.3: id + kích thước (số thường) + 2 byte cờ + nội dung. */
const frame23 = (id: string, body: number[]) => [...latin1(id), ...be32(body.length), 0, 0, ...body];
/** Khung ID3v2.4: kích thước dạng syncsafe. */
const frame24 = (id: string, body: number[]) => [...latin1(id), ...syncsafe(body.length), 0, 0, ...body];
const id3 = (major: number, frames: number[], padding = 16) => {
  const body = [...frames, ...new Array(padding).fill(0)];
  return new Blob([bytes(latin1('ID3'), [major, 0, 0], syncsafe(body.length), body, latin1('âm thanh giả'))]);
};
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 1, 2, 3];

describe('đọc thẻ file nhạc', () => {
  it('ID3v2.3: tên bài UTF-16, nghệ sĩ Latin-1, album, ảnh bìa', async () => {
    const tags = await readTags(
      id3(3, [
        ...frame23('TIT2', [1, ...utf16le('Mưa Tháng Sáu'), 0, 0]),
        ...frame23('TPE1', [0, ...latin1('Van Mai Huong')]),
        ...frame23('TALB', [3, ...new TextEncoder().encode('Album Đầu')]),
        ...frame23('APIC', [0, ...latin1('image/jpeg'), 0, 3, ...latin1('bia'), 0, ...JPEG])
      ])
    );
    expect(tags).toMatchObject({ title: 'Mưa Tháng Sáu', artist: 'Van Mai Huong', album: 'Album Đầu' });
    expect(tags.picture?.type).toBe('image/jpeg');
    expect([...new Uint8Array(await tags.picture!.arrayBuffer())]).toEqual(JPEG);
  });

  it('ID3v2.4: UTF-8, kích thước khung syncsafe, nhiều giá trị lấy giá trị đầu', async () => {
    const enc = (s: string) => [...new TextEncoder().encode(s)];
    const tags = await readTags(id3(4, [...frame24('TIT2', [3, ...enc('Lạc Trôi')]), ...frame24('TPE1', [3, ...enc('Sơn Tùng M-TP'), 0, ...enc('Khác')])]));
    expect(tags).toEqual({ title: 'Lạc Trôi', artist: 'Sơn Tùng M-TP' });
  });

  it('M4A: moov → udta → meta → ilst (©nam, ©ART, ©alb, covr)', async () => {
    const atom = (type: string, ...children: number[][]) => {
      const body = children.flat();
      return [...be32(8 + body.length), ...latin1(type), ...body];
    };
    const data = (kind: number, payload: number[]) => atom('data', [...be32(kind), 0, 0, 0, 0, ...payload]);
    const text = (s: string) => data(1, [...new TextEncoder().encode(s)]);
    const ilst = atom('ilst', atom('©nam', text('Hà Nội Mùa Vắng')), atom('©ART', text('Hà Anh')), atom('©alb', text('Xưa')), atom('covr', data(13, JPEG)));
    const meta = [...be32(12 + ilst.length), ...latin1('meta'), 0, 0, 0, 0, ...ilst];
    const moov = atom('moov', atom('udta', meta));
    const file = new Blob([bytes(atom('ftyp', latin1('M4A '), [0, 0, 0, 0]), atom('mdat', [1, 2, 3, 4]), moov)]);
    const tags = await readTags(file);
    expect(tags).toMatchObject({ title: 'Hà Nội Mùa Vắng', artist: 'Hà Anh', album: 'Xưa' });
    expect(tags.picture?.type).toBe('image/jpeg');
  });

  it('file không có thẻ hoặc thẻ hỏng thì không lỗi', async () => {
    expect(await readTags(new Blob([bytes(latin1('RIFF....WAVE'))]))).toEqual({});
    expect(await readTags(new Blob([bytes(latin1('ID3'), [3, 0, 0], syncsafe(100), latin1('TIT2'))]))).toEqual({});
  });

  it('lấy tên từ tên file', () => {
    expect(tagsFromFileName('Sơn Tùng M-TP - Lạc Trôi.mp3')).toEqual({ artist: 'Sơn Tùng M-TP', title: 'Lạc Trôi' });
    expect(tagsFromFileName('01. Nơi Này Có Anh.m4a')).toEqual({ title: 'Nơi Này Có Anh' });
    expect(tagsFromFileName('03 - Den_Vau - Bai Nay Chill.mp3')).toEqual({ artist: 'Den Vau', title: 'Bai Nay Chill' });
    expect(tagsFromFileName('ghi-am.wav')).toEqual({ title: 'ghi-am' });
  });
});
