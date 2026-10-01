// Kiểm tra tải trọn file audio với User-Agent giống AVPlayer trên iPhone.
// Chạy: node scripts/probe-download.mjs [videoId]
import { Innertube, Platform, UniversalCache } from 'youtubei.js';

Platform.shim.eval = async (data) => new Function(data.output)();

const videoId = process.argv[2] || 'qHpE45b4INk';
const CLIENTS = ['IOS', 'VISIONOS', 'ANDROID_VR', 'TV_SIMPLY', 'MWEB', 'YTMUSIC'];
const AVPLAYER_UA = 'AppleCoreMedia/1.0.0.22A3354 (iPhone; U; CPU OS 18_0 like Mac OS X; vi_vn)';

const yt = await Innertube.create({ lang: 'vi', location: 'VN', cache: new UniversalCache(false) });

for (const client of CLIENTS) {
  try {
    const info = await yt.getBasicInfo(videoId, { client });
    const format = info.chooseFormat({ type: 'audio', quality: 'best', format: 'mp4' });
    const url = await format.decipher(yt.session.player);
    const u = new URL(url);
    const started = Date.now();
    // Tải theo từng đoạn 1MB như AVPlayer (Range), đếm tổng byte.
    let received = 0;
    let status = 0;
    const total = format.content_length ?? 0;
    for (let start = 0; start < total; start += 1024 * 1024) {
      const end = Math.min(start + 1024 * 1024 - 1, total - 1);
      const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}`, 'User-Agent': AVPLAYER_UA } });
      status = res.status;
      if (!res.ok) break;
      received += (await res.arrayBuffer()).byteLength;
    }
    const secs = (Date.now() - started) / 1000;
    console.log(
      `${client.padEnd(11)} http=${status} ${received}/${total} bytes in ${secs.toFixed(1)}s` +
        ` expire=${new Date(Number(u.searchParams.get('expire')) * 1000).toISOString()}` +
        ` n=${u.searchParams.has('n')} ip=${u.searchParams.has('ip')} pot=${u.searchParams.has('pot')} c=${u.searchParams.get('c')}`
    );
  } catch (err) {
    console.log(`${client.padEnd(11)} ERROR ${err?.message ?? err}`);
  }
}
