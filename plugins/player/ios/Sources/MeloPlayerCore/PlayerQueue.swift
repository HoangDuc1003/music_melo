import Foundation

/// Hàng chờ thuần Swift (không phụ thuộc AVFoundation) để test được bằng XCTest.
/// Quy ước giống bản web (plugins/player/src/web.ts): `index == -1` khi chưa có bài nào.
public struct PlayerQueue {
    public private(set) var items: [QueueItem] = []
    public private(set) var index: Int = -1
    public var repeatMode: RepeatMode = .off

    public init(items: [QueueItem] = [], index: Int = -1) {
        replace(with: items, startIndex: index)
    }

    public var current: QueueItem? {
        items.indices.contains(index) ? items[index] : nil
    }

    public var count: Int { items.count }

    public mutating func replace(with newItems: [QueueItem], startIndex: Int) {
        items = newItems
        index = newItems.isEmpty ? -1 : min(max(startIndex, 0), newItems.count - 1)
    }

    /// Chọn bài; trả về false nếu chỉ số ngoài hàng chờ.
    @discardableResult
    public mutating func select(_ newIndex: Int) -> Bool {
        guard items.indices.contains(newIndex) else { return false }
        index = newIndex
        return true
    }

    /// Chèn bài; `position == nil` là thêm vào cuối. Trả về vị trí đã chèn.
    @discardableResult
    public mutating func insert(_ newItems: [QueueItem], at position: Int?) -> Int {
        let at = position.map { min(max($0, 0), items.count) } ?? items.count
        items.insert(contentsOf: newItems, at: at)
        if index != -1 && at <= index { index += newItems.count }
        return at
    }

    public enum Removal: Equatable {
        /// Chỉ số không hợp lệ, không làm gì.
        case invalid
        /// Xoá bài khác, bài đang phát giữ nguyên.
        case other
        /// Xoá bài đang phát; bài kế tiếp đã dồn lên đúng `index`.
        case current
        /// Xoá bài đang phát và nó là bài cuối; `index` lùi về bài cuối mới (-1 nếu hết).
        case currentWasLast
    }

    public mutating func remove(at position: Int) -> Removal {
        guard items.indices.contains(position) else { return .invalid }
        items.remove(at: position)
        if position < index {
            index -= 1
            return .other
        }
        guard position == index else { return .other }
        if index < items.count { return .current }
        index = items.count - 1
        return .currentWasLast
    }

    /// Kéo thả bài. Trả về false nếu không có gì thay đổi.
    @discardableResult
    public mutating func move(from: Int, to: Int) -> Bool {
        guard from != to, items.indices.contains(from), items.indices.contains(to) else { return false }
        let moved = items.remove(at: from)
        items.insert(moved, at: to)
        if index == from {
            index = to
        } else if from < index && to >= index {
            index -= 1
        } else if from > index && to <= index {
            index += 1
        }
        return true
    }

    /// Cập nhật link/file cho mọi bài cùng id (một bài có thể xuất hiện nhiều lần).
    /// Chuỗi rỗng ở `fileUrl` nghĩa là xoá file. Trả về true nếu bài đang phát bị ảnh hưởng.
    @discardableResult
    public mutating func update(id: String, url: String? = nil, fileUrl: String? = nil, headers: [String: String]? = nil) -> Bool {
        for position in items.indices where items[position].id == id {
            if let url { items[position].url = url }
            if let fileUrl { items[position].fileUrl = nonEmpty(fileUrl) }
            if let headers { items[position].headers = headers }
        }
        return current?.id == id
    }

    /// Bỏ file hỏng của một bài để lần sau phát bằng link.
    public mutating func dropFile(id: String) {
        for position in items.indices where items[position].id == id {
            items[position].fileUrl = nil
        }
    }

    /// Bài phát tiếp khi bài hiện tại tự hết (đã tính lặp lại).
    public func indexAfterCompletion() -> Int? {
        guard index >= 0 else { return nil }
        if repeatMode == .one { return index }
        return indexAfterSkip()
    }

    /// Bài phát tiếp khi bấm "bài sau" hoặc bỏ qua bài lỗi (lặp một bài không giữ lại).
    public func indexAfterSkip() -> Int? {
        if index + 1 < items.count { return index + 1 }
        if repeatMode == .all && !items.isEmpty { return 0 }
        return nil
    }

    /// Bấm "bài trước": đã nghe quá 3 giây hoặc đang ở bài đầu → nil (phát lại từ đầu bài này).
    public func indexForPrevious(position: Double) -> Int? {
        if position > 3 || index <= 0 { return nil }
        return index - 1
    }
}

/// Link hỏng thì xin JS link mới một lần (`needsUrl`), hỏng lần nữa thì báo lỗi và bỏ qua.
public struct RetryPolicy {
    public enum Action: Equatable {
        /// File đã tải bị hỏng: bỏ file, phát lại bằng link.
        case retryWithoutFile
        /// Xin link mới (`needsUrl` với reason `failed`).
        case requestUrl
        /// Đã xin link mới mà vẫn hỏng: báo `error` rồi sang bài.
        case skip
    }

    private var retried: Set<String> = []
    private var consecutiveSkips = 0

    public init() {}

    public mutating func onFailure(id: String, usedFile: Bool) -> Action {
        if usedFile { return .retryWithoutFile }
        return retried.insert(id).inserted ? .requestUrl : .skip
    }

    /// Ghi nhận một lần bỏ qua bài lỗi. Trả về true nếu đã bỏ qua liên tiếp cả hàng chờ
    /// (mọi bài đều lỗi, ví dụ mất mạng khi đang lặp lại) → phải dừng thay vì chuyển bài mãi.
    public mutating func registerSkip(queueCount: Int) -> Bool {
        consecutiveSkips += 1
        return consecutiveSkips >= max(queueCount, 1)
    }

    /// Có bài phát được: đếm lại từ đầu.
    public mutating func playbackStarted() {
        consecutiveSkips = 0
    }

    /// Bài phát hết trọn vẹn: link lần sau hết hạn thì lại được xin link mới.
    public mutating func completed(id: String) {
        retried.remove(id)
        consecutiveSkips = 0
    }

    public mutating func reset() {
        retried.removeAll()
        consecutiveSkips = 0
    }
}

/// Hẹn giờ tắt: sau N phút, hoặc khi hết bài đang phát.
public struct SleepTimer {
    public private(set) var endsAt: Date?
    public private(set) var endOfItem = false

    public init() {}

    public var isActive: Bool { endsAt != nil || endOfItem }

    public mutating func set(minutes: Double, endOfItem: Bool, now: Date = Date()) {
        self.endOfItem = endOfItem
        endsAt = minutes > 0 ? now.addingTimeInterval(minutes * 60) : nil
    }

    public mutating func cancel() {
        endsAt = nil
        endOfItem = false
    }

    /// true nếu đã tới giờ dừng (chỉ trả về true một lần).
    public mutating func expire(now: Date = Date()) -> Bool {
        guard let endsAt, now >= endsAt else { return false }
        self.endsAt = nil
        return true
    }

    /// Gọi khi một bài phát hết: true nếu phải dừng thay vì phát tiếp.
    public mutating func consumeEndOfItem() -> Bool {
        guard endOfItem else { return false }
        endOfItem = false
        return true
    }
}

/// Trạng thái gửi cho JS (khớp `PlayerState` trong definitions.ts).
public struct PlayerSnapshot: Equatable {
    public var index: Int
    public var id: String?
    public var playing: Bool
    public var buffering: Bool
    public var position: Double
    public var duration: Double
    public var repeatMode: RepeatMode
    public var queueLength: Int
    public var sleepTimerEndsAt: Date?
    public var sleepAtEndOfItem: Bool

    public init(
        index: Int, id: String?, playing: Bool, buffering: Bool, position: Double, duration: Double,
        repeatMode: RepeatMode, queueLength: Int, sleepTimerEndsAt: Date?, sleepAtEndOfItem: Bool
    ) {
        self.index = index
        self.id = id
        self.playing = playing
        self.buffering = buffering
        self.position = position
        self.duration = duration
        self.repeatMode = repeatMode
        self.queueLength = queueLength
        self.sleepTimerEndsAt = sleepTimerEndsAt
        self.sleepAtEndOfItem = sleepAtEndOfItem
    }

    /// Chỉ chứa giá trị JSON hợp lệ (không có nil, NaN).
    public var dictionary: [String: Any] {
        var result: [String: Any] = [
            "index": index,
            "playing": playing,
            "buffering": buffering,
            "position": nonNegativeSeconds(position),
            "duration": nonNegativeSeconds(duration),
            "repeat": repeatMode.rawValue,
            "queueLength": queueLength,
            "sleepAtEndOfItem": sleepAtEndOfItem
        ]
        if let id { result["id"] = id }
        if let sleepTimerEndsAt { result["sleepTimerEndsAt"] = (sleepTimerEndsAt.timeIntervalSince1970 * 1000).rounded() }
        return result
    }
}

func nonNegativeSeconds(_ value: Double) -> Double {
    value.isFinite && value > 0 ? value : 0
}
