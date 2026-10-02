// Chạy thử Melo bản web: `npm run build:web && npx vite preview --mode web --outDir dist-web --port 4175`, rồi
// `npm i --no-save playwright && CHROMIUM_PATH=… node scripts/web-smoke.mjs`. YouTube (Data API + trình phát nhúng), Audius và
// Jamendo được giả bằng context.route.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
mkdirSync('web-smoke-shots', { recursive: true });
const BASE = 'http://localhost:4175/';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://localhost:4175' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && !/ERR_|Failed to load resource/.test(m.text()) && errors.push(`console: ${m.text()}`));
const v = (l) => l.filter({ visible: true }).first();
const wait = (ms) => page.waitForTimeout(ms);
const ok = (s) => console.log('✓', s);
const shot = (name) => page.screenshot({ path: `web-smoke-shots/${name}.png` });

// WAV 1 giây làm "bài nhạc"
function wav(seconds = 1, rate = 8000) {
  const n = seconds * rate;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 8000), 44 + i * 2);
  return buf;
}
const AUDIO = wav(2);
const cors = { 'access-control-allow-origin': '*' };
const track = (id, name, extra = {}) => ({
  id: String(id), name, duration: 2, artist_id: '7', artist_name: 'Ban nhạc CC', album_id: '9', album_name: 'Chiều Lounge',
  image: '', audio: `https://prod-1.storage.jamendo.com/?trackid=${id}&format=mp32`,
  audiodownload: `https://prod-1.storage.jamendo.com/download/track/${id}/mp32/`, audiodownload_allowed: true, ...extra
});
const TRACKS = [track(1, 'Gió Chiều'), track(2, 'Mưa Đêm Lounge'), track(3, 'Sáng Cà Phê', { audiodownload_allowed: false })];
let jamendoCalls = 0;
await context.route('https://api.jamendo.com/**', (route) => {
  jamendoCalls += 1;
  const url = new URL(route.request().url());
  const path = url.pathname.replace('/v3.0', '');
  let results = [];
  if (url.searchParams.get('client_id') !== 'abcd1234') {
    return route.fulfill({ headers: cors, contentType: 'application/json', body: JSON.stringify({ headers: { status: 'failed', code: 5, error_message: 'Invalid client_id' }, results: [] }) });
  }
  if (path === '/tracks/') results = url.searchParams.get('id') ? TRACKS.filter((t) => t.id === url.searchParams.get('id')) : TRACKS;
  else if (path === '/albums/') results = [{ id: '9', name: 'Chiều Lounge', artist_id: '7', artist_name: 'Ban nhạc CC', image: '' }];
  else if (path === '/artists/') results = [{ id: '7', name: 'Ban nhạc CC', image: '' }];
  else if (path === '/albums/tracks/') results = [{ id: '9', name: 'Chiều Lounge', artist_id: '7', artist_name: 'Ban nhạc CC', image: '', releasedate: '2025-01-01', tracks: TRACKS.slice(0, 2).map(({ artist_id, artist_name, album_id, album_name, ...t }) => t) }];
  else if (path === '/autocomplete/') results = [{ tracks: ['gió chiều'], artists: ['ban nhạc cc'] }];
  return route.fulfill({ headers: cors, contentType: 'application/json', body: JSON.stringify({ headers: { status: 'success', code: 0 }, results }) });
});
await context.route('https://prod-1.storage.jamendo.com/**', (route) => route.fulfill({ headers: cors, contentType: 'audio/wav', body: AUDIO }));

// Audius: {data: …}. /stream thật chuyển hướng (302) sang máy chủ nội dung, nhưng Playwright không chặn được request
// sau chuyển hướng (đi ra mạng thật) → ở đây /stream trả thẳng file nhạc.
const recent = new Date(Date.now() - 2 * 24 * 3600_000).toISOString();
const auUser = { id: 'u1', name: 'DJ Sài Gòn', handle: 'djsg', follower_count: 1200, profile_picture: null };
const auTrack = (id, title, extra = {}) => ({ id, title, duration: 2, genre: 'Lo-Fi', release_date: recent, play_count: 10, artwork: null, user: auUser, is_streamable: true, access: { stream: true }, ...extra });
const AU_TRACKS = [auTrack('A1', 'Phố Đêm Lo-fi'), auTrack('A2', 'Đêm Sài Gòn Mới'), auTrack('A3', 'Bài trả phí', { is_stream_gated: true, access: { stream: false } })];
const AU_ALBUM = { id: 'P1', playlist_name: 'Đêm Sài Gòn', is_album: true, artwork: null, user: auUser, release_date: recent };
let audiusCalls = 0;
await context.route('https://api.audius.co/**', (route) => {
  audiusCalls += 1;
  const url = new URL(route.request().url());
  const path = url.pathname.replace('/v1', '');
  if (url.searchParams.get('app_name') !== 'Melo') return route.fulfill({ status: 400, headers: cors, body: '{}' });
  const stream = path.match(/^\/tracks\/(\w+)\/stream$/);
  if (stream) return route.fulfill({ headers: cors, contentType: 'audio/mpeg', body: AUDIO });
  let data = AU_TRACKS;
  if (path === '/playlists/trending' || path === '/playlists/search') data = [AU_ALBUM];
  else if (path === '/playlists/P1') data = [AU_ALBUM];
  else if (path === '/playlists/P1/tracks') data = AU_TRACKS.slice(0, 2);
  else if (path === '/users/search' || path === '/users/u1/related') data = [auUser];
  else if (path === '/users/u1') data = auUser;
  else if (path.startsWith('/tracks/') && !['/tracks/trending', '/tracks/search'].includes(path)) data = AU_TRACKS.find((t) => path === `/tracks/${t.id}`);
  return route.fulfill({ headers: cors, contentType: 'application/json', body: JSON.stringify({ data }) });
});
// YouTube: Data API giả + trình phát nhúng giả (iframe_api định nghĩa window.YT, khung /embed là trang trống).
const YT_KEY = `AIza${'S'.repeat(35)}`;
const ytVideo = (id, title) => ({
  id, snippet: { title, channelTitle: 'Sơn Tùng M-TP Official', channelId: 'UCson', thumbnails: {} },
  contentDetails: { duration: 'PT2S' }, status: { embeddable: true, privacyStatus: 'public' }
});
const YT_VIDEOS = Object.fromEntries([ytVideo('aaaaaaaaaaa', 'Lạc Trôi | Official MV'), ytVideo('bbbbbbbbbbb', 'Chúng Ta Của Hiện Tại'), ytVideo('ccccccccccc', 'Hậu trường quay MV')].map((v) => [v.id, v]));
let youtubeCalls = 0;
await context.route('https://www.googleapis.com/youtube/v3/**', (route) => {
  youtubeCalls += 1;
  const url = new URL(route.request().url());
  const json = (body, status = 200) => route.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
  if (url.searchParams.get('key') !== YT_KEY) return json({ error: { code: 400, message: 'API key not valid', errors: [{ reason: 'keyInvalid' }] } }, 400);
  const path = url.pathname.replace('/youtube/v3', '');
  if (path === '/videos' && url.searchParams.get('chart')) return json({ items: [YT_VIDEOS.aaaaaaaaaaa, YT_VIDEOS.bbbbbbbbbbb] });
  if (path === '/videos') return json({ items: url.searchParams.get('id').split(',').map((id) => YT_VIDEOS[id]).filter(Boolean) });
  if (path === '/search') return json({ items: [{ id: { videoId: url.searchParams.get('videoCategoryId') ? 'aaaaaaaaaaa' : 'ccccccccccc' } }] });
  return json({ items: [] });
});
const FAKE_IFRAME_API = `window.YT = { Player: class {
  constructor(frame, { events }) { this.events = events; this.t = 0; setTimeout(() => events.onReady(), 50); }
  set(state) { this.events.onStateChange({ data: state }); }
  loadVideoById() { setTimeout(() => this.set(1), 80); }
  cueVideoById() { this.set(5); }
  playVideo() { setTimeout(() => this.set(1), 50); }
  pauseVideo() { this.set(2); }
  stopVideo() {}
  seekTo(t) { this.t = t; }
  getCurrentTime() { return this.t; }
  getDuration() { return 2; }
} };
window.onYouTubeIframeAPIReady && window.onYouTubeIframeAPIReady();`;
await context.route('https://www.youtube.com/iframe_api', (route) => route.fulfill({ contentType: 'text/javascript', body: FAKE_IFRAME_API }));
await context.route('https://www.youtube.com/embed/**', (route) => route.fulfill({ contentType: 'text/html', body: '<body style="margin:0;background:#400;color:#fff">YouTube giả</body>' }));
// Trang chuyển đổi (yt2…) giả.
await context.route('https://yt2.example.com/**', (route) => route.fulfill({ contentType: 'text/html', body: '<p>Trang chuyển đổi giả</p>' }));
await context.route('https://lrclib.net/**', (route) => route.fulfill({ status: 404, headers: cors, body: '{}' }));

const playing = () => page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.getAttribute('aria-label') === 'Tạm dừng'), null, { timeout: 10000 });
const downloadedVisible = (n) =>
  page.waitForFunction((min) => [...document.querySelectorAll('[aria-label="Đã tải"]')].filter((e) => e.checkVisibility()).length >= min, n, { timeout: 15000 });

await page.goto(BASE);
await v(page.getByText('Thịnh hành tuần này')).waitFor({ timeout: 10000 });
await v(page.getByText('Mới phát hành', { exact: true })).waitFor();
await v(page.getByText('Nhạc từ')).waitFor();
if (await page.getByText('Bài trả phí').filter({ visible: true }).count()) throw new Error('bài trả phí của Audius không được hiện');
if (await page.getByText(/Client ID/).filter({ visible: true }).count()) throw new Error('trang chủ không được đòi Client ID');
await shot('1-trang-chu-audius');
ok('mở lần đầu: trang chủ có nhạc Audius ngay (không cần Client ID), có hàng Mới phát hành, bỏ bài trả phí');

await v(page.getByText('Phố Đêm Lo-fi')).click();
await playing();
ok('phát bài từ Audius (đang phát)');

await v(page.getByText('Đêm Sài Gòn', { exact: true })).click();
await v(page.getByLabel('Tải tất cả')).click();
await downloadedVisible(2);
await shot('2-album-audius-da-tai');
ok('tải cả album Audius về máy');

await v(page.getByRole('button', { name: 'Trang chủ', exact: true })).click();
await wait(300);
await v(page.getByRole('button', { name: 'Cài đặt' })).click();
await v(page.getByText('Jamendo (tuỳ chọn)')).click();
await v(page.getByLabel('Client ID Jamendo')).fill('abcd1234');
await v(page.getByRole('button', { name: 'Lưu', exact: true })).click();
await v(page.getByText(/Đã có Client ID/)).waitFor();
if (await page.getByText('Spotify').filter({ visible: true }).count()) throw new Error('bản web không được có mục Spotify');
await v(page.getByText('YouTube (tuỳ chọn)')).click();
await v(page.getByLabel('Khoá API YouTube')).fill(YT_KEY);
await v(page.getByRole('button', { name: 'Lưu', exact: true })).click();
await v(page.getByText(/Đã có khoá API/)).waitFor();
await v(page.getByText('Trang tải MP3 từ YouTube')).click();
await v(page.getByLabel('Trang tải MP3 từ YouTube')).fill('https://yt2.example.com/?url={url}');
await v(page.getByRole('button', { name: 'Lưu', exact: true })).click();
await v(page.getByText(/yt2\.example\.com • menu/)).waitFor();
await shot('3-cai-dat');
ok('Cài đặt: Audius luôn bật; nhập Client ID Jamendo, khoá API YouTube, trang tải MP3 (tuỳ chọn); không có mục Spotify');

await v(page.getByRole('button', { name: 'Trang chủ', exact: true })).click();
await wait(300);
await v(page.getByRole('button', { name: 'Trang chủ', exact: true })).click();
await v(page.getByText('Thịnh hành trên Jamendo')).waitFor({ timeout: 10000 });
await v(page.getByText('Nhạc thịnh hành trên YouTube')).waitFor();
await shot('4-trang-chu-ba-nguon');
ok('trang chủ có thêm các hàng YouTube (thịnh hành) và Jamendo');

// Video YouTube: phát trong khung trên cùng, trang bị đẩy xuống (không che video), không có "Tải về".
await v(page.getByText('Lạc Trôi | Official MV')).click();
await playing();
await page.locator('#melo-video-slot iframe').waitFor();
const layout = () =>
  page.evaluate(() => {
    const stage = document.getElementById('melo-video-slot').closest('.fixed').getBoundingClientRect();
    const main = document.querySelector('main').getBoundingClientRect();
    return { stageBottom: Math.round(stage.bottom), mainTop: Math.round(main.top), videoH: getComputedStyle(document.documentElement).getPropertyValue('--video-h') };
  });
let box = await layout();
if (box.stageBottom < 200 || box.mainTop < box.stageBottom - 1) throw new Error(`khung video che trang: ${JSON.stringify(box)}`);
await shot('5-video-youtube');
ok(`phát video YouTube trong khung trên cùng (cao ${box.stageBottom}px), trang nằm dưới khung`);

await v(page.locator('.rounded-lg.shadow-lg')).click();
await v(page.getByRole('button', { name: 'Tuỳ chọn' })).click();
await v(page.getByText('Phát tiếp')).waitFor();
if (await page.getByText('Tải về', { exact: true }).filter({ visible: true }).count()) throw new Error('video YouTube không được có "Tải về"');
const sheetTop = await page.evaluate(() => Math.round(document.querySelector('[aria-label="Tuỳ chọn bài hát"]').getBoundingClientRect().top));
if (sheetTop < box.stageBottom - 1) throw new Error('bảng chọn che video');
await shot('6-video-menu');
await page.keyboard.press('Escape');
await page.mouse.click(195, box.stageBottom + 20);
await wait(400);
await v(page.getByRole('button', { name: 'Thu nhỏ' })).click();
await wait(400);
ok('trình phát to và bảng chọn nằm dưới khung video; video YouTube không có "Tải về"');

await v(page.getByText('Ẩn video')).click();
await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--video-h').trim() === '0px', null, { timeout: 5000 });
await v(page.getByRole('button', { name: 'Phát', exact: true })).waitFor();
ok('Ẩn video: dừng phát rồi mới thu khung');

await v(page.getByText('Gió Chiều')).click();
await playing();
ok('phát bài từ Jamendo (đang phát)');

// Tìm kiếm: bài hát từ cả ba nguồn; tab Video chỉ có YouTube
await v(page.getByRole('button', { name: 'Tìm kiếm', exact: true })).click();
await v(page.getByPlaceholder(/Bạn muốn nghe gì/)).fill('gió');
await page.keyboard.press('Enter');
await v(page.getByText('Mưa Đêm Lounge')).waitFor();
await v(page.getByText('Đêm Sài Gòn Mới')).waitFor();
await v(page.getByText('Lạc Trôi | Official MV')).waitFor();
await v(page.getByRole('button', { name: 'Video', exact: true })).click();
await v(page.getByText('Hậu trường quay MV')).waitFor();
ok('tìm kiếm: kết quả của YouTube, Audius và Jamendo; tab Video có video YouTube');

// Tải MP3 qua trang chuyển đổi: mở trang kèm link video, copy sẵn link, bài vào danh sách chờ file.
async function downloadViaConverter(title, videoId) {
  const popup = context.waitForEvent('page');
  await v(page.getByLabel(`Tuỳ chọn cho ${title}`)).click();
  if (await page.getByText('Tải về', { exact: true }).filter({ visible: true }).count()) throw new Error('video YouTube không được có "Tải về" thường');
  await v(page.getByText('Tải MP3 qua trang chuyển đổi')).click();
  const opened = await popup;
  const expected = `https://yt2.example.com/?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`;
  if (opened.url() !== expected) throw new Error(`mở sai trang: ${opened.url()}`);
  await opened.close();
  await page.waitForFunction((id) => navigator.clipboard.readText().then((t) => t.includes(id)), videoId, { timeout: 5000 });
}
await downloadViaConverter('Hậu trường quay MV', 'ccccccccccc');
await v(page.getByRole('button', { name: 'Bài hát', exact: true })).click();
await downloadViaConverter('Lạc Trôi | Official MV', 'aaaaaaaaaaa');
ok('menu ⋮ của video: mở trang chuyển đổi kèm link video (yt2), copy sẵn link, không có "Tải về" thường');

// Tải album
await v(page.getByRole('button', { name: 'Album', exact: true })).click();
await v(page.getByText('Chiều Lounge')).click();
await v(page.getByLabel('Tải tất cả')).click();
await downloadedVisible(2);
await shot('5-album-jamendo-da-tai');
ok('tải cả album Jamendo về máy (blob trong IndexedDB)');

// Đã tải → Chờ file: chọn file MP3 vừa tải cho đúng bài
await v(page.getByRole('button', { name: 'Thư viện', exact: true })).click();
await wait(300);
await v(page.getByRole('button', { name: 'Thư viện', exact: true })).click();
await v(page.getByText('Đã tải', { exact: true })).click();
await v(page.getByText(/Chờ file từ trang chuyển đổi \(2\)/)).waitFor();
await shot('6-cho-file');
const fileForVideo = page.waitForEvent('filechooser');
await v(page.locator('section', { hasText: 'Chờ file từ trang chuyển đổi' }).locator('div', { hasText: 'Hậu trường quay MV' }).getByRole('button', { name: 'Chọn file' })).click();
await (await fileForVideo).setFiles([{ name: 'tai-ve.mp3', mimeType: 'audio/mpeg', buffer: wav(2) }]);
await v(page.locator('.toast-in', { hasText: 'Đã lưu file: bài này nghe offline được' })).waitFor({ timeout: 10000 });
await v(page.getByText(/Chờ file từ trang chuyển đổi \(1\)/)).waitFor();
ok('Đã tải → Chờ file → Chọn file: file MP3 gắn vào đúng video');

// Thêm nhạc từ máy: file của trang chuyển đổi tự gắn vào video đang chờ; file khác thành bài mới
await v(page.getByRole('button', { name: 'Thư viện', exact: true })).click();
await wait(300);
await v(page.getByRole('button', { name: 'Thư viện', exact: true })).click();
const chooser = page.waitForEvent('filechooser');
await v(page.getByText('Thêm nhạc từ máy')).click();
await (await chooser).setFiles([
  { name: 'y2mate.com - Lac Troi  Official MV_128kbps.mp3', mimeType: 'audio/mpeg', buffer: wav(2) },
  { name: 'Hà Anh - Bài Của Tôi.wav', mimeType: 'audio/wav', buffer: wav(1) },
  { name: 'ghi-chu.txt', mimeType: 'text/plain', buffer: Buffer.from('x') }
]);
await v(page.locator('.toast-in', { hasText: 'Đã thêm 1 bài, gắn 1 file vào bài YouTube đang chờ • bỏ qua 1 file' })).waitFor({ timeout: 10000 });
ok('thêm file nhạc từ máy: tự gắn file y2mate vào video đang chờ, bỏ qua file không phải nhạc');

await v(page.getByText('Đã tải', { exact: true })).click();
await v(page.getByText('Bài Của Tôi')).waitFor();
await v(page.getByText('Phố Đêm Lo-fi')).waitFor();
await v(page.getByText('Lạc Trôi | Official MV')).waitFor();
if (await page.getByText(/Chờ file từ trang chuyển đổi/).filter({ visible: true }).count()) throw new Error('không còn bài nào chờ file');
await shot('7-da-tai');
ok('Đã tải có 2 bài Audius + 2 bài Jamendo + 2 video YouTube (MP3) + 1 file tự thêm');

// Offline: tải lại trang khi mất mạng → service worker mở app, nhạc đã tải vẫn phát
const swReady = await page.evaluate(async () => Boolean((await navigator.serviceWorker.ready).active));
if (!swReady) throw new Error('service worker chưa chạy');
await context.setOffline(true);
await page.reload();
await v(page.getByRole('button', { name: 'Thư viện', exact: true })).waitFor({ timeout: 10000 });
ok('mất mạng: mở lại app được (service worker)');
await v(page.getByRole('button', { name: 'Thư viện', exact: true })).click();
await v(page.getByText('Đã tải', { exact: true })).click();
await v(page.getByText('Bài Của Tôi')).click();
await playing();
await shot('8-offline-dang-phat');
ok('mất mạng: phát file đã thêm');
await v(page.getByText('Gió Chiều')).click();
await page.waitForFunction(() => document.body.innerText.includes('Gió Chiều'), null, { timeout: 5000 });
ok('mất mạng: phát bài Jamendo đã tải');
await v(page.getByText('Phố Đêm Lo-fi')).click();
await playing();
await wait(800);
if (await page.getByText(/không phát được|Không phát được/).filter({ visible: true }).count()) throw new Error('bài Audius đã tải không phát được khi mất mạng');
ok('mất mạng: phát bài Audius đã tải');
await v(page.getByText('Lạc Trôi | Official MV')).click();
await playing();
await wait(500);
if ((await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--video-h').trim())) !== '0px') throw new Error('bài YouTube đã có file không được mở khung video');
ok('mất mạng: phát video YouTube đã tải MP3 (thẻ <audio>, không cần khung video)');

await context.setOffline(false);
console.log(`   YouTube được gọi ${youtubeCalls} lần, Audius ${audiusCalls} lần, Jamendo ${jamendoCalls} lần`);
if (errors.length) {
  console.log(errors.join('\n'));
  process.exit(1);
}
console.log('OK');
await browser.close();
