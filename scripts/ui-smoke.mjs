// Kiểm tra nhanh giao diện ở khổ iPhone (390×844) với dữ liệu mẫu — không cần YouTube.
// Cách chạy:
//   npm run dev:mock -- --port 5174          (cửa sổ 1)
//   npm i --no-save playwright && node scripts/ui-smoke.mjs [http://localhost:5174] [thư-mục-ảnh]
// Thoát với mã 1 nếu một bước hỏng hoặc trang có lỗi JS.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:5174/';
const out = process.argv[3] ?? 'ui-smoke-shots';
mkdirSync(out, { recursive: true });

const executablePath = process.env.CHROMIUM_PATH || undefined;
const browser = await chromium.launch({ executablePath, args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error' && !/ERR_INTERNET_DISCONNECTED/.test(m.text())) errors.push(`console: ${m.text()}`);
});

const visible = (locator) => locator.filter({ visible: true });
const shot = async (name) => {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${name}.png` });
};
let failures = 0;
async function step(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`✗ ${name}: ${err.message.split('\n')[0]}`);
    await page.screenshot({ path: `${out}/FAIL-${name.replace(/\W+/g, '-')}.png` }).catch(() => undefined);
  }
}
const expectVisible = async (locator, what) => {
  if ((await visible(locator).count()) === 0) throw new Error(`không thấy ${what}`);
};

await page.goto(base);
await page.waitForTimeout(1500);

await step('trang chủ', async () => {
  await expectVisible(page.getByText('Chọn nhanh'), 'hàng "Chọn nhanh"');
  await shot('01-home');
});

await step('phát một bài → trình phát mini', async () => {
  await visible(page.getByText('Mưa Tháng Sáu')).first().click();
  await page.waitForTimeout(1200);
  await expectVisible(page.getByLabel('Tạm dừng'), 'nút tạm dừng');
});

await step('trình phát toàn màn hình + lời + hàng chờ', async () => {
  await visible(page.locator('.rounded-lg.shadow-lg')).first().click({ position: { x: 120, y: 28 } });
  await page.waitForTimeout(700);
  await page.getByLabel('Lời bài hát').click();
  await page.waitForTimeout(2500);
  if ((await page.locator('[data-line]').count()) === 0) throw new Error('không có dòng lời');
  await shot('02-lyrics');
  await page.getByLabel('Hàng chờ').click();
  await page.waitForTimeout(700);
  await expectVisible(page.getByText('Tiếp theo'), 'hàng chờ');
  await shot('03-queue');
  await page.mouse.click(195, 40);
  await page.waitForTimeout(400);
  await page.getByLabel('Thu nhỏ').click();
  await page.waitForTimeout(500);
});

await step('tìm kiếm', async () => {
  await visible(page.getByRole('button', { name: 'Tìm kiếm' })).click();
  const input = visible(page.getByPlaceholder(/Bạn muốn nghe gì/));
  await input.fill('hue');
  await input.press('Enter');
  await page.waitForTimeout(900);
  await expectVisible(page.getByText('Hẹn Em Ở Huế'), 'kết quả');
  await shot('04-search');
});

await step('album → tải tất cả', async () => {
  await visible(page.getByRole('button', { name: 'Trang chủ' })).click();
  await visible(page.getByText('Album Mùa Hạ')).first().click();
  await page.waitForTimeout(1000);
  await visible(page.getByLabel('Tải tất cả')).click();
  await page.waitForTimeout(4000);
  await expectVisible(page.getByLabel('Đã tải tất cả (bấm để xoá)'), 'trạng thái đã tải');
  await shot('05-album-downloaded');
});

await step('vuốt mép trái để quay lại', async () => {
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  await touch('touchStart', 4, 400);
  for (let x = 30; x <= 330; x += 30) {
    await touch('touchMove', x, 402);
    await page.waitForTimeout(16);
  }
  await touch('touchEnd');
  await page.waitForTimeout(500);
  await expectVisible(page.getByText('Chọn nhanh'), 'trang chủ sau khi vuốt');
});

await step('thư viện → đã tải', async () => {
  await visible(page.getByRole('button', { name: 'Thư viện' })).click();
  await visible(page.getByText('Đã tải', { exact: true })).first().click();
  await page.waitForTimeout(900);
  await expectVisible(page.getByText(/trên máy/), 'dung lượng');
  await shot('06-downloads');
});

await step('offline: chỉ phát bài đã tải', async () => {
  await ctx.setOffline(true);
  await page.waitForTimeout(700);
  await expectVisible(page.getByText(/Đang offline/), 'banner offline');
  await visible(page.getByRole('button', { name: 'Trang chủ' })).click();
  await page.waitForTimeout(300);
  await visible(page.getByRole('button', { name: 'Trang chủ' })).click();
  await page.waitForTimeout(400);
  await visible(page.getByText('Phố Cũ Chiều Nay')).first().click();
  await page.waitForTimeout(600);
  await expectVisible(page.getByText(/chưa được tải về/), 'thông báo chưa tải');
  await shot('07-offline');
  await ctx.setOffline(false);
});

await step('cài đặt + nhật ký', async () => {
  await visible(page.getByLabel('Cài đặt')).first().click();
  await page.waitForTimeout(600);
  await expectVisible(page.getByText('Tự tải bài hát đã thích'), 'mục tải về');
  await visible(page.getByText('Nhật ký lỗi')).click();
  await page.waitForTimeout(500);
  await shot('08-logs');
});

await browser.close();
if (errors.length) console.log('Lỗi trên trang:\n' + errors.join('\n'));
const ok = failures === 0 && errors.length === 0;
console.log(ok ? 'UI smoke: OK' : `UI smoke: ${failures} bước hỏng, ${errors.length} lỗi trang`);
process.exit(ok ? 0 : 1);
