# 🌐 Melo bản web (mở bằng Safari, nghe offline)

Bản web không cần SideStore và không cần máy tính. Bạn mở link bằng Safari rồi bấm **Thêm vào MH chính**, Melo hiện như một app trên iPhone. Nhạc đã tải và file nhạc của bạn **nghe được cả khi không có mạng**.

## So với app iPhone (bản cài bằng SideStore)

| | **App iPhone** | **Bản web** |
|---|---|---|
| Cài đặt | SideStore, gia hạn 7 ngày | Mở link → Thêm vào MH chính |
| Nguồn nhạc | YouTube Music | **Jamendo** (kho nhạc Creative Commons) + **file nhạc của bạn** |
| Tải về nghe offline | ✅ | ✅ (bài nghệ sĩ cho tải + file của bạn) |
| Mở app khi không có mạng | ✅ | ✅ |
| Tắt màn hình vẫn phát, tự chuyển bài | ✅ (phát bằng code iOS gốc) | ⚠️ Thường được, nhưng iOS có thể dừng sau bài đang phát |
| Màn hình khoá: tên bài, ảnh, nút chuyển bài | ✅ | ✅ |
| Đồng bộ Spotify | ✅ | ❌ (cần ghép bài sang YouTube) |

**Vì sao bản web không có YouTube Music?** Trình duyệt chặn trang web gọi thẳng YouTube (CORS). Muốn gọi được thì phải có server trung gian, nhưng Melo không dùng server, và YouTube cũng hay chặn IP của các máy chủ như Vercel. Vì vậy bản web dùng nguồn nhạc cho phép app bên thứ ba dùng hợp lệ.

---

## Bước 1: Đưa bản web lên Vercel (một lần, khoảng 5 phút)

1. Vào **https://vercel.com**, bấm **Sign Up** rồi chọn **Continue with GitHub**.
2. Bấm **Add New… → Project**, chọn repo **music_melo**, bấm **Import**.
3. Không cần sửa gì: Vercel tự đọc file `vercel.json` (lệnh build `npm run build:web`, thư mục `dist-web`). Bấm **Deploy**.
4. Đợi khoảng 1 phút, Vercel cho bạn một link dạng `https://music-melo-xxx.vercel.app`.

Từ đó, mỗi lần đẩy code lên nhánh `main`, Vercel tự build lại bản mới. App trên iPhone tự cập nhật ở lần mở sau.

> Không muốn nhập Client ID trên từng máy? Vào Vercel → **Settings → Environment Variables**, thêm `VITE_JAMENDO_CLIENT_ID` = Client ID của bạn (bước 2) rồi **Redeploy**.

## Bước 2: Lấy Client ID Jamendo (miễn phí, một lần)

1. Mở **https://devportal.jamendo.com**, đăng ký tài khoản.
2. Vào **My Applications → Create a new application**. Tên: `Melo`. Website: link Vercel ở bước 1.
3. Copy **Client ID** (một dãy chữ và số ngắn).

Client ID không phải mật khẩu. Nó chỉ cho Jamendo biết app nào đang gọi.

## Bước 3: Cài lên iPhone

1. Mở link Vercel bằng **Safari**. Chrome trên iPhone không thêm được web app.
2. Bấm nút **Chia sẻ** (ô vuông có mũi tên) → **Thêm vào MH chính** → **Thêm**.
3. Mở **Melo** từ màn hình chính → **Cài đặt** (bánh răng) → **Nguồn nhạc → Jamendo**, dán Client ID, bấm **Lưu**.

## Dùng

- **Nghe nhạc Jamendo:** trang chủ có bài thịnh hành, album, nghệ sĩ, các thể loại. Tìm kiếm theo bài, album, nghệ sĩ, playlist.
- **Tải về:** bấm ⬇ ở album/playlist, hoặc **Tải về** trong menu ⋮ của bài. Có nghệ sĩ chỉ cho nghe online: bài đó báo "không cho tải".
- **Nhạc của bạn:** **Thư viện → Thêm nhạc từ máy**, chọn file MP3/M4A trong app **Tệp** hoặc **iCloud Drive**. Melo đọc tên bài, nghệ sĩ, ảnh bìa có sẵn trong file, rồi lưu vào **Đã tải**. Bạn thích, xếp playlist và nghe offline như bài bình thường.
- **Không có mạng:** mở Melo từ màn hình chính như mọi khi. App chỉ phát bài đã tải.

## Lưu ý

- **Nhạc lưu trong Safari của iPhone này.** Nếu xoá web app khỏi màn hình chính, hoặc vào Cài đặt → Safari → Xoá lịch sử và dữ liệu trang web, nhạc đã tải sẽ mất. **Cài đặt → Bộ nhớ trên máy** cho biết dung lượng đã dùng và còn trống.
- **Phát khi tắt màn hình:** iOS cho web app phát nhạc nền, nhưng chưa ổn định bằng app thật. Nếu nhạc dừng khi hết bài, mở khoá rồi bấm phát tiếp. Muốn chắc chắn thì dùng app iPhone (SideStore).
- **Bản quyền:** nhạc Jamendo theo giấy phép Creative Commons của từng nghệ sĩ, chỉ dùng cá nhân, phi thương mại. Melo ghi công Jamendo ở cuối trang chủ.

## Cho người phát triển

```bash
npm run dev:web     # chạy bản web trên máy tính (gọi Jamendo thật, cần Client ID)
npm run build:web   # build ra dist-web/ (giống Vercel)
npx vite preview --mode web --outDir dist-web   # thử service worker / offline
```

- Code riêng của bản web nằm trong `src/web/`: `jamendo.ts` (gọi API), `music.ts` / `stream.ts` (thay cho `src/youtube/*` khi build `--mode web`), `tags.ts` (đọc thẻ ID3/M4A), `local-files.ts` (thêm file từ máy), `service-worker.js` (lưu giao diện để mở offline).
- Hằng số `__WEB_APP__` thay lúc build: phần riêng của từng bản bị loại khỏi bản kia.
