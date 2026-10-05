#if os(iOS)
import Foundation
import MeloPlayerCore

/// Tải file nhạc về máy theo từng đoạn Range ≤ 1 MiB bằng URLSession của app (cùng cách với MeloStreamLoader).
///
/// Đo trên iPhone thật (10/2026): link client IOS phát được khi xin từng đoạn 1 MiB, nhưng tải cả file trong một lần
/// (FileTransfer với `&range=0-<n>`) thì YouTube trả 403 → trình tải liên tục "tạm nghỉ". Mỗi đoạn lỗi mạng / 5xx được
/// thử lại 2 lần; 403/429 báo ngay để trình tải trong JS giảm số lượt song song.
///
/// Link không PO token chỉ tải được ~1 MiB: link đã cho dữ liệu mà bị 403/410 thì tự xin link mới bằng `StreamRefresh`
/// (nếu JS gửi kèm) rồi tải tiếp; không có hoặc không xin được thì báo lỗi kèm số byte đã có để JS đổi link.
final class MeloDownloader {
    struct HTTPError: Error {
        let status: Int
        /// số byte đã có trong file lúc bị từ chối (để JS xin link mới rồi tải tiếp từ đó)
        let bytes: Int64
    }

    private static let chunkSize: Int64 = 1 << 20
    private static let retriesPerChunk = 2
    /// Một bài 10 phút ~10 MiB: đủ để đổi link cho từng MiB.
    private static let maxRotations = 40
    private let session: URLSession

    init() {
        let configuration = URLSessionConfiguration.default
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 30
        session = URLSession(configuration: configuration)
    }

    /// Tải `url` vào file `destination`, bắt đầu từ byte `start` (0 = ghi lại từ đầu; > 0 = tải tiếp phần còn thiếu với
    /// link mới khi link cũ hết lượt). `progress(byte đã có, tổng byte nếu biết)`. Trả về số byte của file và số lần
    /// đã tự đổi link.
    func download(
        url: URL,
        to destination: URL,
        from start: Int64,
        headers: [String: String],
        refresh: StreamRefresh?,
        progress: @escaping (Int64, Int64?) -> Void
    ) async throws -> (bytes: Int64, rotations: Int) {
        let fileManager = FileManager.default
        if start == 0 || !fileManager.fileExists(atPath: destination.path) {
            try? fileManager.removeItem(at: destination)
            guard fileManager.createFile(atPath: destination.path, contents: nil) else {
                throw NSError(domain: "MeloDownload", code: -1, userInfo: [NSLocalizedDescriptionKey: "Không tạo được file tải"])
            }
        }
        let handle = try FileHandle(forWritingTo: destination)
        defer { try? handle.close() }
        // Bỏ phần thừa (đoạn ghi dở) rồi ghi tiếp từ `start`.
        try handle.truncate(atOffset: UInt64(max(0, start)))
        _ = try handle.seekToEnd()

        var offset: Int64 = max(0, start)
        var total: Int64?
        var link = url
        var rotations = 0
        /// byte đầu tiên tải bằng `link` (link mới bị từ chối ngay thì không đổi tiếp nữa)
        var linkStart = offset
        while total.map({ offset < $0 }) ?? true {
            try Task.checkCancellation()
            var last = offset + Self.chunkSize - 1
            if let total { last = min(last, total - 1) }
            let data: Data
            let response: HTTPURLResponse
            do {
                (data, response) = try await fetch(url: link, headers: headers, range: "bytes=\(offset)-\(last)", have: offset)
            } catch let error as HTTPError where (error.status == 403 || error.status == 410)
                && (offset > linkStart || rotations == 0) && rotations < Self.maxRotations {
                // Đổi link khi link đã cho dữ liệu, hoặc một lần ngay từ đầu (link vừa dùng để phát có thể đã hết lượt).
                guard let refresh, let fresh = try? await refresh.fetchStreamURL(session: session) else { throw error }
                link = fresh
                linkStart = offset
                rotations += 1
                continue
            }
            if total == nil { total = Self.totalLength(from: response) ?? (response.statusCode == 200 ? Int64(data.count) : nil) }
            if response.statusCode == 200 {
                // Máy chủ bỏ qua Range và trả cả file.
                try handle.truncate(atOffset: 0)
                try handle.seek(toOffset: 0)
                try handle.write(contentsOf: data)
                offset = Int64(data.count)
                progress(offset, total)
                break
            }
            if data.isEmpty { break }
            try handle.write(contentsOf: data)
            offset += Int64(data.count)
            progress(offset, total)
        }
        return (offset, rotations)
    }

    private func fetch(url: URL, headers: [String: String], range: String, have: Int64) async throws -> (Data, HTTPURLResponse) {
        var request = URLRequest(url: url)
        for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
        request.setValue(range, forHTTPHeaderField: "Range")
        var attempt = 0
        while true {
            do {
                let (data, response) = try await session.data(for: request)
                guard let http = response as? HTTPURLResponse else {
                    throw NSError(domain: "MeloDownload", code: -2, userInfo: [NSLocalizedDescriptionKey: "Phản hồi không phải HTTP"])
                }
                if http.statusCode == 200 || http.statusCode == 206 { return (data, http) }
                // 5xx: thử lại; 403/429 và lỗi khác: báo ngay.
                if http.statusCode < 500 || attempt >= Self.retriesPerChunk { throw HTTPError(status: http.statusCode, bytes: have) }
            } catch let error as HTTPError {
                throw error
            } catch {
                if error is CancellationError || attempt >= Self.retriesPerChunk { throw error }
            }
            attempt += 1
            try await Task.sleep(nanoseconds: UInt64(attempt) * 700_000_000)
        }
    }

    /// "Content-Range: bytes 0-1048575/4031923" → 4031923.
    private static func totalLength(from response: HTTPURLResponse) -> Int64? {
        guard let range = response.value(forHTTPHeaderField: "Content-Range"), let slash = range.lastIndex(of: "/") else { return nil }
        return Int64(range[range.index(after: slash)...])
    }
}
#endif
