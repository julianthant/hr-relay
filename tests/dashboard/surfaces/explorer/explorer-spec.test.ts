import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { defaultOptions, resolveExplorer, specValue } from "../../../../src/dashboard/surfaces/explorer/explorer-spec.js";
import { PERSON_LOOKUP_SPEC } from "../../../../src/dashboard/surfaces/explorer/explorer-spec-fixtures.js";

const ids = (options: Record<string, string>, decisions: Record<string, string> = {}) => resolveExplorer(PERSON_LOOKUP_SPEC, options, decisions).steps.map(step => step.id);

describe("Explorer spec resolution", () => {
  const defaults = defaultOptions(PERSON_LOOKUP_SPEC);
  it("shows the steps the run options select", () => {
    assert.deepEqual(ids(defaults), ["sessions", "search", "crm", "status"]);
    assert.deepEqual(ids({ ...defaults, crm: "off", dates: "requested" }), ["sessions", "search", "status", "dates"]);
  });
  it("hides every later step when an outcome stops the run", () => {
    const resolved = resolveExplorer(PERSON_LOOKUP_SPEC, defaults, { search: "none" });
    assert.deepEqual(resolved.steps.map(step => step.id), ["sessions", "search"]);
    assert.equal(resolved.stop?.then, "The run ends as Not found.");
  });
  it("falls back to the initial outcome when the chosen one no longer applies", () => {
    const resolved = resolveExplorer(PERSON_LOOKUP_SPEC, { ...defaults, by: "eid" }, { search: "several" });
    assert.equal(resolved.values.search, "one");
  });
  it("follows a decision in a value", () => {
    const row = PERSON_LOOKUP_SPEC.steps[3].blocks[0];
    assert.ok(row.kind === "card");
    assert.equal(specValue(row.rows[1].value, { status: "inactive" }), "Inactive");
    assert.equal(specValue(row.rows[1].value, { status: "other" }), "Not read");
  });
});
