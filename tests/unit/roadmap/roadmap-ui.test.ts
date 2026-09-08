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
  it("gives every subtask a deterministic hierarchical name", async () => {
    await renderRoadmap();

    const code = (key: string): string | null => document.querySelector(`.nd[data-key="${key}"] .task-code`)?.textContent ?? null;
    expect(code("dash-defaults")).toBe("3.1");
    expect(code("track-b")).toBe("3.1.1");
    expect(code("dash-boundary-foundation")).toBe("3.1.9");
    expect(code("dash-shell")).toBe("3.1.9.1");
    expect(code("dash-settings")).toBe("3.1.9.2");
    expect(code("dash-storage")).toBe("3.1.9.3");
    expect(code("dash-explorer")).toBe("3.1.9.4");
    expect(code("dash-sessions")).toBe("3.1.11");
    expect(code("dash-setup")).toBe("3.1.11.1");
    expect(code("dash-detail-foundation")).toBe("3.1.14");
    expect(code("dash-gates")).toBe("3.1.14.5");
    expect(code("workflow-authoring-core")).toBe("3.2.1");
    expect(code("workflow-guide-proof")).toBe("3.2.3.2");
    expect(code("workflow-acceptance-foundation")).toBe("3.2.4");
    expect(code("separations-compiled-acceptance")).toBe("3.2.4.2");
    expect(code("claude-mcp")).toBe("3.5.2");
    expect(code("claude-monitor")).toBe("3.5.2.1");
    expect(code("claude-clients")).toBe("3.5.2.2");
    expect(code("claude-proof")).toBe("3.5.3");
    expect(code("def-byte-path")).toBe("5A.1");

    const node = document.querySelector<SVGAElement>('.nd[data-key="track-b"]');
    expect(node?.getAttribute("href")).toBe("#track-b");
    expect(node?.getAttribute("aria-label")).toMatch(/^3\.1\.1, Build the shared dashboard surfaces,/);
    node?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(document.querySelector("#drawer-title")?.textContent).toBe("3.1.1 · Build the shared dashboard surfaces");
    document.querySelector("#canvas-wrap")?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });

  it("leaves node detail by clicking blank canvas space", async () => {
    await renderRoadmap();
    const node = document.querySelector<SVGAElement>(".nd[data-key]");
    const canvas = document.querySelector<HTMLElement>("#canvas-wrap");
    const title = document.querySelector<HTMLElement>("#drawer-title");

    expect(node).not.toBeNull();
    expect(canvas).not.toBeNull();
    expect(title?.textContent).toBe("How to read this roadmap");
    expect(document.querySelectorAll(".nd .state").length).toBe(document.querySelectorAll(".nd.item, .nd.phase").length);
    expect(document.querySelector("#drawer-body")?.textContent).not.toContain("Each square is one planned output");
    expect(document.querySelector("#drawer-body")?.textContent).toContain("Outputs landed at the roadmap's recorded HEAD");
    expect(document.querySelector("#drawer-body")?.textContent).toContain("3.1.1 is serial task 1 inside part 3.1");
    expect(document.querySelector("#drawer-body")?.textContent).toContain(
      "3.1.9 is a prerequisite task: complete and merge it before its independent parallel children 3.1.9.1 and 3.1.9.2 start",
    );

    expect(document.querySelector("#drawer-body")?.textContent).toContain(
      "agents work independently and coordinate when necessary",
    );

    node?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(node?.classList.contains("sel")).toBe(true);
    expect(title?.textContent).not.toBe("How to read this roadmap");
    expect(document.querySelector(".nd.dim")).toBeNull();

    canvas?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(document.querySelector(".nd.sel")).toBeNull();
    expect(title?.textContent).toBe("How to read this roadmap");
    expect(window.location.hash).toBe("");
  });

  it("keeps compact node cards free of feature squares and deferred records", async () => {
    await renderRoadmap();

    expect(document.querySelector(".fq")).toBeNull();
    expect(document.querySelector(".feature-sample")).toBeNull();
    expect(document.querySelector(".nd.never")).toBeNull();
    expect(document.querySelector('.nd[data-key="phase-2-7"]')).toBeNull();
    expect(document.querySelector('.nd[data-key="def-sanity-check"]')).toBeNull();
    expect(document.querySelector('.nd[data-key="def-retention"]')).toBeNull();
    expect(document.querySelector('.nd[data-key="later-unplanned"]')).toBeNull();
    expect(document.querySelector('.nd[data-key="dash-defaults"] .meta')?.textContent).toBe("XL · 1 / 26 built");
    expect(document.querySelector('.nd[data-key="dash-defaults"] .tt')?.textContent).toBe("Shared dashboard");
  });

  it("uses one bounded status row on phase cards", async () => {
    await renderRoadmap();

    for (const phase of document.querySelectorAll(".nd.phase")) {
      expect(phase.querySelectorAll(".state")).toHaveLength(1);
      expect(phase.querySelector(".pc")).toBeNull();
      const eyebrow = phase.querySelector(".eb")?.textContent ?? "";
      expect(eyebrow.length).toBeLessThanOrEqual(37);
    }
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
