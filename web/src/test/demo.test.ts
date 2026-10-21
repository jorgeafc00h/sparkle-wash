import { describe, expect, it } from "vitest";
import { DemoApi } from "../lib/demo";
import { entriesFor } from "../views/Plates";

describe("DemoApi plate tracking", () => {
  it("confirms an arrival, opens a job, and links later sightings to it", async () => {
    const api = new DemoApi();
    const [arrival] = await api.pendingArrivals();
    const plate = arrival.plateCandidate!;
    await api.confirmArrival(arrival.id, plate, "suv");
    const job = await api.openJob(arrival.id, "renew");
    expect(job).toMatchObject({ plate, status: "arrived", priceUsd: 30 });
    expect((await api.pendingArrivals()).some((a) => a.id === arrival.id)).toBe(false);
    await expect(api.openJob(arrival.id, "renew")).rejects.toMatchObject({ status: 409 });

    await api.transitionJob(job.id, "queued");
    await expect(api.transitionJob(job.id, "completed")).rejects.toMatchObject({ status: 409 });
    for (let i = 0; i < 40; i++) api.tick();

    const timeline = await api.plateTimeline(plate.toLowerCase());
    expect(timeline.openJob?.id).toBe(job.id);
    expect(timeline.sightings.every((s) => s.plateCandidate === plate || s.confirmedPlate === plate)).toBe(true);
    const entries = entriesFor(timeline);
    expect(entries.some((e) => e.kind === "status" && e.status === "queued")).toBe(true);
    expect([...entries].map((e) => e.at)).toEqual([...entries].map((e) => e.at).sort().reverse());
  });

  it("rejects bad plates and classes", async () => {
    const api = new DemoApi();
    const [arrival] = await api.pendingArrivals();
    await expect(api.confirmArrival(arrival.id, "!", "car")).rejects.toMatchObject({ status: 400 });
    await expect(api.confirmArrival(arrival.id, "ABC123", "bus")).rejects.toMatchObject({ status: 400 });
    await expect(api.plateTimeline("x")).rejects.toMatchObject({ status: 400 });
  });

  it("keeps the review queue short", async () => {
    const api = new DemoApi();
    for (let i = 0; i < 200; i++) api.tick();
    expect((await api.pendingArrivals()).length).toBeLessThanOrEqual(4);
  });
});
