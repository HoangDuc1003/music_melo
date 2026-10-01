# Melo

App nghe nhạc kiểu Spotify cho iPhone, dùng cá nhân:

* Tìm và phát nhạc YouTube Music.
* Tắt màn hình vẫn phát, tự chuyển bài.
* Tải về để nghe khi không có mạng.

App chạy hoàn toàn trên điện thoại, không cần server.

Kế hoạch: [docs/PLAN.md](docs/PLAN.md) · Ghi chú kỹ thuật: [CLAUDE.md](CLAUDE.md)

## Cài lên iPhone

Hướng dẫn đầy đủ: **[docs/CAI_DAT.md](docs/CAI_DAT.md)**.

* **Miễn phí (SideStore):** thêm source `https://github.com/HoangDuc1003/spoti_music/releases/download/ios-latest/source.json` vào SideStore một lần. Sau đó các bản mới chỉ cần bấm **Update** (gia hạn 7 ngày/lần).
* **Cài 1 chạm, không cần app thứ ba:** cần tài khoản Apple Developer (99 USD/năm) và làm theo các bước trong `docs/CAI_DAT.md`. Sau đó chỉ cần mở **https://hoangduc1003.github.io/spoti_music/** bằng Safari rồi bấm **Cài đặt Melo**.
* Nhạc đã tải và thư viện vẫn còn khi cài bản mới, vì mã app (`com.melo.music`) không đổi.
* Melo không thể lên App Store (lý do và cách làm hợp lệ: [docs/APP_STORE.md](docs/APP_STORE.md)).

## Dùng app

* **Trang chủ / Tìm kiếm / Thư viện** giống Spotify.
  * Tìm kiếm có gợi ý khi gõ.
  * Dán link playlist YouTube vào ô tìm kiếm để mở playlist đó.
* **Trình phát:**
  * Chạm vào trình phát mini để mở to; vuốt ngang trình phát mini để chuyển bài.
  * Trong trình phát toàn màn hình: vuốt xuống để đóng, có lời bài hát chạy theo nhạc, hàng chờ kéo thả được, hẹn giờ tắt.
* **Menu ⋮ của mỗi bài:** Phát tiếp, Thêm vào hàng chờ, Thích, Thêm vào playlist, Tải về, Radio, Đi tới album/nghệ sĩ.
* **Tải về:** bấm ⬇ ở album/playlist để tải cả danh sách. Khi mất mạng, app chỉ phát bài đã tải. Có thể bật "Tự tải bài hát đã thích" trong Cài đặt.
* **Vuốt từ mép trái màn hình** để quay lại trang trước.

**Khi có lỗi:** vào **Cài đặt → Nhật ký lỗi → nút Copy**, rồi gửi nội dung đó cho người sửa app. Nhật ký đã tự ẩn IP, link nhạc và token.

## Dành cho người phát triển

```bash
npm install
npm run dev        # chạy trên PC qua proxy của Vite (http://localhost:5173)
npm run dev:mock   # dữ liệu mẫu, không cần YouTube (để làm giao diện)
npm test           # vitest
npm run build      # kiểm tra kiểu + build
cd plugins/player && swift test   # test hàng chờ native (macOS/Linux)
```

Muốn mở bản dev từ iPhone cùng Wi‑Fi: `MELO_LAN=1 npm run dev`. Lưu ý lệnh này mở cả proxy dev ra mạng LAN.

## Lưu ý

* Dự án chỉ dùng cho cá nhân, không phát hành lên App Store, không chia sẻ file IPA.
* Repo đang để public để GitHub Actions trên macOS được miễn phí. Không bao giờ đưa mật khẩu hay token vào code; CI có bước quét bí mật (gitleaks).
