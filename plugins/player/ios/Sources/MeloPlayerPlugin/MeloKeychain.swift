#if os(iOS)
import Foundation
import Security

/// Lưu chuỗi bí mật (token đăng nhập Spotify/Google) trong Keychain của iOS, không lưu trong WebView.
/// `AfterFirstUnlockThisDeviceOnly`: đọc được khi app chạy nền sau lần mở khoá đầu, không sao lưu sang máy khác.
enum MeloKeychain {
    private static let service = "com.melo.music.secure"

    private static func query(_ key: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key
        ]
    }

    static func set(_ value: String, for key: String) -> OSStatus {
        SecItemDelete(query(key) as CFDictionary)
        var item = query(key)
        item[kSecValueData as String] = Data(value.utf8)
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        return SecItemAdd(item as CFDictionary, nil)
    }

    static func get(_ key: String) -> String? {
        var item = query(key)
        item[kSecReturnData as String] = true
        item[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        guard SecItemCopyMatching(item as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func remove(_ key: String) {
        SecItemDelete(query(key) as CFDictionary)
    }
}
#endif
