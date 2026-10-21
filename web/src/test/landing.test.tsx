import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Landing } from "../landing/Landing";

describe("Landing", () => {
  it("is in Spanish and sends visitors to the live demo", () => {
    const { container } = render(<Landing />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Cada carro, identificado por su placa.");
    const demoLinks = screen.getAllByRole("link", { name: /demo/i });
    expect(demoLinks.length).toBeGreaterThan(1);
    for (const link of demoLinks) expect(link).toHaveAttribute("href", "/app/?demo=1");
    const track = container.querySelector("video track");
    expect(track).toHaveAttribute("srclang", "es");
    expect(container.querySelector("video source")).toHaveAttribute("src", "/landing/video/como-funciona.mp4");
    for (const link of screen.getAllByRole("link", { name: /Registrar mi autolavado/ })) expect(link).toHaveAttribute("href", "/app/?registro=1");
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
});
