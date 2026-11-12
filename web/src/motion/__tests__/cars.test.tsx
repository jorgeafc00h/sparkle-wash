import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MuscleCar, MuscleCarFront, MUSCLE_CAR_VIEWBOX, MUSCLE_CAR_WHEELS } from "../index";

const ids = (root: Element) => [...root.querySelectorAll("[id]")].map((el) => el.id);
const refs = (root: Element) =>
  [...root.querySelectorAll("*")]
    .flatMap((el) => ["fill", "stroke", "clip-path"].map((a) => el.getAttribute(a) ?? ""))
    .filter((v) => v.startsWith("url(#"))
    .map((v) => v.slice(5, -1));

describe("MuscleCar", () => {
  it("is decorative, sized by prop, and exposes the class hooks scenes animate", () => {
    const { container } = render(<MuscleCar size={240} wheelsTurning className="extra" />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("width", "240");
    expect(svg).toHaveAttribute("viewBox", `0 0 ${MUSCLE_CAR_VIEWBOX.width} ${MUSCLE_CAR_VIEWBOX.height}`);
    expect(svg).toHaveClass("cs-m-car", "cs-m-car--turning", "extra");
    expect(svg.querySelectorAll(".cs-m-car__spin")).toHaveLength(MUSCLE_CAR_WHEELS.length);
    for (const hook of [".cs-m-car__body", ".cs-m-car__sweep", ".cs-m-car__shadow"]) expect(svg.querySelector(hook)).not.toBeNull();
    expect(svg.textContent).toBe(""); // no lettering, names or badges
  });

  it("scopes its gradients so several cars can share a page", () => {
    const { container } = render(<><MuscleCar /><MuscleCar size="50%" /></>);
    const [a, b] = container.querySelectorAll("svg");
    expect(ids(a).filter((id) => ids(b).includes(id))).toEqual([]);
    for (const svg of [a, b]) for (const ref of refs(svg)) expect(ids(svg)).toContain(ref);
    expect(b.style.width).toBe("50%");
  });
});

describe("MuscleCarFront", () => {
  it("conceals the headlights by default and opens them with headlights='on'", () => {
    const { container, rerender } = render(<MuscleCarFront />);
    const svg = () => container.querySelector("svg")!;
    expect(svg()).toHaveAttribute("aria-hidden", "true");
    expect(svg()).not.toHaveClass("cs-m-front--on");
    expect(svg().querySelectorAll(".cs-m-front__lamp")).toHaveLength(2);
    expect(svg().querySelectorAll(".cs-m-front__door")).toHaveLength(2);
    for (const hook of [".cs-m-front__grille", ".cs-m-front__sweep"]) expect(svg().querySelector(hook)).not.toBeNull();
    rerender(<MuscleCarFront headlights="on" size={160} />);
    expect(svg()).toHaveClass("cs-m-front--on");
    expect(svg()).toHaveAttribute("width", "160");
    for (const ref of refs(svg())) expect(ids(svg())).toContain(ref);
    expect(svg().textContent).toBe("");
  });
});
