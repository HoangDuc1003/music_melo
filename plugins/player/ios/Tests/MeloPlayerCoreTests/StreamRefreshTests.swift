import Foundation
import XCTest
@testable import MeloPlayerCore

private let recipe: [String: Any] = [
    "url": "https://youtubei.googleapis.com/youtubei/v1/player?prettyPrint=false",
    "headers": ["User-Agent": "com.google.ios.youtube/20.0", "X-Youtube-Client-Name": "5"],
    "body": #"{"videoId":"abc","context":{"client":{"clientName":"IOS"}}}"#,
    "itag": 140
]

private func playerResponse(status: String = "OK", formats: [[String: Any]]) -> Data {
    try! JSONSerialization.data(withJSONObject: ["playabilityStatus": ["status": status], "streamingData": ["adaptiveFormats": formats]])
}

final class StreamRefreshTests: XCTestCase {
    func testParsesRecipeFromJS() throws {
        let refresh = try XCTUnwrap(StreamRefresh(dictionary: recipe))
        XCTAssertEqual(refresh.itag, 140)
        XCTAssertEqual(refresh.headers["X-Youtube-Client-Name"], "5")
        XCTAssertEqual(String(data: refresh.body, encoding: .utf8), recipe["body"] as? String)
        // Đi kèm mục hàng chờ; link mới thay luôn cách xin link.
        var queue = PlayerQueue(items: [QueueItem(dictionary: ["id": "a", "url": "https://x.googlevideo.com/a", "refresh": recipe])!], index: 0)
        XCTAssertEqual(queue.items[0].refresh, refresh)
        queue.update(id: "a", url: "https://x.googlevideo.com/b")
        XCTAssertNil(queue.items[0].refresh)
        queue.update(id: "a", url: "https://x.googlevideo.com/c", refresh: refresh)
        XCTAssertEqual(queue.items[0].refresh, refresh)
        queue.update(id: "a", fileUrl: "file:///music/a.m4a")
        XCTAssertEqual(queue.items[0].refresh, refresh)
    }

    func testOnlySendsToInnerTubePlayer() {
        var other = recipe
        other["url"] = "https://evil.example.com/youtubei/v1/player"
        XCTAssertNil(StreamRefresh(dictionary: other))
        other["url"] = "http://youtubei.googleapis.com/youtubei/v1/player"
        XCTAssertNil(StreamRefresh(dictionary: other))
        other["url"] = "https://www.youtube.com/youtubei/v1/browse"
        XCTAssertNil(StreamRefresh(dictionary: other))
        other = recipe
        other["itag"] = nil
        XCTAssertNil(StreamRefresh(dictionary: other))
        XCTAssertNil(StreamRefresh(dictionary: nil))
    }

    func testPicksSameItagFromPlayerResponse() throws {
        let refresh = try XCTUnwrap(StreamRefresh(dictionary: recipe))
        let link = "https://rr1---sn-abc.googlevideo.com/videoplayback?expire=1&itag=140&c=IOS"
        let response = playerResponse(formats: [
            ["itag": 251, "url": "https://rr1---sn-abc.googlevideo.com/videoplayback?itag=251"],
            ["itag": 140, "url": link]
        ])
        XCTAssertEqual(refresh.streamURL(fromPlayerResponse: response)?.absoluteString, link)
    }

    func testRejectsBlockedCipheredOrForeignLinks() throws {
        let refresh = try XCTUnwrap(StreamRefresh(dictionary: recipe))
        let good = ["itag": 140, "url": "https://rr1---sn-abc.googlevideo.com/videoplayback?itag=140"] as [String: Any]
        XCTAssertNil(refresh.streamURL(fromPlayerResponse: playerResponse(status: "LOGIN_REQUIRED", formats: [good])))
        XCTAssertNil(refresh.streamURL(fromPlayerResponse: playerResponse(formats: [["itag": 140, "signatureCipher": "s=x&url=y"]])))
        XCTAssertNil(refresh.streamURL(fromPlayerResponse: playerResponse(formats: [["itag": 140, "url": "https://rr1.googlevideo.com/v?n=abc"]])))
        XCTAssertNil(refresh.streamURL(fromPlayerResponse: playerResponse(formats: [["itag": 140, "url": "https://example.com/v"]])))
        XCTAssertNil(refresh.streamURL(fromPlayerResponse: playerResponse(formats: [["itag": 251, "url": "https://rr1.googlevideo.com/v"]])))
        XCTAssertNil(refresh.streamURL(fromPlayerResponse: Data("not json".utf8)))
    }
}
