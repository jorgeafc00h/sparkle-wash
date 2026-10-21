import SparkleKit
import XCTest
@testable import SparkleWash

final class LocalizerTests: XCTestCase {
    private func makeLocalizer() -> (Localizer, UserDefaults) {
        let name = "LocalizerTests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        defaults.removePersistentDomain(forName: name)
        return (Localizer(defaults: defaults, bundle: Bundle(for: AppModel.self)), defaults)
    }

    func testSpanishIsTheDefault() {
        let (t, _) = makeLocalizer()
        XCTAssertEqual(t.language, "es")
        XCTAssertEqual(t("nav.review"), "Revisión")
        XCTAssertEqual(t.status(.inProgress), "Lavando")
    }

    func testSwitchingLanguageIsInstantAndRemembered() {
        let (t, defaults) = makeLocalizer()
        t.language = "en"
        XCTAssertEqual(t("nav.review"), "Review")
        XCTAssertEqual(Localizer(defaults: defaults, bundle: Bundle(for: AppModel.self)).language, "en")
    }

    func testPlaceholdersAndPlurals() {
        XCTAssertEqual(Localizer.format("{count} en espera", ["count": 3]), "3 en espera")
        let template = "{count, plural, one {1 cambio} other {{count} cambios}} · {name}"
        XCTAssertEqual(Localizer.format(template, ["count": 1, "name": "Ana"]), "1 cambio · Ana")
        XCTAssertEqual(Localizer.format(template, ["count": 4, "name": "Ana"]), "4 cambios · Ana")
        XCTAssertEqual(Localizer.format("Hola {missing}", [:]), "Hola {missing}")
    }

    func testUnknownKeysFallBackToTheKey() {
        let (t, _) = makeLocalizer()
        XCTAssertEqual(t("does.not.exist"), "does.not.exist")
    }

    func testEveryIOSKeyIsTranslated() throws {
        let (t, _) = makeLocalizer()
        for key in ["ios.ble.title", "ios.local.title", "ios.offlineBanner", "ios.job.provisional"] {
            t.language = "es"
            let spanish = t(key, ["count": 2])
            t.language = "en"
            let english = t(key, ["count": 2])
            XCTAssertNotEqual(spanish, key)
            XCTAssertNotEqual(spanish, english, key)
        }
    }

    func testCameraNames() {
        let (t, _) = makeLocalizer()
        XCTAssertEqual(t.camera("entrance-cam"), t("camera.entrance"))
        XCTAssertEqual(t.camera("bay2_cam"), t("camera.bay", ["n": "2"]))
        XCTAssertEqual(t.camera("lot_north"), "Lot North")
    }

    func testMoneyUsesTheLanguage() {
        let (t, _) = makeLocalizer()
        XCTAssertTrue(t.money(25).contains("25"))
    }
}
