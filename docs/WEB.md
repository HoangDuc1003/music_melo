# 🌐 Melo bản web (mở bằng Safari, nghe offline)

Bản web không cần SideStore và không cần máy tính. Bạn mở link bằng Safari rồi bấm **Thêm vào MH chính**, Melo hiện như một app trên iPhone. Nhạc đã tải và file nhạc của bạn **nghe được cả khi không có mạng**.

## So với app iPhone (bản cài bằng SideStore)

| | **App iPhone** | **Bản web** |
|---|---|---|
| Cài đặt | SideStore, gia hạn 7 ngày | Mở link → Thêm vào MH chính |
| Nguồn nhạc | YouTube Music (đủ bài hit mới nhất) | **Audius** (bài mới mỗi ngày, không cần đăng ký) + **Jamendo** (tuỳ chọn) + **file nhạc của bạn** |
| Tải về nghe offline | ✅ | ✅ (mọi bài Audius nghe được, bài Jamendo nghệ sĩ cho tải, file của bạn) |
| Mở app khi không có mạng | ✅ | ✅ |
| Tắt màn hình vẫn phát, tự chuyển bài | ✅ (phát bằng code iOS gốc) | ⚠️ Thường được, nhưng iOS có thể dừng sau bài đang phát |
| Màn hình khoá: tên bài, ảnh, nút chuyển bài | ✅ | ✅ |
| Đồng bộ Spotify / YouTube | ✅ | ❌ |

**Vì sao bản web không có YouTube Music?** Trình duyệt chặn trang web gọi thẳng YouTube (CORS). Muốn gọi được thì phải có server trung gian, nhưng Melo không dùng server, và YouTube cũng hay chặn IP của các máy chủ như Vercel. Vì vậy bản web dùng các nguồn nhạc cho phép app bên thứ ba dùng hợp lệ.

**Vì sao không có bài hit mới của Sơn Tùng, Taylor Swift…?** Audius và Jamendo là nơi **nghệ sĩ tự đăng bài**: có nhiều bài mới mỗi ngày (hàng *Mới phát hành* trên trang chủ), nhưng các hãng đĩa lớn không đưa nhạc lên đó. Bài hit V-pop, US-UK chỉ có trên YouTube, Spotify, Apple Music. Các nơi này không cho trang web phát hoặc tải nhạc nếu không có server. Muốn nghe các bài đó thì dùng **app iPhone** (YouTube Music). Bản web vẫn nghe được các bài đó nếu bạn **có sẵn file**: Thư viện → *Thêm nhạc từ máy*.

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

## Dùng

- **Trang chủ:** *Thịnh hành tuần này*, *Mới phát hành* (bài ra trong 30 ngày đang được nghe), *Nghệ sĩ đang nổi*, *Playlist thịnh hành*, các thể loại (Pop, Hip-hop & Rap, Điện tử, R&B, Lo-fi). Có Client ID Jamendo thì thêm các hàng của Jamendo.
- **Tìm kiếm:** bài, nghệ sĩ, album, playlist. Kết quả của hai nguồn xen kẽ nhau.
- **Tải về:** bấm ⬇ ở album/playlist, hoặc **Tải về** trong menu ⋮ của bài. Bài Audius tải được hết (bài trả phí không hiện trong app). Có nghệ sĩ Jamendo chỉ cho nghe online: bài đó báo "không cho tải".
- **Nhạc của bạn:** **Thư viện → Thêm nhạc từ máy**, chọn file MP3/M4A trong app **Tệp** hoặc **iCloud Drive**. Melo đọc tên bài, nghệ sĩ, ảnh bìa có sẵn trong file, rồi lưu vào **Đã tải**. Bạn thích, xếp playlist và nghe offline như bài bình thường.
- **Không có mạng:** mở Melo từ màn hình chính như mọi khi. App chỉ phát bài đã tải.

## Lưu ý

- **Nhạc lưu trong Safari của iPhone này.** Nếu xoá web app khỏi màn hình chính, hoặc vào Cài đặt → Safari → Xoá lịch sử và dữ liệu trang web, nhạc đã tải sẽ mất. **Cài đặt → Bộ nhớ trên máy** cho biết dung lượng đã dùng và còn trống.
- **Phát khi tắt màn hình:** iOS cho web app phát nhạc nền, nhưng chưa ổn định bằng app thật. Nếu nhạc dừng khi hết bài, mở khoá rồi bấm phát tiếp. Muốn chắc chắn thì dùng app iPhone (SideStore).
- **Audius giới hạn 5 lần gọi mỗi giây** cho mỗi mạng. Melo tự giãn nhịp, nên tải nhiều bài cùng lúc có thể chậm hơn một chút.
- **Bản quyền:** nhạc Audius và Jamendo theo điều khoản/giấy phép của từng nghệ sĩ, chỉ dùng cá nhân, phi thương mại. Bài tải về chỉ nghe được trong Melo. Melo ghi công hai nguồn ở cuối trang chủ.

## Cho người phát triển

```bash
npm run dev:web     # chạy bản web trên máy tính (gọi Audius/Jamendo thật)
npm run build:web   # build ra dist-web/ (giống Vercel)
npx vite preview --mode web --outDir dist-web   # thử service worker / offline
```

- Code riêng của bản web nằm trong `src/web/`:
  - `audius.ts`: gọi API Audius (`api.audius.co/v1`, không cần key, có giãn nhịp).
  - `jamendo.ts`: gọi API Jamendo.
  - `music.ts` / `stream.ts`: thay cho `src/youtube/*` khi build `--mode web`. Gộp hai nguồn, chọn nguồn theo tiền tố id (`au-`, `jm-`, `lf-` = file tự thêm).
  - `tags.ts`: đọc thẻ ID3/M4A.
  - `local-files.ts`: thêm file từ máy.
  - `service-worker.js`: lưu giao diện để mở offline.
- Hằng số `__WEB_APP__` thay lúc build: phần riêng của từng bản bị loại khỏi bản kia.
