#if os(iOS)
import AVFoundation
import Foundation
import MediaPlayer
import MeloPlayerCore
import UIKit

/// Trình phát native: AVPlayer + hàng chờ do Swift giữ, nên hết bài vẫn tự chuyển bài
/// khi iOS đã tạm dừng JavaScript của WebView (khoá màn hình).
/// Mọi hàm chỉ được gọi trên main thread.
final class MeloAudioEngine: NSObject {
    typealias Emitter = (_ event: String, _ data: [String: Any]) -> Void

    /// Gửi sự kiện cho JS: state, itemChanged, needsUrl, error, queueEnded.
    var emit: Emitter?
    /// Ghi log ra console Xcode/Capacitor.
    var log: (String) -> Void = { print("[MeloPlayer] \($0)") }

    private let player = AVPlayer()
    private var queue = PlayerQueue()
    private var retry = RetryPolicy()
    private var sleep = SleepTimer()

    /// Người dùng muốn phát (khác với việc AVPlayer đang thật sự phát hay đang tải).
    private var playWhenReady = false
    /// Bài hiện tại chưa có link: đợi JS gọi `updateItem`.
    private var waitingForUrl = false
    private var resumeAt: Double = 0
    /// Vị trí cần tua tới khi AVPlayerItem sẵn sàng (không tua được trước lúc đó).
    private var pendingSeek: Double?
    private var currentSourceIsFile = false
    private var interruptedWhilePlaying = false

    /// Tải dữ liệu cho bài đang phát bằng link (AVAssetResourceLoader chỉ giữ tham chiếu yếu tới delegate).
    private var streamLoader: MeloStreamLoader?
    private var itemObservers: [NSObjectProtocol] = []
    private var itemStatusObservation: NSKeyValueObservation?
    private var timeControlObservation: NSKeyValueObservation?
    private var timeObserver: Any?
    private var sleepTimer: Timer?
    private var lastStateEmit = Date.distantPast

    private var artworkKey: String?
    private var artwork: MPMediaItemArtwork?
    private var artworkTask: URLSessionDataTask?

    override init() {
        super.init()
        player.actionAtItemEnd = .pause
        player.automaticallyWaitsToMinimizeStalling = true
        configureSession()
        observePlayer()
        observeSystem()
        setupRemoteCommands()
    }

    deinit {
        if let timeObserver { player.removeTimeObserver(timeObserver) }
        NotificationCenter.default.removeObserver(self)
        itemObservers.forEach { NotificationCenter.default.removeObserver($0) }
        sleepTimer?.invalidate()
    }

    // MARK: - Lệnh từ JS

    func setQueue(items: [QueueItem], startIndex: Int, startPosition: Double, playWhenReady play: Bool, keepCurrent: Bool) {
        let currentId = queue.current?.id
        let keep = keepCurrent && currentId != nil && items.indices.contains(startIndex) && items[startIndex].id == currentId
        queue.replace(with: items, startIndex: startIndex)
        retry.reset()
        if keep {
            emitState(force: true)
            updateNowPlaying()
            return
        }
        guard queue.index >= 0 else {
            stop()
            return
        }
        load(queue.index, position: startPosition, play: play)
    }

    func addItems(_ items: [QueueItem], at position: Int?) {
        guard !items.isEmpty else { return }
        queue.insert(items, at: position)
        emitState(force: true)
        updateNowPlaying()
    }

    func removeItem(at position: Int) {
        switch queue.remove(at: position) {
        case .invalid:
            return
        case .other:
            emitState(force: true)
            updateNowPlaying()
        case .current:
            load(queue.index, play: playWhenReady)
        case .currentWasLast:
            if queue.index >= 0 {
                load(queue.index, play: false)
            } else {
                stop()
            }
        }
    }

    func moveItem(from: Int, to: Int) {
        guard queue.move(from: from, to: to) else { return }
        emitState(force: true)
        updateNowPlaying()
    }

    func updateItem(id: String, url: String?, fileUrl: String?, headers: [String: String]?) {
        let affectsCurrent = queue.update(id: id, url: url, fileUrl: fileUrl, headers: headers)
        guard affectsCurrent, waitingForUrl, let item = queue.current, source(for: item) != nil else { return }
        load(queue.index, position: resumeAt, play: playWhenReady)
    }

    func play() {
        playWhenReady = true
        if waitingForUrl {
            emitState(force: true)
            return
        }
        guard queue.index >= 0 else {
            if queue.count > 0 { load(0) }
            return
        }
        guard let item = player.currentItem else {
            load(queue.index, position: resumeAt)
            return
        }
        // Hàng chờ đã hết: bấm phát thì nghe lại bài cuối từ đầu.
        let duration = item.duration.seconds
        if duration.isFinite && duration > 0 && player.currentTime().seconds >= duration - 0.5 {
            player.seek(to: .zero)
        }
        startPlayback()
    }

    func pause() {
        playWhenReady = false
        interruptedWhilePlaying = false
        player.pause()
        emitState(force: true)
        updateNowPlaying()
    }

    func seek(to position: Double) {
        let target = max(0, position)
        if waitingForUrl {
            resumeAt = target
        } else if player.currentItem == nil {
            return
        } else if pendingSeek != nil || player.currentItem?.status != .readyToPlay {
            pendingSeek = target
        } else {
            player.seek(to: time(target), toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] _ in
                DispatchQueue.main.async {
                    self?.emitState(force: true)
                    self?.updateNowPlaying()
                }
            }
        }
        emitState(force: true)
        updateNowPlaying()
    }

    func skip(to index: Int) {
        guard queue.items.indices.contains(index) else { return }
        load(index)
    }

    func next() {
        advance(manual: true)
    }

    func previous() {
        if let index = queue.indexForPrevious(position: currentPosition) {
            load(index)
        } else {
            seek(to: 0)
        }
    }

    func setRepeat(_ mode: RepeatMode) {
        queue.repeatMode = mode
        emitState(force: true)
    }

    func setSleepTimer(minutes: Double, endOfItem: Bool) {
        sleepTimer?.invalidate()
        sleepTimer = nil
        sleep.set(minutes: minutes, endOfItem: endOfItem)
        if let endsAt = sleep.endsAt {
            let timer = Timer(fire: endsAt, interval: 0, repeats: false) { [weak self] _ in
                self?.checkSleepTimer()
            }
            RunLoop.main.add(timer, forMode: .common)
            sleepTimer = timer
        }
        emitState(force: true)
    }

    var state: [String: Any] {
        snapshot.dictionary
    }

    // MARK: - Nạp và chuyển bài

    private func load(_ index: Int, position: Double = 0, play: Bool = true) {
        guard queue.select(index), let item = queue.current else {
            stop()
            return
        }
        playWhenReady = play
        pendingSeek = nil
        detachItem()
        emit?("itemChanged", ["index": index, "id": item.id])

        guard let source = source(for: item) else {
            waitingForUrl = true
            resumeAt = position
            player.replaceCurrentItem(with: nil)
            emit?("needsUrl", ["index": index, "id": item.id, "reason": "missing"])
            emitState(force: true)
            updateNowPlaying()
            return
        }

        waitingForUrl = false
        resumeAt = 0
        let asset: AVURLAsset
        switch source {
        case .file(let url):
            currentSourceIsFile = true
            asset = AVURLAsset(url: url)
        case .remote(let url, let headers):
            currentSourceIsFile = false
            // Tải qua URLSession của app (xem MeloStreamLoader): AVPlayer mở thẳng link YouTube thì bị từ chối.
            let loader = MeloStreamLoader(remote: url, headers: headers) { [weak self] message in
                DispatchQueue.main.async { self?.log(message) }
            }
            if let streamURL = loader.assetURL {
                let streamAsset = AVURLAsset(url: streamURL)
                streamAsset.resourceLoader.setDelegate(loader, queue: loader.queue)
                streamLoader = loader
                asset = streamAsset
            } else {
                asset = AVURLAsset(url: url, options: headers.isEmpty ? nil : ["AVURLAssetHTTPHeaderFieldsKey": headers])
            }
        }
        let playerItem = AVPlayerItem(asset: asset)
        attach(playerItem)
        player.replaceCurrentItem(with: playerItem)
        if position > 0 { pendingSeek = position }

        if play && pendingSeek == nil {
            startPlayback()
        } else {
            player.pause()
            emitState(force: true)
            updateNowPlaying()
        }
    }

    private func startPlayback() {
        activateSession()
        if pendingSeek == nil { player.play() }
        emitState(force: true)
        updateNowPlaying()
    }

    private func advance(manual: Bool) {
        if let index = queue.indexAfterSkip() {
            load(index, play: manual || playWhenReady)
            return
        }
        if !manual { emit?("queueEnded", [:]) }
        playWhenReady = false
        player.pause()
        emitState(force: true)
        updateNowPlaying()
    }

    private func stop() {
        detachItem()
        player.replaceCurrentItem(with: nil)
        playWhenReady = false
        waitingForUrl = false
        pendingSeek = nil
        resumeAt = 0
        emitState(force: true)
        updateNowPlaying()
    }

    private func source(for item: QueueItem) -> PlaybackSource? {
        PlaybackSource.resolve(item) { FileManager.default.fileExists(atPath: $0.path) }
    }

    // MARK: - Theo dõi AVPlayerItem

    private func attach(_ item: AVPlayerItem) {
        itemStatusObservation = item.observe(\.status, options: [.new]) { [weak self, weak item] _, _ in
            DispatchQueue.main.async {
                guard let self, let item, item === self.player.currentItem else { return }
                self.itemStatusChanged(item)
            }
        }
        let center = NotificationCenter.default
        itemObservers = [
            center.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main) { [weak self, weak item] _ in
                guard let self, let item, item === self.player.currentItem else { return }
                self.itemEnded()
            },
            center.addObserver(forName: .AVPlayerItemFailedToPlayToEndTime, object: item, queue: .main) { [weak self, weak item] note in
                guard let self, let item, item === self.player.currentItem else { return }
                let error = note.userInfo?[AVPlayerItemFailedToPlayToEndTimeErrorKey] as? Error
                self.itemFailed(error)
            },
            center.addObserver(forName: .AVPlayerItemPlaybackStalled, object: item, queue: .main) { [weak self] _ in
                self?.emitState(force: true)
            }
        ]
    }

    private func detachItem() {
        streamLoader = nil
        itemStatusObservation?.invalidate()
        itemStatusObservation = nil
        itemObservers.forEach { NotificationCenter.default.removeObserver($0) }
        itemObservers = []
    }

    private func itemStatusChanged(_ item: AVPlayerItem) {
        switch item.status {
        case .readyToPlay:
            if let target = pendingSeek {
                player.seek(to: time(target), toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] _ in
                    DispatchQueue.main.async {
                        guard let self, item === self.player.currentItem else { return }
                        self.pendingSeek = nil
                        if self.playWhenReady { self.startPlayback() } else { self.emitState(force: true) }
                    }
                }
            } else {
                emitState(force: true)
            }
            updateNowPlaying()
        case .failed:
            itemFailed(item.error)
        default:
            break
        }
    }

    private func itemEnded() {
        if let id = queue.current?.id { retry.completed(id: id) }
        if sleep.consumeEndOfItem() {
            // Hẹn giờ "hết bài này": chuyển sẵn sang bài sau nhưng không phát.
            if let index = queue.indexAfterCompletion(), index != queue.index {
                load(index, play: false)
            } else {
                pause()
            }
            return
        }
        if queue.repeatMode == .one {
            player.seek(to: .zero)
            player.play()
            return
        }
        advance(manual: false)
    }

    private func itemFailed(_ error: Error?) {
        guard let item = queue.current, !waitingForUrl else { return }
        let position = currentPosition
        let message = error?.localizedDescription ?? "Không phát được bài này"
        // Chi tiết để chẩn đoán (hiện trong Cài đặt → Nhật ký): miền/mã lỗi gốc và lỗi mạng AVPlayer ghi lại.
        var detail = error.map(describeError) ?? "không rõ lỗi"
        if let event = player.currentItem?.errorLog()?.events.last {
            detail += " • errorLog: \(event.errorDomain) \(event.errorStatusCode) \(event.errorComment ?? "")"
        }
        log("Lỗi phát \(item.id) (\(currentSourceIsFile ? "file" : "link")): \(detail)")
        detachItem()
        switch retry.onFailure(id: item.id, usedFile: currentSourceIsFile) {
        case .retryWithoutFile:
            queue.dropFile(id: item.id)
            load(queue.index, position: position, play: playWhenReady)
        case .requestUrl:
            waitingForUrl = true
            resumeAt = position
            pendingSeek = nil
            player.replaceCurrentItem(with: nil)
            emit?("needsUrl", ["index": queue.index, "id": item.id, "reason": "failed"])
            emitState(force: true)
            updateNowPlaying()
        case .skip:
            emit?("error", ["index": queue.index, "id": item.id, "message": message])
            if retry.registerSkip(queueCount: queue.count) {
                // Nhiều bài liên tiếp đều lỗi (mất mạng, YouTube chặn…): dừng, không chuyển bài mãi.
                log("Nhiều bài liên tiếp không phát được: dừng phát")
                retry.reset() // bấm phát lại (khi có mạng) thì mỗi bài lại được xin link mới
                playWhenReady = false
                player.replaceCurrentItem(with: nil)
                emitState(force: true)
                updateNowPlaying()
            } else {
                advance(manual: false)
            }
        }
    }

    // MARK: - Trạng thái

    private var currentPosition: Double {
        if waitingForUrl { return resumeAt }
        if let pendingSeek { return pendingSeek }
        let seconds = player.currentTime().seconds
        return seconds.isFinite ? max(0, seconds) : 0
    }

    private var currentDuration: Double {
        if let seconds = player.currentItem?.duration.seconds, seconds.isFinite, seconds > 0 { return seconds }
        return queue.current?.duration ?? 0
    }

    private var isBuffering: Bool {
        if waitingForUrl || pendingSeek != nil { return true }
        if player.currentItem?.status == .unknown { return true }
        return player.timeControlStatus == .waitingToPlayAtSpecifiedRate
    }

    private var isPlaying: Bool {
        if waitingForUrl { return false }
        if pendingSeek != nil { return playWhenReady }
        return player.timeControlStatus != .paused
    }

    private var snapshot: PlayerSnapshot {
        PlayerSnapshot(
            index: queue.index,
            id: queue.current?.id,
            playing: isPlaying,
            buffering: isBuffering,
            position: currentPosition,
            duration: currentDuration,
            repeatMode: queue.repeatMode,
            queueLength: queue.count,
            sleepTimerEndsAt: sleep.endsAt,
            sleepAtEndOfItem: sleep.endOfItem
        )
    }

    /// Khi app ở nền JS đang bị tạm dừng: chỉ gửi sự kiện quan trọng, không gửi nhịp mỗi giây.
    private func emitState(force: Bool = false) {
        let now = Date()
        if !force {
            guard UIApplication.shared.applicationState == .active, now.timeIntervalSince(lastStateEmit) > 0.9 else { return }
        }
        lastStateEmit = now
        emit?("state", snapshot.dictionary)
    }

    private func checkSleepTimer() {
        guard sleep.expire() else { return }
        sleepTimer?.invalidate()
        sleepTimer = nil
        log("Hẹn giờ tắt: dừng phát")
        pause()
    }

    // MARK: - Màn hình khoá / Control Center

    private func updateNowPlaying() {
        let center = MPNowPlayingInfoCenter.default()
        guard let item = queue.current else {
            center.nowPlayingInfo = nil
            return
        }
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: item.title,
            MPMediaItemPropertyArtist: item.artist,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: currentPosition,
            MPNowPlayingInfoPropertyPlaybackRate: player.timeControlStatus == .playing ? 1.0 : 0.0,
            MPNowPlayingInfoPropertyDefaultPlaybackRate: 1.0,
            MPNowPlayingInfoPropertyPlaybackQueueIndex: queue.index,
            MPNowPlayingInfoPropertyPlaybackQueueCount: queue.count,
            MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue
        ]
        let duration = currentDuration
        if duration > 0 { info[MPMediaItemPropertyPlaybackDuration] = duration }
        if let album = item.album { info[MPMediaItemPropertyAlbumTitle] = album }
        if let artwork, artworkKey == item.artwork {
            info[MPMediaItemPropertyArtwork] = artwork
        } else {
            loadArtwork(item.artwork)
        }
        center.nowPlayingInfo = info
    }

    private func loadArtwork(_ value: String?) {
        guard value != artworkKey else { return }
        artworkKey = value
        artwork = nil
        artworkTask?.cancel()
        artworkTask = nil
        guard let value, let url = artworkURL(value) else { return }
        if url.isFileURL {
            if let image = UIImage(contentsOfFile: url.path) { applyArtwork(image, key: value) }
            return
        }
        let task = URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
            guard let data, let image = UIImage(data: data) else { return }
            DispatchQueue.main.async { self?.applyArtwork(image, key: value) }
        }
        artworkTask = task
        task.resume()
    }

    private func applyArtwork(_ image: UIImage, key: String) {
        guard artworkKey == key else { return }
        artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
        let center = MPNowPlayingInfoCenter.default()
        guard queue.current?.artwork == key, var info = center.nowPlayingInfo else { return }
        info[MPMediaItemPropertyArtwork] = artwork
        center.nowPlayingInfo = info
    }

    private func setupRemoteCommands() {
        let commands = MPRemoteCommandCenter.shared()
        commands.playCommand.addTarget { [weak self] _ in
            self?.play()
            return .success
        }
        commands.pauseCommand.addTarget { [weak self] _ in
            self?.pause()
            return .success
        }
        commands.togglePlayPauseCommand.addTarget { [weak self] _ in
            guard let self else { return .commandFailed }
            if self.playWhenReady { self.pause() } else { self.play() }
            return .success
        }
        commands.nextTrackCommand.addTarget { [weak self] _ in
            self?.next()
            return .success
        }
        commands.previousTrackCommand.addTarget { [weak self] _ in
            self?.previous()
            return .success
        }
        commands.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let self, let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            self.seek(to: event.positionTime)
            return .success
        }
        commands.skipForwardCommand.isEnabled = false
        commands.skipBackwardCommand.isEnabled = false
        commands.seekForwardCommand.isEnabled = false
        commands.seekBackwardCommand.isEnabled = false
        UIApplication.shared.beginReceivingRemoteControlEvents()
    }

    // MARK: - Audio session, cuộc gọi, tai nghe

    private func configureSession() {
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [])
        } catch {
            log("Không đặt được AVAudioSession: \(error.localizedDescription)")
        }
    }

    private func activateSession() {
        do {
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            log("Không bật được AVAudioSession: \(error.localizedDescription)")
        }
    }

    private func observePlayer() {
        timeControlObservation = player.observe(\.timeControlStatus, options: [.new]) { [weak self] _, _ in
            DispatchQueue.main.async {
                guard let self else { return }
                if self.player.timeControlStatus == .playing { self.retry.playbackStarted() }
                self.emitState(force: true)
                self.updateNowPlaying()
            }
        }
        timeObserver = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 1, preferredTimescale: 10), queue: .main) { [weak self] _ in
            guard let self else { return }
            self.checkSleepTimer()
            self.emitState()
        }
    }

    private func observeSystem() {
        let center = NotificationCenter.default
        let session = AVAudioSession.sharedInstance()
        center.addObserver(self, selector: #selector(handleInterruption), name: AVAudioSession.interruptionNotification, object: session)
        center.addObserver(self, selector: #selector(handleRouteChange), name: AVAudioSession.routeChangeNotification, object: session)
        center.addObserver(self, selector: #selector(handleMediaServicesReset), name: AVAudioSession.mediaServicesWereResetNotification, object: session)
        center.addObserver(self, selector: #selector(handleDidBecomeActive), name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    @objc private func handleInterruption(_ notification: Notification) {
        DispatchQueue.main.async { self.interruption(notification) }
    }

    private func interruption(_ notification: Notification) {
        guard let info = notification.userInfo,
              let rawType = info[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: rawType) else { return }
        switch type {
        case .began:
            // Cuộc gọi, báo thức…: iOS đã tự dừng AVPlayer.
            let wasPlaying = playWhenReady
            pause()
            interruptedWhilePlaying = wasPlaying
        case .ended:
            let rawOptions = info[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
            let shouldResume = AVAudioSession.InterruptionOptions(rawValue: rawOptions).contains(.shouldResume)
            if interruptedWhilePlaying && shouldResume { play() }
            interruptedWhilePlaying = false
        @unknown default:
            break
        }
    }

    @objc private func handleRouteChange(_ notification: Notification) {
        guard let rawReason = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
              AVAudioSession.RouteChangeReason(rawValue: rawReason) == .oldDeviceUnavailable else { return }
        // Rút tai nghe / ngắt Bluetooth: dừng, không phát ra loa ngoài.
        DispatchQueue.main.async { self.pause() }
    }

    @objc private func handleMediaServicesReset(_ notification: Notification) {
        DispatchQueue.main.async {
            self.log("Media services reset: nạp lại bài hiện tại")
            self.configureSession()
            guard self.queue.index >= 0 else { return }
            self.load(self.queue.index, position: self.currentPosition, play: self.playWhenReady)
        }
    }

    @objc private func handleDidBecomeActive(_ notification: Notification) {
        // JS vừa chạy lại sau khi app ở nền: đồng bộ bài và trạng thái hiện tại.
        if let item = queue.current { emit?("itemChanged", ["index": queue.index, "id": item.id]) }
        emitState(force: true)
    }

    private func time(_ seconds: Double) -> CMTime {
        CMTime(seconds: seconds, preferredTimescale: 1000)
    }
}
#endif
