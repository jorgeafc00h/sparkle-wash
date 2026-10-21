import XCTest

/// End-to-end flows on the demo backend (no server needed). They run on an iPhone and an iPad simulator;
/// on iPad the split view keeps sidebar, list and detail on screen, on iPhone they become a stack.
final class SparkleWashUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUp() {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["-ui-testing"]
    }

    private var isPad: Bool { UIDevice.current.userInterfaceIdiom == .pad }

    private func startDemo() {
        app.launch()
        let demo = app.buttons["demo-button"]
        XCTAssertTrue(demo.waitForExistence(timeout: 10))
        demo.tap()
    }

    /// Opens a sidebar section; on iPhone walks back to the sidebar first.
    private func open(_ section: String) {
        let row = element("section-\(section)")
        var tries = 0
        while !row.isHittable && tries < 4 {
            let back = app.navigationBars.buttons.element(boundBy: 0)
            guard back.exists else { break }
            back.tap()
            tries += 1
        }
        XCTAssertTrue(row.waitForExistence(timeout: 5), "section \(section)")
        row.tap()
    }

    /// SwiftUI repeats an identifier on wrapper elements (toolbar items, row children), so take the first match.
    private func element(_ id: String) -> XCUIElement { app.descendants(matching: .any).matching(identifier: id).firstMatch }

    func testDemoStartsInSpanishWithTheSplitView() {
        startDemo()
        XCTAssertTrue(element("section-review").waitForExistence(timeout: 10) || app.navigationBars.buttons.firstMatch.waitForExistence(timeout: 2))
        open("review")
        XCTAssertTrue(app.navigationBars["Revisión de llegadas"].waitForExistence(timeout: 5))
        if isPad {
            // Sidebar, list and detail side by side.
            XCTAssertTrue(element("section-board").isHittable)
            XCTAssertTrue(app.staticTexts["Elige una llegada de la lista"].exists)
        }
    }

    func testConfirmingAnArrivalOpensAJob() {
        startDemo()
        open("review")
        let arrival = element("arrival-P482913")
        XCTAssertTrue(arrival.waitForExistence(timeout: 10))
        arrival.tap()
        let confirm = element("confirm-button")
        XCTAssertTrue(reveal(confirm), "confirm button")
        confirm.tap()
        XCTAssertTrue(arrival.waitForNonExistence(timeout: 5))

        open("board")
        XCTAssertTrue(element("job-P482913").waitForExistence(timeout: 5))
    }

    func testChangesMadeOfflineSyncWhenBackOnline() {
        startDemo()
        setOffline(true)
        open("review")
        let arrival = element("arrival-P482913")
        XCTAssertTrue(arrival.waitForExistence(timeout: 10))
        arrival.tap()
        let confirm = element("confirm-button")
        XCTAssertTrue(reveal(confirm), "confirm button")
        confirm.tap()

        open("board")
        XCTAssertTrue(element("sync-banner").waitForExistence(timeout: 5))
        let job = element("job-P482913")
        XCTAssertTrue(job.waitForExistence(timeout: 5))
        job.tap()
        XCTAssertTrue(element("provisional-note").waitForExistence(timeout: 5))
        XCTAssertFalse(element("advance-button").exists)

        setOffline(false)
        XCTAssertTrue(element("sync-banner").waitForNonExistence(timeout: 10))
        open("board")
        XCTAssertTrue(element("job-P482913").waitForExistence(timeout: 5))
    }

    func testLinkingACameraShowsTheKeyOnce() {
        startDemo()
        open("admin")
        let link = element("link-camera-button")
        XCTAssertTrue(reveal(link), "link camera button")
        link.tap()

        let name = element("camera-name")
        XCTAssertTrue(name.waitForExistence(timeout: 5))
        name.tap()
        name.typeText("Bahía 3")
        let id = element("camera-id")
        id.tap()
        id.press(forDuration: 1.0)
        if app.menuItems["Select All"].waitForExistence(timeout: 1) { app.menuItems["Select All"].tap() }
        else if app.menuItems["Seleccionar todo"].exists { app.menuItems["Seleccionar todo"].tap() }
        id.typeText(XCUIKeyboardKey.delete.rawValue)
        id.typeText("bay3-cam")
        element("create-key-button").tap()

        let key = element("device-key")
        XCTAssertTrue(key.waitForExistence(timeout: 5))
        XCTAssertTrue(key.label.hasPrefix("swd.") || (key.value as? String)?.hasPrefix("swd.") == true)
        element("key-done-button").tap()
        XCTAssertTrue(key.waitForNonExistence(timeout: 5))
        open("admin")
        XCTAssertTrue(element("device-bay3-cam").waitForExistence(timeout: 5))
    }

    func testRegisteringADemoCarwashStartsTheChecklist() {
        app.launch()
        let register = element("register-button")
        XCTAssertTrue(register.waitForExistence(timeout: 10))
        register.tap()
        let name = element("carwash-name")
        XCTAssertTrue(name.waitForExistence(timeout: 5))
        name.tap()
        name.typeText("Autolavado Brillante")
        let submit = element("register-demo-button")
        XCTAssertTrue(reveal(submit), "register button")
        submit.tap()
        XCTAssertTrue(element("onboarding").waitForExistence(timeout: 10))
    }

    func testSwitchingToEnglish() {
        startDemo()
        openSettings()
        let picker = element("language-picker")
        XCTAssertTrue(picker.waitForExistence(timeout: 5))
        picker.buttons["English"].tap()
        element("settings-close").tap()
        open("review")
        XCTAssertTrue(app.navigationBars["Arrival review"].waitForExistence(timeout: 5))
    }

    // MARK: - Helpers

    private func openSettings() {
        let settings = element("settings-button")
        var tries = 0
        while !settings.isHittable && tries < 4 {
            let back = app.navigationBars.buttons.element(boundBy: 0)
            guard back.exists else { break }
            back.tap()
            tries += 1
        }
        XCTAssertTrue(settings.waitForExistence(timeout: 5))
        settings.tap()
    }

    /// Lists are lazy: rows below the fold don't exist until scrolled to. Swipes up until the element is hittable.
    @discardableResult
    private func reveal(_ element: XCUIElement, swipes: Int = 6) -> Bool {
        if element.waitForExistence(timeout: 3) && element.isHittable { return true }
        for _ in 0..<swipes {
            app.swipeUp()
            if element.exists && element.isHittable { return true }
        }
        return element.exists && element.isHittable
    }

    private func setOffline(_ offline: Bool) {
        openSettings()
        let toggle = app.switches.matching(identifier: "offline-toggle").firstMatch
        XCTAssertTrue(reveal(toggle), "offline toggle")
        let wanted = offline ? "1" : "0"
        if toggle.value as? String != wanted {
            // In a Form only the switch control reacts; iOS 17+ exposes it as a nested switch.
            let control = toggle.switches.firstMatch
            if control.exists { control.tap() } else { toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap() }
        }
        XCTAssertEqual(toggle.value as? String, wanted, "offline toggle should be \(wanted)")
        element("settings-close").tap()
        XCTAssertTrue(element("settings-close").waitForNonExistence(timeout: 5))
    }
}
