import Foundation
import SwiftUI

@MainActor
public enum EnvironmentListPresentation {
    public static func startAutoRefresh(
        task: inout Task<Void, Never>?,
        intervalNanoseconds: UInt64 = 5_000_000_000,
        refresh: @escaping @MainActor (_ showLoading: Bool) -> Void
    ) {
        guard task == nil else { return }
        refresh(true)
        task = Task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: intervalNanoseconds)
                guard !Task.isCancelled else { break }
                await MainActor.run {
                    refresh(false)
                }
            }
        }
    }

    public static func stopAutoRefresh(task: inout Task<Void, Never>?) {
        task?.cancel()
        task = nil
    }

    public static func apply(
        _ refreshedItems: [EnvironmentListItem],
        to currentItems: inout [EnvironmentListItem],
        animation: Animation = .snappy(duration: 0.28, extraBounce: 0)
    ) {
        guard currentItems != refreshedItems else { return }
        withAnimation(animation) {
            currentItems = refreshedItems
        }
    }

    public static func shouldDisplaySourceName(for item: EnvironmentListItem) -> Bool {
        guard let sourceName = item.sourceName,
              sourceName != item.displayName,
              sourceName != item.environmentId else { return false }
        if item.environmentId.hasPrefix("web:") { return false }
        let lower = sourceName.lowercased()
        return !(lower.hasPrefix("http://") || lower.hasPrefix("https://"))
    }
}
