#if os(iOS)
import AVFoundation
import Foundation

/// Phát link nhạc YouTube bằng URLSession của chính app; AVPlayer chỉ nhận dữ liệu qua delegate này.
///
/// Đo trên iPhone thật (10/2026): link client IOS qua được bước kiểm tra trong app (URLSession, header Range),
/// nhưng AVPlayer mở thẳng link thì báo "unknown error" sau ~0,1 giây với mọi bài. AVPlayer tải bằng tiến trình hệ
/// thống (kết nối, User-Agent riêng), còn link googlevideo gắn với kết nối đã lấy link. Ở đây mọi đoạn nhạc được tải
/// giống hệt bước kiểm tra: URLSession của app, header Range, tối đa 1 MiB mỗi lần (xin cả file một lần thì YouTube treo).
/// Mọi trạng thái chỉ chạm trên `queue` (delegate của AVAssetResourceLoader cũng chạy trên queue này).
final class MeloStreamLoader: NSObject, AVAssetResourceLoaderDelegate {
    static let scheme = "melo-stream"
    private static let chunkSize: Int64 = 1 << 20

    let queue = DispatchQueue(label: "com.melo.stream-loader")
    private let remote: URL
    private let headers: [String: String]
    private let log: (String) -> Void
    private let session: URLSession
    private var jobs: [ObjectIdentifier: Job] = [:]
    private var totalLength: Int64?
    private var contentType: String?

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

    init(remote: URL, headers: [String: String], log: @escaping (String) -> Void) {
        self.remote = remote
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
        }

        let lastNeeded = job.end ?? totalLength.map { $0 - 1 }
        if bytes.isEmpty || http.statusCode == 200 || lastNeeded == nil {
            // Hết dữ liệu, hoặc không biết dung lượng: trả phần đã có, AVPlayer sẽ tự xin tiếp nếu cần.
            return finish(job)
        }
        if let lastNeeded, job.offset > lastNeeded { return finish(job) }
        fetch(job)
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
