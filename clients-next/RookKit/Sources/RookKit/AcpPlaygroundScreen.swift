import SwiftUI

public struct AcpPlaygroundScreen: View {
    @State private var model = AcpPlaygroundModel()

    public init() {}

    public var body: some View {
        Group {
            if let sessionID = model.selectedSessionID {
                chat(sessionID)
            } else {
                home
            }
        }
        .task { await model.start() }
    }

    private var home: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Sessions")
                .font(.largeTitle.bold())
            Text(model.status)
                .font(.caption)
                .foregroundStyle(.secondary)
            List(model.sessions) { session in
                Button {
                    Task { await model.openSession(session.sessionId) }
                } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(session.title)
                            .font(.headline)
                        Text(session.sessionId)
                            .font(.body.monospaced())
                        Text("runtime: \(session.runtimeId)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        if let startedAt = session.startedAt {
                            Text("started: \(startedAt)")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        Text("updated: \(session.updatedAt)")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                .buttonStyle(.plain)
            }
            VStack(alignment: .leading, spacing: 8) {
                TextField("session", text: $model.titleDraft)
                    .textFieldStyle(.roundedBorder)
                Picker("Runtime", selection: $model.selectedRuntimeID) {
                    ForEach(model.runtimeIDs, id: \.self) { runtimeID in
                        Text(runtimeID).tag(runtimeID)
                    }
                }
                .pickerStyle(.menu)
                Button("New") {
                    Task { await model.newSession() }
                }
                .buttonStyle(.borderedProminent)
                .disabled(model.selectedRuntimeID.isEmpty)
            }
        }
        .padding()
    }

    private func chat(_ sessionID: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Button("Sessions") { model.goHome() }
                Spacer()
                Text(sessionID)
                    .font(.caption.monospaced())
                    .lineLimit(1)
            }
            ScrollView {
                Text(model.transcript.isEmpty ? "Ready." : model.transcript)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
            }
            HStack {
                TextField("Message", text: $model.draft, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                Button("Send") { Task { await model.send() } }
                    .buttonStyle(.borderedProminent)
            }
            Text(model.status)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding()
    }
}
