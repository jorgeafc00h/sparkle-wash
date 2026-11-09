import XCTest

final class OperationsUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }
    @MainActor
    func testPublicPackagesAndWorkspaceNavigation() throws {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.tabBars.buttons["Packages"].waitForExistence(timeout: 10))
        attach(app, "01-overview")
        app.tabBars.buttons["Packages"].tap()
        XCTAssertTrue(app.staticTexts["Quick Spa"].waitForExistence(timeout: 15), "Run the real API on localhost:8080 for public catalogue UI acceptance.")
        attach(app, "02-packages-car")
        app.buttons["Vehicle class"].tap()
        app.buttons["Pickup"].tap()
        XCTAssertTrue(app.staticTexts["$16"].waitForExistence(timeout: 3))
        app.staticTexts["Quick Spa"].tap()
        XCTAssertTrue(app.staticTexts["Everything included"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts["Aspirado"].exists)
        attach(app, "03-package-details")
        app.tabBars.buttons["Jobs"].tap()
        XCTAssertTrue(app.staticTexts["Follow every job"].exists)
        app.tabBars.buttons["Team"].tap()
        XCTAssertTrue(app.staticTexts["A team in sync"].exists)
        app.buttons["Account and settings"].tap()
        XCTAssertTrue(app.staticTexts["Staff access"].waitForExistence(timeout: 3))
        app.buttons["Connection settings"].tap()
        XCTAssertTrue(app.textFields["API server URL"].waitForExistence(timeout: 3))
    }

    @MainActor private func attach(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
