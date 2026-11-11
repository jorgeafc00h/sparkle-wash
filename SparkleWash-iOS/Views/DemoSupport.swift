import Foundation
import SwiftUI
import SwiftData

// Debug-only demo network layer for screenshots and UI review. It is compiled out of Release builds, so it
// can never act as a sign-in bypass in a shipped app. Launch with `-sparklewash-demo` (public catalog only)
// or `-sparklewash-demo-staff` (signed-in floor, board, arrivals and stock with canned data).
#if DEBUG
enum DemoSupport {
    static var catalogOnly: Bool { CommandLine.arguments.contains("-sparklewash-demo") }
    static var staff: Bool { CommandLine.arguments.contains("-sparklewash-demo-staff") }
    /// `-sparklewash-demo-open job|arrival|history` pushes that screen after the demo sign-in.
    static var openTarget: String? {
        guard let i = CommandLine.arguments.firstIndex(of: "-sparklewash-demo-open"),
              CommandLine.arguments.indices.contains(i + 1) else { return nil }
        return CommandLine.arguments[i + 1]
    }
    /// `-sparklewash-demo-scroll jobs|team|stock` shows the workboard starting at that section (hides the sections above it) for review screenshots.
    static var scrollTarget: String? {
        guard let i = CommandLine.arguments.firstIndex(of: "-sparklewash-demo-scroll"),
              CommandLine.arguments.indices.contains(i + 1) else { return nil }
        return CommandLine.arguments[i + 1]
    }
    static var enabled: Bool { catalogOnly || staff }

    private static func iso(minutesAgo: Int) -> String {
        ISO8601DateFormatter().string(from: Date().addingTimeInterval(TimeInterval(-minutesAgo * 60)))
    }

    private static let catalog = ServiceCatalogDTO(
        currency: "USD",
        vehicleClasses: [VehicleClassDTO(id: "car", name: "Carro"), VehicleClassDTO(id: "suv", name: "Camioneta / SUV"),
                         VehicleClassDTO(id: "xl", name: "XL"), VehicleClassDTO(id: "pickup", name: "XXL / Pickup")],
        packages: [
            ServicePackageDTO(id: "quick", name: "Quick Spa", subtitle: "Limpieza básica",
                items: ["Lavado exterior", "Llantas y neumáticos", "Ventanas", "Aspirado"],
                prices: ["car": 10, "suv": 12, "xl": 14, "pickup": 16]),
            ServicePackageDTO(id: "essential", name: "Essential Spa", subtitle: "Limpieza + acabado",
                items: ["Todo lo de Quick", "Espuma activa", "Bordes de puertas", "Pasteado a mano", "Limpieza de tablero y consolas", "Aromatizante"],
                prices: ["car": 15, "suv": 18, "xl": 21, "pickup": 24]),
            ServicePackageDTO(id: "renew", name: "Renew Spa", subtitle: "Limpieza + renovación",
                items: ["Todo lo de Essential", "Pasteado a máquina", "Prelavado sin contacto", "Tolvas", "Lavado de motor", "Aire en rendijas", "Hidratación interior"],
                prices: ["car": 25, "suv": 30, "xl": 35, "pickup": 40]),
            ServicePackageDTO(id: "supreme", name: "Supreme Spa", subtitle: "Cuidado + acabado premium",
                items: ["Todo lo de Renew", "Cera líquida", "Detallado de rines", "Limpieza de puntas de escape"],
                prices: ["car": 35, "suv": 40, "xl": 45, "pickup": 50]),
        ])

    private static func job(_ id: String, _ plate: String, _ klass: String, _ pkg: ServicePackageDTO, status: String,
                            minutes: Int, staff: [String] = [], ticket: String? = nil, customer: String? = nil,
                            note: String? = nil, paid: Decimal? = nil, paymentStatus: String? = nil) -> JobDTO {
        let price = Decimal(pkg.prices[klass] ?? 0)
        let payments: [JobPaymentDTO]? = paid.map { [JobPaymentDTO(id: "pay-\(id)", method: "cash", amountUsd: $0,
            ticketNumber: "V-0042", reference: nil, recordedAt: iso(minutesAgo: max(minutes - 5, 0)), actor: nil, idempotencyKey: nil)] }
        return JobDTO(id: id, arrivalId: "arr-\(id)", plate: plate, vehicleClass: klass, packageId: pkg.id,
            packageName: pkg.name, services: pkg.items, priceUsd: price, status: status, arrivalAt: iso(minutesAgo: minutes),
            completedAt: status == "completed" ? iso(minutesAgo: 3) : nil, elapsedSeconds: minutes * 60, activeSeconds: nil,
            assignments: staff.map { JobAssignmentDTO(employeeId: "e-\($0)", employeeName: $0) },
            source: ticket == nil ? nil : "desktop-pos", ticketNumber: ticket, customerName: customer, note: note,
            payments: payments ?? (paymentStatus == nil ? nil : []), paidUsd: paid, paymentStatus: paymentStatus, paidAt: nil)
    }

    private static func body(for path: String) -> Data? {
        let encoder = JSONEncoder()
        let p = catalog.packages
        switch path {
        case "/api/packages": return try? encoder.encode(catalog)
        case "/api/arrivals":
            return try? encoder.encode([
                ArrivalDTO(id: "arr-new1", cameraId: "entrada-1", plateCandidate: "P 482-913", confidence: 0.93,
                           receivedAt: iso(minutesAgo: 2), photoId: "ph1", confirmedPlate: nil, vehicleClass: nil),
                ArrivalDTO(id: "arr-new2", cameraId: "entrada-2", plateCandidate: nil, confidence: nil,
                           receivedAt: iso(minutesAgo: 6), photoId: "ph2", confirmedPlate: nil, vehicleClass: nil),
            ])
        case "/api/jobs":
            return try? encoder.encode([
                job("j1", "P 218-405", "suv", p[2], status: "in_progress", minutes: 38, staff: ["Marvin", "Kevin"],
                    ticket: "OT-C1-000012", customer: "Ana Martínez", note: "Rayón en puerta trasera", paid: 15, paymentStatus: "partial"),
                job("j2", "P 773-120", "car", p[1], status: "in_progress", minutes: 14, staff: ["Josué"], ticket: "OT-C1-000013",
                    paid: 15, paymentStatus: "paid"),
                job("j3", "C 109-882", "pickup", p[3], status: "queued", minutes: 9, ticket: "OT-C1-000014", customer: "Transportes Rivas",
                    paymentStatus: "unpaid"),
                job("j4", "P 330-551", "car", p[0], status: "arrived", minutes: 3),
                job("j5", "P 904-276", "xl", p[1], status: "completed", minutes: 52, staff: ["Marvin"], ticket: "OT-C1-000011",
                    paymentStatus: "unpaid"),
            ])
        case "/api/jobs/summary":
            return try? encoder.encode(JobSummaryDTO(total: 19, arrived: 1, queued: 1, inProgress: 2, completed: 15, cancelled: 0,
                arrivalsTodayUtc: 19, completedTodayUtc: 15, averageCompletedSeconds: 2_340))
        case "/api/employees":
            return try? encoder.encode([EmployeeDTO(id: "e-Marvin", name: "Marvin Hernández", active: true),
                EmployeeDTO(id: "e-Kevin", name: "Kevin Rosales", active: true), EmployeeDTO(id: "e-Josué", name: "Josué Pineda", active: true),
                EmployeeDTO(id: "e-Luis", name: "Luis Campos", active: false)])
        case "/api/inventory/items":
            return try? encoder.encode([
                InventoryDTO(item: StockItemDTO(id: "s1", sku: "SHP-01", name: "Shampoo pH neutro", unit: "L", reorderPoint: 10),
                             onHand: 42, reserved: 6, available: 36, needsReorder: false),
                InventoryDTO(item: StockItemDTO(id: "s2", sku: "CER-02", name: "Cera líquida", unit: "L", reorderPoint: 8),
                             onHand: 6, reserved: 2, available: 4, needsReorder: true),
                InventoryDTO(item: StockItemDTO(id: "s3", sku: "ARO-03", name: "Aromatizante", unit: "uds", reorderPoint: 20),
                             onHand: 64, reserved: 0, available: 64, needsReorder: false),
            ])
        case "/api/auth/google":
            return try? encoder.encode(StaffSessionDTO(subject: nil, tenant: nil, sessionToken: "demo-token", role: "operator",
                expiresAt: iso(minutesAgo: -600)))
        default: return Data("{}".utf8)
        }
    }

    static func send(_ request: URLRequest) async throws -> (Data, URLResponse) {
        let url = request.url ?? URL(string: "http://localhost")!
        let data = body(for: url.path) ?? Data("{}".utf8)
        return (data, HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)!)
    }
}

extension OperationsModel {
    static func forLaunch() -> OperationsModel {
        DemoSupport.enabled ? OperationsModel(send: { try await DemoSupport.send($0) }) : OperationsModel()
    }

    func demoSignInIfRequested(context: ModelContext, endpoint: String) async {
        guard DemoSupport.staff, !signedIn else { return }
        await exchangeGoogleToken("demo", context: context, endpoint: endpoint)
        // The refresh inside the exchange is cancelled when the view's task restarts on sign-in, so refresh again unstructured.
        Task { @MainActor in
            for _ in 0..<5 where self.jobs.isEmpty {
                await self.refresh(context: context, endpoint: endpoint)
                try? await Task.sleep(for: .seconds(1))
            }
        }
    }
}
#else
enum DemoSupport { static var openTarget: String? { nil }; static var scrollTarget: String? { nil } }
extension OperationsModel {
    static func forLaunch() -> OperationsModel { OperationsModel() }
    func demoSignInIfRequested(context: ModelContext, endpoint: String) async {}
}
#endif
