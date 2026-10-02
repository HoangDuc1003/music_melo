# Đồng bộ Spotify với Melo

Melo đọc **playlist** và **Bài hát đã thích** trong Spotify của bạn, tìm từng bài trên YouTube Music rồi tạo thành playlist trong Melo (nhãn **Từ Spotify**). Sau đó app tự đồng bộ mỗi khi mở, nếu lần trước đã quá 12 giờ.

> **Đăng nhập Gmail không tự đồng bộ Spotify.** Spotify là tài khoản riêng: Melo phải được Spotify cho phép qua trang đăng nhập của Spotify. Nếu tài khoản Spotify của bạn tạo bằng Google, trên trang đó bấm **Tiếp tục bằng Google** là xong.

## Điều kiện (quy định của Spotify từ 2/2026)

* Spotify không cho app cá nhân dùng chung một "chìa khoá". Mỗi người phải tự tạo một **app Spotify** (Development Mode) để lấy **Client ID**.
* Người tạo app Spotify phải có **Spotify Premium**. Mỗi người chỉ được 1 Client ID, tối đa 5 tài khoản dùng.
* Chỉ đọc được playlist **bạn tạo** hoặc **cùng chỉnh sửa**. Playlist của người khác mà bạn theo dõi (kể cả playlist do Spotify làm) sẽ bị bỏ qua. Muốn có thì trong Spotify chọn **Thêm vào playlist khác** để chép sang playlist của bạn.
* Sau **6 tháng** Spotify bắt đăng nhập lại. Melo sẽ báo, bạn chỉ cần bấm **Kết nối Spotify** lần nữa.

Không có Premium thì dùng [cách nhập từ file](#không-có-premium-nhập-từ-file-dữ-liệu-spotify).

## Cách 1: Kết nối và tự đồng bộ (cần Premium)

### Bước 1: Tạo app Spotify (làm 1 lần, khoảng 3 phút)

1. Mở **https://developer.spotify.com/dashboard**, đăng nhập Spotify, chấp nhận điều khoản nhà phát triển.
2. Bấm **Create app** và điền:

   | Ô | Điền |
   |---|---|
   | App name | `Melo` |
   | App description | `Personal music app` |
   | Redirect URIs | `com.melo.music://spotify/callback` rồi bấm **Add** |
   | Which API/SDKs are you planning to use? | **Web API** |

3. Tích ô đồng ý, bấm **Save**.
4. Trong app vừa tạo, vào **Settings** rồi copy **Client ID** (32 ký tự).
5. Nếu sau này đăng nhập bị báo *"User not registered in the Developer Dashboard"*: vào **User Management** và thêm email tài khoản Spotify của bạn.

Client ID không phải mật khẩu (Melo không cần *Client secret*). Không gửi *Client secret* cho ai.

### Bước 2: Kết nối trong Melo

1. Melo: **Thư viện → ⚙ Cài đặt → Spotify → Kết nối Spotify**.
2. Dán **Client ID**, rồi bấm **Lưu và đăng nhập Spotify**.
3. Trang Spotify mở ra. Đăng nhập (có thể bấm **Tiếp tục bằng Google**), rồi bấm **Đồng ý**.
4. App tự quay lại Melo và bắt đầu đồng bộ. Mục Spotify hiện tiến độ, ví dụ "Đang tìm bài trên YouTube Music 12/240".

Xong. Từ giờ:

* Playlist hiện trong **Thư viện**, dưới **Playlist của tôi**, có ghi **Từ Spotify**.
* Mở app sau 12 giờ thì tự đồng bộ. Muốn ngay thì bấm **Đồng bộ ngay**. Có thể tắt **Tự đồng bộ khi mở app**.
* Playlist không đổi trên Spotify thì không tải lại. Lần sau nhanh hơn nhiều vì bài đã ghép được nhớ lại.

## Đồng bộ thế nào

| Trên Spotify | Trong Melo |
|---|---|
| Playlist bạn tạo / cùng chỉnh sửa | Playlist cùng tên, nhãn **Từ Spotify** |
| Bài hát đã thích | Playlist **Bài hát đã thích trên Spotify** |
| Đổi tên, thêm/bớt bài | Lần đồng bộ sau cập nhật theo |
| Xoá playlist | Xoá luôn bản trong Melo |
| Bài không có trên YouTube Music | Bỏ qua, có ghi số bài thiếu; 7 ngày sau thử tìm lại |

* Đồng bộ **một chiều** (Spotify sang Melo). Melo không sửa gì trên Spotify.
* Sửa playlist **Từ Spotify** trong Melo thì sẽ bị ghi đè ở lần đồng bộ sau. Muốn giữ bản riêng: bấm ⋮ trên bài và chọn **Thêm vào playlist** sang playlist tự tạo.
* Ghép bài dựa trên tên bài, nghệ sĩ và thời lượng. Bản cover của ca sĩ khác hoặc bài khác tên sẽ không bị ghép nhầm.
* Muốn nghe offline: mở playlist rồi bấm ⬇ để tải cả danh sách.

## Không có Premium: nhập từ file dữ liệu Spotify

Spotify cho mọi tài khoản tải về dữ liệu của mình, kể cả tài khoản miễn phí. Cách này **không tự đồng bộ**: mỗi lần muốn cập nhật phải làm lại.

1. Trên máy tính hoặc điện thoại, mở **https://www.spotify.com/account/privacy/**.
2. Ở mục **Tải dữ liệu của bạn**, chọn **Dữ liệu tài khoản**, rồi bấm **Yêu cầu dữ liệu** và xác nhận qua email.
3. Vài ngày sau Spotify gửi email có file `.zip`. Tải về iPhone và mở trong app **Tệp** để giải nén.
4. Melo: **Cài đặt → Spotify → Nhập từ file dữ liệu Spotify**, chọn các file sau (chọn được nhiều file cùng lúc):
   * `Playlist1.json` (có thể có thêm `Playlist2.json`…): các playlist của bạn;
   * `YourLibrary.json`: bài hát đã thích.

## Khi có lỗi

| Hiện tượng | Cách xử lý |
|---|---|
| `INVALID_CLIENT: Invalid redirect URI` | Redirect URI trong app Spotify phải đúng `com.melo.music://spotify/callback` (chữ thường, không dấu cách). |
| *User not registered in the Developer Dashboard* | **User Management** của app Spotify → thêm email Spotify của bạn. |
| Báo cần Premium / 403 | Người tạo app Spotify cần Premium (quy định từ 2/2026). Dùng cách nhập từ file. |
| "Phiên Spotify đã hết hạn" | Bấm **Kết nối Spotify** lại (Spotify bắt đăng nhập lại sau 6 tháng hoặc khi bạn gỡ quyền). |
| Thiếu playlist | Playlist của người khác không đọc được. Chép sang playlist của bạn trong Spotify. |
| Thiếu vài bài | Bài chưa có trên YouTube Music. Số bài thiếu hiện dưới tên playlist. |
| Khác | **Cài đặt → Nhật ký lỗi → Copy** rồi gửi đi. Nhật ký đã tự ẩn mã đăng nhập và token. |

## Quyền riêng tư

* Melo chỉ xin quyền **đọc**: `playlist-read-private`, `playlist-read-collaborative`, `user-library-read`. Không sửa, không phát, không xem email.
* Token đăng nhập lưu trong **Keychain** của iPhone, không lưu trong bộ nhớ trang web của app, không gửi đi đâu ngoài Spotify.
* iPhone nói chuyện **trực tiếp** với Spotify, không qua máy chủ nào.
* Gỡ quyền bất cứ lúc nào: bấm **Ngắt kết nối Spotify** trong Melo, hoặc vào https://www.spotify.com/account/apps/.

## Cho người phát triển

* Mã nguồn: `src/sync/`.
  * `spotify-auth.ts`: PKCE, Keychain.
  * `spotify-api.ts`: Web API, endpoint mới `/playlists/{id}/items`.
  * `match.ts`: ghép bài sang YouTube Music.
  * `spotify-sync.ts`: đồng bộ và nhập file.
* Chạy thử trên PC với Spotify thật: trong app Spotify thêm Redirect URI `http://127.0.0.1:5173/spotify/callback`, rồi mở `http://127.0.0.1:5173` (Spotify không cho dùng `localhost`).
* `npm run dev:mock` có thư viện Spotify mẫu (`src/sync/mock/`): bấm **Kết nối Spotify** là đồng bộ ngay.
