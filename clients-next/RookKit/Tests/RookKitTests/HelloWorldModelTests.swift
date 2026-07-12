import Testing
@testable import RookKit

@Test func helloButtonChangesMessageToWorld() {
    let model = HelloWorldModel()
    #expect(model.message == "Hello")
    model.showWorld()
    #expect(model.message == "World")
}
