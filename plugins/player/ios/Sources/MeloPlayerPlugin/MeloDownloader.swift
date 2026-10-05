#if os(iOS)
import Foundation

/// Tải file nhạc về máy theo từng đoạn Range ≤ 1 MiB bằng URLSession của app (cùng cách với MeloStreamLoader).
///
/// Đo trên iPhone thật (10/2026): link client IOS phát được khi xin từng đoạn 1 MiB, nhưng tải cả file trong một lần
/// (FileTransfer với `&range=0-<n>`) thì YouTube trả 403 → trình tải liên tục "tạm nghỉ". Mỗi đoạn lỗi mạng / 5xx được
/// thử lại 2 lần; 403/429 báo ngay để trình tải trong JS giảm số lượt song song.
final class MeloDownloader {
    struct HTTPError: Error {
        let status: Int
    }

    private static let chunkSize: Int64 = 1 << 20
    private static let retriesPerChunk = 2
    private let session: URLSession

    init() {
        let configuration = URLSessionConfiguration.default
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 30
        session = URLSession(configuration: configuration)
    }

    /// Tải `url` vào file `destination` (ghi đè). `progress(byte đã tải, tổng byte nếu biết)`. Trả về số byte đã ghi.
    func download(url: URL, to destination: URL, headers: [String: String], progress: @escaping (Int64, Int64?) -> Void) async throws -> Int64 {
        let fileManager = FileManager.default
        try? fileManager.removeItem(at: destination)
        guard fileManager.createFile(atPath: destination.path, contents: nil) else {
            throw NSError(domain: "MeloDownload", code: -1, userInfo: [NSLocalizedDescriptionKey: "Không tạo được file tải"])
        }
        let handle = try FileHandle(forWritingTo: destination)
        defer { try? handle.close() }

        var offset: Int64 = 0
        var total: Int64?
        while total.map({ offset < $0 }) ?? true {
            try Task.checkCancellation()
            var last = offset + Self.chunkSize - 1
            if let total { last = min(last, total - 1) }
            let (data, response) = try await fetch(url: url, headers: headers, range: "bytes=\(offset)-\(last)")
            if total == nil { total = Self.totalLength(from: response) ?? (response.statusCode == 200 ? Int64(data.count) : nil) }
            if response.statusCode == 200 {
                // Máy chủ bỏ qua Range và trả cả file.
                try handle.truncate(atOffset: 0)
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
        return offset
    }

    private func fetch(url: URL, headers: [String: String], range: String) async throws -> (Data, HTTPURLResponse) {
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
                if http.statusCode < 500 || attempt >= Self.retriesPerChunk { throw HTTPError(status: http.statusCode) }
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
