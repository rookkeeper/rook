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
    targets: [
        .target(name: "RookKit"),
        .testTarget(name: "RookKitTests", dependencies: ["RookKit"]),
    ]
)
