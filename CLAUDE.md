# Melo — handoff notes for Claude sessions

Personal Spotify-style **iPhone** music app: search/stream YouTube Music, download for offline,
background (screen-off) playback. Full approved plan (Vietnamese): [docs/PLAN.md](docs/PLAN.md).
The user speaks **Vietnamese** — reply in Vietnamese; all UI strings are Vietnamese.

## Hard decisions (user-approved, do not revisit)
- **No server, phone only.** Everything runs on the iPhone: Capacitor app, `youtubei.js` calls YouTube
  through native HTTP (`CapacitorHttp`, no CORS, phone's own IP). Never propose a backend.
- **iPhone only**, personal use, **not** for the App Store (Apple 5.2.3 / YouTube API policy).
  User has **no Mac**: iOS builds go through GitHub Actions (macOS runner, unsigned IPA) → installed with
  **SideStore** (free Apple ID, 7-day refresh).
- Background playback must be **native** (Swift plugin owns the queue): iOS suspends WebView JS in background.
- Gmail login is **optional**, only to import YouTube playlists/likes via OAuth **device flow**
  (`youtube.readonly`, client type "TVs and Limited Input devices"). Secrets go to GitHub Secrets, never in code.
- Most reference apps are GPL: learn ideas only, never copy code.
- `appId` `com.melo.music` must never change (downloads live in the app container).
- Repo `HoangDuc1003/spoti_music` is **public**: never commit secrets.

## Status (2026-10-01, session 2)
Done and verified:
- Vite 8 + React 19 + TS 7 + Tailwind 4 + Capacitor 8.5 (iOS, SPM) project; `ios/` generated, Info.plist has
  `UIBackgroundModes=audio`, portrait only.
- `src/youtube/`: `http.ts` (native/dev fetch), `client.ts` (browse/stream/poStream sessions), `normalize.ts`,
  `music.ts` (home, search, suggestions, album, artist, playlist, up-next radio, lyrics, link parser),
  `stream.ts` (client fallback + 1MB probe + cache), `potoken.ts` (BotGuard via bgutils-js), `types.ts`.
- **Swift plugin** `plugins/player/` (package `CapacitorMeloPlayer`):
  - `ios/Sources/MeloPlayerCore/` — pure Swift (Foundation only): `PlayerQueue`, `QueueItem`/`PlaybackSource`,
    `RetryPolicy` (needsUrl once → error+skip; stop after skipping the whole queue), `SleepTimer`, `PlayerSnapshot`.
    XCTest in `ios/Tests/MeloPlayerCoreTests/` (runs on Linux/macOS with `swift test`).
  - `ios/Sources/MeloPlayerPlugin/` (`#if os(iOS)`): `MeloAudioEngine` (AVPlayer, native queue, AVAudioSession
    `.playback`, Now Playing + remote commands, interruptions, route change, sleep timer, file-first source) and
    `MeloPlayerPlugin` (Capacitor bridge, every method hops to main). Capacitor dependency is `.when(platforms: [.iOS])`.
  - `src/web.ts` mirrors the same semantics with HTML5 audio for PC dev.
- **CI** `.github/workflows/ios.yml` on `macos-26` (Xcode 26 needed: capacitor-swift-pm 8.5 binaries are Swift 6.2):
  npm ci → vitest → build → cap sync → `swift test` → unsigned `xcodebuild` → `Melo.ipa` → rolling GitHub Release
  tag `ios-latest` (+ artifact). First run green (IPA 1.4 MB). Public repo ⇒ macOS minutes are free.
- **Player controller** `src/player/`: `queue.ts` (pure helpers: shuffle, insert positions, upcoming window, radio
  dedupe, snapshot), `store.ts` (Zustand `usePlayer`), `controller.ts` (pre-resolve 20 ahead — 3 urgent then 1.5 s
  apart, `needsUrl` handling with stop-on-all-failing, radio when ≤3 left, Spotify-like Play next / Add to queue
  before radio entries, shuffle keeps current + restores original order, snapshot in localStorage + restore on launch,
  history, network change → re-resolve, `setFileUrlProvider` hook for downloads). `initPlayer()` runs in `main.tsx`.
  Vitest with a fake native that asserts the JS mirror always equals the native queue.
- `src/App.tsx` is still a TEMPORARY test screen (search + play through the controller). Replace with the real UI.
- `scripts/probe*.mjs`: diagnostics to re-check which YouTube clients work (run with `node`).

TODO, in this order (details in docs/PLAN.md §4):
1. Real Spotify-like UI (per-tab navigation stacks, pages, mini/full player, queue sheet, lyrics view).
2. Downloads: `@capacitor/file-transfer` into `Directory.LibraryNoCloud/music/<id>.m4a` + `.jpg` + `.json`
   sidecar; max 2 concurrent; `dexie-react-hooks` for live UI; web dev fallback stores Blobs in `db.blobs`.
   Register `setFileUrlProvider` and call `refreshLocalFile(id)` after a download/delete.
   **Never persist absolute `file://` paths**: the app container UUID changes on every reinstall/update;
   store relative paths and build the URI at runtime (`Filesystem.getUri`).
3. Security pass (CSP, id validation before using ids in file paths, no tokens in logs, secret scan, audit).
4. Smoothness pass (lazy-load youtubei.js, smaller initial chunk, long lists), then review everything.
5. Device-flow login + Data API import, paste-a-link import, LRCLIB synced lyrics.
6. Vietnamese README for the user: SideStore install/refresh, updating, Google Cloud setup.

## Verified YouTube facts (from this PC's VN residential IP, 2026-10-01 — re-run `scripts/probe*.mjs` if broken)
- Full-file download works **without PO token only with `VISIONOS`**. `IOS`, `ANDROID_VR`, `MWEB`, `YTMUSIC`,
  `TV_SIMPLY` give 403 after the first 1 MiB; `TV` → "Cần tải lại trang này"; `WEB`/`ANDROID` → no URL.
  `TV_SIMPLY` + PO token (bgutils, even jsdom-minted) downloads fully. Hence `stream.ts` order + 1MB probe.
- A plain GET of the whole file **hangs**; add `&range=0-<contentLength-1>` (or a `Range` header) — required for
  `FileTransfer.downloadFile`. AVPlayer already uses Range requests.
- `yt.music.search(...).songs/.albums/...` compare English shelf titles → empty with `lang: 'vi'`; use `contents`.
- Anonymous home feed is short → `getHome()` adds one continuation + Explore shelves.
- Album tracks have no thumbnail/artists → taken from the album header.
- youtubei.js 18 requires `Platform.shim.eval` (we use `new Function(data.output)()`).

## Gotchas
- `CapacitorHttp` (iOS) parses JSON responses into objects whatever `responseType` is → `http.ts` re-stringifies;
  it only sends a body when a Content-Type header exists.
- Capacitor web plugins remove listeners by function reference: register a fresh closure per `addListener`
  (StrictMode double effects otherwise remove the live listener).
- `npm audit` warnings come from `@capacitor/cli` dev deps (uuid in `xcode`) — not shipped in the app.
- Capacitor CLI registers plugin classes by regex-scanning **every** `.swift` file under `plugins/player/ios` for
  `@objc(Name)` — use that syntax only on `MeloPlayerPlugin` (plain `@objc func` elsewhere).
- This cloud container cannot reach YouTube/googlevideo/ytimg (egress policy); swift.org is blocked too — run Swift
  tests with Docker: `docker run --rm -v "$PWD/plugins/player":/src -w /src mirror.gcr.io/library/swift:6.2-noble swift test`
  (Docker Hub is rate-limited; use the `mirror.gcr.io` mirror). Check CI with the GitHub MCP actions tools.

## Commands
- `npm run dev` — Vite on :5173 with the YouTube dev proxy (`/__proxy/<host>/…`, see `vite.config.ts`).
- `npm run build` — typecheck + build. `npm test` — vitest (jsdom + fake-indexeddb).
- `npx cap sync ios` — copy web build + update iOS SPM package list after adding plugins.
- `cd plugins/player && swift test` — native queue tests (macOS/Linux; CI runs them on every push).
- `node scripts/probe.mjs "<query>"`, `scripts/probe-download.mjs <id>`, `scripts/probe-potoken.mjs <id>`,
  `scripts/probe-fullget.mjs <id>`, `scripts/probe-structures.mjs <home|album|artist|…>`.
