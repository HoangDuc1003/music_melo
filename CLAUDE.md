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
  (`youtube.readonly`, client type "TVs and Limited Input devices"). Done (2026-10-02): the user pastes their own
  Client ID + secret in Settings (secret in Keychain) — **not** baked into the build, because the release IPA is public.
  Secrets never go in code.
- Most reference apps are GPL: learn ideas only, never copy code.
- `appId` `com.melo.music` must never change (downloads live in the app container).
- **Web flavor (PWA, 2026-10-02, user-approved):** same React app built with `vite --mode web` for static hosting on
  Vercel (`vercel.json`, no serverless functions — still no backend). Browsers can't fetch YouTube media (CORS), so
  the web flavor has **no YouTube downloads and no Spotify**. Music = **YouTube** (user-approved 2026-10-02: the user
  could not find the music videos they wanted; search via Data API v3 with the user's own API key, playback **only**
  through the official IFrame player shown on screen — online only, no background, no download, per YouTube ToS) +
  **Audius** (open API, no key, CORS, full tracks, downloadable) + **Jamendo** (optional Client ID in Settings or
  `VITE_JAMENDO_CLIENT_ID`) + the user's **own audio files**. Audius/Jamendo have no major-label hits. The iPhone app
  stays the full version (YouTube Music with downloads).
- Repo `HoangDuc1003/music_melo` (renamed from `spoti_music` on 2026-10-02; old URLs redirect, GitHub Pages does
  not) is **public**: never commit secrets.

## Status (2026-10-02, session 2 — 10 closed loops + Spotify sync + refactor pass, CI green each round)
Done and verified (140 vitest incl. `scripts/*.test.mjs`, 15 XCTest, Playwright screenshot runs at 390×844 in `dev:mock`, CI on `macos-26`):
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
  signed), `pages` (continue-on-error; install page at https://hoangduc1003.github.io/music_melo/ once the user sets
  Pages source = GitHub Actions). `scripts/release-meta.mjs` generates source.json / manifest.plist / index.html
  (tested in `scripts/release-meta.test.mjs`). Install guide for the user: `docs/CAI_DAT.md`. Public repo ⇒ free macOS
  minutes.
- iOS app: real Melo icon (`AppIcon-512@2x.png` RGB no alpha, rendered from `public/icon.svg`; `docs/icon-512.png`),
  dark splash, `PrivacyInfo.xcprivacy` (no tracking/collection; UserDefaults CA92.1, file timestamp C617.1) added to the
  App target resources, `ITSAppUsesNonExemptEncryption=false`.
- **Player controller** `src/player/` (`queue.ts` pure helpers, `store.ts` Zustand, `controller.ts`): pre-resolve 20
  ahead, `needsUrl`, radio when ≤3 left (not when offline/repeat), Spotify-like *Play next* / *Add to queue* (after
  current + earlier queued items), shuffle keeps current, snapshot restore, history, network change → re-resolve,
  offline → only downloaded tracks, `setFileUrlProvider`/`setArtworkFileProvider` hooks (wired by
  `connectDownloadsToPlayer()` in main.tsx **before** `initPlayer`, so a restored queue already plays downloaded files).
  Index math after insert/remove/move/unshuffle lives in `queue.ts` (pure, tested). Test uses a fake native that
  asserts the JS mirror equals the native queue. **Every queue mutation runs through `exclusive()`** (promise-chain
  lock): rapid taps can't desync JS ↔ native; insert positions are computed from fresh state after the `toItems` await;
  `removeAt`/`move` take the entry `uid` to re-find a row whose index went stale; a late radio fetch only appends if
  the queue's last uid is still the seed. Never `await` a locked public function from inside the lock (deadlock) — use
  the `*Locked` internals. Concurrent radio requests share one in-flight promise (queue end waits for it). Network
  state lives in `lib/network.ts` (`initNetwork()` first in main.tsx); the controller subscribes to `useNetwork` and
  re-resolves links when the connection type changes. History is pruned to 2000 rows on launch (`pruneHistory`).
  **Smart Shuffle**: `cycleShuffle()` off → shuffle → smart → off; smart picks = radio of the current track + 2 random
  upcoming ones (round-robin, never a track already queued), one every 3 upcoming tracks (max 20), origin `'smart'`
  (✨ in the queue sheet), store/snapshot flag `smartShuffle`; turning shuffle off removes smart picks except the one
  playing; no picks (offline / nothing new) → shuffle off + `smartUnavailable`. `playTracks` resets smart.
- **UI** (`src/App.tsx`, `components/`, `pages/`, `ui/`): per-tab nav stacks (`ui/nav.ts`, pages kept mounted with
  `hidden`), iOS edge-swipe back (`EdgeSwipeBack`, 12px strip), slide-in pages, mini player (swipe to skip), full
  player (drag down to close, artwork colour), queue sheet (drag handles), LRCLIB/YouTube lyrics, track menu, playlist
  picker, sleep timer, toasts, offline banner. Pages: Home, Search (suggestions, history, paste YouTube link), Library,
  Album, Artist, Playlist, Local playlist, Liked, History, Downloads, Settings, Logs.
- **Recommendations** `src/lib/recommend.ts` ("Dành cho bạn" on Home, `MixCard`, route `mix` → `MixPage`): on-device
  from history (90 days) + likes (like = 3 plays). Kinds: `repeat` (≥2 plays in 30 days), `daily` 1–3 (top artists with
  ≥2 known tracks: known tracks interleaved 1:2 with radio of their top track), `discover` (radio of top 5 tracks, only
  never-heard ids, ranked by how many seeds suggested them; weekly, Monday key), `daylist` (tracks played in the same
  part of day). Radio = `getUpNext` (YouTube, or Jamendo in the web flavor). Stored in `db.settings['mixes']` with a
  per-kind period (day / week / day+part); only stale kinds are rebuilt, failures keep the old mixes; radio tracks are
  saved to `db.tracks` so mixes open offline.
- **Library/lyrics**: `src/lib/library.ts` (likes, local playlists, history, search history), `src/lib/lyrics.ts`
  (LRCLIB `/get` → `/search` → YouTube, cached in `db.lyrics`; network failures are not cached as misses).
- **Downloads** `src/downloads/`: `storage.ts` (iPhone: `Library/NoCloud/music/<id>.m4a|.jpg|.json`, download to
  `.part` then rename, size check, `SAFE_ID` check before any path; web: Blobs in `db.blobs`), `manager.ts` (retry
  with fresh URL, resume on launch / when back online, rebuild from `.json` sidecars, auto-download liked, live index
  in `useDownloads`; settings `{concurrency, cellular, autoLiked}`; launch only reads `.json` sidecars missing from
  the DB), `concurrency.ts` (**adaptive parallel downloads, AIMD 1–15**: +1 per success while total
  throughput still grows, −1 when it drops (bandwidth peak), ÷2 + exponential cooldown on 403/429; 4G/5G capped at 6;
  setting Tự động / fixed 1–15 + "tải bằng dữ liệu di động"; `Semaphore(3)` around `resolveAudio`; 150 ms start gap).
  FileTransfer iOS creates one URLSession per download, so no 6-connections-per-host cap.
- **Shared helpers** (use these, don't re-create): `lib/async.ts` (`sleep`, `clamp`, `Semaphore`, `memoAsync` = memoize
  that forgets rejections), `lib/text.ts` (`fold`, `cleanTitle`, `cleanArtist`), `lib/log.ts` `errorMessage(err,
  fallback)`, `lib/format.ts` (`formatClock`, `formatWhen`, …), `ui/overlays.ts` (`runAction(fn, done)` = run + toast
  + log errors, `confirmAction`, `copyText`, `toggleLikeWithToast`), components `SettingsRow`/`Toggle`, `ProgressBar`,
  `PlayContextButton`, `PlayPauseIcon`, `PlaylistNameForm`, `TrackArtwork` (falls back to the downloaded cover
  offline), `PageLoading`/`PageError`/`ErrorState`, hook `useSlideIn` (Sheet/FullPlayer). Tests replace `sleep` with
  `vi.mock('@/lib/async', …)` instead of production test hooks. `youtube/stream.ts` bumps an epoch on
  `clearAudioCache()` so a link resolved on the old network is never cached (it re-resolves).
- **Security**: build-only CSP (`vite.config.ts`, `'unsafe-eval'` needed by youtubei.js + BotGuard), dev proxy SSRF fix
  + localhost-only unless `MELO_LAN=1`, BotGuard interpreter URL must be `https://(www.)google.com/js/…`
  (`trustedInterpreterUrl`), log redaction (`redact()` in `lib/log.ts`: googlevideo URLs, tokens, secrets, IPs),
  YouTube link parser validates ids (`youtube/links.ts`).
- **Smoothness**: youtubei.js + BotGuard lazy-loaded (initial JS 477 KB / 147 KB gzip; **CI budget** `npm run
  check:bundle` = `scripts/check-bundle.mjs`, fails above 170 KB JS / 12 KB CSS gzip for what index.html loads
  eagerly), right-sized artwork (`lib/images.ts`), `content-visibility` rows, rAF position (~15 fps) only while
  visible — only `SeekBar`, `LyricsPanel` (memo lines) and the mini player's progress bar subscribe to the live
  position, and `TrackRow` only follows play/pause for the current row. Download progress is coalesced (first event + completion immediate, otherwise ≤4 store updates/s); the
  Downloads page (always mounted) only re-renders tiny `DownloadStatusLine` / memo `PendingRow` subscribers.
- **Spotify sync** `src/sync/` (user guide `docs/SPOTIFY.md`; Gmail login does NOT sync Spotify — Spotify needs its own
  OAuth, the user may pick "Continue with Google" on Spotify's page): `spotify-auth.ts` Authorization Code + **PKCE**
  (no client secret), user pastes their own Development-Mode **Client ID** in Settings (or `VITE_SPOTIFY_CLIENT_ID`),
  redirect `com.melo.music://spotify/callback` (CFBundleURLTypes in Info.plist, `App` `appUrlOpen` → `Browser.close`),
  state checked, verifier single-use (10 min), tokens in **Keychain** via `MeloPlayer.keychainGet/Set/Remove`
  (`MeloKeychain.swift`, AfterFirstUnlockThisDeviceOnly; web = localStorage) through `src/lib/secure.ts`, single-flight
  refresh, `invalid_grant` → disconnect. `spotify-api.ts`: `/me`, `/me/playlists`, `/playlists/{id}/items` (entry
  `item` ?? `track`), `/me/tracks`; 401 → refresh once, 429/5xx → Retry-After backoff; only follows `next` links on
  api.spotify.com. `match.ts`: fold diacritics, Dice similarity, score = .55 title + .3 artist + .15 duration, needs
  ≥ .7 and artist ≥ .4 (covers rejected), songs then videos, cache `db.spotifyMatches` (misses retried after 7 days,
  network errors not cached), `Semaphore(2)`. `spotify-sync.ts`: playlists owned/collaborative + Liked Songs →
  `db.playlists` rows `source: 'spotify'` (`spotifyId`, `snapshotId`, `unmatched`; DB v2), skip unchanged snapshot,
  delete playlists removed on Spotify (never `export:` ones), auto-sync on launch/resume if > 12 h, single-flight;
  sync and file import share one lock (`withProgress`) and one pipeline (`matchAndWrite`); playlists are read 3 at a
  time; `updatedAt` only changes when the track list changes. `importSpotifyExport` reads Playlist*.json / YourLibrary.json (no Premium needed). Spotify code is lazy-loaded
  (main.tsx dynamic import + `React.lazy` in Settings) so the initial bundle stays ~148 KB gzip.
  Spotify rules since Feb/Mar 2026 (dev mode): owner needs **Premium**, 1 client ID, ≤ 5 users, only owned/collab
  playlists readable, refresh tokens expire after 6 months. This container cannot reach *.spotify.com — the flow is
  verified with unit tests + `dev:mock` (`src/sync/mock/`), not against real Spotify yet.
- `npm run dev:mock` (aliases `@/youtube/{music,stream,http}` → `src/youtube/mock/`, `@/sync/spotify-{auth,api}` →
  `src/sync/mock/`) for UI work without YouTube/Spotify.
- **Web flavor** `src/web/` (user guide `docs/WEB.md`): `--mode web` aliases `@/youtube/{music,stream,http,client}` →
  `src/web/*` and defines `__WEB_APP__` (compile-time; UI gates: Spotify section → "Nguồn nhạc", "Thêm nhạc từ máy" in
  Library, `VideoStage`, web texts). `music.ts` merges sources in order YouTube (only with an API key) → Audius →
  Jamendo (only with a client ID): Home shelves concatenated (titles must stay distinct, they are React keys), search =
  all in parallel, alternated by `alternate()`; a failing source is skipped and a `YouTubeError` is toasted (max once /
  10 min per message), all failing → first error; Video tab = YouTube only; suggestions never call YouTube (quota).
  Pages/radio dispatch on id prefix (`yt-` YouTube, `au-` Audius, else Jamendo; `lf-` = local file, no radio).
  **YouTube** (`youtube.ts`): key from setting `youtubeApiKey` or `VITE_YOUTUBE_API_KEY` (`AIza` + 35), every fetch
  uses `referrerPolicy: 'strict-origin-when-cross-origin'` (vercel.json sends `Referrer-Policy: no-referrer`, website-
  restricted keys need the origin); ids `yt-<videoId|UC…|PL…>`, tracks `isVideo`; Home = `videos?chart=mostPopular`
  category 10 VN + US (1 unit each); search = `search` (100 units, `videoEmbeddable`/`videoSyndicated`, category 10
  for songs) + `videos` (1 unit, drops non-embeddable/private/live); channel = `channels` → uploads playlist
  (`playlistItems`) → `videos` with statistics; playlist ≤ 200 items; radio = seed + same-channel uploads alternated
  with the VN chart (related-videos API is gone); errors via `apiErrorReason` → Vietnamese (`quotaExceeded`,
  `keyInvalid`, `API_KEY_HTTP_REFERRER_BLOCKED`, `accessNotConfigured`; setup ones have `needsSetup`); no key + pasted
  video link → `bareTrack` still plays. Stream URL `youtube:<id>`; `canDownload(id)` (exported by every
  `@/youtube/stream` flavor; native/mock always true) is false for `yt-` → `enqueueDownloads` skips them, TrackMenu
  hides "Tải về", CollectionView counts only downloadable tracks. Player: `plugins/player/src/web.ts` picks an engine
  per item (`engines.ts` `AudioEngine` = `<audio>`, `youtube-engine.ts` `YouTubeEngine` = one IFrame API player reused
  for every video, iframe created by us with `referrerpolicy` + `playsinline`, mounted in `#melo-video-slot`
  (`VIDEO_SLOT_ID` in definitions.ts) rendered by `src/components/VideoStage.tsx`; requests made before `onReady` are
  replayed (latest wins); YT errors 100/101/150/152/153 → `error` + skip, no needsUrl retry; events from an inactive
  engine are ignored). `VideoStage` = fixed top box (safe area + 16:9 video + 36 px strip, z-45), sets CSS var
  `--video-h`; App root `pt-[var(--video-h)]`, FullPlayer and Sheet `top-[var(--video-h)]` so nothing covers the video
  (ToS); "Ẩn video" pauses then collapses (height 0, iframe stays mounted); playing/buffering re-opens; hint "Chạm vào
  video…" after 2.5 s stuck (iOS first-play gesture). Web CSP: `script-src 'self' https://www.youtube.com
  https://s.ytimg.com`, `frame-src https://www.youtube.com`. Tests: `src/web/youtube.test.ts`,
  `src/player/web-plugin.test.ts` (fake `window.YT`). `audius.ts` (`https://api.audius.co/v1`, `app_name=Melo`, response `{data}`; anonymous
  limit = 5 req per sliding 1 s per IP → `throttle()` spaces calls 4 per 1.1 s, 429 → retry ×2; ids `au-<hashid>` for
  tracks/users/playlists; gated/paid/deleted tracks filtered by `isPlayable`; Home = trending week, "Mới phát hành"
  (trending week+month released ≤30 days, else ≤90, newest first), rising artists, trending playlists, 5 genres;
  stream/download URL = `/tracks/<id>/stream` (302 to a freshly signed content-node URL, never expires; download adds
  `skip_play_count=true` and takes a `throttle()` slot); radio = seed + same-genre trending, every 4th from the same
  artist). Server source checked at github.com/AudiusProject/api (Fiber `cors.New()` = `*`, routes, rate limiter).
  `jamendo.ts` (API v3.0, ids `jm-<id>`, links remembered per track; Home adds "Mới phát hành trên Jamendo" via
  `datebetween` 60 days; `resolveAudio(id, { download: true })` uses `audiodownload` and refuses when
  `audiodownload_allowed` is false; radio = seed + same-genre popular), `shelves.ts` (`settleShelves`, `alternate`,
  `trackItems`, `cardItems`), `tags.ts` (hand-written ID3v2.2–2.4 + MP4 `ilst` reader, filename fallback),
  `local-files.ts` (ids `lf-<sha256>`, stored via `addLocalFiles` → `DownloadStorage.saveFile`, web only),
  `service-worker.js` (template; `vite.config.ts` `progressiveWebApp()` emits `/sw.js` with the precache list + hash
  version, manifest, `apple-touch-icon.png` from `docs/icon-512.png`, iOS meta tags), `pwa.ts` (SW registration,
  `navigator.storage.persist/estimate`). Web CSP drops `'unsafe-eval'` and allows `connect-src https:`. The web player
  (`plugins/player/src/web.ts`) sets Media Session (lock screen). `SAFE_ID` is now `[\w-]{3,64}`; `withRange` only
  touches googlevideo URLs. Verified with unit tests + Playwright against `vite preview` of `dist-web` with
  `context.route` stubbing googleapis / youtube.com iframe_api + embed / api.audius.co / api.jamendo.com / storage (17
  steps incl. video stage layout, offline reload via SW; Playwright does not route the request after a fulfilled 302,
  so the stub serves `/stream` audio directly). **Not verified against real YouTube/Audius/Jamendo** (container egress
  blocks all three; iOS first-play gesture behaviour of the IFrame player is unknown until the user tries): Jamendo CORS, and whether Audius content nodes answer the
  redirected `fetch()` with CORS (mediorum uses echo `middleware.CORS()`, so it should). The SW matches precached files
  with `ignoreVary: true` (vite preview sends `Vary: Origin`, module scripts send Origin → offline reload was blank
  ~1/4 of the time before the fix).
  CI builds the web flavor too (`npm run build:web`).

NOT verified on a real iPhone yet (no device here): background playback across tracks, lock screen, FileTransfer
downloads, AVPlayer with googlevideo headers. First thing to do when the user reports back: read their in-app log.

- **Gmail / YouTube sync** (user guide `docs/GOOGLE.md`, Settings section "YouTube (Gmail)" lazy `GoogleSettings.tsx`,
  native only): `sync/google-auth.ts` device flow (`/device/code` → show `user_code` → poll `/token` every `interval`,
  `slow_down` +5 s, `access_denied` / `expired_token` errors; scopes `openid email youtube.readonly`; email from the
  id_token payload for display only), tokens + client secret in Keychain, client ID in `db.settings`, single-flight
  refresh, `invalid_grant` → signed out, revoke on sign-out. `sync/youtube-api.ts` (Data API v3: `playlists?mine`,
  `playlistItems` minus deleted/private, durations via `videos?id=` in batches of 50, liked = `videos?myRating=like`
  filtered to categoryId 10; `quotaExceeded` / `accessNotConfigured` → Vietnamese errors). `sync/youtube-sync.ts`
  (rows `source: 'youtube'`, `ytId`, snapshot = playlist etag / hash of liked ids; auto-sync > 12 h; single-flight;
  generation counter cancels on sign-out). Shared with Spotify: `sync/remote-playlists.ts` (`remotePlaylistsById`,
  `writeRemotePlaylists`, `removeMissingPlaylists`, `listSnapshot`) and `pages/settings-shared.ts`. Mocks
  `src/sync/mock/{google-auth,youtube-api}.ts` (dev:mock shows code MELO-2026, signs in after 2 s).

TODO (next sessions):
1. User test on iPhone with the checklist in docs/PLAN.md §5; fix from the in-app log.
2. First real-device Google test: user creates the OAuth client per docs/GOOGLE.md; check device flow + sync.
3. First real-device Spotify test: user creates the Spotify app per docs/SPOTIFY.md; check redirect + Keychain + sync.
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
- `npm run dev:web` / `npm run build:web` (→ `dist-web/`, what Vercel runs) — web flavor. Web smoke test (17 steps incl.
  offline reload): `npx vite preview --mode web --outDir dist-web --port 4175`, then `CHROMIUM_PATH=… node scripts/web-smoke.mjs`.
- `npx cap sync ios` — copy web build + update iOS SPM package list after adding plugins.
- `cd plugins/player && swift test` — native queue tests (macOS/Linux; CI runs them on every push).
- UI smoke test (9 flows incl. download, offline, edge swipe): `npm run dev:mock -- --port 5174`, then
  `npm i --no-save playwright && CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node scripts/ui-smoke.mjs`.
- README images (`docs/images/`): `scripts/readme-shots.mjs` (app screenshots from `dev:mock` on :5174, JPEG; slows
  blob reads only inside the script to show progress bars) and `scripts/install-illustrations.mjs` (HTML → PNG
  install-step illustrations + install page). Both need playwright (`npm i --no-save playwright`) + `CHROMIUM_PATH`.
  Mock artwork = generated SVG scenes keyed by title words (`src/youtube/mock/covers.ts`: rain, city, sea, river +
  pagoda, train, coffee, vinyl, love, letter…; albums/playlists get text, artists get silhouettes) — never real covers.
  README follows the user's NitroCine (`HoangDuc1003/Cinema-booking`) layout: centered badges, big buttons, screenshot
  tables, mermaid diagrams, structure, tech table, author.
- `node scripts/probe.mjs "<query>"`, `scripts/probe-download.mjs <id>`, `scripts/probe-potoken.mjs <id>`,
  `scripts/probe-fullget.mjs <id>`, `scripts/probe-structures.mjs <home|album|artist|…>`.
