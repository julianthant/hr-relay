import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { parseDryRunScenarioManifest } from "../../../../src/models/trust/dry-run-scenario.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";
import {
DryRunScenarioUnavailableError,
listDryRunScenarioWorkflows,
loadDryRunScenarioManifest,
} from "../../../../src/backend/app/dry-run/manifests.js";

describe("registered dry-run scenario manifests", () => {
  it("loads Person Lookup as a transaction-free live read with exact no-write expectations", async () => {
    const manifest = parseDryRunScenarioManifest(await loadDryRunScenarioManifest("person-lookup"));
    assert.equal(manifest.workflow, personLookupDescriptor.id);
    assert.equal(manifest.arm, "live-read");
    assert.equal(manifest.scenarioId, "person-lookup/live-read");
    assert.equal(manifest.cases.length, 1);
    const scenario = manifest.cases[0]; assert.ok(scenario);
    assert.equal(scenario.subjectKind, "search-by-eid");
    assert.deepEqual(scenario.nodesReached, ["searching", "search-identity", "cross-verify", "crm-identity", "crm-selected-record", "active-status"]);
    assert.deepEqual(scenario.nodesExcluded, ["matching", "crm-only-recovery", "crm-dates"]);
    assert.deepEqual([...scenario.nodesReached, ...scenario.nodesExcluded].sort(), personLookupDescriptor.nodes.map(node => node.id).sort());
    assert.equal(personLookupDescriptor.nodes.some(node => node.kind === "transaction" || node.kind === "gate"), false);
    assert.deepEqual(scenario.checkpoints, scenario.nodesReached.map(node => ({ node, attempt: 1, keyedBy: ["workflow", "item", "node", "attempt", "claimGeneration"] })));
    assert.deepEqual(scenario.gateResults, []);
    assert.deepEqual(scenario.durableDeltas, { writeIntents: 0, writeAttempts: 0, durableOutbox: 0 });
    assert.deepEqual(scenario.terminal, { lifecycle: "done", resultSchema: "workflow-result", kind: "live-read" });
    assert.equal(scenario.receipt.result, "verified-done");
    assert.equal(scenario.receipt.confidence, "verified");
    assert.deepEqual(scenario.receipt.verification, [
      { obligation: "node.searching", verdict: "verified", mandatory: false },
      { obligation: "node.matching", verdict: "absent", mandatory: false },
      { obligation: "node.search-identity", verdict: "verified", mandatory: true },
      { obligation: "node.cross-verify", verdict: "verified", mandatory: false },
      { obligation: "node.crm-identity", verdict: "verified", mandatory: true },
      { obligation: "node.crm-selected-record", verdict: "verified", mandatory: true },
      { obligation: "node.crm-only-recovery", verdict: "unknown", mandatory: false },
      { obligation: "node.active-status", verdict: "verified", mandatory: true },
      { obligation: "node.crm-dates", verdict: "absent", mandatory: false },
      { obligation: "completion.terminal-result", verdict: "verified", mandatory: true },
      { obligation: "identity.eid-agrees-across-sources", verdict: "verified", mandatory: true },
      { obligation: "identity.ucpath-selection-is-unambiguous", verdict: "verified", mandatory: true },
    ]);
  });
  it("lists the registered manifest and names known unavailable workflows", () => {
    assert.deepEqual(listDryRunScenarioWorkflows(), ["person-lookup"]);
    for (const workflow of ["separations", "separations-kuali-finalization"]) {
      assert.throws(() => loadDryRunScenarioManifest(workflow), (error: unknown) =>
        error instanceof DryRunScenarioUnavailableError
        && error.message === `dry-run scenario manifest unavailable for ${workflow}`);
    }
    assert.throws(() => loadDryRunScenarioManifest("unknown-workflow"),
      /unknown dry-run scenario workflow unknown-workflow; registered: person-lookup$/u);
  });
});
