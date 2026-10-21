import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DemoApi } from "../lib/demo";
import { ReviewView } from "../views/Review";
import { BoardView } from "../views/Board";
import { renderWith } from "./render";

describe("ReviewView", () => {
  it("lets staff correct a misread plate and open the job (Spanish by default)", async () => {
    const api = new DemoApi();
    const [first] = await api.pendingArrivals();
    renderWith(api, <ReviewView />);
    const input = await screen.findByLabelText("Placa");
    expect(input).toHaveValue(first.plateCandidate);

    const user = userEvent.setup();
    await user.clear(input);
    await user.type(input, "zz-9876");
    await user.click(screen.getByRole("radio", { name: "XXL / Pickup" }));
    await user.click(screen.getByRole("radio", { name: /Supreme Spa/ }));
    expect(screen.getByText(/Incluye: Todo lo de Renew · Cera líquida/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Confirmar ZZ9876 y abrir trabajo · US\$50|Confirmar ZZ9876 y abrir trabajo · \$50/ }));

    await screen.findByText(/Trabajo abierto para ZZ9876 · Supreme Spa/);
    const jobs = await api.jobs();
    expect(jobs.find((j) => j.plate === "ZZ9876")).toMatchObject({ vehicleClass: "pickup", packageId: "supreme", priceUsd: 50 });
  });

  it("shows English when chosen, and blocks an invalid plate", async () => {
    renderWith(new DemoApi(), <ReviewView />, { locale: "en" });
    const user = userEvent.setup();
    const input = await screen.findByLabelText("Plate");
    await user.clear(input);
    await user.type(input, "a");
    await user.click(screen.getByRole("button", { name: /open job/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("3 to 12 letters or digits");
  });
});

describe("BoardView", () => {
  it("advances a job to the next stage", async () => {
    const api = new DemoApi();
    renderWith(api, <BoardView onTrack={() => {}} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /A la cola/ }));
    await waitFor(async () => {
      expect((await api.jobs()).find((j) => j.plate === "TX4410")?.status).toBe("queued");
    });
  });
});

describe("roles", () => {
  it("viewers can look but not act", async () => {
    const api = new DemoApi();
    renderWith(api, <ReviewView />, { role: "viewer" });
    expect(await screen.findByLabelText("Placa")).toHaveAttribute("readonly");
    expect(screen.queryByRole("button", { name: /abrir trabajo/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Descartar" })).not.toBeInTheDocument();
  });

  it("viewers see the board without move or cancel buttons", async () => {
    renderWith(new DemoApi(), <BoardView onTrack={() => {}} />, { role: "viewer" });
    await screen.findAllByText("Supreme Spa");
    expect(screen.queryByRole("button", { name: /A la cola/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancelar" })).not.toBeInTheDocument();
  });
});

describe("review fixes", () => {
  it("dismisses a false read with a reason", async () => {
    const api = new DemoApi();
    const [first] = await api.pendingArrivals();
    renderWith(api, <ReviewView />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Descartar" }));
    const group = screen.getByRole("group", { name: "¿Por qué descartar esta lectura?" });
    await user.click(within(group).getByRole("button", { name: "Vehículo del personal" }));
    await screen.findByText("Lectura descartada");
    expect((await api.pendingArrivals()).some((a) => a.id === first.id)).toBe(false);
  });

  it("keeps a confirmed arrival whose job failed, and lets staff finish it", async () => {
    const api = new DemoApi();
    const [first] = await api.pendingArrivals();
    await api.confirmArrival(first.id, "TX4410", "pickup"); // TX4410 already has an open job: opening will conflict
    await expect(api.openJob(first.id, "quick")).rejects.toMatchObject({ status: 409 });
    expect((await api.pendingArrivals()).some((a) => a.id === first.id)).toBe(true);

    renderWith(api, <ReviewView />);
    expect(await screen.findByText(/solo falta abrir el trabajo/)).toBeInTheDocument();
    expect(screen.getByLabelText("Placa")).toHaveValue("TX4410");
    expect(screen.getByLabelText("Placa")).toHaveAttribute("readonly");
    await userEvent.setup().click(screen.getByRole("button", { name: /Abrir trabajo · \$24/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Alguien ya cambió esto/);
    expect(screen.getByLabelText("Placa")).toHaveValue("TX4410"); // still on screen, with the reason
  });
});
