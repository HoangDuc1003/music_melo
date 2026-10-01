// Dữ liệu mẫu cho `npm run dev:mock` (chỉ dùng khi phát triển; không có trong bản build thật).
import type { AlbumPage, ArtistPage, Card, PlaylistPage, Shelf, Track } from '../types';

const COLORS = [
  ['#e8115b', '#5f0a2b'],
  ['#1e3264', '#4f8bff'],
  ['#8d67ab', '#2b1a3d'],
  ['#e1118c', '#ff9a3c'],
  ['#148a08', '#0c3d07'],
  ['#dc148c', '#3a0a26'],
  ['#509bf5', '#0b2a54'],
  ['#e13300', '#521300'],
  ['#7358ff', '#1b1240'],
  ['#ba5d07', '#3d1e02']
];

/** Ảnh bìa SVG có chữ cái đầu, màu theo id. */
export function cover(seed: string, label: string, round = false): string {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  const [a, b] = COLORS[Math.abs(hash) % COLORS.length];
  const initials = label
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase();
  const shape = round ? '<circle cx="150" cy="150" r="150" fill="url(#g)"/>' : '<rect width="300" height="300" fill="url(#g)"/>';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>${shape}<text x="150" y="175" font-family="sans-serif" font-size="96" font-weight="700" fill="rgba(255,255,255,0.85)" text-anchor="middle">${initials}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

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
    thumbnail: cover(id, title)
  };
});

export const ARTIST_CARDS: Card[] = ARTISTS.map((a) => ({ kind: 'artist', id: a.id, title: a.name, subtitle: 'Nghệ sĩ', thumbnail: cover(a.id, a.name, true) }));

export const ALBUM_CARDS: Card[] = [0, 1, 2, 3].map((i) => {
  const name = `Album ${['Mùa Hạ', 'Thành Phố', 'Hành Trình', 'Kỷ Niệm'][i]}`;
  return { kind: 'album', id: `MPREb_mock${i}`, title: name, subtitle: `Album • ${ARTISTS[i].name} • 202${i}`, thumbnail: cover(`album${i}`, name) };
});

export const PLAYLIST_CARDS: Card[] = ['Nhạc Việt Hot', 'Chill Cuối Tuần', 'Lofi Học Bài', 'Nhạc Đi Tàu'].map((name, i) => ({
  kind: 'playlist',
  id: `PLmock${String(i).padStart(10, '0')}`,
  title: name,
  subtitle: 'Playlist • YouTube Music',
  thumbnail: cover(`pl${i}`, name)
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
    thumbnail: cover(a.id, a.name),
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
