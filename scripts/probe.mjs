// Chẩn đoán nhanh trên PC: client YouTube nào còn trả link audio dùng được.
// Chạy: node scripts/probe.mjs [từ khoá]
// Dùng khi YouTube thay đổi để biết nên ưu tiên client nào trong src/youtube/stream.ts.
import { Innertube, Platform, UniversalCache } from 'youtubei.js';

Platform.shim.eval = async (data) => new Function(data.output)();

const query = process.argv.slice(2).join(' ') || 'Sơn Tùng M-TP';
const CLIENTS = ['YTMUSIC', 'IOS', 'ANDROID_VR', 'TV', 'TV_SIMPLY', 'WEB_EMBEDDED', 'MWEB', 'WEB', 'ANDROID', 'VISIONOS'];

const yt = await Innertube.create({ lang: 'vi', location: 'VN', cache: new UniversalCache(false) });
console.log('player id:', yt.session.player?.player_id);

const search = await yt.music.search(query, { type: 'song' });
const shelf = search.contents?.find((c) => c.type === "MusicShelf");
const songs = (shelf?.contents ?? []).filter((s) => s.id).slice(0, 2);
console.log('songs:', songs.map((s) => `${s.id} | ${s.title} | ${s.artists?.map((a) => a.name).join(', ')}`));

for (const song of songs) {
  for (const client of CLIENTS) {
    const started = Date.now();
    try {
      const info = await yt.getBasicInfo(song.id, { client });
      const status = info.playability_status?.status;
      if (status !== 'OK') {
        console.log(`${song.id} ${client.padEnd(12)} playability=${status} ${info.playability_status?.reason ?? ''}`);
        continue;
      }
      const format = info.chooseFormat({ type: 'audio', quality: 'best', format: 'mp4' });
      const url = await format.decipher(yt.session.player);
      const res = await fetch(url, { headers: { Range: 'bytes=0-1023' } });
      console.log(`${song.id} ${client.padEnd(12)} itag=${format.itag} mime=${format.mime_type.split(';')[0]} http=${res.status} ${Date.now() - started}ms`);
    } catch (err) {
      console.log(`${song.id} ${client.padEnd(12)} ERROR ${err?.message ?? err}`);
    }
  }
}
