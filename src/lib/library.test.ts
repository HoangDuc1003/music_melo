import { beforeEach, describe, expect, it } from 'vitest';
import type { Track } from '@/youtube/types';
import { db } from './db';
import {
  addToPlaylist,
  clearSearches,
  createPlaylist,
  deletePlaylist,
  isLiked,
  likedTracks,
  playlistWithTracks,
  recentTracks,
  recordSearch,
  removeFromPlaylist,
  renamePlaylist,
  toggleLike
} from './library';

const track = (id: string): Track => ({ id, title: id, artists: [{ name: 'A' }], duration: 100, thumbnail: '' });

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe('thích', () => {
  it('bật/tắt và liệt kê mới nhất trước', async () => {
    expect(await toggleLike(track('a'))).toBe(true);
    await new Promise((r) => setTimeout(r, 2));
    expect(await toggleLike(track('b'))).toBe(true);
    expect((await likedTracks()).map((t) => t.id)).toEqual(['b', 'a']);
    expect(await toggleLike(track('a'))).toBe(false);
    expect(await isLiked('a')).toBe(false);
    expect((await likedTracks()).map((t) => t.id)).toEqual(['b']);
  });
});

describe('playlist', () => {
  it('tạo, thêm (bỏ trùng), xoá bài, đổi tên, xoá', async () => {
    const id = await createPlaylist('  Chill  ', [track('a')]);
    expect(await addToPlaylist(id, [track('a'), track('b'), track('b'), track('c')])).toBe(2);
    let p = await playlistWithTracks(id);
    expect(p?.playlist.name).toBe('Chill');
    expect(p?.tracks.map((t) => t.id)).toEqual(['a', 'b', 'c']);

    await removeFromPlaylist(id, 1);
    await removeFromPlaylist(id, 9);
    await renamePlaylist(id, '   ');
    await renamePlaylist(id, 'Đi làm');
    p = await playlistWithTracks(id);
    expect(p?.playlist.name).toBe('Đi làm');
    expect(p?.tracks.map((t) => t.id)).toEqual(['a', 'c']);

    await deletePlaylist(id);
    expect(await playlistWithTracks(id)).toBeUndefined();
    await expect(addToPlaylist(id, [track('x')])).rejects.toThrow();
  });

  it('tên rỗng thì đặt tên mặc định', async () => {
    const id = await createPlaylist('');
    expect((await playlistWithTracks(id))?.playlist.name).toBe('Playlist mới');
  });
});

describe('lịch sử', () => {
  it('bài nghe gần đây không trùng, mới nhất trước', async () => {
    await db.tracks.bulkPut(['a', 'b', 'c'].map(track));
    await db.history.bulkAdd([
      { trackId: 'a', playedAt: 1 },
      { trackId: 'b', playedAt: 2 },
      { trackId: 'a', playedAt: 3 },
      { trackId: 'c', playedAt: 4 }
    ]);
    expect((await recentTracks()).map((t) => t.id)).toEqual(['c', 'a', 'b']);
    expect((await recentTracks(2)).map((t) => t.id)).toEqual(['c', 'a']);
  });

  it('lịch sử tìm kiếm giữ tối đa 20 mục', async () => {
    for (let i = 0; i < 25; i++) await recordSearch(`q${i}`);
    await recordSearch('   ');
    expect(await db.searches.count()).toBe(20);
    expect(await db.searches.get('q0')).toBeUndefined();
    expect(await db.searches.get('q24')).toBeDefined();
    await clearSearches();
    expect(await db.searches.count()).toBe(0);
  });
});
