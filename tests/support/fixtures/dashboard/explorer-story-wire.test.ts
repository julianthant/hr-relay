import { describe, expect, it } from "vitest";
import wire from "./explorer-story-wire.json" with { type: "json" };
import { FIXTURE_EXPLORER_WIRE } from "./fixture-explorer.js";
import { EXPLORER_STORY_WORKFLOW_ID } from "./explorer-story-fixtures.js";

/** The Explorer stories run in the page, where the backend builders behind this fixture cannot; they start from a copy of one workflow.
 * The build id hashes the repository's own source, so every commit changes it; the copy keeps one and the comparison leaves it out. */
describe("the Explorer story copy", () => {
  it("holds the served wire with only the onboarding workflow", () => {
    const served = { ...FIXTURE_EXPLORER_WIRE, workflows: FIXTURE_EXPLORER_WIRE.workflows.filter(workflow => String(workflow.id) === EXPLORER_STORY_WORKFLOW_ID) };
    const { buildId: _copied, ...copied } = wire;
    const { buildId: _served, ...current } = JSON.parse(JSON.stringify(served)) as typeof wire;
    expect(copied).toEqual(current);
  });
});
