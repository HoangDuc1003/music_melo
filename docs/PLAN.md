# Plan: App nghe nhạc kiểu Spotify cho iPhone (nhạc YouTube, tải về nghe offline, tắt màn hình vẫn phát, không cần server)

> **Tiến độ (01/10/2026):** GĐ1–GĐ4 và GĐ6 đã xong: plugin Swift, CI build IPA, giao diện, tải về/offline,
> bảo mật, tối ưu độ mượt. Chưa thử trên iPhone thật. Còn lại: GĐ5 (đăng nhập Gmail + nhập playlist).
> Chi tiết kỹ thuật và việc tiếp theo: [CLAUDE.md](../CLAUDE.md).

## 1. Bối cảnh

- Thư mục `music/` đang trống, nên đây là dự án làm mới từ đầu.
- Bạn muốn: chỉ cần **một chiếc iPhone**. Mở app là nghe ngay, muốn nghe offline thì bấm tải. App siêu nhẹ, giao diện như Spotify, dùng cá nhân, không thương mại.
- Vì sao làm **app** chứ không làm web:
  - Web chạy trong trình duyệt không được gọi thẳng tới YouTube (trình duyệt chặn, gọi là CORS).
  - Link file nhạc YouTube chỉ dùng được trên đúng địa chỉ IP đã lấy ra link đó. Nên web bắt buộc phải có server ở giữa.
  - Ngoài ra, web app trên iOS còn có lỗi WebKit khiến nhạc không tự chuyển bài khi khóa máy.
  - App native thì gọi YouTube ngay từ điện thoại, giống NewPipe hay Metrolist. Không cần server, máy tính không cần bật.
- Những điểm đã chốt:
  - **Bản cá nhân.** Không đưa lên App Store, vì quy định 5.2.3 của Apple và chính sách YouTube API đều cấm tải nhạc YouTube; app Musi bị gỡ khỏi App Store năm 2024.
  - **Chỉ làm cho iPhone.**
  - **Đăng nhập Gmail không bắt buộc**, chỉ dùng khi muốn nhập playlist và bài đã thích từ YouTube.
- Máy tính của bạn: Windows, đã có Node 24, npm, Git, winget. **Không có Mac**, nên bản iPhone sẽ được build trên cloud (GitHub Actions có máy macOS) và cài bằng **SideStore**.

## 2. Khảo sát repo và ứng dụng

| Dự án | Nền tảng / công nghệ | Lấy nhạc từ đâu | Tình trạng | Điều ta học được |
|---|---|---|---|---|
| [Spotube](https://github.com/KRTirtho/spotube) (~49.5k★) | Flutter; có bản iOS dạng file IPA, cài qua AltStore | Plugin: YouTube, Piped, Invidious | Đang phát triển | Giao diện kiểu Spotify; **trên iPhone chỉ cài ngoài store**, giống hướng của ta |
| [Metrolist](https://github.com/mostafaalagamy/Metrolist) (~13.2k★, GPL-3) | Kotlin, Android | InnerTube (API nội bộ của YouTube Music), gọi ngay trên máy | Chỉ còn sửa lỗi | Không cần server; tải về/cache offline, lời bài hát, hẹn giờ tắt |
| [SimpMusic](https://github.com/maxrave-dev/SimpMusic) (~11.6k★, GPL-3) | Compose Multiplatform | API nội bộ của YouTube Music, gọi ngay trên máy | Đang phát triển | Nhiều tính năng giống Spotify, phát nền, offline |
| [Musify](https://github.com/gokadzev/Musify) (~4.3k★, GPL-3) | Flutter, Android | YouTube, gọi ngay trên máy | Đang phát triển | Giao diện đơn giản, tải về, nhập playlist |
| [Harmony Music](https://github.com/anandnet/Harmony-Music) (~3.1k★) | Flutter | youtube_explode_dart | **Đã ngừng bảo trì** | Tự viết bộ lấy nhạc thì rất nhanh hỏng |
| [Beatbump](https://github.com/snuffyDev/Beatbump) (~1.1k★) | SvelteKit, web app | Có proxy | **Ngừng phát triển từ 10/2025** "do các thay đổi của YouTube" | Hướng web + proxy dễ chết |
| [ytify](https://github.com/n-ce/ytify) (~450★) | SolidJS, web app | YouTube.js qua proxy | Đang phát triển | Cách tổ chức giao diện, lời bài hát từ LRCLIB |
| [Feishin](https://github.com/jeffvli/feishin) (~10k★) | React + TS | Navidrome/Jellyfin | Đang phát triển | Mẫu React kiểu Spotify: hàng chờ, trình phát toàn màn hình, lời bài hát |
| [FreeTube](https://github.com/FreeTubeApp/FreeTube) | Electron | **youtubei.js** (giấy phép MIT) + bgutils-js (PO token) | Đang phát triển, nhiều người dùng | Chứng minh youtubei.js chạy ổn trong môi trường trình duyệt, kể cả khi YouTube đòi "PO token" (mã xác thực nguồn gốc) |

**Bài học áp dụng:**
1. Mọi app có tính năng tải nhạc YouTube đều cài ngoài store. Trên iPhone, ta cài bằng SideStore (Spotube cũng phát hành iOS theo cách này).
2. Các app chạy ngay trên máy (Metrolist, SimpMusic, Musify) không cần server. Ta làm giống vậy, dùng **youtubei.js** chạy trong app. Thư viện này có giấy phép MIT và được FreeTube dùng nên được bảo trì tốt.
3. YouTube thay đổi liên tục. Toàn bộ code nói chuyện với YouTube gom vào thư mục `src/youtube/`; khi hỏng chỉ cần cập nhật thư viện và build lại.
4. **Phát nền phải làm bằng code native.** Khi app ra nền, iOS tạm dừng phần giao diện web và JavaScript ngừng chạy, nên không tự chuyển bài được. Vì vậy hàng chờ và trình phát phải nằm ở phần native (Swift).
5. Hầu hết repo trên là GPL. Ta chỉ học ý tưởng, **không chép code**.
6. YouTube Data API có giới hạn lượt gọi mỗi ngày, nên chỉ dùng nó để nhập playlist (rất ít tốn).

## 3. Kiến trúc

```
iPhone: app (tên tạm "Melo"), đóng gói bằng Capacitor, khoảng 10–15MB
┌──────────────────────────────────────────────────────────────────────┐
│ Giao diện (chạy trong WebView): React + Tailwind, kiểu Spotify, TV  │
│  ├─ src/youtube/   youtubei.js: tìm kiếm, trang chủ, album, nghệ sĩ, │
│  │                 playlist, radio, lời bài hát, lấy link audio m4a  │
│  │                 (gọi qua HTTP native → không bị CORS, dùng IP máy)│
│  ├─ src/downloads/ tải file nhạc vào bộ nhớ app (file-transfer)      │
│  └─ IndexedDB (Dexie): thư viện, playlist, lịch sử, cài đặt          │
│ Plugin "Player" tự viết bằng Swift:                                  │
│   AVPlayer + hàng chờ do native giữ + màn hình khóa/Control Center/  │
│   tai nghe → vẫn tự chuyển bài khi giao diện web bị iOS tạm dừng     │
└──────────────────────────────────────────────────────────────────────┘
      │ HTTPS gọi thẳng từ iPhone
      ▼
YouTube Music (InnerTube) · googlevideo (file nhạc) · LRCLIB (lời) · YouTube Data API (nhập playlist, không bắt buộc)
```

**Công nghệ dùng:**
- App: Capacitor 8 (iOS), React 19 + Vite + TypeScript, Tailwind CSS v4, React Router, Zustand (trạng thái trình phát), TanStack Query (cache dữ liệu), Dexie (IndexedDB), lucide-react (icon). Font Be Vietnam Pro được đóng gói kèm app.
- Lớp YouTube:
  - youtubei.js, đặt `lang: 'vi'` và `location: 'VN'` để ra nội dung Việt Nam.
  - bgutils-js để tạo PO token khi YouTube yêu cầu.
  - Mọi lệnh gọi mạng đi qua `CapacitorHttp` (HTTP native, không bị CORS).
  - Phần giải mã link nhạc chạy bằng `new Function` (gán vào `Platform.shim.eval`).
- Plugin: `@capacitor/file-transfer` (tải file, có % tiến độ), `@capacitor/filesystem`, `@capacitor/network`, `@capacitor/browser`, `@capacitor/preferences`, cộng plugin `Player` tự viết.
- Build: GitHub Actions trên máy macOS tạo file IPA chưa ký; SideStore ký bằng Apple ID của bạn khi cài.

**Cấu trúc thư mục:**
```
music/
├─ package.json · vite.config.ts · capacitor.config.ts · index.html
├─ src/
│  ├─ youtube/     client.ts (Innertube + HTTP native + eval + PO token) · music.ts · stream.ts · normalize.ts · types.ts
│  ├─ player/      store.ts (hàng chờ, ngẫu nhiên, lặp lại; lưu lại khi tắt app) · controller.ts (nối giao diện ↔ plugin, chuẩn bị link trước)
│  ├─ downloads/   manager.ts (hàng đợi tải, file nhạc + ảnh bìa + .json thông tin bài)
│  ├─ lib/         db.ts (Dexie) · youtubeAccount.ts (kết nối Gmail + Data API) · lyrics.ts (LRCLIB) · log.ts (nhật ký lỗi)
│  ├─ components/  TabBar · MiniPlayer · FullPlayer · QueueSheet · LyricsView · TrackRow · MediaCard · Shelf
│  └─ pages/       Home · Search · Album · Artist · Playlist · Library · Downloads · Settings · Logs
├─ plugins/player/ definitions.ts · web.ts (dùng thẻ audio HTML5 để chạy thử trên PC) · ios/ (Swift + test Swift)
├─ ios/            project Xcode do Capacitor tạo (Info.plist: UIBackgroundModes = audio)
└─ .github/workflows/ios.yml   # build IPA → GitHub Releases
```

## 4. Các giai đoạn

### GĐ0: Chuẩn bị
1. **GitHub:** tạo repo riêng tư (private). Gói miễn phí đủ chạy vài chục lần build iOS mỗi tháng.
2. **iPhone:** cài SideStore với Apple ID miễn phí. Lần cài đầu cần máy Windows để tạo "pairing file" (file ghép nối máy); từ đó về sau gia hạn ngay trên điện thoại.
3. **Google Cloud** (để dành cho GĐ5):
   - Tạo project, bật YouTube Data API v3.
   - Consent screen: chọn External, để chế độ Testing, thêm Gmail của bạn vào danh sách test.
   - Tạo OAuth client loại **"TVs and Limited Input devices"**.
   - Lưu Client ID và Secret vào GitHub Secrets để lúc build tự điền vào app; không ghi vào code.
4. Mình tạo khung dự án: Vite + React + TS + Tailwind + Capacitor iOS, bundle ID cố định (để cập nhật app không mất nhạc đã tải).

### GĐ1: Lớp YouTube chạy trong app (làm và thử trên PC trước)
- **`youtube/client.ts`:**
  - Khởi tạo `Innertube.create({ lang: 'vi', location: 'VN', fetch: nativeFetch, cache })`.
  - `nativeFetch` dùng `CapacitorHttp` khi chạy trên iPhone. Khi chạy thử trên PC thì dùng proxy của Vite (chỉ dùng lúc phát triển, không có trong app thật).
- **`youtube/music.ts`:** các hàm `search` (kèm gợi ý khi gõ), `getHomeFeed` (nếu lỗi thì dùng `getExplore`), `getAlbum`, `getArtist`, `getPlaylist`, `getUpNext` (radio, tự phát tiếp), `getLyrics`. Dữ liệu chuẩn hóa thành các kiểu `Track`, `Album`, `Artist`, `Playlist`.
- **`youtube/stream.ts`:** hàm `resolveAudio(videoId)`.
  - Trả về link file nhạc m4a/AAC (ưu tiên itag 140, tức AAC 128kbps), kèm header cần gửi và thời điểm hết hạn.
  - Thử lần lượt nhiều "client" của YouTube: trước là YTMUSIC kèm PO token tạo bằng bgutils-js, sau đó tới các client dự phòng.
  - Nhớ link đã lấy cho đến gần lúc hết hạn.
  - Báo lỗi rõ ràng khi video bị giới hạn độ tuổi hoặc không xem được.
- **Thử nghiệm:** trên Chrome ở PC, tìm bài → lấy link → phát thử.

### GĐ2: Plugin Player native (Swift) và bản dùng thử trên web
- **Các lệnh (TypeScript):** `setQueue({items, startIndex, startPosition})`, `addItems`, `removeItem`, `moveItem`, `updateItem` (đổi link), `play`, `pause`, `seekTo`, `skipTo`, `next`, `previous`, `setRepeat('off'|'all'|'one')`, `setSleepTimer(phút)`, `getState`.
- **Các sự kiện báo về:** `state`, `itemChanged`, `needsUrl`, `error`, `queueEnded`.
- **Mỗi bài trong hàng chờ:** `{ id, url (https hoặc file://), headers?, title, artist, album?, artwork, duration }`.
- **Phần iOS:**
  - AVPlayer, hàng chờ do native giữ: hết bài tự phát bài sau, không cần JavaScript.
  - `AVAudioSession` loại `.playback`.
  - Màn hình khóa và Control Center (`MPNowPlayingInfoCenter`): tên bài, ca sĩ, ảnh bìa, vị trí đang phát.
  - Nút điều khiển (`MPRemoteCommandCenter`): phát/dừng, bài sau, bài trước, tua.
  - Khi có cuộc gọi đến: dừng, gọi xong thì phát tiếp. Rút tai nghe: tự dừng.
  - Gửi kèm header (ví dụ User-Agent) khi tải link googlevideo.
  - Hẹn giờ tắt chạy ở phần native.
- **Code Swift viết nhỏ gọn.** Logic hàng chờ tách thành một phần Swift riêng có test (XCTest), được chạy tự động trên trình giả lập iPhone trong GitHub Actions.
- **Bản web (`web.ts`):** cùng các lệnh trên nhưng dùng thẻ audio HTML5, để làm và thử giao diện trên PC.
- **`player/controller.ts`:**
  - Khi tạo hàng chờ, lấy sẵn link cho khoảng 20 bài kế tiếp (link sống khoảng 6 giờ, đủ cho 1–1,5 giờ nhạc khi khóa máy).
  - Bài đã tải thì dùng file trong máy (`file://`).
  - Khi native báo `needsUrl`, lấy link mới rồi gọi `updateItem`.
  - Khi hàng chờ còn dưới 5 bài, tự lấy radio nối thêm.
- `Info.plist`: thêm `UIBackgroundModes = audio` để được phát nền.

### GĐ3: Giao diện kiểu Spotify (thiết kế cho điện thoại)
- **Bố cục:**
  - Thanh tab dưới: Trang chủ / Tìm kiếm / Thư viện.
  - Trình phát thu nhỏ nằm trên thanh tab, vuốt ngang để chuyển bài.
  - Trình phát toàn màn hình: vuốt xuống để đóng, nền chuyển màu theo ảnh bìa, thanh tua, nút ngẫu nhiên/lặp lại, tim, tải, hàng chờ, lời bài hát chạy theo nhạc.
  - Chừa khoảng trống cho tai thỏ, Dynamic Island và thanh home.
- **Màu sắc và phong cách:** giao diện tối (`#121212`, `#181818`, `#282828`; chữ trắng và `#b3b3b3`), màu nhấn xanh lá, font Be Vietnam Pro, toàn bộ chữ tiếng Việt. Dùng logo riêng, không dùng thương hiệu Spotify.
- **Các trang:**
  - Trang chủ: lời chào, nghe gần đây, các hàng gợi ý từ YouTube Music Việt Nam.
  - Tìm kiếm: gợi ý khi gõ, kết quả chia tab, lịch sử tìm kiếm.
  - Album / Playlist: nút Phát, Ngẫu nhiên, Tải tất cả.
  - Nghệ sĩ.
  - Thư viện: Bài hát đã thích, playlist của tôi, Đã tải.
  - Cài đặt: kết nối YouTube, dung lượng, các tùy chọn tải tự động, hẹn giờ tắt, nhật ký lỗi.
- **Menu của từng bài:** Phát tiếp · Thêm vào hàng chờ · Thêm vào playlist · Tải · Thích · Đi tới album/nghệ sĩ.
- Lưu hàng chờ và vị trí đang phát, để mở lại app là nghe tiếp.

### GĐ4: Tải về và nghe offline
- **`downloads/manager.ts`:**
  - Lấy link bằng `resolveAudio` rồi tải bằng `FileTransfer.downloadFile({ url, headers, path, progress: true })`.
  - Lưu vào `LibraryNoCloud/music/`, thư mục riêng của app, không bị đẩy lên iCloud. Mỗi bài gồm 3 file: `<id>.m4a`, `<id>.jpg` (ảnh bìa), `<id>.json` (thông tin bài, để dựng lại thư viện nếu dữ liệu app bị mất).
  - Tải tối đa 2 bài cùng lúc. Danh sách chờ tải được lưu lại, mở app thì tải tiếp phần còn dở.
  - Có nút "Tải tất cả" cho album/playlist, xóa được bài đã tải, hiện tổng dung lượng.
- **Tùy chọn:** "Tự lưu bài đã nghe" và "Tự tải bài hát đã thích".
- **Chế độ offline:** dùng `@capacitor/network` để biết mất mạng. Khi đó hiện thông báo và chỉ cho phát bài đã tải; trình phát dùng file trong máy nên không cần mạng.

### GĐ5: Kết nối YouTube (Gmail, không bắt buộc) và lời bài hát
- **Nút "Kết nối YouTube"** dùng kiểu đăng nhập Google bằng mã (device flow), xin quyền chỉ-đọc `youtube.readonly`:
  1. App hiện một mã và nút mở google.com/device (mở bằng Safari ngay trong app).
  2. Bạn đăng nhập Gmail và nhập mã.
  3. App nhận token và lưu vào `Preferences`.

  Cách này không cần server, không cần cấu hình riêng cho app iOS.
- **Nhập dữ liệu:** playlist của bạn, các bài trong đó, và video đã thích, trở thành playlist trong app và mục "Bài hát đã thích". Tên bài được làm sạch (bỏ " - Topic", "(Official Video)"…).
- Không đăng nhập vẫn nhập được playlist bằng cách **dán link playlist YouTube / YouTube Music**.
- **Lời bài hát:** lấy từ LRCLIB (chạy theo nhạc); không có thì dùng lời của YouTube Music. Lời được lưu kèm bài đã tải để xem khi offline.

### GĐ6: Build và cài lên iPhone
- **`.github/workflows/ios.yml`:** `npm ci` → `vite build` → `cap sync ios` → `xcodebuild` (không ký: `CODE_SIGNING_ALLOWED=NO`) → đóng gói `Payload/App.app` thành `.ipa` → đưa lên GitHub Release. Workflow cũng chạy các test Swift.
- **Cài lên iPhone:** mở trang Release bằng Safari (đăng nhập GitHub) → tải file `.ipa` → mở bằng SideStore → cài. Bản mới cũng cài theo cách này; nhạc đã tải vẫn còn vì bundle ID không đổi.
- Mỗi 7 ngày bấm "Refresh" trong SideStore để gia hạn (có thể bật tự động).

### Để sau (không làm trong đợt này)
- Bản Android từ cùng bộ code (cần viết thêm phần phát nhạc bằng Kotlin/Media3).
- Tự cập nhật qua "source" của SideStore (cần để repo ở chế độ public).

## 5. Kiểm thử
- **Test tự động (vitest):** chuẩn hóa dữ liệu, chọn định dạng/client dự phòng, hàng chờ (bài sau, bài trước, ngẫu nhiên, lặp lại), quản lý tải (giả lập), vòng chờ của đăng nhập bằng mã. Test Swift (XCTest) cho hàng chờ native chạy trong CI.
- **Trên PC:** chạy `npm run dev`, mở bằng trình duyệt tích hợp của Claude app ở khổ màn hình iPhone 390×844. Thử: tìm "Sơn Tùng" → phát → hàng chờ/radio → giao diện các trang.
- **Trên iPhone (bản IPA từ CI)**, theo danh sách:
  1. Mở app: trang chủ hiện gợi ý Việt Nam; tìm và phát được ngay.
  2. Khóa màn hình: nhạc vẫn phát; màn hình khóa và Control Center hiện ảnh bìa và tên bài; các nút bài sau, bài trước, tua đều chạy.
  3. Để nhạc chạy qua ít nhất 3 bài liên tiếp khi đang khóa máy: phải tự chuyển bài.
  4. Có cuộc gọi đến, hoặc rút tai nghe: nhạc dừng đúng lúc và phát tiếp được.
  5. Tải một playlist 10 bài → bật chế độ máy bay → nghe đủ cả 10 bài, tua được trong file đã tải. Tắt hẳn app rồi mở lại vẫn nghe được.
  6. Hẹn giờ tắt 5 phút khi đang khóa máy.
  7. Kết nối YouTube và nhập playlist.
- **Khi có lỗi:** vào Cài đặt → Nhật ký, copy rồi gửi mình, vì không có Mac để gỡ lỗi trực tiếp.

## 6. Rủi ro và lưu ý
- **YouTube đổi cơ chế hoặc đòi PO token:** chỉ cần cập nhật youtubei.js và bgutils-js trong `src/youtube/`, build lại (khoảng 10 phút) rồi cài bản mới.
- **Không có Mac:** mọi bản iOS đều build trên GitHub Actions, gỡ lỗi nhờ nhật ký trong app.
  - Nếu plugin Swift tự viết gặp khó, dự phòng bằng plugin trả phí Capawesome Audio Player (đã có sẵn hàng chờ và màn hình khóa).
  - Nếu file m4a tải từ YouTube bị tua lỗi trên AVPlayer: chuyển sang dùng link HLS (định dạng phát trực tuyến AVPlayer hỗ trợ tốt nhất), kết hợp tải offline bằng công cụ có sẵn của iOS.
- **Apple ID miễn phí:**
  - App hết hạn sau 7 ngày nếu không gia hạn (dữ liệu vẫn còn, gia hạn xong là dùng lại được).
  - Chỉ được tối đa 3 app cài ngoài store, và SideStore đã chiếm 1.
  - Muốn đỡ phiền thì mua tài khoản Apple Developer 99$/năm.
- **Link nhạc chỉ sống khoảng 6 giờ:** app lấy sẵn link cho khoảng 20 bài. Nếu nghe liên tục lâu hơn thế khi đang khóa máy, nhạc có thể dừng ở cuối phần đã chuẩn bị; mở app là chạy tiếp. Bài đã tải không bị ảnh hưởng.
- **Tải khi app ở nền:** khi nhạc đang phát, app vẫn tải tiếp; nếu iOS tạm dừng thì mở app lên là tải tiếp.
- **Dùng cá nhân:** không đưa lên store, không chia sẻ file IPA. Không dùng cookie tài khoản Google để lấy nhạc; Gmail chỉ cấp quyền đọc để nhập playlist.
- Tải tối đa 2 bài cùng lúc để YouTube không chặn tạm thời.

## 7. Nguồn
- Quy định duyệt app của Apple (mục 5.2.3): https://developer.apple.com/app-store/review/guidelines/
- Chính sách YouTube API: https://developers.google.com/youtube/terms/developer-policies
- Vụ Musi: https://9to5mac.com/2026/03/17/streaming-app-musi-loses-app-store-case-as-judge-rules-apple-can-delist-apps-at-any-time/
- Lỗi phát nền của web app trên iOS: https://bugs.webkit.org/show_bug.cgi?id=261858, https://bugs.webkit.org/show_bug.cgi?id=295518
- Phát nền trong app Capacitor phải làm bằng native: https://capawesome.io/blog/how-to-play-audio-in-the-background-in-capacitor/
- Bộ giải mã link nhạc của YouTube.js (`Platform.shim.eval`): https://ytjs.dev/api/youtubei.js/namespaces/Types/interfaces/PlatformShim · YouTube.js: https://github.com/LuanRT/YouTube.js
- PO token và BgUtils: https://github.com/LuanRT/BgUtils, https://github.com/FreeTubeApp/FreeTube/pull/6436
- Đăng nhập Google bằng mã (device flow; hỗ trợ `youtube.readonly`): https://developers.google.com/identity/protocols/oauth2/limited-input-device
- Plugin tải file của Capacitor: https://capacitorjs.com/docs/apis/file-transfer
- SideStore (gia hạn app ngay trên máy, 7 ngày, tối đa 3 app): https://builds.io/blog/technologies/ios-technologies/free-sideloading-tools-iphone-ranked/
