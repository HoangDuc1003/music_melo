// Dữ liệu mẫu cho `npm run dev:mock` (chỉ dùng khi phát triển; không có trong bản build thật).
import type { AlbumPage, ArtistPage, Card, PlaylistPage, Shelf, Track } from '../types';
import { albumCover, artistCover, playlistCover, trackCover } from './covers';

const ARTISTS = [
  { id: 'UCmock-ha-anh', name: 'Hà Anh' },
  { id: 'UCmock-minh-khoa', name: 'Minh Khoa' },
  { id: 'UCmock-thu-trang', name: 'Thu Trang' },
  { id: 'UCmock-ban-nhac-gio', name: 'Ban Nhạc Gió' },
  { id: 'UCmock-lan-chi', name: 'Lan Chi' }
];

const TITLES = [
  'Mưa Tháng Sáu', 'Phố Cũ Chiều Nay', 'Gió Mùa Về', 'Hẹn Em Ở Huế', 'Tàu Đêm Quảng Trị', 'Thành Phố Ngủ Quên',
  'Đường Về Nhà', 'Một Chút Nắng', 'Biển Xanh', 'Ngày Không Em', 'Cà Phê Sáng', 'Đêm Trắng', 'Lời Chưa Nói',
  'Mùa Thu Hà Nội', 'Sông Hương', 'Chuyến Bay Muộn', 'Bản Tình Ca Cũ', 'Vệt Nắng Cuối Ngày', 'Ánh Đèn Xa',
  'Câu Chuyện Nhỏ', 'Hoa Sữa', 'Đà Lạt Sương', 'Ga Cuối', 'Trời Sau Mưa'
];

export const TRACKS: Track[] = TITLES.map((title, i) => {
  const artist = ARTISTS[i % ARTISTS.length];
  const id = `mock${String(i).padStart(7, '0')}`;
  return {
    id,
    title,
    artists: [artist],
    album: { id: `MPREb_mock${i % 4}`, name: `Album ${['Mùa Hạ', 'Thành Phố', 'Hành Trình', 'Kỷ Niệm'][i % 4]}` },
    duration: 150 + ((i * 37) % 120),
    thumbnail: trackCover(id, title)
  };
});

export const ARTIST_CARDS: Card[] = ARTISTS.map((a, i) => ({
  kind: 'artist',
  id: a.id,
  title: a.name,
  subtitle: 'Nghệ sĩ',
  thumbnail: artistCover(a.id, a.name, i, true)
}));

export const ALBUM_CARDS: Card[] = [0, 1, 2, 3].map((i) => {
  const name = `Album ${['Mùa Hạ', 'Thành Phố', 'Hành Trình', 'Kỷ Niệm'][i]}`;
  return { kind: 'album', id: `MPREb_mock${i}`, title: name, subtitle: `Album • ${ARTISTS[i].name} • 202${i}`, thumbnail: albumCover(`album${i}`, name, ARTISTS[i].name) };
});

export const PLAYLIST_CARDS: Card[] = ['Nhạc Việt Hot', 'Chill Cuối Tuần', 'Lofi Học Bài', 'Nhạc Đi Tàu'].map((name, i) => ({
  kind: 'playlist',
  id: `PLmock${String(i).padStart(10, '0')}`,
  title: name,
  subtitle: 'Playlist • YouTube Music',
  thumbnail: playlistCover(`pl${i}`, name)
}));

export const HOME: Shelf[] = [
  { title: 'Chọn nhanh', items: TRACKS.slice(0, 8).map((track) => ({ type: 'track', track })) },
  { title: 'Playlist dành cho bạn', items: PLAYLIST_CARDS.map((card) => ({ type: 'card', card })) },
  { title: 'Album mới', items: ALBUM_CARDS.map((card) => ({ type: 'card', card })) },
  { title: 'Nghệ sĩ bạn có thể thích', items: ARTIST_CARDS.map((card) => ({ type: 'card', card })) },
  { title: 'Bảng xếp hạng', items: TRACKS.slice(8, 18).map((track) => ({ type: 'track', track })) }
];

export function album(id: string): AlbumPage {
  const i = Number(id.replace(/\D/g, '')) % 4 || 0;
  const card = ALBUM_CARDS[i];
  return {
    id,
    title: card.title,
    subtitle: card.subtitle,
    artists: [ARTISTS[i]],
    thumbnail: card.thumbnail,
    tracks: TRACKS.filter((_, n) => n % 4 === i).map((t) => ({ ...t, thumbnail: card.thumbnail })),
    playlistId: `OLAK5uy_mock${i}`
  };
}

export function artist(id: string): ArtistPage {
  const a = ARTISTS.find((x) => x.id === id) ?? ARTISTS[0];
  return {
    id: a.id,
    name: a.name,
    description: `${a.name} là nghệ sĩ mẫu dùng để chạy thử giao diện Melo. Đây không phải dữ liệu thật từ YouTube Music.`,
    thumbnail: artistCover(a.id, a.name, ARTISTS.indexOf(a)),
    topTracks: TRACKS.filter((t) => t.artists[0].id === a.id).concat(TRACKS.slice(0, 4)),
    shelves: [
      { title: 'Album', items: ALBUM_CARDS.map((card) => ({ type: 'card', card })) },
      { title: 'Fan cũng thích', items: ARTIST_CARDS.filter((c) => c.id !== a.id).map((card) => ({ type: 'card', card })) }
    ]
  };
}

export function playlist(id: string): PlaylistPage {
  const card = PLAYLIST_CARDS.find((c) => c.id === id) ?? PLAYLIST_CARDS[0];
  return {
    id,
    title: card.title,
    subtitle: 'YouTube Music • 2026',
    description: 'Playlist mẫu để chạy thử giao diện.',
    thumbnail: card.thumbnail,
    tracks: [...TRACKS].sort((a, b) => (a.id + id).localeCompare(b.id + id)).slice(0, 15)
  };
}

export const LRC = `[00:00.50]♪
[00:03.00]Dòng lời mẫu thứ nhất của bài hát
[00:07.00]Dòng thứ hai chạy theo nhạc
[00:11.00]Chạm vào một dòng để tua tới đó
[00:15.00]Điệp khúc vang lên
[00:19.00]Lời bài hát tự cuộn vào giữa
[00:23.00]Và sáng lên khi đang hát
[00:27.00]Kết thúc bài mẫu`;
