import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import catalogJson from "../../../contracts/v1/service-packages.json";
import { ApiError } from "../lib/api";
import type { Catalog } from "../lib/types";
import { cameraLabel, className, DEFAULT_LOCALE, errorText, format, I18nProvider, packageText, translator, useI18n } from "../i18n";
import { en } from "../i18n/en";
import { es } from "../i18n/es";
import { LanguageSwitch } from "../components/ui";

const catalog = catalogJson as Catalog;

describe("i18n", () => {
  it("defaults to Spanish", () => {
    expect(DEFAULT_LOCALE).toBe("es");
    expect(translator("es")("status.in_progress")).toBe("Lavando");
  });

  it("has an English string for every Spanish key, and none extra", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(es).sort());
    for (const value of Object.values(en)) expect(value.trim()).not.toBe("");
  });

  it("fills placeholders and plurals", () => {
    expect(translator("es")("floor.review", { count: 1 })).toBe("Revisar 1 llegada");
    expect(translator("es")("floor.review", { count: 3 })).toBe("Revisar 3 llegadas");
    expect(translator("en")("floor.review", { count: 1 })).toBe("Review 1 arrival");
    expect(format("{a} y {b}", { a: 1 })).toBe("1 y {b}");
  });

  it("translates catalog text and keeps Spanish as the source", () => {
    const essential = catalog.packages.find((p) => p.id === "essential")!;
    expect(packageText(essential, "es", catalog)).toMatchObject({ name: "Essential Spa", subtitle: "Limpieza + acabado", tagline: "Un paso más allá" });
    expect(packageText(essential, "en", catalog).items[1]).toBe("Snow foam");
    const suv = catalog.vehicleClasses.find((v) => v.id === "suv")!;
    expect(className(suv, "es", catalog)).toBe("Camioneta / SUV");
    expect(className(suv, "en", catalog)).toBe("SUV");
  });

  it("matches the posted price sheet", () => {
    const prices = Object.fromEntries(catalog.packages.map((p) => [p.id, Object.values(p.prices)]));
    expect(prices).toEqual({ quick: [10, 12, 14, 16], essential: [15, 18, 21, 24], renew: [25, 30, 35, 40], supreme: [35, 40, 45, 50] });
  });

  it("names cameras and explains errors in the chosen language", () => {
    expect(cameraLabel("entrance-cam", translator("es"))).toBe("Entrada");
    expect(cameraLabel("bay2_cam", translator("es"))).toBe("Bahía 2");
    expect(cameraLabel("exit-cam", translator("en"))).toBe("Exit");
    expect(errorText(new ApiError(409, "Invalid job transition"), translator("es"))).toMatch(/^Alguien ya cambió esto/);
    expect(errorText(new TypeError("Failed to fetch"), translator("en"))).toMatch(/^Can't reach the server/);
  });

  it("switches language, remembers it, and sets <html lang>", async () => {
    function Probe() {
      const { t } = useI18n();
      return <p>{t("nav.board")}</p>;
    }
    const { unmount } = render(<I18nProvider><LanguageSwitch /><Probe /></I18nProvider>);
    expect(screen.getByText("Trabajos")).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("es");
    await userEvent.setup().click(screen.getByRole("radio", { name: "English" }));
    expect(screen.getByText("Jobs")).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("en");
    unmount();
    render(<I18nProvider><Probe /></I18nProvider>);
    expect(screen.getByText("Jobs")).toBeInTheDocument();
  });
});
