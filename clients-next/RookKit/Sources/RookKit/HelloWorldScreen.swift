import SwiftUI

public struct HelloWorldScreen: View {
    @State private var model = HelloWorldModel()

    public init() {}

    public var body: some View {
        VStack(spacing: 16) {
            Text(model.message)
                .font(.title2)
                .multilineTextAlignment(.center)
            Button(model.isLoading ? "Loading…" : "Hello") {
                Task {
                    await model.showWorldAndFetchHealth()
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(model.isLoading)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(24)
    }
}
