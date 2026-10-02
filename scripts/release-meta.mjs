#!/usr/bin/env node
// Tạo các file đi kèm bản phát hành (CI gọi; chạy tay được để thử):
//   source.json   — "source" cho SideStore/AltStore: thêm 1 lần, sau đó cập nhật app bằng 1 chạm trong SideStore.
//   manifest.plist — cho kiểu cài Ad Hoc 1 chạm từ Safari (itms-services), chỉ khi có bản đã ký Ad Hoc.
//   index.html    — trang cài đặt tiếng Việt (GitHub Pages).
// Không phụ thuộc thư viện ngoài.
//
// node scripts/release-meta.mjs --out site --version 0.2.12 --build 12 --ipa-url URL --ipa-size BYTES \
//   --sha256 HEX --icon-url URL --source-url URL [--adhoc-ipa-url URL --manifest-url URL] [--date ISO]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BUNDLE_ID = 'com.melo.music';
const REPO_URL = 'https://github.com/HoangDuc1003/music_melo';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!key?.startsWith('--')) throw new Error(`Tham số lạ: ${key}`);
    args[key.slice(2)] = argv[i + 1];
  }
  for (const required of ['out', 'version', 'build', 'ipa-url', 'ipa-size', 'icon-url', 'source-url']) {
    if (!args[required]) throw new Error(`Thiếu --${required}`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(args.version)) throw new Error(`--version phải dạng x.y.z: ${args.version}`);
  if (!/^\d+$/.test(args.build)) throw new Error('--build phải là số');
  for (const key of ['ipa-url', 'icon-url', 'source-url', 'adhoc-ipa-url', 'manifest-url']) {
    if (args[key] && !/^https:\/\/[^\s"'<>]+$/.test(args[key])) throw new Error(`--${key} phải là URL https hợp lệ`);
  }
  if (args.sha256 && !/^[0-9a-f]{64}$/.test(args.sha256)) throw new Error('--sha256 không hợp lệ');
  return args;
}

const escapeXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function sourceJson({ version, build, ipaUrl, ipaSize, iconUrl, date }) {
  const description =
    'Nghe nhạc YouTube Music kiểu Spotify, tắt màn hình vẫn phát, tải về nghe offline. Dùng cá nhân, chạy hoàn toàn trên iPhone.';
  return {
    name: 'Melo',
    identifier: `${BUNDLE_ID}.source`,
    subtitle: 'App nghe nhạc cá nhân',
    description,
    iconURL: iconUrl,
    website: REPO_URL,
    tintColor: '1ed760',
    apps: [
      {
        name: 'Melo',
        bundleIdentifier: BUNDLE_ID,
        developerName: 'HoangDuc1003',
        subtitle: 'Nghe nhạc kiểu Spotify',
        localizedDescription: description,
        iconURL: iconUrl,
        tintColor: '1ed760',
        category: 'entertainment',
        screenshots: [],
        versions: [
          {
            version,
            buildVersion: String(build),
            date,
            localizedDescription: `Bản build ${build}.`,
            downloadURL: ipaUrl,
            size: Number(ipaSize),
            minOSVersion: '15.0'
          }
        ],
        appPermissions: { entitlements: [], privacy: {} }
      }
    ],
    news: []
  };
}

export function manifestPlist({ adhocIpaUrl, iconUrl, version }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>items</key>
  <array>
    <dict>
      <key>assets</key>
      <array>
        <dict>
          <key>kind</key>
          <string>software-package</string>
          <key>url</key>
          <string>${escapeXml(adhocIpaUrl)}</string>
        </dict>
        <dict>
          <key>kind</key>
          <string>display-image</string>
          <key>url</key>
          <string>${escapeXml(iconUrl)}</string>
        </dict>
        <dict>
          <key>kind</key>
          <string>full-size-image</string>
          <key>url</key>
          <string>${escapeXml(iconUrl)}</string>
        </dict>
      </array>
      <key>metadata</key>
      <dict>
        <key>bundle-identifier</key>
        <string>${BUNDLE_ID}</string>
        <key>bundle-version</key>
        <string>${escapeXml(version)}</string>
        <key>kind</key>
        <string>software</string>
        <key>title</key>
        <string>Melo</string>
      </dict>
    </dict>
  </array>
</dict>
</plist>
`;
}

export function installPage({ version, build, ipaUrl, sha256, iconUrl, sourceUrl, manifestUrl, date }) {
  const enc = encodeURIComponent(sourceUrl);
  const adhoc = manifestUrl
    ? `<section class="card primary">
      <h2>Cài ngay (1 chạm)</h2>
      <p>Dành cho iPhone đã đăng ký trong tài khoản Apple Developer. Không cần SideStore, không hết hạn sau 7 ngày.</p>
      <a class="button" href="itms-services://?action=download-manifest&amp;url=${encodeURIComponent(manifestUrl)}">Cài đặt Melo</a>
      <p class="hint">Bấm "Cài đặt" trong hộp thoại, rồi ra màn hình chính chờ app tải xong.</p>
    </section>`
    : '';
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' https:; style-src 'unsafe-inline'">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#121212">
<title>Cài Melo</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #121212; color: #fff; font: 16px/1.5 -apple-system, system-ui, sans-serif; }
  main { max-width: 560px; margin: 0 auto; padding: max(24px, env(safe-area-inset-top)) 16px 48px; }
  header { display: flex; gap: 16px; align-items: center; margin-bottom: 24px; }
  header img { width: 72px; height: 72px; border-radius: 16px; }
  h1 { margin: 0; font-size: 28px; }
  .meta { color: #b3b3b3; font-size: 14px; }
  .card { background: #1f1f1f; border-radius: 14px; padding: 18px; margin: 16px 0; }
  .card.primary { border: 1px solid #1ed760; }
  h2 { margin: 0 0 8px; font-size: 19px; }
  p { margin: 8px 0; color: #d6d6d6; }
  .button { display: block; text-align: center; background: #1ed760; color: #000; font-weight: 700; text-decoration: none;
    padding: 14px; border-radius: 999px; margin: 12px 0 6px; }
  .button.secondary { background: #fff; }
  .button.ghost { background: transparent; color: #fff; border: 1px solid #555; }
  .hint { color: #9a9a9a; font-size: 13px; }
  code { word-break: break-all; font-size: 12px; color: #b3b3b3; }
  ol { padding-left: 20px; color: #d6d6d6; }
</style>
</head>
<body>
<main>
  <header>
    <img src="${escapeXml(iconUrl)}" alt="">
    <div>
      <h1>Melo</h1>
      <div class="meta">Phiên bản ${escapeXml(version)} (build ${escapeXml(build)}) · ${escapeXml(date.slice(0, 10))}</div>
    </div>
  </header>
  ${adhoc}
  <section class="card">
    <h2>Cài miễn phí bằng SideStore / AltStore</h2>
    <p>Thêm "source" một lần, sau đó mỗi bản mới chỉ cần bấm <b>Cập nhật</b> trong SideStore.</p>
    <a class="button secondary" href="sidestore://source?url=${enc}">Thêm vào SideStore</a>
    <a class="button ghost" href="altstore://source?url=${enc}">Thêm vào AltStore</a>
    <a class="button ghost" href="${escapeXml(ipaUrl)}">Tải file Melo.ipa</a>
    <p class="hint">Apple ID miễn phí: gia hạn 7 ngày một lần trong SideStore. iOS 16 trở lên cần bật Chế độ nhà phát triển (Cài đặt → Quyền riêng tư &amp; Bảo mật).</p>
  </section>
  <section class="card">
    <h2>Lưu ý</h2>
    <ol>
      <li>App dùng cá nhân, không phát hành trên App Store.</li>
      <li>Nhạc đã tải vẫn còn khi cài bản mới (mã app <code>${BUNDLE_ID}</code> không đổi).</li>
      <li>Gặp lỗi: trong app vào Cài đặt → Nhật ký lỗi → Copy.</li>
    </ol>
    ${sha256 ? `<p class="hint">SHA-256 của Melo.ipa: <code>${escapeXml(sha256)}</code></p>` : ''}
  </section>
</main>
</body>
</html>
`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const date = args.date ?? new Date().toISOString();
  const common = {
    version: args.version,
    build: args.build,
    ipaUrl: args['ipa-url'],
    ipaSize: args['ipa-size'],
    sha256: args.sha256,
    iconUrl: args['icon-url'],
    sourceUrl: args['source-url'],
    adhocIpaUrl: args['adhoc-ipa-url'],
    manifestUrl: args['manifest-url'],
    date
  };
  mkdirSync(args.out, { recursive: true });
  writeFileSync(join(args.out, 'source.json'), JSON.stringify(sourceJson(common), null, 2));
  if (common.adhocIpaUrl) writeFileSync(join(args.out, 'manifest.plist'), manifestPlist(common));
  writeFileSync(join(args.out, 'index.html'), installPage({ ...common, manifestUrl: common.adhocIpaUrl ? common.manifestUrl : undefined }));
  console.log(`Đã tạo ${args.out}/source.json${common.adhocIpaUrl ? ', manifest.plist' : ''}, index.html`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (err) {
    console.error(`::error::${err.message}`);
    process.exit(1);
  }
}
