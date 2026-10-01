import { Innertube, Platform, UniversalCache } from 'youtubei.js';
Platform.shim.eval = async (data) => new Function(data.output)();
const yt = await Innertube.create({ lang: 'vi', location: 'VN', cache: new UniversalCache(false), retrieve_player: false });
const s = await yt.music.search(process.argv[2] || 'Sơn Tùng M-TP', { type: process.argv[3] || 'song' });
console.log('filters', s.filters);
for (const shelf of s.contents ?? []) {
  console.log('shelf', shelf.type, shelf.title?.toString?.(), 'items', shelf.contents?.length);
  for (const it of (shelf.contents ?? []).slice(0, 3)) {
    console.log('  ', it.type, it.item_type, it.id, '|', it.title ?? it.name, '|', JSON.stringify(it.artists?.map(a => ({ n: a.name, id: a.channel_id }))), '|', it.album?.name, it.album?.id, '|', it.duration?.text, it.duration?.seconds, '|', it.thumbnail?.contents?.[0]?.url?.slice(0, 80));
  }
}
