/**
 * The detail region's two breakpoints exist TWICE, and the two copies must
 * agree (ref dashboard-surfaces §Shell).
 *
 * Tailwind cannot see through an identifier, so the CSS half of the split is
 * the literal `@min-[868px]/detail:` / `@min-[1068px]/detail:` written into
 * `log-panel.tsx`'s class strings, while the JS half — which decides whether
 * the context rail may render as its 34px SPINE, a choice of component no
 * stylesheet can make — reads the exported constants. A number that drifts
 * between them is a region whose columns and whose components disagree about
 * what arrangement they are in, which is the two-representations defect D187
 * and D195 were both written about.
 *
 * The check reads the source rather than the rendered DOM on purpose: it is a
 * statement about the literals themselves, and it fails on the edit that
 * introduces the drift instead of on the viewport that reveals it.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DETAIL_SHAPE_BESIDE_PX,
  DETAIL_THREE_COLUMN_PX,
} from "../../../src/dashboard/surfaces/queue/layout-metrics.js";

const SOURCE = resolve(import.meta.dirname, "../../../src/dashboard/surfaces/run-detail/log-panel.tsx");

/**
 * The file's CODE, with comments removed. The prose in this file quotes the
 * retired `min-[1280px]:` / `min-[1480px]:` thresholds deliberately — that is
 * the record of what moved and why — and a check that could not tell a comment
 * from a class name would force the explanation out of the file it explains.
 */
function code(): string {
  return readFileSync(SOURCE, "utf8")
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/^[ \t]*\/\/.*$/gmu, "");
}

/** Every container-query threshold spelled in the file, in source order. */
function containerQueryThresholds(): readonly number[] {
  return [...code().matchAll(/@min-\[(\d+)px\]\/detail:/gu)].map((match) => Number(match[1]));
}

describe("the detail region's breakpoints", () => {
  it("spells only the two thresholds the constants name", () => {
    const spelled = new Set(containerQueryThresholds());
    assert.ok(spelled.size > 0, "the region is expected to switch on container queries, not on the window");
    expect([...spelled].sort((a, b) => a - b)).toEqual([
      DETAIL_THREE_COLUMN_PX,
      DETAIL_SHAPE_BESIDE_PX,
    ]);
  });

  it("keys on the COLUMN, never on the window", () => {
    // D340: the shell never stacks, so the detail container is unconditional.
    const viewportQueries = [...code().matchAll(/(?<!@)\bmin-\[(\d+)px\]:(\S*)/gu)]
      .map((match) => `min-[${String(match[1])}px]:${String(match[2])}`);
    expect(viewportQueries).toEqual([]);
  });

  it("derives both thresholds from the shell the region sits in", () => {
    // 376px queue track + three 12px shell insets is what the shell spends
    // before this column starts, so the old window thresholds translate by a
    // constant 412px — which is why the rendered arrangement at the default
    // panel mode is unchanged at every reference viewport.
    const SHELL_BEFORE_THE_COLUMN = 376 + 3 * 12;
    assert.equal(DETAIL_THREE_COLUMN_PX, 1280 - SHELL_BEFORE_THE_COLUMN);
    assert.equal(DETAIL_SHAPE_BESIDE_PX, 1480 - SHELL_BEFORE_THE_COLUMN);
  });
});
