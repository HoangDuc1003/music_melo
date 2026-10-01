# Cài Melo lên iPhone

Có hai cách:

| | Cách 1: SideStore (miễn phí) | Cách 2: Cài 1 chạm (Ad Hoc) |
|---|---|---|
| Chi phí | 0 đ | Tài khoản Apple Developer **99 USD/năm** |
| Cần app thứ ba | Có (SideStore) | **Không**: mở trang web bằng Safari, bấm Cài đặt |
| Hết hạn | 7 ngày (gia hạn trong SideStore) | 1 năm (theo hồ sơ Ad Hoc) |
| Cập nhật bản mới | Bấm Cập nhật trong SideStore | Mở lại trang cài đặt, bấm Cài đặt |
| Máy cài được | Máy có SideStore | Chỉ iPhone đã đăng ký mã máy (UDID), tối đa 100 máy/năm |

Apple không cho cài file IPA khi chưa được ký. Với Apple ID miễn phí, việc ký bắt buộc phải qua một công cụ như SideStore, AltStore hoặc Sideloadly. Muốn bỏ hẳn công cụ đó thì chỉ còn cách dùng tài khoản trả phí (cách 2).

---

## Cách 1: SideStore (miễn phí)

1. Cài SideStore theo hướng dẫn ở https://sidestore.io. Lần đầu cần máy tính để tạo "pairing file".
2. iOS 16 trở lên: bật **Cài đặt → Quyền riêng tư & Bảo mật → Chế độ nhà phát triển**.
3. Thêm "source" của Melo (chỉ làm một lần):
   * SideStore → **Sources** → **+** → dán:
     `https://github.com/HoangDuc1003/spoti_music/releases/download/ios-latest/source.json`
   * Hoặc mở trang cài đặt (nếu đã bật GitHub Pages, xem bên dưới) rồi bấm **Thêm vào SideStore**.
4. Trong source **Melo**, bấm **Get**. Các bản sau chỉ cần bấm **Update**.
5. Mỗi 7 ngày mở SideStore bấm **Refresh**, hoặc bật tự gia hạn bằng Phím tắt (Shortcuts).

Không muốn thêm source thì có thể tải **Melo.ipa** ở trang [Releases](https://github.com/HoangDuc1003/spoti_music/releases/tag/ios-latest) rồi mở bằng SideStore.

---

## Cách 2: Cài 1 chạm (Ad Hoc), không cần Mac

Làm một lần trên máy Windows (dùng **Git Bash**, có sẵn `openssl`), khoảng 20 phút.

### Bước 1: Tài khoản và thiết bị

1. Đăng ký **Apple Developer Program** (cá nhân) tại https://developer.apple.com/programs/enroll/.
2. Lấy **UDID** của iPhone. Trên Windows: cắm iPhone, mở **iTunes**, chọn iPhone, bấm vào dòng **Số sê-ri** cho tới khi hiện **UDID**, rồi chuột phải để copy.
3. Vào https://developer.apple.com/account/resources/devices → **+** → nhập tên và UDID.
4. Vào **Identifiers → +** → **App IDs → App**, đặt *Bundle ID* là **Explicit** `com.melo.music`. Không cần bật capability nào.

### Bước 2: Chứng chỉ Apple Distribution (trong Git Bash)

```bash
mkdir melo-signing && cd melo-signing
openssl req -new -newkey rsa:2048 -nodes -keyout melo.key -out melo.csr \
  -subj "/emailAddress=EMAIL_CUA_BAN/CN=Melo Distribution/C=VN"
```

1. Vào https://developer.apple.com/account/resources/certificates → **+** → **Apple Distribution** → tải lên `melo.csr` → tải về `distribution.cer` và đặt vào thư mục `melo-signing`.
2. Đổi sang file `.p12`, thay `MAT_KHAU_P12` bằng mật khẩu tự đặt:

```bash
openssl x509 -inform DER -in distribution.cer -out distribution.pem
openssl pkcs12 -export -inkey melo.key -in distribution.pem -out melo.p12 \
  -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1 -passout pass:MAT_KHAU_P12
```

> `melo.key` và `melo.p12` là **bí mật**. Không gửi cho ai, không đưa vào repo (repo đang public).

### Bước 3: Hồ sơ Ad Hoc

Vào https://developer.apple.com/account/resources/profiles → **+** → **Ad Hoc**, rồi chọn lần lượt:

1. App ID `com.melo.music`
2. chứng chỉ vừa tạo
3. iPhone của bạn

Đặt tên `Melo Ad Hoc` và tải về file `.mobileprovision`.

> Thêm iPhone mới thì phải tạo lại hồ sơ, rồi cập nhật secret ở bước 4.

### Bước 4: Đưa vào GitHub Secrets

Trong Git Bash, chép từng giá trị (dùng `cat file | clip` để copy trên Windows):

```bash
base64 -w0 melo.p12 > p12.txt
base64 -w0 "Melo_Ad_Hoc.mobileprovision" > profile.txt
```

Vào **GitHub → repo → Settings → Secrets and variables → Actions → New repository secret** và tạo 3 secret:

| Tên | Giá trị |
|---|---|
| `SIGNING_CERT_P12_BASE64` | nội dung `p12.txt` |
| `SIGNING_CERT_PASSWORD` | `MAT_KHAU_P12` |
| `ADHOC_PROFILE_BASE64` | nội dung `profile.txt` |

Sau đó xoá `p12.txt` và `profile.txt`.

### Bước 5: Bật trang cài đặt

**Settings → Pages → Build and deployment → Source: GitHub Actions.**

### Bước 6: Build và cài

1. Vào **Actions → iOS → Run workflow**, hoặc đẩy code mới lên.
2. Khi chạy xong, mở **https://hoangduc1003.github.io/spoti_music/** bằng **Safari** trên iPhone.
3. Bấm **Cài đặt Melo** → **Cài đặt**.

App hiện trên màn hình chính, không cần SideStore và không hết hạn sau 7 ngày. Ad Hoc không cần bật Chế độ nhà phát triển.

**Cập nhật:** mỗi lần CI chạy xong, mở lại trang và bấm **Cài đặt Melo**. Nhạc đã tải vẫn còn vì mã app không đổi.

### Khi có lỗi

| Hiện tượng | Cách xử lý |
|---|---|
| "Không thể cài đặt Melo" | iPhone chưa có trong hồ sơ Ad Hoc → thêm UDID, tạo lại hồ sơ, cập nhật `ADHOC_PROFILE_BASE64`. |
| Job "Ký Ad Hoc" báo lỗi `.p12` | Sai mật khẩu, hoặc file `.p12` không chứa khoá → làm lại bước 2. |
| Trang `github.io` báo 404 | Chưa bật Pages (bước 5), hoặc lượt build chưa xong. |
| App mở ra rồi thoát ngay | Chứng chỉ hoặc hồ sơ hết hạn → tạo lại (1 năm một lần). |

Bước ký chạy trong CI bằng `scripts/adhoc-sign.sh`. Các bí mật chỉ nằm trong GitHub Secrets và một keychain tạm bị xoá ngay sau khi ký.
