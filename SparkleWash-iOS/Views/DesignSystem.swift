import SwiftUI

// SparkleWash design system.
// Direction: "Soft UI Evolution" (ui-ux-pro-max) on the SparkleWash brand shared with the landing page and
// desktop app: teal #0F766E primary, ink navy #13213A, sky #38BDF8 drop highlight, coral #F97362 warm accent.
// Calm teal-tinted canvas, white raised
// cards with a hairline border and a very soft shadow, SF type on Dynamic Type text styles (rounded design for
// plates and numbers), status always shown as icon + text + color. Every foreground/background pair below
// is chosen for WCAG AA (4.5:1) or better in both appearances.

enum SW {
    enum Space {
        static let xs: CGFloat = 4
        static let sm: CGFloat = 8
        static let md: CGFloat = 12
        static let lg: CGFloat = 16
        static let xl: CGFloat = 24
        static let xxl: CGFloat = 32
    }

    enum Radius {
        static let sm: CGFloat = 8
        static let md: CGFloat = 14
        static let lg: CGFloat = 20
    }

    static let minTouch: CGFloat = 44
    static let maxContentWidth: CGFloat = 1200
}

// MARK: - Color tokens

extension Color {
    /// A color that resolves differently in light and dark appearance.
    init(light: UInt32, dark: UInt32) {
        self.init(UIColor { traits in
            let hex = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
                           blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
        })
    }

    init(_ hex: UInt32) {
        self.init(red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255)
    }

    // Surfaces
    static let swBackground = Color(light: 0xF1F7F6, dark: 0x0C1626)
    static let swSurface = Color(light: 0xFFFFFF, dark: 0x13213A)
    static let swBorder = Color(light: 0xD5E3E1, dark: 0x2A3C5A)
    // Text
    static let swTextSecondary = Color(light: 0x4B5873, dark: 0xB4C1D6)
    // Brand
    static let swBrand = Color(light: 0x0F766E, dark: 0x5EEAD4)       // teal; 5.5:1 on white, 9:1 on dark surface
    static let swBrandFill = Color(light: 0x0F766E, dark: 0x5EEAD4)   // primary button fill
    static let swOnBrand = Color(light: 0xFFFFFF, dark: 0x0C1626)     // text on brand fill
    static let swInk = Color(light: 0x13213A, dark: 0xE8EEF7)         // headings
    static let swSky = Color(0x38BDF8)                                // drop highlight (decorative)
    static let swCoral = Color(0xF97362)                              // warm accent fill; text on it is swOnCoral
    static let swOnCoral = Color(0x2A0D07)
    // Semantic
    static let swSuccess = Color(light: 0x166534, dark: 0x86EFAC)
    static let swWarning = Color(light: 0x92400E, dark: 0xFCD34D)
    static let swAlert = Color(light: 0x9A3412, dark: 0xFDBA74)
    static let swDanger = Color(light: 0xB91C1C, dark: 0xFCA5A5)
    static let swNeutral = Color(light: 0x475569, dark: 0xB6C3D5)
    static let swInfo = Color(light: 0x075985, dark: 0x7DD3FC)
    static let swPOS = Color(light: 0x3730A3, dark: 0xA5B4FC)
}

// MARK: - Type scale (all Dynamic Type text styles)

extension Font {
    /// Plate numbers: the primary datum of every job, so it gets the heaviest face.
    static let swPlate = Font.system(.title2, design: .rounded, weight: .heavy)
    static let swMetric = Font.system(.largeTitle, design: .rounded, weight: .bold)
    static let swSection = Font.title3.weight(.semibold)
    static let swCardTitle = Font.headline
    static let swBody = Font.subheadline
    static let swMeta = Font.footnote
    static let swPill = Font.caption.weight(.semibold)
}

// MARK: - Formatting

enum SWFormat {
    /// "38 min", "1 h 05 min".
    static func duration(seconds: Int) -> String {
        let minutes = max(seconds, 0) / 60
        if minutes < 60 { return "\(minutes) min" }
        return "\(minutes / 60) h \(String(format: "%02d", minutes % 60)) min"
    }

    static func vehicleClassName(_ id: String) -> String {
        switch id {
        case "car": "Carro"
        case "suv": "Camioneta / SUV"
        case "xl": "XL"
        case "pickup": "XXL / Pickup"
        default: id.uppercased()
        }
    }
}

// MARK: - Job status

struct JobStatus: Equatable {
    let raw: String

    struct NextAction { let title: String; let status: String; let symbol: String }

    var label: String {
        switch raw {
        case "arrived": "Llegó"
        case "queued": "En cola"
        case "in_progress": "En proceso"
        case "completed": "Completado"
        case "cancelled": "Cancelado"
        default: raw.replacingOccurrences(of: "_", with: " ")
        }
    }

    var symbol: String {
        switch raw {
        case "arrived": "car.fill"
        case "queued": "clock.fill"
        case "in_progress": "sparkles"
        case "completed": "checkmark.circle.fill"
        case "cancelled": "xmark.circle.fill"
        default: "circle.fill"
        }
    }

    var tint: Color {
        switch raw {
        case "arrived": .swNeutral
        case "queued": .swWarning
        case "in_progress": .swInfo
        case "completed": .swSuccess
        default: .swNeutral
        }
    }

    var next: NextAction? {
        switch raw {
        case "arrived": NextAction(title: "Poner en cola", status: "queued", symbol: "clock.badge.checkmark")
        case "queued": NextAction(title: "Iniciar trabajo", status: "in_progress", symbol: "play.fill")
        case "in_progress": NextAction(title: "Completar trabajo", status: "completed", symbol: "checkmark")
        default: nil
        }
    }
}

// MARK: - Surfaces

struct SWCard: ViewModifier {
    var padding: CGFloat = SW.Space.lg
    var stripe: Color?

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(alignment: .leading) {
                if let stripe {
                    // A status-colored edge. Status is also always spelled out in text with an icon.
                    Rectangle().fill(stripe).frame(width: 5).accessibilityHidden(true)
                }
            }
            .background(Color.swSurface)
            .clipShape(RoundedRectangle(cornerRadius: SW.Radius.md, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: SW.Radius.md, style: .continuous).strokeBorder(Color.swBorder, lineWidth: 1))
            .shadow(color: .black.opacity(0.04), radius: 6, y: 2)
    }
}

extension View {
    func swCard(padding: CGFloat = SW.Space.lg, stripe: Color? = nil) -> some View {
        modifier(SWCard(padding: padding, stripe: stripe))
    }

    func swScreenBackground() -> some View {
        background(Color.swBackground.ignoresSafeArea())
    }
}

// MARK: - Brand

struct SWBrandMark: View {
    var size: CGFloat = 56

    var body: some View {
        ZStack {
            Circle().fill(LinearGradient(colors: [Color(0x14B8A6), Color(0x0F766E)],
                                         startPoint: .top, endPoint: .bottom))
            Image(systemName: "drop.fill")
                .font(.system(size: size * 0.48, weight: .semibold))
                .foregroundStyle(Color.swSky)
                .shadow(color: .black.opacity(0.25), radius: 1, y: 1)
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

// MARK: - Sections and tiles

struct SWSectionHeader: View {
    let title: String
    var symbol: String?
    var count: Int?

    var body: some View {
        HStack(spacing: SW.Space.sm) {
            if let symbol {
                Image(systemName: symbol).foregroundStyle(Color.swBrand).accessibilityHidden(true)
            }
            Text(title).font(.swSection)
            if let count {
                Text("\(count)")
                    .font(.swPill).monospacedDigit()
                    .padding(.horizontal, SW.Space.sm).padding(.vertical, 2)
                    .background(Color.swBrand.opacity(0.14), in: Capsule())
                    .foregroundStyle(Color.swBrand)
                    .accessibilityLabel("\(count) en total")
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, SW.Space.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

struct SWMetricTile: View {
    let label: String
    let value: String
    let symbol: String
    var tint: Color = .swBrand

    var body: some View {
        VStack(alignment: .leading, spacing: SW.Space.sm) {
            HStack(spacing: SW.Space.md) {
                Image(systemName: symbol)
                    .font(.headline).foregroundStyle(tint)
                    .frame(width: 36, height: 36)
                    .background(tint.opacity(0.14), in: Circle())
                    .accessibilityHidden(true)
                Text(value).font(.swMetric).monospacedDigit().minimumScaleFactor(0.6).lineLimit(1)
            }
            Text(label).font(.swBody).foregroundStyle(Color.swTextSecondary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .frame(minHeight: 76, alignment: .topLeading)
        .swCard()
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Pills and chips

struct SWChip: View {
    let text: String
    let symbol: String
    let tint: Color

    var body: some View {
        Label(text, systemImage: symbol)
            .font(.swPill)
            .foregroundStyle(tint)
            .padding(.horizontal, SW.Space.sm).padding(.vertical, 4)
            .background(tint.opacity(0.13), in: Capsule())
            .fixedSize(horizontal: false, vertical: true)
    }
}

struct StatusPill: View {
    let status: JobStatus

    var body: some View {
        SWChip(text: status.label, symbol: status.symbol, tint: status.tint)
            .accessibilityElement(children: .combine)
    }
}

/// A license-plate styled label. Plate text is the key datum, so it wraps rather than truncates.
struct SWPlate: View {
    let plate: String
    var font: Font = .swPlate

    var body: some View {
        Text(plate)
            .font(font)
            .tracking(0.5)
            .foregroundStyle(.primary)
            .fixedSize(horizontal: false, vertical: true)
    }
}

// MARK: - Banners, empty states

struct SWBanner: View {
    enum Kind { case info, success, warning, danger }
    let kind: Kind
    let text: String
    var symbol: String?

    private var tint: Color {
        switch kind {
        case .info: .swNeutral
        case .success: .swSuccess
        case .warning: .swWarning
        case .danger: .swDanger
        }
    }

    private var defaultSymbol: String {
        switch kind {
        case .info: "info.circle.fill"
        case .success: "checkmark.circle.fill"
        case .warning: "exclamationmark.triangle.fill"
        case .danger: "exclamationmark.octagon.fill"
        }
    }

    var body: some View {
        Label {
            Text(text).font(.swBody).foregroundStyle(.primary)
        } icon: {
            Image(systemName: symbol ?? defaultSymbol).foregroundStyle(tint)
        }
        .padding(SW.Space.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(tint.opacity(0.12), in: RoundedRectangle(cornerRadius: SW.Radius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

struct SWEmptyState: View {
    let symbol: String
    let title: String
    var message: String?

    var body: some View {
        VStack(spacing: SW.Space.sm) {
            Image(systemName: symbol).font(.title).foregroundStyle(Color.swBrand).accessibilityHidden(true)
            Text(title).font(.headline).multilineTextAlignment(.center)
            if let message {
                Text(message).font(.swBody).foregroundStyle(Color.swTextSecondary).multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(SW.Space.xl)
        .background(Color.swSurface.opacity(0.6), in: RoundedRectangle(cornerRadius: SW.Radius.md, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: SW.Radius.md, style: .continuous)
            .strokeBorder(Color.swBorder, style: StrokeStyle(lineWidth: 1, dash: [5, 4])))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Info rows

/// Label/value row that stacks vertically when text gets large instead of truncating.
struct SWInfoRow: View {
    let label: String
    let value: String

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .firstTextBaseline) {
                Text(label).foregroundStyle(Color.swTextSecondary)
                Spacer(minLength: SW.Space.md)
                Text(value).multilineTextAlignment(.trailing).fontWeight(.medium)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(label).foregroundStyle(Color.swTextSecondary)
                Text(value).fontWeight(.medium)
            }
        }
        .font(.swBody)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Buttons

struct SWButtonStyle: ButtonStyle {
    enum Kind { case primary, secondary }
    var kind: Kind = .primary
    var fullWidth = true

    func makeBody(configuration: Configuration) -> some View {
        SWButtonBody(configuration: configuration, kind: kind, fullWidth: fullWidth)
    }

    private struct SWButtonBody: View {
        let configuration: Configuration
        let kind: Kind
        let fullWidth: Bool
        @Environment(\.isEnabled) private var isEnabled
        @Environment(\.accessibilityReduceMotion) private var reduceMotion

        var body: some View {
            configuration.label
                .font(.headline)
                .multilineTextAlignment(.center)
                .foregroundStyle(kind == .primary ? Color.swOnBrand : Color.swBrand)
                .padding(.horizontal, SW.Space.lg).padding(.vertical, SW.Space.md)
                .frame(maxWidth: fullWidth ? .infinity : nil, minHeight: 48)
                .background {
                    if kind == .primary {
                        RoundedRectangle(cornerRadius: SW.Radius.md, style: .continuous).fill(Color.swBrandFill)
                    } else {
                        RoundedRectangle(cornerRadius: SW.Radius.md, style: .continuous)
                            .fill(Color.swBrand.opacity(0.10))
                            .overlay(RoundedRectangle(cornerRadius: SW.Radius.md, style: .continuous)
                                .strokeBorder(Color.swBrand.opacity(0.35), lineWidth: 1))
                    }
                }
                .opacity(isEnabled ? 1 : 0.45)
                .scaleEffect(configuration.isPressed && !reduceMotion ? 0.98 : 1)
                .animation(reduceMotion ? nil : .easeOut(duration: 0.12), value: configuration.isPressed)
                .contentShape(Rectangle())
        }
    }
}

extension ButtonStyle where Self == SWButtonStyle {
    static var swPrimary: SWButtonStyle { SWButtonStyle(kind: .primary) }
    static var swSecondary: SWButtonStyle { SWButtonStyle(kind: .secondary) }
}

// MARK: - Wrapping layout

/// Lays children out in rows and wraps to the next row when space runs out, so chips never truncate at large text sizes.
struct SWFlowLayout: Layout {
    var spacing: CGFloat = SW.Space.sm

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0, width: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(ProposedViewSize(width: maxWidth.isFinite ? maxWidth : nil, height: nil))
            if x > 0 && x + size.width > maxWidth { y += rowHeight + spacing; x = 0; rowHeight = 0 }
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
            width = max(width, x - spacing)
        }
        return CGSize(width: width, height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowHeight: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(ProposedViewSize(width: bounds.width, height: nil))
            if x > bounds.minX && x + size.width > bounds.maxX { y += rowHeight + spacing; x = bounds.minX; rowHeight = 0 }
            view.place(at: CGPoint(x: x, y: y), anchor: .topLeading, proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}
