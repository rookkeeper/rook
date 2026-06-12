import AppKit
import CoreGraphics
import Foundation
import ScreenCaptureKit

/// Tier 4 eyes (pixel path): capture the frontmost window as a PNG via
/// ScreenCaptureKit, for the vision-grounding fallback (e.g. DeepSeek V4
/// Vision) when an app exposes no usable Accessibility tree. Needs the Screen
/// Recording permission. Returns the image plus the window origin/scale so a
/// pixel coordinate can be mapped back to global screen space for /input.
enum ScreenCapturer {
    struct Capture {
        let pngBase64: String
        let pixelWidth: Int
        let pixelHeight: Int
        let originX: Int      // window top-left in global screen coords (points)
        let originY: Int
        let scale: Double     // pixels per point along the captured longest side
    }

    static func hasPermission() -> Bool {
        CGPreflightScreenCaptureAccess()
    }

    @discardableResult
    static func requestPermission() -> Bool {
        CGRequestScreenCaptureAccess()
    }

    /// Synchronous wrapper for the bridge queue (blocks it briefly; fine for a
    /// single-connection handler).
    static func captureFrontmostWindow(maxLongSide: CGFloat = 1600) -> Capture? {
        let semaphore = DispatchSemaphore(value: 0)
        var result: Capture?
        Task {
            guard let (image, meta) = await captureImage(maxLongSide: maxLongSide) else {
                semaphore.signal()
                return
            }
            let bitmap = NSBitmapImageRep(cgImage: image)
            if let png = bitmap.representation(using: .png, properties: [:]) {
                result = Capture(
                    pngBase64: png.base64EncodedString(),
                    pixelWidth: image.width,
                    pixelHeight: image.height,
                    originX: meta.originX,
                    originY: meta.originY,
                    scale: meta.scale
                )
            }
            semaphore.signal()
        }
        semaphore.wait()
        return result
    }

    /// Capture + on-device OCR of the frontmost window. Request-free screen
    /// reading that survives bot detection and Chromium renderer limits.
    static func captureFrontmostWindowText(maxLongSide: CGFloat = 2400) -> String? {
        let semaphore = DispatchSemaphore(value: 0)
        var text: String?
        Task {
            if let (image, _) = await captureImage(maxLongSide: maxLongSide) {
                text = ScreenOCR.recognizeText(in: image)
            }
            semaphore.signal()
        }
        semaphore.wait()
        return text
    }

    private struct CaptureMeta {
        let originX: Int
        let originY: Int
        let scale: Double
    }

    private static func captureImage(maxLongSide: CGFloat) async -> (CGImage, CaptureMeta)? {
        guard hasPermission(),
              let content = try? await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true) else {
            return nil
        }
        let frontPid = NSWorkspace.shared.frontmostApplication?.processIdentifier
        let window = content.windows
            .filter { $0.owningApplication?.processID == frontPid && $0.isOnScreen }
            .max { ($0.frame.width * $0.frame.height) < ($1.frame.width * $1.frame.height) }

        let filter: SCContentFilter
        let originPoint: CGPoint
        let contentSize: CGSize
        if let window {
            filter = SCContentFilter(desktopIndependentWindow: window)
            originPoint = window.frame.origin
            contentSize = window.frame.size
        } else if let display = content.displays.first {
            filter = SCContentFilter(display: display, excludingWindows: [])
            originPoint = .zero
            contentSize = CGSize(width: display.width, height: display.height)
        } else {
            return nil
        }

        let nativeScale = Double(filter.pointPixelScale)
        let pxW = contentSize.width * CGFloat(nativeScale)
        let pxH = contentSize.height * CGFloat(nativeScale)
        let fit = min(1, maxLongSide / max(pxW, pxH))

        let config = SCStreamConfiguration()
        config.width = max(1, Int(pxW * fit))
        config.height = max(1, Int(pxH * fit))
        config.showsCursor = true

        guard let image = try? await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config) else {
            return nil
        }
        return (image, CaptureMeta(
            originX: Int(originPoint.x),
            originY: Int(originPoint.y),
            scale: nativeScale * Double(fit)
        ))
    }
}
