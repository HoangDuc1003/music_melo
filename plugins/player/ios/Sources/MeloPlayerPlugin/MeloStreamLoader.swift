#if os(iOS)
import AVFoundation
import Foundation
import MeloPlayerCore

/// Phát link nhạc YouTube bằng URLSession của chính app; AVPlayer chỉ nhận dữ liệu qua delegate này.
///
/// Đo trên iPhone thật (10/2026): link client IOS qua được bước kiểm tra trong app (URLSession, header Range),
/// nhưng AVPlayer mở thẳng link thì báo "unknown error" sau ~0,1 giây với mọi bài. AVPlayer tải bằng tiến trình hệ
/// thống (kết nối, User-Agent riêng), còn link googlevideo gắn với kết nối đã lấy link. Ở đây mọi đoạn nhạc được tải
/// giống hệt bước kiểm tra: URLSession của app, header Range, tối đa 1 MiB mỗi lần (xin cả file một lần thì YouTube treo).
///
/// Link không có PO token chỉ được YouTube cho khoảng 1 MiB (đo trên iPhone: phát được ~1 phút rồi đứng). Khi đã nhận
/// được dữ liệu mà một đoạn bị 403/410, loader giữ các yêu cầu lại, xin link mới rồi tải tiếp đúng chỗ dừng:
/// trước hết tự gửi lại yêu cầu `/player` (`StreamRefresh`, chạy được cả khi tắt màn hình lúc JS bị iOS tạm dừng),
/// không được thì gọi `onExpired` để JS lấy link mới rồi gọi `offerRemote`. Link mới cũng bị từ chối ngay từ đầu
/// thì mới báo lỗi.
/// Mọi trạng thái chỉ chạm trên `queue` (delegate của AVAssetResourceLoader cũng chạy trên queue này).
final class MeloStreamLoader: NSObject, AVAssetResourceLoaderDelegate {
    static let scheme = "melo-stream"
    private static let chunkSize: Int64 = 1 << 20
    /// Một bài 10 phút ~10 MiB: đủ để đổi link cho từng MiB.
    private static let maxRotations = 40

    let queue = DispatchQueue(label: "com.melo.stream-loader")
    /// Gọi trên main thread khi cần link mới (link hiện tại hết lượt).
    var onExpired: (() -> Void)?
    private var remote: URL
    private var refresh: StreamRefresh?
    /// Tự xin link đã lỗi một lần: các lần sau nhờ JS luôn.
    private var refreshFailed = false
    private let headers: [String: String]
    private let log: (String) -> Void
    private let session: URLSession
    private var jobs: [ObjectIdentifier: Job] = [:]
    private var totalLength: Int64?
    private var contentType: String?
    /// Đang đợi link mới; các yêu cầu bị từ chối nằm trong `parked`.
    private var awaitingURL = false
    private var parked: [Job] = []
    private var rotations = 0
    /// Số byte link hiện tại đã trả (link mới bị từ chối ngay thì không đổi tiếp nữa).
    private var servedSinceRotation: Int64 = 0

    /// Một yêu cầu dữ liệu của AVPlayer, tải dần từng đoạn.
    private final class Job {
        let request: AVAssetResourceLoadingRequest
        /// byte tiếp theo cần tải
        var offset: Int64
        /// byte cuối cần (gồm cả nó); nil = tới hết file
        let end: Int64?
        var task: URLSessionDataTask?

        init(request: AVAssetResourceLoadingRequest) {
            self.request = request
            if let data = request.dataRequest {
                offset = data.requestedOffset
                end = data.requestsAllDataToEndOfResource ? nil : data.requestedOffset + Int64(data.requestedLength) - 1
            } else {
                // Chỉ hỏi thông tin (dung lượng, kiểu file): tải 2 byte đầu là đủ.
                offset = 0
                end = 1
            }
        }
    }

    init(remote: URL, headers: [String: String], refresh: StreamRefresh?, log: @escaping (String) -> Void) {
        self.remote = remote
        self.refresh = refresh
        self.headers = headers
        self.log = log
        let configuration = URLSessionConfiguration.default
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 30
        session = URLSession(configuration: configuration)
        super.init()
    }

    deinit {
        session.invalidateAndCancel()
    }

    /// Link mới cho bài này (JS gửi qua `updateItem`): dùng cho các đoạn sau, tải tiếp các yêu cầu đang đợi.
    func offerRemote(_ url: URL, refresh: StreamRefresh?) {
        queue.async {
            if let refresh {
                self.refresh = refresh
                self.refreshFailed = false
            }
            self.useRemote(url, from: "JS")
        }
    }

    private func useRemote(_ url: URL, from source: String) {
        remote = url
        guard awaitingURL else { return }
        awaitingURL = false
        rotations += 1
        servedSinceRotation = 0
        let waiting = parked
        parked = []
        log("Đã có link mới (lần \(rotations), \(source)), tải tiếp")
        for job in waiting where jobs[ObjectIdentifier(job.request)] === job { fetch(job) }
    }

    /// Link đưa cho AVURLAsset: đổi scheme để AVPlayer phải hỏi delegate thay vì tự tải.
    var assetURL: URL? {
        var components = URLComponents(url: remote, resolvingAgainstBaseURL: false)
        components?.scheme = Self.scheme
        return components?.url
    }

    // MARK: - AVAssetResourceLoaderDelegate

    func resourceLoader(_ resourceLoader: AVAssetResourceLoader, shouldWaitForLoadingOfRequestedResource loadingRequest: AVAssetResourceLoadingRequest) -> Bool {
        let job = Job(request: loadingRequest)
        jobs[ObjectIdentifier(loadingRequest)] = job
        fetch(job)
        return true
    }

    func resourceLoader(_ resourceLoader: AVAssetResourceLoader, didCancel loadingRequest: AVAssetResourceLoadingRequest) {
        jobs.removeValue(forKey: ObjectIdentifier(loadingRequest))?.task?.cancel()
    }

    // MARK: - Tải từng đoạn

    private func fetch(_ job: Job) {
        var last = job.offset + Self.chunkSize - 1
        if let end = job.end { last = min(last, end) }
        if let total = totalLength {
            guard job.offset < total else { return finish(job) }
            last = min(last, total - 1)
        }
        var request = URLRequest(url: remote)
        for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
        request.setValue("bytes=\(job.offset)-\(last)", forHTTPHeaderField: "Range")
        let task = session.dataTask(with: request) { [weak self] data, response, error in
            guard let self else { return }
            self.queue.async { self.received(job, data: data, response: response, error: error) }
        }
        job.task = task
        task.resume()
    }

    private func received(_ job: Job, data: Data?, response: URLResponse?, error: Error?) {
        // AVPlayer đã huỷ yêu cầu này.
        guard jobs[ObjectIdentifier(job.request)] === job else { return }
        if let error {
            return fail(job, error, detail: "lỗi mạng ở byte \(job.offset): \(describeError(error))")
        }
        guard let http = response as? HTTPURLResponse else {
            return fail(job, Self.error(-1, "Phản hồi không phải HTTP"), detail: "phản hồi không phải HTTP")
        }
        guard http.statusCode == 206 || http.statusCode == 200 else {
            let expired = http.statusCode == 403 || http.statusCode == 410
            if expired, servedSinceRotation > 0, rotations < Self.maxRotations, refresh != nil || onExpired != nil {
                return park(job, status: http.statusCode)
            }
            return fail(job, Self.error(http.statusCode, "YouTube trả mã HTTP \(http.statusCode)"), detail: "HTTP \(http.statusCode) ở byte \(job.offset)")
        }
        if totalLength == nil { totalLength = Self.totalLength(from: http) }
        if contentType == nil { contentType = Self.fileType(for: http.mimeType) }
        if let info = job.request.contentInformationRequest {
            info.contentType = contentType
            info.contentLength = totalLength ?? 0
            info.isByteRangeAccessSupported = true
        }
        guard let dataRequest = job.request.dataRequest else { return finish(job) }

        var bytes = data ?? Data()
        // Máy chủ bỏ qua Range và trả cả file: chỉ lấy đúng đoạn cần.
        if http.statusCode == 200, job.offset > 0 {
            bytes = Int64(bytes.count) > job.offset ? bytes.subdata(in: Int(job.offset)..<bytes.count) : Data()
        }
        if let end = job.end, Int64(bytes.count) > end - job.offset + 1 {
            bytes = bytes.prefix(Int(end - job.offset + 1))
        }
        if !bytes.isEmpty {
            dataRequest.respond(with: bytes)
            job.offset += Int64(bytes.count)
            servedSinceRotation += Int64(bytes.count)
        }

        let lastNeeded = job.end ?? totalLength.map { $0 - 1 }
        if bytes.isEmpty || http.statusCode == 200 || lastNeeded == nil {
            // Hết dữ liệu, hoặc không biết dung lượng: trả phần đã có, AVPlayer sẽ tự xin tiếp nếu cần.
            return finish(job)
        }
        if let lastNeeded, job.offset > lastNeeded { return finish(job) }
        fetch(job)
    }

    /// Link hết lượt: giữ yêu cầu lại và xin link mới (một lần cho cả nhóm yêu cầu đang đợi).
    private func park(_ job: Job, status: Int) {
        parked.append(job)
        guard !awaitingURL else { return }
        awaitingURL = true
        log("YouTube từ chối đoạn ở byte \(job.offset) (HTTP \(status)) sau \(servedSinceRotation) byte: xin link mới")
        guard let refresh, !refreshFailed else { return askJS() }
        refresh.fetchStreamURL(session: session) { [weak self] result in
            guard let self else { return }
            self.queue.async {
                guard self.awaitingURL else { return } // JS đã gửi link trước
                switch result {
                case .success(let url):
                    self.useRemote(url, from: "tự lấy")
                case .failure(let error):
                    self.refreshFailed = true
                    self.log("Tự lấy link mới lỗi: \(describeError(error)) → nhờ JS")
                    self.askJS()
                }
            }
        }
    }

    private func askJS() {
        if let onExpired { return DispatchQueue.main.async(execute: onExpired) }
        // Không ai cấp link mới: báo lỗi để trình phát xử lý như bài lỗi.
        awaitingURL = false
        let waiting = parked
        parked = []
        for job in waiting where jobs[ObjectIdentifier(job.request)] === job {
            fail(job, Self.error(403, "Link hết lượt"), detail: "link hết lượt ở byte \(job.offset)")
        }
    }

    private func finish(_ job: Job) {
        jobs.removeValue(forKey: ObjectIdentifier(job.request))
        job.request.finishLoading()
    }

    private func fail(_ job: Job, _ error: Error, detail: String) {
        jobs.removeValue(forKey: ObjectIdentifier(job.request))
        log("Tải nhạc lỗi: \(detail)")
        job.request.finishLoading(with: error)
    }

    // MARK: - Tiện ích

    private static func error(_ code: Int, _ message: String) -> NSError {
        NSError(domain: "MeloStream", code: code, userInfo: [NSLocalizedDescriptionKey: message])
    }

    /// "Content-Range: bytes 0-1/4031923" → 4031923.
    private static func totalLength(from response: HTTPURLResponse) -> Int64? {
        if let range = response.value(forHTTPHeaderField: "Content-Range"),
           let slash = range.lastIndex(of: "/"),
           let total = Int64(range[range.index(after: slash)...]) {
            return total
        }
        return response.statusCode == 200 && response.expectedContentLength > 0 ? response.expectedContentLength : nil
    }

    /// Kiểu file (UTI) AVPlayer cần, theo Content-Type của máy chủ (YouTube: "audio/mp4").
    private static func fileType(for mimeType: String?) -> String {
        switch mimeType?.lowercased() {
        case "audio/mpeg", "audio/mp3":
            return AVFileType.mp3.rawValue
        case "video/mp4":
            return AVFileType.mp4.rawValue
        default:
            return AVFileType.m4a.rawValue
        }
    }
}

/// Mô tả lỗi đủ để chẩn đoán: miền + mã + các lỗi gốc lồng bên trong (localizedDescription chỉ ra "unknown error").
func describeError(_ error: Error) -> String {
    var parts: [String] = []
    var current: NSError? = error as NSError
    while let nsError = current, parts.count < 4 {
        parts.append("\(nsError.domain) \(nsError.code) (\(nsError.localizedDescription))")
        current = nsError.userInfo[NSUnderlyingErrorKey] as? NSError
    }
    return parts.joined(separator: " ← ")
}
#endif
