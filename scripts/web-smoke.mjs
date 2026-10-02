// Chạy thử Melo bản web: `npm run build:web && npx vite preview --mode web --outDir dist-web --port 4175`, rồi
// `npm i --no-save playwright && CHROMIUM_PATH=… node scripts/web-smoke.mjs`. Audius và Jamendo được giả bằng context.route.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
mkdirSync('web-smoke-shots', { recursive: true });
const BASE = 'http://localhost:4175/';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
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
await shot('3-cai-dat');
ok('Cài đặt: Audius luôn bật; nhập Client ID Jamendo (tuỳ chọn); không có mục Spotify');

await v(page.getByRole('button', { name: 'Trang chủ', exact: true })).click();
await wait(300);
await v(page.getByRole('button', { name: 'Trang chủ', exact: true })).click();
await v(page.getByText('Thịnh hành trên Jamendo')).waitFor({ timeout: 10000 });
await shot('4-trang-chu-hai-nguon');
ok('trang chủ có thêm các hàng Jamendo');

await v(page.getByText('Gió Chiều')).click();
await playing();
ok('phát bài từ Jamendo (đang phát)');

// Tìm kiếm: không có tab Video
await v(page.getByRole('button', { name: 'Tìm kiếm', exact: true })).click();
await v(page.getByPlaceholder(/Bạn muốn nghe gì/)).fill('gió');
await page.keyboard.press('Enter');
await v(page.getByText('Mưa Đêm Lounge')).waitFor();
await v(page.getByText('Đêm Sài Gòn Mới')).waitFor();
if (await page.getByRole('button', { name: 'Video', exact: true }).filter({ visible: true }).count()) throw new Error('không được có tab Video');
ok('tìm kiếm: kết quả của cả Audius và Jamendo, không có tab Video');

// Tải album
await v(page.getByRole('button', { name: 'Album', exact: true })).click();
await v(page.getByText('Chiều Lounge')).click();
await v(page.getByLabel('Tải tất cả')).click();
await downloadedVisible(2);
await shot('5-album-jamendo-da-tai');
ok('tải cả album Jamendo về máy (blob trong IndexedDB)');

// Thêm file nhạc từ máy
await v(page.getByRole('button', { name: 'Thư viện', exact: true })).click();
await wait(300);
await v(page.getByRole('button', { name: 'Thư viện', exact: true })).click();
const chooser = page.waitForEvent('filechooser');
await v(page.getByText('Thêm nhạc từ máy')).click();
await (await chooser).setFiles([
  { name: 'Hà Anh - Bài Của Tôi.wav', mimeType: 'audio/wav', buffer: wav(1) },
  { name: 'ghi-chu.txt', mimeType: 'text/plain', buffer: Buffer.from('x') }
]);
await v(page.locator('.toast-in', { hasText: 'Đã thêm 1 bài vào Đã tải' })).waitFor({ timeout: 10000 });
ok('thêm file nhạc từ máy (bỏ qua file không phải nhạc)');

await v(page.getByText('Đã tải', { exact: true })).click();
await v(page.getByText('Bài Của Tôi')).waitFor();
await v(page.getByText('Phố Đêm Lo-fi')).waitFor();
await shot('6-da-tai');
ok('Đã tải có 2 bài Audius + 2 bài Jamendo + 1 file tự thêm');

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
await shot('7-offline-dang-phat');
ok('mất mạng: phát file đã thêm');
await v(page.getByText('Gió Chiều')).click();
await page.waitForFunction(() => document.body.innerText.includes('Gió Chiều'), null, { timeout: 5000 });
ok('mất mạng: phát bài Jamendo đã tải');
await v(page.getByText('Phố Đêm Lo-fi')).click();
await playing();
await wait(800);
if (await page.getByText(/không phát được|Không phát được/).filter({ visible: true }).count()) throw new Error('bài Audius đã tải không phát được khi mất mạng');
ok('mất mạng: phát bài Audius đã tải');

await context.setOffline(false);
console.log(`   Audius được gọi ${audiusCalls} lần, Jamendo ${jamendoCalls} lần`);
if (errors.length) {
  console.log(errors.join('\n'));
  process.exit(1);
}
console.log('OK');
await browser.close();
