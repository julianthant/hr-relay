import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = resolve(import.meta.dirname, "../../../../../src/dashboard/surfaces/run-detail/log-panel.tsx");

function code(): string {
  return readFileSync(SOURCE, "utf8")
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/^[ \t]*\/\/.*$/gmu, "");
}

describe("the detail region's breakpoints", () => {
  it("keys on the COLUMN, never on the window", () => {
    const viewportQueries = [...code().matchAll(/(?<!@)\bmin-\[(\d+)px\]:(\S*)/gu)]
      .map((match) => `min-[${String(match[1])}px]:${String(match[2])}`);
    expect(viewportQueries).toEqual([]);
  });
});
