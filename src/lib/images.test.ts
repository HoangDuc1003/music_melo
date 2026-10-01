import { describe, expect, it } from 'vitest';
import { bucket, sizedImage } from './images';

describe('sizedImage', () => {
  it('đổi kích thước ảnh googleusercontent / ggpht theo mức cố định', () => {
    expect(sizedImage('https://lh3.googleusercontent.com/abc=w544-h544-l90-rj', 144)).toBe('https://lh3.googleusercontent.com/abc=w144-h144-l90-rj');
    expect(sizedImage('https://yt3.ggpht.com/xyz=s88-c-k-c0x00ffffff-no-rj', 130)).toBe('https://yt3.ggpht.com/xyz=w144-h144-l90-rj');
    expect(sizedImage('https://lh3.googleusercontent.com/abc', 2000)).toBe('https://lh3.googleusercontent.com/abc=w544-h544-l90-rj');
  });

  it('ảnh video ytimg: chọn bản nhỏ cho dòng, bản lớn cho thẻ', () => {
    expect(sizedImage('https://i.ytimg.com/vi/abc/hqdefault.jpg', 144)).toBe('https://i.ytimg.com/vi/abc/mqdefault.jpg');
    expect(sizedImage('https://i.ytimg.com/vi/abc/sddefault.jpg', 432)).toBe('https://i.ytimg.com/vi/abc/hqdefault.jpg');
  });

  it('giữ nguyên ảnh khác (data:, blob:, ảnh đã tải, host lạ)', () => {
    expect(sizedImage('data:image/svg+xml,x', 48)).toBe('data:image/svg+xml,x');
    expect(sizedImage('capacitor://localhost/_capacitor_file_/a.jpg', 48)).toBe('capacitor://localhost/_capacitor_file_/a.jpg');
    expect(sizedImage('https://example.com/a.jpg', 48)).toBe('https://example.com/a.jpg');
    expect(sizedImage(undefined, 48)).toBeUndefined();
    expect(bucket(1)).toBe(96);
  });
});
