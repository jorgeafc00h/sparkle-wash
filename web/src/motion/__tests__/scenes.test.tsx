import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentType } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopTicketScene, HeroScene, HowItWorksScene, SCENE_COPY, type SceneLang } from "../index";

/* The real stylesheets as text. Vitest runs with `css: false`, which empties CSS imports (even `?raw`), so read
   them from disk. The module name is a variable so TypeScript doesn't need Node's types for this one call. */
const SCENE_CSS_FILES = ["scene-base.css", "art/muscle-car.css", "art/parts.css", "hero-scene.css", "how-it-works-scene.css", "desktop-ticket-scene.css"];
let sceneCss = "";
beforeAll(async () => {
  const FS = "node:fs";
  const fs = (await import(/* @vite-ignore */ FS)) as { readFileSync(path: string, encoding: "utf8"): string };
  // A path string, not a URL object (under jsdom `URL` is jsdom's class, which Node's fs rejects). The base goes
  // through a variable because Vite rewrites `new URL(`…${x}`, import.meta.url)` into an asset glob lookup.
  const base = import.meta.url;
  const path = (file: string) => decodeURIComponent(new URL("../" + file, base).pathname);
  sceneCss = SCENE_CSS_FILES.map((file) => fs.readFileSync(path(file), "utf8")).join("\n");
});

/* ---------- browser API doubles ---------- */

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  readonly elements = new Set<Element>();
  constructor(private readonly callback: IntersectionObserverCallback) {
    MockIntersectionObserver.instances.push(this);
  }
  observe(element: Element) { this.elements.add(element); }
  unobserve(element: Element) { this.elements.delete(element); }
  disconnect() { this.elements.clear(); }
  takeRecords() { return []; }
  /** Report every observed element as (not) intersecting at the given ratio. */
  fire(isIntersecting: boolean, intersectionRatio: number) {
    const entries = [...this.elements].map((target) => ({ target, isIntersecting, intersectionRatio }) as unknown as IntersectionObserverEntry);
    act(() => this.callback(entries, this as unknown as IntersectionObserver));
  }
}

function observerOf(element: Element) {
  const observer = MockIntersectionObserver.instances.find((o) => o.elements.has(element));
  if (!observer) throw new Error("scene root is not observed");
  return observer;
}

function stubReducedMotion(reduced: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduced && query.includes("prefers-reduced-motion: reduce"),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

/** jsdom ignores imported CSS (vitest css: false), so load the real scene stylesheets to check computed styles. */
function injectSceneCss() {
  expect(sceneCss.length).toBeGreaterThan(5000);
  const style = document.createElement("style");
  style.dataset.test = "motion";
  style.textContent = sceneCss;
  document.head.appendChild(style);
}

function animationsOf(root: Element) {
  return [root, ...root.querySelectorAll("*")].map((el) => {
    const cs = getComputedStyle(el);
    return { el, animation: cs.animation, name: cs.animationName };
  });
}
const declaresAnimation = (a: { animation: string; name: string }) =>
  (a.animation !== "" && a.animation !== "none") || (a.name !== "" && a.name !== "none");

type SceneCase = {
  name: string;
  Scene: ComponentType<{ lang?: SceneLang }>;
  loops: boolean;
  label: (lang: SceneLang) => string;
  captions: (lang: SceneLang) => string[];
};
const SCENES: SceneCase[] = [
  { name: "HeroScene", Scene: HeroScene, loops: true, label: (l) => SCENE_COPY[l].hero.caption, captions: (l) => [SCENE_COPY[l].hero.caption] },
  { name: "HowItWorksScene", Scene: HowItWorksScene, loops: false, label: (l) => SCENE_COPY[l].how.title, captions: (l) => [...SCENE_COPY[l].how.steps] },
  { name: "DesktopTicketScene", Scene: DesktopTicketScene, loops: false, label: (l) => SCENE_COPY[l].desk.title, captions: (l) => [...SCENE_COPY[l].desk.steps] },
];
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const figureOf = (container: HTMLElement) => container.querySelector("figure.cs-m-scene") as HTMLElement;

beforeEach(() => {
  MockIntersectionObserver.instances = [];
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
  stubReducedMotion(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.head.querySelectorAll('style[data-test="motion"]').forEach((s) => s.remove());
});

describe.each(SCENES)("$name", ({ Scene, loops, label, captions }) => {
  it("plays only while the IntersectionObserver reports it in view", () => {
    const { container } = render(<Scene />);
    const figure = figureOf(container);
    expect(figure).toHaveAttribute("data-playing", "false");
    const observer = observerOf(figure);

    observer.fire(true, 0.05); // barely visible: not enough to start
    expect(figure).toHaveAttribute("data-playing", "false");
    observer.fire(true, 0.6);
    expect(figure).toHaveAttribute("data-playing", "true");
    observer.fire(true, 0.1); // still partly visible: keeps playing
    expect(figure).toHaveAttribute("data-playing", "true");
    observer.fire(false, 0);
    expect(figure).toHaveAttribute("data-playing", "false");
  });

  it("has a 44 px pause control that toggles data-paused", async () => {
    const user = userEvent.setup();
    const { container } = render(<Scene />);
    const figure = figureOf(container);
    observerOf(figure).fire(true, 1);

    const pause = screen.getByRole("button", { name: "Pausar animación" });
    expect(pause).toHaveClass("cs-m-toggle");
    expect(figure).toHaveAttribute("data-paused", "false");
    await user.click(pause);
    expect(figure).toHaveAttribute("data-paused", "true");
    const resume = screen.getByRole("button", { name: "Reanudar animación" });
    expect(resume).toBe(pause); // same element: keyboard focus stays put
    resume.focus();
    await user.keyboard("{Enter}");
    expect(figure).toHaveAttribute("data-paused", "false");
    expect(screen.getByRole("button", { name: "Pausar animación" })).toHaveFocus();
  });

  it.each(["es", "en"] as const)("renders its captions as real text in %s", (lang) => {
    const { container } = render(<Scene lang={lang} />);
    const figure = figureOf(container);
    expect(figure).toHaveAttribute("lang", lang);
    const caption = figure.querySelector("figcaption")!;
    for (const text of captions(lang)) expect(within(caption).getByText(text)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: SCENE_COPY[lang].pause })).toBeInTheDocument();
    // Decorative art is hidden from assistive tech; the figure is named by its caption.
    expect(figure.querySelector(".cs-m-hero__stage, .cs-m-how__stage, .cs-m-desk__stage")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("figure", { name: new RegExp(`^${escape(label(lang))}`) })).toBe(figure);
  });

  it("declares CSS animations when motion is allowed (so the reduced-motion check below is meaningful)", () => {
    injectSceneCss();
    const { container } = render(<Scene />);
    expect(animationsOf(figureOf(container)).filter(declaresAnimation).length).toBeGreaterThan(3);
  });

  it("under prefers-reduced-motion runs no animation, shows every caption and drops the pause control", () => {
    stubReducedMotion(true);
    injectSceneCss();
    const { container } = render(<Scene />);
    const figure = figureOf(container);
    observerOf(figure).fire(true, 1);

    expect(figure).toHaveAttribute("data-reduced", "true");
    expect(figure).toHaveAttribute("data-playing", "false");
    // jsdom's getComputedStyle cascades by source order only (no specificity, no !important), so assert the CSS
    // guarantee directly: every element is matched by a reduced-motion rule with `animation: none !important`,
    // and nothing else in the scene CSS uses !important on animation. (Playwright checks the real browser.)
    const rules = [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules]).filter((r): r is CSSStyleRule => "selectorText" in r);
    const killers = rules.filter(
      (r) => r.selectorText.includes('[data-reduced="true"]') && r.style.getPropertyValue("animation") === "none" && r.style.getPropertyPriority("animation") === "important",
    );
    expect(killers.length).toBeGreaterThan(0);
    const props = (r: CSSStyleRule) => Array.from({ length: r.style.length }, (_, i) => r.style[i]);
    const others = rules.filter(
      (r) => !killers.includes(r) && props(r).some((p) => p.startsWith("animation") && p !== "animation-play-state" && r.style.getPropertyPriority(p) === "important"),
    );
    expect(others.map((r) => r.selectorText)).toEqual([]);
    const uncovered = [...figure.querySelectorAll("*")].filter((el) => !killers.some((r) => el.matches(r.selectorText)));
    expect(uncovered.map((el) => el.className)).toEqual([]);
    expect(animationsOf(figure).filter(declaresAnimation).length).toBeGreaterThan(0); // there was something to stop
    for (const text of captions("es")) expect(screen.getByText(text)).toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  if (!loops) {
    it("plays once: when its timeline ends it offers a replay that restarts it", async () => {
      const user = userEvent.setup();
      const { container } = render(<Scene />);
      const figure = figureOf(container);
      observerOf(figure).fire(true, 1);

      fireEvent.animationEnd(figure.querySelector(".cs-m-clock")!);
      expect(figure).toHaveAttribute("data-ended", "true");
      const stageBefore = figure.querySelector("[aria-hidden='true']");
      await user.click(screen.getByRole("button", { name: "Repetir animación" }));
      expect(figure).toHaveAttribute("data-ended", "false");
      expect(figure).toHaveAttribute("data-paused", "false");
      expect(figure.querySelector("[aria-hidden='true']")).not.toBe(stageBefore); // remounted: CSS timeline restarts
      expect(screen.getByRole("button", { name: "Pausar animación" })).toBeInTheDocument();
    });

    it("ignores animationend events that bubble up from other elements", () => {
      const { container } = render(<Scene />);
      const figure = figureOf(container);
      fireEvent.animationEnd(figure.querySelector(".cs-m-rail__fill")!);
      expect(figure).toHaveAttribute("data-ended", "false");
    });
  }
});

describe("HowItWorksScene", () => {
  it("frames the real console screenshots, with phone captures for small screens", () => {
    const { container } = render(<HowItWorksScene />);
    const sources = [...container.querySelectorAll("img")].map((img) => img.getAttribute("src"));
    expect(sources).toEqual(expect.arrayContaining(["/landing/screens/revision.jpg", "/landing/screens/tablero.jpg"]));
    const phone = [...container.querySelectorAll("source")].map((s) => [s.getAttribute("media"), s.getAttribute("srcset")]);
    expect(phone).toEqual([
      ["(max-width: 640px)", "/landing/screens/revision-movil.jpg"],
      ["(max-width: 640px)", "/landing/screens/tablero-movil.jpg"],
    ]);
    for (const img of container.querySelectorAll("img")) expect(img).toHaveAttribute("loading", "lazy");
  });

  it("lists the four steps in order and prints work ticket OT-C1-000045 without a price", () => {
    const { container } = render(<HowItWorksScene lang="en" />);
    const steps = within(container.querySelector("figcaption")!).getAllByRole("listitem");
    expect(steps.map((li) => li.textContent)).toEqual(SCENE_COPY.en.how.steps.map((s, i) => `${i + 1}${s}`));
    expect(container.querySelector(".cs-m-ticket")).toHaveTextContent("OT-C1-000045");
    expect(container.querySelector(".cs-m-ticket")?.textContent).not.toMatch(/\$|USD/);
  });
});

describe("DesktopTicketScene", () => {
  it("ends live and synced: the final frame is the informative one", () => {
    stubReducedMotion(true);
    const { container } = render(<DesktopTicketScene />);
    expect(container.querySelector(".cs-m-desk__s-live")).toHaveTextContent("En vivo");
    expect(container.querySelector(".cs-m-desk__st-synced")).toHaveTextContent("Sincronizado");
    expect(container.querySelector(".cs-m-ticket")).toHaveTextContent("OT-C1-000045");
  });
});
