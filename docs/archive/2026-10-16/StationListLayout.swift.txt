import SwiftUI

/// `StationList` arranges a horizontal collection of cards, pinning them to the left edge.
/// On iPad (≥1536px), it's used inside the left pane of a SplitView.
/// The cards are 240px wide with 4px gutter spacing per item.
/// The container scrolls horizontally but only reveals the first N visible cards at once.
struct StationList: View {
    let stations: [Station]
    
    private let cardWidth: CGFloat = 240
    private let cardSpacing: CGFloat = 4
    
    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            VStack(spacing: 0) {
                ForEach(0..<max(1, stations.count)) { index in
                    guard index < stations.count else { return }
                    StationCard(station: stations[index])
                        .id(stations[index].id)
                        .offset(x: CGFloat(index) * (cardWidth + cardSpacing/2))
                }
            }
        }
    }
}

struct StationEventLog: View {
    @State private var logItems: [String] = ["Station #b4c3e5 loaded from cache."
                                              "Last WebSocket event at 18:44:01 UTC."
                                              "Press Refresh to pull latest station metrics."]
    private let maxEntries = 7

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("Activity Log").font(.system(size: 12, weight: .medium))
                .foregroundStyle(.secondary).padding(.bottom)

            LazyVStack(spacing: 2) {
                ForEach(0..<logItems.count) { index in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(logItems[index])
                            .font(.system(size: 13).monospaced())
                            .padding(.horizontal, 8)
                            .padding(.vertical, 6)
                        HStack {
                            if logItems[index].contains("WebSocket") {
                                Image(systemName: "waveform.fill").foregroundStyle(.accentGreenSystem)
                                    .frame(width: 14, height: 14)
                            }
                            if logItems[index].contains("cache") {
                                Image(systemName: "star.circle.fill").foregroundStyle(.yellow.systemMaterial)
                                    .frame(width: 12, height: 12)
                            }
                        }
                    }
                    .padding(8)
                    .background(Color(NSColor.controlBackgroundColor))
                    .cornerRadius(6)
                    .overlay(RoundedRectangle(cornerRadius: 5).stroke(.secondary.opacity(0.3), lineWidth: 1))

                }
            }

            Divider()
        }
        .frame(width: UIScreen.main.bounds.width - 44, alignment: .leading)
    }
}
