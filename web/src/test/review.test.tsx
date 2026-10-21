import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ApiProvider, ToastProvider } from "../lib/context";
import { DemoApi } from "../lib/demo";
import { ReviewView } from "../views/Review";
import { BoardView } from "../views/Board";

function renderWith(api: DemoApi, ui: React.ReactNode) {
  return render(<ToastProvider><ApiProvider api={api}>{ui}</ApiProvider></ToastProvider>);
}

describe("ReviewView", () => {
  it("lets staff correct a misread plate and open the job", async () => {
    const api = new DemoApi();
    const [first] = await api.pendingArrivals();
    renderWith(api, <ReviewView />);
    const input = await screen.findByLabelText("Plate");
    expect(input).toHaveValue(first.plateCandidate);

    const user = userEvent.setup();
    await user.clear(input);
    await user.type(input, "zz-9876");
    await user.click(screen.getByRole("radio", { name: "Pickup" }));
    await user.click(screen.getByRole("radio", { name: /Supreme Ceramic/ }));
    await user.click(screen.getByRole("button", { name: /Confirm ZZ9876 & open job · \$90/ }));

    await screen.findByText(/Job opened for ZZ9876 · Supreme Ceramic/);
    const jobs = await api.jobs();
    expect(jobs.find((j) => j.plate === "ZZ9876")).toMatchObject({ vehicleClass: "pickup", packageId: "supreme", priceUsd: 90 });
  });

  it("blocks an invalid plate with a clear message", async () => {
    renderWith(new DemoApi(), <ReviewView />);
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
    await user.click(await screen.findByRole("button", { name: /Queue/ }));
    await waitFor(async () => {
      expect((await api.jobs()).find((j) => j.plate === "TX4410")?.status).toBe("queued");
    });
  });
});
