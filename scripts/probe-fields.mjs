import { Innertube, UniversalCache } from 'youtubei.js';
const yt = await Innertube.create({ lang: 'vi', location: 'VN', cache: new UniversalCache(false), retrieve_player: false });
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o?.[k] !== undefined).map((k) => [k, o[k]]));
const home = await yt.music.getHomeFeed();
console.log('home has_continuation', home.has_continuation);
if (home.has_continuation) {
  const more = await home.getContinuation();
  console.log('continuation sections', more.sections?.map((s) => `${s.type}:${s.header?.title?.toString?.()}`));
}
const two = home.sections?.[1]?.contents?.[0];
console.log('TwoRowItem', JSON.stringify(pick(two, ['id', 'item_type', 'title', 'subtitle', 'thumbnail', 'artists', 'author', 'year', 'song_count']), null, 1).slice(0, 1500));
const song = home.sections?.[0]?.contents?.[0];
console.log('Song', JSON.stringify(pick(song, ['id', 'item_type', 'title', 'artists', 'authors', 'album', 'duration', 'subtitle', 'thumbnail', 'badges']), null, 1).slice(0, 1500));
const s = await yt.music.search('Lạc Trôi', { type: 'album' });
const albumItem = s.contents?.find((c) => c.type === 'MusicShelf')?.contents?.[0];
console.log('Album search item', JSON.stringify(pick(albumItem, ['id', 'item_type', 'title', 'artists', 'author', 'year', 'subtitle', 'thumbnail']), null, 1).slice(0, 1200));
const s2 = await yt.music.search('Sơn Tùng', { type: 'artist' });
const artistItem = s2.contents?.find((c) => c.type === 'MusicShelf')?.contents?.[0];
console.log('Artist search item', JSON.stringify(pick(artistItem, ['id', 'item_type', 'name', 'subtitle', 'subscribers', 'thumbnail']), null, 1).slice(0, 800));
const s3 = await yt.music.search('nhạc chill', { type: 'playlist' });
const plItem = s3.contents?.find((c) => c.type === 'MusicShelf')?.contents?.[0];
console.log('Playlist search item', JSON.stringify(pick(plItem, ['id', 'item_type', 'title', 'author', 'item_count', 'subtitle', 'thumbnail']), null, 1).slice(0, 900));
const s4 = await yt.music.search('Sơn Tùng');
console.log('unfiltered shelves', s4.contents?.map((c) => `${c.type}:${c.title?.toString?.() ?? c.header?.title?.toString?.()}`));
