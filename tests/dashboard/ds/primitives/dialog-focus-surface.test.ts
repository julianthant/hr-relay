import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { it } from "vitest";

/** Dialogs, drawers and popovers are tabindex="-1" surfaces that hold focus; a key press makes that focus visible. */
it("never repaints the background of a focus-visible tabindex=-1 surface", () => {
  const css = readFileSync(resolve("src/dashboard/ds/theme/hub-theme.css"), "utf8");
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selector: selector.trim(), body }));
  const offenders = rules
    .filter(({ selector }) => selector.replaceAll(':not([tabindex="-1"])', "").includes('[tabindex="-1"]') && selector.includes(":focus-visible"))
    .filter(({ body }) => /(^|[;\s])background(-color)?\s*:/.test(body));
  assert.deepEqual(offenders.map(({ selector }) => selector), []);
});
