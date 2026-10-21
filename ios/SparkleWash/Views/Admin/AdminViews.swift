import SparkleKit
import SwiftUI
import UIKit

enum AdminDestination: Hashable {
    case carwash, team, employees
    case camera(String)
}

/// Content column of Administración: carwash, cameras (one row each), team, employees.
struct AdminMenuView: View {
    @Binding var selection: AdminDestination?
    @Environment(AppModel.self) private var model
    @Environment(Localizer.self) private var t
    @State private var linking = false
    @State private var issued: DeviceWithKey?
    @State private var created: DeviceWithKey?
    @State private var teamSize = 0

    var body: some View {
        let _ = model.engine?.revision
        let devices = model.engine?.store.devices() ?? []
        let employees = model.engine?.store.employees() ?? []
        List(selection: $selection) {
            let steps: [(Bool, String, AdminDestination?)] = [
                (devices.contains { !$0.disabled }, "admin.step.camera", nil),
                (teamSize > 1, "admin.step.team", .team),
                (!employees.isEmpty, "admin.step.employees", .employees),
            ]
            if steps.contains(where: { !$0.0 }) {
                SwiftUI.Section {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(t("admin.welcome", ["name": model.session?.tenant.name ?? ""])).font(.headline)
                        Text(t("admin.checklist")).font(.subheadline).foregroundStyle(.secondary)
                    }
                    .accessibilityIdentifier("onboarding")
                    ForEach(Array(steps.enumerated()), id: \.offset) { index, step in
                        Button {
                            if let destination = step.2 { selection = destination } else { linking = true }
                        } label: {
                            Label(t(step.1), systemImage: step.0 ? "checkmark.circle.fill" : "\(index + 1).circle")
                                .foregroundStyle(step.0 ? .secondary : .primary)
                                .strikethrough(step.0)
                        }
                    }
                }
            }
            SwiftUI.Section {
                Label(t("admin.tab.carwash"), systemImage: "building.2").tag(AdminDestination.carwash).accessibilityIdentifier("admin-carwash")
            }
            SwiftUI.Section {
                ForEach(devices) { device in
                    DeviceRow(device: device).tag(AdminDestination.camera(device.id)).accessibilityIdentifier("device-\(device.cameraId)")
                }
                Button { linking = true } label: { Label(t("cameras.add"), systemImage: "plus.circle.fill") }
                    .accessibilityIdentifier("link-camera-button")
            } header: { Text(t("cameras.title")) } footer: {
                if devices.isEmpty { Text(t("cameras.emptyBody")) }
            }
            SwiftUI.Section {
                Label(t("admin.tab.team"), systemImage: "person.2.badge.key").tag(AdminDestination.team).accessibilityIdentifier("admin-team")
                Label(t("admin.tab.employees"), systemImage: "person.3").tag(AdminDestination.employees).accessibilityIdentifier("admin-employees")
            }
        }
        .navigationTitle(t("admin.title"))
        .refreshable { await model.engine?.sync() }
        .task { teamSize = await currentTeamSize() }
        // The key sheet opens once the link sheet has gone: SwiftUI can't present a sheet while another is dismissing.
        .sheet(isPresented: $linking, onDismiss: { if let created { issued = created; self.created = nil } }) {
            LinkCameraSheet(existing: devices) { device in
                created = device
                model.engine?.store.upsertDevice(device.device)
                selection = .camera(device.device.id)
                linking = false
            }
        }
        .sheet(item: Binding(get: { issued.map(IssuedKey.init) }, set: { if $0 == nil { issued = nil } })) { key in
            KeySheet(issued: key.value) { issued = nil; Task { await model.engine?.sync() } }
        }
    }

    private func currentTeamSize() async -> Int {
        guard let team = try? await model.engine?.api.team() else { return 0 }
        return team.members.count + team.invitations.count
    }
}

struct IssuedKey: Identifiable {
    let value: DeviceWithKey
    var id: String { value.deviceKey }
}

struct DeviceRow: View {
    let device: Device
    @Environment(Localizer.self) private var t

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: device.role.symbol).frame(width: 32, height: 32).background(Circle().fill(Color.brandSky.opacity(0.15))).foregroundStyle(Color.brandSky)
            VStack(alignment: .leading, spacing: 2) {
                Text(device.name).font(.headline)
                Text(device.cameraId).font(.caption.monospaced()).foregroundStyle(.secondary)
            }
            Spacer()
            DeviceStateLabel(device: device)
        }
    }
}

extension CameraRole {
    var symbol: String {
        switch self {
        case .entry: "arrow.right.to.line"
        case .bay: "viewfinder"
        case .exit: "rectangle.portrait.and.arrow.right"
        }
    }
}

struct DeviceStateLabel: View {
    let device: Device
    @Environment(Localizer.self) private var t

    var body: some View {
        switch device.state {
        case .online: Pill(text: t("device.online"), symbol: "wifi", tint: .green)
        case .offline: Pill(text: t("device.offline", ["ago": t.ago(device.lastSeenAt)]), symbol: "wifi.slash", tint: .red)
        case .never: Pill(text: t("device.never"), symbol: "hourglass", tint: .orange)
        case .disabled: Pill(text: t("device.disabled"), symbol: "power", tint: .secondary)
        }
    }
}

struct AdminDetailView: View {
    let destination: AdminDestination
    var body: some View {
        switch destination {
        case .carwash: CarwashProfileView()
        case .team: TeamView()
        case .employees: EmployeesView()
        case .camera(let id): CameraDetailView(deviceId: id)
        }
    }
}

// MARK: - Autolavado

struct CarwashProfileView: View {
    @Environment(AppModel.self) private var model
    @Environment(Localizer.self) private var t
    @State private var input: TenantInput?
    @State private var errors: Set<TenantInput.Field> = []
    @State private var message: String?
    @State private var saving = false
    @State private var failed = false

    var body: some View {
        Form {
            if input != nil {
                SwiftUI.Section { CarwashFields(input: Binding(get: { input! }, set: { input = $0 }), errors: errors) }
                SwiftUI.Section {
                    Button(saving ? t("admin.saving") : t("admin.save")) { Task { await save() } }
                        .disabled(saving).accessibilityIdentifier("save-carwash")
                    if let message { Text(message).font(.footnote).foregroundStyle(.secondary) }
                }
            } else if failed {
                NeedsConnectionView { await load() }
            } else {
                ProgressView()
            }
        }
        .navigationTitle(t("admin.tab.carwash"))
        .task { await load() }
    }

    private func load() async {
        guard input == nil else { return }
        do {
            guard let tenant = try await model.engine?.api.tenant() else { return }
            input = TenantInput(name: tenant.name, city: tenant.city, country: tenant.country, phone: tenant.phone, timeZone: tenant.timeZone)
            failed = false
        } catch { failed = true }
    }

    private func save() async {
        guard let input else { return }
        errors = input.validationErrors
        guard errors.isEmpty else { return }
        saving = true
        defer { saving = false }
        do {
            _ = try await model.engine?.api.updateTenant(input)
            await model.refreshSession()
            message = t("admin.saved")
        } catch {
            message = t.error(error)
        }
    }
}

// MARK: - Cámaras

struct LinkCameraSheet: View {
    let existing: [Device]
    let onCreated: (DeviceWithKey) -> Void
    @Environment(AppModel.self) private var model
    @Environment(Localizer.self) private var t
    @Environment(\.dismiss) private var dismiss
    @State private var role: CameraRole = .entry
    @State private var name = ""
    @State private var cameraId = DeviceInput.suggestedCameraId(for: .entry)
    @State private var touchedId = false
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        NavigationStack {
            Form {
                SwiftUI.Section {
                    Picker(t("link.role"), selection: $role) {
                        ForEach(CameraRole.allCases, id: \.self) { role in Label(t.cameraRole(role), systemImage: role.symbol).tag(role) }
                    }
                    .pickerStyle(.segmented)
                    .accessibilityIdentifier("camera-role")
                    Text(t("cameraRole.help.\(role.rawValue)")).font(.footnote).foregroundStyle(.secondary)
                }
                SwiftUI.Section {
                    TextField(t("link.namePlaceholder"), text: $name).accessibilityIdentifier("camera-name")
                    TextField(t("link.cameraId"), text: Binding(get: { cameraId }, set: { cameraId = $0; touchedId = true }))
                        .font(.body.monospaced()).textInputAutocapitalization(.never).autocorrectionDisabled()
                        .accessibilityIdentifier("camera-id")
                } footer: { Text(t("link.cameraIdHelp")) }
                if let error { SwiftUI.Section { Text(error).foregroundStyle(.red).accessibilityIdentifier("link-error") } }
            }
            .navigationTitle(t("link.title"))
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("link.cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(busy ? t("link.creating") : t("link.create")) { Task { await create() } }
                        .disabled(busy).accessibilityIdentifier("create-key-button")
                }
            }
            .onAppear {
                let free = CameraRole.allCases.first { role in !existing.contains { $0.role == role && !$0.disabled } } ?? .bay
                role = free
                cameraId = DeviceInput.suggestedCameraId(for: free, existing: existing.map(\.cameraId))
            }
            .onChange(of: role) { _, newRole in if !touchedId { cameraId = DeviceInput.suggestedCameraId(for: newRole, existing: existing.map(\.cameraId)) } }
        }
    }

    private func create() async {
        let input = DeviceInput(name: name.trimmingCharacters(in: .whitespaces), cameraId: cameraId.trimmingCharacters(in: .whitespaces).lowercased(), role: role)
        guard input.isValid else { error = t("link.invalid"); return }
        let taken = t("link.idTaken", ["cameraId": input.cameraId,
                                       "suggestion": DeviceInput.suggestedCameraId(for: role, existing: existing.map(\.cameraId))])
        guard !existing.contains(where: { $0.cameraId == input.cameraId }) else { error = taken; return }
        guard let api = model.engine?.api else { return }
        busy = true
        defer { busy = false }
        do { onCreated(try await api.createDevice(input)) } catch {
            if case .conflict? = error as? APIError { self.error = taken } else { self.error = t.error(error) }
        }
    }
}

/// Shows a device key exactly once, with the gateway command. Can't be swiped away by accident.
struct KeySheet: View {
    let issued: DeviceWithKey
    let onDone: () -> Void
    @Environment(AppModel.self) private var model
    @Environment(Localizer.self) private var t
    @State private var copied = false
    @State private var copiedCommand = false
    @State private var provisioning = false

    private var command: String {
        let api = model.config.server?.baseURL.absoluteString ?? "https://TU-API"
        let host = LocalCamera.mdnsHost(cameraId: issued.device.cameraId)
        return "python -m sparkle_vision.gateway --camera-url http://\(host)/cam-hi.jpg --camera-id \(issued.device.cameraId) --api \(api) --device-key \(issued.deviceKey)"
    }

    var body: some View {
        NavigationStack {
            Form {
                SwiftUI.Section {
                    Label(t("link.keyWarning"), systemImage: "key.fill").foregroundStyle(.orange)
                }
                SwiftUI.Section(t("device.key")) {
                    Text(issued.deviceKey).font(.callout.monospaced()).textSelection(.enabled).accessibilityIdentifier("device-key")
                    HStack {
                        Button(copied ? t("link.copied") : t("link.copy")) {
                            UIPasteboard.general.string = issued.deviceKey
                            copied = true
                        }
                        Spacer()
                        ShareLink(item: issued.deviceKey) { Label(t("ios.key.share"), systemImage: "square.and.arrow.up") }
                    }
                }
                SwiftUI.Section {
                    Text(command).font(.caption.monospaced()).textSelection(.enabled)
                    Button(copiedCommand ? t("link.copied") : t("link.copy")) { UIPasteboard.general.string = command; copiedCommand = true }
                } header: { Text(t("link.command")) } footer: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(t("link.steps", ["cameraId": issued.device.cameraId]))
                        Text(t("link.mdnsNote"))
                        Text(t("link.stepsLegacy", ["cameraId": issued.device.cameraId]))
                    }
                }
                SwiftUI.Section(t("ios.key.next")) {
                    Button { provisioning = true } label: { Label(t("ios.ble.title"), systemImage: "antenna.radiowaves.left.and.right") }
                        .accessibilityIdentifier("key-ble-button")
                }
            }
            .navigationTitle(t("link.keyTitle", ["name": issued.device.name]))
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button(t("link.done"), action: onDone).accessibilityIdentifier("key-done-button") }
            }
        }
        .interactiveDismissDisabled()
        .sheet(isPresented: $provisioning) { BLEProvisionView(cameraId: issued.device.cameraId) }
    }
}

struct CameraDetailView: View {
    let deviceId: String
    @Environment(AppModel.self) private var model
    @Environment(Localizer.self) private var t
    @State private var issued: DeviceWithKey?
    @State private var confirmRotate = false
    @State private var error: String?
    @State private var provisioning = false
    @State private var confirmDisable = false

    var body: some View {
        let _ = model.engine?.revision
        if let device = model.engine?.store.devices().first(where: { $0.id == deviceId }) {
            content(device)
        } else {
            DetailPlaceholder(symbol: "camera", text: t("ios.select.camera"))
        }
    }

    @ViewBuilder private func content(_ device: Device) -> some View {
        List {
            SwiftUI.Section {
                HStack {
                    Image(systemName: device.role.symbol).font(.title2).foregroundStyle(Color.brandSky)
                    VStack(alignment: .leading) {
                        Text(device.name).font(.title3.weight(.semibold))
                        Text(device.cameraId).font(.callout.monospaced()).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Pill(text: t.cameraRole(device.role))
                }
                DeviceStateLabel(device: device)
                Text(t("cameraRole.help.\(device.role.rawValue)")).font(.footnote).foregroundStyle(.secondary)
            }
            SwiftUI.Section {
                LabeledContent(t("device.signal")) {
                    HStack { SignalBars(bars: device.lastStatus?.signalBars ?? 0); Text(device.lastStatus?.rssi.map { "\($0) dBm" } ?? "—").monospacedDigit() }
                }
                LabeledContent(t("device.uptime"), value: Durations.short(device.lastStatus?.uptimeMs.map { $0 / 1000 }))
                LabeledContent(t("device.fps"), value: device.lastStatus?.fps.map { String(format: "%.1f", $0) } ?? "—")
                LabeledContent(t("device.reads"), value: "\(device.observations)")
                LabeledContent(t("device.key"), value: device.keyHint)
                if let ip = device.lastStatus?.ip { LabeledContent("IP", value: ip) }
                if let firmware = device.lastStatus?.firmware { LabeledContent(t("ios.local.firmware"), value: firmware) }
            }
            LocalCameraSection(cameraId: device.cameraId, knownIP: device.lastStatus?.ip)
            SwiftUI.Section {
                if LocalCamera.supportsBluetoothSetup(device.lastStatus?.firmware) {
                    Button { provisioning = true } label: { Label(t("ios.ble.title"), systemImage: "antenna.radiowaves.left.and.right") }
                        .accessibilityIdentifier("ble-setup-button")
                } else {
                    Label(t("device.updateBadge"), systemImage: "arrow.down.circle").foregroundStyle(.orange)
                    Text(t("ios.ble.requires12")).font(.footnote).foregroundStyle(.secondary)
                }
            }
            SwiftUI.Section {
                Button { confirmRotate = true } label: { Label(t("device.rotate"), systemImage: "key") }
                    .disabled(device.disabled)
                    .confirmationDialog(t("device.rotateConfirm", ["name": device.name]), isPresented: $confirmRotate, titleVisibility: .visible) {
                        Button(t("device.rotate"), role: .destructive) { Task { await rotate(device) } }
                    }
                Button(role: device.disabled ? nil : .destructive) {
                    if device.disabled { Task { await toggle(device) } } else { confirmDisable = true }
                } label: {
                    Label(device.disabled ? t("device.enable") : t("device.disable"), systemImage: "power")
                }
                .accessibilityIdentifier("toggle-device-button")
                .disabled(model.engine?.isOnline == false)
                .confirmationDialog(t("device.disableConfirm", ["name": device.name]), isPresented: $confirmDisable, titleVisibility: .visible) {
                    Button(t("device.disable"), role: .destructive) { Task { await toggle(device) } }
                }
                if model.engine?.isOnline == false { Text(t("ios.onlineOnly")).font(.footnote).foregroundStyle(.secondary) }
                if let error { Text(error).foregroundStyle(.red) }
            }
        }
        .navigationTitle(device.name)
        .sheet(item: Binding(get: { issued.map(IssuedKey.init) }, set: { if $0 == nil { issued = nil } })) { key in
            KeySheet(issued: key.value) { issued = nil }
        }
        .sheet(isPresented: $provisioning) { BLEProvisionView(cameraId: device.cameraId) }
    }

    private func rotate(_ device: Device) async {
        do {
            guard let result = try await model.engine?.api.rotateDevice(id: device.id) else { return }
            model.engine?.store.upsertDevice(result.device)
            issued = result
        } catch { self.error = t.error(error) }
    }

    private func toggle(_ device: Device) async {
        do {
            guard let updated = try await model.engine?.api.setDeviceDisabled(id: device.id, disabled: !device.disabled) else { return }
            model.engine?.store.upsertDevice(updated)
            error = nil
            await model.engine?.sync()
        } catch { self.error = t.error(error) }
    }
}

// MARK: - Equipo

struct TeamView: View {
    @Environment(AppModel.self) private var model
    @Environment(Localizer.self) private var t
    @State private var team: Team?
    @State private var email = ""
    @State private var role: Role = .operator
    @State private var message: String?
    @State private var removing: Member?
    @State private var failed = false

    var body: some View {
        Form {
            SwiftUI.Section {
                TextField(t("team.email"), text: $email).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
                    .accessibilityIdentifier("invite-email")
                Picker(t("link.role"), selection: $role) {
                    ForEach(Role.allCases, id: \.self) { role in Text(t.role(role)).tag(role) }
                }
                Text(t("role.help.\(role.rawValue)")).font(.footnote).foregroundStyle(.secondary)
                Button(t("team.invite")) { Task { await invite() } }.accessibilityIdentifier("invite-button")
                if let message { Text(message).font(.footnote).accessibilityIdentifier("team-message") }
            } header: { Text(t("team.inviteTitle")) } footer: { Text(t("team.inviteHelp")) }

            if let team {
                SwiftUI.Section(t("team.members")) {
                    ForEach(team.members) { member in
                        HStack {
                            VStack(alignment: .leading) {
                                Text(member.displayName + (member.subject == team.you ? " · \(t("team.you"))" : "")).font(.headline)
                                if let email = member.email { Text(email).font(.caption).foregroundStyle(.secondary) }
                            }
                            Spacer()
                            Menu(t.role(member.role)) {
                                ForEach(Role.allCases, id: \.self) { option in
                                    Button(t.role(option)) { Task { await setRole(member, option) } }
                                }
                                if member.subject != team.you {
                                    Divider()
                                    Button(t("team.remove"), role: .destructive) { removing = member }
                                }
                            }
                            .accessibilityIdentifier("role-\(member.subject)")
                        }
                        .swipeActions {
                            if member.subject != team.you {
                                Button(t("team.remove"), role: .destructive) { removing = member }
                            }
                        }
                    }
                }
                if !team.invitations.isEmpty {
                    SwiftUI.Section(t("team.pending")) {
                        ForEach(team.invitations) { invitation in
                            HStack {
                                VStack(alignment: .leading) {
                                    Text(invitation.email)
                                    Text("\(t.role(invitation.role)) · \(t.ago(invitation.invitedAt))").font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                Button(t("team.revoke")) { Task { await revoke(invitation) } }.buttonStyle(.borderless)
                            }
                        }
                    }
                }
                if !team.configured.isEmpty {
                    SwiftUI.Section {
                        ForEach(team.configured, id: \.subject) { item in LabeledContent(item.subject, value: t.role(item.role)) }
                    } header: { Text(t("team.configured")) } footer: { Text(t("team.configuredHelp")) }
                }
            } else if failed {
                NeedsConnectionView { await load() }
            } else {
                ProgressView()
            }
        }
        .navigationTitle(t("admin.tab.team"))
        .task { await load() }
        .confirmationDialog(t("team.removeConfirm", ["name": removing?.displayName ?? ""]), isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            Button(t("team.remove"), role: .destructive) { if let member = removing { Task { await remove(member) } } }
        }
    }

    private func load() async {
        do { team = try await model.engine?.api.team(); failed = false } catch { failed = team == nil }
    }

    private func run(_ action: () async throws -> Void, success: String) async {
        do { try await action(); message = success } catch { message = t.error(error) }
        await load()
    }

    private func invite() async {
        guard let normalized = EmailAddress.normalize(email) else { message = t("team.emailInvalid"); return }
        await run({ try await model.engine?.api.invite(email: normalized, role: role); email = "" }, success: t("team.invited", ["email": normalized]))
    }

    private func setRole(_ member: Member, _ role: Role) async {
        await run({ try await model.engine?.api.setMemberRole(subject: member.subject, role: role) }, success: t("team.roleChanged", ["name": member.displayName]))
    }

    private func remove(_ member: Member) async {
        await run({ try await model.engine?.api.removeMember(subject: member.subject) }, success: t("team.removed"))
    }

    private func revoke(_ invitation: Invitation) async {
        await run({ try await model.engine?.api.revokeInvitation(id: invitation.id) }, success: t("team.revoked"))
    }
}

// MARK: - Empleados

struct EmployeesView: View {
    @Environment(AppModel.self) private var model
    @Environment(Localizer.self) private var t
    @State private var name = ""
    @State private var message: String?

    var body: some View {
        let _ = model.engine?.revision
        let employees = model.engine?.store.employees() ?? []
        Form {
            SwiftUI.Section {
                HStack {
                    TextField(t("emp.name"), text: $name).accessibilityIdentifier("employee-name")
                    Button(t("emp.add")) { Task { await add() } }
                        .disabled(name.trimmingCharacters(in: .whitespaces).count < 2).accessibilityIdentifier("add-employee")
                }
                if let message { Text(message).font(.footnote) }
            } header: { Text(t("emp.title")) } footer: { Text(t("emp.help")) }
            SwiftUI.Section {
                if employees.isEmpty { Text(t("emp.empty")).foregroundStyle(.secondary) }
                ForEach(employees) { employee in
                    Toggle(isOn: Binding(get: { employee.active }, set: { active in Task { await setActive(employee, active) } })) {
                        Text(employee.name)
                    }
                }
            }
        }
        .navigationTitle(t("admin.tab.employees"))
    }

    private func add() async {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        do {
            _ = try await model.engine?.api.addEmployee(name: trimmed)
            name = ""
            message = t("emp.added", ["name": trimmed])
            await model.engine?.pull()
        } catch { message = t.error(error) }
    }

    private func setActive(_ employee: Employee, _ active: Bool) async {
        do {
            _ = try await model.engine?.api.setEmployeeActive(id: employee.id, active: active)
            await model.engine?.pull()
        } catch { message = t.error(error) }
    }
}
