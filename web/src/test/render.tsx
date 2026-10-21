import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { I18nProvider, type Locale } from "../i18n";
import { ApiProvider, ToastProvider } from "../lib/context";
import type { SparkleApi } from "../lib/api";
import { SessionProvider } from "../lib/session";
import type { Role, Session } from "../lib/types";

export function session(role: Role = "admin"): Session {
  return {
    role, subject: "demo", expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    tenant: { id: "demo", name: "Lavado Prueba", city: null, country: "SV", phone: null, timeZone: "America/El_Salvador", createdAt: new Date().toISOString() },
  };
}

/** Renders a screen the way the console does: language, toasts, API and the signed-in role. */
export function renderWith(api: SparkleApi, ui: ReactNode, options: { locale?: Locale; role?: Role } = {}) {
  return render(
    <I18nProvider initial={options.locale}>
      <ToastProvider>
        <ApiProvider api={api}>
          <SessionProvider session={session(options.role)}>{ui}</SessionProvider>
        </ApiProvider>
      </ToastProvider>
    </I18nProvider>,
  );
}
