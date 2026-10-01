// Kiểm tra đường dự phòng: tạo PO token bằng BotGuard (bgutils-js) rồi tải trọn file
// với các client đang bị giới hạn 1MB. Trong app iPhone, WebView chính là "trình duyệt" nên
// không cần jsdom; ở đây dùng jsdom để giả lập trên Node.
// Chạy: node scripts/probe-potoken.mjs [videoId]
import { JSDOM } from 'jsdom';
import { Innertube, Platform, UniversalCache } from 'youtubei.js';
import { BotGuardClient } from 'bgutils-js/botguard';
import { WebPoMinter } from 'bgutils-js/webpo';
import { GOOG_API_KEY, buildURL } from 'bgutils-js/utils';

Platform.shim.eval = async (data) => new Function(data.output)();

const videoId = process.argv[2] || 'qHpE45b4INk';
const REQUEST_KEY = 'O43z0dpjhgX20SCx4KAo';

const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
  url: 'https://www.youtube.com/',
  referrer: 'https://www.youtube.com/'
});
Object.assign(globalThis, { window: dom.window, document: dom.window.document, location: dom.window.location, origin: dom.window.origin });
if (!Reflect.has(globalThis, 'navigator')) Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator });

const bootstrap = await Innertube.create({ retrieve_player: false, cache: new UniversalCache(false) });
const visitorData = bootstrap.session.context.client.visitorData;

const challenge = await bootstrap.getAttestationChallenge('ENGAGEMENT_TYPE_UNBOUND');
const bg = challenge.bg_challenge;
if (!bg) throw new Error('no bg_challenge');
const interpreterUrl = bg.interpreter_url.private_do_not_access_or_else_trusted_resource_url_wrapped_value;
const interpreterJs = await (await fetch(`https:${interpreterUrl}`)).text();
new Function(interpreterJs)();

const botguard = await BotGuardClient.create({ program: bg.program, globalName: bg.global_name, globalObject: globalThis });
const webPoSignalOutput = [];
const botguardResponse = await botguard.snapshot({ webPoSignalOutput });
const itResponse = await fetch(buildURL('GenerateIT', true), {
  method: 'POST',
  headers: { 'content-type': 'application/json+protobuf', 'x-goog-api-key': GOOG_API_KEY, 'x-user-agent': 'grpc-web-javascript/0.1' },
  body: JSON.stringify([REQUEST_KEY, botguardResponse])
});
const itJson = await itResponse.json();
if (typeof itJson[0] !== 'string') throw new Error('no integrity token: ' + JSON.stringify(itJson).slice(0, 200));
const minter = await WebPoMinter.create({ integrityToken: itJson[0] }, webPoSignalOutput);
const sessionPoToken = await minter.mintAsWebsafeString(visitorData);
const contentPoToken = await minter.mintAsWebsafeString(videoId);
console.log('po tokens ok', sessionPoToken.length, contentPoToken.length);

const yt = await Innertube.create({
  lang: 'vi',
  location: 'VN',
  visitor_data: visitorData,
  po_token: sessionPoToken,
  cache: new UniversalCache(false)
});

for (const client of ['MWEB', 'YTMUSIC', 'WEB', 'IOS', 'TV_SIMPLY']) {
  try {
    const info = await yt.getBasicInfo(videoId, { client, po_token: contentPoToken });
    const format = info.chooseFormat({ type: 'audio', quality: 'best', format: 'mp4' });
    const url = await format.decipher(yt.session.player);
    const total = format.content_length ?? 0;
    let received = 0;
    let status = 0;
    for (let start = 0; start < total; start += 1024 * 1024) {
      const end = Math.min(start + 1024 * 1024 - 1, total - 1);
      const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
      status = res.status;
      if (!res.ok) break;
      received += (await res.arrayBuffer()).byteLength;
    }
    console.log(`${client.padEnd(10)} http=${status} ${received}/${total}`);
  } catch (err) {
    console.log(`${client.padEnd(10)} ERROR ${err?.message ?? err}`);
  }
}
process.exit(0);
