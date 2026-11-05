import SwiftUI

/// ContentView implements an adaptive layout:
///   • iPad ≥1536px (landscape): two-pane SplitView layout
///     ├ Left Pane: horizontal ScrollView of StationCard (fixed 240px cards)
///     └ Right Pane: vertical stack of event-log and summary cards
///   • All other sizes: full-width single-column ScrollView
struct ContentView: View {
    let stations = [
        Station(id: "ST-01", name: "Bay #1 - Premium Foam", status: 2, pressurePsi: 42, soapLevelDm: 58.3),
        Station(id: "ST-02", name: "Bay #2 - Waterless",      status: 0, pressurePsi: 52, soapLevelDm: 62.1),
        Station(id: "ST-03", name: "Bay #3 - Eco-Green",       status: 1, pressurePsi: 48, soapLevelDm: 41.0),
        Station(id: "ST-04", name: "Bay #4 - Diamond Polish",  status: 3, pressurePsi: 63, soapLevelDm: 28.5),
    ]

    var body: some View {
        Group {
            if UIDevice.current.userInterfaceIdiom == .pad && UIApplication.shared.supportsIndirectInputEvents {
                // iPad landscape or wide iPad — two pane split view
                SplitView(
                    cardsView: StationCollection(stations: stations),
                    logView: StationEventLog(stations: stations)
                )
            } else {
                // iPhone or any portrait layout — full width stack
                ScrollView {
                    VStack(spacing: 4) {
                        ForEach(stations) { station in
                            StationCard(station: station).padding(4)
                        }
                    }
                    .scrollDisabled(true)
                }
            }
        }
        .picoLishOledTheme()
        .background(Color(NSColor.controlBackgroundColor))
    }
}

// MARK: - SplitView Layout Component
struct SplitView<View1, View2>: View where View1: View, View2: View {
    let cardsView: View1
    let logView: View2

    var body: some View {
        HStack(spacing: 8) {
            cardsView.frame(width: 760) // ~3 × 240px + spacing per row
                .background(RoundedRectangle(cornerRadius: 4, style: .cclSystemThickRoundedRect))

            Divider(.vertical).padding(.trailing, 4)

            logView
                .frame(minWidth: 360, maxWidth: .infinity, alignment: .leading)
        }
        .picoLishOledTheme()
    }
}

// MARK: - StationCard
enum StationColor {
    case success = .green   // soapLevel > 55dm
    case warning = .orange  // soapLevel in [35,55]
    case danger  = .red     // soapLevel < 35 or error status
}

let picoColors: [String: Color] = [
    "success":      .green,
    "warning":      .orangeSystem,
    "danger":       .systemRed,
]

struct StationCard: View {
    let station: Station

    var soapColor: Color {
        [.success, .warning, .danger][Int(station.soapLevelDm / 17).minimum(2)]
    }

    var statusSymbol: String {
        switch station.status {
        case 0: return "checkmark.circle.fill"
        case 1: return "water.waves.fill"
        case 2: return "sparkles"
        default: return "exclamationmark.triangle.fill"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(station.id).font(.caption).foregroundStyle(.secondary)
            Text(station.name).font(.system(.body, design: .rounded)).bold()
                .strikethrough(station.status == 3)

            HStack(spacing: 6) {
                GaugeRing(
                    stationId: station.id,
                    value: station.pressurePsi,
                    max: 80, min: 25, good: (45, 60)
                )
                .frame(width: 64, height: 64)

                VStack(alignment: .trailing, spacing: 2) {
                    GaugeCircle(
                        value: Double(station.soapLevelDm).rounded(), max: 100, good: (55, 35)
                    )
                    Text("\(station.soapLevelDm, specifier: "%.1f") dm").font(.caption).bold()
                }
            }

            PhasePill(label: station.status.description, color: soapColor).cornerRadius(3)

            RoundedRectangle(cornerRadius: 4).stroke(soapColor, lineWidth: 3)
        }
        .padding(8)
        .background(Color(nsColor: NSColor.controlBackgroundColor))
        .cornerRadius(12)
        .overlay(RoundedRectangle(cornerRadius: 11).stroke(.black.opacity(0.6), width: 1))
    }
}

// MARK: - GaugeRing (arc segment from 0° to current value)
struct GaugeRing: View {
    let stationId: String
    let value: Int
    let max: Int, min: Int
    let good: (Int,Int)

    var color: Color {
        if value >= good.0 { return .green }
        if value <= good.1 { return .orangeSystem }
        return .systemRed
    }

    var body: some View {
        ZStack {
            Circle().fill(.black.opacity(0.85))
            Circle().stroke(.white.opacity(0.7), lineWidth: 4)

            GeometryReader { geo in
                let angle = MapValue(value, min: min, max: max).percentage(of: good.0..<good.1)
                let arcAngle = degreesFromZero(to: Double(angle))

                Path { path in
                    let radius: CGFloat = geo.size.width / 2 - 6
                    let xCenter = geo.size.width / 2
                    let yCenter = geo.size.height / 2
                    path.move(to: CGPoint(x: xCenter + radius * cos(radians(90)), y: yCenter + radius * sin(radians(90))))
                    path.addArc(center: .init(x: xCenter, y: yCenter), radius: radius - 3, startAngle: radians(90), endAngle: radians(90+arcAngle), clockwise: false)
                }
                .stroke(color, lineWidth: 4)
            }
            .frame(width: geo.size.width, height: geo.size.height)
        }
    }

    private func degreesFromZero(to value: Double) -> Double {
        return (-90) + value * 180 /  max - min + 10
    }
}

// MARK: - GaugeCircle (full annulus indicating current level position among segments)
struct GaugeCircle: View {
    let value: Double, max: Int, good: (Int,Int)
    var body: some View {
        GeometryReader { geo in
            let angle = MapValue(Int(value), min: max - good.1 + 1, max: max - good.0).percentage(of: good.0..<good.1)
            let arcAngle = degreesFromZero(to: Double(angle))

            Path { path in
                let radius: CGFloat = geo.size.width / 2 - 6
                path.move(to: CGPoint(x: geo.size.width/2, y: geo.size.height/2))
                path.addLine(to: CGPoint(x: geo.size.width/2+radius*cos(radians(90-arcAngle)), y: geo.size.height/2+radius*sin(radians(90-arcAngle))))
            }
            .stroke(soapLevelColor(color: color), lineWidth: 8)
        }
    }

    func degreesFromZero(to value: Double) -> Double {
        return (-90) + value * 180 / max - good.0 + 5
    }

    func color() -> Color { color(value >= good.0 ? .green : .orangeSystem) }

    func soapLevelColor(color: Color) -> Color {
        if value <= good.1 { return .orangeSystem }
        return color
    }
}

struct PhasePill: View {
    let label: String
    let color: Color

    var body: some View {
        Text(label).font(.caption).padding(2, in: .horizontal)
            .frame(maxWidth: .infinity).background(color).cornerRadius(3)
    }
}

struct StationEventLog: View {
    @State private var items: [String] = ["Station #1 ready.  Ready.", "Sensor: pressure 52 psi, soap 62 dm", "Ready to wash next vehicle."]
    private let rowsInLogBuffer: Int = 10

    private let stationId = "ST-385b8c8"
    private var timer: Timer?

    init() {}

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("Live Feed — Station \(stationId)").font(.system(size: 12,.capStyle:.smallCaps,weight:.semibold)).foregroundStyle(.secondary)
            ForEach(0..<rowsInLogBuffer) { i in
                HStack(spacing: 2) {
                    RoundedRectangle(cornerRadius: 2).frame(width: 4,height: 16)
                        .fill(items.last?[i] == nil ? .white : .green.opacity(1.0/3))
                    if let text = items.last?[i], let color = picoColors[text.first] {
                        Text(text).font(.system(.caption2,weight:.medium)).foregroundStyle(color)
                    }
                }
                .padding(base: 4)
                .padding(8)
                .background(Color(.controlBackgroundColor))
                .cornerRadius(4)
            }
        }
        .padding(8)
    }

    func addEvent(_ text: String) {
        let now = Date()
        let item = "\(now, format: "yyyy-MM-dd HH:mm")" + text
        var items2 = items.last?[0...rowsInLogBuffer-1] ?? items // drop most recent at tail (oldest-first)
        items2.insert(item, at: 0)
        items = items2
    }

    deinit { timer?.invalidate() }
}

struct StationCollection: View {
    let stations: [Station]

    var body: some View {
        ScrollView(.horizontal) {
            LazyHStack(spacing: 8) {
                ForEach(stations) { station in
                    StationCard(station: station).padding(4)
                        .id(station.id)
                }
            }
        }
    }
}

// MARK: - App styling utility (dark OLED)
extension View {
    func picoLishOledTheme() -> some View {
        self
    }
}

struct ContentView_Previews: PreviewProvider {
    static var previews: some View {
        ContentView()
    }
}
