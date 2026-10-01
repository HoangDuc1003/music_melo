// Kiểm tra: tải trọn file bằng 1 request (cách @capacitor/file-transfer tải) có bị YouTube bóp/chặn không.
// Chạy: node scripts/probe-fullget.mjs [videoId]
import { Innertube, Platform, UniversalCache } from 'youtubei.js';
Platform.shim.eval = async (data) => new Function(data.output)();
const yt = await Innertube.create({ lang: 'vi', location: 'VN', cache: new UniversalCache(false) });
const info = await yt.getBasicInfo(process.argv[2] || 'qHpE45b4INk', { client: 'VISIONOS' });
const f = info.chooseFormat({ type: 'audio', quality: 'best', format: 'mp4' });
const url = await f.decipher(yt.session.player);
const total = Number(f.content_length);
const cases = [
  ['range-param', `${url}&range=0-${total - 1}`, {}],
  ['range-header', url, { Range: `bytes=0-${total - 1}` }],
  ['no-range', url, {}]
];
for (const [label, u, h] of cases) {
  const t = Date.now();
  try {
    const res = await fetch(u, { headers: h, signal: AbortSignal.timeout(25000) });
    const buf = res.ok ? await res.arrayBuffer() : new ArrayBuffer(0);
    console.log(label, res.status, buf.byteLength, '/', total, `${Date.now() - t}ms`);
  } catch (err) {
    console.log(label, 'FAILED', err.name, `${Date.now() - t}ms`);
  }
}
process.exit(0);
