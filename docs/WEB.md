# 🌐 Melo bản web (mở bằng Safari, nghe offline)

Bản web không cần SideStore và không cần máy tính. Bạn mở link bằng Safari rồi bấm **Thêm vào MH chính**, Melo hiện như một app trên iPhone. Nhạc đã tải và file nhạc của bạn **nghe được cả khi không có mạng**.

## So với app iPhone (bản cài bằng SideStore)

| | **App iPhone** | **Bản web** |
|---|---|---|
| Cài đặt | SideStore, gia hạn 7 ngày | Mở link → Thêm vào MH chính |
| Nguồn nhạc | YouTube Music (đủ bài hit mới nhất) | **YouTube** (tuỳ chọn, cần khoá API miễn phí) + **Audius** (không cần đăng ký) + **Jamendo** (tuỳ chọn) + **file nhạc của bạn** |
| Tải về nghe offline | ✅ | ✅ bài Audius, bài Jamendo nghệ sĩ cho tải, file của bạn. Video YouTube: tải MP3 qua trang chuyển đổi rồi chọn file (bước 5) |
| Video YouTube | Nghe như bài hát (tắt màn hình vẫn phát) | Xem trong khung video trên cùng màn hình (quy định của YouTube), khoá màn hình thì dừng |
| Mở app khi không có mạng | ✅ | ✅ |
| Tắt màn hình vẫn phát, tự chuyển bài | ✅ (phát bằng code iOS gốc) | ⚠️ Thường được, nhưng iOS có thể dừng sau bài đang phát |
| Màn hình khoá: tên bài, ảnh, nút chuyển bài | ✅ | ✅ |
| Đồng bộ Spotify / YouTube | ✅ | ❌ |

**YouTube trên bản web khác app iPhone thế nào?** App iPhone tự lấy file nhạc của YouTube nên phát nền và tải về được. Trang web thì không làm thế được: trình duyệt chặn (CORS), và Melo không dùng server trung gian. Bản web chỉ dùng được những gì YouTube cho phép trang web làm:
- **Tìm kiếm** qua YouTube Data API (cần khoá API miễn phí của bạn, bước 4).
- **Phát** bằng trình phát YouTube chính thức nhúng vào trang. Video phải hiện trên màn hình, không được ẩn hay tách lấy tiếng.
- **Tải về**: Melo không tự tải được, nhưng mở giúp trang chuyển đổi bạn hay dùng (trang yt2…, y2mate…). Bạn tải MP3 về app Tệp, chọn file trong Melo là bài đó nghe offline được (bước 5).

**Audius và Jamendo** là nơi **nghệ sĩ tự đăng bài**: nghe trọn bài, tải về nghe offline được, nhưng không có bài hit của các hãng đĩa lớn. Bài hit V-pop, US-UK thì tìm qua YouTube (bước 4), hoặc dùng app iPhone để tải về nghe offline.

---

## Bước 1: Đưa bản web lên Vercel (một lần, khoảng 5 phút)

1. Vào **https://vercel.com**, bấm **Sign Up** rồi chọn **Continue with GitHub**.
2. Bấm **Add New… → Project**, chọn repo **music_melo**, bấm **Import**.
3. Không cần sửa gì: Vercel tự đọc file `vercel.json` (lệnh build `npm run build:web`, thư mục `dist-web`). Bấm **Deploy**.
4. Đợi khoảng 1 phút, Vercel cho bạn một link dạng `https://music-melo-xxx.vercel.app`.

Từ đó, mỗi lần đẩy code lên nhánh `main`, Vercel tự build lại bản mới. App trên iPhone tự cập nhật ở lần mở sau.

## Bước 2: Cài lên iPhone

1. Mở link Vercel bằng **Safari**. Chrome trên iPhone không thêm được web app.
2. Bấm nút **Chia sẻ** (ô vuông có mũi tên) → **Thêm vào MH chính** → **Thêm**.
3. Mở **Melo** từ màn hình chính. Trang chủ có nhạc **Audius** ngay, không cần đăng ký gì.

## Bước 3 (tuỳ chọn): Thêm kho nhạc Jamendo

Jamendo là kho nhạc Creative Commons (nhiều nhạc acoustic, lounge, piano, nhạc nền). Cần một Client ID miễn phí:

1. Mở **https://devportal.jamendo.com**, đăng ký tài khoản.
2. Vào **My Applications → Create a new application**. Tên: `Melo`. Website: link Vercel ở bước 1.
3. Copy **Client ID** (một dãy chữ và số ngắn).
4. Melo → **Cài đặt** → **Nguồn nhạc → Jamendo (tuỳ chọn)**, dán Client ID, bấm **Lưu**.

Client ID không phải mật khẩu. Nó chỉ cho Jamendo biết app nào đang gọi. Không muốn nhập trên từng máy thì vào Vercel → **Settings → Environment Variables**, thêm `VITE_JAMENDO_CLIENT_ID` = Client ID của bạn rồi **Redeploy**.

> Trang devportal báo **"Internal Error"**? Đó là lỗi phía Jamendo. Thử mở thẳng https://devportal.jamendo.com/admin/applications (bỏ phần `?service_id=…`), xác nhận email đăng ký, đăng xuất rồi đăng nhập lại, hoặc dùng cửa sổ ẩn danh. Trong lúc chờ, Melo vẫn chạy bình thường với Audius.

## Bước 4 (tuỳ chọn): Thêm YouTube để tìm mọi bài hát, MV

Cần một **khoá API** miễn phí của Google. Nếu đã làm [GOOGLE.md](GOOGLE.md) cho app iPhone thì dùng luôn project đó. Làm trên máy tính cho dễ:

1. Vào **https://console.cloud.google.com**, đăng nhập Gmail. Chọn project `Melo` (chưa có thì **New Project** → tên `Melo` → **Create**).
2. **Bật YouTube Data API v3:** menu **APIs & Services → Library**, tìm **YouTube Data API v3** → **Enable**.
3. **Tạo khoá:** **APIs & Services → Credentials → Create credentials → API key**. Google hiện khoá dạng `AIza…`.
4. **Giới hạn khoá** (bắt buộc nên làm: khoá nằm trong trang web nên ai mở trang cũng thấy được): bấm vào khoá vừa tạo.
   - **Application restrictions:** chọn **Websites** → **Add** → nhập link Vercel của bạn kèm `/*`, ví dụ `https://music-melo-xxx.vercel.app/*`.
   - **API restrictions:** chọn **Restrict key** → tích **YouTube Data API v3** → **Save**.
5. Melo → **Cài đặt** → **Nguồn nhạc → YouTube (tuỳ chọn)**, dán khoá, bấm **Lưu**.

Từ đó trang chủ có thêm **Nhạc thịnh hành trên YouTube** và **Thịnh hành US-UK**, tìm kiếm có cả kết quả YouTube và tab **Video**. Dán link YouTube vào ô tìm kiếm cũng phát được (link video phát được cả khi chưa có khoá).

> Không muốn nhập trên từng máy? Thêm biến `VITE_YOUTUBE_API_KEY` trên Vercel (giống Jamendo) rồi **Redeploy**. Khoá vẫn hiện trong mã trang web, nên **phải** giới hạn theo website như mục 4.

**Hạn mức:** Google cho mỗi project 10.000 đơn vị/ngày. Mỗi lần tìm tốn 100 đơn vị, nên được khoảng **100 lần tìm mỗi ngày**. Mở trang chủ, trang kênh, playlist chỉ tốn vài đơn vị. Gợi ý lúc đang gõ không dùng YouTube để đỡ tốn. Hết hạn mức thì Melo báo, kết quả Audius/Jamendo vẫn hiện, khoảng 14–15 giờ chiều hôm sau (giờ Việt Nam) dùng lại được.

**Khi phát video YouTube:**
- Video hiện trong **khung trên cùng màn hình**, các trang và trình phát nằm bên dưới (YouTube không cho che hay ẩn video). Bấm **Ẩn video** thì dừng phát và thu khung lại. Bấm phát lại thì khung hiện lại.
- Lần đầu trên iPhone, Safari có thể đòi **chạm vào video** mới chịu phát (Melo nhắc "Chạm vào video để bắt đầu phát"). Từ bài sau thì tự phát tiếp.
- **Khoá màn hình hoặc chuyển app thì video dừng** (iOS dừng video của trang web). Muốn nghe nền thì dùng bài Audius/Jamendo đã tải, hoặc app iPhone.
- Có video bị chủ kênh **chặn phát ngoài YouTube**: Melo bỏ qua bài đó và chuyển bài sau.

## Bước 5 (tuỳ chọn): Tải MP3 của video YouTube để nghe offline

Melo bản web không tự lấy được file nhạc của YouTube, nên dùng trang chuyển đổi bạn hay dùng (trang yt2…, y2mate…):

1. **Một lần:** Melo → **Cài đặt → Nguồn nhạc → Trang tải MP3 từ YouTube**, dán địa chỉ trang, bấm **Lưu**.
   - Nếu trang nhận link video ngay trên địa chỉ, thay link bằng `{url}`, ví dụ `https://trang-cua-ban.com/?url={url}` (hoặc `{id}` cho id video). Melo mở trang với link điền sẵn.
   - Không thì chỉ dán địa chỉ trang. Melo copy sẵn link video để bạn dán vào ô của trang.
2. Ở video muốn tải: menu **⋮ → Tải MP3 qua trang chuyển đổi**. Melo mở trang, copy link video và ghi bài vào mục **Đã tải → Chờ file**.
3. Trên trang chuyển đổi, bấm tải **MP3**. Safari lưu vào app **Tệp → Tải về**. Trang hay có quảng cáo và nút giả: chỉ bấm nút tải MP3, không cài app, không bấm "Cho phép" thông báo.
4. Quay lại Melo, chọn một trong hai cách:
   - **Đã tải → Chờ file → Chọn file** ở đúng bài, rồi chọn file vừa tải.
   - Hoặc tải xong nhiều bài thì vào **Thư viện → Thêm nhạc từ máy** và chọn tất cả. Melo so tên file (bỏ phần thừa như "y2mate.com - …_128kbps"), id video và thời lượng để tự gắn file vào đúng bài đang chờ. File không khớp thì thành bài mới như file nhạc thường.

Bài đã có file thì phát file luôn, kể cả khi có mạng: **nghe offline, tắt màn hình vẫn phát**, không cần khung video. Bài đang phát dở bằng video thì chuyển sang file ngay khi bạn chọn file. Muốn bỏ file thì menu ⋮ → **Xoá bản đã tải**: bài lại phát bằng video YouTube.

> File MP4 (video) cũng chọn được: Melo phát phần tiếng. Chỉ dùng cho nghe cá nhân. Tải nhạc từ YouTube bằng trang bên ngoài là trái điều khoản của YouTube, bạn tự chịu trách nhiệm.

## Dùng

- **Trang chủ:** có khoá YouTube thì đầu tiên là *Nhạc thịnh hành trên YouTube* và *Thịnh hành US-UK*. Sau đó là các hàng Audius: *Thịnh hành tuần này*, *Mới phát hành* (bài ra trong 30 ngày đang được nghe), *Nghệ sĩ đang nổi*, *Playlist thịnh hành*, các thể loại (Pop, Hip-hop & Rap, Điện tử, R&B, Lo-fi). Có Client ID Jamendo thì thêm các hàng của Jamendo.
- **Tìm kiếm:** bài, video, nghệ sĩ/kênh, album, playlist. Kết quả YouTube đứng trước, xen kẽ với Audius và Jamendo.
- **Tải về:** bấm ⬇ ở album/playlist, hoặc **Tải về** trong menu ⋮ của bài. Bài Audius tải được hết (bài trả phí không hiện trong app). Có nghệ sĩ Jamendo chỉ cho nghe online: bài đó báo "không cho tải". Video YouTube: **Tải MP3 qua trang chuyển đổi** (bước 5).
- **Nhạc của bạn:** **Thư viện → Thêm nhạc từ máy**, chọn file MP3/M4A trong app **Tệp** hoặc **iCloud Drive**. Melo đọc tên bài, nghệ sĩ, ảnh bìa có sẵn trong file, rồi lưu vào **Đã tải**. Bạn thích, xếp playlist và nghe offline như bài bình thường.
- **Không có mạng:** mở Melo từ màn hình chính như mọi khi. App chỉ phát bài đã tải.

## Lưu ý

- **Nhạc lưu trong Safari của iPhone này.** Nếu xoá web app khỏi màn hình chính, hoặc vào Cài đặt → Safari → Xoá lịch sử và dữ liệu trang web, nhạc đã tải sẽ mất. **Cài đặt → Bộ nhớ trên máy** cho biết dung lượng đã dùng và còn trống.
- **Phát khi tắt màn hình:** iOS cho web app phát nhạc nền, nhưng chưa ổn định bằng app thật. Nếu nhạc dừng khi hết bài, mở khoá rồi bấm phát tiếp. Muốn chắc chắn thì dùng app iPhone (SideStore).
- **Audius giới hạn 5 lần gọi mỗi giây** cho mỗi mạng. Melo tự giãn nhịp, nên tải nhiều bài cùng lúc có thể chậm hơn một chút.
- **Bản quyền:** nhạc Audius và Jamendo theo điều khoản/giấy phép của từng nghệ sĩ, chỉ dùng cá nhân, phi thương mại. Bài tải về chỉ nghe được trong Melo. Video YouTube phát bằng trình phát chính thức của YouTube (theo điều khoản của YouTube: không ẩn, không tải về). Melo ghi công các nguồn ở cuối trang chủ.

## Cho người phát triển

```bash
npm run dev:web     # chạy bản web trên máy tính (gọi YouTube/Audius/Jamendo thật)
npm run build:web   # build ra dist-web/ (giống Vercel)
npx vite preview --mode web --outDir dist-web   # thử service worker / offline
```

- Code riêng của bản web nằm trong `src/web/`:
  - `youtube.ts`: YouTube Data API v3 bằng khoá API (tìm kiếm, thịnh hành, kênh, playlist, radio). Phát bằng trình phát nhúng: `plugins/player/src/youtube-engine.ts`, khung video `src/components/VideoStage.tsx`.
  - `audius.ts`: gọi API Audius (`api.audius.co/v1`, không cần key, có giãn nhịp).
  - `jamendo.ts`: gọi API Jamendo.
  - `music.ts` / `stream.ts`: thay cho `src/youtube/*` khi build `--mode web`. Gộp các nguồn, chọn nguồn theo tiền tố id (`yt-`, `au-`, `jm-`, `lf-` = file tự thêm).
  - `tags.ts`: đọc thẻ ID3/M4A.
  - `local-files.ts`: thêm file từ máy.
  - `youtube-files.ts`: luồng tải MP3 qua trang chuyển đổi (trang trong Cài đặt, danh sách chờ file, tự khớp file với video, gắn file vào bài `yt-…`).
  - `service-worker.js`: lưu giao diện để mở offline.
- Hằng số `__WEB_APP__` thay lúc build: phần riêng của từng bản bị loại khỏi bản kia.
