import Foundation

/// JSON coding that matches the API. .NET writes dates like `2026-10-21T20:55:28.7290608+00:00`
/// (up to 7 fractional digits), which `ISO8601DateFormatter` rejects, so dates are parsed by hand.
public enum SparkleJSON {
    public static func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let text = try container.decode(String.self)
            guard let date = parseDate(text) else {
                throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unrecognized date: \(text)")
            }
            return date
        }
        return decoder
    }

    public static func encoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            try container.encode(formatDate(date))
        }
        return encoder
    }

    public static func formatDate(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    /// Accepts ISO 8601 with 0–9 fractional digits and `Z` or `±hh:mm` offsets.
    public static func parseDate(_ text: String) -> Date? {
        var main = text
        var fraction = 0.0
        if let dot = text.firstIndex(of: ".") {
            let afterDot = text.index(after: dot)
            let digitsEnd = text[afterDot...].firstIndex(where: { !$0.isNumber }) ?? text.endIndex
            let digits = text[afterDot..<digitsEnd]
            guard !digits.isEmpty else { return nil }
            fraction = Double("0." + digits) ?? 0
            main = String(text[..<dot]) + String(text[digitsEnd...])
        }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        guard let whole = formatter.date(from: main) else { return nil }
        return whole.addingTimeInterval(fraction)
    }
}
