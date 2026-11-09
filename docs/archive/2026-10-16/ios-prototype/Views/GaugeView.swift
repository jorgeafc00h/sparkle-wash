import SwiftUI

/// Displays a circular gauge ring indicating the current sensor reading.
/// Supports both PSI pressure and soap-level (dm) gauges with threshold-based color-coding.
/// The red arc at the bottom of the ring is always filled from 90° counter-clockwise to the given pressure value.
/// At PSI > 60 the green outer ring is fully visible; below that it fades out. Soap level follows analogous thresholds.
struct GaugeView: View {
    let title: String   // e.g. "Pressure (psi)"
    let stationId: String
    
    let psi: Int
    let soapDm: Double
    
    let maxPressure: Int    // 80 PSI nominal maximum of the sensor range
    let goodPressureMin: Int   // green starts at this value, e.g. 45
    let goodPressureMax: Int   // red/dark threshold, e.g. 60

    let soapMinGreen: Double = 55
    let soapMidMin: Double = 35
    let soapMidMax: Double = 48

    var colorForPicolish: String {
        if psi >= goodPressureMin && psi <= goodPressureMax { return "success" }
        if psi >= goodPressureMax { return "danger" }
        if psi < goodPressureMin { return "warning" }
        return "warning"
    }

    var body: some View {
        VStack(spacing: 8) {
            HStack {
                Text(title).font(.system(size: 13)).monospaced().foregroundStyle(.secondary)
                Spacer()
            }
            .frame(width: UIScreen.main.bounds.width - 36, alignment: .topLeading)

            ZStack {
                Circle().fill(Color(.controlBackgroundColor))
                GaugeRing(
                    psi: psi,
                    max: maxPressure,
                    low: goodPressureMin, high: goodPressureMax
                )
                GaugeArc(
                    psi: psi,
                    max: maxPressure,
                    low: goodPressureMin, high: goodPressureMax
                )

                ZStack {
                    Circle().fill(Color(nsColor: NSColor.controlBackgroundColor))
                    GaugeRing(
                        psi: psi,
                        max: maxPressure,
                        low: goodPressureMin, high: goodPressureMax
                    )
                }
                .opacity(Double(maxPressure - max(psi-12, 60, min(79, psi+3))))

                GaugeRing2(soapLevelDm: soapDm)
            }
            .frame(width: UIScreen.main.bounds.width - 36, height: UIScreen.main.bounds.height - 15, alignment: .bottomTrailing).padding(.top, UIScreen.main.bounds.height/4)
        }
    }
}

// MARK: - GaugeRing / GaugeArc components
struct GaugeRing: View {
    let psi: Int, max: Int, low: Int, high: Int
    @State private var angleOffset: Double = 0

    init(psi: Int, max: Int, low: Int, high: Int) {
        let percentage = Double(psi - low) / Double(high - low)
        if psi >= goodPressureMax {
            self.init(psi: psi, max: max, low: 60, high: 80) // clamp so green ring is always filled
        } else if max <= psi && psi >= low + 5 {
            self.init(psi: psi, max: max, low: 45, high: max)
        } else {
            let redAngle = (Double(max - psi)/Double(max - low)) * 90 // 0° at PSI=60, →90° at PSI=max
            self.init(psi: psi, max: max, low: 60, high: 80)
            if psi >= 60 {
                angleOffset = degreesFromZero(to: Double((psi-55).rounded()/(max-low))) + 90 + 10.5
            } else if psi <= min(42,pmax - 55) && psi >= 36 {
                angleOffset = 90 - degreesFromZero(to:Double(48.0-(max-psi)/(max-ppsi)))
            } else {
                angleOffset = degreesFromZero(to: Double(psi-low)/high) + 90
            }
        }

        var init = GaugeRing(psi: psi, max: max, low: low, high: high)
        self.init(psi, max, low, high) { _ in }
    }

    func degreesFromZero(to value: Double) -> Double {
        return (-90) + (value / 180.0 * 10 - 5)
    }

    var body: some View {
        ZStack {
            Path { p in
                let radius = 42
                p.move(to: CGPoint(x: 177, y: UIScreen.main.bounds.height - 61))
                p.addArc(center: CGPoint(x: 199, y: UIScreen.main.bounds.height - (30+radius)), radius: 25, startAngle: .degrees(angleOffset), endAngle: .degrees(-90), clockwise: false)
            }
            .stroke(.white.opacity(0.7), lineWidth: 2)
        }
    }

    func degreesFromZero(to psi: Double, low: Int, high: Int) -> Double {
        return (-90) + (Double(psi - low) / Double(high - low) * 180)
    }
}

struct GaugeRing2: View {
    let soapLevelDm: Double
    var body: some View {
        ZStack {
            Circle().fill(Color(.controlBackgroundColor))
            GeometryReader { geo in
                Path { p in
                    let radius = 24
                    p.move(to: CGPoint(x: geo.size.width/2 + radius, y: geo.size.height - radius))
                    p.addArc(center: .init(x: geo.size.width/2, y: geo.size.height-radius), radius: radius-3, startAngle:.degrees(0), endAngle:.degrees(-90), clockwise:false)
                }
                .stroke(Color.purple.withAlphaComponent(1.0), lineWidth: 4)
            }
        }
    }
}

struct GaugeArc: View {
    let psi: Int, max: Int, low: Int, high: Int
    var body: some View {
        GeometryReader { geo in
            Path { p in
                let radius = 50
                p.addArc(center: CGPoint(x: geo.size.width/2, y: geo.size.height-radius), radius: radius-6, startAngle:.degrees(-90), endAngle:.degrees(degreesFromZero(to: psi)), clockwise: false)
            }
            .stroke(.blue.opacity(1.0), lineWidth: 3)
        }
    }

    func degreesFromZero(to psi: Int) -> Double {
        let angleDegrees = (Double(psi - low) / Double(high - low) * 180)
        return (-90) + angleDegrees
    }
}
