/**
 * 2i-C: the context-data edit projection (ref data-intake-and-edit-data §6, ref dashboard-surfaces D19).
 *
 * The Data section serves, per entry, exactly what a checkpoint correction
 * needs — the patch identity and the raw recorded scalar off the latest
 * compatible checkpoint — or the reason it is not editable. Run-level policy
 * (`editing`) is computed from RAW authority lifecycle, never the coarse
 * queue status; a staged `envelope.injected` correction renders beside the
 * recorded value it will supersede, because until the resume replays it both
 * values are true.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { RunCheckpointRecordSchema } from "../../../src/domain/workflow/checkpoint.js";
import { ContextDataSectionSchema } from "../../../src/domain/dashboard/run-detail.js";
import { buildRunSection } from "../../../src/server/dashboard/queries/run-detail.js";
import { HASH_A, HASH_B, NOW } from "../fixtures/phase1c-contract-fixtures.js";
import {
  claimEventOf,
  makeWorld,
  queuedEventOf,
  runRecordOf,
  uuidOf,
  type DashboardWorld,
} from "./helpers/dashboard-harness.js";

const worlds: DashboardWorld[] = [];
function world(): DashboardWorld {
  const created = makeWorld();
  worlds.push(created);
  return created;
}
afterEach(() => {
  for (const w of worlds.splice(0)) w.dispose();
});

const CLAIM = {
  workerId: "person-lookup-worker-1",
  claimedAt: "2026-08-03T17:00:05.000Z",
  heartbeatAt: "2026-08-03T17:00:05.000Z",
} as const;

const DATE_FIELDS_VIEW = {
  details: [],
  capabilities: {
    editData: {
      fields: [
        { nodeId: "crm-dates", fieldPath: "invitedOn.value", label: "Invited on" },
        { nodeId: "crm-dates", fieldPath: "startsOn.value", label: "Starts on" },
        { nodeId: "crm-dates", fieldPath: "completedOn.value", label: "Completed on" },
      ],
    },
  },
} as const;

function depsOf(w: DashboardWorld, view: unknown = DATE_FIELDS_VIEW) {
  return {
    stateRoot: w.stateRoot,
    projection: w.projection,
    authority: w.authority,
    descriptors: { resolve: () => view as never },
  };
}

const OBSERVED_AT = "2026-08-03T16:58:00.000Z";
const CORRECTED_AT = "2026-08-03T17:04:00.000Z";

function crmDatesCheckpoint(seed: number, provenance: readonly unknown[] = []) {
  return RunCheckpointRecordSchema.parse({
    workflowId: "person-lookup",
    itemId: uuidOf(seed + 5000),
    nodeId: "crm-dates",
    attempt: 1,
    claimGeneration: 1,
    runId: uuidOf(seed),
    output: {
      schemaHash: HASH_A,
      value: {
        emplId: "10873698",
        invitedOn: { state: "present", value: "2026-06-01" },
        startsOn: { state: "present", value: "2026-07-15" },
        completedOn: { state: "absent", reason: "CRM history has no Completed transition" },
      },
    },
    descriptorVersion: 1,
    contractFingerprint: HASH_A,
    implFingerprint: HASH_B,
    provenance,
    writtenAt: NOW,
  });
}

function contextData(w: DashboardWorld, view: unknown = DATE_FIELDS_VIEW) {
  const response = buildRunSection(depsOf(w, view), uuidOf(1), "context-data");
  if (response.section !== "context-data") throw new Error("wrong section");
  return response.payload;
}

describe("context-data edit projection (2i-C)", () => {
  it("serves each recorded correctable field with its patch identity and the run's CAS basis", () => {
    const w = world();
    queuedEventOf(w, { seed: 1 });
    w.authority.put(runRecordOf({ seed: 1, version: 4 }));
    w.authority.putCheckpoint(crmDatesCheckpoint(1));

    const payload = contextData(w);
    assert.deepEqual(payload.editing, { state: "editable", expectedVersion: 4 });
    assert.equal(payload.entries.length, 3);

    const invited = payload.entries.find((entry) => entry.label === "Invited on");
    assert.ok(invited);
    assert.equal(invited.valueRedacted, "2026-06-01");
    assert.deepEqual(invited.edit, {
      state: "editable",
      nodeId: "crm-dates",
      fieldPath: "invitedOn.value",
      value: "2026-06-01",
      pendingCorrection: { state: "none" },
    });

    // The absent arm is a REAL recorded outcome: the row renders, says why it
    // cannot be corrected, and never fabricates a value to edit.
    const completed = payload.entries.find((entry) => entry.label === "Completed on");
    assert.ok(completed);
    assert.equal(completed.edit.state, "locked");
    if (completed.edit.state === "locked") {
      assert.match(completed.edit.reason, /carries no completedOn\.value/u);
    }
  });

  /**
   * D307 — an ASSERTED row on the Data rail.
   *
   * Before D307 an `operator` source meant one thing, a correction, and the
   * rail drew nothing extra for it because the `corrected` badge already said
   * so. An asserted value is operator-sourced with NO correction, so without
   * its own leaf it would draw exactly like a value a task read from a live
   * system — an instant beside it and nothing saying nobody looked.
   */
  it("names the omitted step behind an asserted value, and never calls it a correction", () => {
    const w = world();
    queuedEventOf(w, { seed: 1 });
    w.authority.put(runRecordOf({ seed: 1, version: 4 }));
    w.authority.putCheckpoint(RunCheckpointRecordSchema.parse({
      ...crmDatesCheckpoint(1, [
        { path: "invitedOn.value", source: "operator", observedAt: OBSERVED_AT, originalObservedAt: OBSERVED_AT },
      ]),
      assertion: { step: "crm-read", assertedAt: OBSERVED_AT },
    }));

    const invited = contextData(w).entries.find((entry) => entry.label === "Invited on");
    assert.ok(invited);
    assert.equal(invited.assertedStep, "crm-read");
    assert.equal(invited.source, "operator");
    assert.equal(invited.correctedAt, undefined, "an assertion is not a correction");

    // A leaf the asserted row recorded no covering point for is still asserted:
    // the marker is a property of the ROW, not of one provenance line.
    const starts = contextData(w).entries.find((entry) => entry.label === "Starts on");
    assert.equal(starts?.assertedStep, "crm-read");
    assert.equal(starts?.observedAt, undefined);
  });

  /**
   * D254 — this case used to fold a `span.patched` detail and join it to the
   * editData declaration. The channel is retired (zero production emitters),
   * so what it pins now is the rail's WHOLE membership rule: a row exists iff
   * a declared-correctable field has a stored checkpoint, and a declared
   * `details` spec on its own contributes nothing. The `details` block below
   * is deliberately present and deliberately inert — a re-added details-fed
   * path would fail the second half.
   */
  it("serves editData fields from the checkpoint, and a declared detail alone serves NO row (D254)", () => {
    const w = world();
    queuedEventOf(w, { seed: 1 });
    w.authority.put(runRecordOf({ seed: 1, version: 2 }));
    w.authority.putCheckpoint(RunCheckpointRecordSchema.parse({
      workflowId: "person-lookup",
      itemId: uuidOf(5001),
      nodeId: "searching",
      attempt: 1,
      claimGeneration: 1,
      runId: uuidOf(1),
      output: { schemaHash: HASH_A, value: { selection: { status: "resolved" } } },
      descriptorVersion: 1,
      contractFingerprint: HASH_A,
      implFingerprint: HASH_B,
      provenance: [],
      writtenAt: NOW,
    }));

    const covering = {
      details: [{
        key: "selection-status",
        label: "Selection",
        source: { nodeId: "searching", fieldPath: "selection.status" },
      }],
      capabilities: {
        editData: {
          fields: [{ nodeId: "searching", fieldPath: "selection.status", label: "Selection" }],
        },
      },
    };
    const payload = contextData(w, covering);
    assert.equal(payload.entries.length, 1, "one declared-correctable leaf with one checkpoint — one row");
    const selection = payload.entries[0];
    assert.ok(selection);
    assert.equal(selection.label, "Selection");
    // The value is READ from the checkpoint, which is the only producer left.
    assert.equal(selection.valueRedacted, "resolved");
    assert.equal(selection.edit.state, "editable");

    // Same world, same declared detail, no editData field list: no rows at
    // all. Before D254 this served a locked "not declared correctable" row
    // fed by the fold — a row production could never actually render.
    const notDeclared = contextData(w, { ...covering, capabilities: { editData: true } });
    assert.deepEqual(notDeclared.entries, []);
  });

  it("locks the run-level policy while a worker holds the claim — field identity stays served", () => {
    const w = world();
    queuedEventOf(w, { seed: 1 });
    claimEventOf(w, 1);
    w.authority.put(runRecordOf({
      seed: 1,
      lifecycle: { state: "running", ...CLAIM },
      claimGeneration: 1,
      version: 2,
    }));
    w.authority.putCheckpoint(crmDatesCheckpoint(1));

    const payload = contextData(w);
    assert.equal(payload.editing.state, "locked");
    if (payload.editing.state === "locked") {
      assert.match(payload.editing.reason, /claimed by a worker/u);
    }
    // The per-entry policy is the FIELD's own; run state is the section's.
    // The client composes the two — a wire that erased the identity here
    // would force a refetch the moment the claim releases.
    const invited = payload.entries.find((entry) => entry.label === "Invited on");
    assert.equal(invited?.edit.state, "editable");
  });

  it("names the terminal state when corrections no longer apply", () => {
    const w = world();
    queuedEventOf(w, { seed: 1 });
    w.authority.put(runRecordOf({
      seed: 1,
      lifecycle: { state: "terminal", outcome: "done", endedAt: "2026-08-03T17:10:00.000Z" },
      version: 3,
    }));
    w.authority.putCheckpoint(crmDatesCheckpoint(1));

    const payload = contextData(w);
    assert.equal(payload.editing.state, "locked");
    if (payload.editing.state === "locked") {
      assert.match(payload.editing.reason, /run is terminal/u);
    }
  });

  it("serves a staged correction beside the recorded value it will supersede", () => {
    const w = world();
    queuedEventOf(w, { seed: 1 });
    w.authority.put(runRecordOf({
      seed: 1,
      version: 5,
      injected: [{
        nodeId: "crm-dates",
        fieldPath: "invitedOn.value",
        value: "2026-06-02",
        correctedAt: "2026-08-03T17:30:00.000Z",
        reason: "CRM shows June 2; the read mis-parsed the date",
      }],
    }));
    w.authority.putCheckpoint(crmDatesCheckpoint(1));

    const invited = contextData(w).entries.find((entry) => entry.label === "Invited on");
    assert.ok(invited);
    // The RECORDED value stays the display truth; the staged value rides beside it.
    assert.equal(invited.valueRedacted, "2026-06-01");
    assert.deepEqual(invited.edit, {
      state: "editable",
      nodeId: "crm-dates",
      fieldPath: "invitedOn.value",
      value: "2026-06-01",
      pendingCorrection: {
        state: "pending",
        value: "2026-06-02",
        correctedAt: "2026-08-03T17:30:00.000Z",
      },
    });
  });

  it("omits a declared field whose step never recorded — the Data section lists what the run touched", () => {
    const w = world();
    queuedEventOf(w, { seed: 1 });
    w.authority.put(runRecordOf({ seed: 1 }));

    assert.deepEqual(contextData(w).entries, []);
  });

  /*
    W2: the observation clock and the fact's own source, projected from the
    producing checkpoint's `FactProvenance` — the record this query has read
    since 2i-C and thrown away. Every arm is read forward (D133): a checkpoint
    that carries no covering point serves no clock rather than a fabricated one.
  */
  describe("fact provenance on the served entries (W2)", () => {
    it("dates a value from the exact provenance point, and carries its source", () => {
      const w = world();
      queuedEventOf(w, { seed: 1 });
      w.authority.put(runRecordOf({ seed: 1, version: 4 }));
      w.authority.putCheckpoint(crmDatesCheckpoint(1, [
        { path: "invitedOn.value", source: "live", observedAt: OBSERVED_AT, originalObservedAt: OBSERVED_AT },
        {
          path: "startsOn.value",
          source: "operator",
          observedAt: CORRECTED_AT,
          originalObservedAt: OBSERVED_AT,
          correctedAt: CORRECTED_AT,
        },
      ]));

      const entries = contextData(w).entries;
      const invited = entries.find((entry) => entry.label === "Invited on");
      assert.ok(invited);
      assert.equal(invited.observedAt, OBSERVED_AT);
      assert.equal(invited.source, "live");
      assert.equal(invited.correctedAt, undefined);

      // An operator correction carries its own instant — the rail's `corrected`
      // badge is drawn from exactly this and from nothing it inferred.
      const starts = entries.find((entry) => entry.label === "Starts on");
      assert.ok(starts);
      assert.equal(starts.source, "operator");
      assert.equal(starts.correctedAt, CORRECTED_AT);
    });

    it("dates a leaf through the LONGEST covering prefix, never through a name it merely starts with", () => {
      const w = world();
      queuedEventOf(w, { seed: 1 });
      w.authority.put(runRecordOf({ seed: 1, version: 4 }));
      w.authority.putCheckpoint(crmDatesCheckpoint(1, [
        // The wrapper covers the leaf; the more specific point wins over it.
        { path: "invitedOn", source: "derived", observedAt: NOW, originalObservedAt: NOW },
        { path: "invitedOn.value", source: "live", observedAt: OBSERVED_AT, originalObservedAt: OBSERVED_AT },
        // Covers `startsOn` only by prefix of the STRING — never by path.
        { path: "starts", source: "operator", observedAt: CORRECTED_AT, originalObservedAt: NOW },
      ]));

      const entries = contextData(w).entries;
      const invited = entries.find((entry) => entry.label === "Invited on");
      assert.ok(invited);
      assert.equal(invited.observedAt, OBSERVED_AT, "the exact leaf beats the wrapper covering it");
      assert.equal(invited.source, "live");

      const starts = entries.find((entry) => entry.label === "Starts on");
      assert.ok(starts);
      assert.equal(starts.observedAt, undefined, "`starts` is not a segment prefix of `startsOn.value`");
      assert.equal(starts.source, undefined);
    });

    it("dates a wrapper's leaf through the wrapper, the way a commit output is dated", () => {
      const w = world();
      queuedEventOf(w, { seed: 1 });
      w.authority.put(runRecordOf({ seed: 1, version: 4 }));
      w.authority.putCheckpoint(crmDatesCheckpoint(1, [
        { path: "startsOn", source: "derived", observedAt: OBSERVED_AT, originalObservedAt: NOW },
      ]));

      const starts = contextData(w).entries.find((entry) => entry.label === "Starts on");
      assert.ok(starts);
      assert.equal(starts.observedAt, OBSERVED_AT);
      assert.equal(starts.source, "derived");
    });

    it("dates a LOCKED row too — uneditable and undated are unrelated facts", () => {
      const w = world();
      queuedEventOf(w, { seed: 1 });
      w.authority.put(runRecordOf({ seed: 1, version: 4 }));
      w.authority.putCheckpoint(crmDatesCheckpoint(1, [
        // `completedOn.value` is ABSENT on the outcome, so its row is locked.
        { path: "completedOn", source: "live", observedAt: OBSERVED_AT, originalObservedAt: OBSERVED_AT },
      ]));

      const completed = contextData(w).entries.find((entry) => entry.label === "Completed on");
      assert.ok(completed);
      assert.equal(completed.edit.state, "locked");
      assert.equal(completed.observedAt, OBSERVED_AT);
    });

    // D254 retired the case that stood here: "dates a row the workflow does
    // not declare correctable". Its subject was a `descriptor.details` spec
    // whose leaf is NOT an editData field, which only ever became a row by way
    // of the retired `span.patched` fold — so the state it asserted is now
    // unreachable rather than merely untested. Its surviving half is the case
    // above, "dates a LOCKED row too": a lock the rail can still reach (an
    // absent leaf) is dated exactly like an editable row.

    it("serves no clock at all when the checkpoint recorded no covering point (D133)", () => {
      const w = world();
      queuedEventOf(w, { seed: 1 });
      w.authority.put(runRecordOf({ seed: 1, version: 4 }));
      // A pre-provenance checkpoint. Its `writtenAt` is a real instant and is
      // NOT substituted: it dates the ROW, not the fact.
      w.authority.putCheckpoint(crmDatesCheckpoint(1));

      for (const entry of contextData(w).entries) {
        assert.equal(entry.observedAt, undefined);
        assert.equal(entry.source, undefined);
        assert.equal(entry.correctedAt, undefined);
      }
    });
  });
  /**
   * D252 — where a value came from, and the bound it is held under.
   *
   * Both are DESCRIPTOR facts served through `dataOrigins`, so the tests below
   * pin the present arm, the absent arm, and the refusal that keeps a bound
   * from being served without a step to attribute it to.
   */
  describe("origin and reuse bound (D252)", () => {
    const ORIGIN_VIEW = {
      ...DATE_FIELDS_VIEW,
      dataOrigins: [{
        nodeId: "crm-dates",
        step: "CRM dates",
        dir: "read",
        system: "crm",
        freshness: [
          { fieldPath: "invitedOn.value", maxAge: 900_000, override: "audited" },
          { fieldPath: "startsOn.value", maxAge: "unbounded", override: "forbidden" },
        ],
        feeds: [{ nodeId: "file-termination", label: "File the termination" }],
      }],
    } as const;

    it("attributes every entry to its step, with the direction the contract DECLARES", () => {
      const w = world();
      queuedEventOf(w, { seed: 1 });
      w.authority.put(runRecordOf({ seed: 1, version: 4 }));
      w.authority.putCheckpoint(crmDatesCheckpoint(1));

      for (const entry of contextData(w, ORIGIN_VIEW).entries) {
        assert.deepEqual(entry.origin, {
          nodeId: "crm-dates",
          step: "CRM dates",
          dir: "read",
          system: "crm",
        });
      }
    });

    it("serves the bound only for the field paths the descriptor declares one for", () => {
      const w = world();
      queuedEventOf(w, { seed: 1 });
      w.authority.put(runRecordOf({ seed: 1, version: 4 }));
      w.authority.putCheckpoint(crmDatesCheckpoint(1));

      const entries = contextData(w, ORIGIN_VIEW).entries;
      const invited = entries.find((entry) => entry.label === "Invited on");
      assert.deepEqual(invited?.freshness, {
        maxAge: 900_000,
        override: "audited",
        feeds: [{ nodeId: "file-termination", label: "File the termination" }],
      });
      // `unbounded` is a DECLARED limit and travels as the word — the surface,
      // not the wire, decides that an unbounded bound has no sentence.
      assert.equal(entries.find((entry) => entry.label === "Starts on")?.freshness?.maxAge, "unbounded");
      // Declared correctable, but the policy names no bound for it.
      assert.equal(entries.find((entry) => entry.label === "Completed on")?.freshness, undefined);
    });

    // D254 retired the case that stood here: "attributes a step with NO stored
    // checkpoint". D252 had already ruled that the Data section lists what the
    // run TOUCHED, so such a field is not a row — but the retired detail fold
    // could still manufacture one, reaching `editableEntryOf` with nothing
    // behind it and serving a "has no stored checkpoint yet" lock. With the
    // fold gone the caller resolves the checkpoint before it builds an entry,
    // so the arm is unrepresentable; the rule itself stays pinned by "omits a
    // declared field whose step never recorded".

    it("serves NEITHER when the build has no origin for the node (read forward, D133)", () => {
      const w = world();
      queuedEventOf(w, { seed: 1 });
      w.authority.put(runRecordOf({ seed: 1, version: 4 }));
      w.authority.putCheckpoint(crmDatesCheckpoint(1));

      for (const entry of contextData(w).entries) {
        assert.equal(entry.origin, undefined);
        assert.equal(entry.freshness, undefined);
      }
    });

    it("REFUSES a bound with no step to attribute it to", () => {
      assert.throws(
        () => ContextDataSectionSchema.parse({
          runId: uuidOf(1),
          editing: { state: "editable", expectedVersion: 4 },
          entries: [{
            label: "Invited on",
            valueRedacted: "2026-06-01",
            edit: { state: "locked", reason: "fixture" },
            freshness: { maxAge: 900_000, override: "audited", feeds: [] },
          }],
        }),
        /cannot be served without an origin/u,
      );
    });

    /*
     * D307 — the converse of "an asserted value is operator-sourced". There are
     * exactly two operator arms in authority, a correction and an assertion, and
     * a leaf claiming `operator` with neither leaf would reach the rail as an
     * unmarked row with a clock beside it: a value nobody read, drawn exactly
     * like one a task observed. The wire is where that dies, so the surface does
     * not have to invent a badge for an unnamed operator.
     */
    it("REFUSES an operator leaf that is neither a correction nor an assertion", () => {
      const operatorEntry = (extra: Record<string, string>) => ({
        runId: uuidOf(1),
        editing: { state: "editable", expectedVersion: 4 } as const,
        entries: [{
          label: "Invited on",
          valueRedacted: "2026-06-01",
          edit: { state: "locked", reason: "fixture" } as const,
          observedAt: "2026-06-01T00:00:00.000Z",
          source: "operator" as const,
          ...extra,
        }],
      });

      assert.throws(
        () => ContextDataSectionSchema.parse(operatorEntry({})),
        /either a correction or an assertion; without `correctedAt` it must name the omitted step/u,
      );
      // Both real arms still parse: a correction, and an assertion.
      assert.equal(
        ContextDataSectionSchema.parse(operatorEntry({ correctedAt: "2026-06-02T00:00:00.000Z" }))
          .entries[0]?.assertedStep,
        undefined,
      );
      assert.equal(
        ContextDataSectionSchema.parse(operatorEntry({ assertedStep: "kronos-timecard" }))
          .entries[0]?.assertedStep,
        "kronos-timecard",
      );
    });
  });
});
