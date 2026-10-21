import SparkleKit
import SwiftUI

extension Color {
    static let brand = Color(red: 0.06, green: 0.46, blue: 0.43)        // teal, as on the landing page
    static let brandSky = Color(red: 0.22, green: 0.74, blue: 0.97)
    static let coral = Color(red: 0.98, green: 0.45, blue: 0.38)
}

/// A licence plate drawn as a plate, in a monospaced face so 0/O and 8/B are easy to compare.
struct PlateChip: View {
    let plate: String?
    var large = false
    @Environment(Localizer.self) private var t

    var body: some View {
        HStack(spacing: 6) {
            RoundedRectangle(cornerRadius: 2).fill(Color.blue).frame(width: large ? 6 : 4)
            Text(plate ?? t("plate.unread"))
                .font(.system(large ? .title2 : .subheadline, design: .monospaced).weight(.bold))
                .tracking(1.2)
                .foregroundStyle(Color.black)
        }
        .padding(.vertical, large ? 6 : 3)
        .padding(.leading, 6)
        .padding(.trailing, large ? 12 : 9)
        .background(RoundedRectangle(cornerRadius: 6).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Color.gray.opacity(0.5), lineWidth: 1.5))
        .fixedSize()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(t("plate.aria", ["plate": plate ?? t("plate.unread")]))
    }
}

extension JobStatus {
    var tint: Color {
        switch self {
        case .arrived: .brandSky
        case .queued: .purple
        case .inProgress: .orange
        case .completed: .green
        case .cancelled: .gray
        }
    }

    var symbol: String {
        switch self {
        case .arrived: "parkingsign.circle"
        case .queued: "clock"
        case .inProgress: "drop"
        case .completed: "checkmark.circle"
        case .cancelled: "xmark.circle"
        }
    }
}

/// Status is always icon + text, never color alone.
struct StatusBadge: View {
    let status: JobStatus
    @Environment(Localizer.self) private var t

    var body: some View {
        Label(t.status(status), systemImage: status.symbol)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .foregroundStyle(status.tint)
            .background(Capsule().fill(status.tint.opacity(0.15)))
    }
}

struct Pill: View {
    let text: String
    var symbol: String?
    var tint: Color = .secondary

    var body: some View {
        HStack(spacing: 4) {
            if let symbol { Image(systemName: symbol) }
            Text(text)
        }
        .font(.caption.weight(.semibold))
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .foregroundStyle(tint)
        .background(Capsule().fill(tint.opacity(0.15)))
    }
}

struct ConfidenceBar: View {
    let value: Double?
    @Environment(Localizer.self) private var t

    private var level: Plate.Confidence { Plate.confidence(value) }
    private var tint: Color { level == .high ? .green : level == .medium ? .orange : .red }
    private var label: String { t(level == .high ? "confidence.high" : level == .medium ? "confidence.medium" : "confidence.low") }

    var body: some View {
        HStack(spacing: 10) {
            ProgressView(value: value ?? 0).tint(tint)
            Text("\(Int(((value ?? 0) * 100).rounded()))% · \(label)")
                .font(.caption.monospacedDigit().weight(.bold))
                .foregroundStyle(tint)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(t("confidence.label"))
        .accessibilityValue("\(Int(((value ?? 0) * 100).rounded()))%")
    }
}

struct SignalBars: View {
    let bars: Int
    var body: some View {
        HStack(alignment: .bottom, spacing: 2) {
            ForEach(1...4, id: \.self) { index in
                RoundedRectangle(cornerRadius: 1)
                    .fill(index <= bars ? Color.green : Color.secondary.opacity(0.3))
                    .frame(width: 3, height: CGFloat(3 + index * 3))
            }
        }
        .accessibilityHidden(true)
    }
}

/// Banner with the sync state: offline with N changes waiting, or rejected offline changes.
struct SyncBanner: View {
    @Environment(AppModel.self) private var model
    @Environment(Localizer.self) private var t

    var body: some View {
        if let engine = model.engine {
            VStack(spacing: 6) {
                if !engine.isOnline || engine.pendingCount > 0 {
                    HStack {
                        Image(systemName: engine.isOnline ? "arrow.triangle.2.circlepath" : "wifi.slash")
                        Text(engine.isOnline ? t("ios.pendingSync", ["count": engine.pendingCount]) : t("ios.offlineBanner", ["count": engine.pendingCount]))
                        Spacer()
                        Button(t("ios.syncNow")) { Task { await engine.sync() } }.buttonStyle(.bordered).controlSize(.small)
                    }
                    .font(.footnote.weight(.semibold))
                    .padding(10)
                    .background(RoundedRectangle(cornerRadius: 10).fill(Color.orange.opacity(0.15)))
                    .accessibilityIdentifier("sync-banner")
                }
                ForEach(Array(engine.rejections.enumerated()), id: \.offset) { index, message in
                    HStack {
                        Image(systemName: "exclamationmark.triangle")
                        Text(t("ios.rejected", ["reason": message]))
                        Spacer()
                        Button { engine.rejections.remove(at: index) } label: { Image(systemName: "xmark") }
                            .accessibilityLabel(t("common.close"))
                    }
                    .font(.footnote)
                    .padding(10)
                    .background(RoundedRectangle(cornerRadius: 10).fill(Color.red.opacity(0.12)))
                }
            }
        }
    }
}

/// A plain "select something" placeholder for the detail column.
struct DetailPlaceholder: View {
    let symbol: String
    let text: String
    var body: some View {
        ContentUnavailableView(text, systemImage: symbol)
    }
}
