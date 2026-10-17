import { CommandResultSchema } from "../../../../../src/rules/commands/commands.js";
import { singleAppliedRunId } from "../../../../support/fixtures/operator-command-fixtures.js";

import assert from "node:assert/strict";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach,describe,it } from "vitest";
import { deriveBulkChildCommandId } from "../../../../../src/backend/runs/commands/command-service.js";
import type { IntakeService } from "../../../../../src/backend/runs/commands/intake-service.js";
import { SETTINGS_SCHEMA_HASH,deriveSettingsPatchFingerprint } from "../../../../../src/models/config/settings.js";
import { UNWIRED_INTAKE_SERVICE } from "../../../../support/fixtures/intake-kernel-seams.js";
import { UUID_4 } from "../../../../support/fixtures/phase1c-contract-fixtures.js";
import { DAY } from "../../../../support/helpers/backend/dashboard-harness.js";

describe("BFF spine flow (start plan -> kernel -> spans -> projection)", () => {

  it("serializes concurrent acceptance of one command id around the server clock", async () => {
    let firstPrepareReached: (() => void) | undefined;
    const firstPrepare = new Promise<void>((resolve) => {
      firstPrepareReached = resolve;
    });
    let prepares = 0;
    const intake: IntakeService = {
      ...UNWIRED_INTAKE_SERVICE,
      async prepare(): Promise<void> {
        prepares += 1;
        if (prepares !== 1) return;
        firstPrepareReached?.();
        await new Promise<void>((resolve) => setImmediate(resolve));
      },
    };
    const h = harness({ intake });
    const commandId = "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b75";
    const acceptedAt = h.clock.now().toISOString();
    const patch = { "browser.headless": { set: false } } as const;
    const command = {
      commandId,
      requestedAt: "2020-01-01T00:00:00.000Z",
      requestedBy: "local-operator",
      source: "hostile-page",
      family: "settings",
      type: "apply-settings",
      target: { expectedRevision: 1 },
      payload: {
        settingsSchemaHash: SETTINGS_SCHEMA_HASH,
        patchFingerprint: deriveSettingsPatchFingerprint(patch),
        patch,
      },
    };
    const request = () => h.app.request("http://localhost/api/v1/commands", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify(command),
    });
    const first = request();
    await firstPrepare;
    h.clock.advanceWall(1_000);

    const responses = await Promise.all([first, request()]);

    assert.deepEqual(responses.map(({ status }) => status), [200, 200]);
    assert.deepEqual(
      await Promise.all(responses.map(async (response) => (await json(response)).state)),
      ["applied", "already-applied"],
    );
    assert.equal(h.database.authority.commands.get(commandId)?.requestedAt, acceptedAt);
  });

  it("refuses malformed and unavailable requests with typed wire errors", async () => {
    const h = harness();

    const badDay = await h.app.request("/api/v1/dashboard?day=today");
    assert.equal(badDay.status, 400);
    assert.equal((await json(badDay)).code, "SCHEMA_INVALID");

    const missingRun = await h.app.request(`/api/v1/runs/9e8d7c6b-5a49-4382-9170-2f3e4d5c6b7a`);
    assert.equal(missingRun.status, 404);
    assert.equal((await json(missingRun)).code, "TARGET_NOT_FOUND");

    const badCommand = await h.app.request("/api/v1/commands", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({ family: "start", type: "start-run" }),
    });
    assert.equal(badCommand.status, 400);

    const settingsCommandId = "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b7b";
    const settingsPatch = { "browser.headless": { set: false } } as const;
    const mismatchedCommand = {
      commandId: settingsCommandId,
      requestedAt: h.clock.now().toISOString(),
      requestedBy: "local-operator",
      source: "settings-surface",
      family: "settings",
      type: "apply-settings",
      target: { expectedRevision: 1 },
      payload: {
        settingsSchemaHash: "a".repeat(64),
        patchFingerprint: deriveSettingsPatchFingerprint(settingsPatch),
        patch: settingsPatch,
      },
    };
    const settingsBefore = settingsAuthoritySnapshot(h, settingsCommandId);

    const mismatchedSettingsSchema = await h.app.request("/api/v1/commands", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify(mismatchedCommand),
    });
    assert.equal(mismatchedSettingsSchema.status, 422);
    const rejection = await json(mismatchedSettingsSchema);
    assert.equal(rejection.state, "rejected");
    assert.equal(rejection.code, "schema-mismatch");
    assert.deepEqual(
      settingsAuthoritySnapshot(h, settingsCommandId),
      settingsBefore,
      "a schema-mismatched settings command must leave file, prepare, current, journal, audit, and generations byte-exactly unchanged",
    );

    const unknownWorkflowPlan = await h.app.request("/api/v1/start-plans", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({ workflowId: "mystery-flow", submissions: [{}], dryRun: false }),
    });
    assert.equal(unknownWorkflowPlan.status, 404);

    const unknownRoute = await h.app.request("/api/v1/mystery");
    assert.equal(unknownRoute.status, 404);
    assert.equal((await json(unknownRoute)).code, "ROUTE_NOT_FOUND");

    const retiredCaptureRoute = await h.app.request("/api/v1/capture/phone/session");
    assert.equal(retiredCaptureRoute.status, 404);
    assert.equal((await json(retiredCaptureRoute)).code, "ROUTE_NOT_FOUND");

    const beforeRetiredCommand = faultAuthoritySnapshot(h);
    const retiredCaptureCommand = await h.app.request("/api/v1/commands", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({
        commandId: "00000000-0000-4000-8000-000000000098",
        requestedAt: h.clock.now().toISOString(),
        requestedBy: "local-operator",
        source: "dashboard",
        family: "capture",
        type: "capture-finalize",
        target: { captureSessionId: UUID_4, expectedVersion: 1 },
      }),
    });
    assert.equal(retiredCaptureCommand.status, 400);
    assert.equal((await json(retiredCaptureCommand)).code, "SCHEMA_INVALID");
    assertHttpFaultOnly(h, beforeRetiredCommand, 1);

    const badTopics = await h.app.request("/events/v1?topics=everything");
    const badCursor = await h.app.request(`/events/v1?topics=dashboard-day:${DAY}`, {
      headers: { "last-event-id": "not-a-projection-cursor" },
    });
    assert.equal(badCursor.status, 400);
    const unboundGeneration = await h.app.request(`/events/v1?topics=dashboard-day:${DAY}`, {
      headers: { "dashboard-projection-generation": "7" },
    });
    assert.equal(unboundGeneration.status, 400);
    assert.equal(badTopics.status, 400);
  });

  it("refuses a command whose requested actor disagrees with BFF admission before authority changes", async () => {
    const h = harness();
    const commandId = "00000000-0000-4000-8000-000000000095";
    const patch = {
      "display.screenWidth": { set: 1980 },
      "display.screenHeight": { set: 1080 },
    } as const;

    const response = await h.app.request("/api/v1/commands", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({
        commandId,
        requestedAt: h.clock.now().toISOString(),
        requestedBy: "other-operator",
        source: "settings-surface",
        family: "settings",
        type: "apply-settings",
        target: { expectedRevision: 1 },
        payload: {
          settingsSchemaHash: SETTINGS_SCHEMA_HASH,
          patchFingerprint: deriveSettingsPatchFingerprint(patch),
          patch,
        },
      }),
    });

    assert.equal(response.status, 403);
    assert.equal((await json(response)).code, "REQUEST_IDENTITY_REFUSED");
    assert.equal(h.database.authority.commands.get(commandId), undefined);

    const preflightResponse = await h.app.request("/api/v1/preflight/rerun", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({
        commandId: "00000000-0000-4000-8000-000000000096",
        requestedAt: h.clock.now().toISOString(),
        requestedBy: "other-operator",
        source: "settings-surface",
        type: "rerun-preflight",
        target: {
          expectedConfigFingerprint: "a".repeat(64),
          expectedDescriptorFingerprint: "b".repeat(64),
        },
      }),
    });
    assert.equal(preflightResponse.status, 403);
    assert.equal((await json(preflightResponse)).code, "REQUEST_IDENTITY_REFUSED");

    const bulkResponse = await h.app.request("/api/v1/commands/bulk", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({
        commandId: "00000000-0000-4000-8000-000000000097",
        requestedAt: h.clock.now().toISOString(),
        requestedBy: "other-operator",
        source: "queue",
        family: "run",
        type: "cancel",
        bulkCommandId: "00000000-0000-4000-8000-000000000097",
        targets: [{ runId: UUID_4, expectedVersion: 1 }],
        mode: "best-effort",
      }),
    });
    assert.equal(bulkResponse.status, 403);
    assert.equal((await json(bulkResponse)).code, "REQUEST_IDENTITY_REFUSED");
  });

  it("executes a bulk cancel as N CAS-bound children and answers the per-run vector", async () => {
    const h = harness();

    // Three real runs through the real plan -> start doors, one per subject.
    const startRun = async (eid: string, commandId: string): Promise<string> => {
      const planResponse = await h.app.request("/api/v1/start-plans", {
        method: "POST",
        headers: OPERATOR_JSON_HEADERS,
        body: JSON.stringify({ workflowId: "fixture-graph", submissions: [{ eid, mode: "read-only" }], dryRun: false }),
      });
      assert.equal(planResponse.status, 200);
      const plan = await json(planResponse);
      const fingerprints = plan.fingerprints as Record<string, string>;
      const started = await h.app.request("/api/v1/commands", {
        method: "POST",
        headers: OPERATOR_JSON_HEADERS,
        body: JSON.stringify({
          commandId,
          requestedAt: h.clock.now().toISOString(),
          requestedBy: "local-operator",
          source: "start-run",
          family: "start",
          type: "start-run",
          target: { workflowId: "fixture-graph", startPlanId: plan.startPlanId, expectedVersion: plan.expectedVersion },
          payload: {
            descriptorFingerprint: fingerprints.descriptorFingerprint,
            configFingerprint: fingerprints.configFingerprint,
            ingressSchemaHash: fingerprints.ingressSchemaHash,
            canonicalInputSchemaHash: fingerprints.canonicalInputSchemaHash,
            inputFingerprint: fingerprints.inputFingerprint,
          },
        }),
      });
      return singleAppliedRunId(CommandResultSchema.parse(await json(started)));
    };
    const runA = await startRun("10203372", "1a000000-0000-4000-8000-000000000001");
    const runB = await startRun("10203373", "1a000000-0000-4000-8000-000000000002");
    const runC = await startRun("10873700", "1a000000-0000-4000-8000-000000000003");
    const runD = await startRun("10873701", "1a000000-0000-4000-8000-000000000005");
    const versionOf = (runId: string): number => {
      const run = h.database.authority.runs.get(runId);
      assert.notEqual(run, undefined, `run ${runId} exists in authority`);
      return (run as { version: number }).version;
    };

    // runC is cancelled up front so its bulk child exercises the REFUSED arm
    // through the same kernel precondition a single press would hit.
    const soloCancel = await h.app.request("/api/v1/commands", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({
        commandId: "1a000000-0000-4000-8000-000000000004",
        requestedAt: h.clock.now().toISOString(),
        requestedBy: "local-operator",
        source: "queue",
        family: "run",
        type: "cancel",
        target: { runId: runC, expectedVersion: versionOf(runC) },
      }),
    });
    assert.equal((await json(soloCancel)).state, "applied");

    // Whole-request refusals reach NO target: an empty batch, a duplicated
    // target, and the all-or-none mode this runtime deliberately refuses.
    const envelope = {
      commandId: "1a000000-0000-4000-8000-00000000000b",
      requestedAt: "2020-01-01T00:00:00.000Z",
      requestedBy: "local-operator",
      source: "hostile-page",
      family: "run",
      type: "cancel",
      bulkCommandId: "1a000000-0000-4000-8000-00000000000b",
      mode: "best-effort",
    } as const;
    const postBulk = async (body: unknown): Promise<{ status: number; payload: Record<string, unknown> }> => {
      const response = await h.app.request("/api/v1/commands/bulk", {
        method: "POST",
        headers: OPERATOR_JSON_HEADERS,
        body: JSON.stringify(body),
      });
      return { status: response.status, payload: await json(response) };
    };

    const empty = await postBulk({ ...envelope, targets: [] });
    assert.equal(empty.status, 422);
    assert.equal(empty.payload.state, "refused");
    assert.equal(empty.payload.code, "schema-mismatch");

    const duplicated = await postBulk({
      ...envelope,
      commandId: "1a000000-0000-4000-8000-00000000000c",
      bulkCommandId: "1a000000-0000-4000-8000-00000000000c",
      targets: [{ runId: runA, expectedVersion: 1 }, { runId: runA, expectedVersion: 1 }],
    });
    assert.equal(duplicated.payload.state, "refused");
    assert.match(String(duplicated.payload.message), /more than once/);

    const allOrNone = await postBulk({
      ...envelope,
      commandId: "1a000000-0000-4000-8000-00000000000d",
      bulkCommandId: "1a000000-0000-4000-8000-00000000000d",
      mode: "all-or-none",
      targets: [{ runId: runA, expectedVersion: 1 }],
    });
    assert.equal(allOrNone.payload.state, "refused");
    assert.equal(allOrNone.payload.code, "capability-unavailable");
    assert.match(String(allOrNone.payload.message), /Nothing was\s+attempted/);

    // The mixed vector: one applied, one conflict (stale version, with the
    // server's currentVersion), one refused by the kernel's own precondition.
    const bulkBody = {
      ...envelope,
      targets: [
        { runId: runA, expectedVersion: versionOf(runA) },
        { runId: runB, expectedVersion: 999 },
        { runId: runC, expectedVersion: versionOf(runC) },
      ],
    };
    const first = await postBulk(bulkBody);
    assert.equal(first.status, 200);
    assert.equal(first.payload.state, "vector");
    assert.equal(first.payload.requestedCount, 3);
    const results = first.payload.results as Record<string, unknown>[];
    assert.deepEqual(results.map(({ outcome }) => outcome), ["applied", "conflict", "refused"]);
    assert.equal(results[0].runId, runA);
    assert.equal(results[0].replayed, false);
    assert.equal(results[1].runId, runB);
    assert.equal(results[1].currentVersion, versionOf(runB), "conflict carries the server's own current version");
    assert.equal(results[2].runId, runC);
    assert.equal(typeof results[2].code, "string");
    const childIds = new Set(results.map(({ commandId }) => commandId));
    assert.equal(childIds.size, 3, "each target's child command has its own derived identity");
    const acceptedChild = h.database.authority.commands.get(String(results[0].commandId));
    assert.equal(acceptedChild?.requestedAt, h.clock.now().toISOString());
    assert.equal(acceptedChild?.requestedBy, "local-operator");
    assert.equal(acceptedChild?.source, "dashboard");
    const acceptedParent = h.database.authority.commands.getBulk(envelope.bulkCommandId);
    assert.notEqual(acceptedParent, undefined);
    assert.equal(h.database.authority.commands.parentId(String(results[0].commandId)), envelope.bulkCommandId);
    assert.equal(h.database.authority.commands.parentId(String(results[1].commandId)), undefined);
    assert.equal(h.database.authority.commands.parentId(String(results[2].commandId)), undefined);
    assert.equal(h.database.authority.commandAudits.findByCommand(envelope.bulkCommandId), undefined);

    assert.deepEqual(acceptedParent?.request.targets, bulkBody.targets);
    assert.equal(acceptedParent?.request.requestedAt, h.clock.now().toISOString());
    assert.equal(acceptedParent?.request.requestedBy, "local-operator");
    assert.equal(acceptedParent?.request.source, "dashboard");

    // Re-delivering the SAME bulk envelope replays the applied child rather
    // than filing a second cancel: the child ids are derived, not minted.
    h.clock.advanceWall(1_000);
    const replay = await postBulk(bulkBody);
    assert.equal(replay.payload.state, "vector");
    const replayed = replay.payload.results as Record<string, unknown>[];
    assert.deepEqual(replayed.map(({ outcome }) => outcome), ["applied", "conflict", "refused"]);
    assert.equal(replayed[0].replayed, true, "the applied child is answered from the journal, not re-executed");
    assert.equal(replayed[0].commandId, results[0].commandId);
    assert.deepEqual(
      h.database.authority.commands.getBulk(envelope.bulkCommandId),
      acceptedParent,
      "exact replay reuses the byte-exact accepted parent and its original accepted time",
    );

    const snapshot = (): unknown => ({
      generation: h.database.getMeta().authorityGeneration,
      parent: h.database.authority.commands.getBulk(envelope.bulkCommandId),
      runs: [runA, runB, runC, runD].map((runId) => h.database.authority.runs.get(runId)),
      children: [runA, runB, runC, runD].map((runId) => {
        const childId = deriveBulkChildCommandId(envelope.bulkCommandId, runId);
        return {
          command: h.database.authority.commands.get(childId),
          audit: h.database.authority.commandAudits.findByCommand(childId),
        };
      }),
    });
    const simultaneous = await Promise.all([postBulk(bulkBody), postBulk(bulkBody)]);
    assert.ok(simultaneous.every((response) => response.payload.state === "vector"));
    assert.ok(simultaneous.every((response) => (response.payload.results as Record<string, unknown>[])[0].replayed === true));
    const identityBefore = snapshot();
    for (const commandId of [envelope.bulkCommandId, String(results[0].commandId)]) {
      const response = await h.app.request("/api/v1/commands", { method: "POST", headers: OPERATOR_JSON_HEADERS,
        body: JSON.stringify({ commandId, family: "run", type: "cancel", target: bulkBody.targets[0] }) });
      const refusal = await json(response);
      assert.equal(refusal.state, "rejected");
      assert.equal(refusal.code, "command-divergent");
    }
    const bulkIdentityRefusal = await postBulk({ ...bulkBody, bulkCommandId: String(results[0].commandId) });
    assert.equal(bulkIdentityRefusal.payload.state, "refused");
    assert.equal(bulkIdentityRefusal.payload.code, "command-divergent");
    assert.deepEqual(snapshot(), identityBefore);
    const beforeConcurrent = snapshot();
    const divergentConcurrent = await Promise.all([postBulk(bulkBody), postBulk({ ...bulkBody, reason: "different selection reason" })]);
    assert.equal(divergentConcurrent[0].payload.state, "vector");
    assert.equal(divergentConcurrent[1].payload.state, "refused");
    assert.deepEqual(snapshot(), beforeConcurrent);
    const divergentReplays = [
      { label: "changes operation", body: { ...bulkBody, type: "retry" } },
      { label: "changes mode", body: { ...bulkBody, mode: "all-or-none" } },
      { label: "changes reason", body: { ...bulkBody, reason: "different selection reason" } },
      {
        label: "adds an old+new target",
        body: {
          ...bulkBody,
          targets: [...bulkBody.targets, { runId: runD, expectedVersion: versionOf(runD) }],
        },
      },
      {
        label: "omits an accepted target",
        body: { ...bulkBody, targets: bulkBody.targets.slice(0, -1) },
      },
      {
        label: "reorders the accepted targets",
        body: { ...bulkBody, targets: [...bulkBody.targets].reverse() },
      },
      {
        label: "changes one accepted child",
        body: {
          ...bulkBody,
          targets: [
            { ...bulkBody.targets[0], expectedVersion: bulkBody.targets[0].expectedVersion + 1 },
            ...bulkBody.targets.slice(1),
          ],
        },
      },
    ] as const;
    for (const divergent of divergentReplays) {
      const before = snapshot();
      const refusal = await postBulk(divergent.body);
      assert.equal(refusal.status, 422, divergent.label);
      assert.equal(refusal.payload.state, "refused", divergent.label);
      assert.equal(refusal.payload.code, "schema-mismatch", divergent.label);
      assert.deepEqual(snapshot(), before, `${divergent.label} has byte-exact zero child effects`);
    }

    const runG = await startRun("10873704", "1a000000-0000-4000-8000-000000000008");
    const concurrentBody = { ...envelope, commandId: "1a000000-0000-4000-8000-00000000000f", bulkCommandId: "1a000000-0000-4000-8000-00000000000f", targets: [{ runId: runG, expectedVersion: versionOf(runG) }] };
    const concurrentNew = await Promise.all([postBulk(concurrentBody), postBulk(concurrentBody), postBulk({ ...concurrentBody, reason: "divergent concurrent acceptance" })]);
    assert.deepEqual(concurrentNew.map(({ payload }) => payload.state), ["vector", "vector", "refused"]);
    assert.equal((concurrentNew[0].payload.results as Record<string, unknown>[])[0].replayed, false);
    assert.equal((concurrentNew[1].payload.results as Record<string, unknown>[])[0].replayed, true);


    const runE = await startRun("10873702", "1a000000-0000-4000-8000-000000000006");
    const runF = await startRun("10873703", "1a000000-0000-4000-8000-000000000007");
    const failureBody = { ...envelope, commandId: "1a000000-0000-4000-8000-00000000000e", bulkCommandId: "1a000000-0000-4000-8000-00000000000e", targets: [runD, runE, runF].map((runId) => ({ runId, expectedVersion: versionOf(runId) })) };
    const failId = deriveBulkChildCommandId(failureBody.bulkCommandId, runE);
    const raw = new DatabaseSync(join(h.stateRoot, "state.db"));
    try {
      raw.exec(`CREATE TRIGGER synthetic_child_failure BEFORE INSERT ON command_audits WHEN NEW.command_id = '${failId}' BEGIN SELECT RAISE(ABORT, 'synthetic-child-audit-failure'); END`);
      const failure = await postBulk(failureBody);
      assert.equal(failure.payload.requestedCount, 3);
      assert.deepEqual((failure.payload.results as Record<string, unknown>[]).map(({ outcome }) => outcome), ["applied", "errored"]);
      assert.equal(h.database.authority.commands.get(failId), undefined);
      assert.equal(h.database.authority.commands.get(deriveBulkChildCommandId(failureBody.bulkCommandId, runF)), undefined);
      assert.equal(versionOf(runE), failureBody.targets[1].expectedVersion);
      raw.exec("DROP TRIGGER synthetic_child_failure");
      const resumed = await postBulk(failureBody);
      const outcomes = resumed.payload.results as Record<string, unknown>[];
      assert.deepEqual(outcomes.map(({ outcome }) => outcome), ["applied", "applied", "applied"]);
      assert.equal(outcomes[0].replayed, true);
      assert.equal(outcomes[1].replayed, false);
      assert.equal(outcomes[2].replayed, false);
    } finally { raw.close(); }

  });


});

import { OPERATOR_JSON_HEADERS,assertHttpFaultOnly,disposeHttpRouteHarness,faultAuthoritySnapshot,harness,json,settingsAuthoritySnapshot } from "../../../../support/helpers/backend/http-route-harness.js";
afterEach(disposeHttpRouteHarness);
