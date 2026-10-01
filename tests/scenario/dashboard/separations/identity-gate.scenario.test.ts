/**
 * T2 — the separations identity gate, from the SERVED section to the REAL
 * command service (ref guards-and-tests §10.12; ref write-safety §14.4/§14.6;
 * D226, D253).
 *
 * This is the wired square §9.22 exercised by hand on 2026-08-20: a parked run,
 * the ceremony the server chose, a typed EID, and a checkpoint carrying the exact
 * digest the dialog printed. What no unit could pin is the CHAIN — the section
 * the run-detail query serves, the ceremony the client folds from it, the
 * command that composer builds, and the kernel's answer to that command. Every
 * step below is the production module; nothing here hand-writes a command
 * envelope or a ceremony.
 *
 * **Both `CommandResult` refusal arms are exercised here** (§10.12 item 1,
 * D253): the CAS `conflict` — an operator holding a panel one revision stale —
 * and `rejected` — a result bound to a schema the descriptor does not declare,
 * which is what a bundle running ahead of (or behind) its server produces.
 * A gate that answered either of those with a silent no-op would be the one
 * place in this product where "I approved it" and "nothing happened" look
 * identical.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { composeCommandRequest } from "../../../../src/dashboard/app/command-dispatch.js";
import {
  EMPTY_IDENTITY_GATE_DRAFT,
  identityCeremonyFor,
  identityDraftProblem,
  identityGateAnswer,
  type IdentityGateDetail,
} from "../../../../src/dashboard/app/identity-ceremony.js";
import { FingerprintSchema } from "../../../../src/domain/ids.js";
import { buildRunSection } from "../../../../src/backend/runs/dashboard/queries/run-detail.js";
import {
  FIXTURE_DOCUMENT_NUMBER,
  GATE_ID,
  createSeparationsWorld,
  disposeWorlds,
  gateResultSchemaHash,
  parkAtIdentityGate,
  separationsIdentityPacket,
  seedIdentityPacketCheckpoint,
  startFromTypedText,
  type SeparationsDashboardWorld,
} from "./world.js";

afterEach(disposeWorlds);

interface ParkedRun {
  readonly world: SeparationsDashboardWorld;
  readonly runId: string;
  readonly gate: IdentityGateDetail;
}

/**
 * One separations run, started from the typed box and parked at the gate with
 * its evidence packet stored — then READ BACK through the real run-detail
 * section, which is the only value any assertion below is allowed to use.
 */
function parkedRun(
  packetOptions: Parameters<typeof separationsIdentityPacket>[0] = {},
): ParkedRun {
  const world = createSeparationsWorld();
  const [started] = startFromTypedText(world, FIXTURE_DOCUMENT_NUMBER);
  assert.ok(started);
  parkAtIdentityGate(world, started.runId);
  seedIdentityPacketCheckpoint(world, started.runId, separationsIdentityPacket(packetOptions));
  world.projection.refreshRun(started.runId);

  const response = buildRunSection(world.runDetail, started.runId, "identity-gate");
  assert.equal(response.section, "identity-gate");
  if (response.section !== "identity-gate") throw new Error("unreachable");
  assert.equal(
    response.payload.state,
    "available",
    response.payload.state === "missing" ? response.payload.reason : "",
  );
  if (response.payload.state !== "available") throw new Error("unreachable");
  return { world, runId: started.runId, gate: response.payload.value };
}

/** The composed `resolve-gate` request, through the app's ONE composer. */
function composeResolveGate(
  parked: ParkedRun,
  answer: ReturnType<typeof identityGateAnswer>,
  overrides: Readonly<{ expectedVersion?: number; gate?: IdentityGateDetail }> = {},
): unknown {
  const gate = overrides.gate ?? parked.gate;
  const [action] = gate.actions;
  assert.ok(action, "the gate served no action");
  assert.equal(action.kind, "command");
  if (action.kind !== "command") throw new Error("unreachable");
  const composed = composeCommandRequest(
    { ...action, expectedVersion: overrides.expectedVersion ?? action.expectedVersion },
    { runId: parked.runId, expectedVersion: overrides.expectedVersion ?? action.expectedVersion },
    {
      actorId: "local-operator",
      source: "run-detail",
      gate: { state: "available", value: gate },
      ...(answer === undefined ? {} : { gateAnswer: answer }),
    },
  );
  assert.equal(composed.state, "ready", composed.state === "refused" ? composed.reason : "");
  if (composed.state !== "ready") throw new Error("unreachable");
  return composed.request;
}

describe("separations dashboard — the ceremony the SERVER chose", () => {
  it("serves a typed-EID ceremony for a name-resolved packet, bound to the digest it showed", () => {
    const parked = parkedRun();

    assert.equal(parked.gate.approvalShape, "type-the-eid");
    const ceremony = identityCeremonyFor(parked.gate, "approved");
    assert.equal(ceremony.kind, "type-the-eid");
    if (ceremony.kind !== "type-the-eid") return;
    assert.match(
      identityDraftProblem(ceremony, EMPTY_IDENTITY_GATE_DRAFT) ?? "",
      /Type the 8-digit employee ID/u,
    );
    const [option] = ceremony.options;
    assert.ok(option);
    assert.deepEqual(
      identityGateAnswer(ceremony, { eid: option.eid, reason: "" }),
      { decision: "approved", eid: option.eid },
    );
    assert.equal(option.chosenFrom, "checked");
    // §14.5: the packet the operator is looking at, named on the wire.
    assert.equal(parked.gate.evidenceDigest.length, 64);
    assert.equal(parked.gate.gateId, GATE_ID);
  });

  it("does not downgrade an exact name-only selection to one click", () => {
    const parked = parkedRun();

    // Even one exact name-search candidate remains a human identity decision.
    // The source, not the candidate count, determines that a typed EID is owed.
    assert.equal(parked.gate.approvalShape, "type-the-eid");
    const ceremony = identityCeremonyFor(parked.gate, "approved");
    assert.equal(ceremony.kind, "type-the-eid");
    if (ceremony.kind !== "type-the-eid") return;
    assert.equal(ceremony.options.length, 1);
    assert.equal(identityGateAnswer(ceremony, EMPTY_IDENTITY_GATE_DRAFT), undefined);
  });

  it("refuses an EID the packet never showed, naming the authority check that would refuse it", () => {
    const parked = parkedRun();
    const ceremony = identityCeremonyFor(parked.gate, "approved");
    if (ceremony.kind !== "type-the-eid") throw new Error("expected a typed-EID ceremony");

    const problem = identityDraftProblem(ceremony, { eid: "19999999", reason: "" });
    assert.match(problem ?? "", /packet never showed EID/u);
  });

});

describe("separations dashboard — the gate command the ceremony composes", () => {
  it("APPLIES a typed-EID approval, stores the decision, and resumes the run", () => {
    const parked = parkedRun();
    const ceremony = identityCeremonyFor(parked.gate, "approved");
    const [option] = parked.gate.options;
    assert.ok(option);
    const answer = identityGateAnswer(ceremony, { eid: option.eid, reason: "" });
    assert.ok(answer);

    const result = parked.world.commands.execute(composeResolveGate(parked, answer));
    assert.equal(result.state, "applied", result.state === "rejected" ? result.message : "");

    // The durable decision, on the same terms `explain run` and the receipt
    // read it: WHO answered is the kernel's own fact, never the caller's claim.
    const [stored] = parked.world.database.authority.gateResults.listByRun(parked.runId);
    assert.ok(stored);
    assert.ok("resolvedBy" in stored);
    assert.equal(stored.gateId, GATE_ID);
    assert.equal(stored.resolvedBy, "local-operator");
    assert.deepEqual(stored.result.value, {
      decision: "approved",
      eid: answer.decision === "approved" ? answer.eid : "",
      chosenFrom: "checked",
      evidenceDigest: parked.gate.evidenceDigest,
    });
    // The run left the park, so the needs-you set no longer holds it.
    assert.equal(parked.world.database.authority.runs.get(parked.runId)?.lifecycle.state, "queued");
    assert.deepEqual(parked.world.database.authority.runs.listParkedAtGate().map((run) => run.envelope.runId), []);
  });

  it("REJECTS a result bound to a schema the descriptor does not declare, and changes nothing", () => {
    const parked = parkedRun();
    const ceremony = identityCeremonyFor(parked.gate, "approved");
    const [option] = parked.gate.options;
    assert.ok(option);
    const answer = identityGateAnswer(ceremony, { eid: option.eid, reason: "" });
    assert.ok(answer);
    // A bundle running against a server whose gate schema moved: the payload is
    // well-formed and bound to the WRONG identity. The serve-side hash is the
    // one the section carried, so this is the exact drift the wire exists to
    // catch — never a coincidence a test manufactured.
    const foreignHash = FingerprintSchema.parse("c".repeat(64));
    assert.notEqual(foreignHash, gateResultSchemaHash(parked.world));
    const composed = composeResolveGate(parked, answer, {
      gate: { ...parked.gate, resultSchemaHash: foreignHash },
    });

    const result = parked.world.commands.execute(composed);
    assert.equal(result.state, "rejected");
    if (result.state !== "rejected") return;
    assert.equal(result.code, "schema-mismatch");
    assert.match(result.message, /the descriptor's exact gate schema is/u);

    // Nothing moved: no stored decision, and the run is still waiting.
    assert.deepEqual(parked.world.database.authority.gateResults.listByRun(parked.runId), []);
    assert.equal(parked.world.database.authority.runs.get(parked.runId)?.lifecycle.state, "parked-gate");
  });

  it("CONFLICTS when the panel the operator is holding is one revision stale", () => {
    const parked = parkedRun();
    const ceremony = identityCeremonyFor(parked.gate, "approved");
    const [option] = parked.gate.options;
    assert.ok(option);
    const answer = identityGateAnswer(ceremony, { eid: option.eid, reason: "" });
    assert.ok(answer);

    const stale = parked.gate.expectedVersion - 1;
    assert.ok(stale > 0, "the parked run must be past version 1 for this to be a real stale read");
    const result = parked.world.commands.execute(composeResolveGate(parked, answer, { expectedVersion: stale }));

    assert.equal(result.state, "conflict");
    if (result.state !== "conflict") return;
    // The CURRENT version rides back, so the surface can re-read and retry with
    // a true number rather than guessing past the collision.
    assert.equal(result.currentVersion, parked.gate.expectedVersion);
    assert.match(result.message, /refresh before resolving the gate/u);
    assert.deepEqual(parked.world.database.authority.gateResults.listByRun(parked.runId), []);
    assert.equal(parked.world.database.authority.runs.get(parked.runId)?.lifecycle.state, "parked-gate");
  });

});
