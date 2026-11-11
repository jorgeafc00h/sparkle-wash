import Foundation
import XCTest
@testable import SparkleWash

final class PosJobTests: XCTestCase {
    private static let base = """
    "id":"j1","arrivalId":"a1","plate":"P123456","vehicleClass":"car","packageId":"quick","packageName":"Rapido",
    "services":["Exterior"],"priceUsd":10,"status":"completed","arrivalAt":"2026-10-21T20:55:28Z",
    "elapsedSeconds":60,"assignments":[]
    """

    private func job(_ extra: String = "", status: String = "completed") throws -> JobDTO {
        let json = "{\(Self.base.replacingOccurrences(of: "\"completed\"", with: "\"\(status)\""))\(extra)}"
        return try JSONDecoder().decode(JobDTO.self, from: Data(json.utf8))
    }

    func testLegacyJobWithoutPosFieldsDecodes() throws {
        let legacy = try job()
        XCTAssertTrue(legacy.isValid)
        XCTAssertNil(legacy.ticketNumber); XCTAssertNil(legacy.payments); XCTAssertNil(legacy.paymentStatus)
        XCTAssertFalse(legacy.isDesktopPos)
        XCTAssertFalse(JobPaymentPresentation.hasPaymentInfo(legacy))
        XCTAssertNil(JobPaymentPresentation.ticketLabel(legacy))
    }

    func testDesktopJobWithTwoPaymentsGoesPartialThenPaid() throws {
        let head = ",\"source\":\"desktop-pos\",\"ticketNumber\":\"OT-C1-000045\",\"customerName\":\"Ana\",\"note\":\"Sin cera\""
        let p1 = "{\"id\":\"p1\",\"method\":\"cash\",\"amountUsd\":4,\"ticketNumber\":\"V-1\",\"reference\":null,\"recordedAt\":\"2026-10-21T21:00:00.1234567+00:00\",\"actor\":\"a\",\"idempotencyKey\":\"k1\"}"
        let p2 = "{\"id\":\"p2\",\"method\":\"card\",\"amountUsd\":6,\"ticketNumber\":\"V-2\",\"reference\":\"1234\",\"recordedAt\":\"2026-10-21T21:10:00Z\",\"actor\":\"a\",\"idempotencyKey\":\"k2\"}"

        let partial = try job(head + ",\"payments\":[\(p1)],\"paidUsd\":4,\"paymentStatus\":\"partial\",\"paidAt\":null")
        XCTAssertTrue(partial.isDesktopPos)
        XCTAssertEqual(partial.ticketNumber, "OT-C1-000045")
        XCTAssertEqual(partial.customerName, "Ana")
        XCTAssertEqual(partial.payments?.first?.recordedDate != nil, true)
        XCTAssertEqual(JobPaymentPresentation.ticketLabel(partial), "Ticket OT-C1-000045")
        XCTAssertEqual(JobPaymentPresentation.chip(for: partial),
                       .init(kind: .partial, text: "Pago parcial $4.00 de $10.00"))

        let paid = try job(head + ",\"payments\":[\(p1),\(p2)],\"paidUsd\":10,\"paymentStatus\":\"paid\",\"paidAt\":\"2026-10-21T21:10:00Z\"")
        XCTAssertEqual(paid.payments?.count, 2)
        XCTAssertEqual(paid.payments?.map(\.method).map(JobPaymentPresentation.methodLabel), ["Efectivo", "Tarjeta"])
        XCTAssertEqual(JobPaymentPresentation.chip(for: paid), .init(kind: .paid, text: "Pagado"))
    }

    func testUnpaidChipMethodLabelsAndReceivableCount() throws {
        let unpaid = try job(",\"payments\":[],\"paidUsd\":0,\"paymentStatus\":\"unpaid\"")
        XCTAssertEqual(JobPaymentPresentation.chip(for: unpaid), .init(kind: .unpaid, text: "Por cobrar"))
        XCTAssertEqual(["transfer", "other", nil, "x"].map(JobPaymentPresentation.methodLabel),
                       ["Transferencia", "Otro", "Otro", "Otro"])

        let paid = try job(",\"paymentStatus\":\"paid\",\"paidUsd\":10")
        let running = try job(",\"paymentStatus\":\"unpaid\"", status: "in_progress")
        let queued = try job(",\"paymentStatus\":\"unpaid\"", status: "queued")
        let cancelled = try job(",\"paymentStatus\":\"unpaid\"", status: "cancelled")
        let legacy = try job()
        XCTAssertEqual(JobPaymentPresentation.receivableCount([unpaid, paid, running, queued, cancelled, legacy]), 2)
    }
}
