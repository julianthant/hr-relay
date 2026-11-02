import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { createDashboardClient,DashboardClientError } from "../../../src/dashboard/client/index.js";

describe("Settings editor client", () => {
  it("asks the BFF for the server-listed editable inventory", async () => {
    const requests: string[] = [];
    const client = createDashboardClient({
      baseUrl: "http://bff.test",
      fetchImpl: async (input) => {
        requests.push(input);
        return new Response(JSON.stringify({}), { status: 200 });
      },
    });

    await assert.rejects(client.editableSettings(), /GET \/api\/v1\/settings\/editable/);
    assert.deepEqual(requests, ["http://bff.test/api/v1/settings/editable"]);
  });
});


it("validates Settings reply identity and retains the offending reply", async () => {
  const hash = "d".repeat(64);
  const command = { commandId: "11111111-1111-4111-8111-111111111111", requestedAt: "2026-08-03T12:00:00.000Z",
    requestedBy: "local-operator", source: "dashboard", family: "settings", type: "apply-settings", target: { expectedRevision: 1 },
    payload: { settingsSchemaHash: hash, patchFingerprint: hash, patch: { "timeouts.navigationMs": { set: 2000 } } } };
  let wrongId = true;
  let wrongTarget = false;
  let malformed = false;
  let reply: unknown;
  const client = createDashboardClient({ baseUrl: "http://bff.test", fetchImpl: async () => {
    reply = malformed ? {} : { state: "applied", commandId: wrongId ? "99999999-9999-4999-8999-999999999999" : command.commandId,
      affectedTargets: [wrongTarget ? { family: "intake", intakeSessionId: command.commandId } : { family: "settings", revision: 2 }],
      ...(!wrongTarget ? { restartRequired: false, settingsRevision: 2, settingsFingerprint: hash } : {}) };
    return Response.json(reply);
  } });
  const send = () => client.applySettings(command);
  await assert.rejects(send(), (error: unknown) => error instanceof DashboardClientError && error.code === "COMMAND_RESULT_IDENTITY_MISMATCH"
    && JSON.stringify(error.cause) === JSON.stringify(reply));
  wrongId = false;
  assert.equal((await send()).state, "applied");
  wrongTarget = true;
  await assert.rejects(send(), (error: unknown) => error instanceof DashboardClientError && error.code === "COMMAND_RESULT_IDENTITY_MISMATCH");
  malformed = true;
  await assert.rejects(send(), (error: unknown) => error instanceof DashboardClientError && error.kind === "schema" && error.cause !== undefined);
});
