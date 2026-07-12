import Foundation
import Observation

@Observable
public final class HelloWorldModel {
    public private(set) var message = "Hello"

    public init() {}

    public func showWorld() {
        message = "World"
    }
}
