// Các hàm duyệt YouTube Music: trang chủ, tìm kiếm, album, nghệ sĩ, playlist, radio, lời bài hát.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { getBrowseSession } from './client';
import {
  bestThumbnail,
  playlistIdFromBrowseId,
  shelfFromSection,
  shelfItemFromNode,
  shelvesFromSections,
  textOf,
  trackFromListItem,
  trackFromPanelVideo,
  tracksOfShelf
} from './normalize';
import type {
  AlbumPage,
  ArtistPage,
  ArtistRef,
  PlaylistPage,
  SearchSuggestions,
  SearchType,
  Shelf,
  ShelfItem,
  Track
} from './types';

const HIDDEN_SHELF = /shorts/i;

export async function getHome(): Promise<Shelf[]> {
  const yt = await getBrowseSession();
  const shelves: Shelf[] = [];
  const home = await yt.music.getHomeFeed();
  shelves.push(...shelvesFromSections(home.sections as any));
  // Khách chưa đăng nhập chỉ có vài hàng → lấy thêm 1 trang tiếp và mục Khám phá.
  const [more, explore] = await Promise.allSettled([
    home.has_continuation ? home.getContinuation() : Promise.resolve(undefined),
    yt.music.getExplore()
  ]);
  if (more.status === 'fulfilled' && more.value) shelves.push(...shelvesFromSections(more.value.sections as any));
  if (explore.status === 'fulfilled') shelves.push(...shelvesFromSections(explore.value.sections as any));
  const seen = new Set<string>();
  return shelves.filter((s) => {
    if (!s.title || HIDDEN_SHELF.test(s.title) || seen.has(s.title)) return false;
    seen.add(s.title);
    return true;
  });
}

export async function search(query: string, type: SearchType): Promise<ShelfItem[]> {
  const yt = await getBrowseSession();
  const result = await yt.music.search(query, { type });
  // Không dùng result.songs/albums…: chúng so tên mục bằng tiếng Anh ("Songs") nên trả rỗng khi lang=vi.
  const shelf = (result.contents as any[] | undefined)?.find((c) => c?.type === 'MusicShelf');
  return ((shelf?.contents ?? []) as any[]).map(shelfItemFromNode).filter((x): x is ShelfItem => Boolean(x));
}

export async function getSuggestions(input: string): Promise<SearchSuggestions> {
  const yt = await getBrowseSession();
  const sections = await yt.music.getSearchSuggestions(input);
  const queries: string[] = [];
  const items: ShelfItem[] = [];
  for (const section of sections as any[]) {
    for (const node of section?.contents ?? []) {
      if (node?.type === 'SearchSuggestion' || node?.type === 'HistorySuggestion') {
        const q = textOf(node.suggestion);
        if (q) queries.push(q);
      } else {
        const item = shelfItemFromNode(node);
        if (item) items.push(item);
      }
    }
  }
  return { queries, items };
}

function artistsFromStrapline(header: any): ArtistRef[] {
  const runs: any[] = header?.strapline_text_one?.runs ?? [];
  const fromRuns = runs
    .filter((r) => r?.endpoint?.payload?.browseId)
    .map((r) => ({ id: r.endpoint.payload.browseId as string, name: textOf(r.text) }));
  if (fromRuns.length) return fromRuns;
  const text = textOf(header?.strapline_text_one) || textOf(header?.author?.name);
  return text ? [{ name: text }] : [];
}

export async function getAlbum(id: string): Promise<AlbumPage> {
  const yt = await getBrowseSession();
  const album: any = await yt.music.getAlbum(id);
  const header = album.header ?? {};
  const title = textOf(header.title);
  const thumbnail = bestThumbnail(header.thumbnail?.contents ?? header.thumbnails ?? album.background?.contents);
  const artists = artistsFromStrapline(header);
  const tracks = ((album.contents ?? []) as any[])
    .map((node) => trackFromListItem(node, { artists, album: { id, name: title }, thumbnail }))
    .filter((t): t is Track => Boolean(t))
    .map((t) => ({ ...t, isVideo: undefined, thumbnail }));
  const playlistId = album.url ? new URL(album.url).searchParams.get('list') ?? undefined : undefined;
  return { id, title, subtitle: textOf(header.subtitle), artists, thumbnail, tracks, playlistId };
}

export async function getArtist(id: string): Promise<ArtistPage> {
  const yt = await getBrowseSession();
  const artist: any = await yt.music.getArtist(id);
  const header = artist.header ?? {};
  const sections: any[] = artist.sections ?? [];
  const topShelf = sections.find((s) => s?.type === 'MusicShelf');
  const shelves = sections
    .filter((s) => s !== topShelf)
    .map(shelfFromSection)
    .filter((s): s is Shelf => Boolean(s));
  return {
    id,
    name: textOf(header.title),
    description: textOf(header.description) || undefined,
    thumbnail: bestThumbnail(header.thumbnail?.contents ?? header.thumbnail, 720),
    topTracks: tracksOfShelf(topShelf ? shelfFromSection(topShelf) : undefined),
    shelves
  };
}

const MAX_PLAYLIST_TRACKS = 500;

export async function getPlaylist(id: string): Promise<PlaylistPage> {
  const yt = await getBrowseSession();
  let page: any = await yt.music.getPlaylist(playlistIdFromBrowseId(id));
  const header = page.header ?? {};
  const tracks: Track[] = [];
  const collect = (p: any) => {
    for (const node of p.items ?? []) {
      const t = trackFromListItem(node);
      if (t) tracks.push(t);
    }
  };
  collect(page);
  while (page.has_continuation && tracks.length < MAX_PLAYLIST_TRACKS) {
    page = await page.getContinuation();
    collect(page);
  }
  const subtitleParts = [textOf(header.subtitle), textOf(header.second_subtitle)].filter(Boolean);
  return {
    id: playlistIdFromBrowseId(id),
    title: textOf(header.title),
    subtitle: subtitleParts.join(' • '),
    description: textOf(header.description?.description) || undefined,
    thumbnail: bestThumbnail(header.thumbnail?.contents ?? header.thumbnails) || tracks[0]?.thumbnail || '',
    tracks
  };
}

/** Radio / "phát tiếp" kiểu Spotify cho một bài (YouTube Music automix). */
export async function getUpNext(videoId: string): Promise<Track[]> {
  const yt = await getBrowseSession();
  const panel: any = await yt.music.getUpNext(videoId, true);
  return ((panel.contents ?? []) as any[])
    .map(trackFromPanelVideo)
    .filter((t): t is Track => Boolean(t));
}

export async function getYouTubeLyrics(videoId: string): Promise<{ text: string; source?: string } | undefined> {
  const yt = await getBrowseSession();
  const shelf: any = await yt.music.getLyrics(videoId);
  const text = textOf(shelf?.description);
  if (!text) return undefined;
  return { text: text.replace(/\r\n/g, '\n'), source: textOf(shelf?.footer) || undefined };
}

export { parseYouTubeLink } from './links';
