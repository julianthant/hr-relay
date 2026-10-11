import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { parseRoadmap } from "../../../scripts/docs/roadmap.js";

describe("roadmap parser", () => {
  it("parses a title, preamble, section intro and each status with optional descriptions", () => {
    assert.deepEqual(parseRoadmap([
      "# Relay roadmap", "", "Plain <text> & a preamble.", "", "## Foundation",
      "First intro line.", "Second intro line.", "", "- [done] Dashboard — Frozen.",
      "- [now] Backend", "- [next] Wiring — Keep — the rest.", "- [later] Release", "",
      "## Workflows", "- [later] Person Lookup", "",
    ].join("\r\n")), {
      title: "Relay roadmap", intro: "Plain <text> & a preamble.", sections: [
        { title: "Foundation", intro: "First intro line.\nSecond intro line.", items: [
          { status: "done", name: "Dashboard", description: "Frozen." },
          { status: "now", name: "Backend" },
          { status: "next", name: "Wiring", description: "Keep — the rest." },
          { status: "later", name: "Release" },
        ] },
        { title: "Workflows", intro: "", items: [{ status: "later", name: "Person Lookup" }] },
      ],
    });
  });

  it("rejects an unknown status with its physical line number", () => {
    assert.throws(() => parseRoadmap("# Roadmap\n\n## Work\n\n- [soon] Release"), /Line 5: unknown status "soon"/u);
  });

  it("rejects malformed lines and intro prose after items with physical line numbers", () => {
    for (const line of ["- Missing status", "* Unsupported bullet", "### Unsupported heading", "1. Unsupported list", "- [done] Name — "]) {
      assert.throws(() => parseRoadmap(`# Roadmap\n\n## Work\n${line}`), /Line 4: malformed/u);
    }
    assert.throws(() => parseRoadmap("# Roadmap\n## Work\n- [done] Name\n\nLate prose"), /Line 5: intro text must precede items/u);
  });
});
