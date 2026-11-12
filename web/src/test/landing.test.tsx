import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DESKTOP_DOWNLOAD_URL, DESKTOP_RELEASES_URL, Landing, MANUAL_URL, SCENE_SLOTS } from "../landing/Landing";

describe("Landing", () => {
  it("is in Spanish and sends visitors to the live demo", () => {
    render(<Landing />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Cada auto sale como del showroom.");
    const demoLinks = screen.getAllByRole("link", { name: /demo/i });
    expect(demoLinks.length).toBeGreaterThan(1);
    for (const link of demoLinks) expect(link).toHaveAttribute("href", "/app/?demo=1");
    for (const link of screen.getAllByRole("link", { name: /Registrar mi autolavado/ })) expect(link).toHaveAttribute("href", "/app/?registro=1");
  });

  it("is branded Car Spa, with the logo in the header and the full lockup in the footer", () => {
    const { container } = render(<Landing />);
    const home = screen.getByRole("link", { name: "Car Spa, inicio" });
    expect(home.querySelector("img")).toHaveAttribute("src", "/brand/car-spa-mark-ondark.svg");
    expect(home).toHaveTextContent("Car Spa");
    expect(within(screen.getByRole("contentinfo")).getByRole("img", { name: "Car Spa — Automotive Care" }))
      .toHaveAttribute("src", "/brand/car-spa-logo-ondark.svg");
    expect(container.textContent).not.toMatch(/SparkleWash/);
  });

  it("has no video player and links to the desktop manual", () => {
    const { container } = render(<Landing />);
    expect(container.querySelector("video")).toBeNull();
    expect(container.innerHTML).not.toMatch(/\.mp4|landing\/video/);
    const manualLinks = screen.getAllByRole("link", { name: /manual/i });
    expect(manualLinks.length).toBeGreaterThanOrEqual(3);
    for (const link of manualLinks) expect(link).toHaveAttribute("href", "/manual/");
    expect(MANUAL_URL).toBe("/manual/");
    expect(within(screen.getByRole("navigation", { name: "Secciones" })).getByRole("link", { name: "Manual" })).toHaveAttribute("href", "/manual/");
    expect(within(screen.getByRole("contentinfo")).getByRole("link", { name: /Manual/ })).toHaveAttribute("href", "/manual/");
    expect(within(container.querySelector<HTMLElement>("section#escritorio")!).getByRole("link", { name: "Manual de uso" }))
      .toHaveAttribute("href", "/manual/");
  });

  it("mounts a live scene in every slot, with a static, accessible fallback until lazy scenes load", async () => {
    const { container } = render(<Landing />);
    expect(SCENE_SLOTS).toEqual(["hero", "how-it-works", "polish", "mobile", "desktop-ticket", "logo-intro"]);
    const slot = (name: string) => container.querySelector<HTMLElement>(`div[data-scene-slot="${name}"]`)!;
    for (const name of SCENE_SLOTS) {
      expect(container.querySelectorAll(`[data-scene-slot="${name}"]`), name).toHaveLength(1);
      expect(slot(name).childElementCount, name).toBeGreaterThan(0);
    }
    // The hero scene is part of the landing bundle: it renders immediately.
    expect(slot("hero").querySelector(".cs-m-hero")).not.toBeNull();
    // Lazy scenes show the static fallback first (also what a slow connection sees).
    const flow = within(slot("how-it-works")).getByRole("list", { name: "De la cámara al ticket" });
    expect(within(flow).getAllByRole("listitem")).toHaveLength(4);
    expect(container.querySelector("#como-funciona")).toContainElement(slot("how-it-works"));
    expect(within(slot("polish")).getByRole("img", { name: /Antes y después/ })).toBeInTheDocument();
    expect(container.querySelector("#app")).toContainElement(slot("mobile"));
    expect(within(slot("mobile")).getByRole("img", { name: /Revisión/ })).toHaveAttribute("src", "/landing/screens/revision-movil.jpg");
    expect(container.querySelector("section#escritorio")).toContainElement(slot("desktop-ticket"));
    expect(within(slot("desktop-ticket")).getByRole("img", { name: /ticket de trabajo/ })).toBeInTheDocument();
    expect(within(slot("logo-intro")).getByRole("img", { name: "Car Spa — Automotive Care" })).toHaveAttribute("src", "/brand/car-spa-logo-ondark.svg");
    // …then each lazy scene replaces its fallback.
    const live: Record<string, string> = {
      "how-it-works": ".cs-m-how", polish: ".cs-x-polish", mobile: ".cs-x-board", "desktop-ticket": ".cs-m-desk", "logo-intro": ".cs-x-logo",
    };
    for (const [name, selector] of Object.entries(live)) {
      await waitFor(() => expect(slot(name).querySelector(selector), name).not.toBeNull());
    }
    // No video file is embedded anywhere on the page.
    expect(container.querySelector("video")).toBeNull();
    // The polish band sits between "Cómo funciona" and the apps section.
    const order = [...container.querySelectorAll("main > section")].map((s) => s.id);
    expect(order.indexOf("detallado")).toBeGreaterThan(order.indexOf("como-funciona"));
    expect(order.indexOf("detallado")).toBeLessThan(order.indexOf("app"));
  });

  it("doesn't publish a price list", () => {
    render(<Landing />);
    expect(screen.queryByText("Paquetes de servicio")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Paquetes" })).not.toBeInTheDocument();
  });

  it("switches real console screens with tabs and arrow keys", async () => {
    render(<Landing />);
    const user = userEvent.setup();
    const tablist = screen.getByRole("tablist", { name: "Pantallas de la consola" });
    await user.click(within(tablist).getByRole("tab", { name: /Trabajos/ }));
    expect(screen.getByRole("img", { name: /Pantalla "Trabajos"/ })).toHaveAttribute("src", "/landing/screens/tablero.jpg");
    await user.keyboard("{ArrowRight}");
    expect(within(tablist).getByRole("tab", { name: /Placas/ })).toHaveAttribute("aria-selected", "true");
  });

  it("offers the Windows desktop installer", () => {
    const { container } = render(<Landing />);
    expect(DESKTOP_DOWNLOAD_URL).toBe("https://github.com/jorgeafc00h/sparkle-wash/releases/latest/download/SparkleWash-Setup-latest.exe");
    const download = screen.getByTestId("download-windows");
    expect(download).toHaveAttribute("href", DESKTOP_DOWNLOAD_URL);
    expect(download).toHaveTextContent("Descargar para Windows");
    expect(screen.getByRole("link", { name: "Todas las versiones" })).toHaveAttribute("href", "https://github.com/jorgeafc00h/sparkle-wash/releases");
    expect(DESKTOP_RELEASES_URL).toBe("https://github.com/jorgeafc00h/sparkle-wash/releases");
    expect(container.querySelector("section#escritorio")).toContainElement(download);
    expect(screen.getByRole("link", { name: "Escritorio" })).toHaveAttribute("href", "#escritorio");
    expect(screen.getByText(/Windows 10 u 11 \(64 bits\)/)).toBeInTheDocument();
    expect(screen.getByText(/Ejecutar de todas formas/)).toBeInTheDocument();
  });
});
