import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { LogoIntroScene, MobileBoardScene, PolishScene } from "../index";

/* The stylesheets as text. Vitest runs with `css: false`, which empties even `?raw` CSS imports, so read the
   files from disk (non-literal specifier: the web tsconfig has no Node types). */
const FS = "node:fs";
let extraCss = "", logoCss = "", boardCss = "", polishCss = "";
beforeAll(async () => {
  const fs = await import(/* @vite-ignore */ FS);
  const folder = import.meta.url.split("?")[0].replace(/__tests__\/[^/]+$/, ""); // file:///…/motion/extra/
  const read = (name: string): string => fs.readFileSync(new URL(folder + name), "utf8");
  [extraCss, logoCss, boardCss, polishCss] = ["extra.css", "logo-intro.css", "mobile-board.css", "polish.css"].map(read);
});

/* ---------- browser API doubles (jsdom has neither matchMedia nor IntersectionObserver) ---------- */

function mockReducedMotion(reduce: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query.includes("prefers-reduced-motion: reduce"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

type Observed = { element: Element; callback: IntersectionObserverCallback };
let observed: Observed[] = [];

class FakeIntersectionObserver {
  constructor(private callback: IntersectionObserverCallback) {}
  observe(element: Element) { observed.push({ element, callback: this.callback }); }
  unobserve() {}
  disconnect() { observed = observed.filter((o) => o.callback !== this.callback); }
  takeRecords() { return []; }
}

/** Fire an intersection change for every observed element. */
function scrollScenes(visible: boolean) {
  act(() => {
    for (const { element, callback } of observed) {
      callback([{ target: element, isIntersecting: visible, intersectionRatio: visible ? 0.6 : 0 } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
    }
  });
}

const sceneRoot = (container: HTMLElement) => container.querySelector(".cs-x-scene") as HTMLElement;

beforeEach(() => {
  observed = [];
  mockReducedMotion(false);
});
afterEach(() => vi.unstubAllGlobals());

const LOOPING = [
  ["PolishScene", (locale?: "es" | "en") => <PolishScene locale={locale} />],
  ["MobileBoardScene", (locale?: "es" | "en") => <MobileBoardScene locale={locale} />],
] as const;

describe("extra scenes: reduced motion", () => {
  it("PolishScene shows the finished, glossy frame with every caption and no pause control", () => {
    mockReducedMotion(true);
    const { container } = render(<PolishScene />);
    const root = sceneRoot(container);
    expect(root).toHaveAttribute("data-motion", "reduced");
    expect(root).toHaveAttribute("data-play", "off");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    const steps = screen.getByRole("list", { name: "Etapas del detallado" });
    expect(within(steps).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["01Lavado", "02Pulido", "03Brillo de showroom"]);
  });

  it("MobileBoardScene shows the job done and unpaid", () => {
    mockReducedMotion(true);
    const { container } = render(<MobileBoardScene />);
    expect(sceneRoot(container)).toHaveAttribute("data-motion", "reduced");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    // The caption's chip is real text outside the decorative devices.
    const caption = container.querySelector("figcaption")!;
    expect(within(caption).getByText("Por cobrar")).toBeInTheDocument();
    expect(within(caption).getByRole("list", { name: "Estados del trabajo" })).toHaveTextContent("LlegóEn colaLavandoListo");
  });

  it("LogoIntroScene shows the assembled lockup", () => {
    mockReducedMotion(true);
    const { container } = render(<LogoIntroScene />);
    expect(screen.getByRole("img", { name: "Logotipo de Car Spa, Automotive Care" })).toHaveAttribute("data-motion", "reduced");
    // Every layer is the untouched lockup file; nothing is redrawn.
    const layers = container.querySelectorAll("img");
    expect(layers.length).toBe(7);
    for (const img of layers) {
      expect(img).toHaveAttribute("src", "/brand/car-spa-logo-ondark.svg");
      expect(img).toHaveAttribute("alt", "");
    }
  });

  it("the CSS has a still frame for prefers-reduced-motion as well as the data attribute", () => {
    expect(extraCss).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*animation: none !important/);
    expect(extraCss).toMatch(/\[data-motion="reduced"\][^{]*\{[^}]*animation: none !important/);
  });
});

describe("extra scenes: pause control", () => {
  for (const [name, make] of LOOPING) {
    it(`${name} pauses and resumes with a 44 px "Pausar animación" button`, async () => {
      const user = userEvent.setup();
      const { container } = render(make());
      const root = sceneRoot(container);
      expect(root).toHaveAttribute("data-play", "on"); // no IntersectionObserver: counts as visible
      await user.click(screen.getByRole("button", { name: "Pausar animación" }));
      expect(root).toHaveAttribute("data-play", "off");
      const resume = screen.getByRole("button", { name: "Reanudar animación" });
      expect(resume).toHaveClass("cs-x-pause");
      await user.click(resume);
      expect(root).toHaveAttribute("data-play", "on");
      expect(screen.getByRole("button", { name: "Pausar animación" })).toBeInTheDocument();
    });
  }

  it("the one-shot logo intro has no pause control (it lasts ≈ 3 s)", () => {
    render(<LogoIntroScene />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("the pause button is at least 44 px and freezes every animation", () => {
    expect(extraCss).toMatch(/\.cs-x-pause \{[^}]*min-height: 44px;[^}]*min-width: 44px;/);
    expect(extraCss).toMatch(/\[data-play="off"\] \*[\s\S]*?animation-play-state: paused !important/);
  });
});

describe("extra scenes: offscreen pause (IntersectionObserver)", () => {
  beforeEach(() => vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver));

  for (const [name, make] of [...LOOPING, ["LogoIntroScene", () => <LogoIntroScene />]] as const) {
    it(`${name} plays only while on screen`, () => {
      const { container } = render(make());
      const root = sceneRoot(container);
      expect(root).toHaveAttribute("data-play", "off"); // not seen yet: frozen on its first frame
      scrollScenes(true);
      expect(root).toHaveAttribute("data-play", "on");
      scrollScenes(false);
      expect(root).toHaveAttribute("data-play", "off");
      scrollScenes(true);
      expect(root).toHaveAttribute("data-play", "on");
    });
  }

  it("a paused scene stays paused when it scrolls back into view", async () => {
    const user = userEvent.setup();
    const { container } = render(<PolishScene />);
    scrollScenes(true);
    await user.click(screen.getByRole("button", { name: "Pausar animación" }));
    scrollScenes(false);
    scrollScenes(true);
    expect(sceneRoot(container)).toHaveAttribute("data-play", "off");
  });
});

describe("extra scenes: Spanish and English", () => {
  it("PolishScene", () => {
    const { unmount } = render(<PolishScene />);
    expect(screen.getByText("Lavado")).toBeInTheDocument();
    expect(screen.getByText("Pulido")).toBeInTheDocument();
    expect(screen.getByText("Brillo de showroom")).toBeInTheDocument();
    expect(screen.getByText(/pasa de opaco y empolvado a un brillo profundo/)).toBeInTheDocument();
    unmount();
    render(<PolishScene locale="en" />);
    expect(screen.getByRole("list", { name: "Detailing stages" })).toHaveTextContent("01Wash02Polish03Showroom shine");
    expect(screen.getByRole("button", { name: "Pause animation" })).toBeInTheDocument();
    expect(screen.queryByText("Lavado")).not.toBeInTheDocument();
  });

  it("MobileBoardScene", () => {
    const { container, unmount } = render(<MobileBoardScene />);
    expect(within(container.querySelector("figcaption")!).getByText(/a la vez en la tablet y en el teléfono/)).toBeInTheDocument();
    unmount();
    const en = render(<MobileBoardScene locale="en" />);
    const caption = en.container.querySelector("figcaption")!;
    expect(within(caption).getByRole("list", { name: "Job states" })).toHaveTextContent("ArrivedQueuedWashingDone");
    expect(within(caption).getByText("Unpaid")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pause animation" })).toBeInTheDocument();
  });

  it("LogoIntroScene", () => {
    const { unmount } = render(<LogoIntroScene />);
    expect(screen.getByRole("img", { name: "Logotipo de Car Spa, Automotive Care" })).toBeInTheDocument();
    unmount();
    render(<LogoIntroScene locale="en" tone="light" />);
    const logo = screen.getByRole("img", { name: "Car Spa logo, Automotive Care" });
    expect(logo.querySelector("img")).toHaveAttribute("src", "/brand/car-spa-logo.svg");
  });
});

describe("extra scenes: markup and motion rules", () => {
  it("decorative art is hidden from assistive tech and each scene is a figure with a caption", () => {
    const { container } = render(<><PolishScene /><MobileBoardScene /></>);
    for (const figure of container.querySelectorAll("figure")) expect(figure.querySelector("figcaption")).not.toBeNull();
    for (const svg of container.querySelectorAll("svg")) expect(svg.closest('[aria-hidden="true"]')).not.toBeNull();
    for (const img of container.querySelectorAll("img")) expect(img).toHaveAttribute("alt", "");
  });

  it("scene class names use the cs-x- prefix (cs-m- belongs to W2's MuscleCar)", () => {
    const { container } = render(<><PolishScene /><MobileBoardScene /><LogoIntroScene /></>);
    for (const el of container.querySelectorAll("[class]")) {
      for (const name of (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean)) expect(name).toMatch(/^cs-(x|m)-/);
    }
  });

  it("keyframes animate only transform and opacity", () => {
    let blocks = 0;
    for (const source of [extraCss, logoCss, boardCss, polishCss]) {
      const css = source.replace(/\/\*[\s\S]*?\*\//g, "");
      for (const block of css.matchAll(/@keyframes\s+([\w-]+)\s*\{([\s\S]*?)\n\}/g)) {
        expect(block[1]).toMatch(/^cs-x-/);
        const properties = [...block[2].matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
        expect(properties.length).toBeGreaterThan(0);
        for (const property of properties) expect(["transform", "opacity", "animation-timing-function"]).toContain(property);
        blocks++;
      }
    }
    expect(blocks).toBeGreaterThan(30); // the guard really parsed the stylesheets
  });
});
