import SparkleKit
import SwiftUI
import UIKit

struct ReviewListView: View {
    @Binding var selection: String?
    @Environment(AppModel.self) private var model
    @Environment(Localizer.self) private var t

    var body: some View {
        let _ = model.engine?.revision
        let pending = model.engine?.store.pendingArrivals() ?? []
        List(selection: $selection) {
            SyncBanner().listRowSeparator(.hidden)
            if pending.isEmpty {
                ContentUnavailableView(t("review.caughtUp"), systemImage: "car", description: Text(t("review.caughtUpBody")))
            }
            ForEach(pending) { arrival in
                HStack(spacing: 12) {
                    ArrivalThumbnail(arrival: arrival)
                    VStack(alignment: .leading, spacing: 4) {
                        PlateChip(plate: arrival.plateCandidate)
                        Text("\(t.camera(arrival.cameraId)) · \(t.ago(arrival.receivedAt))").font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    if arrival.confirmedAt != nil { Pill(text: t("floor.confirmed"), symbol: "checkmark", tint: .green) }
                    else if Plate.confidence(arrival.confidence) != .high { Pill(text: t("review.check"), symbol: "exclamationmark.triangle", tint: .orange) }
                }
                .tag(arrival.id)
                .accessibilityIdentifier("arrival-\(arrival.plateCandidate ?? arrival.id)")
            }
        }
        .navigationTitle(t("review.title"))
        .refreshable { await model.engine?.sync() }
    }
}

struct ArrivalThumbnail: View {
    let arrival: ArrivalObservation
    @Environment(AppModel.self) private var model
    @State private var image: UIImage?

    var body: some View {
        Group {
            if let image { Image(uiImage: image).resizable().scaledToFill() } else { Color.secondary.opacity(0.15) }
        }
        .frame(width: 56, height: 40)
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .task(id: arrival.id) {
            if let data = await model.engine?.photo(for: arrival) { image = UIImage(data: data) }
        }
        .accessibilityHidden(true)
    }
}

/// Confirm the plate against the photo, pick vehicle class and package, open the job. Works offline:
/// the job appears immediately and the change syncs when the connection returns.
struct ReviewDetailView: View {
    let arrivalId: String
    var onDone: () -> Void
    @Environment(AppModel.self) private var model
    @Environment(Localizer.self) private var t
    @State private var plate = ""
    @State private var vehicleClass = "car"
    @State private var packageId = "essential"
    @State private var error: String?
    @State private var image: UIImage?
    @State private var loadedFor: String?
    @State private var dismissing = false

    var body: some View {
        let _ = model.engine?.revision
        if let arrival = model.engine?.store.arrivals().first(where: { $0.id == arrivalId }), arrival.isPending {
            form(arrival)
        } else {
            DetailPlaceholder(symbol: "checkmark.circle", text: t("review.caughtUp"))
        }
    }

    private var catalog: Catalog { model.engine?.store.document(Catalog.self, "catalog") ?? DemoBackend.defaultCatalog }
    private var canOperate: Bool { model.session?.canOperate == true }

    @ViewBuilder private func form(_ arrival: ArrivalObservation) -> some View {
        let confirmed = arrival.confirmedAt != nil
        let locked = confirmed || !canOperate
        let normalized = Plate.normalize(plate)
        let price = catalog.price(package: packageId, vehicleClass: vehicleClass) ?? 0
        Form {
            SwiftUI.Section {
                ZStack(alignment: .bottomLeading) {
                    Group {
                        if let image { Image(uiImage: image).resizable().scaledToFit() } else { Color.black.opacity(0.85) }
                    }
                    .frame(maxWidth: .infinity, minHeight: 200, maxHeight: 320)
                    HStack {
                        Label(t.camera(arrival.cameraId), systemImage: "camera")
                        Spacer()
                        Text(t.clock(arrival.capturedAt)).monospacedDigit()
                    }
                    .font(.caption.weight(.semibold)).foregroundStyle(.white)
                    .padding(8).background(Material.ultraThinMaterial.opacity(0.8)).padding(8)
                }
                .listRowInsets(EdgeInsets())
                .accessibilityElement(children: .combine)
                .accessibilityLabel(t("review.photoAlt", ["plate": arrival.plateCandidate ?? t("plate.unread")]))
            }
            if confirmed {
                SwiftUI.Section { Label(t("review.confirmedNoJob"), systemImage: "checkmark.circle").foregroundStyle(.green) }
            }
            if !canOperate {
                SwiftUI.Section { Label(t("shell.readOnly"), systemImage: "eye") }
            }
            SwiftUI.Section(t("review.plate")) {
                TextField("P123456", text: $plate)
                    .font(.system(.title2, design: .monospaced).weight(.bold))
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .disabled(locked)
                    .onChange(of: plate) { _, value in if value != value.uppercased() { plate = value.uppercased() } }
                    .accessibilityIdentifier("plate-field")
                ConfidenceBar(value: arrival.confidence)
                if !confirmed {
                    Text(Plate.confidence(arrival.confidence) == .high ? t("review.helpHigh") : t("review.helpLow")).font(.footnote).foregroundStyle(.secondary)
                }
            }
            SwiftUI.Section(t("review.vehicleClass")) {
                Picker(t("review.vehicleClass"), selection: $vehicleClass) {
                    ForEach(catalog.vehicleClasses) { option in Text(option.localizedName(t.language)).tag(option.id) }
                }
                .pickerStyle(.segmented)
                .disabled(locked)
                .accessibilityIdentifier("vehicle-class")
            }
            SwiftUI.Section(t("review.package")) {
                ForEach(catalog.packages) { option in
                    Button {
                        packageId = option.id
                    } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(option.name).font(.headline)
                                Text(option.localizedSubtitle(t.language)).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text(t.money(option.prices[vehicleClass] ?? 0, currency: catalog.currency)).font(.headline.monospacedDigit())
                            Image(systemName: packageId == option.id ? "checkmark.circle.fill" : "circle").foregroundStyle(packageId == option.id ? Color.brand : .secondary)
                        }
                    }
                    .buttonStyle(.plain)
                    .disabled(!canOperate)
                    .accessibilityAddTraits(packageId == option.id ? .isSelected : [])
                    .accessibilityIdentifier("package-\(option.id)")
                }
                if let chosen = catalog.packages.first(where: { $0.id == packageId }) {
                    Text("\(t("review.includes")): \(chosen.localizedItems(t.language).joined(separator: " · "))").font(.footnote).foregroundStyle(.secondary)
                }
            }
            if let error { SwiftUI.Section { Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.red) } }
            if canOperate {
                SwiftUI.Section {
                    Button {
                        guard let normalized else { error = t("review.invalidPlate"); return }
                        error = nil
                        let operation = OutboxOperation.confirmAndOpen(arrivalId: arrival.id, plate: normalized, vehicleClass: vehicleClass,
                                                                       packageId: packageId, alreadyConfirmed: confirmed)
                        Task {
                            await model.engine?.perform(operation)
                            onDone()
                        }
                    } label: {
                        Text(confirmed ? t("review.openJob", ["price": t.money(price)])
                             : normalized.map { t("review.submit", ["plate": $0, "price": t.money(price)]) } ?? t("review.submitNoPlate"))
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent).tint(.brand).controlSize(.large)
                    .accessibilityIdentifier("confirm-button")

                    Button(role: .destructive) { dismissing = true } label: {
                        Label(t("review.dismiss"), systemImage: "trash").frame(maxWidth: .infinity)
                    }
                    .accessibilityIdentifier("dismiss-button")
                    .confirmationDialog(t("review.dismissTitle"), isPresented: $dismissing, titleVisibility: .visible) {
                        ForEach(DismissReason.allCases, id: \.self) { reason in
                            Button(t("dismiss.\(reason.rawValue)")) {
                                Task {
                                    await model.engine?.perform(.dismiss(arrivalId: arrival.id, reason: reason))
                                    onDone()
                                }
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle(arrival.plateCandidate ?? t("plate.unread"))
        .task(id: arrival.id) {
            guard loadedFor != arrival.id else { return }
            loadedFor = arrival.id
            plate = arrival.confirmedPlate ?? arrival.plateCandidate ?? ""
            vehicleClass = arrival.vehicleClass ?? catalog.vehicleClasses.first?.id ?? "car"
            packageId = "essential"
            error = nil
            image = nil
            if let data = await model.engine?.photo(for: arrival) { image = UIImage(data: data) }
        }
    }
}
