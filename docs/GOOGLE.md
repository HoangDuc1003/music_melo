# 🔑 Đăng nhập Gmail: đồng bộ playlist YouTube / YouTube Music về Melo

Sau khi đăng nhập, **playlist của bạn** (cả playlist tạo trên YouTube Music) và **bài đã thích** hiện trong **Thư viện** của Melo, gắn nhãn **Từ YouTube**. Melo chỉ **đọc**: không sửa, không xoá gì trên YouTube.

- Bài trong playlist là video YouTube nên phát và tải về được ngay. Không phải "ghép bài" như Spotify.
- **Đã thích trên YouTube**: các bài thuộc thể loại *Âm nhạc* mà bạn đã bấm 👍 trên YouTube hoặc YouTube Music.
- Melo tự đồng bộ khi mở app (nếu lần trước đã quá 12 giờ). Playlist không đổi thì bỏ qua. Playlist bị xoá trên YouTube thì Melo cũng xoá.
- Chỉ có ở **app iPhone**. Bản web không có YouTube.

---

## Bước 1: Tạo "OAuth client" trên Google Cloud (một lần, khoảng 5 phút)

Google chỉ cho app cá nhân đọc thư viện YouTube khi bạn tự tạo mã ứng dụng (OAuth client). Làm trên máy tính cho dễ:

1. Vào **https://console.cloud.google.com**, đăng nhập bằng đúng Gmail bạn dùng YouTube.
2. **Tạo project**: bấm ô chọn project trên cùng → **New Project** → tên `Melo` → **Create**.
3. **Bật YouTube Data API**: menu **APIs & Services → Library**, tìm **YouTube Data API v3** → **Enable**.
4. **Màn hình xin quyền**: **APIs & Services → OAuth consent screen** (hoặc **Google Auth Platform → Branding**):
   - User type: **External** → điền tên app `Melo`, email của bạn → lưu.
   - Mục **Audience / Test users**: **Add users** → thêm chính Gmail của bạn.
   - Bấm **Publish app** (Đưa vào hoạt động) để đăng nhập không bị hết hạn sau 7 ngày. Google sẽ cảnh báo "app chưa được xác minh". App chỉ bạn dùng nên không cần xác minh, và cảnh báo này chỉ hiện lúc đăng nhập.
5. **Tạo mã ứng dụng**: **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **TVs and Limited Input devices**. Phải chọn đúng loại này.
   - Tên: `Melo` → **Create**.
6. Google hiện **Client ID** (đuôi `.apps.googleusercontent.com`) và **Client secret**. Copy cả hai, ví dụ gửi vào Ghi chú của iPhone.

> Client secret của loại "TVs and Limited Input devices" không phải mật khẩu tài khoản. Nó chỉ cho Google biết app nào đang xin quyền. Dù vậy, Melo vẫn cất nó trong **Keychain** của iPhone và **không** gắn vào bản build: file IPA công khai trên GitHub nên ai cũng tải về được.

## Bước 2: Nhập vào Melo

1. Melo → **Cài đặt** → mục **YouTube (Gmail)** → **Đăng nhập bằng Gmail**.
2. Lần đầu: dán **Client ID** và **Client secret** → **Lưu**.
3. Bấm **Đăng nhập bằng Gmail** lần nữa. Melo hiện một **mã** (ví dụ `ABCD-EFGH`).
4. Bấm **Mở trang Google** (hoặc mở `google.com/device` trên bất kỳ máy nào), chọn tài khoản Gmail, nhập mã, bấm **Cho phép**.
5. Quay lại Melo: app tự nhận đăng nhập và đồng bộ. Xem kết quả trong **Thư viện**.

## Câu hỏi thường gặp

**Báo "Chưa bật YouTube Data API v3"?** Làm lại bước 1.3 trong đúng project đã tạo Client ID.

**Báo "Client ID hoặc Client secret chưa đúng"?** Kiểm tra loại client phải là **TVs and Limited Input devices**, và dán đủ, không thừa dấu cách.

**Báo "Hết lượt đọc YouTube hôm nay"?** Mỗi project được 10.000 lượt đọc mỗi ngày (miễn phí). Thư viện rất lớn có thể dùng hết; Melo sẽ đồng bộ tiếp vào hôm sau.

**Sau 7 ngày phải đăng nhập lại?** Bạn chưa bấm **Publish app** ở bước 1.4. Khi app còn ở chế độ *Testing*, Google cho phiên đăng nhập hết hạn sau 7 ngày.

**Muốn ngắt kết nối?** Melo → Cài đặt → **Đăng xuất Google**. Melo thu hồi quyền và xoá mã đăng nhập. Bạn cũng có thể gỡ quyền tại https://myaccount.google.com/permissions.

**Gmail có đồng bộ với Spotify không?** Không. Spotify cần kết nối riêng, xem [SPOTIFY.md](SPOTIFY.md). Trên trang của Spotify bạn vẫn có thể chọn "Tiếp tục bằng Google".
