# Melo

App nghe nhạc kiểu Spotify cho iPhone, dùng cá nhân:

* Tìm và phát nhạc YouTube Music.
* Tắt màn hình vẫn phát, tự chuyển bài.
* Tải về để nghe khi không có mạng.

App chạy hoàn toàn trên điện thoại, không cần server.

Kế hoạch: [docs/PLAN.md](docs/PLAN.md) · Ghi chú kỹ thuật: [CLAUDE.md](CLAUDE.md)

## Cài lên iPhone

Mỗi lần có code mới, GitHub Actions tự build file `Melo.ipa`. File này chưa ký; công cụ sideload sẽ ký bằng Apple ID của bạn khi cài.

**Tải file:** mở [Releases → ios-latest](https://github.com/HoangDuc1003/spoti_music/releases/tag/ios-latest) bằng Safari trên iPhone, rồi tải `Melo.ipa`.

**Cài bằng một trong các công cụ sau** (dùng Apple ID miễn phí, app hết hạn sau 7 ngày nếu không gia hạn):

| Công cụ | Lần đầu | Gia hạn 7 ngày |
|---|---|---|
| **SideStore** (khuyên dùng) | Cần máy Windows/Mac một lần để tạo *pairing file* | Ngay trên iPhone, không cần máy tính |
| AltStore | Cài AltServer trên máy tính | Tự gia hạn qua Wi‑Fi khi máy tính bật AltServer |
| Sideloadly | Cắm cáp vào máy Windows/Mac | Phải cài lại từ máy tính |

Với SideStore: mở **Melo.ipa** → *Chia sẻ* → **SideStore**, hoặc trong SideStore chọn **My Apps → +** rồi chọn file.

**Cài bản mới:** làm lại các bước trên. Nhạc đã tải và thư viện vẫn còn, vì mã app (`com.melo.music`) không đổi.

**Lưu ý:**

* Apple ID miễn phí chỉ cài được tối đa 3 app ngoài store, và SideStore chiếm 1.
* Nên cài Melo trực tiếp, không qua LiveContainer, để phát nền và nhạc đã tải chạy ổn định.

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
