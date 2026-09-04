// @vitest-environment jsdom

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const ROADMAP_HTML = resolve(import.meta.dirname, "../../../docs/roadmap/index.html");

async function renderRoadmap(): Promise<void> {
  document.documentElement.innerHTML = await readFile(ROADMAP_HTML, "utf8");
  const script = document.querySelector("script:not([type])")?.textContent;
  if (script === undefined || script === null) throw new Error("generated roadmap has no executable script");
  window.eval(script);
}

describe("roadmap desktop interaction", () => {
  it("leaves node detail by clicking blank canvas space", async () => {
    await renderRoadmap();
    const node = document.querySelector<SVGAElement>(".nd[data-key]");
    const canvas = document.querySelector<HTMLElement>("#canvas-wrap");
    const title = document.querySelector<HTMLElement>("#drawer-title");

    expect(node).not.toBeNull();
    expect(canvas).not.toBeNull();
    expect(title?.textContent).toBe("How to read this roadmap");
    expect(document.querySelectorAll(".nd .state").length).toBe(document.querySelectorAll(".nd.item, .nd.phase").length);
    expect(document.querySelector("#drawer-body")?.textContent).toContain("Filled means built; outline means open");

    node?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(node?.classList.contains("sel")).toBe(true);
    expect(title?.textContent).not.toBe("How to read this roadmap");
    expect(document.querySelector(".nd.dim")).toBeNull();

    canvas?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(document.querySelector(".nd.sel")).toBeNull();
    expect(title?.textContent).toBe("How to read this roadmap");
    expect(window.location.hash).toBe("");
  });

  it("uses Escape to leave detail first and collapse the inspector second", async () => {
    await renderRoadmap();
    const node = document.querySelector<SVGAElement>(".nd[data-key]");
    const panel = document.querySelector<HTMLElement>("#drawer");
    const work = document.querySelector<HTMLElement>("#work");

    node?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(document.querySelector(".nd.sel")).toBeNull();
    expect(panel?.hidden).toBe(false);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(panel?.hidden).toBe(true);
    expect(work?.classList.contains("panel-closed")).toBe(true);
    expect(document.querySelector<HTMLButtonElement>("#about")?.getAttribute("aria-expanded")).toBe("false");
  });

  it("restores the guide after the inspector is collapsed", async () => {
    await renderRoadmap();
    const close = document.querySelector<HTMLButtonElement>("#drawer-close");
    const guide = document.querySelector<HTMLButtonElement>("#about");
    const panel = document.querySelector<HTMLElement>("#drawer");

    close?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(panel?.hidden).toBe(true);

    guide?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(panel?.hidden).toBe(false);
    expect(guide?.getAttribute("aria-pressed")).toBe("true");
    expect(guide?.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector("#drawer-title")?.textContent).toBe("How to read this roadmap");
  });
});
