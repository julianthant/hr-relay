/**
 * The per-row action projection (doc 03 §2.4, doc 13 §3.2/§8.5).
 *
 * The load-bearing arm here is the LAST one. A queue row's controls are the one
 * place in this product where a projection decides what an operator may do to a
 * real HR run, and the failure mode a unit test can catch is a descriptor that
 * looks perfectly well-formed and names a command nothing behind it accepts —
 * a button that 422s, or worse, one whose verb the kernel does not implement at
 * all. So every served descriptor is walked all the way to a `CommandRequest`
 * the kernel's own union parses, and the check is run against a synthesized
 * violation so it cannot be a check that has never been observed to fail.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { z } from "zod";
import { PHASE1_ACTIVE_COMMAND_ARMS } from "../../../src/core/command-kernel.js";
import { composeCommandRequest } from "../../../src/dashboard/app/command-dispatch.js";
import {
  ActionCommandKeySchema,
  ActionDescriptorWireSchema,
  type ActionDescriptorWire,
} from "../../../src/domain/dashboard/actions.js";
import {
  QueueStatusSchema,
  QueueSurfaceWireSchema,
} from "../../../src/domain/dashboard/projection.js";
import { CommandRequestSchema } from "../../../src/domain/commands.js";
import {
  STANDARD_WORKFLOW_ACTIONS,
  WorkflowActionPolicySchema,
} from "../../../src/domain/workflow/presentation.js";
import {
  queueRowActions,
  type QueueRowActionFacts,
} from "../../../src/server/dashboard/projectors/queue-row-actions.js";

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
  /**
   * Every status, stated as a table rather than derived, because the point of
   * the table is that somebody read it: the sets below ARE the contract, and a
   * kernel precondition that moves must move a line here in the same commit.
   */
  const EXPECTED: Readonly<Record<Status, readonly string[]>> = {
    // `bump` needs a queued lifecycle (`executeBump`'s own refusal names it).
    // `rename` is on EVERY status: `executePresentation` has no state
    // precondition, so a run that has already written to UCPath can still be
    // named — which is the whole reason a rename is safe to offer (D233).
    queued: ["bump", "cancel", "rename", "hide"],
    running: ["cancel", "rename", "hide"],
    blocked: ["cancel", "rename", "hide"],
    "awaiting-approval": ["cancel", "rename", "hide"],
    // Terminal: nothing to cancel, nothing to bump, a re-run is possible.
    done: ["retry", "rename", "hide"],
    failed: ["retry", "rename", "hide"],
    cancelled: ["retry", "rename", "hide"],
    partial: ["retry", "rename", "hide"],
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

  /**
   * Doc 13 §1: the demo is the visual oracle, and its footer set is per status
   * — a queued row shows `≫` and `×`, a finished row shows `↺` and `🗑`.
   * Everything served is also at `menu`, which is what makes the right-click
   * the row's FULL set rather than a second vocabulary.
   */
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
      hide: ["menu"],
    });
    assert.deepEqual(placements("done"), {
      retry: ["footer", "menu"],
      rename: ["menu"],
      hide: ["footer", "menu"],
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

  /**
   * `executeRetry` refuses a delegated child by name ("child retries route
   * through their delegation edge policy, not generic retry"), so a member row
   * that drew a `↺` would be drawing a button that always refuses.
   */
  it("drops retry for a delegated child, and keeps hide", () => {
    assert.deepEqual(keysFor("failed", { isChild: true }), ["rename", "hide"]);
    assert.deepEqual(keysFor("failed"), ["retry", "rename", "hide"]);
  });

  /**
   * A MEMBER row loses `rename`, and it is the one narrowing in this file that
   * is not a kernel precondition. `displayName` REPLACES the title on the row
   * it rides, so naming a member would put free text where the group's list
   * prints the person that item is about. A `linked` child keeps its control:
   * it is a row read on its own, not one line of somebody's tally.
   */
  it("drops rename for a delegated MEMBER, and keeps it for every other row", () => {
    assert.deepEqual(keysFor("running", { isMember: true }), ["cancel", "hide"]);
    assert.deepEqual(keysFor("running", { isChild: true }), ["cancel", "rename", "hide"]);
  });

  /** The label states which act this is; the server knows whether a name exists. */
  it("names an unnamed run and renames a named one", () => {
    const labelFor = (named: boolean): string | undefined =>
      queueRowActions(STANDARD_WORKFLOW_ACTIONS, factsFor("done", { named }))
        .find(({ key }) => key === "rename")?.label;
    assert.equal(labelFor(false), "Name this run\u2026");
    assert.equal(labelFor(true), "Rename run\u2026");
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

  /**
   * The one difference a rehearsal makes to a control: a dry run's re-run
   * cannot file anything, and the dialog's tone is the last place that shows.
   */
  it("softens the re-run confirmation for a rehearsal and names the park for a parked write", () => {
    const real = queueRowActions(STANDARD_WORKFLOW_ACTIONS, factsFor("failed"))[0];
    const rehearsal = queueRowActions(STANDARD_WORKFLOW_ACTIONS, factsFor("failed", { dryRun: true }))[0];
    assert.ok(real?.kind === "command" && rehearsal?.kind === "command");
    assert.equal(real.confirm?.tone, "destructive");
    assert.equal(rehearsal.confirm?.tone, "neutral");
    assert.match(rehearsal.confirm?.body ?? "", /rehearsal performs no real/);

    const parked = queueRowActions(STANDARD_WORKFLOW_ACTIONS, factsFor("blocked", { parkedWrite: true }))[0];
    assert.ok(parked?.kind === "command" && parked.command === "cancel");
    assert.match(parked.confirm?.body ?? "", /outcome is UNKNOWN/);
  });

  /**
   * A workflow this build cannot describe gets no controls. Guessing a default
   * set onto a run whose descriptor is not registered would be inventing a
   * policy the workflow never declared — the same refusal `#pipeline` makes
   * when it serves only observed nodes.
   */
  it("serves nothing for a workflow with no registered descriptor", () => {
    assert.deepEqual(queueRowActions(undefined, factsFor("queued")), []);
  });

  /** Doc 03 §2.4's closed condition rules narrow a policy; they never widen it. */
  it("honours a descriptor condition that narrows an enabled action", () => {
    const policy = WorkflowActionPolicySchema.parse({
      enabled: ["retry", "cancel", "bump", "hide"],
      conditions: [{ action: "cancel", requires: "gate-open" }],
    });
    const keys = (status: Status): string[] =>
      queueRowActions(policy, factsFor(status)).map(({ key }) => key);
    assert.deepEqual(keys("awaiting-approval"), ["cancel", "hide"]);
    assert.deepEqual(keys("running"), ["hide"], "a condition that does not hold must remove the action");
    // The policy above does not enable `rename`, and the projection cannot add
    // an action a descriptor never declared — the narrowing runs both ways.
    // Enabling something the projection never serves cannot conjure it.
    const wide = WorkflowActionPolicySchema.parse({
      enabled: ["retry", "cancel", "bump", "rename", "hide", "unhide", "open-review", "open-evidence"],
    });
    assert.deepEqual(
      queueRowActions(wide, factsFor("queued")).map(({ key }) => key),
      ["bump", "cancel", "rename", "hide"],
    );
  });
});

describe("queue-row action descriptors — the CAS binding", () => {
  /**
   * Doc 13 §3.2: the row carries "a monotonic `rowRevision` used by commands
   * and patches". A descriptor is the thing that CARRIES that revision to the
   * command, so a projection that stamped anything else would produce controls
   * that conflict on click for a reason the operator cannot see.
   */
  it("binds every served descriptor to the row's own revision", () => {
    for (const status of QueueStatusSchema.options) {
      for (const revision of [1, 7, 4096]) {
        const served = queueRowActions(STANDARD_WORKFLOW_ACTIONS, factsFor(status, { rowRevision: revision }));
        assert.ok(served.length > 0, `${status} served no action to bind`);
        for (const action of served) {
          assert.ok(action.kind === "command");
          assert.equal(action.expectedVersion, revision, `${status}/${action.key}`);
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

  /**
   * The whole path, not just the vocabulary: a served descriptor must compose
   * into an envelope `CommandRequestSchema` parses. This is what proves the
   * control is reachable rather than merely well-named — `command-dispatch.ts`
   * is exhaustive over the served vocabulary and REFUSES the verbs whose
   * payloads it cannot compose from served facts, so a projection that started
   * serving one of those would fail here rather than on the operator's click.
   */
  it("composes every served descriptor into a request the kernel's own union parses", () => {
    for (const action of served) {
      assert.ok(action.kind === "command");
      const composed = composeCommandRequest(
        action,
        { runId: uuid(1), expectedVersion: action.expectedVersion },
        {
          actorId: "local-operator",
          source: "queue",
          // The one served verb carrying a value only a human authors (D233).
          // Supplying it here is what makes this a composition test rather
          // than a re-assertion of the refusal the next case owns.
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

  /**
   * D233's refusal, through the same entry point. A `rename` descriptor can
   * reach the generic dispatcher — from the row's context menu, if a surface
   * forgets to intercept it — and the only honest answer there is a refusal:
   * a name this composer chose would be a value nobody authored landing on a
   * run record, which is the substitution the gate's own arms already refuse.
   */
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

  /**
   * The negative control, through the SAME entry point. A check that has never
   * been observed to fail is indistinguishable from one that cannot — and the
   * three verbs below are exactly the ones a future projection would be tempted
   * to serve from a row: `unhide` has no row to ride (a hidden run leaves the
   * queue), and the two write resolutions are answered by the parked-write
   * dialog, which is the only surface that can carry the evidence note.
   */
  it("catches a synthesized descriptor whose verb this path cannot send", () => {
    const unreachable = ["unhide", "resolve-write-present", "resolve-write-absent"] as const;
    for (const command of unreachable) {
      assert.ok(
        !served.some((action) => action.kind === "command" && action.command === command),
        `the projection serves "${command}", which this test asserts it must not`,
      );
    }
    // (a) `unhide` IS a live kernel verb, so the vocabulary check alone would
    //     pass it; what refuses it is that no queue row can exist for a hidden
    //     run. Stated here so the exclusion is a decision, not an oversight.
    assert.ok((PHASE1_ACTIVE_COMMAND_ARMS.run as readonly string[]).includes("unhide"));
    // (b) a verb the kernel does not implement at all must fail the vocabulary
    //     check — this is the arm that catches an invented control.
    assert.ok(!(ActionCommandKeySchema.options as readonly string[]).includes("force-done"));
    assert.ok(!(PHASE1_ACTIVE_COMMAND_ARMS.run as readonly string[]).includes("force-done"));
    // (c) the two write resolutions are in the vocabulary AND active, and the
    //     dispatcher still refuses them by name — so serving one from a row
    //     would produce a control that cannot send, and this is the check that
    //     would catch it.
    const refused = composeCommandRequest(
      ActionDescriptorWireSchema.parse({
        kind: "command", command: "resolve-write-absent", key: "x", label: "x",
        intent: "neutral", placement: ["footer"], expectedVersion: 1,
        writeTarget: { writeIntentId: uuid(4), intentGeneration: 1 },
      }) as Extract<ActionDescriptorWire, { kind: "command" }>,
      { runId: uuid(1), expectedVersion: 1 },
      { actorId: "local-operator", source: "queue" },
    );
    assert.equal(refused.state, "refused");
  });
});
