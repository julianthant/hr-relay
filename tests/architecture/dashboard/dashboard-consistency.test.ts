// Consistency rules: one failure notice, three dialog widths.
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { dashboardFiles, readRepoFile, DASHBOARD_ROOTS } from "./helpers/design-rules.js";

const sources = dashboardFiles(DASHBOARD_ROOTS, [".tsx"]).map((path) => ({ path, text: readRepoFile(path) }));

describe("dashboard consistency", () => {
  it("shows errors with FailureNotice, never a danger Banner or Notice", () => {
    const hits = sources.filter(({ text }) => /<(Banner|Notice)\b[^>]*tone="danger"/u.test(text)).map(({ path }) => path);
    assert.deepEqual(hits, [], "use FailureNotice from ds/primitives/failure-notice");
  });
  it("offers only the sm, md and lg dialog sizes", () => {
    const overlay = readRepoFile("src/dashboard/ds/primitives/primitives-overlay.tsx");
    assert.match(overlay, /DsDialogSize = "sm" \| "md" \| "lg";/u);
    const hits = sources.filter(({ text }) => /<DialogContent\b[^>]*size="(?!sm"|md"|lg")/u.test(text)).map(({ path }) => path);
    assert.deepEqual(hits, []);
  });
});
