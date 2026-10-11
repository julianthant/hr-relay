
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { z } from "zod";
import { PHASE1_ACTIVE_COMMAND_ARMS } from "../../../../../../src/backend/runs/commands/command-kernel.js";
import { composeCommandRequest } from "../../../../../../src/dashboard/app/commands/command-dispatch.js";
import {
  ActionCommandKeySchema,
  ActionDescriptorWireSchema,
  type ActionDescriptorWire,
} from "../../../../../../src/models/dashboard/actions.js";
import {
  QueueStatusSchema,
  QueueSurfaceWireSchema,
} from "../../../../../../src/models/dashboard/projection.js";
import { CommandRequestSchema } from "../../../../../../src/rules/commands/commands.js";
import {
  STANDARD_WORKFLOW_ACTIONS,
  WorkflowActionPolicySchema,
} from "../../../../../../src/models/workflow/presentation.js";
import {
  queueRowActions,
  type QueueRowActionFacts,
} from "../../../../../../src/backend/runs/projections/queue-row-actions.js";

type Status = z.infer<typeof QueueStatusSchema>;

const NOW = "2026-08-14T17:00:00.000Z";
const HASH = "a".repeat(64);
const uuid = (n: number): string => {
  const digits = String(n).padStart(12, "0");
  return `${digits.slice(0, 8)}-${digits.slice(8, 12)}-4000-8000-${digits}`;
};

function factsFor(status: Status, over: Partial<QueueRowActionFacts> = {}): QueueRowActionFacts {
  return {
    status,
    rowRevision: 7,
    dryRun: false,
    isChild: false,
    parkedWrite: false,
    memberCount: 0,
    isMember: false,
    named: false,
    workflowLabel: "Person Lookup",
    hasReviewPanel: false,
    ...over,
  };
}

const keysFor = (status: Status, over: Partial<QueueRowActionFacts> = {}): string[] =>
  queueRowActions(STANDARD_WORKFLOW_ACTIONS, factsFor(status, over)).map(({ key }) => key);

/** The whole row, so the wire's own CAS/uniqueness refinement is the assertion. */
function surfaceFor(status: Status, over: Partial<QueueRowActionFacts> = {}): unknown {
  const facts = factsFor(status, over);
  const terminal = ["done", "failed", "cancelled", "partial"].includes(status);
  return QueueSurfaceWireSchema.parse({
    runId: uuid(1),
    itemId: uuid(2),
    workflowId: "person-lookup",
    traceId: "pl-120000-1111",
    attempt: 1,
    lineage: facts.isChild ? { state: "child", parentRunId: uuid(3) } : { state: "root" },
    actorId: "local-operator",
    appVersion: { state: "present", value: "0.1.0" },
    descriptorVersion: 1,
    descriptorHash: HASH,
    configFingerprint: HASH,
    resolvedInstances: [],
    dryRun: facts.dryRun,
    priority: "interactive",
    runNumber: { state: "present", value: 1 },
    session: { state: "absent", reason: "This fixture has no run session." },
    // A delegated child of a non-operation parent is `linked`: it keeps its own
    // row, so `executeRetry` refusing it is the shape this fixture exercises.
    containment: facts.isChild ? "linked" : "root",
    linkedRuns: [],
    facts: { state: "absent", reason: `run is ${status} and has no served facts in this fixture` },
    startedAt: NOW,
    updatedAt: NOW,
    endedAt: terminal
      ? { state: "present", value: NOW }
      : { state: "absent", reason: `run is ${status} and has not ended` },
    gateOpenedAt: status === "awaiting-approval"
      ? { state: "present", value: NOW }
      : { state: "absent", reason: `run is ${status} and is not waiting on a gate` },
    title: "A run",
    displayName: { state: "absent", reason: "the operator has not renamed this run" },
    subtitle: { state: "absent", reason: "none planned" },
    status,
    liveMessage: { state: "absent", reason: "no message" },
    warnings: { state: "absent", reason: "no warning set has been derived" },
    pipeline: [],
    panelKind: facts.isChild ? "member" : "run",
    availableSections: ["logs"],
    actions: queueRowActions(STANDARD_WORKFLOW_ACTIONS, facts),
    rowRevision: facts.rowRevision,
    surfaceKind: facts.isChild ? "member" : "single",
  });
}

describe("queue-row action descriptors — the per-status set", () => {
  // The explicit status table is an independent contract, not a derivation from the implementation.
  const EXPECTED: Readonly<Record<Status, readonly string[]>> = {

    queued: ["bump", "cancel", "rename"],
    running: ["cancel", "rename"],
    cancelling: ["cancel", "rename"],
    blocked: ["cancel", "rename"],
    "awaiting-approval": ["cancel", "rename"],

    done: ["rerun", "rename", "delete"],
    failed: ["rerun", "rename", "delete"],
    cancelled: ["rename", "delete"],
    partial: ["rerun", "rename", "delete"],
  };

  it("serves exactly the declared set for every queue status", () => {
    // The sweep is only evidence if it covered the whole enum.
    assert.deepEqual(
      Object.keys(EXPECTED).sort(),
      [...QueueStatusSchema.options].sort(),
      "the expected table does not cover every QueueStatusSchema member",
    );
    for (const status of QueueStatusSchema.options) {
      assert.deepEqual(keysFor(status), [...(EXPECTED[status] ?? [])], `queue status ${status}`);
    }
  });


  it("puts the demo's frequent commands in the footer and everything in the menu", () => {
    const placements = (status: Status): Record<string, readonly string[]> =>
      Object.fromEntries(
        queueRowActions(STANDARD_WORKFLOW_ACTIONS, factsFor(status)).map((a) => [a.key, a.placement]),
      );
    assert.deepEqual(placements("queued"), {
      bump: ["footer", "menu"],
      cancel: ["footer", "menu"],
      // Menu-only in both states, and in the demo: the footer is the FREQUENT
      // subset, and naming a run is something an operator does once.
      rename: ["menu"],
    });
    assert.deepEqual(placements("done"), {
      rerun: ["footer", "menu", "data"],
      rename: ["menu"],

      delete: ["footer", "menu"],
    });
    for (const status of QueueStatusSchema.options) {
      for (const action of queueRowActions(STANDARD_WORKFLOW_ACTIONS, factsFor(status))) {
        assert.ok(
          action.placement.includes("menu"),
          `${status}/${action.key} is served without the menu placement, so the right-click is not the full set`,
        );
      }
    }
  });


  it("drops Rerun for a delegated child, and keeps rename", () => {
    assert.deepEqual(keysFor("failed", { isChild: true }), ["rename"]);
    assert.deepEqual(keysFor("failed"), ["rerun", "rename", "delete"]);
  });


  it("drops rename for a delegated MEMBER, and keeps it for every other row", () => {
    assert.deepEqual(keysFor("running", { isMember: true }), ["cancel"]);
    assert.deepEqual(keysFor("running", { isChild: true }), ["cancel", "rename"]);
  });

  /** The label states which act this is; the server knows whether a name exists. */
  it("names an unnamed run and renames a named one", () => {
    const labelFor = (named: boolean): string | undefined =>
      queueRowActions(STANDARD_WORKFLOW_ACTIONS, factsFor("done", { named }))
        .find(({ key }) => key === "rename")?.label;
    assert.equal(labelFor(false), "Name this run\u2026");
    assert.equal(labelFor(true), "Rename run\u2026");
  });


  it("never offers Archive in dashboard actions", () => {
    for (const status of QueueStatusSchema.options) {
      const archive = queueRowActions(STANDARD_WORKFLOW_ACTIONS, factsFor(status)).find(action => action.key === "archive");
      assert.equal(archive, undefined);
      assert.ok(!keysFor(status, { isChild: true }).includes("archive"));
    }
  });

  it("serves delete on every terminal row and on no other, never for a delegated child", () => {
    const TERMINAL: readonly Status[] = ["done", "failed", "cancelled", "partial"];
    for (const status of QueueStatusSchema.options) {
      const keys = keysFor(status);
      if (TERMINAL.includes(status)) {
        assert.equal(keys.at(-1), "delete", `${status} did not serve delete last`);
      } else {
        assert.ok(!keys.includes("delete"), `${status} is not terminal but served delete`);
      }
      // Neither shape of delegated child may draw it: the kernel takes the
      // whole tree from its anchor, leaves-first.
      assert.ok(
        !keysFor(status, { isChild: true }).includes("delete"),
        `${status}/child served delete, which executeDelete refuses by name`,
      );
      assert.ok(
        !keysFor(status, { isChild: true, isMember: true }).includes("delete"),
        `${status}/member served delete, which executeDelete refuses by name`,
      );
    }
  });

  // The delete warning is unconditional; the projector cannot know whether a terminal run fenced a write.
  it("names the released idempotency key, the rows, and the group in the delete confirm", () => {
    const single = queueRowActions(STANDARD_WORKFLOW_ACTIONS, factsFor("done"))
      .find(({ key }) => key === "delete");
    assert.ok(single?.kind === "command" && single.command === "delete");
    assert.equal(single.label, "Delete run");
    assert.equal(single.intent, "destructive");
    assert.equal(single.icon, "delete");
    assert.equal(single.confirm?.title, "Delete this run");
    assert.equal(single.confirm?.confirmLabel, "Delete");
    assert.equal(single.confirm?.tone, "destructive");
    assert.match(single.confirm?.body ?? "", /results, checkpoints, receipts, diagnostics, and its write ledger/);
    assert.match(
      single.confirm?.body ?? "",
      /permanent idempotency key that stops the same write from being submitted twice is released with it/,
    );
    assert.match(single.confirm?.body ?? "", /Person Lookup's systems/);
    assert.match(single.confirm?.body ?? "", /This is final; there is no undo\./);

    const group = queueRowActions(STANDARD_WORKFLOW_ACTIONS, factsFor("failed", { memberCount: 9 }))
      .find(({ key }) => key === "delete");
    assert.ok(group?.kind === "command");
    assert.equal(group.label, "Delete group");
    assert.equal(group.confirm?.title, "Delete this group");
    assert.match(group.confirm?.body ?? "", /its 9 delegated members with it/);
    // The idempotency sentence does not become optional for a group.
    assert.match(group.confirm?.body ?? "", /permanent idempotency key/);
  });

  /** The demo's group row: one key `FooterActions` titles with the blast radius. */
  it("names the cancel of an operation `cancel-tree` and counts its members", () => {
    const [cancel] = queueRowActions(
      STANDARD_WORKFLOW_ACTIONS,
      factsFor("running", { memberCount: 12 }),
    );
    assert.equal(cancel?.key, "cancel-tree");
    assert.equal(cancel?.label, "Cancel group");
    assert.ok(cancel?.kind === "command");
    assert.match(cancel.confirm?.body ?? "", /12 delegated members/);
  });


  it("opens the source-bound modal for live and rehearsal sources; blocks uncertain writes", () => {
    const real = queueRowActions(STANDARD_WORKFLOW_ACTIONS, factsFor("failed"))[0];
    const rehearsal = queueRowActions(STANDARD_WORKFLOW_ACTIONS, factsFor("failed", { dryRun: true }))[0];
    assert.ok(real?.kind === "navigation" && real.navigate.kind === "rerun");
    assert.ok(rehearsal?.kind === "navigation" && rehearsal.navigate.kind === "rerun");
    assert.equal(real.navigate.expectedVersion, 7); assert.equal(rehearsal.navigate.expectedVersion, 7);
    assert.equal(keysFor("failed", { parkedWrite: true }).includes("rerun"), false);


    const parked = queueRowActions(STANDARD_WORKFLOW_ACTIONS, factsFor("blocked", { parkedWrite: true }))[0];
    assert.ok(parked?.kind === "command" && parked.command === "cancel");
    assert.match(parked.confirm?.body ?? "", /outcome is UNKNOWN/);
    assert.match(parked.confirm?.body ?? "", /REFUSED until that write is answered/);
    assert.match(parked.confirm?.body ?? "", /present or absent/);
  });


  it("serves nothing for a workflow with no registered descriptor", () => {
    assert.deepEqual(queueRowActions(undefined, factsFor("queued")), []);
  });

  /** Ref dashboard-surfaces §2.4's closed condition rules narrow a policy; they never widen it. */
  it("honours a descriptor condition that narrows an enabled action", () => {
    const policy = WorkflowActionPolicySchema.parse({
      enabled: ["retry", "cancel", "bump", "rename"],
      conditions: [{ action: "cancel", requires: "gate-open" }],
    });
    const keys = (status: Status): string[] =>
      queueRowActions(policy, factsFor(status)).map(({ key }) => key);
    assert.deepEqual(keys("awaiting-approval"), ["cancel", "rename"]);
    assert.deepEqual(keys("running"), ["rename"], "a condition that does not hold must remove the action");

    const wide = WorkflowActionPolicySchema.parse({
      enabled: ["retry", "cancel", "bump", "rename", "edit-checkpoint", "open-review", "open-evidence"],
    });
    assert.deepEqual(
      queueRowActions(wide, factsFor("queued")).map(({ key }) => key),
      ["bump", "cancel", "rename"],
    );
  });
});

describe("queue-row action descriptors — the CAS binding", () => {

  it("binds every served descriptor to the row's own revision", () => {
    for (const status of QueueStatusSchema.options) {
      for (const revision of [1, 7, 4096]) {
        const served = queueRowActions(STANDARD_WORKFLOW_ACTIONS, factsFor(status, { rowRevision: revision }));
        assert.ok(served.length > 0, `${status} served no action to bind`);
        for (const action of served) {
          if (action.kind === "navigation") {
            assert.equal(action.navigate.kind, "rerun");
            if (action.navigate.kind !== "rerun") throw new Error("unexpected navigation");
            assert.equal(action.navigate.expectedVersion, revision);
          } else { assert.ok(action.kind === "command"); assert.equal(action.expectedVersion, revision, `${status}/${action.key}`); }
        }
      }
      // And the wire itself refuses any other binding — the surface below is
      // built by the SAME projection call the projector makes.
      assert.doesNotThrow(() => surfaceFor(status));
    }
  });

  it("refuses a row whose served action names a different revision", () => {
    const surface = surfaceFor("queued") as { actions: { expectedVersion: number }[] };
    const drifted = {
      ...surface,
      actions: surface.actions.map((action, index) => (
        index === 0 ? { ...action, expectedVersion: 8 } : action
      )),
    };
    assert.equal(QueueSurfaceWireSchema.safeParse(drifted).success, false);
  });
});

describe("queue-row action descriptors — every served verb has a command behind it", () => {
  const served = QueueStatusSchema.options.flatMap((status) => [
    ...queueRowActions(STANDARD_WORKFLOW_ACTIONS, factsFor(status)),
    ...queueRowActions(STANDARD_WORKFLOW_ACTIONS, factsFor(status, { isChild: true, memberCount: 0 })),
    ...queueRowActions(STANDARD_WORKFLOW_ACTIONS, factsFor(status, { memberCount: 3 })),
  ]);

  it("names only verbs the command service registers as ACTIVE today", () => {
    assert.ok(served.length > 0, "the sweep collected no descriptors at all");
    const active: readonly string[] = PHASE1_ACTIVE_COMMAND_ARMS.run;
    for (const action of served) {
      if (action.kind === "navigation") { assert.equal(action.key, "rerun"); assert.equal(action.navigate.kind, "rerun"); continue; }
      assert.ok(action.kind === "command", `${action.key} is not a command descriptor`);
      assert.ok(
        (ActionCommandKeySchema.options as readonly string[]).includes(action.command),
        `served "${action.command}" is not in the wire's own command vocabulary`,
      );
      assert.ok(
        active.includes(action.command),
        `served "${action.command}" is not in the kernel's ACTIVE run arms; a control the command `
        + "service would answer capability-unavailable for is a button that lies",
      );
    }
  });


  it("composes every served descriptor into a request the kernel's own union parses", () => {
    for (const action of served) {
      if (action.kind === "navigation") {
        assert.equal(ActionDescriptorWireSchema.parse(action).kind, "navigation");
        assert.equal("command" in action, false);
        continue;
      }
      assert.ok(action.kind === "command");
      const composed = composeCommandRequest(
        action,
        { runId: uuid(1), expectedVersion: action.expectedVersion },
        {
          actorId: "local-operator",
          source: "queue",

          renameAnswer: "Friday exception pack",
        },
      );
      assert.equal(
        composed.state,
        "ready",
        `${action.key} refused composition: ${composed.state === "refused" ? composed.reason : ""}`,
      );
      const parsed = CommandRequestSchema.safeParse(composed.request);
      assert.ok(parsed.success, `${action.key} composed an envelope the kernel refuses`);
    }
  });


  it("refuses a rename with no name, and one the display-name schema would reject", () => {
    const rename = served.find((action) => action.kind === "command" && action.command === "rename");
    assert.ok(rename?.kind === "command", "the projection served no rename to test");
    const target = { runId: uuid(1), expectedVersion: rename.expectedVersion };
    const base = { actorId: "local-operator", source: "queue" } as const;

    const unanswered = composeCommandRequest(rename, target, base);
    assert.equal(unanswered.state, "refused");
    if (unanswered.state === "refused") assert.match(unanswered.reason, /no name was supplied/);

    // Blank, and blank-after-trim, are the same refusal: the field's own rule
    // is what answers, so the operator never meets a kernel error instead.
    for (const blank of ["", "   "]) {
      const composed = composeCommandRequest(rename, target, { ...base, renameAnswer: blank });
      assert.equal(composed.state, "refused", `"${blank}" composed a rename`);
    }

    // A bound the KERNEL holds, refused where it is typed rather than on the
    // wire: 121 code points against `RunDisplayNameSchema`'s 120.
    const tooLong = composeCommandRequest(rename, target, { ...base, renameAnswer: "x".repeat(121) });
    assert.equal(tooLong.state, "refused");

    // And a name that IS sendable composes an envelope the kernel parses, with
    // the operator's text trimmed and nothing else changed about it.
    const ok = composeCommandRequest(rename, target, { ...base, renameAnswer: "  Friday exception pack  " });
    assert.equal(ok.state, "ready");
    if (ok.state !== "ready") return;
    const parsed = CommandRequestSchema.safeParse(ok.request);
    assert.ok(parsed.success);
    if (!parsed.success) return;
    assert.equal(parsed.data.family, "run");
    assert.equal(parsed.data.type, "rename");
    assert.deepEqual(
      parsed.data.type === "rename" ? parsed.data.payload : undefined,
      { displayName: "Friday exception pack" },
    );
    // CAS-bound to the descriptor's own revision, like every other verb.
    assert.equal(parsed.data.target.expectedVersion, rename.expectedVersion);
  });


  it("catches a synthesized descriptor whose verb this path cannot send", () => {
    const unreachable = ["edit-checkpoint", "resolve-write-present", "resolve-write-absent"] as const;
    for (const command of unreachable) {
      assert.ok(
        !served.some((action) => action.kind === "command" && action.command === command),
        `the projection serves "${command}", which this test asserts it must not`,
      );
    }

    assert.ok(!(PHASE1_ACTIVE_COMMAND_ARMS.run as readonly string[]).includes("edit-checkpoint"));
    // (b) a verb the kernel does not implement at all must fail the vocabulary
    //     check — this is the arm that catches an invented control.
    assert.ok(!(ActionCommandKeySchema.options as readonly string[]).includes("force-done"));
    assert.ok(!(PHASE1_ACTIVE_COMMAND_ARMS.run as readonly string[]).includes("force-done"));

    const refused = composeCommandRequest(
      ActionDescriptorWireSchema.parse({
        kind: "command", command: "resolve-write-absent", key: "x", label: "x",
        intent: "neutral", placement: ["footer"], expectedVersion: 1,
        writeTarget: { writeIntentId: uuid(4), intentGeneration: 1, writeAttemptId: uuid(5),
          bindingProofDigest: "a".repeat(64), occurrenceKeyDigest: "b".repeat(64) },
      }) as Extract<ActionDescriptorWire, { kind: "command" }>,
      { runId: uuid(1), expectedVersion: 1 },
      { actorId: "local-operator", source: "queue" },
    );
    assert.equal(refused.state, "refused");
  });
});
