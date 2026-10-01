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

## Status (2026-10-01)
Done (skeleton, verified in Chrome via `npm run dev`: search "Lạc trôi" → resolve via VISIONOS → plays):
- Vite 8 + React 19 + TS 7 + Tailwind 4 + Capacitor 8.5 (iOS, SPM) project; `ios/` generated, Info.plist has
  `UIBackgroundModes=audio`, portrait only.
- `src/youtube/`: `http.ts` (native/dev fetch), `client.ts` (browse/stream/poStream sessions), `normalize.ts`,
  `music.ts` (home, search, suggestions, album, artist, playlist, up-next radio, lyrics, link parser),
  `stream.ts` (client fallback + 1MB probe + cache), `potoken.ts` (BotGuard via bgutils-js), `types.ts`.
- `plugins/player/src/`: TS API (`definitions.ts`), `index.ts`, **web implementation** (`web.ts`, HTML5 audio,
  mirrors the intended native semantics).
- `src/lib/`: `db.ts` (Dexie schema), `log.ts` (in-app log), `format.ts`, `platform.ts`.
- `src/App.tsx` is a TEMPORARY test screen (search + play). Replace with the real UI.
- `scripts/probe*.mjs`: diagnostics to re-check which YouTube clients work (run with `node`).

TODO, in this order (details in docs/PLAN.md §4):
1. **Swift plugin** in `plugins/player/`: add `Package.swift` with `name: "CapacitorMeloPlayer"` and product
   `.library(name: "CapacitorMeloPlayer", targets: ["MeloPlayerPlugin"])` (the CLI derives the name from the npm
   name `capacitor-melo-player`; copy the layout of `node_modules/@capacitor/network/Package.swift`).
   Sources in `ios/Sources/MeloPlayerPlugin/`, class `MeloPlayerPlugin: CAPPlugin, CAPBridgedPlugin` with
   `jsName = "MeloPlayer"` and every method of `definitions.ts`. AVPlayer + native queue, AVAudioSession
   `.playback`, MPNowPlayingInfoCenter, MPRemoteCommandCenter, interruptions, route change, sleep timer,
   `fileUrl` preferred when the file exists, emit `needsUrl` (missing / failed once) then `error` + skip.
   Pure-Swift queue model with XCTest in `ios/Tests/MeloPlayerPluginTests/`. Then `npx cap sync ios`.
2. **CI**: `.github/workflows/ios.yml` → `npm ci`, `npm run build`, `npx cap sync ios`, `xcodebuild`
   (`CODE_SIGNING_ALLOWED=NO`, `-sdk iphoneos`), zip `Payload/App.app` → `.ipa`, upload to a GitHub Release;
   also run the Swift tests on a simulator. Iterate on CI errors with `gh run view --log-failed`.
3. `src/player/store.ts` + `controller.ts`: pre-resolve ~20 tracks ahead, handle `needsUrl`, append radio
   (`getUpNext`) when ≤3 left (and immediately for 1-track queues), queue snapshot in localStorage, history,
   `@capacitor/network` change → `clearAudioCache()` + re-resolve (URLs are bound to the IP).
4. Real Spotify-like UI (per-tab navigation stacks, pages, mini/full player, queue sheet, lyrics view).
5. Downloads: `@capacitor/file-transfer` into `Directory.LibraryNoCloud/music/<id>.m4a` + `.jpg` + `.json`
   sidecar; max 2 concurrent; `dexie-react-hooks` for live UI; web dev fallback stores Blobs in `db.blobs`.
6. Device-flow login + Data API import, paste-a-link import, LRCLIB synced lyrics.
7. Vietnamese README for the user: SideStore install/refresh, updating, Google Cloud setup.

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

## Commands
- `npm run dev` — Vite on :5173 with the YouTube dev proxy (`/__proxy/<host>/…`, see `vite.config.ts`).
- `npm run build` — typecheck + build. `npm test` — vitest (jsdom + fake-indexeddb).
- `npx cap sync ios` — copy web build + update iOS SPM package list after adding plugins.
- `node scripts/probe.mjs "<query>"`, `scripts/probe-download.mjs <id>`, `scripts/probe-potoken.mjs <id>`,
  `scripts/probe-fullget.mjs <id>`, `scripts/probe-structures.mjs <home|album|artist|…>`.
