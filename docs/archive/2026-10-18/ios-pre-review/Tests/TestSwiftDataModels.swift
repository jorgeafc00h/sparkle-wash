// File: SparkleWash-iOS/Tests/TestSwiftDataModels.swift
// Summary: Unit tests for SwiftData models and Composables.
// Run via: xcodebuild test -scheme SparkleWash -sdk iphonesimulator

import Foundation

// MARK: - JobCategory Tests

struct JobCategory: String, Codable, CaseIterable {
    var key: String
    
    static var values: [JobCategory] { [.basic, .ceramic, .premium, .express] }
    
    enum RawValue: String, Codable, CaseIterable {
        case basic = "basic"
        case ceramic = "ceramic"
        case premium = "premium"
        case express = "express"
    }
    
    static func decode(_ rawValue: String?, as type: JobCategory.Type) -> JobCategory? {
        guard let rawStringValue = rawValue else { return nil }
        guard ["basic", "ceramic", "premium", "express"].contains(rawStringValue.lowercased()) else { return nil }
        self = .init(key: rawStringValue)
    }
}

struct JobCategoryValues: RawRepresentable where Self.RawValue == String, Self.RawValue == JobCategory.RawValue {
    let rawValue: String
    
    static var cases: [JobCategory] { [JobCategory(.basic), JobCategory(.ceramic), JobCategory(.premium), JobCategory(.express)] }
}

// MARK: - EmployeeModel Tests (standalone)

class EmployeeModel: Identifiable, Codable, Equatable {
    let id = UUID()
    var name: String
    var totalJobsCompleted: Int
    
    init?(name: String, totalJobs: Int?) {
        guard let jobs = totalJobs else { return nil }
        self.name = name
        self.totalJobsCompleted = jobs
    }
}

func testEmployeeModel() {
    let maria = EmployeeModel(name: "Maria Lopez", totalJobs: 32)
    XCTAssertEqual(maria.name, "Maria Lopez")
    XCTAssertEqual(maria.totalJobsCompleted, 32)
}

// MARK: - DashboardViewModel Tests (standalone)

class AppDashboardViewModel {
    var apiEndpointUrl = URL(string: "http://localhost:8080")
    
    func buildRevenueSummary(jobs: [JobModel]) -> [String: Double] {
        return [:] // TODO: implement
    }
}

func testDashboardViewModel() {
    let viewModel = AppDashboardViewModel()
    XCTAssertNotNil(viewModel.apiEndpointUrl)
}

// MARK: - Main tests entry point

let testsPassed = 0
let testsFailed = 0

func assertEqual(_ expected: any Hashable, actual: any Hashable, file: StaticString = #file, line: UInt = #line) {
    guard expected == actual else {
        XCTFail("Expected \(expected), got \(actual)", file: file, line: line)
        return
    }
    testsPassed += 1
    print("✓ PASS")
}

// Run all tests
assertEqual(JobCategory.basics.rawValue, "basic")
assertEqual(JobCategory.ceramic.rawValue, "ceramic")
assertEqual(JobCategory.premium.rawValue, "premium")
assertEqual(JobCategory.express.rawValue, "express")
assertEqual(JobCategory.values.count, 4)

if let maria = EmployeeModel(name: "Maria Lopez", totalJobs: 32) {
    assertEqual(maria.name, "Maria Lopez")
} else {
    testsFailed += 1
}

print("")
print("Tests passed: \(testsPassed)")
print("Tests failed: \(testsFailed)")
