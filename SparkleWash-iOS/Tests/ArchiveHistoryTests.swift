import Foundation
import SwiftData
import XCTest
@testable import SparkleWash

final class ArchiveHistoryTests: XCTestCase {
    @MainActor
    func testRestorePurgesExpiredStaffSnapshotsAndArchivePayloads() throws {
        let configuration = ModelConfiguration(isStoredInMemoryOnly: true)
        let container = try ModelContainer(for: CachedOperationsSnapshot.self, configurations: configuration)
        let context = container.mainContext
        let oldHistory = try JSONEncoder().encode(SavedArchiveHistory(jobs: [
            ArchivedJobDTO(id: "old-job", plate: "SECRET1", packageName: "Quick", completedAt: "2026-01-01T00:00:00Z")
        ], syncedAt: .now.addingTimeInterval(-172_800)))
        let expired = CachedOperationsSnapshot(endpoint: "https://expired.example", arrivalsData: Data("SECRET2".utf8),
            jobsData: Data("SECRET3".utf8), summaryData: Data("{}".utf8), employeesData: Data("[]".utf8),
            inventoryData: Data("[]".utf8), catalogData: Data("CATALOG".utf8), savedAt: .now.addingTimeInterval(-172_800))
        expired.staffScope = Data("staff-scope".utf8)
        expired.archiveHistoryData = oldHistory
        let active = CachedOperationsSnapshot(endpoint: "https://active.example", arrivalsData: Data("ACTIVE".utf8),
            jobsData: Data("ACTIVE".utf8), summaryData: Data("{}".utf8), employeesData: Data("[]".utf8),
            inventoryData: Data("[]".utf8), catalogData: Data("CATALOG".utf8), savedAt: .now)
        active.staffScope = Data("staff-scope".utf8)
        active.archiveHistoryData = oldHistory
        context.insert(expired)
        context.insert(active)
        try context.save()

        let model = OperationsModel()
        model.restore(context: context, endpoint: "https://active.example")

        let records = try context.fetch(FetchDescriptor<CachedOperationsSnapshot>())
        let expiredAfterCleanup = try XCTUnwrap(records.first { $0.endpoint == "https://expired.example" })
        XCTAssertNil(expiredAfterCleanup.staffScope)
        XCTAssertNil(expiredAfterCleanup.archiveHistoryData)
        XCTAssertEqual(expiredAfterCleanup.arrivalsData, Data("[]".utf8))
        XCTAssertEqual(expiredAfterCleanup.jobsData, Data("[]".utf8))
        XCTAssertEqual(expiredAfterCleanup.catalogData, Data("CATALOG".utf8))

        let activeAfterCleanup = try XCTUnwrap(records.first { $0.endpoint == "https://active.example" })
        XCTAssertNotNil(activeAfterCleanup.staffScope)
        XCTAssertNil(activeAfterCleanup.archiveHistoryData)
        XCTAssertEqual(activeAfterCleanup.arrivalsData, Data("ACTIVE".utf8))
    }

    @MainActor
    func testArchivePagesPersistOfflineAndClearWhenWithdrawn() async throws {
        let fixture = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "service-packages", withExtension: "json"))
        let catalog = try Data(contentsOf: fixture)
        let batch = String(repeating: "a", count: 64)
        let secondBatch = String(repeating: "b", count: 64)
        let expiry = ISO8601DateFormatter().string(from: Date().addingTimeInterval(3600))
        let endpoint = "http://localhost:8080"
        var tenantID = "site"
        var withdrawBatch = false
        var offsets: [String] = []
        var discoveryCursors: [String] = []
        let model = OperationsModel { request in
            let url = try XCTUnwrap(request.url)
            let path = url.path
            var status = 200
            let data: Data
            switch path {
            case "/api/auth/google":
                data = Data("""
                    {"sessionToken":"test-session","role":"viewer","expiresAt":"\(expiry)","tenant":{"id":"\(tenantID)"},"subject":"staff"}
                    """.utf8)
            case "/api/packages":
                data = catalog
            case "/api/jobs/summary":
                data = Data("""
                    {"total":0,"arrived":0,"queued":0,"inProgress":0,"completed":0,"cancelled":0,
                    "arrivalsTodayUtc":0,"completedTodayUtc":0,"averageCompletedSeconds":null}
                    """.utf8)
            case "/api/history/archive":
                XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer test-session")
                let cursor = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?
                    .first(where: { $0.name == "after" })?.value
                discoveryCursors.append(cursor ?? "")
                if cursor == nil {
                    data = Data("""
                        {"batches":["\(batch)"],"nextAfter":"\(batch)"}
                        """.utf8)
                } else {
                    XCTAssertEqual(cursor, batch)
                    data = Data("""
                        {"batches":["\(secondBatch)"],"nextAfter":null}
                        """.utf8)
                }
            case "/api/history/archive/\(secondBatch)":
                data = Data("""
                    {"batch":"\(secondBatch)","jobs":[],"nextOffset":null}
                    """.utf8)
            case "/api/history/archive/\(batch)":
                XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer test-session")
                let offset = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?
                    .first(where: { $0.name == "offset" })?.value ?? ""
                offsets.append(offset)
                if withdrawBatch {
                    status = 404
                    data = Data()
                } else {
                    let day = offset == "0" ? "01" : "02"
                    let next = offset == "0" ? "1" : "null"
                    data = Data("""
                        {"batch":"\(batch)","jobs":[{"id":"job-\(offset)","plate":"ABC123",
                        "packageName":"Quick","completedAt":"2026-01-\(day)T00:00:00Z"}],"nextOffset":\(next)}
                        """.utf8)
                }
            case "/api/arrivals", "/api/jobs", "/api/employees", "/api/inventory/items":
                data = Data("[]".utf8)
            default:
                XCTFail("Unexpected request: \(path)")
                throw URLError(.badURL)
            }
            let response = try XCTUnwrap(HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil))
            return (data, response)
        }

        let storeDirectory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: storeDirectory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: storeDirectory) }
        let configuration = ModelConfiguration(url: storeDirectory.appendingPathComponent("Archive.store"))
        let container = try ModelContainer(for: CachedOperationsSnapshot.self, configurations: configuration)
        let context = container.mainContext
        model.restore(context: context, endpoint: endpoint)
        await model.exchangeGoogleToken("provider-credential", context: context, endpoint: endpoint)
        XCTAssertTrue(model.canReadSavedHistory(at: .now))

        let downloaded = try await model.syncArchiveHistory(context: context)
        XCTAssertEqual(discoveryCursors, ["", batch])
        XCTAssertEqual(offsets, ["0", "1"])
        XCTAssertEqual(downloaded.jobs.map(\.id), ["job-1", "job-0"])
        let reopened = try ModelContainer(for: CachedOperationsSnapshot.self, configurations: configuration)
        XCTAssertEqual(try model.savedArchiveHistory(context: reopened.mainContext)?.jobs.map(\.id), ["job-1", "job-0"])

        withdrawBatch = true
        do {
            _ = try await model.syncArchiveHistory(context: context)
            XCTFail("Expected a withdrawn batch to invalidate saved history")
        } catch OperationsModel.ArchiveSyncError.batchWithdrawn {}
        let afterWithdrawal = try ModelContainer(for: CachedOperationsSnapshot.self, configurations: configuration)
        XCTAssertNil(try model.savedArchiveHistory(context: afterWithdrawal.mainContext))

        XCTAssertFalse(model.canReadSavedHistory(at: .now.addingTimeInterval(7200)),
                       "A downloaded archive must become inaccessible after the staff session expires.")
        tenantID = "another-site"
        await model.exchangeGoogleToken("provider-credential", context: context, endpoint: endpoint)
        XCTAssertTrue(model.signedIn)
        XCTAssertNil(try model.savedArchiveHistory(context: context),
                     "A second tenant at the same endpoint must not inherit the prior tenant's archive.")

        model.signOut(context: context)
        XCTAssertTrue(try context.fetch(FetchDescriptor<CachedOperationsSnapshot>()).isEmpty,
                      "Sign-out must remove the endpoint's saved operational and archive data.")
    }
}
