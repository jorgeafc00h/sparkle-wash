import SparkleKit
import SwiftUI

struct SignInView: View {
    @Environment(AppModel.self) private var model
    @Environment(Localizer.self) private var t
    @State private var registering = false

    var body: some View {
        @Bindable var localizer = t
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                Picker(t("shell.language"), selection: $localizer.language) {
                    Text("Español").tag("es")
                    Text("English").tag("en")
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("language-picker")

                HStack(spacing: 12) {
                    Image(systemName: "drop.fill").font(.title).foregroundStyle(.white)
                        .frame(width: 52, height: 52).background(RoundedRectangle(cornerRadius: 14).fill(Color.brand))
                    VStack(alignment: .leading) {
                        Text("SparkleWash").font(.title2.weight(.bold))
                        Text(t("app.console")).foregroundStyle(.secondary)
                    }
                }
                VStack(alignment: .leading, spacing: 6) {
                    Text(t("signin.title")).font(.title.weight(.bold))
                    Text(t("signin.body")).foregroundStyle(.secondary)
                }
                if let notice = model.notice {
                    Label(notice, systemImage: "info.circle").font(.callout).padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 12).fill(Color.brandSky.opacity(0.15)))
                        .accessibilityIdentifier("signin-notice")
                }
                if model.config.canSignIn {
                    Button { Task { await model.signInWithGoogle() } } label: {
                        Label(t("ios.signin.google"), systemImage: "person.badge.key").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent).controlSize(.large).tint(.brand).disabled(model.busy)
                } else {
                    Text(t("ios.signin.notConfigured")).font(.footnote).foregroundStyle(.secondary)
                }
                Button { Task { await model.startDemo() } } label: {
                    Label(t("signin.demo"), systemImage: "play.circle").frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered).controlSize(.large)
                .accessibilityIdentifier("demo-button")
                Text(t("signin.demoNote")).font(.footnote).foregroundStyle(.secondary)

                HStack {
                    Text(t("signin.newCarwash")).font(.callout).foregroundStyle(.secondary)
                    Spacer()
                    Button(t("signin.registerCta")) { registering = true }.accessibilityIdentifier("register-button")
                }
                .padding(14)
                .background(RoundedRectangle(cornerRadius: 12).fill(Color.secondary.opacity(0.1)))
            }
            .padding(28)
            .frame(maxWidth: 520)
            .frame(maxWidth: .infinity)
        }
        .sheet(isPresented: $registering) { RegisterView() }
    }
}

struct CarwashFields: View {
    @Binding var input: TenantInput
    var errors: Set<TenantInput.Field>
    @Environment(Localizer.self) private var t

    static let countries = ["SV", "GT", "HN", "NI", "CR", "PA", "MX", "CO", "DO", "PR", "US", "ES"]
    static let zones = ["America/El_Salvador", "America/Guatemala", "America/Tegucigalpa", "America/Managua", "America/Costa_Rica",
                        "America/Panama", "America/Mexico_City", "America/Bogota", "America/Santo_Domingo", "America/Puerto_Rico",
                        "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Europe/Madrid"]
    static let zoneByCountry = ["SV": "America/El_Salvador", "GT": "America/Guatemala", "HN": "America/Tegucigalpa", "NI": "America/Managua",
                                "CR": "America/Costa_Rica", "PA": "America/Panama", "MX": "America/Mexico_City", "CO": "America/Bogota",
                                "DO": "America/Santo_Domingo", "PR": "America/Puerto_Rico", "US": "America/New_York", "ES": "Europe/Madrid"]

    var body: some View {
        TextField(t("register.name"), text: $input.name).textContentType(.organizationName).accessibilityIdentifier("carwash-name")
        if errors.contains(.name) { Text(t("register.nameInvalid")).font(.footnote).foregroundStyle(.red) }
        TextField(t("register.city"), text: Binding(get: { input.city ?? "" }, set: { input.city = $0 })).textContentType(.addressCity)
        Picker(t("register.country"), selection: Binding(get: { input.country }, set: {
            input.country = $0
            input.timeZone = Self.zoneByCountry[$0] ?? input.timeZone
        })) {
            ForEach(Self.countries, id: \.self) { code in Text(t.locale.localizedString(forRegionCode: code) ?? code).tag(code) }
        }
        .accessibilityIdentifier("carwash-country")
        TextField(t("register.phone"), text: Binding(get: { input.phone ?? "" }, set: { input.phone = $0 })).keyboardType(.phonePad).textContentType(.telephoneNumber)
        if errors.contains(.phone) { Text(t("register.phoneInvalid")).font(.footnote).foregroundStyle(.red) }
        Picker(t("register.timeZone"), selection: $input.timeZone) {
            ForEach(Self.zones.contains(input.timeZone) ? Self.zones : [input.timeZone] + Self.zones, id: \.self) { zone in
                Text(zone.split(separator: "/").last.map { $0.replacingOccurrences(of: "_", with: " ") } ?? zone).tag(zone)
            }
        }
        .accessibilityIdentifier("carwash-timezone")
    }
}

struct RegisterView: View {
    @Environment(AppModel.self) private var model
    @Environment(Localizer.self) private var t
    @Environment(\.dismiss) private var dismiss
    @State private var input = TenantInput(name: "")
    @State private var errors: Set<TenantInput.Field> = []

    var body: some View {
        NavigationStack {
            Form {
                SwiftUI.Section { Text(t("register.body")).foregroundStyle(.secondary) }
                SwiftUI.Section { CarwashFields(input: $input, errors: errors) }
                SwiftUI.Section {
                    if model.config.canSignIn {
                        Button(t("ios.register.google")) { submit { await model.register(input.cleaned) } }
                            .disabled(model.busy)
                    } else {
                        Button(t("register.demo")) { submit { await model.startDemo(carwash: input.cleaned) } }
                            .accessibilityIdentifier("register-demo-button")
                        Text(t("register.demoNote")).font(.footnote).foregroundStyle(.secondary)
                    }
                }
                if let notice = model.notice { SwiftUI.Section { Text(notice).foregroundStyle(.red) } }
            }
            .navigationTitle(t("register.title"))
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(t("link.cancel")) { dismiss() } } }
        }
    }

    private func submit(_ action: @escaping () async -> Void) {
        errors = input.validationErrors
        guard errors.isEmpty else { return }
        Task {
            await action()
            if model.phase == .signedIn { dismiss() }
        }
    }
}
