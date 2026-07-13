import Testing
@testable import RookKit

@Test func helloWorldModelStartsAtHello() {
    let model = HelloWorldModel()
    #expect(model.message == "Hello")
    #expect(model.isLoading == false)
}
