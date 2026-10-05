import Foundation

/// Cách native tự xin link mới cho một bài: gửi lại đúng yêu cầu `/player` mà JS (youtubei.js) đã dùng.
///
/// Link client IOS / ANDROID_VR (không PO token) chỉ tải được ~1 MiB rồi bị 403. Khi tắt màn hình, iOS có thể tạm dừng
/// JS trong WebView nên không thể chờ JS gửi link mới; native tự gửi lại yêu cầu này và lấy link của định dạng cùng
/// `itag`. Chỉ dùng cho client trả link sẵn (không mã hoá chữ ký / tham số n); không được thì vẫn nhờ JS như cũ.
public struct StreamRefresh: Equatable {
    public let endpoint: URL
    public let headers: [String: String]
    public let body: Data
    public let itag: Int

    /// Máy chủ InnerTube được phép gửi tới (JS không thể bắt native gửi yêu cầu đi nơi khác).
    static let allowedHosts: Set<String> = ["youtubei.googleapis.com", "www.youtube.com", "music.youtube.com", "m.youtube.com"]

    public init?(endpoint: URL, headers: [String: String], body: Data, itag: Int) {
        guard endpoint.scheme?.lowercased() == "https", let host = endpoint.host?.lowercased(), Self.allowedHosts.contains(host),
              endpoint.path.hasSuffix("/youtubei/v1/player"), !body.isEmpty, itag > 0
        else { return nil }
        self.endpoint = endpoint
        self.headers = headers
        self.body = body
        self.itag = itag
    }

    /// Đọc từ object JS `{ url, headers, body, itag }`. Thiếu hoặc sai thì nil.
    public init?(dictionary value: Any?) {
        guard let dictionary = value as? [String: Any],
              let endpoint = (dictionary["url"] as? String).flatMap(URL.init(string:)),
              let body = (dictionary["body"] as? String)?.data(using: .utf8),
              let itag = number(dictionary["itag"])
        else { return nil }
        self.init(endpoint: endpoint, headers: stringDictionary(dictionary["headers"]) ?? [:], body: body, itag: Int(itag))
    }

    /// Link https của định dạng cùng `itag` trong câu trả lời `/player`; nil nếu bị chặn, không có, hoặc cần giải mã.
    public func streamURL(fromPlayerResponse data: Data) -> URL? {
        guard let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              (json["playabilityStatus"] as? [String: Any])?["status"] as? String == "OK",
              let streaming = json["streamingData"] as? [String: Any],
              let formats = streaming["adaptiveFormats"] as? [[String: Any]],
              let format = formats.first(where: { number($0["itag"]).map { Int($0) } == itag }),
              let link = format["url"] as? String,
              let url = URL(string: link), url.scheme?.lowercased() == "https",
              let host = url.host?.lowercased(), host.hasSuffix(".googlevideo.com"),
              let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
              !query.contains(where: { $0.name == "n" })
        else { return nil }
        return url
    }
}
