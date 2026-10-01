// In cấu trúc dữ liệu thật của YouTube Music (trang chủ, album, nghệ sĩ, playlist, radio, lời, gợi ý)
// để viết src/youtube/normalize.ts cho đúng. Chạy: node scripts/probe-structures.mjs [home|album|artist|playlist|upnext|lyrics|suggest|explore]
import { Innertube, UniversalCache } from 'youtubei.js';

const what = process.argv[2] || 'home';
const yt = await Innertube.create({ lang: 'vi', location: 'VN', cache: new UniversalCache(false), retrieve_player: false });

function brief(node, depth = 0) {
  if (!node || depth > 3) return node?.type;
  const out = { type: node.type };
  for (const key of Object.keys(node)) {
    if (key === 'type') continue;
    const v = node[key];
    if (v == null || typeof v === 'function') continue;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[key] = typeof v === 'string' ? v.slice(0, 90) : v;
    else if (Array.isArray(v)) out[key] = `[${v.length}] ${v[0]?.type ?? typeof v[0]}`;
    else if (v.type) out[key] = brief(v, depth + 1);
    else if (v.text !== undefined) out[key] = `Text(${String(v.text).slice(0, 60)})`;
    else if (v.contents && Array.isArray(v.contents)) out[key] = `thumbs[${v.contents.length}] ${v.contents[0]?.url?.slice(0, 70)}`;
    else out[key] = Object.keys(v).slice(0, 8).join(',');
  }
  return out;
}
const show = (label, x) => console.log(label, JSON.stringify(brief(x), null, 1));

if (what === 'home') {
  const home = await yt.music.getHomeFeed();
  console.log('sections', home.sections?.length, home.sections?.map((s) => `${s.type}:${s.header?.title?.toString?.()}`));
  const first = home.sections?.[0];
  show('section0', first);
  show('item0', first?.contents?.[0]);
  const second = home.sections?.[1];
  show('section1-item0', second?.contents?.[0]);
}
if (what === 'explore') {
  const ex = await yt.music.getExplore();
  console.log('explore sections', ex.sections?.map((s) => `${s.type}:${s.header?.title?.toString?.()}`));
  show('top_buttons0', ex.top_buttons?.[0]);
  show('section1-item0', ex.sections?.[1]?.contents?.[0]);
}
if (what === 'album') {
  const album = await yt.music.getAlbum(process.argv[3] || 'MPREb_wu5shzfVUs3');
  show('header', album.header);
  show('track0', album.contents?.[0]);
  console.log('tracks', album.contents?.length, 'url', album.url, 'sections', album.sections?.length);
}
if (what === 'artist') {
  const artist = await yt.music.getArtist(process.argv[3] || 'UC3muIvzjhubNpJ4Pn_0kCQw');
  show('header', artist.header);
  console.log('sections', artist.sections?.map((s) => `${s.type}:${s.title?.toString?.() ?? s.header?.title?.toString?.()}:${s.contents?.length}`));
  for (const s of artist.sections ?? []) show(`first item of ${s.type}`, s.contents?.[0]);
}
if (what === 'playlist') {
  const pl = await yt.music.getPlaylist(process.argv[3] || 'RDCLAK5uy_lJ8xZWiZj2GCw7MArjakb6b0zfvqwldps');
  show('header', pl.header);
  show('item0', pl.items?.[0]);
  console.log('items', pl.items?.length, 'has_continuation', pl.has_continuation);
}
if (what === 'upnext') {
  const panel = await yt.music.getUpNext(process.argv[3] || 'qHpE45b4INk', true);
  console.log('panel', panel.type, panel.title, panel.playlist_id, 'contents', panel.contents?.length, panel.contents?.slice(0, 3).map((c) => c.type));
  show('item0', panel.contents?.[0]);
  show('item1', panel.contents?.[1]);
}
if (what === 'lyrics') {
  const lyr = await yt.music.getLyrics(process.argv[3] || 'qHpE45b4INk');
  show('lyrics', lyr);
  console.log(String(lyr?.description?.toString?.() ?? '').slice(0, 200));
}
if (what === 'suggest') {
  const sug = await yt.music.getSearchSuggestions(process.argv[3] || 'son tung');
  for (const sec of sug) {
    console.log('section', sec.type, sec.contents?.length);
    show('  first', sec.contents?.[0]);
  }
}
