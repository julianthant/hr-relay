import { createRunIntegrationTestWorld } from "../../support/helpers/run-integration-world.js";
import assert from "node:assert/strict";

import { afterEach, describe, it } from "vitest";
import { completionFromAuthorization } from "../../../src/models/run/completion.js";
import { deriveRunResultDigest } from "../../../src/models/run/result.js";
import { TerminalAuthorizationRecordSchema } from "../../../src/models/run/terminal-authorization.js";
import { LATER, UUID_6 } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { RUN_ID } from "../../support/fixtures/phase1f-run-fixtures.js";
import { personLookupDescriptor } from "../../support/helpers/registered-workflows.js";

const { ACTIVE, openDatabase, startRunning, resultRequest, cleanup, failure, failureAuthorization } = createRunIntegrationTestWorld();






afterEach(cleanup);

describe("atomic failure terminal authority", () => {
  it("inserts the exact failure, transitions failed, lists by run, and replays byte-exactly", async () => {
    const database = await openDatabase();
    const running = startRunning(database);
    const record = failure(running);
    const request = {
      failure: record,
      authorization: failureAuthorization(running),
    } as const;
    const applied = database.terminalizeFailure(personLookupDescriptor, request);
    assert.equal(applied.state, "applied");
    assert.deepEqual(applied.run.lifecycle, {
      state: "terminal",
      outcome: "failed",
      endedAt: LATER,
      failureId: UUID_6,
      errorSummary: record.summary,
    });
    assert.deepEqual(database.authority.failures.get(UUID_6), record);
    assert.deepEqual(database.authority.failures.listByRun(RUN_ID), [record]);
    assert.deepEqual(database.authority.runs.get(RUN_ID)?.completion, completionFromAuthorization(TerminalAuthorizationRecordSchema.parse(request.authorization)));
    assert.equal(database.terminalizeFailure(personLookupDescriptor, request).state, "replayed");
    assert.throws(
      () => database.terminalizeFailure(personLookupDescriptor, {
        ...request,
        authorization: {
          ...request.authorization,
          expectedVersion: request.authorization.expectedVersion - 1,
        },
      }),
      /original pre-terminal claim/,
    );
    assert.throws(
      () => database.terminalizeFailure(personLookupDescriptor, {
        ...request,
        authorization: {
          ...request.authorization,
          claim: { workerId: "worker-2", claimGeneration: 1 },
        },
      }),
      /original pre-terminal claim/,
    );
    assert.throws(
      () => database.terminalizeFailure(personLookupDescriptor, {
        ...request,
        failure: { ...record, summary: "different safe summary" },
      }),
      /different content/,
    );
  });
});

describe("atomic success terminal authority", () => {

  it("inserts result and same-row completion without outbox, transitions done, and replays byte-exactly", async () => {
    const database = await openDatabase();
    const running = startRunning(database);
    const { result, authorization, factoryAuthorization } = resultRequest(database, running);
    const request = { result, authorization };
    const applied = database.terminalizeSuccess(request, factoryAuthorization);
    assert.equal(applied.state, "applied");
    assert.deepEqual(applied.run.lifecycle, { state: "terminal", outcome: "done", endedAt: LATER });
    assert.deepEqual(database.authority.runResults.get(RUN_ID), result);
    assert.deepEqual(database.authority.runs.get(RUN_ID)?.completion, completionFromAuthorization(TerminalAuthorizationRecordSchema.parse(authorization)));
    assert.equal(database.terminalizeSuccess(request).state, "replayed");
    assert.throws(
      () => database.terminalizeSuccess({
        ...request,
        authorization: { ...authorization, expectedVersion: authorization.expectedVersion - 1 },
      }),
      /original pre-terminal claim/,
    );
    assert.throws(
      () => database.terminalizeSuccess({
        ...request,
        authorization: {
          ...authorization,
          claim: { workerId: "worker-2", claimGeneration: 1 },
        },
      }),
      /original pre-terminal claim/,
    );
    const changedResultValue = {
      schemaHash: result.result.schemaHash,
      value: {
        activeStatus: { ...ACTIVE, reason: "a different derived reason" },
        crmDates: { state: "not-requested" },
      },
    };
    const changedResult = {
      ...result,
      result: changedResultValue,
      resultDigest: deriveRunResultDigest(changedResultValue),
    };
    assert.throws(
      () => database.terminalizeSuccess({
        ...request,
        result: changedResult,
        authorization: { ...authorization, resultDigest: changedResult.resultDigest },
      }),
      /original pre-terminal claim/,
    );

  });
});
