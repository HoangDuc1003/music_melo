// Chụp ảnh màn hình cho README ở khổ iPhone (390×844) với dữ liệu mẫu — không cần YouTube.
// Cách chạy:
//   npm run dev:mock -- --port 5174          (cửa sổ 1)
//   npm i --no-save playwright && node scripts/readme-shots.mjs [http://localhost:5174] [docs/images/app]
// Ảnh JPEG để README nhẹ (mỗi ảnh ~100 KB).
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:5174/';
const out = process.argv[3] ?? 'docs/images/app';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--autoplay-policy=no-user-gesture-required']
});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
// "Nhạc" mẫu là blob tạo trong trình duyệt nên tải xong ngay. Khi bật `__slowBlobs`, đọc blob chậm lại
// (~8 giây/bài) để chụp được cảnh đang tải. Chỉ có trong script chụp ảnh, app không đổi.
await ctx.addInitScript(() => {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const res = await realFetch(input, init);
    const url = typeof input === 'string' ? input : input.url;
    if (!window.__slowBlobs || !url.startsWith('blob:')) return res;
    const data = new Uint8Array(await res.arrayBuffer());
    const size = Math.ceil(data.length / 40);
    let offset = 0;
    const body = new ReadableStream({
      async pull(controller) {
        await new Promise((resolve) => setTimeout(resolve, 120 + Math.random() * 160));
        if (offset >= data.length) return controller.close();
        controller.enqueue(data.slice(offset, (offset += size)));
      }
    });
    return new Response(body, { headers: { 'content-type': res.headers.get('content-type') ?? 'audio/wav', 'content-length': String(data.length) } });
  };
});
const page = await ctx.newPage();
const visible = (locator) => locator.filter({ visible: true });
const wait = (ms) => page.waitForTimeout(ms);
const shot = async (name) => {
  await wait(500);
  await page.screenshot({ path: `${out}/${name}.jpg`, type: 'jpeg', quality: 80 });
  console.log(`✓ ${name}`);
};
const tab = (name) => visible(page.getByRole('button', { name, exact: true })).click();

await page.goto(base);
await wait(1500);
await shot('trang-chu');

// Phát một bài để có trình phát mini ở các ảnh sau.
await visible(page.getByText('Mưa Tháng Sáu')).first().click();
await wait(1500);

// Trình phát toàn màn hình → lời → hàng chờ.
await visible(page.locator('.rounded-lg.shadow-lg')).first().click({ position: { x: 120, y: 28 } });
await wait(1200);
await shot('trinh-phat');
await page.getByLabel('Lời bài hát').click();
await wait(3000);
await shot('loi-bai-hat');
await page.getByLabel('Hàng chờ').click();
await wait(900);
await shot('hang-cho');
await page.mouse.click(195, 40);
await wait(400);
await page.getByLabel('Thu nhỏ').click();
await wait(600);

// Tìm kiếm.
await tab('Tìm kiếm');
const input = visible(page.getByPlaceholder(/Bạn muốn nghe gì/));
await input.fill('hà anh');
await input.press('Enter');
await wait(1200);
await page.keyboard.press('Escape').catch(() => undefined);
await input.blur();
await shot('tim-kiem');

// Album, rồi thích vài bài để Thư viện có nội dung.
await tab('Trang chủ');
await visible(page.getByText('Album Mùa Hạ')).first().click();
await wait(1500);
await shot('album');
for (const title of ['Tàu Đêm Quảng Trị', 'Biển Xanh', 'Lời Chưa Nói']) {
  await visible(page.getByLabel(`Tuỳ chọn cho ${title}`)).first().click();
  await wait(500);
  await visible(page.getByText('Thích', { exact: true })).first().click();
  await wait(500);
}

// Tải cả playlist rồi xem trang Đã tải khi đang tải.
await tab('Trang chủ');
await tab('Trang chủ');
await wait(400);
await visible(page.getByText('Nhạc Việt Hot')).first().click();
await wait(1200);
await page.evaluate(() => (window.__slowBlobs = true));
await visible(page.getByLabel('Tải tất cả')).click();
await tab('Thư viện');
await wait(300);
await visible(page.getByLabel('Tạo playlist')).click();
await wait(500);
await visible(page.getByPlaceholder('Playlist của tôi')).fill('Nhạc đi tàu');
await visible(page.getByRole('button', { name: 'Tạo', exact: true })).click();
await wait(600);
await tab('Thư viện');
await wait(2700); // đợi thông báo (toast) tắt
await shot('thu-vien');
await visible(page.getByText('Đã tải', { exact: true })).first().click();
await wait(700);
await page.evaluate(() => {
  const heading = [...document.querySelectorAll('h2')].find((h) => h.textContent?.startsWith('Đang tải') && h.offsetParent);
  heading?.scrollIntoView({ block: 'start' });
  // Trang cuộn trong khung riêng: lùi lại để tiêu đề không nằm dưới thanh trên cùng.
  let el = heading?.parentElement;
  while (el && !(el.scrollHeight > el.clientHeight && /auto|scroll/.test(getComputedStyle(el).overflowY))) el = el.parentElement;
  (el ?? document.scrollingElement)?.scrollBy(0, -70);
});
await shot('dang-tai');

// Cài đặt → mục Tải về.
await tab('Thư viện');
await wait(300);
await visible(page.getByLabel('Cài đặt')).first().click();
await wait(800);
await visible(page.getByText('Số bài tải cùng lúc')).first().scrollIntoViewIfNeeded();
await page.evaluate(() => window.scrollBy(0, 120));
await shot('cai-dat');

await browser.close();
