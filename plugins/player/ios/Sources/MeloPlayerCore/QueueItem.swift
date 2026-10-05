import Foundation

public enum RepeatMode: String {
    case off, all, one
}

/// Một bài trong hàng chờ native (khớp `PlayerItem` trong definitions.ts).
public struct QueueItem: Equatable {
    public var id: String
    /// Link https (hoặc file://). Rỗng = chưa có, phải xin JS qua `needsUrl`.
    public var url: String
    /// File đã tải (file://… hoặc đường dẫn tuyệt đối). Ưu tiên nếu file còn tồn tại.
    public var fileUrl: String?
    public var headers: [String: String]
    /// Cách native tự xin link mới khi `url` hết lượt (đi kèm `url`, xem StreamRefresh).
    public var refresh: StreamRefresh?
    public var title: String
    public var artist: String
    public var album: String?
    public var artwork: String?
    /// giây
    public var duration: Double?

    public init(
        id: String,
        url: String = "",
        fileUrl: String? = nil,
        headers: [String: String] = [:],
        refresh: StreamRefresh? = nil,
        title: String = "",
        artist: String = "",
        album: String? = nil,
        artwork: String? = nil,
        duration: Double? = nil
    ) {
        self.id = id
        self.url = url
        self.fileUrl = fileUrl.flatMap(nonEmpty)
        self.headers = headers
        self.refresh = refresh
        self.title = title
        self.artist = artist
        self.album = album.flatMap(nonEmpty)
        self.artwork = artwork.flatMap(nonEmpty)
        self.duration = duration
    }

    /// Đọc từ object JS mà Capacitor chuyển sang. Trả về nil nếu thiếu `id`.
    public init?(dictionary: [String: Any]) {
        guard let id = dictionary["id"] as? String, !id.isEmpty else { return nil }
        self.init(
            id: id,
            url: dictionary["url"] as? String ?? "",
            fileUrl: dictionary["fileUrl"] as? String,
            headers: stringDictionary(dictionary["headers"]) ?? [:],
            refresh: StreamRefresh(dictionary: dictionary["refresh"]),
            title: dictionary["title"] as? String ?? "",
            artist: dictionary["artist"] as? String ?? "",
            album: dictionary["album"] as? String,
            artwork: dictionary["artwork"] as? String,
            duration: number(dictionary["duration"])
        )
    }
}

/// Nguồn phát đã chọn cho một bài.
public enum PlaybackSource: Equatable {
    case file(URL)
    case remote(URL, headers: [String: String])

    public var isFile: Bool {
        if case .file = self { return true }
        return false
    }

    /// File đã tải (nếu còn) → link https → nil (cần xin link mới).
    public static func resolve(_ item: QueueItem, fileExists: (URL) -> Bool) -> PlaybackSource? {
        if let file = item.fileUrl.flatMap(fileURL), fileExists(file) {
            return .file(file)
        }
        guard !item.url.isEmpty else { return nil }
        if item.url.hasPrefix("/") || item.url.hasPrefix("file:") {
            guard let file = fileURL(item.url), fileExists(file) else { return nil }
            return .file(file)
        }
        // Chỉ nhận HTTPS (link YouTube luôn là https); http và scheme lạ bị từ chối.
        guard let url = URL(string: item.url), url.scheme?.lowercased() == "https", url.host != nil else { return nil }
        return .remote(url, headers: item.headers)
    }
}

/// Ảnh bìa cho màn hình khoá: chỉ https hoặc file trên máy.
public func artworkURL(_ value: String) -> URL? {
    if let file = fileURL(value) { return file }
    guard let url = URL(string: value), url.scheme?.lowercased() == "https", url.host != nil else { return nil }
    return url
}

/// "file:///…" hoặc "/var/…" → URL file.
func fileURL(_ value: String) -> URL? {
    if value.hasPrefix("/") { return URL(fileURLWithPath: value) }
    guard let url = URL(string: value), url.isFileURL else { return nil }
    return url
}

func nonEmpty(_ value: String) -> String? {
    value.isEmpty ? nil : value
}

/// Số từ JS có thể tới dưới dạng Double, Int hoặc NSNumber.
public func number(_ value: Any?) -> Double? {
    switch value {
    case let double as Double: return double.isFinite ? double : nil
    case let int as Int: return Double(int)
    case let number as NSNumber: return number.doubleValue.isFinite ? number.doubleValue : nil
    default: return nil
    }
}

func stringDictionary(_ value: Any?) -> [String: String]? {
    guard let dictionary = value as? [String: Any] else { return nil }
    return dictionary.compactMapValues { $0 as? String }
}
