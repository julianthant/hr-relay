/**
 * D273 items 1, 4 and 5 — the run-detail cues that are composed in JSX.
 *
 * The sheet is `docs/decisions/2026-08-25-03a-demo-fidelity-run-detail.md`
 * (answered A on 2026-08-26); the audited rows are ledger 2 A3, A13, B91 and
 * C4. Each claim here is about the words or the ownership of a rendered
 * element, so `renderToStaticMarkup` is the instrument — the same one
 * `queue-bulk-band-sentence.test.ts` uses for a sentence composed across JSX
 * branches, which has no fold to test.
 */
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import type { z } from "zod";
import { GateDecisionWireSchema } from "../../../src/domain/dashboard/run-detail.js";
import { QueueSurfaceWireSchema } from "../../../src/domain/dashboard/projection.js";
import { InlineDecision } from "../../../src/dashboard/surfaces/log-panel.js";
import { ContextRail } from "../../../src/dashboard/surfaces/context-rail.js";
import { RunProvenanceBar } from "../../../src/dashboard/surfaces/run-identity.js";

const RUN_ID = "e1b8ae3e-0000-4000-8000-000000000001";
const GATE_ID = "e1b8ae3e-0000-4000-8000-0000000000a1";
const OPENED_AT = "2026-08-25T12:01:00.000Z";
const NOW = "2026-08-25T12:03:30.000Z";
const DESCRIPTOR_HASH = "9f".repeat(32);

/** The open arm specifically: `InlineDecision` renders no other one. */
function openGate(): Extract<z.infer<typeof GateDecisionWireSchema>, { state: "open" }> {
  const parsed = GateDecisionWireSchema.parse({
    state: "open",
    gateId: GATE_ID,
    label: "Confirm this is the right person",
    openedAt: OPENED_AT,
    revision: 3,
  });
  if (parsed.state !== "open") throw new Error(`gate fixture parsed as ${parsed.state}, not open`);
  return parsed;
}

describe("B91 — the open decision card prints the age AND the clock", () => {
  it("carries both halves of the wait", () => {
    const html = renderToStaticMarkup(createElement(InlineDecision, {
      gate: openGate(),
      actions: [],
      runId: RUN_ID,
      onAction: () => undefined,
      nowIso: NOW,
    }));
    // The age decides which of two waiting runs you open first; the clock is
    // what you match against everything else on screen. Printing only the clock
    // here while the outcome bar printed only the age left neither surface
    // carrying the demo's pair.
    assert.match(html, /open 2m 30s · since /u);
  });
});

describe("A3/A13 — the provenance bar uses the demo's identity wording", () => {
  const surface = QueueSurfaceWireSchema.parse({
    runId: RUN_ID,
    itemId: "99999999-9999-4999-8999-999999999999",
    workflowId: "person-lookup",
    traceId: "pl-120000-e1b8",
    attempt: 1,
    lineage: { state: "root" },
    actorId: "local-operator",
    appVersion: { state: "present", value: "0.1.0" },
    descriptorVersion: 1,
    descriptorHash: DESCRIPTOR_HASH,
    configFingerprint: "ab".repeat(32),
    resolvedInstances: [{ system: "ucpath", instance: "prod" }],
    dryRun: false,
    priority: "interactive",
    runNumber: { state: "present", value: 12 },
    containment: "root",
    linkedRuns: [],
    session: { state: "absent", reason: "this fixture predates D269 session grouping" },
    facts: { state: "absent", reason: "run is running and has not produced a terminal result" },
    startedAt: OPENED_AT,
    updatedAt: NOW,
    endedAt: { state: "absent", reason: "run has not ended" },
    gateOpenedAt: { state: "absent", reason: "no gate has opened on this run" },
    displayName: { state: "absent", reason: "the operator has not renamed this run" },
    title: "EID 10873698",
    subtitle: { state: "absent", reason: "no second identifier" },
    liveMessage: { state: "absent", reason: "no message" },
    warnings: { state: "absent", reason: "no warning set has been derived" },
    pipeline: [],
    panelKind: "run",
    availableSections: ["logs"],
    actions: [],
    rowRevision: 4,
    surfaceKind: "single",
    status: "running",
  });

  it("prints the bare shape tag with no invented noun in front of it", () => {
    const html = renderToStaticMarkup(createElement(RunProvenanceBar, {
      surface,
      workflowLabel: "Person Lookup",
      currentAppVersion: "0.1.0",
      servedDescriptorHash: DESCRIPTOR_HASH,
    }));
    assert.match(html, />9f9f9f9f</u);
    // The `wf ` noun was a rebuild addition nothing recorded, and the fact it
    // labelled is named in full by the ⓘ's `Workflow` row.
    assert.equal(/wf 9f9f9f9f/u.test(html), false);
  });
});

describe("C4 — one owner for the rail's expansion", () => {
  const summary = { dataFacts: 2, evidenceFacts: 0, attempts: 1 } as const;

  function railHeader(dataExpanded: boolean): string {
    return renderToStaticMarkup(createElement(ContextRail, {
      summary,
      // No `context-data` payload: the header word is the claim here, and the
      // editor beneath it needs a BFF client this lane deliberately has none of.
      sections: {},
      onClose: () => undefined,
      actorId: "local-operator",
      liveStatus: "running",
      dataExpanded,
      onDataExpandedChange: () => undefined,
      onSaved: () => undefined,
    }));
  }

  it("reads its header word from the OWNER's value, not a second copy", () => {
    // The defect this closes: `LogPanel` sized the grid column from its own
    // flag while the rail's header read a `useState` of its own, so a collapsed
    // and re-opened rail said `Run data` over a column still at the wide token.
    assert.match(railHeader(true), /Run data · editing/u);
    assert.equal(/Run data · editing/u.test(railHeader(false)), false);
    assert.match(railHeader(false), /Run data/u);
  });
});
