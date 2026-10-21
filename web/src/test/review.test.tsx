import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ApiProvider, ToastProvider } from "../lib/context";
import { DemoApi } from "../lib/demo";
import { I18nProvider, type Locale } from "../i18n";
import { ReviewView } from "../views/Review";
import { BoardView } from "../views/Board";

function renderWith(api: DemoApi, ui: React.ReactNode, locale?: Locale) {
  return render(<I18nProvider initial={locale}><ToastProvider><ApiProvider api={api}>{ui}</ApiProvider></ToastProvider></I18nProvider>);
}

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
    renderWith(new DemoApi(), <ReviewView />, "en");
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
