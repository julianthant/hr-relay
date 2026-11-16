import assert from "node:assert/strict";
import { it } from "vitest";
import { ApplicationLifecycleSchema } from "../../../src/models/dashboard/application-lifecycle.js";
import { RunStateSchema, type RunState } from "../../../src/models/run/record.js";
import { applicationPauseOf, applicationStateOf, interruptTransition, pendingInterruptOf, type InterruptRefusal, type InterruptTransition, type PendingInterrupt } from "../../../src/rules/runs/run-interrupt.js";

const RUN_STATES = RunStateSchema.options;
const PAUSES = ["absent", "requested", "paused"] as const;

// Columns: pause absent, requested, paused; first row without a stop request, second with one.
const PENDING: Record<RunState, readonly [readonly PendingInterrupt[], readonly PendingInterrupt[]]> = {
  queued: [["none", "pause-requested", "paused"], ["stop-requested", "stop-requested", "stop-requested"]],
  claimed: [["none", "pause-requested", "paused"], ["stop-requested", "stop-requested", "stop-requested"]],
  validating: [["none", "pause-requested", "paused"], ["stop-requested", "stop-requested", "stop-requested"]],
  running: [["none", "pause-requested", "paused"], ["stop-requested", "stop-requested", "stop-requested"]],
  "parked-gate": [["none", "pause-requested", "paused"], ["stop-requested", "stop-requested", "stop-requested"]],
  "parked-write": [["none", "pause-requested", "paused"], ["stop-requested", "stop-requested", "stop-requested"]],
  terminal: [["none", "none", "none"], ["none", "none", "none"]],
};

it("answers which interrupt is pending for every lifecycle, pause and stop combination", () => {
  assert.deepEqual(Object.keys(PENDING).sort(), [...RUN_STATES].sort());
  for (const state of RUN_STATES) {
    for (const stop of [false, true]) {
      PAUSES.forEach((pause, column) => {
        const facts = { lifecycle: { state }, ...(pause === "absent" ? {} : { pause: { state: pause } }), ...(stop ? { cancelRequested: true as const } : {}) };
        assert.equal(pendingInterruptOf(facts), PENDING[state][stop ? 1 : 0][column], `${state}, pause ${pause}, stop ${String(stop)}`);
      });
    }
  }
});

const INTERRUPTS = ["none", "pause-requested", "paused", "stop-requested"] as const satisfies readonly PendingInterrupt[];
type Expected = PendingInterrupt | `!${InterruptRefusal}`;
type Row = readonly [none: Expected, pauseRequested: Expected, paused: Expected, stopRequested: Expected];
const CLAIMED_ROW = (row: Row) => ({ claimed: row, validating: row, running: row });

// Columns follow INTERRUPTS: the pending interrupt before the event.
const OPERATOR_EVENTS: Record<"pause" | "resume" | "stop" | "acknowledge-pause", Record<RunState, Row>> = {
  pause: {
    queued: ["paused", "pause-requested", "paused", "!stop-pending"],
    ...CLAIMED_ROW(["pause-requested", "pause-requested", "paused", "!stop-pending"]),
    "parked-gate": ["paused", "pause-requested", "paused", "!stop-pending"],
    "parked-write": ["!write-parked", "!write-parked", "!write-parked", "!write-parked"],
    terminal: ["!settled", "!settled", "!settled", "!settled"],
  },
  // Resume before a requested pause takes effect withdraws it.
  resume: {
    queued: ["!not-paused", "none", "none", "!stop-pending"],
    ...CLAIMED_ROW(["!not-paused", "none", "none", "!stop-pending"]),
    "parked-gate": ["!not-paused", "none", "none", "!stop-pending"],
    "parked-write": ["!write-parked", "!write-parked", "!write-parked", "!write-parked"],
    terminal: ["!settled", "!settled", "!settled", "!settled"],
  },
  stop: {
    queued: ["stop-requested", "stop-requested", "stop-requested", "stop-requested"],
    ...CLAIMED_ROW(["stop-requested", "stop-requested", "stop-requested", "stop-requested"]),
    "parked-gate": ["!no-worker", "!no-worker", "!no-worker", "stop-requested"],
    "parked-write": ["!write-parked", "!write-parked", "!write-parked", "!write-parked"],
    terminal: ["!settled", "!settled", "!settled", "!settled"],
  },
  "acknowledge-pause": {
    queued: ["!not-pause-requested", "!no-worker", "!not-pause-requested", "!stop-pending"],
    // A worker that stopped for a pause Resume has since withdrawn releases the run with nothing pending.
    ...CLAIMED_ROW(["none", "paused", "!not-pause-requested", "!stop-pending"]),
    "parked-gate": ["!not-pause-requested", "!no-worker", "!not-pause-requested", "!stop-pending"],
    "parked-write": ["!write-parked", "!write-parked", "!write-parked", "!write-parked"],
    terminal: ["!settled", "!settled", "!settled", "!settled"],
  },
};

const factsOf = (state: RunState, interrupt: PendingInterrupt) => ({
  lifecycle: { state },
  ...(interrupt === "pause-requested" ? { pause: { state: "requested" as const } } : interrupt === "paused" ? { pause: { state: "paused" as const } } : {}),
  ...(interrupt === "stop-requested" ? { cancelRequested: true as const } : {}),
});
const answerOf = (transition: InterruptTransition): Expected => transition.state === "applied" ? transition.interrupt : `!${transition.reason}`;

it("walks every operator and worker event over every lifecycle and pending interrupt", () => {
  for (const [kind, table] of Object.entries(OPERATOR_EVENTS) as [keyof typeof OPERATOR_EVENTS, Record<RunState, Row>][]) {
    assert.deepEqual(Object.keys(table).sort(), [...RUN_STATES].sort());
    for (const state of RUN_STATES) {
      // A settled run carries no pending interrupt, so only its first column is reachable.
      for (const [column, interrupt] of INTERRUPTS.entries()) {
        if (state === "terminal" && interrupt !== "none") continue;
        assert.equal(answerOf(interruptTransition(factsOf(state, interrupt), { kind })), table[state][column], `${kind} on ${state} with ${interrupt}`);
      }
    }
  }
});

it("refuses pause on a terminal run whatever its stale pause and stop fields say", () => {
  for (const pause of PAUSES) for (const stop of [false, true]) {
    const facts = { lifecycle: { state: "terminal" as const }, ...(pause === "absent" ? {} : { pause: { state: pause } }), ...(stop ? { cancelRequested: true as const } : {}) };
    assert.deepEqual(interruptTransition(facts, { kind: "pause" }), { state: "refused", reason: "settled" });
  }
});

// Lifecycle edges that change or refuse the interrupt; every other edge keeps it.
const LIFECYCLE_EXCEPTIONS: readonly (readonly [from: RunState, to: RunState, interrupt: PendingInterrupt, answer: Expected])[] = [
  ...(["claimed", "validating", "running"] as const).flatMap(from => [
    [from, "queued", "pause-requested", "paused"] as const,
    [from, "parked-gate", "pause-requested", "paused"] as const,
  ]),
  // A new claim, not an in-place update of a claimed run such as a heartbeat.
  ...(["queued", "parked-gate", "parked-write"] as const).flatMap(from => [
    [from, "claimed", "pause-requested", "!pause-pending"] as const,
    [from, "claimed", "paused", "!pause-pending"] as const,
  ]),
];

it("walks every lifecycle change over every pending interrupt", () => {
  for (const from of RUN_STATES) for (const to of RUN_STATES) for (const interrupt of INTERRUPTS) {
    if (from === "terminal" && interrupt !== "none") continue;
    const exception = LIFECYCLE_EXCEPTIONS.find(([f, t, i]) => f === from && t === to && i === interrupt);
    const expected = to === "terminal" ? "none" : exception?.[3] ?? interrupt;
    assert.equal(answerOf(interruptTransition(factsOf(from, interrupt), { kind: "lifecycle", to })), expected, `${from} -> ${to} with ${interrupt}`);
  }
});

it("produces every declared application state", () => {
  const answers = [
    [{ quitting: false, admission: "open" }, "ready"],
    [{ quitting: false, admission: "draining" }, "pausing"],
    [{ quitting: true, admission: "open" }, "quitting"],
    [{ quitting: true, admission: "draining" }, "quitting"],
  ] as const;
  for (const [input, state] of answers) assert.equal(applicationStateOf(input), state, JSON.stringify(input));
  const declared: readonly string[] = ApplicationLifecycleSchema.shape.state.options;
  const produced = new Set<string>(answers.map(([, state]) => state));
  assert.deepEqual([...declared].sort(), [...produced].sort());
});

it("serves one application pause from the runs that can still pause", () => {
  const run = (state: RunState, interrupt: PendingInterrupt) => factsOf(state, interrupt);
  const answers = [
    [[], "running"],
    [[run("running", "none"), run("queued", "paused")], "running"],
    [[run("running", "pause-requested"), run("queued", "paused")], "pause-pending"],
    [[run("running", "pause-requested"), run("queued", "none")], "running"],
    [[run("running", "paused"), run("parked-gate", "paused")], "paused"],
    // A run that cannot take a pause (a parked write, a pending stop) neither holds nor completes it.
    [[run("parked-write", "none"), run("running", "stop-requested"), run("queued", "paused")], "paused"],
    [[run("parked-write", "none"), run("running", "pause-requested")], "pause-pending"],
    [[run("parked-write", "paused"), run("running", "stop-requested")], "running"],
    [[run("terminal", "none")], "running"],
  ] as const;
  for (const [runs, pause] of answers) assert.equal(applicationPauseOf(runs), pause, JSON.stringify(runs));
  const declared: readonly string[] = ApplicationLifecycleSchema.shape.pause.options;
  const produced = new Set<string>(answers.map(([, pause]) => pause));
  assert.deepEqual([...declared].sort(), [...produced].sort());
});
