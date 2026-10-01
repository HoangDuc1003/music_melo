// Vẽ hình minh hoạ các bước cài đặt cho README / docs/CAI_DAT.md (HTML → PNG bằng Playwright).
// Đây là hình MINH HOẠ (vẽ lại các màn hình với đúng tên mục cần bấm), không phải ảnh chụp iPhone thật;
// chữ trên máy có thể khác chút tuỳ phiên bản iOS / SideStore.
//   npm i --no-save playwright && node scripts/install-illustrations.mjs [docs/images/install]
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { installPage } from './release-meta.mjs';

const out = resolve(process.argv[2] ?? 'docs/images/install');
mkdirSync(out, { recursive: true });
const fontDir = pathToFileURL(resolve('node_modules/@fontsource/be-vietnam-pro')).href;
const meloIcon = `data:image/svg+xml;base64,${readFileSync('public/icon.svg').toString('base64')}`;

// ---------- Mảnh giao diện ----------

const chevron = '<svg class="chev" viewBox="0 0 8 14"><path d="M1 1l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const toggle = (on) => `<span class="toggle ${on ? 'on' : ''}"><i></i></span>`;
const tap = '<span class="tap"></span>';

/** Một dòng trong danh sách kiểu Cài đặt iOS. */
function row(label, { value = '', icon, color, chev = true, sw, hl, blue, sub } = {}) {
  const ic = icon ? `<span class="ic" style="background:${color}">${icon}</span>` : '';
  const right = sw !== undefined ? toggle(sw) : `${value ? `<span class="val">${value}</span>` : ''}${chev ? chevron : ''}`;
  return `<div class="row ${hl ? 'hl' : ''}">${ic}<div class="lbl ${blue ? 'blue' : ''}">${label}${sub ? `<small>${sub}</small>` : ''}</div>${right}${hl ? tap : ''}</div>`;
}
const group = (rows, header = '', footer = '') =>
  `${header ? `<div class="gh">${header}</div>` : ''}<div class="group">${rows.join('')}</div>${footer ? `<div class="gf">${footer}</div>` : ''}`;
/** Có nút quay lại thì dùng tiêu đề lớn bên dưới (như iOS), không thì tiêu đề giữa. */
const nav = (title, back = '') =>
  back
    ? `<div class="nav"><span class="back">‹ ${back}</span></div><div class="large sm">${title}</div>`
    : `<div class="nav"><span class="nt">${title}</span></div>`;
const large = (title) => `<div class="large">${title}</div>`;
const glyph = (text) => `<b class="gl">${text}</b>`;

function phone(screen, { dark = false, tabs = '' } = {}) {
  return `<div class="phone"><div class="screen ${dark ? 'dark' : ''}">
    <div class="status"><span>9:41</span><span class="notch"></span><span class="sicons">▮▮▮ ◔</span></div>
    <div class="body">${screen}</div>${tabs}</div></div>`;
}

function tabbar(items, active, accent) {
  return `<div class="tabs">${items
    .map((t) => `<div class="tab ${t === active ? 'on' : ''}" style="${t === active ? `color:${accent}` : ''}"><i></i>${t}</div>`)
    .join('')}</div>`;
}

/** Một ô bước: số thứ tự + điện thoại (hoặc thẻ) + chú thích. */
const step = (n, content, caption) =>
  `<div class="step"><div class="num">${n}</div>${content}<div class="cap">${caption}</div></div>`;

function canvas(title, subtitle, steps) {
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8">
<link rel="stylesheet" href="${fontDir}/400.css"><link rel="stylesheet" href="${fontDir}/500.css">
<link rel="stylesheet" href="${fontDir}/600.css"><link rel="stylesheet" href="${fontDir}/700.css">
<style>${CSS}</style></head><body><div id="canvas">
<div class="title"><img src="${meloIcon}" alt=""><div><h1>${title}</h1><p>${subtitle}</p></div></div>
<div class="steps">${steps.join('<div class="arrow">→</div>')}</div>
<div class="note">Hình minh hoạ · chữ trên máy có thể khác chút tuỳ phiên bản iOS</div>
</div></body></html>`;
}

const CSS = `
* { box-sizing: border-box; margin: 0; }
body { font-family: 'Be Vietnam Pro', system-ui, sans-serif; background: transparent; }
#canvas { display: inline-block; padding: 30px 34px 22px; border-radius: 28px; color: #fff;
  background: #141414; border: 2px solid #1f3b2b; }
.title { display: flex; gap: 14px; align-items: center; margin-bottom: 22px; }
.title img { width: 52px; height: 52px; }
h1 { font-size: 26px; font-weight: 700; letter-spacing: -0.3px; }
.title p { color: #b3b3b3; font-size: 15px; margin-top: 2px; }
.steps { display: flex; align-items: flex-start; gap: 6px; }
.arrow { color: #1ed760; font-size: 30px; font-weight: 700; padding-top: 250px; width: 26px; text-align: center; }
.step { width: 262px; display: flex; flex-direction: column; align-items: center; }
.num { width: 34px; height: 34px; border-radius: 50%; background: #1ed760; color: #000; font-weight: 700; font-size: 18px;
  display: flex; align-items: center; justify-content: center; margin-bottom: 12px; }
.cap { margin-top: 14px; font-size: 14.5px; line-height: 1.45; color: #e6e6e6; text-align: center; min-height: 64px; }
.cap b { color: #1ed760; font-weight: 600; }
.note { margin-top: 10px; font-size: 12px; color: #7a7a7a; text-align: right; }

.phone { width: 250px; height: 520px; border-radius: 42px; padding: 9px; background: #2c2c2e;
  box-shadow: 0 0 0 1.5px #48484a; }
.screen { position: relative; width: 100%; height: 100%; border-radius: 34px; overflow: hidden; background: #f2f2f7; color: #000;
  display: flex; flex-direction: column; }
.screen.dark { background: #0d0d0f; color: #fff; }
.status { display: flex; justify-content: space-between; align-items: center; padding: 10px 22px 4px; font-size: 12px; font-weight: 600; }
.notch { width: 74px; height: 20px; border-radius: 12px; background: #000; }
.sicons { font-size: 9px; letter-spacing: 1px; }
.body { flex: 1; padding: 0 12px; overflow: hidden; }
.nav { position: relative; height: 34px; display: flex; align-items: center; justify-content: center; font-size: 13.5px; font-weight: 600; }
.back { position: absolute; left: 0; color: #007aff; font-weight: 500; font-size: 13px; }
.large { font-size: 25px; font-weight: 700; margin: 2px 4px 10px; letter-spacing: -0.4px; }
.large.sm { font-size: 20px; margin: 0 4px 6px; line-height: 1.2; }
.gh { font-size: 10.5px; color: #6d6d72; text-transform: uppercase; margin: 12px 12px 5px; }
.gf { font-size: 10.5px; color: #6d6d72; margin: 5px 12px 0; line-height: 1.35; }
.group { background: #fff; border-radius: 11px; overflow: visible; }
.dark .group { background: #1c1c1e; }
.row { position: relative; display: flex; align-items: center; gap: 9px; min-height: 38px; padding: 6px 11px; font-size: 13px;
  border-bottom: 0.5px solid #d8d8dc; }
.dark .row { border-bottom-color: #38383a; }
.row:last-child { border-bottom: 0; }
.lbl { flex: 1; line-height: 1.25; }
.lbl small { display: block; color: #8e8e93; font-size: 10.5px; }
.lbl.blue { color: #007aff; }
.val { color: #8e8e93; font-size: 12.5px; }
.chev { width: 6px; height: 11px; color: #c4c4c7; }
.ic { width: 24px; height: 24px; border-radius: 6px; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 12px; font-weight: 700; }
.toggle { width: 38px; height: 23px; border-radius: 12px; background: #e3e3e8; position: relative; }
.toggle i { position: absolute; top: 2px; left: 2px; width: 19px; height: 19px; border-radius: 50%; background: #fff; box-shadow: 0 0 0 0.5px #c7c7cc; }
.toggle.on { background: #34c759; }
.toggle.on i { left: 17px; }
.hl { outline: 3px solid #1ed760; outline-offset: 1px; border-radius: 10px; z-index: 2; background: #fff; }
.dark .hl { background: #1c1c1e; }
.tap { position: absolute; right: -15px; bottom: -15px; width: 26px; height: 26px; border-radius: 50%; pointer-events: none;
  background: #9be8b6; border: 2.5px solid #fff; box-shadow: 0 0 0 3px #1ed760; }
.tabs { display: flex; justify-content: space-around; padding: 7px 4px 16px; border-top: 0.5px solid #d0d0d4; background: rgba(249,249,249,.95); }
.dark .tabs { background: #161618; border-top-color: #333; }
.tab { display: flex; flex-direction: column; align-items: center; gap: 3px; font-size: 9px; color: #8e8e93; }
.tab i { width: 18px; height: 18px; border-radius: 5px; background: currentColor; opacity: .55; }
.tab.on i { opacity: 1; }
.gl { font-size: 13px; }
.btn { position: relative; display: block; margin: 0 auto; text-align: center; font-weight: 700; }
.pill { display: inline-block; padding: 5px 13px; border-radius: 999px; font-size: 11.5px; font-weight: 700; background: #ede7ff; color: #6c3df4; position: relative; }
.pill.hl { outline-offset: 2px; border-radius: 999px; background: #ede7ff; }
.card { display: flex; flex-direction: column; align-items: center; justify-content: flex-start; width: 250px; height: 300px; border-radius: 26px;
  background: #1c1c1e; border: 1px solid #333; padding: 26px 18px; text-align: center; }
.card .big { width: 74px; height: 74px; border-radius: 20px; display: flex; align-items: center; justify-content: center; margin-bottom: 16px; }
.card h3 { font-size: 17px; margin-bottom: 8px; }
.card p { color: #b3b3b3; font-size: 13px; line-height: 1.45; }
.card code { display: inline-block; margin-top: 10px; padding: 6px 10px; border-radius: 8px; background: #2c2c2e; color: #1ed760; font-size: 11.5px; }
.flow { margin-top: 10px; display: flex; flex-direction: column; gap: 6px; width: 100%; }
.flow span { display: block; padding: 7px 10px; border-radius: 9px; background: #2c2c2e; font-size: 12.5px; }
.flow span.hl { outline: 3px solid #1ed760; outline-offset: 0; background: #12361f; color: #fff; }
`;

// ---------- Màn hình từng bước ----------

const svgIcon = (path, color) =>
  `<span class="big" style="background:${color}"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path}</svg></span>`;
const ICON = {
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
  cable: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
  rocket: '<path d="M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2"/><path d="M14.5 4.5c3-1.5 5-1.5 5-1.5s0 2-1.5 5L12 14l-2-2z"/><path d="M9 10 6 9l3-3h4"/><path d="m14 15 1 3-3 3v-4"/>'
};

const pcSteps = [
  step(1, `<div class="card">${svgIcon(ICON.music, '#fa2d48')}<h3>Cài iTunes</h3><p>Dùng bản tải trực tiếp từ Apple (không dùng bản Microsoft Store).</p><code>apple.com/itunes/download/win64</code></div>`,
    'Windows 64-bit. Không được thì thử app <b>Apple Devices</b>.'),
  step(2, `<div class="card">${svgIcon(ICON.download, '#5856d6')}<h3>Cài iloader</h3><p>Tải bản <b style="color:#fff">.msi</b> mới nhất rồi chạy file cài.</p><code>github.com/nab138/iloader/releases</code></div>`,
    'Công cụ cài SideStore, tự đặt sẵn pairing file.'),
  step(3, `<div class="card">${svgIcon(ICON.cable, '#0a84ff')}<h3>Cắm iPhone vào PC</h3><p>Trên iPhone bấm <b style="color:#fff">Tin cậy</b> và nhập mật mã.</p><div class="flow"><span>Tin cậy máy tính này?</span><span class="hl">Tin cậy</span></div></div>`,
    'Dùng cáp USB, mở khoá màn hình iPhone.'),
  step(4, `<div class="card">${svgIcon(ICON.rocket, '#1ed760')}<h3>iloader</h3><div class="flow"><span>1. Đăng nhập Apple ID</span><span>2. Chọn iPhone của bạn</span><span class="hl">3. Install SideStore (Stable)</span></div></div>`,
    'Apple ID phụ cũng được, <b>nhớ đúng chữ hoa/thường</b>.')
];

const iphoneSteps = [
  step(1, phone(nav('Cài đặt chung', 'Cài đặt') + group([
    row('Giới thiệu'), row('Cập nhật phần mềm'), row('AirDrop'), row('AirPlay & Liên tục')
  ]) + group([row('Ngày & Giờ'), row('Bàn phím'), row('Ngôn ngữ & Vùng')], '') + group([row('Quản lý VPN & thiết bị', { hl: true })]) ),
    'Cài đặt → Cài đặt chung → <b>Quản lý VPN & thiết bị</b>'),
  step(2, phone(nav('Quản lý VPN & thiết bị', 'Cài đặt chung') + group([row('VPN', { value: 'Không kết nối' })]) +
    group([row('Apple Development: ban@icloud.com', { icon: glyph('A'), color: '#8e8e93', chev: false })], 'Ứng dụng nhà phát triển') +
    group([row('Tin cậy "Apple Development: ban@icloud.com"', { blue: true, chev: false, hl: true })], 'Sau khi chọn Apple ID', 'Ứng dụng: SideStore')),
    'Chọn Apple ID của bạn → <b>Tin cậy</b> → Cho phép'),
  step(3, phone(nav('Chế độ nhà phát triển', 'Quyền riêng tư') + group([row('Chế độ nhà phát triển', { sw: true, hl: true, chev: false })], '',
    'Bật để cài app tự ký (SideStore, Melo). Máy sẽ khởi động lại; sau đó chọn <b style="color:#000">Bật</b> khi được hỏi.')),
    'Quyền riêng tư & Bảo mật → kéo xuống cuối → <b>Chế độ nhà phát triển</b>')
];

const sideTabs = (active) => tabbar(['Sources', 'Browse', 'My Apps', 'Settings'], active, '#6c3df4');
const sideStoreSteps = [
  step(1, phone(`<div style="text-align:center;padding-top:40px">
      <div class="ic" style="width:64px;height:64px;border-radius:16px;margin:0 auto 14px;background:#0a84ff;font-size:24px">VPN</div>
      <div style="font-size:19px;font-weight:700">LocalDevVPN</div>
      <div style="color:#8e8e93;font-size:12px;margin:6px 0 40px">Disconnected</div>
      <div class="row hl" style="display:inline-flex;justify-content:center;width:150px;border-radius:999px;background:#0a84ff;color:#fff;font-weight:700;font-size:15px;min-height:46px">Connect${tap}</div>
      <div style="color:#8e8e93;font-size:11px;margin-top:40px;padding:0 16px;line-height:1.4">Bật mỗi khi cài, cập nhật hoặc gia hạn app trong SideStore. Dùng Wi‑Fi.</div>
    </div>`), 'Mở <b>LocalDevVPN</b> → Connect'),
  step(2, phone(large('My Apps') + group([
      row(`SideStore<small>Hết hạn sau 7 ngày</small>`, { icon: glyph('S'), color: '#6c3df4', chev: false, value: '<span class="pill hl">7 DAYS' + tap + '</span>' })
    ], 'Active') + `<div class="gf" style="margin-top:10px">Lần đầu: mở SideStore, đăng nhập <b style="color:#000">đúng Apple ID</b> đã dùng ở iloader (tab Settings), rồi bấm 7 DAYS. Hỏi tạo chứng chỉ mới → Yes.</div>`,
    { tabs: sideTabs('My Apps') }), 'SideStore → My Apps → bấm <b>7 DAYS</b> cạnh SideStore'),
  step(3, phone(`<div class="nav"><span class="nt">Sources</span><span class="row hl" style="position:absolute;right:2px;min-height:26px;padding:0 9px;font-size:20px;color:#6c3df4;border:0">+${tap}</span></div>` +
    group([row('SideStore Team<small>Nguồn mặc định</small>', { icon: glyph('S'), color: '#6c3df4' })]) +
    group([`<div class="row" style="flex-direction:column;align-items:stretch"><div style="font-weight:600;margin-bottom:6px">Add Source</div><div style="font-size:10.5px;padding:7px 8px;border-radius:7px;background:#eeeef3;color:#333;word-break:break-all">https://github.com/HoangDuc1003/spoti_music/releases/download/ios-latest/source.json</div></div>`], 'Dán link source của Melo'),
    { tabs: sideTabs('Sources') }), 'Sources → <b>+</b> → dán link <b>source.json</b> của Melo'),
  step(4, phone(`<div style="text-align:center;padding-top:26px"><img src="${meloIcon}" style="width:86px;height:86px;border-radius:20px" alt="">
      <div style="font-size:21px;font-weight:700;margin-top:10px">Melo</div><div style="color:#8e8e93;font-size:12px">HoangDuc1003</div>
      <div style="margin:18px 0"><span class="pill hl" style="font-size:14px;padding:8px 26px">GET${tap}</span></div></div>` +
    group([row('Phiên bản', { value: '0.2.x', chev: false }), row('Cập nhật', { value: 'bấm UPDATE', chev: false })]),
    { tabs: sideTabs('Browse') }), 'Mở source <b>Melo</b> → <b>GET</b>. Bản mới: bấm UPDATE')
];

const shortcutTabs = (active) => tabbar(['Phím tắt', 'Tự động hoá', 'Bộ sưu tập'], active, '#007aff');
const autoSteps = [
  step(1, phone(nav('Tự động hoá mới') + group([
      row('Thời gian trong ngày', { icon: '◷', color: '#ff9500', hl: true }), row('Báo thức', { icon: '⏰', color: '#ff9500' }),
      row('Ngủ', { icon: '☾', color: '#5ac8fa' }), row('Wi‑Fi', { icon: '≋', color: '#007aff' }), row('Bộ sạc', { icon: '⚡', color: '#34c759' })
    ], 'Khi nào'), { tabs: shortcutTabs('Tự động hoá') }), 'Phím tắt → Tự động hoá → <b>+</b> → <b>Thời gian trong ngày</b>'),
  step(2, phone(nav('Khi nào', 'Quay lại') + group([row('Thời gian', { value: '3:00 SA', chev: false }), row('Lặp lại', { value: 'Hằng ngày' })]) +
    group([row('Chạy sau khi xác nhận', { chev: false }), row('Chạy ngay lập tức ✓', { chev: false, hl: true }), row('Thông báo khi chạy', { sw: false, chev: false })], ''),
    { tabs: shortcutTabs('Tự động hoá') }), '3:00 sáng, <b>Hằng ngày</b>, chọn <b>Chạy ngay lập tức</b>'),
  step(3, phone(nav('Tác vụ', 'Quay lại') + `<div style="margin-top:8px"></div>` +
    group([row('<span style="color:#007aff">Mở</span> <b>SideStore</b>', { icon: '▢', color: '#6c3df4', chev: false, hl: true })], 'Thêm tác vụ: Mở ứng dụng') +
    `<div class="gf" style="margin-top:12px">Điều kiện: LocalDevVPN đang Connect và có Wi‑Fi. Nên để máy sạc qua đêm.</div>`,
    { tabs: shortcutTabs('Tự động hoá') }), 'Tác vụ <b>Mở ứng dụng → SideStore</b>. Xong!')
];

// ---------- Xuất ảnh ----------

const images = [
  ['1-may-tinh', 'Bước 1 · Trên máy tính Windows (chỉ làm 1 lần)', 'Cài SideStore lên iPhone bằng iloader, khoảng 10 phút.', pcSteps],
  ['2-iphone', 'Bước 2 · Kích hoạt trên iPhone', 'Cho phép app tự ký chạy trên máy.', iphoneSteps],
  ['3-sidestore', 'Bước 3 · Cài Melo bằng SideStore', 'Thêm source một lần, các bản sau chỉ cần bấm UPDATE.', sideStoreSteps],
  ['4-tu-gia-han', 'Bước 4 · Tự gia hạn 7 ngày (khuyên làm)', 'Tạo lịch trong app Phím tắt để không phải nhớ.', autoSteps]
];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1400, height: 900 } });
const tmp = mkdtempSync(join(tmpdir(), 'melo-illus-'));
try {
  for (const [name, title, subtitle, steps] of images) {
    const file = join(tmp, `${name}.html`);
    writeFileSync(file, canvas(title, subtitle, steps));
    await page.goto(pathToFileURL(file).href);
    await page.evaluate(() => document.fonts.ready);
    await page.locator('#canvas').screenshot({ path: join(out, `${name}.png`), omitBackground: true });
    console.log(`✓ ${name}.png`);
  }

  // Trang cài đặt thật (GitHub Pages) ở khổ iPhone, có cả nút cài 1 chạm Ad Hoc.
  const base = 'https://hoangduc1003.github.io/spoti_music';
  writeFileSync(join(tmp, 'icon.png'), readFileSync('docs/icon-512.png'));
  writeFileSync(
    join(tmp, 'index.html'),
    installPage({
      version: '0.2.12', build: '12', ipaUrl: `${base}/Melo.ipa`, sha256: '', iconUrl: 'icon.png',
      sourceUrl: `${base}/source.json`, manifestUrl: `${base}/manifest.plist`, date: '2026-10-01T00:00:00Z'
    })
  );
  const phonePage = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 390, height: 844 }, isMobile: true });
  await phonePage.goto(pathToFileURL(join(tmp, 'index.html')).href);
  await phonePage.screenshot({ path: join(out, 'trang-cai-dat.jpg'), type: 'jpeg', quality: 82 });
  console.log('✓ trang-cai-dat.jpg');
} finally {
  await browser.close();
  rmSync(tmp, { recursive: true, force: true });
}
