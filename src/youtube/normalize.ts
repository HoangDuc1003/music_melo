// Chuyển các node của youtubei.js sang kiểu gọn của app.
// Viết "phòng thủ" (dùng any + kiểm tra từng trường) vì YouTube hay đổi cấu trúc.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { parseDuration } from '@/lib/format';
import type { ArtistRef, Card, CardKind, Shelf, ShelfItem, Track } from './types';

type Node = any;

export function textOf(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  const anyValue = value as Node;
  if (typeof anyValue.toString === 'function' && anyValue.toString !== Object.prototype.toString) {
    const s = anyValue.toString();
    if (typeof s === 'string' && s !== '[object Object]') return s;
  }
  if (typeof anyValue.text === 'string') return anyValue.text;
  return '';
}

const GOOGLE_IMAGE = /(^|\.)googleusercontent\.com$/;

/** Ảnh của googleusercontent đổi kích thước bằng hậu tố "=w120-h120-…"; đổi sang ảnh nét hơn. */
export function upscaleThumbnail(url: string, size = 544): string {
  if (!url) return url;
  try {
    const parsed = new URL(url);
    if (!GOOGLE_IMAGE.test(parsed.hostname)) return url;
    const base = url.replace(/=(w\d+-h\d+|s\d+)[^/]*$/, '');
    return `${base}=w${size}-h${size}-l90-rj`;
  } catch {
    return url;
  }
}

/** Chọn ảnh lớn nhất trong danh sách thumbnail rồi phóng to nếu là ảnh googleusercontent. */
export function bestThumbnail(thumbs: unknown, size = 544): string {
  const list: Node[] = Array.isArray(thumbs)
    ? thumbs
    : Array.isArray((thumbs as Node)?.contents)
      ? (thumbs as Node).contents
      : [];
  let best: Node | undefined;
  for (const t of list) {
    if (!t?.url) continue;
    if (!best || (t.width ?? 0) * (t.height ?? 0) > (best.width ?? 0) * (best.height ?? 0)) best = t;
  }
  const url: string = best?.url ?? '';
  return upscaleThumbnail(url.startsWith('//') ? `https:${url}` : url, size);
}

export function videoThumbnail(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

function toArtistRefs(list: unknown): ArtistRef[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((a: Node) => ({ id: a?.channel_id || a?.endpoint?.payload?.browseId || undefined, name: textOf(a?.name) }))
    .filter((a) => a.name);
}

/** Bỏ VL ở đầu id playlist (browseId "VLPL…" → "PL…"). */
export { playlistIdFromBrowseId } from './links';

function durationOf(node: Node): number {
  const d = node?.duration;
  if (!d) return 0;
  if (typeof d === 'number') return d;
  if (typeof d.seconds === 'number' && d.seconds > 0) return d.seconds;
  return parseDuration(textOf(d.text ?? d));
}

function cleanTitle(title: string): string {
  return title.trim();
}

/** MusicResponsiveListItem (bài/video) → Track */
export function trackFromListItem(node: Node, fallback?: Partial<Track>): Track | undefined {
  const id: string | undefined = node?.id ?? node?.video_id ?? node?.endpoint?.payload?.videoId;
  if (!id || id.length !== 11) return undefined;
  let artists = toArtistRefs(node.artists);
  if (!artists.length) artists = toArtistRefs(node.authors);
  if (!artists.length && node.author) artists = toArtistRefs([node.author]);
  if (!artists.length && fallback?.artists) artists = fallback.artists;
  const album = node.album?.name ? { id: node.album.id, name: textOf(node.album.name) } : fallback?.album;
  const thumbs = node.thumbnail?.contents ?? node.thumbnails ?? node.thumbnail;
  const isVideo = node.item_type === 'video';
  return {
    id,
    title: cleanTitle(textOf(node.title) || textOf(node.name)),
    artists,
    album,
    duration: durationOf(node) || fallback?.duration || 0,
    thumbnail: bestThumbnail(thumbs) || fallback?.thumbnail || videoThumbnail(id),
    isVideo: isVideo || undefined
  };
}

/** PlaylistPanelVideo (hàng chờ/radio) → Track */
export function trackFromPanelVideo(node: Node): Track | undefined {
  if (node?.type === 'PlaylistPanelVideoWrapper') node = node.primary;
  const id: string | undefined = node?.video_id;
  if (!id) return undefined;
  let artists = toArtistRefs(node.artists);
  if (!artists.length && node.author) artists = [{ name: textOf(node.author) }];
  return {
    id,
    title: cleanTitle(textOf(node.title)),
    artists,
    album: node.album?.name ? { id: node.album.id, name: textOf(node.album.name) } : undefined,
    duration: durationOf(node),
    thumbnail: bestThumbnail(node.thumbnail) || videoThumbnail(id)
  };
}

function cardKind(itemType: string | undefined): CardKind | undefined {
  if (itemType === 'album') return 'album';
  if (itemType === 'playlist') return 'playlist';
  if (itemType === 'artist' || itemType === 'library_artist') return 'artist';
  return undefined;
}

/** MusicTwoRowItem / MusicResponsiveListItem (album, playlist, nghệ sĩ) → Card */
export function cardFromNode(node: Node): Card | undefined {
  const kind = cardKind(node?.item_type);
  const id: string | undefined = node?.id ?? node?.endpoint?.payload?.browseId;
  if (!kind || !id) return undefined;
  const title = textOf(node.title) || textOf(node.name);
  let subtitle = textOf(node.subtitle);
  if (!subtitle) {
    const parts: string[] = [];
    if (kind === 'album') parts.push('Album');
    if (kind === 'playlist') parts.push('Playlist');
    const by = toArtistRefs(node.artists).map((a) => a.name);
    if (!by.length && node.author?.name) by.push(textOf(node.author.name));
    if (by.length) parts.push(by.join(', '));
    if (node.year) parts.push(String(node.year));
    if (kind === 'artist') parts.push('Nghệ sĩ');
    subtitle = parts.join(' • ');
  }
  const thumbs = Array.isArray(node.thumbnail) ? node.thumbnail : node.thumbnail?.contents;
  return { kind, id, title, subtitle, thumbnail: bestThumbnail(thumbs) };
}

/** Một node bất kỳ trong shelf → ShelfItem (bài hát hoặc thẻ album/playlist/nghệ sĩ). */
export function shelfItemFromNode(node: Node): ShelfItem | undefined {
  if (!node) return undefined;
  const itemType: string | undefined = node.item_type;
  if (node.type === 'MusicTwoRowItem' && (itemType === 'song' || itemType === 'video')) {
    const id = node.id ?? node.endpoint?.payload?.videoId;
    if (!id) return undefined;
    const thumbs = node.thumbnail;
    return {
      type: 'track',
      track: {
        id,
        title: textOf(node.title),
        artists: toArtistRefs(node.artists).length
          ? toArtistRefs(node.artists)
          : node.author
            ? toArtistRefs([node.author])
            : textOf(node.subtitle)
              ? [{ name: textOf(node.subtitle).split(' • ').pop() ?? '' }]
              : [],
        duration: 0,
        thumbnail: bestThumbnail(thumbs) || videoThumbnail(id),
        isVideo: itemType === 'video' || undefined
      }
    };
  }
  if (itemType === 'song' || itemType === 'video' || itemType === 'non_music_track') {
    const track = trackFromListItem(node);
    return track ? { type: 'track', track } : undefined;
  }
  if (node.type === 'PlaylistPanelVideo' || node.type === 'PlaylistPanelVideoWrapper') {
    const track = trackFromPanelVideo(node);
    return track ? { type: 'track', track } : undefined;
  }
  const card = cardFromNode(node);
  return card ? { type: 'card', card } : undefined;
}

/** MusicCarouselShelf / MusicShelf → Shelf */
export function shelfFromSection(section: Node): Shelf | undefined {
  const title = textOf(section?.header?.title) || textOf(section?.title);
  const contents: Node[] = section?.contents ?? [];
  const items = contents.map(shelfItemFromNode).filter((x): x is ShelfItem => Boolean(x));
  if (!items.length) return undefined;
  return { title, items };
}

export function shelvesFromSections(sections: Node[] | undefined): Shelf[] {
  return (sections ?? [])
    .filter((s) => s?.type === 'MusicCarouselShelf' || s?.type === 'MusicShelf' || s?.type === 'Grid')
    .map(shelfFromSection)
    .filter((s): s is Shelf => Boolean(s));
}

export function tracksOfShelf(shelf: Shelf | undefined): Track[] {
  return (shelf?.items ?? []).flatMap((i) => (i.type === 'track' ? [i.track] : []));
}
