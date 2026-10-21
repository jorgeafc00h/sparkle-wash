import Foundation

public enum Plate {
    /// Same rule as the API (ArrivalStore.NormalizePlate): uppercase ASCII letters and digits, 3–12 characters.
    public static func normalize(_ input: String) -> String? {
        let cleaned = String(input.uppercased().unicodeScalars.filter { ("A"..."Z").contains($0) || ("0"..."9").contains($0) }.map(Character.init))
        return (3...12).contains(cleaned.count) ? cleaned : nil
    }

    public enum Confidence: Sendable { case high, medium, low }

    public static func confidence(_ value: Double?) -> Confidence {
        guard let value else { return .low }
        if value >= 0.8 { return .high }
        if value >= 0.5 { return .medium }
        return .low
    }
}

public enum Durations {
    /// "42s", "2m 05s", "3h 07m" — same as the web console.
    public static func short(_ seconds: Int?) -> String {
        guard let seconds else { return "—" }
        let s = max(0, seconds)
        let h = s / 3600, m = (s % 3600) / 60
        if h > 0 { return "\(h)h \(String(format: "%02d", m))m" }
        if m > 0 { return "\(m)m \(String(format: "%02d", s % 60))s" }
        return "\(s)s"
    }
}

public enum IdempotencyKey {
    /// 8–128 characters of letters, digits, '-' and '_', as the API requires.
    public static func make(_ prefix: String) -> String {
        String("\(prefix)-\(UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased())".prefix(128))
    }
}
