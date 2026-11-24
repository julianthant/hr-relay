
import assert from "node:assert/strict";
import { readdirSync,readFileSync,statSync } from "node:fs";
import { relative,resolve } from "node:path";
import { describe,it } from "vitest";

const DASHBOARD = resolve(import.meta.dirname, "../../../../src/dashboard");
const TOKENS_CSS = resolve(DASHBOARD, "ds/theme/tokens.css");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(?:ts|tsx|css)$/.test(entry) ? [full] : [];
  });
}

describe("dashboard design tokens", () => {
  it("defines every --ds-* custom property the surfaces read", () => {
    const css = readFileSync(TOKENS_CSS, "utf8");
    const defined = new Set(
      [...css.matchAll(/^\s*(--ds-[a-z0-9-]+)\s*:/gmu)].map((match) => match[1]),
    );
    assert.ok(defined.size > 100, `tokens.css defined only ${String(defined.size)} tokens — did the scan break?`);

    const undefinedUses: string[] = [];
    for (const file of sourceFiles(DASHBOARD)) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/var\((--ds-[a-z0-9-]+)/gu)) {
        const token = match[1];
        if (token === undefined || defined.has(token)) continue;
        undefinedUses.push(`${relative(DASHBOARD, file)}: var(${token})`);
      }
    }
    assert.deepEqual(
      [...new Set(undefinedUses)].sort((a, b) => a.localeCompare(b)),
      [],
      "these read a --ds-* token that tokens.css never defines, so the declaration is dropped and the element paints nothing",
    );
  });

  it("keeps one grid: no fractional px in the theme or app stylesheet", () => {
    const fractional: string[] = [];
    for (const file of [TOKENS_CSS, resolve(DASHBOARD, "app/index.css")]) {
      const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//gu, "");
      for (const match of css.matchAll(/(?<![\w.])\d+\.\d+px/gu)) fractional.push(`${relative(DASHBOARD, file)}: ${match[0]}`);
    }
    assert.deepEqual(fractional, []);
  });

  it("holds the approved sidebar width and group label", () => {
    const css = readFileSync(TOKENS_CSS, "utf8");
    assert.match(css, /--ds-sidebar-width:\s*232px/u);
    assert.match(css, /\.ds-text-group-label\s*\{[^}]*font-size:\s*11px[^}]*font-weight:\s*500/u);
    assert.doesNotMatch(css, /\.ds-text-caps|--log-violet/u);
  });
});
