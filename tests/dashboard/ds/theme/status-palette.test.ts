import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe,it } from "vitest";

const THEME = resolve(import.meta.dirname, "../../../../src/dashboard/ds/theme");
const tokens = readFileSync(resolve(THEME, "tokens.css"), "utf8");
const theme = readFileSync(resolve(THEME, "dashboard-theme.css"), "utf8");

function block(css: string, opener: string): string {
  const start = css.indexOf(opener);
  assert.ok(start >= 0, `${opener} block missing`);
  return css.slice(start, css.indexOf("\n}\n", start));
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

function ui(css: string, opener: string): Record<string, string> {
  return Object.fromEntries(
    [...block(css, opener).matchAll(/--ui-([a-z-]+):\s*(#[0-9a-f]{6})/gu)].map((m) => [m[1] ?? "", m[2] ?? ""]),
  );
}

describe("dashboard status palette", () => {
  for (const mode of ["dark", "light"] as const) {
    it(`${mode} theme holds no second status palette`, () => {
      const css = block(tokens, `body[data-demo-theme="${mode}"]`);
      const literals = css
        .split("\n")
        .filter((line) => /--ds-(?:danger|status-|info-|success-)/u.test(line))
        .filter((line) => /#[0-9a-f]{6}/iu.test(line) && !/(?:-solid-fg|-fg|-bg|-hover):\s*#/u.test(line) && !/solid-hover/u.test(line) && !/cancelled|queued|running/u.test(line));
      assert.deepEqual(literals, []);
    });
  }

  it("keeps informative text at 4.5:1 on every surface", () => {
    const surfaces: Record<string, string[]> = {
      light: ["#f9f9f9", "#fdfdfd", "#f6f6f6", "#efefef", "#e9e9e9", "#ffffff"],
      dark: ["#0f0f11", "#18181b", "#1f1f23", "#222226", "#2a2a2f"],
    };
    for (const mode of ["light", "dark"] as const) {
      const colors = ui(theme, mode === "light" ? ":root, [data-demo-theme=\"light\"]" : "[data-demo-theme=\"dark\"]");
      for (const name of ["primary", "secondary", "muted", "info", "positive", "warning", "danger"]) {
        for (const surface of surfaces[mode] ?? []) {
          const ratio = contrast(colors[name] ?? "#000000", surface);
          assert.ok(ratio >= 4.5, `${mode} ui-${name} on ${surface} is ${ratio.toFixed(2)}:1`);
        }
      }
    }
  });

  it("makes faint text the muted step, never an alpha wash", () => {
    assert.doesNotMatch(tokens, /--ds-(?:body-)?fg-faint:\s*color-mix/u);
  });
});
