// Kiểu dữ liệu gọn của app, tách khỏi cấu trúc phức tạp của youtubei.js
// (khi YouTube đổi, chỉ cần sửa normalize.ts).

export interface ArtistRef {
  id?: string;
  name: string;
}

export interface AlbumRef {
  id?: string;
  name: string;
}

export interface Track {
  /** videoId */
  id: string;
  title: string;
  artists: ArtistRef[];
  album?: AlbumRef;
  /** giây, 0 nếu chưa biết */
  duration: number;
  thumbnail: string;
  /** video nhạc (ảnh 16:9) thay vì bài hát (ảnh vuông) */
  isVideo?: boolean;
}

export type CardKind = 'album' | 'playlist' | 'artist';

export interface Card {
  kind: CardKind;
  id: string;
  title: string;
  subtitle: string;
  thumbnail: string;
}

export type ShelfItem = { type: 'track'; track: Track } | { type: 'card'; card: Card };

export interface Shelf {
  title: string;
  items: ShelfItem[];
}

export interface AlbumPage {
  id: string;
  title: string;
  subtitle: string;
  artists: ArtistRef[];
  thumbnail: string;
  tracks: Track[];
  /** playlist OLAK5uy_… tương ứng album (để phát cả album) */
  playlistId?: string;
}

export interface ArtistPage {
  id: string;
  name: string;
  description?: string;
  thumbnail: string;
  topTracks: Track[];
  shelves: Shelf[];
}

export interface PlaylistPage {
  id: string;
  title: string;
  subtitle: string;
  description?: string;
  thumbnail: string;
  tracks: Track[];
}

export type SearchType = 'song' | 'video' | 'album' | 'artist' | 'playlist';

export interface SearchSuggestions {
  queries: string[];
  items: ShelfItem[];
}

export interface LyricsLine {
  /** giây */
  time: number;
  text: string;
}

export interface Lyrics {
  plain: string;
  synced?: LyricsLine[];
  source?: string;
}

/** Link audio đã giải mã, sẵn sàng cho AVPlayer / tải về. */
export interface ResolvedAudio {
  url: string;
  /** thời điểm hết hạn (ms epoch) */
  expiresAt: number;
  mimeType: string;
  /** byte, nếu YouTube cho biết */
  contentLength?: number;
  bitrate?: number;
  client: string;
  headers?: Record<string, string>;
}
