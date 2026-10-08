// @vitest-environment jsdom
/**
 * D273 items 1, 4 and 5 — the run-detail cues that are composed in JSX.
 *
 * Operator context is `docs/decisions/dashboard.md` §D273
 * (answered A on 2026-08-26); the audited rows are ledger 2 A3, A13, B91 and
 * C4. Each claim here is about the words or the ownership of a rendered
 * element, so `renderToStaticMarkup` is the instrument — the same one
 * `queue-bulk-band-sentence.test.ts` uses for a sentence composed across JSX
 * branches, which has no fold to test.
 */
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, it } from "vitest";
import { QueueSurfaceWireSchema } from "../../../../../src/models/dashboard/projection.js";
import { RunProvenanceBar } from "../../../../../src/dashboard/surfaces/run-detail/identity/run-identity.js";

const RUN_ID = "e1b8ae3e-0000-4000-8000-000000000001";

const OPENED_AT = "2026-08-25T12:01:00.000Z";
const NOW = "2026-08-25T12:03:30.000Z";
const DESCRIPTOR_HASH = "9f".repeat(32);

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

let mounted: Root | undefined;

afterEach(async () => {
  const root = mounted;
  mounted = undefined;
  if (root !== undefined) {
    await act(async () => {
      root.unmount();
    });
  }
  document.body.replaceChildren();
});

/** The open arm specifically: `InlineDecision` renders no other one. */

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

  it("keeps Config and Attempt out of the mounted provenance popover", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    mounted = root;
    await act(async () => {
      root.render(createElement(RunProvenanceBar, {
        surface,
        workflowLabel: "Person Lookup",
        currentAppVersion: "0.1.0",
        servedDescriptorHash: DESCRIPTOR_HASH,
      }));
    });

    const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="Run provenance"]');
    if (trigger === null) throw new Error("the provenance bar rendered no trigger");
    await act(async () => {
      trigger.click();
    });

    // This assertion reads Radix's OPEN portal from document.body, not the
    // closed static trigger tree. Reinstating either A18's Config row or A19's
    // Attempt row in RunProvenanceBar's KeyValueList makes this test fail.
    const popover = document.querySelector<HTMLElement>('[aria-label="Provenance"]');
    if (popover === null) throw new Error("opening Run provenance mounted no provenance popover");
    assert.match(popover.textContent ?? "", /Workflow/u);
    assert.equal(/Config/u.test(popover.textContent ?? ""), false);
    assert.equal(/Attempt/u.test(popover.textContent ?? ""), false);
  });
});
