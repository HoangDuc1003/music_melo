import Foundation
import XCTest
@testable import MeloPlayerCore

private func items(_ ids: String...) -> [QueueItem] {
    ids.map { QueueItem(id: $0, url: "https://example.com/\($0)") }
}

private func ids(_ queue: PlayerQueue) -> [String] {
    queue.items.map(\.id)
}

final class PlayerQueueTests: XCTestCase {
    func testReplaceClampsStartIndex() {
        var queue = PlayerQueue()
        XCTAssertEqual(queue.index, -1)
        XCTAssertNil(queue.current)

        queue.replace(with: items("a", "b", "c"), startIndex: 7)
        XCTAssertEqual(queue.index, 2)
        queue.replace(with: items("a", "b"), startIndex: -3)
        XCTAssertEqual(queue.index, 0)
        queue.replace(with: [], startIndex: 0)
        XCTAssertEqual(queue.index, -1)
    }

    func testInsertBeforeCurrentShiftsIndex() {
        var queue = PlayerQueue(items: items("a", "b", "c"), index: 1)
        XCTAssertEqual(queue.insert(items("x"), at: 0), 0)
        XCTAssertEqual(queue.current?.id, "b")
        XCTAssertEqual(queue.index, 2)

        // "Phát tiếp": chèn ngay sau bài đang phát.
        queue.insert(items("n1", "n2"), at: queue.index + 1)
        XCTAssertEqual(ids(queue), ["x", "a", "b", "n1", "n2", "c"])
        XCTAssertEqual(queue.current?.id, "b")

        // Thêm vào cuối, vị trí lớn quá thì kẹp lại.
        XCTAssertEqual(queue.insert(items("z"), at: nil), 6)
        XCTAssertEqual(queue.insert(items("y"), at: 99), 7)
        XCTAssertEqual(queue.index, 2)
    }

    func testInsertIntoEmptyQueueKeepsNoSelection() {
        var queue = PlayerQueue()
        queue.insert(items("a"), at: nil)
        XCTAssertEqual(queue.index, -1)
        XCTAssertEqual(queue.count, 1)
    }

    func testRemove() {
        var queue = PlayerQueue(items: items("a", "b", "c", "d"), index: 2)
        XCTAssertEqual(queue.remove(at: 9), .invalid)
        XCTAssertEqual(queue.remove(at: 3), .other)
        XCTAssertEqual(queue.current?.id, "c")
        XCTAssertEqual(queue.remove(at: 0), .other)
        XCTAssertEqual(queue.index, 1)
        XCTAssertEqual(queue.current?.id, "c")

        // Xoá bài đang phát là bài cuối → lùi về bài cuối mới.
        XCTAssertEqual(queue.remove(at: 1), .currentWasLast)
        XCTAssertEqual(queue.current?.id, "b")
        XCTAssertEqual(queue.remove(at: 0), .currentWasLast)
        XCTAssertEqual(queue.index, -1)

        // Xoá bài đang phát ở giữa → bài sau dồn lên cùng chỉ số.
        queue.replace(with: items("a", "b", "c"), startIndex: 1)
        XCTAssertEqual(queue.remove(at: 1), .current)
        XCTAssertEqual(queue.current?.id, "c")
    }

    func testMoveKeepsCurrentItem() {
        var queue = PlayerQueue(items: items("a", "b", "c", "d", "e"), index: 2)
        XCTAssertFalse(queue.move(from: 1, to: 1))
        XCTAssertFalse(queue.move(from: 0, to: 9))

        XCTAssertTrue(queue.move(from: 2, to: 4)) // kéo chính bài đang phát
        XCTAssertEqual(ids(queue), ["a", "b", "d", "e", "c"])
        XCTAssertEqual(queue.index, 4)

        queue.move(from: 0, to: 4) // từ trước bài đang phát ra sau nó
        XCTAssertEqual(ids(queue), ["b", "d", "e", "c", "a"])
        XCTAssertEqual(queue.index, 3)
        queue.move(from: 4, to: 0) // từ sau bài đang phát ra trước nó
        XCTAssertEqual(ids(queue), ["a", "b", "d", "e", "c"])
        XCTAssertEqual(queue.index, 4)
        queue.move(from: 3, to: 0) // cả hai đầu đều trước bài đang phát
        XCTAssertEqual(ids(queue), ["e", "a", "b", "d", "c"])
        XCTAssertEqual(queue.current?.id, "c")

        for _ in 0..<50 {
            let from = Int.random(in: 0..<queue.count)
            let to = Int.random(in: 0..<queue.count)
            let before = queue.current?.id
            queue.move(from: from, to: to)
            XCTAssertEqual(queue.current?.id, before)
        }
    }

    func testUpdateAffectsEveryCopy() {
        var queue = PlayerQueue(items: [QueueItem(id: "a"), QueueItem(id: "b"), QueueItem(id: "a")], index: 0)
        XCTAssertTrue(queue.update(id: "a", url: "https://x/a", headers: ["User-Agent": "UA"]))
        XCTAssertEqual(queue.items[0].url, "https://x/a")
        XCTAssertEqual(queue.items[2].url, "https://x/a")
        XCTAssertEqual(queue.items[2].headers, ["User-Agent": "UA"])
        XCTAssertEqual(queue.items[1].url, "")

        XCTAssertFalse(queue.update(id: "b", fileUrl: "file:///music/b.m4a"))
        XCTAssertEqual(queue.items[1].fileUrl, "file:///music/b.m4a")
        queue.update(id: "b", fileUrl: "")
        XCTAssertNil(queue.items[1].fileUrl)

        queue.update(id: "a", fileUrl: "file:///music/a.m4a")
        queue.dropFile(id: "a")
        XCTAssertNil(queue.items[0].fileUrl)
        XCTAssertNil(queue.items[2].fileUrl)
        XCTAssertEqual(queue.items[0].url, "https://x/a")
    }

    func testNavigationWithRepeatModes() {
        var queue = PlayerQueue(items: items("a", "b", "c"), index: 1)
        XCTAssertEqual(queue.indexAfterCompletion(), 2)
        XCTAssertEqual(queue.indexAfterSkip(), 2)

        queue.select(2)
        XCTAssertNil(queue.indexAfterCompletion())
        XCTAssertNil(queue.indexAfterSkip())

        queue.repeatMode = .all
        XCTAssertEqual(queue.indexAfterCompletion(), 0)
        XCTAssertEqual(queue.indexAfterSkip(), 0)

        queue.repeatMode = .one
        XCTAssertEqual(queue.indexAfterCompletion(), 2)
        XCTAssertNil(queue.indexAfterSkip())
        queue.select(0)
        XCTAssertEqual(queue.indexAfterSkip(), 1)

        XCTAssertFalse(queue.select(3))
        XCTAssertEqual(queue.index, 0)
        XCTAssertNil(PlayerQueue().indexAfterCompletion())
    }

    func testPrevious() {
        var queue = PlayerQueue(items: items("a", "b", "c"), index: 2)
        XCTAssertEqual(queue.indexForPrevious(position: 1), 1)
        XCTAssertNil(queue.indexForPrevious(position: 12))
        queue.select(0)
        XCTAssertNil(queue.indexForPrevious(position: 0))
    }
}

final class QueueItemTests: XCTestCase {
    func testParsesJavaScriptObject() throws {
        let item = try XCTUnwrap(QueueItem(dictionary: [
            "id": "dQw4w9WgXcQ",
            "url": "https://rr1---sn.googlevideo.com/videoplayback?id=1",
            "fileUrl": "",
            "headers": ["User-Agent": "Mozilla", "Bad": 3] as [String: Any],
            "title": "Lạc trôi",
            "artist": "Sơn Tùng M-TP",
            "album": "",
            "artwork": "https://lh3.googleusercontent.com/a",
            "duration": 233
        ]))
        XCTAssertEqual(item.id, "dQw4w9WgXcQ")
        XCTAssertNil(item.fileUrl)
        XCTAssertNil(item.album)
        XCTAssertEqual(item.headers, ["User-Agent": "Mozilla"])
        XCTAssertEqual(item.title, "Lạc trôi")
        XCTAssertEqual(item.duration, 233)

        XCTAssertEqual(QueueItem(dictionary: ["id": "x", "duration": 61.5])?.duration, 61.5)
        XCTAssertEqual(QueueItem(dictionary: ["id": "x", "duration": NSNumber(value: 42)])?.duration, 42)
        XCTAssertNil(QueueItem(dictionary: ["id": "x", "duration": Double.nan])?.duration)
        XCTAssertNil(QueueItem(dictionary: ["title": "no id"]))
        XCTAssertNil(QueueItem(dictionary: ["id": ""]))
    }

    func testSourcePrefersExistingFile() {
        var item = QueueItem(id: "a", url: "https://x/a", fileUrl: "file:///music/a.m4a", headers: ["User-Agent": "UA"])
        let file = URL(fileURLWithPath: "/music/a.m4a")

        XCTAssertEqual(PlaybackSource.resolve(item) { $0 == file }, .file(file))
        XCTAssertEqual(PlaybackSource.resolve(item) { _ in false }, .remote(URL(string: "https://x/a")!, headers: ["User-Agent": "UA"]))
        XCTAssertTrue(PlaybackSource.resolve(item) { _ in true }?.isFile == true)

        item.fileUrl = "/music/a.m4a" // đường dẫn trần cũng được
        XCTAssertEqual(PlaybackSource.resolve(item) { $0 == file }, .file(file))

        item.url = ""
        XCTAssertNil(PlaybackSource.resolve(item) { _ in false })
        item.url = "capacitor://localhost/x"
        XCTAssertNil(PlaybackSource.resolve(item) { _ in false })
        item.url = "file:///music/a.m4a"
        item.fileUrl = nil
        XCTAssertEqual(PlaybackSource.resolve(item) { $0 == file }, .file(file))
        XCTAssertNil(PlaybackSource.resolve(item) { _ in false })
    }
}

final class PolicyTests: XCTestCase {
    func testRetryOnceThenSkip() {
        var policy = RetryPolicy()
        XCTAssertEqual(policy.onFailure(id: "a", usedFile: true), .retryWithoutFile)
        XCTAssertEqual(policy.onFailure(id: "a", usedFile: false), .requestUrl)
        XCTAssertEqual(policy.onFailure(id: "a", usedFile: false), .skip)
        XCTAssertEqual(policy.onFailure(id: "b", usedFile: false), .requestUrl)

        // Phát hết trọn bài → lần hết hạn sau lại được xin link mới (lặp lại cả danh sách nhiều giờ).
        policy.completed(id: "a")
        XCTAssertEqual(policy.onFailure(id: "a", usedFile: false), .requestUrl)

        policy.reset()
        XCTAssertEqual(policy.onFailure(id: "b", usedFile: false), .requestUrl)
    }

    func testSleepTimer() {
        var timer = SleepTimer()
        let start = Date(timeIntervalSince1970: 1_000)
        XCTAssertFalse(timer.isActive)

        timer.set(minutes: 5, endOfItem: false, now: start)
        XCTAssertEqual(timer.endsAt, start.addingTimeInterval(300))
        XCTAssertFalse(timer.expire(now: start.addingTimeInterval(299)))
        XCTAssertTrue(timer.expire(now: start.addingTimeInterval(300)))
        XCTAssertFalse(timer.expire(now: start.addingTimeInterval(301)))
        XCTAssertFalse(timer.isActive)

        timer.set(minutes: 0, endOfItem: true, now: start)
        XCTAssertNil(timer.endsAt)
        XCTAssertTrue(timer.consumeEndOfItem())
        XCTAssertFalse(timer.consumeEndOfItem())

        timer.set(minutes: 10, endOfItem: true, now: start)
        timer.cancel()
        XCTAssertFalse(timer.isActive)
    }

    func testSnapshotIsJsonSafe() throws {
        let snapshot = PlayerSnapshot(
            index: 0, id: nil, playing: false, buffering: true, position: .nan, duration: .infinity,
            repeatMode: .all, queueLength: 1, sleepTimerEndsAt: Date(timeIntervalSince1970: 12.3456),
            sleepAtEndOfItem: false
        )
        let dictionary = snapshot.dictionary
        XCTAssertNil(dictionary["id"])
        XCTAssertEqual(dictionary["position"] as? Double, 0)
        XCTAssertEqual(dictionary["duration"] as? Double, 0)
        XCTAssertEqual(dictionary["repeat"] as? String, "all")
        XCTAssertEqual(dictionary["sleepTimerEndsAt"] as? Double, 12346)
        XCTAssertTrue(JSONSerialization.isValidJSONObject(dictionary))
        _ = try JSONSerialization.data(withJSONObject: dictionary)
    }
}
