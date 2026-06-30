// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "RookKit",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(name: "RookKit", targets: ["RookKit"]),
    ],
    dependencies: [
        .package(url: "https://github.com/gonzalezreal/swift-markdown-ui", from: "2.4.1"),
    ],
    targets: [
        .target(
            name: "RookKit",
            dependencies: [
                .product(name: "MarkdownUI", package: "swift-markdown-ui"),
            ]
        ),
        .testTarget(
            name: "RookKitTests",
            dependencies: ["RookKit"]
        ),
    ]
)
