import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { applies, fieldSource, resolveExplorer, rowValue, visible, type SpecCard } from "../../../../src/dashboard/surfaces/explorer/explorer-spec.js";
import { FIXTURE_EXPLORER_WIRE } from "../../../support/helpers/dashboard/mock-world/fixture-explorer.js";

const workflow = FIXTURE_EXPLORER_WIRE.workflows.find(candidate => candidate.id === "person-lookup");
assert.ok(workflow);
const spec = workflow.reviewSpec;
const ids = (chosen: Record<string, string> = {}, decisions: Record<string, string> = {}) => resolveExplorer(spec, chosen, decisions).steps.map(step => step.id);
const cards = (stepId: string) => spec.steps.find(step => step.id === stepId)!.blocks.filter((block): block is SpecCard => block.kind === "card");

describe("Explorer spec resolution", () => {
  it("shows the steps and session chips the run options select, and renumbers by dropping hidden steps", () => {
    assert.deepEqual(ids(), ["reference-check", "searching", "cross-verify", "active-status", "crm-dates"]);
    assert.deepEqual(ids({ includeCrmDates: "false" }), ["reference-check", "searching", "cross-verify", "active-status"]);
    assert.deepEqual(ids({ includeCrmDates: "true" }), ["reference-check", "searching", "cross-verify", "active-status", "crm-dates"]);
    assert.deepEqual(ids({ crmCheck: "false" }), ["reference-check", "searching", "active-status"]);
    assert.deepEqual(resolveExplorer(spec, { crmCheck: "false" }, {}).sessions, ["ucpath"]);
    assert.deepEqual(resolveExplorer(spec, {}, {}).sessions, ["ucpath", "crm"]);
  });
  it("hides an option whose gate no longer holds and follows an option's initial value", () => {
    assert.deepEqual(resolveExplorer(spec, {}, {}).options.map(option => option.id), ["mode", "search-by", "crmCheck", "includeCrmDates", "skip-searching", "skip-cross-verify", "skip-active-status", "skip-crm-dates"]);
    const match = resolveExplorer(spec, { mode: "match" }, {});
    assert.deepEqual(match.options.map(option => option.id), ["mode", "crmCheck", "skip-searching", "skip-cross-verify", "skip-active-status", "skip-crm-dates"]);
    assert.equal(match.values.crmCheck, "false");
  });
  it("falls back to the initial value when a chosen option is no choice of it", () => {
    assert.equal(resolveExplorer(spec, { mode: "nonsense" }, {}).values.mode, "search");
  });
  it("hides every later step when an outcome stops the run", () => {
    const resolved = resolveExplorer(spec, {}, { "search-result": "PERSON_LOOKUP_UCPATH_SEARCH_FAILED" });
    assert.deepEqual(resolved.steps.map(step => step.id), ["reference-check", "searching"]);
    assert.equal(resolved.stop?.stops, true);
  });
  it("falls back to a decision's initial outcome when the chosen one no longer applies", () => {
    assert.equal(resolveExplorer(spec, { mode: "match" }, { "search-result": "not-a-listed-outcome" }).values["search-result"], "resolved");
  });
  it("follows a decision and an option in a row value, and gates rows on the chosen options", () => {
    const fill = cards("searching").find(card => card.mode === "fill")!;
    const byName = resolveExplorer(spec, { "search-by": "name" }, {}).values;
    const byEid = resolveExplorer(spec, { "search-by": "emplId" }, {}).values;
    assert.deepEqual(visible(fill.rows, byName).map(row => rowValue(row, byName)), ["Morrow, Bea"]);
    assert.deepEqual(visible(fill.rows, byEid).map(row => rowValue(row, byEid)), ["10000001"]);
    assert.equal(applies({ when: [{ mode: ["match"] }] }, byName), false);
  });
  it("names a fill row's source and leaves out a read from a step that is not shown", () => {
    const row = cards("cross-verify").find(card => card.mode === "fill")!.rows[0];
    const shown = fieldSource(spec, row, id => id === "searching" ? 2 : undefined);
    assert.deepEqual(shown.reads, [{ system: "UCPath", page: "Person Organizational Summary detail", field: "Name", step: 2 }]);
    assert.deepEqual(fieldSource(spec, row, () => undefined).reads, []);
  });
});
