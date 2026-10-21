import Foundation
import Observation
import SparkleKit

/// The app's language. Spanish by default regardless of the device language (like the web console);
/// switching to English applies instantly. Strings come from es/en Localizable.strings, generated from
/// the web console's dictionaries so both apps say the same thing.
@Observable
final class Localizer {
    static let languages = ["es", "en"]
    private static let storageKey = "sparklewash.language"
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private var bundles: [String: Bundle] = [:]

    var language: String {
        didSet { defaults.set(language, forKey: Self.storageKey) }
    }

    init(defaults: UserDefaults = .standard, bundle: Bundle = .main) {
        self.defaults = defaults
        let stored = defaults.string(forKey: Self.storageKey)
        language = Self.languages.contains(stored ?? "") ? stored! : "es"
        for code in Self.languages {
            if let path = bundle.path(forResource: code, ofType: "lproj"), let localized = Bundle(path: path) { bundles[code] = localized }
        }
    }

    /// `t("review.waiting", ["count": 3])`. Unknown keys fall back to Spanish, then to the key itself.
    func callAsFunction(_ key: String, _ vars: [String: Any] = [:]) -> String {
        let missing = "\u{0}"
        var template = bundles[language]?.localizedString(forKey: key, value: missing, table: nil) ?? missing
        if template == missing { template = bundles["es"]?.localizedString(forKey: key, value: missing, table: nil) ?? missing }
        if template == missing { template = key }
        return Self.format(template, vars)
    }

    var locale: Locale { Locale(identifier: language == "es" ? "es_SV" : "en_US") }
    var languageName: String { language == "es" ? "Español" : "English" }

    /// `{name}` placeholders and `{count, plural, one {…} other {…}}` (Spanish and English share the one/other rule).
    static func format(_ template: String, _ vars: [String: Any]) -> String {
        var output = ""
        var index = template.startIndex
        while index < template.endIndex {
            let char = template[index]
            guard char == "{", let close = matchingBrace(in: template, from: index) else {
                output.append(char)
                index = template.index(after: index)
                continue
            }
            let inner = String(template[template.index(after: index)..<close])
            output += expand(inner, vars, original: String(template[index...close]))
            index = template.index(after: close)
        }
        return output
    }

    private static func expand(_ inner: String, _ vars: [String: Any], original: String) -> String {
        let parts = inner.split(separator: ",", maxSplits: 2, omittingEmptySubsequences: false).map { $0.trimmingCharacters(in: .whitespaces) }
        if parts.count == 3, parts[1] == "plural" {
            let count = (vars[parts[0]] as? Int) ?? Int("\(vars[parts[0]] ?? "")") ?? 0
            let branches = pluralBranches(parts[2])
            let chosen = count == 1 ? (branches["one"] ?? branches["other"] ?? "") : (branches["other"] ?? "")
            return format(chosen, vars)
        }
        guard parts.count == 1, let value = vars[inner] else { return original }
        return "\(value)"
    }

    /// Parses `one {…} other {…}` with nested braces inside the branches.
    private static func pluralBranches(_ text: String) -> [String: String] {
        var branches: [String: String] = [:]
        var index = text.startIndex
        while index < text.endIndex {
            guard let open = text[index...].firstIndex(of: "{"), let close = matchingBrace(in: text, from: open) else { break }
            let name = text[index..<open].trimmingCharacters(in: .whitespaces)
            branches[name] = String(text[text.index(after: open)..<close])
            index = text.index(after: close)
        }
        return branches
    }

    private static func matchingBrace(in text: String, from open: String.Index) -> String.Index? {
        var depth = 0
        var index = open
        while index < text.endIndex {
            if text[index] == "{" { depth += 1 }
            if text[index] == "}" { depth -= 1; if depth == 0 { return index } }
            index = text.index(after: index)
        }
        return nil
    }

    // MARK: - Formatting

    func money(_ amount: Decimal, currency: String = "USD") -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.currencyCode = currency
        formatter.locale = locale
        formatter.maximumFractionDigits = 0
        return formatter.string(from: amount as NSDecimalNumber) ?? "$\(amount)"
    }

    func clock(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeStyle = .short
        formatter.dateStyle = .none
        return formatter.string(from: date)
    }

    func ago(_ date: Date?, now: Date = Date()) -> String {
        guard let date else { return callAsFunction("time.never") }
        if now.timeIntervalSince(date) < 10 { return callAsFunction("time.justNow") }
        let formatter = RelativeDateTimeFormatter()
        formatter.locale = locale
        formatter.unitsStyle = .short
        return formatter.localizedString(for: date, relativeTo: now)
    }

    /// "entrance-cam" → "Entrada", "bay2_cam" → "Bahía 2", like the web console.
    func camera(_ cameraId: String) -> String {
        var base = cameraId.lowercased()
        for suffix in ["-camera", "_camera", "camera", "-cam", "_cam", "cam"] where base.hasSuffix(suffix) {
            base.removeLast(suffix.count)
            break
        }
        if ["entrance", "entry", "entrada"].contains(base) { return callAsFunction("camera.entrance") }
        if ["exit", "salida"].contains(base) { return callAsFunction("camera.exit") }
        for prefix in ["bay", "bahia"] where base.hasPrefix(prefix) {
            let number = base.dropFirst(prefix.count).trimmingCharacters(in: CharacterSet(charactersIn: "-_ "))
            if !number.isEmpty, number.allSatisfy(\.isNumber) { return callAsFunction("camera.bay", ["n": number]) }
        }
        return base.replacingOccurrences(of: "-", with: " ").replacingOccurrences(of: "_", with: " ").capitalized
    }

    func status(_ status: JobStatus) -> String { callAsFunction("status.\(status.rawValue)") }
    func role(_ role: Role) -> String { callAsFunction("role.\(role.rawValue)") }
    func cameraRole(_ role: CameraRole) -> String { callAsFunction("cameraRole.\(role.rawValue)") }

    func error(_ error: Error) -> String {
        switch error as? APIError {
        case .invalid: callAsFunction("error.invalid")
        case .unauthorized: callAsFunction("error.session")
        case .forbidden: callAsFunction("error.forbidden")
        case .notFound: callAsFunction("error.notFound")
        case .conflict: callAsFunction("error.conflict")
        case .unavailable: callAsFunction("signin.serverNotConfigured")
        case .offline: callAsFunction("error.network")
        default: callAsFunction("error.generic")
        }
    }
}
