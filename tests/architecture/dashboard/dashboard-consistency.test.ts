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
  it("never picks a Banner or Notice tone from an expression", () => {
    const hits = sources.filter(({ path, text }) => path !== "src/dashboard/app/loaded-app.tsx" && /<(Banner|Notice)\b[^>]*tone=\{/u.test(text)).map(({ path }) => path);
    assert.deepEqual(hits, [], "branch to FailureNotice for a failure");
  });
  it("keeps every dialog at its size's shared width", () => {
    const hits = sources.filter(({ text }) => /<DialogContent\b[^>]*className="[^"]*\b(max-w-|w-\[)/u.test(text)).map(({ path }) => path);
    assert.deepEqual(hits, [], "drop the width override; use size sm, md or lg");
    const css = readRepoFile("src/dashboard/surfaces/run-detail/logs/log-presentation.css");
    assert.doesNotMatch(css, /\.log-viewer-dialog\s*\{[^}]*\b(max-)?width\s*:/u);
  });
  it("offers only the sm, md and lg dialog sizes", () => {
    const overlay = readRepoFile("src/dashboard/ds/primitives/primitives-overlay.tsx");
    assert.match(overlay, /DsDialogSize = "sm" \| "md" \| "lg";/u);
    const hits = sources.filter(({ text }) => /<DialogContent\b[^>]*size="(?!sm"|md"|lg")/u.test(text)).map(({ path }) => path);
    assert.deepEqual(hits, []);
  });
});
