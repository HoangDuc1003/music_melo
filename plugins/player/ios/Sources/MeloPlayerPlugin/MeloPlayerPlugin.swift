#if os(iOS)
import Capacitor
import Foundation
import MeloPlayerCore

/// Cầu nối Capacitor cho `MeloPlayer` (API: plugins/player/src/definitions.ts).
/// Lưu ý: Capacitor CLI quét chuỗi "@objc(Tên)" trong mọi file .swift của plugin để đăng ký class,
/// nên chỉ dùng cú pháp đó đúng một lần ở đây.
@objc(MeloPlayerPlugin)
public class MeloPlayerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MeloPlayerPlugin"
    public let jsName = "MeloPlayer"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setQueue", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "addItems", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeItem", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "moveItem", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateItem", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "play", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seekTo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "skipTo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "next", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "previous", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setRepeat", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setSleepTimer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "keychainGet", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "keychainSet", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "keychainRemove", returnType: CAPPluginReturnPromise)
    ]

    private var engine: MeloAudioEngine?

    override public func load() {
        DispatchQueue.main.async { _ = self.ensureEngine() }
    }

    /// Chỉ gọi trên main thread.
    private func ensureEngine() -> MeloAudioEngine {
        if let engine { return engine }
        let engine = MeloAudioEngine()
        engine.emit = { [weak self] event, data in
            self?.notifyListeners(event, data: data)
        }
        engine.log = { CAPLog.print("[MeloPlayer]", $0) }
        self.engine = engine
        return engine
    }

    /// Capacitor gọi plugin trên luồng nền; AVPlayer và hàng chờ chỉ chạm trên main thread.
    private func run(_ call: CAPPluginCall, _ body: @escaping (MeloAudioEngine) -> Void) {
        DispatchQueue.main.async {
            body(self.ensureEngine())
            call.resolve()
        }
    }

    @objc func setQueue(_ call: CAPPluginCall) {
        let items = parseItems(call.getArray("items"))
        let startIndex = call.integer("startIndex") ?? 0
        let startPosition = call.number("startPosition") ?? 0
        let playWhenReady = call.getBool("playWhenReady") ?? true
        let keepCurrent = call.getBool("keepCurrent") ?? false
        run(call) {
            $0.setQueue(items: items, startIndex: startIndex, startPosition: startPosition,
                        playWhenReady: playWhenReady, keepCurrent: keepCurrent)
        }
    }

    @objc func addItems(_ call: CAPPluginCall) {
        let items = parseItems(call.getArray("items"))
        let index = call.integer("index")
        run(call) { $0.addItems(items, at: index) }
    }

    @objc func removeItem(_ call: CAPPluginCall) {
        guard let index = call.integer("index") else { return call.reject("Thiếu index") }
        run(call) { $0.removeItem(at: index) }
    }

    @objc func moveItem(_ call: CAPPluginCall) {
        guard let from = call.integer("from"), let to = call.integer("to") else { return call.reject("Thiếu from/to") }
        run(call) { $0.moveItem(from: from, to: to) }
    }

    @objc func updateItem(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else { return call.reject("Thiếu id") }
        let url = call.getString("url")
        let fileUrl = call.getString("fileUrl")
        let headers = call.getObject("headers").map { $0.compactMapValues { $0 as? String } }
        run(call) { $0.updateItem(id: id, url: url, fileUrl: fileUrl, headers: headers) }
    }

    @objc func play(_ call: CAPPluginCall) {
        run(call) { $0.play() }
    }

    @objc func pause(_ call: CAPPluginCall) {
        run(call) { $0.pause() }
    }

    @objc func seekTo(_ call: CAPPluginCall) {
        guard let position = call.number("position") else { return call.reject("Thiếu position") }
        run(call) { $0.seek(to: position) }
    }

    @objc func skipTo(_ call: CAPPluginCall) {
        guard let index = call.integer("index") else { return call.reject("Thiếu index") }
        run(call) { $0.skip(to: index) }
    }

    @objc func next(_ call: CAPPluginCall) {
        run(call) { $0.next() }
    }

    @objc func previous(_ call: CAPPluginCall) {
        run(call) { $0.previous() }
    }

    @objc func setRepeat(_ call: CAPPluginCall) {
        guard let mode = call.getString("mode").flatMap(RepeatMode.init(rawValue:)) else {
            return call.reject("mode phải là off | all | one")
        }
        run(call) { $0.setRepeat(mode) }
    }

    @objc func setSleepTimer(_ call: CAPPluginCall) {
        let minutes = call.number("minutes") ?? 0
        let endOfItem = call.getBool("endOfItem") ?? false
        run(call) { $0.setSleepTimer(minutes: minutes, endOfItem: endOfItem) }
    }

    @objc func getState(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            call.resolve(self.ensureEngine().state)
        }
    }

    // Keychain (token đăng nhập). Đặt ở plugin này để không phải đăng ký thêm plugin native.

    @objc func keychainGet(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), !key.isEmpty else { return call.reject("Thiếu key") }
        if let value = MeloKeychain.get(key) {
            call.resolve(["value": value])
        } else {
            call.resolve(["value": NSNull()])
        }
    }

    @objc func keychainSet(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), !key.isEmpty, let value = call.getString("value") else {
            return call.reject("Thiếu key/value")
        }
        let status = MeloKeychain.set(value, for: key)
        if status == errSecSuccess {
            call.resolve()
        } else {
            call.reject("Không lưu được vào Keychain (\(status))")
        }
    }

    @objc func keychainRemove(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), !key.isEmpty else { return call.reject("Thiếu key") }
        MeloKeychain.remove(key)
        call.resolve()
    }

    private func parseItems(_ array: JSArray?) -> [QueueItem] {
        (array ?? []).compactMap { value in
            guard let object = value as? JSObject else { return nil }
            return QueueItem(dictionary: object)
        }
    }
}

private extension CAPPluginCall {
    /// Số từ JS (NSNumber) dù là số nguyên hay số thực.
    func number(_ key: String) -> Double? {
        MeloPlayerCore.number(getValue(key))
    }

    func integer(_ key: String) -> Int? {
        number(key).map { Int($0.rounded()) }
    }
}
#endif
