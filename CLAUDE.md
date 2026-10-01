# Melo — handoff notes for Claude sessions

Personal Spotify-style **iPhone** music app: search/stream YouTube Music, download for offline,
background (screen-off) playback. Full approved plan (Vietnamese): [docs/PLAN.md](docs/PLAN.md).
The user speaks **Vietnamese** — reply in Vietnamese; all UI strings are Vietnamese.

## Hard decisions (user-approved, do not revisit)
- **No server, phone only.** Everything runs on the iPhone: Capacitor app, `youtubei.js` calls YouTube
  through native HTTP (`CapacitorHttp`, no CORS, phone's own IP). Never propose a backend.
- **iPhone only**, personal use, **not** for the App Store (Apple 5.2.3 / 5.2.2 / 2.5.2, YouTube ToS — full analysis
  and the legit "store flavor" path in `docs/APP_STORE.md`; privacy policy draft `docs/privacy-policy.md`).
  User has **no Mac**: iOS builds go through GitHub Actions (macOS runner, unsigned IPA) → installed with
  **SideStore** (free Apple ID, 7-day refresh).
- Background playback must be **native** (Swift plugin owns the queue): iOS suspends WebView JS in background.
- Gmail login is **optional**, only to import YouTube playlists/likes via OAuth **device flow**
  (`youtube.readonly`, client type "TVs and Limited Input devices"). Secrets go to GitHub Secrets, never in code.
- Most reference apps are GPL: learn ideas only, never copy code.
- `appId` `com.melo.music` must never change (downloads live in the app container).
- Repo `HoangDuc1003/spoti_music` is **public**: never commit secrets.

## Status (2026-10-01, session 2 — 10 closed loops done, CI green each round)
Done and verified (85 vitest incl. `scripts/*.test.mjs`, 15 XCTest, Playwright screenshot runs at 390×844 in `dev:mock`, CI on `macos-26`):
- **Swift plugin** `plugins/player/` (package `CapacitorMeloPlayer`):
  - `ios/Sources/MeloPlayerCore/` — pure Swift: `PlayerQueue`, `QueueItem`/`PlaybackSource` (file first, remote
    **https only**), `artworkURL` (https/file only), `RetryPolicy` (needsUrl once → error+skip; stop after skipping the
    whole queue), `SleepTimer`, `PlayerSnapshot`. XCTest in `ios/Tests/MeloPlayerCoreTests/`.
  - `ios/Sources/MeloPlayerPlugin/` (`#if os(iOS)`): `MeloAudioEngine` (AVPlayer, native queue, `.playback` session,
    Now Playing + remote commands, interruptions, route change, sleep timer) + `MeloPlayerPlugin` bridge (hops to main).
  - `src/web.ts` mirrors the semantics with HTML5 audio.
- **CI** `.github/workflows/ios.yml`: jobs `security` (gitleaks over full git history with `.gitleaks.toml`, `npm audit
  --omit=dev --audit-level=high`), `signing` (outputs `adhoc=true` only if the 3 signing secrets exist), `build`
  (macos-26, read-only: vitest → build → cap sync → swift test → unsigned xcodebuild with
  `MARKETING_VERSION=<major.minor of package.json>.<run_number>` → checks CSP, PrivacyInfo, export-compliance key, no
  NSAllowsArbitraryLoads → `Melo.ipa` + sha256), `adhoc` (optional: `scripts/adhoc-sign.sh` re-signs the unsigned IPA
  with secrets `SIGNING_CERT_P12_BASE64` / `SIGNING_CERT_PASSWORD` / `ADHOC_PROFILE_BASE64` in a temp keychain —
  **never run/verified yet**, needs the user's paid account), `release` (only job with `contents: write`; rolling tag
  `ios-latest` with Melo.ipa, icon.png, `source.json` for SideStore/AltStore, plus Melo-adhoc.ipa + manifest.plist when
  signed), `pages` (continue-on-error; install page at https://hoangduc1003.github.io/spoti_music/ once the user sets
  Pages source = GitHub Actions). `scripts/release-meta.mjs` generates source.json / manifest.plist / index.html
  (tested in `scripts/release-meta.test.mjs`). Install guide for the user: `docs/CAI_DAT.md`. Public repo ⇒ free macOS
  minutes.
- iOS app: real Melo icon (`AppIcon-512@2x.png` RGB no alpha, rendered from `public/icon.svg`; `docs/icon-512.png`),
  dark splash, `PrivacyInfo.xcprivacy` (no tracking/collection; UserDefaults CA92.1, file timestamp C617.1) added to the
  App target resources, `ITSAppUsesNonExemptEncryption=false`.
- **Player controller** `src/player/` (`queue.ts` pure helpers, `store.ts` Zustand, `controller.ts`): pre-resolve 20
  ahead, `needsUrl`, radio when ≤3 left (not when offline/repeat), Spotify-like *Play next* / *Add to queue* (after
  current + earlier queued items), shuffle keeps current, snapshot restore, history, network change → re-resolve,
  offline → only downloaded tracks, `setFileUrlProvider`/`setArtworkFileProvider` hooks. Test uses a fake native that
  asserts the JS mirror equals the native queue. **Every queue mutation runs through `exclusive()`** (promise-chain
  lock): rapid taps can't desync JS ↔ native; insert positions are computed from fresh state after the `toItems` await;
  `removeAt`/`move` take the entry `uid` to re-find a row whose index went stale; a late radio fetch only appends if
  the queue's last uid is still the seed. Never `await` a locked public function from inside the lock (deadlock) — use
  the `*Locked` internals. History is pruned to 2000 rows on launch (`pruneHistory`).
- **UI** (`src/App.tsx`, `components/`, `pages/`, `ui/`): per-tab nav stacks (`ui/nav.ts`, pages kept mounted with
  `hidden`), iOS edge-swipe back (`EdgeSwipeBack`, 12px strip), slide-in pages, mini player (swipe to skip), full
  player (drag down to close, artwork colour), queue sheet (drag handles), LRCLIB/YouTube lyrics, track menu, playlist
  picker, sleep timer, toasts, offline banner. Pages: Home, Search (suggestions, history, paste YouTube link), Library,
  Album, Artist, Playlist, Local playlist, Liked, History, Downloads, Settings, Logs.
- **Library/lyrics**: `src/lib/library.ts` (likes, local playlists, history, search history), `src/lib/lyrics.ts`
  (LRCLIB `/get` → `/search` → YouTube, cached in `db.lyrics`; network failures are not cached as misses).
- **Downloads** `src/downloads/`: `storage.ts` (iPhone: `Library/NoCloud/music/<id>.m4a|.jpg|.json`, download to
  `.part` then rename, size check, `SAFE_ID` check before any path; web: Blobs in `db.blobs`), `manager.ts` (retry
  with fresh URL, resume on launch / when back online, rebuild from `.json` sidecars, auto-download liked, live index
  in `useDownloads`), `concurrency.ts` (**adaptive parallel downloads, AIMD 1–15**: +1 per success while total
  throughput still grows, −1 when it drops (bandwidth peak), ÷2 + exponential cooldown on 403/429; 4G/5G capped at 6;
  setting Tự động / fixed 1–15 + "tải bằng dữ liệu di động"; `Semaphore(3)` around `resolveAudio`; 150 ms start gap).
  FileTransfer iOS creates one URLSession per download, so no 6-connections-per-host cap.
- **Security**: build-only CSP (`vite.config.ts`, `'unsafe-eval'` needed by youtubei.js + BotGuard), dev proxy SSRF fix
  + localhost-only unless `MELO_LAN=1`, BotGuard interpreter URL must be `https://(www.)google.com/js/…`
  (`trustedInterpreterUrl`), log redaction (`redact()` in `lib/log.ts`: googlevideo URLs, tokens, secrets, IPs),
  YouTube link parser validates ids (`youtube/links.ts`).
- **Smoothness**: youtubei.js + BotGuard lazy-loaded (initial JS 477 KB / 147 KB gzip; **CI budget** `npm run
  check:bundle` = `scripts/check-bundle.mjs`, fails above 170 KB JS / 12 KB CSS gzip for what index.html loads
  eagerly), right-sized artwork (`lib/images.ts`), `content-visibility` rows, rAF position (~15 fps) only while
  visible. Download progress is coalesced (first event + completion immediate, otherwise ≤4 store updates/s); the
  Downloads page (always mounted) only re-renders tiny `DownloadStatusLine` / memo `PendingRow` subscribers.
- `npm run dev:mock` (aliases `@/youtube/{music,stream,http}` → `src/youtube/mock/`) for UI work without YouTube.

NOT verified on a real iPhone yet (no device here): background playback across tracks, lock screen, FileTransfer
downloads, AVPlayer with googlevideo headers. First thing to do when the user reports back: read their in-app log.

TODO (next sessions):
1. User test on iPhone with the checklist in docs/PLAN.md §5; fix from the in-app log.
2. Device-flow login + YouTube Data API import (playlists, likes); store tokens in the **Keychain** (not
   Preferences/localStorage), never log them (`redact` already masks `access_token`/`refresh_token`).
   OAuth client id/secret from GitHub Secrets at build time (`.env` is git-ignored).
4. Optional: swipe between tabs, haptics, Keyboard plugin (`@capacitor/keyboard`) if the search keyboard misbehaves.

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
- Chromium (Playwright) treats a horizontal touch swipe as browser history navigation unless `html` has
  `overscroll-behavior: none` (set in `styles.css`); iOS WKWebView in Capacitor has no back gesture.
- Pages stay mounted with `hidden`: Playwright locators must use `.filter({ visible: true })`.
- Typecheck with `npx tsc --noEmit` (tsconfig has `noEmit`; a bare `tsc -b` used to drop `.js` files next to the
  sources, and Vite resolves `.js` before `.ts`).
- The `github-pages` environment only allows the default branch until the user adds `claude/*` in
  Settings → Environments (documented in `docs/CAI_DAT.md`).
- Capacitor CLI registers plugin classes by regex-scanning **every** `.swift` file under `plugins/player/ios` for
  `@objc(Name)` — use that syntax only on `MeloPlayerPlugin` (plain `@objc func` elsewhere).
- This cloud container cannot reach YouTube/googlevideo/ytimg (egress policy); swift.org is blocked too — run Swift
  tests with Docker: `docker run --rm -v "$PWD/plugins/player":/src -w /src mirror.gcr.io/library/swift:6.2-noble swift test`
  (Docker Hub is rate-limited; use the `mirror.gcr.io` mirror). Check CI with the GitHub MCP actions tools.

## Commands
- `npm run dev` — Vite on :5173 with the YouTube dev proxy (`/__proxy/<host>/…`, see `vite.config.ts`);
  `MELO_LAN=1 npm run dev` to expose it on the LAN. `npm run dev:mock` — sample data, no YouTube needed.
- `npm run build` — typecheck + build. `npm test` — vitest (jsdom + fake-indexeddb).
- `npx cap sync ios` — copy web build + update iOS SPM package list after adding plugins.
- `cd plugins/player && swift test` — native queue tests (macOS/Linux; CI runs them on every push).
- UI smoke test (9 flows incl. download, offline, edge swipe): `npm run dev:mock -- --port 5174`, then
  `npm i --no-save playwright && CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node scripts/ui-smoke.mjs`.
- `node scripts/probe.mjs "<query>"`, `scripts/probe-download.mjs <id>`, `scripts/probe-potoken.mjs <id>`,
  `scripts/probe-fullget.mjs <id>`, `scripts/probe-structures.mjs <home|album|artist|…>`.
