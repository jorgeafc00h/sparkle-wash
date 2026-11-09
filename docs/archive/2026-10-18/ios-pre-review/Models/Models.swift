// MARK: - SwiftData Models for SparkleWash iOS App
import Foundation
import SwiftData

/// Job type classifications with pricing and margin data.
enum JobCategory: String, Codable {
    case basic = "basic"
    case ceramic = "ceramic"
    case premium = "premium"
    case express = "express"
}

/// A wash job record stored in SwiftData, populated from YOLO/inference results on the API.
@Model
final class JobModel {
    @Attribute(.unique) var id: UUID
    
    /// Plate number extracted by YOLO-OCR on vehicle.
    @Attribute var plateNumber: String = ""
    
    /// Detected vehicle make/model from YOLO inference (e.g., "Toyota Camry 2019")
    @Attribute var model: String = ""
    
    /// Detected exterior color from YOLO inference (e.g., "Blue" or "Red").
    @Attribute var color: String = ""
    
    /// Job type category.
    @Attribute var category: JobCategory = .basic
    
    /// Timestamp when the job was completed and recorded.
    @Attribute(.unique) var completedAt: Date
}

/// Employee productivity tracking model.
@Model
final class EmployeeModel {
    @Attribute(.unique) var id: UUID
    
    var name: String
    var department: Role = .general
    var totalJobsCompleted: Int = 0
    var revenueGenerated: Double = 0.0
    var averageCustomerRating: Double = 0.0
    var isAvailable: Bool = true
    
    enum Role: String, Codable {
        case general
        case ceramicSpecialist
        case detailer
        case maintenance
    }
}

/// Daily statistics for summary cards / KPI dashboard.
@Model
final class DailyStatsModel {
    @Attribute(.unique) var date: Date
    
    /// Total jobs completed today.
    var jobCount: Int = 0
    
    /// Revenue accumulated today.
    var revenue: Double = 0.0
    
    init?(date: Date?) {
        guard let date = date else { return nil }
        // Prevent duplicate records for the same calendar day.
        _date = date
        if DailyStatsModel.fetchAll(in: modelContext).first(where: { $0.date == date }) != nil {
            return nil
        }
    }
    
    @Attribute(.unique) var _date: Date
}

// MARK: - DTOs for JSON payloads with API responses

struct VehicleDetection: Codable {
    let plateNumber: String?
    let ocrConfidence: Double?
    let model: String?
    let color: String?
}

struct JobCompletion: Codable, Identifiable {
    let id: UUID
    let category: String
    let durationMs: Int64
    let revenue: Double
    let plateNumber: String?
}

struct MetricAlert: Codable {
    let code: String
    let message: String
    let payload: Payload?
    
    enum Code: String, Codable {
        case lowPressure = "LOW_PSI"
        case lowSoapLevel = "SOAP_LOW"
        case soapHigh = "SOAP_HIGH"
        case error = "ERROR"
    }
    
    struct Detail: Codable {
        let value: Int
        let thresholdLow: Double?
        let thresholdHigh: Double?
    }
    
    struct Payload: Codable {
        var detail: Detail?
    }
}

struct MetricSnapshot: Codable, Identifiable {
    let id: UUID
    let stationId: String
    let stationName: String
    var pressurePSI: Int
    var airFlowCPM: Double?
    var soapLevelDecimeters: Double?
    var soapLevelPercentile: Float?
}

