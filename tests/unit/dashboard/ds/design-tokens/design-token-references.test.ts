
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { describe, it } from "vitest";

const DASHBOARD = resolve(import.meta.dirname, "../../../../../src/dashboard");
const TOKENS_CSS = resolve(DASHBOARD, "ds/theme/tokens.css");

/** Tokens a component writes into an inline `style`, and the module that writes it. */
const RUNTIME_DECLARED: Readonly<Record<string, string>> = {
  "--ds-toast-inset-bottom": "app/dashboard-app.tsx",
};

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
        if (token === undefined || defined.has(token) || token in RUNTIME_DECLARED) continue;
        undefinedUses.push(`${relative(DASHBOARD, file)}: var(${token})`);
      }
    }
    assert.deepEqual(
      [...new Set(undefinedUses)].sort((a, b) => a.localeCompare(b)),
      [],
      "these read a --ds-* token that tokens.css never defines, so the declaration is dropped and the element paints nothing",
    );
  });

  it("keeps the runtime-declared allowlist honest", () => {
    for (const [token, module] of Object.entries(RUNTIME_DECLARED)) {
      const text = readFileSync(resolve(DASHBOARD, module), "utf8");
      assert.ok(
        text.includes(`"${token}"`),
        `${module} is listed as the writer of ${token} but does not set it`,
      );
    }
  });
});
