// swift-tools-version: 5.9
import PackageDescription

// Tên package/product phải là "CapacitorMeloPlayer": Capacitor CLI suy ra từ tên npm "capacitor-melo-player"
// khi ghi ios/App/CapApp-SPM/Package.swift.
let package = Package(
    name: "CapacitorMeloPlayer",
    platforms: [.iOS(.v15), .macOS(.v12)],
    products: [
        .library(
            name: "CapacitorMeloPlayer",
            targets: ["MeloPlayerPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        // Logic hàng chờ thuần Swift: chạy test được cả trên macOS/Linux (`swift test`).
        .target(
            name: "MeloPlayerCore",
            path: "ios/Sources/MeloPlayerCore"),
        // Phần iOS (AVPlayer, màn hình khoá, cầu nối Capacitor). Trên nền tảng khác biên dịch thành rỗng.
        .target(
            name: "MeloPlayerPlugin",
            dependencies: [
                "MeloPlayerCore",
                .product(name: "Capacitor", package: "capacitor-swift-pm", condition: .when(platforms: [.iOS])),
                .product(name: "Cordova", package: "capacitor-swift-pm", condition: .when(platforms: [.iOS]))
            ],
            path: "ios/Sources/MeloPlayerPlugin"),
        .testTarget(
            name: "MeloPlayerCoreTests",
            dependencies: ["MeloPlayerCore"],
            path: "ios/Tests/MeloPlayerCoreTests")
    ]
)
