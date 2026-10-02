import { describe, expect, it } from 'vitest';
import { cleanArtist, cleanTitle, fold } from './text';

describe('chuẩn hoá chữ', () => {
  it('fold: bỏ dấu, ký tự đặc biệt', () => {
    expect(fold('Sơn Tùng M-TP')).toBe('son tung m tp');
    expect(fold('Đen Vâu')).toBe('den vau');
  });

  it('bỏ phần thừa trong tên bài YouTube', () => {
    expect(cleanTitle('Lạc Trôi (Official Music Video)')).toBe('Lạc Trôi');
    expect(cleanTitle('Hãy Trao Cho Anh [MV] | Sơn Tùng')).toBe('Hãy Trao Cho Anh');
    expect(cleanTitle('Song ft. Someone')).toBe('Song');
    expect(cleanTitle('Em Của Ngày Hôm Qua (Lyrics Video)')).toBe('Em Của Ngày Hôm Qua');
    expect(cleanTitle('Nơi Này Có Anh')).toBe('Nơi Này Có Anh');
    expect(cleanArtist('Sơn Tùng M-TP - Topic')).toBe('Sơn Tùng M-TP');
  });
});
