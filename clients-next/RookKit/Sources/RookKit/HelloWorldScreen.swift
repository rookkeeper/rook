import SwiftUI

public struct HelloWorldScreen: View {
    @State private var model = HelloWorldModel()

    public init() {}

    public var body: some View {
        VStack(spacing: 16) {
            Text(model.message)
                .font(.largeTitle)
            Button("Hello") {
                model.showWorld()
            }
            .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(24)
    }
}
