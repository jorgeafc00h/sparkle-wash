import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { chapters, chaptersByGroup } from "../chapters";
import { Manual } from "../Manual";

const files = new Set(Object.keys(import.meta.glob("../../../public/manual/img/*.webp")).map((f) => f.split("/").pop()));
const carspa = chapters.filter((c) => c.group === "Car Spa");

function imagesOf(list = chapters) {
  const out: Array<{ chapter: string; src: string; alt?: string }> = [];
  for (const c of list) {
    for (const s of c.sections) if (s.figure) out.push({ chapter: c.id, src: s.figure.src, alt: s.figure.alt });
    if (c.walkthrough) {
      out.push({ chapter: c.id, src: c.walkthrough.image, alt: "walkthrough" });
      for (const st of c.walkthrough.steps) if (st.image) out.push({ chapter: c.id, src: st.image, alt: "walkthrough" });
    }
  }
  return out;
}

describe("manual chapters", () => {
  it("has the nine Car Spa chapters with unique ids and sorted order", () => {
    expect(carspa.length).toBe(9);
    const ids = chapters.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(chapters.map((c) => c.order)).toEqual([...chapters.map((c) => c.order)].sort((a, b) => a - b));
    for (const c of carspa) {
      expect(c.order).toBeGreaterThanOrEqual(100);
      expect(c.order).toBeLessThan(200);
      expect(c.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("every image has alt text and an existing file", () => {
    for (const c of chapters) {
      for (const s of c.sections) if (s.figure) expect(s.figure.alt.trim().length, `${c.id} ${s.figure.src}`).toBeGreaterThan(8);
    }
    for (const img of imagesOf()) {
      expect(img.src.startsWith("/manual/img/"), img.src).toBe(true);
      expect(files.has(img.src.split("/").pop()), `${img.chapter}: ${img.src}`).toBe(true);
    }
  });

  it("section ids are unique inside a chapter and walkthrough steps are well-formed", () => {
    for (const c of chapters) {
      const ids = c.sections.map((s) => s.id);
      expect(new Set(ids).size, c.id).toBe(ids.length);
      for (const s of c.walkthrough?.steps ?? []) {
        expect(s.dur).toBeGreaterThan(0);
        expect(s.caption.length).toBeGreaterThan(3);
        for (const b of [s.highlight, s.zoom]) if (b) {
          expect(b.x + b.w).toBeLessThanOrEqual(100.5);
          expect(b.y + b.h).toBeLessThanOrEqual(100.5);
        }
      }
    }
    for (const c of carspa) expect(c.walkthrough, c.id).toBeTruthy();
  });
});

describe("<Manual />", () => {
  it("table of contents links match chapter ids and every chapter is rendered", () => {
    const { container } = render(<Manual />);
    const nav = screen.getByRole("navigation", { name: "Contenido del manual" });
    const hrefs = Array.from(nav.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(chapters.map((c) => `#${c.id}`));
    for (const c of chapters) expect(container.querySelector(`article#${c.id}`), c.id).not.toBeNull();
    expect(chaptersByGroup().map((g) => g.group)[0]).toBe("Car Spa");
  });

  it("has a skip link, one h1, header links and alt text on every rendered image", () => {
    const { container } = render(<Manual />);
    expect(screen.getByRole("link", { name: /Saltar al contenido/ })).toHaveAttribute("href", "#contenido");
    expect(container.querySelectorAll("h1").length).toBe(1);
    expect(screen.getByRole("link", { name: /Abrir la consola/ })).toHaveAttribute("href", "/app/");
    expect(container.querySelector('a[href="/"] img')).toHaveAttribute("src", "/brand/car-spa-mark-ondark.svg");
    container.querySelectorAll("img").forEach((img) => expect(img.hasAttribute("alt")).toBe(true));
  });
});
