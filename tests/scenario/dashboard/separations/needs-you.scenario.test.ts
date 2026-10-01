/**
 * T2 — the needs-you notification a separations gate park produces (D262).
 *
 * The notifier's unit owner supplies a park set. These scenarios close the
 * composition seam: `runs.listParkedAtGate()` supplies that set, the real
 * command service releases it, and the day projection serves the alert.
 * `readGateParks` comes from `compose.ts` so a malformed authority row refuses
 * rather than being narrowed past.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { localDatePart } from "../../../../src/domain/clock.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../../src/domain/ids.js";
import { createGateParkNotifier } from "../../../../src/backend/runs/notifications/gate-park.js";
import { EMPTY_IDENTITY_GATE_DRAFT, identityCeremonyFor, identityGateAnswer } from "../../../../src/dashboard/app/identity-ceremony.js";
import { buildRunSection } from "../../../../src/backend/runs/dashboard/queries/run-detail.js";
import { readGateParks } from "../../../../src/backend/app/dashboard/compose.js";
import {
  FIXTURE_DOCUMENT_NUMBER,
  GATE_ID,
  commandEnvelope,
  createSeparationsWorld,
  disposeWorlds,
  parkAtIdentityGate,
  separationsIdentityPacket,
  seedIdentityPacketCheckpoint,
  startFromTypedText,
  type SeparationsDashboardWorld,
} from "./world.js";

afterEach(disposeWorlds);

/** One separations run, started from the typed box and parked with its packet. */
function parkOne(world: SeparationsDashboardWorld, text: string): string {
  const [started] = startFromTypedText(world, text);
  assert.ok(started);
  parkAtIdentityGate(world, started.runId);
  seedIdentityPacketCheckpoint(world, started.runId, separationsIdentityPacket());
  world.projection.refreshRun(started.runId);
  return started.runId;
}

describe("separations dashboard — the needs-you alert a parked gate produces", () => {
  it("publishes ONE durable gate-waiting row for a park, and nothing for the same park again", async () => {
    const world = createSeparationsWorld();
    const runId = parkOne(world, FIXTURE_DOCUMENT_NUMBER);
    const notifier = createGateParkNotifier({ inbox: world.inbox });

    const first = await notifier.observed(readGateParks(world.database));
    assert.deepEqual(first.published.map(({ park }) => park.runId), [runId]);
    assert.deepEqual(first.standing, []);

    const rows = world.database.authority.notifications.listByActor(LOCAL_OPERATOR_ACTOR_ID);
    assert.equal(rows.length, 1);
    const [row] = rows;
    assert.ok(row);
    assert.equal(row.trigger, "gate-waiting");
    // §2.6's rule: the alert names WHERE to look and carries no HR data.
    assert.deepEqual(row.links.map((link) => (link.kind === "run" ? link.runId : "")), [runId]);

    // A STANDING park is not news again; re-publishing it every tick is the
    // unreadable-forever row §2.6 forbids.
    const second = await notifier.observed(readGateParks(world.database));
    assert.deepEqual(second.published, []);
    assert.deepEqual(second.standing.map(({ runId: id }) => id), [runId]);
    assert.equal(world.database.authority.notifications.listByActor(LOCAL_OPERATOR_ACTOR_ID).length, 1);
  });

  it("serves the alert on the day wire the operator's bell reads", async () => {
    const world = createSeparationsWorld();
    const runId = parkOne(world, FIXTURE_DOCUMENT_NUMBER);
    await createGateParkNotifier({ inbox: world.inbox }).observed(readGateParks(world.database));

    const day = world.projection.buildDashboardDayWire(localDatePart(world.clock.now()));
    assert.equal(day.notifications.length, 1);
    const [alert] = day.notifications;
    assert.ok(alert);
    assert.equal(alert.state, "unread");
    assert.equal(alert.severity, "warning");
    assert.match(alert.title, /Needs you — separations/u);
    // The row LINKS to the waiting run — §2.6's "names where to look".
    assert.deepEqual({ ...alert.link }, { kind: "run", runId });
  });

  it("counts two parked runs as two alerts, one per run", async () => {
    const world = createSeparationsWorld();
    const first = parkOne(world, FIXTURE_DOCUMENT_NUMBER);
    const second = parkOne(world, "4445");
    const notifier = createGateParkNotifier({ inbox: world.inbox });

    const report = await notifier.observed(readGateParks(world.database));
    assert.deepEqual(
      [...report.published.map(({ park }) => park.runId)].sort(),
      [first, second].sort(),
    );
    assert.equal(world.database.authority.notifications.listByActor(LOCAL_OPERATOR_ACTOR_ID).length, 2);
  });

  it("RELEASES the park when the gate is resolved through the real command service", async () => {
    const world = createSeparationsWorld();
    const runId = parkOne(world, FIXTURE_DOCUMENT_NUMBER);
    const notifier = createGateParkNotifier({ inbox: world.inbox });
    await notifier.observed(readGateParks(world.database));

    const response = buildRunSection(world.runDetail, runId, "identity-gate");
    assert.equal(response.section, "identity-gate");
    if (response.section !== "identity-gate" || response.payload.state !== "available") {
      throw new Error("the parked run served no identity gate");
    }
    const gate = response.payload.value;
    const ceremony = identityCeremonyFor(gate, "approved");
    const option = ceremony.kind === "confirm"
      ? ceremony.option
      : ceremony.kind === "choose" || ceremony.kind === "type-the-eid"
        ? ceremony.options[0]
        : undefined;
    assert.ok(option, "the name-only gate served no EID to type");
    const answer = identityGateAnswer(ceremony, { ...EMPTY_IDENTITY_GATE_DRAFT, eid: option.eid });
    assert.ok(answer);
    if (answer.decision !== "approved") throw new Error("unreachable");
    const applied = world.commands.execute({
      ...commandEnvelope(),
      family: "gate",
      type: "resolve-gate",
      target: { runId, gateId: GATE_ID, expectedVersion: gate.expectedVersion },
      payload: {
        result: {
          schemaHash: gate.resultSchemaHash,
          value: {
            decision: "approved",
            eid: answer.eid,
            chosenFrom: option.chosenFrom,
            evidenceDigest: gate.evidenceDigest,
          },
        },
      },
    });
    assert.equal(applied.state, "applied");

    // The park is gone from authority, so the watch reports it released — the
    // notifier FORGETS it, which is what makes a later re-park news again. The
    // row itself is deliberately untouched: read state is the operator's axis,
    // and erasing it would erase the record that a human was ever asked.
    const report = await notifier.observed(readGateParks(world.database));
    assert.deepEqual(report.released.map((park) => park.runId), [runId]);
    assert.deepEqual(report.published, []);
    assert.equal(world.database.authority.notifications.listByActor(LOCAL_OPERATOR_ACTOR_ID).length, 1);
  });
});
