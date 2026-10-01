# Melo và App Store

> Tóm tắt: **bản Melo hiện tại (nhạc lấy từ YouTube) không thể được duyệt lên App Store**, dù chuẩn bị giấy tờ thế nào.
> Muốn lên App Store phải có một phiên bản dùng **nguồn nhạc được phép**. Phần dưới giải thích lý do, nêu các cách làm
> hợp lệ, và checklist hồ sơ cho phiên bản đó.
>
> Đây là phân tích kỹ thuật dựa trên quy định đã công bố của Apple và YouTube, **không phải tư vấn pháp lý**.
> Nếu làm thương mại, hãy hỏi luật sư về sở hữu trí tuệ.

## 1. Vì sao bản hiện tại bị từ chối

| Quy định | Nội dung | Melo hiện tại |
|---|---|---|
| Apple App Review **5.2.3** | Không cho phép lưu, chuyển đổi hoặc tải nội dung từ nguồn bên thứ ba (Apple nêu tên YouTube) khi không có **sự cho phép rõ ràng** của nguồn đó; phải đưa ra giấy tờ khi Apple yêu cầu. | Tải nhạc YouTube về máy để nghe offline. **Vi phạm.** |
| Apple **5.2.2** | Dùng dịch vụ hoặc nội dung của bên thứ ba thì phải được phép theo điều khoản của bên đó. | Gọi API nội bộ (InnerTube) của YouTube Music; YouTube không cho phép. **Vi phạm.** |
| Apple **2.5.2** | App không được tải về rồi chạy mã làm thay đổi tính năng. | youtubei.js chạy mã giải mã link tải từ YouTube; BotGuard chạy mã của Google. **Rủi ro cao.** |
| Điều khoản YouTube | Chỉ được truy cập nội dung qua trình phát và giao diện chính thức; không tải về trừ khi YouTube cho nút tải. | Không dùng trình phát chính thức, tải file nhạc. **Vi phạm.** |
| Chính sách YouTube API Services | API chính thức cũng không cho tách riêng phần âm thanh, phát nền hay tải về. | Ngay cả khi chuyển sang API chính thức, các tính năng chính vẫn bị cấm. |

**Tiền lệ:** Musi, app nghe nhạc YouTube trên iPhone có hàng chục triệu lượt tải, bị Apple gỡ năm 2024 sau khiếu nại của YouTube. Toà án Mỹ năm 2026 xác nhận Apple có quyền gỡ (xem nguồn ở docs/PLAN.md §7).

**Vì sao giấy tờ không giải quyết được:**

* YouTube không cấp giấy phép cho cá nhân để tải hoặc phát lại kho nhạc của họ trong app khác.
* Kho nhạc thuộc các hãng đĩa, nhà xuất bản và tổ chức quản lý quyền (ở Việt Nam là **VCPMC**). Giấy phép phát trực tuyến một kho nhạc lớn là hợp đồng thương mại cỡ Spotify hay Apple Music, không phải thủ tục cá nhân xin được.

## 2. Các cách hợp lệ

### 2a. Dùng cá nhân (đang làm)

App cho chính bạn dùng, không phát hành công khai:

| Cách | Ghi chú |
|---|---|
| SideStore / AltStore (miễn phí) | Đang dùng. Gia hạn 7 ngày. |
| **Ad Hoc** (99 USD/năm) | Cài 1 chạm từ Safari, tối đa 100 máy đã đăng ký. Đã dựng sẵn trong CI, xem `docs/CAI_DAT.md`. |
| TestFlight, nhóm nội bộ | Không qua duyệt, nhưng vẫn phải tuân thủ thoả thuận nhà phát triển của Apple. Nên dùng Ad Hoc cho bản YouTube. |

### 2b. Phiên bản có thể lên App Store (đổi nguồn nhạc)

Giữ nguyên giao diện, trình phát nền, tải về và hàng chờ của Melo; chỉ thay **nguồn nhạc** bằng nguồn được phép:

| Nguồn | Hợp lệ vì | Ghi chú |
|---|---|---|
| **Nhạc của chính người dùng** (nhập file từ app Tệp / iCloud Drive) | Người dùng sở hữu file | Nhiều app nghe nhạc trên App Store làm vậy. Dễ nhất, không cần server. |
| **Máy chủ nhạc riêng** của người dùng (Navidrome, Jellyfin, chuẩn Subsonic) | Người dùng tự host nhạc của mình | Có tiền lệ trên App Store (Amperfy, play:Sub). |
| **Nhạc Creative Commons** (ví dụ Jamendo API) | Giấy phép CC; API cho phép app bên thứ ba | Phải ghi công tác giả; dùng thương mại cần gói riêng. |
| **Apple Music** qua MusicKit | API chính thức của Apple | Người dùng phải có gói Apple Music; Apple lo bản quyền. |

**Về kỹ thuật:** cả phần nói chuyện với YouTube đã gom trong `src/youtube/`, nên có thể:

* thêm lớp "nguồn nhạc" chung;
* làm bản build riêng cho App Store (ví dụ `VITE_FLAVOR=store`) **loại hẳn** youtubei.js và BotGuard khỏi app; cách này cũng giải quyết luôn quy định 2.5.2.

Việc này chưa làm; hãy báo nếu bạn muốn làm.

## 3. Checklist hồ sơ (cho phiên bản hợp lệ ở 2b)

### Tài khoản

* [ ] **Apple Developer Program** 99 USD/năm.
  * Cá nhân: giấy tờ tùy thân, thẻ thanh toán quốc tế, xác minh danh tính.
  * Nếu đăng ký dưới tên công ty thì cần thêm **D-U-N-S Number** (miễn phí, xin qua Dun & Bradstreet).
* [ ] App Store Connect → **Agreements, Tax, and Banking**: app miễn phí chỉ cần thoả thuận Free Apps; thu phí hoặc bán trong app thì cần thêm thông tin thuế và ngân hàng.

### Thông tin app

* [ ] Tên app không trùng nhãn hiệu đã có. Kiểm tra "Melo" trên App Store và cơ sở dữ liệu nhãn hiệu (Cục Sở hữu trí tuệ Việt Nam, USPTO); có thể phải đổi tên.
* [ ] Bundle ID. Có thể dùng mã khác `com.melo.music` để tách hẳn khỏi bản cá nhân.
* [ ] Danh mục: **Music**. Ngôn ngữ chính: tiếng Việt.
* [ ] **Privacy Policy URL**: bắt buộc. Nháp sẵn ở `docs/privacy-policy.md`, đăng lên GitHub Pages là có URL.
* [ ] Support URL (có thể là trang GitHub của dự án).
* [ ] Ảnh chụp màn hình iPhone 6,9 inch (1320×2868). `scripts/ui-smoke.mjs` chụp được giao diện; cần chụp lại đúng kích thước.
* [ ] Mô tả, từ khoá, phụ đề, bằng tiếng Việt và tiếng Anh.

### Quyền riêng tư và tuân thủ

* [x] **Privacy manifest** `PrivacyInfo.xcprivacy`: đã có. Khai không theo dõi, không thu thập dữ liệu.
* [ ] **App Privacy** trong App Store Connect: chọn **Data Not Collected**. Đúng với kiến trúc hiện tại: không server, không analytics, dữ liệu chỉ nằm trên máy.
* [x] **Export compliance**: `ITSAppUsesNonExemptEncryption = false` đã có. App chỉ dùng HTTPS có sẵn của iOS nên được miễn.
* [ ] **Age rating**: trả lời bảng hỏi trung thực. Lời bài hát có thể có nội dung người lớn, nên mức tuổi có thể cao hơn.
* [ ] **Content Rights**: xác nhận có quyền với mọi nội dung trong app. Đây là câu bản YouTube không thể trả lời "có".
* [ ] Guideline 4.2 (tính năng tối thiểu): app có trình phát native, phát nền, tải về, không chỉ là trang web bọc lại, nên ổn.

### Gửi duyệt

1. Build có ký bằng chứng chỉ **Apple Distribution** với hồ sơ **App Store** (khác hồ sơ Ad Hoc).
2. Tải lên bằng `xcrun altool` / Transporter, hoặc App Store Connect API trong CI.
3. TestFlight (nhóm nội bộ) để thử.
4. Gửi duyệt kèm ghi chú: nguồn nhạc lấy từ đâu và giấy phép là gì.

## 4. Quy định ở Việt Nam (tham khảo)

* Đưa app miễn phí, cá nhân lên App Store không cần giấy phép riêng của Nhà nước.
* Tuy nhiên, cung cấp nhạc cho công chúng phải có quyền tác giả và quyền liên quan (Luật Sở hữu trí tuệ). Tác phẩm âm nhạc thường do **VCPMC** cấp phép; bản ghi âm thuộc hãng đĩa hoặc nhà sản xuất.
* Nếu sau này có tính năng mạng xã hội (bình luận, chia sẻ công khai), cần xem thêm quy định về dịch vụ Internet và thông tin trên mạng (Nghị định 147/2024/NĐ-CP).
* Làm thương mại thì nên hỏi luật sư.
