import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { createConfirmedActionPublisher } from "../../../../src/backend/logs/confirmed-action-publisher.js";
import type { ConfirmedActionDraft } from "../../../../src/backend/logs/confirmed-action-publisher.js";
import { createConfirmedInvocation } from "../../../../src/backend/logs/confirmed-invocation.js";
import { createConfirmedTaskActions } from "../../../../src/backend/logs/confirmed-actions.js";
import { freezeWorkflowOperationDisplaySnapshot, WorkflowOperationDisplaySnapshotSchema } from "../../../../src/models/workflow/operation-display-snapshot.js";
import { defineTask } from "../../../../src/workflow-kit/task.js";
import type { ConfirmedTaskActions } from "../../../../src/workflow-kit/task.js";
import { recordBrowserAction, withBrowserActionSession } from "../../../../src/backend/systems/browser-shared/action-notes.js";
import type { BrowserAction } from "../../../../src/backend/systems/browser-shared/action-notes.js";
import { UCPATH_SMART_HR_CREATE_TRANSACTION_BUTTON, UCPATH_SMART_HR_DELETE_SELECTED_BUTTON } from "../../../../src/models/ui/ucpath-smart-hr-termination.js";
import { KUALI_ACTION_LIST_SEARCH_INPUT } from "../../../../src/models/ui/kuali-action-list.js";
import { UCPATH_PERSON_ORG_EID_INPUT } from "../../../../src/models/ui/ucpath-person-org.js";
import { UCPATH_SMART_HR_DETAILS_EID_INPUT } from "../../../../src/models/ui/ucpath-smart-hr-termination.js";
import { EidSchema } from "../../../../src/rules/identity/ids.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import { plan1Contract, plan1Leaf } from "../../../support/fixtures/plan1-operation-workflows.js";

const runId = "00000000-0000-4000-8000-000000000002";
const browserSession = "00000000-0000-4000-8000-000000000003";
const input = { emplId: EidSchema.parse("10800000"), text: "ready", mode: "ok" as const };
function snapshotForTest() {
  const snapshot = freezeWorkflowOperationDisplaySnapshot({ workflowId: plan1Leaf.descriptor.id,
  definitionFingerprint: plan1Leaf.descriptor.contractFingerprint,
  display: plan1Leaf.descriptor.operationDisplay });
  if (snapshot === undefined) throw new Error("complete synthetic snapshot unavailable");
  return snapshot;
}
const snapshot = snapshotForTest();

function harness(capacity = 32, frozen = snapshot,
  onEvent?: (event: import("../../../../src/models/events/confirmed-action.js").ConfirmedActionEvent) => void,
  taskInput = input) {
  const clock = manualClock(new Date("2026-10-02T12:00:00.000Z"));
  const publisherClock = manualClock(new Date("2026-10-02T12:00:00.000Z"));
  const events: Array<import("../../../../src/models/events/confirmed-action.js").ConfirmedActionEvent> = [];
  const publisher = createConfirmedActionPublisher({ workerId: "fixture-worker-1", streamId: "fixture-stream-1", clock: publisherClock,
    capacity, append: event => { events.push(event); onEvent?.(event); } });
  const invoke = async (nodeId: "first" | "second", task: ReturnType<typeof syntheticTask>, onNotes?: (notes: readonly BrowserAction[]) => void) => {
    const invocation = createConfirmedInvocation({ binding: { snapshot: frozen, runId, attempt: 2, claimGeneration: 3, taskAttempt: 4,
      nodeId, taskId: plan1Contract.id, contractRole: "task", parsedInput: taskInput, protectedBindings: [] },
      publisher, clock, headlessSystem: "service", traceId: "fpo-120000-0002" });
    return await invocation.withNotes(() => invocation.bind(() => task.impl.run({ input: taskInput,
      ctx: { signal: new AbortController().signal, log: { debug() {}, info() {}, warn() {} },
        fail: (code, message) => { throw new Error(`${code}: ${message}`); }, recordData() {}, providers: {}, confirmed: invocation.actions },
    })), notes => { onNotes?.(notes); });
  };
  return { clock, publisherClock, events, publisher, invoke };
}

function syntheticTask(verify: (value: string) => Promise<boolean>, after?: () => Promise<void>) {
  return defineTask(plan1Contract, { sessions: [], async run({ input: value, ctx }) {
    if (ctx.confirmed === undefined) throw new Error("confirmed action context missing");
    const read = await ctx.confirmed.read({ id: "consume-text", targetId: "consume-text" }, async () => value.text,
      { action: { id: "verify-consume-text", targetId: "verify-consume-text" }, purpose: "read-validation",
        observe: async () => { const valid = await verify(value.text); return valid ? value.text : "wrong"; },
        matches: observed => observed === value.text });
    await after?.();
    return { eid: value.emplId, disposition: read, providerState: read };
  } });
}

describe("confirmed action production invocation API", () => {
  it("publishes a verified fact before the task settles with exact frozen identity and distinct instants", async () => {
    let factPublished!: () => void;
    const published = new Promise<void>(resolve => { factPublished = resolve; });
    const h = harness(32, snapshot, event => { if (event.kind === "fact") factPublished(); });
    let releaseVerification!: () => void;
    let enteredVerification!: () => void;
    let releaseTask!: () => void;
    const verification = new Promise<void>(resolve => { releaseVerification = resolve; });
    const entered = new Promise<void>(resolve => { enteredVerification = resolve; });
    const taskEnd = new Promise<void>(resolve => { releaseTask = resolve; });
    const task = h.invoke("first", syntheticTask(async () => {
      enteredVerification();
      await verification;
      h.clock.advanceWall(20);
      h.publisherClock.advanceWall(40);
      return true;
    }, async () => taskEnd));
    await entered;
    try {
      assert.equal(h.events.filter(event => event.kind === "fact").length, 0);
      releaseVerification();
      await published;
      const facts = h.events.filter(event => event.kind === "fact");
      assert.equal(facts.length, 1);
      const fact = facts[0];
      assert.deepEqual(h.events.map(event => event.kind === "trace" ? `${event.action.logicalActionId}:${event.state}` : event.kind),
        ["consume-text:started", "consume-text:completed", "verify-consume-text:started", "verify-consume-text:completed", "fact"]);
      assert.equal(fact.action.invocationId, "first-operation");
      assert.equal(fact.action.nodeId, "first");
      assert.equal(fact.action.state, "confirmed");
      assert.notEqual(fact.occurredAt, fact.confirmedAt);
      assert.notEqual(fact.confirmedAt, fact.recordedAt);
    } finally {
      releaseVerification();
      releaseTask();
      await task;
    }
  });

  it("retains false and thrown verifier lifecycle without success", async () => {
    const falseCase = harness();
    await assert.rejects(falseCase.invoke("first", syntheticTask(async () => false)), /effect-not-confirmed/u);
    assert.equal(falseCase.events.filter(event => event.kind === "fact").length, 0);
    assert.ok(falseCase.events.some(event => event.kind === "trace" && event.state === "failed"));
    const thrown = harness();
    await assert.rejects(thrown.invoke("first", syntheticTask(async () => { throw new Error("selector unreadable"); })), /selector unreadable/u);
    assert.equal(thrown.events.filter(event => event.kind === "fact").length, 0);
  });

  it("shares monotonic event order across invocations and refuses append failures without changing task output", async () => {
    const h = harness();
    await h.invoke("first", syntheticTask(async () => true));
    await h.invoke("second", syntheticTask(async () => true));
    assert.deepEqual(h.events.map(event => event.sequence), h.events.map((_, index) => index + 1));
    const clock = manualClock(new Date("2026-10-02T12:00:00.000Z"));
    const failed = createConfirmedActionPublisher({ workerId: "fixture-worker-1", streamId: "fixture-stream-2", clock,
      capacity: 1, append: () => { throw new Error("disk unavailable"); } });
    assert.equal(failed.health().state, "healthy");
    const first = h.events[0];
    const { eventId, workerId, workerStreamId, sequence, recordedAt, ...draft } = first;
    assert.ok(eventId && workerId && workerStreamId && sequence && recordedAt);
    assert.equal(failed.publish(draft).state, "queued");
    assert.equal(failed.health().state, "append-failed");
    assert.deepEqual(failed.publish(draft), { state: "refused", reason: "saturated" });
    assert.equal(failed.close().pending, 1);
    assert.deepEqual(failed.publish(draft), { state: "refused", reason: "closed" });
    const malformed: unknown = { ...draft, kind: "fact", purpose: "saved-effect" };
    assert.throws(() => failed.publish(malformed as ConfirmedActionDraft), /invalid_type|Invalid input/u);
    const unconnected = createConfirmedActionPublisher({ workerId: "fixture-worker-1", streamId: "fixture-stream-3", clock,
      capacity: 1 });
    assert.deepEqual(unconnected.publish(draft), { state: "refused", reason: "unconnected" });
    assert.equal(unconnected.health().state, "unconnected");
    const recovered = createConfirmedActionPublisher({ workerId: "fixture-worker-1", streamId: "fixture-stream-4", clock,
      capacity: 1, append: () => { throw new Error("temporary append failure"); } });
    assert.equal(recovered.publish(draft).state, "queued");
    const drained: Array<import("../../../../src/models/events/confirmed-action.js").ConfirmedActionEvent> = [];
    assert.equal(recovered.drain(event => { drained.push(event); }).pending, 0);
    assert.equal(drained.length, 1);
  });

  it("selects frozen confirmed empty output and refuses unreadable or ambiguous outcomes", async () => {
    const display = plan1Leaf.descriptor.operationDisplay;
    if (display?.capability !== "complete") throw new Error("complete fixture display missing");
    const reference = { kind: "task-output" as const, entryId: "first", path: "disposition" };
    const outcome = { id: "no-pending", label: "No pending terminations", when: { kind: "is-absent" as const, value: reference } };
    type SyntheticOutcome = Readonly<{ id: string; label: string; when: Readonly<{ kind: "is-absent" | "equals"; value: typeof reference; expected?: string; expectedDigest?: string }> }>;
    const makeSnapshot = (duplicate: boolean, selectedOutcome: SyntheticOutcome = outcome) => {
      return WorkflowOperationDisplaySnapshotSchema.parse({ ...snapshot,
        invocations: snapshot.invocations.map(invocation => invocation.entryId === "first"
          ? { ...invocation, outcomes: duplicate ? [selectedOutcome, { ...selectedOutcome, id: "also-empty" }] : [selectedOutcome] } : invocation) });
    };
    const run = async (duplicate: boolean, observed: unknown = { state: "empty" }, selectedOutcome: SyntheticOutcome = outcome) => {
      const frozen = makeSnapshot(duplicate, selectedOutcome);
      const h = harness(32, frozen);
      let chosen: ConfirmedTaskActions["result"] | undefined;
      const task = defineTask(plan1Contract, { sessions: [], async run({ input: value, ctx }) {
        if (ctx.confirmed === undefined) throw new Error("confirmed context unavailable");
        assert.equal(ctx.confirmed.result().state, "unavailable");
        const confirm = () => ctx.confirmed!.confirmOutcome(frozen.invocations[0].outcomes[0].when.value,
          { action: { id: "verify-consume-text", targetId: "verify-consume-text" },
            purpose: "read-validation", observe: async () => observed, matches: value => value.state === (selectedOutcome.when.kind === "equals" ? "value" : "empty") });
        if (observed === null || (typeof observed === "object" && observed !== null && Reflect.get(observed, "state") === "unavailable")) {
          await assert.rejects(confirm(), /confirmed-outcome-unavailable/u);
        } else await confirm();
        chosen = () => ctx.confirmed!.result();
        return { eid: value.emplId, disposition: value.text, providerState: value.text };
      } });
      await h.invoke("first", task);
      return { result: chosen?.(), fact: h.events.find(event => event.kind === "fact") };
    };
    const selected = await run(false);
    assert.equal(selected.result?.state, "selected");
    if (selected.result?.state === "selected") {
      assert.equal(selected.result.label, "No pending terminations");
      assert.equal(selected.result.stepOccurrence, selected.fact?.stepOccurrence);
    }
    const valueOutcome = { id: "ready", label: "Ready", when: { kind: "equals" as const, value: reference, expected: "ready",
      expectedDigest: sha256Hex('hrauto:operation-display-static-value:v1\0"ready"') } };
    const value = await run(false, { state: "value", value: "ready" }, valueOutcome);
    assert.equal(value.result?.state, "selected");
    if (value.result?.state === "selected") {
      assert.equal(value.result.label, "Ready");
      assert.equal(value.result.stepOccurrence, value.fact?.stepOccurrence);
    }
    assert.equal((await run(true)).result?.state, "ambiguous");
    assert.equal((await run(false, null)).result?.state, "unavailable");
    assert.equal((await run(false, { state: "unavailable" })).result?.state, "unavailable");
  });

  it("refuses a browser source that disagrees with the frozen registered system", () => {
    const frozen = WorkflowOperationDisplaySnapshotSchema.parse({ ...snapshot,
      invocations: snapshot.invocations.map(invocation => invocation.entryId === "first"
        ? { ...invocation, operation: { ...invocation.operation, system: "kuali",
          session: { ...invocation.operation.session, kind: "browser", system: "kuali" } } } : invocation) });
    const clock = manualClock(new Date("2026-10-02T12:00:00.000Z"));
    assert.throws(() => createConfirmedInvocation({ binding: { snapshot: frozen, runId,
      attempt: 2, claimGeneration: 3, taskAttempt: 4, nodeId: "first", taskId: plan1Contract.id,
      contractRole: "task", parsedInput: input, protectedBindings: [] }, clock,
      registeredDriverSystem: "ucpath", traceId: "fpo-120000-0002" }), /browser-source-mismatch/u);
  });

  it("publishes only the bound verifier reference, never restricted observation payload", async () => {
    const h = harness();
    const task = defineTask(plan1Contract, { sessions: [], async run({ input: value, ctx }) {
      if (ctx.confirmed === undefined) throw new Error("confirmed context unavailable");
      await ctx.confirmed.verify({ action: { id: "verify-consume-text", targetId: "verify-consume-text" },
        purpose: "read-validation", observe: async () => ({ restricted: "fixture-secret-never-publish" }),
        matches: observed => typeof observed === "object" && observed !== null });
      return { eid: value.emplId, disposition: value.text, providerState: value.text };
    } });
    await h.invoke("first", task);
    assert.equal(h.events.filter(event => event.kind === "fact").length, 1);
    assert.equal(JSON.stringify(h.events).includes("fixture-secret-never-publish"), false);
  });

  it("withholds unclassified read output and fill value from facts, traces and raw notes", async () => {
    const secretRead = "fixture-restricted-read-object";
    const secretFill = "fixture-restricted-fill-text";
    const frozen = WorkflowOperationDisplaySnapshotSchema.parse({ ...snapshot,
      invocations: snapshot.invocations.map(invocation => invocation.entryId === "first"
        ? { ...invocation, operation: { ...invocation.operation, actions: [
          { id: "read-disposition", kind: "read-field", valueSlot: "disposition", confirmationActionId: "verify-read-disposition" },
          { id: "verify-read-disposition", kind: "verify" },
          { id: "fill-text", kind: "fill-field", valueSlot: "text", confirmationActionId: "verify-fill-text" },
          { id: "verify-fill-text", kind: "verify" },
        ] } } : invocation) });
    const h = harness(32, frozen, undefined, { ...input, text: secretFill });
    const notes: BrowserAction[] = [];
    const task = defineTask(plan1Contract, { sessions: [], async run({ input: value, ctx }) {
      if (ctx.confirmed === undefined) throw new Error("confirmed context unavailable");
      await ctx.confirmed.read({ id: "read-disposition", targetId: "read-disposition" }, async () => ({ restricted: secretRead }),
        { action: { id: "verify-read-disposition", targetId: "verify-read-disposition" }, purpose: "read-validation",
          observe: async () => true, matches: observed => observed === true });
      await ctx.confirmed.fill({ id: "fill-text", targetId: "fill-text" }, value.text, async () => {},
        { action: { id: "verify-fill-text", targetId: "verify-fill-text" }, purpose: "readback",
          observe: async () => value.text, matches: observed => observed === value.text });
      return { eid: value.emplId, disposition: value.text, providerState: value.text };
    } });
    await h.invoke("first", task, emitted => { notes.push(...emitted); });
    assert.equal(h.events.filter(event => event.kind === "fact").length, 2);
    assert.equal(JSON.stringify({ events: h.events, notes }).includes(secretRead), false);
    assert.equal(JSON.stringify({ events: h.events, notes }).includes(secretFill), false);
    assert.ok(notes.some(note => note.operation?.value?.consumed.state === "withheld"
      && note.operation.value.consumed.reason === "classification-required"));
  });

  it("retains a declared scalar value for a registered public field", async () => {
    const frozen = WorkflowOperationDisplaySnapshotSchema.parse({ ...snapshot,
      invocations: snapshot.invocations.map(invocation => invocation.entryId === "first"
        ? { ...invocation, operation: { ...invocation.operation, system: "kuali", session: { kind: "browser", id: "fixture-session", system: "kuali" },
          actions: [{ id: "fill-public", kind: "fill-field", target: KUALI_ACTION_LIST_SEARCH_INPUT, valueSlot: "text", confirmationActionId: "verify-public" },
            { id: "verify-public", kind: "verify", target: "verify-public" }] } } : invocation) });
    const clock = manualClock(new Date("2026-10-02T12:00:00.000Z"));
    const events: Array<import("../../../../src/models/events/confirmed-action.js").ConfirmedActionEvent> = [];
    const publisher = createConfirmedActionPublisher({ workerId: "fixture-worker-1", streamId: "public-stream-1", clock,
      capacity: 8, append: event => { events.push(event); } });
    const invocation = createConfirmedInvocation({ binding: { snapshot: frozen, runId, attempt: 2, claimGeneration: 3,
      taskAttempt: 4, nodeId: "first", taskId: plan1Contract.id, contractRole: "task", parsedInput: input, protectedBindings: [] },
      clock, publisher, registeredDriverSystem: "kuali", traceId: "fpo-120000-0002" });
    const notes: BrowserAction[] = [];
    await invocation.withNotes(() => withBrowserActionSession(browserSession, () => invocation.bind(async () => {
      await invocation.actions!.fill({ id: "fill-public", targetId: KUALI_ACTION_LIST_SEARCH_INPUT }, input.text, async () => {},
        { action: { id: "verify-public", targetId: "verify-public" }, purpose: "readback",
          observe: async () => input.text, matches: observed => observed === input.text });
    })), emitted => { notes.push(...emitted); });
    assert.ok(notes.some(note => note.operation?.value?.consumed.state === "observed"
      && note.operation.value.consumed.value === input.text));
    assert.equal(events.filter(event => event.kind === "fact" && event.meaning === "fill").length, 1);
  });

  it("classifies raw driver values even when a frozen action has no value slot", async () => {
    const cases = [
      { name: "restricted", system: "ucpath" as const, target: UCPATH_SMART_HR_DETAILS_EID_INPUT, visible: false },
      { name: "hr", system: "ucpath" as const, target: UCPATH_PERSON_ORG_EID_INPUT, visible: false },
      { name: "unclassified", system: "ucpath" as const, target: "fixture.unclassified", visible: false },
      { name: "public", system: "kuali" as const, target: KUALI_ACTION_LIST_SEARCH_INPUT, visible: true },
    ];
    for (const testCase of cases) {
      const marker = `fixture-${testCase.name}-raw-value`;
      const frozen = WorkflowOperationDisplaySnapshotSchema.parse({ ...snapshot,
        invocations: snapshot.invocations.map(invocation => invocation.entryId === "first"
          ? { ...invocation, operation: { ...invocation.operation, system: testCase.system,
            session: { kind: "browser", id: "fixture-session", system: testCase.system },
            actions: [{ id: "no-slot", kind: "fill-field", target: testCase.target }] } } : invocation) });
      const clock = manualClock(new Date("2026-10-02T12:00:00.000Z"));
      const invocation = createConfirmedInvocation({ binding: { snapshot: frozen, runId, attempt: 2,
        claimGeneration: 3, taskAttempt: 4, nodeId: "first", taskId: plan1Contract.id,
        contractRole: "task", parsedInput: input, protectedBindings: [] }, clock,
        registeredDriverSystem: testCase.system, traceId: "fpo-120000-0002" });
      const notes: BrowserAction[] = [];
      await invocation.withNotes(() => withBrowserActionSession(browserSession, () => invocation.bind(async () => {
        recordBrowserAction("typed", testCase.target, marker);
      })), emitted => { notes.push(...emitted); });
      assert.equal(notes.length, 1, testCase.name);
      assert.equal(notes[0].value === marker, testCase.visible, testCase.name);
      assert.equal(JSON.stringify(notes).includes(marker), testCase.visible, testCase.name);
      assert.equal(notes[0].operation?.logicalActionId, "no-slot", testCase.name);
    }
  });

  it("rejects verifier purpose misuse before its observation callback", async () => {
    const h = harness();
    let observed = 0;
    const task = defineTask(plan1Contract, { sessions: [], async run({ input: value, ctx }) {
      if (ctx.confirmed === undefined) throw new Error("confirmed context unavailable");
      const invalid = { action: { id: "verify-consume-text", targetId: "verify-consume-text" },
        purpose: "interaction-effect" as const, observe: async () => { observed += 1; return true; },
        matches: () => true };
      await assert.rejects(ctx.confirmed.verify(invalid as never), /confirmed-verification-purpose-mismatch/u);
      return { eid: value.emplId, disposition: value.text, providerState: value.text };
    } });
    await h.invoke("first", task);
    assert.equal(observed, 0);
    assert.equal(h.events.length, 0);
  });

  it("confirms registered navigation, blocks external commit, and refuses fill readback mismatch", async () => {
    const frozen = WorkflowOperationDisplaySnapshotSchema.parse({ ...snapshot,
      invocations: snapshot.invocations.map(invocation => invocation.entryId === "first"
        ? { ...invocation, operation: { ...invocation.operation, system: "ucpath",
          session: { kind: "browser", id: "fixture-session", system: "ucpath" }, actions: [
            { id: "navigate", kind: "click", target: UCPATH_SMART_HR_CREATE_TRANSACTION_BUTTON, confirmationActionId: "verify-nav" },
            { id: "verify-nav", kind: "verify", target: "verify-nav" },
            { id: "submit", kind: "click", target: UCPATH_SMART_HR_DELETE_SELECTED_BUTTON, confirmationActionId: "verify-submit" },
            { id: "verify-submit", kind: "verify", target: "verify-submit" },
            { id: "fill", kind: "fill-field", target: "fixture.fill", confirmationActionId: "verify-fill" },
            { id: "verify-fill", kind: "verify", target: "verify-fill" },
          ] } } : invocation) });
    const clock = manualClock(new Date("2026-10-02T12:00:00.000Z"));
    const events: Array<import("../../../../src/models/events/confirmed-action.js").ConfirmedActionEvent> = [];
    const publisher = createConfirmedActionPublisher({ workerId: "fixture-worker-1", streamId: "browser-stream-1", clock,
      capacity: 16, append: event => { events.push(event); } });
    const invocation = createConfirmedInvocation({ binding: { snapshot: frozen, runId, attempt: 2,
      claimGeneration: 3, taskAttempt: 4, nodeId: "first", taskId: plan1Contract.id,
      contractRole: "task", parsedInput: input, protectedBindings: [] }, clock, publisher,
      registeredDriverSystem: "ucpath", traceId: "fpo-120000-0002" });
    let externalCalls = 0;
    const retained: BrowserAction[] = [];
    await invocation.withNotes(() => withBrowserActionSession(browserSession,
      () => invocation.bind(async () => {
        const actions = invocation.actions;
        if (actions === undefined) throw new Error("confirmed API missing");
        await actions.click({ id: "navigate", targetId: UCPATH_SMART_HR_CREATE_TRANSACTION_BUTTON }, async () => {},
          { action: { id: "verify-nav", targetId: "verify-nav" }, purpose: "interaction-effect",
            observe: async () => "wizard staged", matches: value => value === "wizard staged" });
        await assert.rejects(actions.click({ id: "submit", targetId: UCPATH_SMART_HR_DELETE_SELECTED_BUTTON },
          async () => { externalCalls += 1; }, { action: { id: "verify-submit", targetId: "verify-submit" },
            purpose: "interaction-effect", observe: async () => true, matches: value => value === true }),
        /external-or-undeclared-effect/u);
        await assert.rejects(actions.fill({ id: "fill", targetId: "fixture.fill" }, "expected", async () => {},
          { action: { id: "verify-fill", targetId: "verify-fill" }, purpose: "readback",
            observe: async () => "different", matches: () => true }), /effect-not-confirmed/u);
      })), actions => { retained.push(...actions); });
    assert.equal(externalCalls, 0);
    assert.equal(events.filter(event => event.kind === "fact" && event.meaning === "interaction").length, 1);
    assert.equal(events.filter(event => event.kind === "fact" && event.meaning === "submit").length, 0);
    const stale = createConfirmedInvocation({ binding: { snapshot: frozen, runId, attempt: 2,
      claimGeneration: 3, taskAttempt: 5, nodeId: "first", taskId: plan1Contract.id,
      contractRole: "task", parsedInput: input, protectedBindings: [] }, clock, publisher,
      registeredDriverSystem: "ucpath", traceId: "fpo-120000-0002" });
    const alreadyBound = retained.find(note => note.operation?.state === "completed");
    if (alreadyBound === undefined) throw new Error("bound action fixture missing");
    assert.throws(() => stale.observingBinder(alreadyBound), /already-bound-reuse/u);
    const observer = (taskAttempt: number) => createConfirmedTaskActions({ publisher, snapshot: frozen, clock,
      source: { kind: "browser", system: "ucpath" }, runId, traceId: "fpo-120000-0002",
      attempt: 2, claimGeneration: 3, taskAttempt, nodeId: "first", taskId: plan1Contract.id,
      contractRole: "task", effectFor: () => undefined });
    await invocation.withNotes(() => withBrowserActionSession(browserSession, async () => {
      assert.throws(() => observer(5).observe(alreadyBound), /foreign-attempt/u);
    }), () => undefined);
    await invocation.withNotes(() => withBrowserActionSession("00000000-0000-4000-8000-000000000004", async () => {
      assert.throws(() => observer(4).observe(alreadyBound), /foreign-session/u);
    }), () => undefined);
    assert.equal(externalCalls, 0);
  });
});
