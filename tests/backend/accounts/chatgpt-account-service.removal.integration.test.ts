import assert from "node:assert/strict";
import { it } from "vitest";
import { chatGptFixture } from "../../support/helpers/chatgpt-account-fixtures.js";

it("forgets an expired connection on the next account read", async () => {
  const f = await chatGptFixture();
  try {
    await f.connected(); const before = f.repository.read(); assert.ok(before);
    f.clock.advanceWall(3_600_000); f.setTokenStatus(400, "invalid_grant");
    assert.deepEqual(await f.service.refreshAccount(), { state: "signed-out" });
    const after = f.repository.read(); assert.ok(after);
    assert.deepEqual(after, { schemaVersion: 1, revision: before.revision + 1, hostId: after.hostId, clientId: null, registration: null, session: null });
    assert.notEqual(after.hostId, before.hostId);
  } finally { await f.cleanup(); }
});
it("forgets a session that cannot be renewed once it has expired", async () => {
  const f = await chatGptFixture();
  try {
    f.setToken({ refresh_token: undefined }); f.setScopes("openid profile email");
    await f.connected(false); f.clock.advanceWall(3_540_000);
    assert.equal((await f.service.refreshAccount()).state, "connected");
    f.clock.advanceWall(60_000);
    assert.deepEqual(await f.service.refreshAccount(), { state: "signed-out" });
    assert.equal(f.repository.read()?.registration, null); assert.equal(f.repository.read()?.session, null);
    assert.equal(f.calls.filter(call => call.url.endsWith("/oauth/token")).length, 1);
  } finally { await f.cleanup(); }
});
it("reads a stored registration without a session as not connected and signs in fresh as another person", async () => {
  const f = await chatGptFixture();
  try {
    await f.connected(); const connected = f.repository.read(); assert.ok(connected);
    await f.repository.withLock(async transaction => { transaction.replace({ ...connected, revision: connected.revision + 1, session: null }, connected.revision); });
    assert.deepEqual(f.service.readAccount(), { state: "signed-out" });
    assert.deepEqual(await f.service.refreshAccount(), { state: "signed-out" });
    const attempt = await f.service.signIn({ usePlan: true }), url = new URL(attempt.authorizationUrl);
    assert.equal(url.searchParams.has("login_hint"), false);
    assert.equal(url.searchParams.get("client_id"), "dynamic_agent_client"); assert.equal(url.searchParams.get("agent_name_hint"), "Relay");
    assert.notEqual(url.searchParams.get("ext_agent_host_id"), connected.hostId);
    f.setClaims({ sub: "other-subject" }); await f.callback(attempt);
    assert.equal((await attempt.completion).state, "connected");
    assert.equal(f.repository.read()?.registration?.subject, "other-subject");
  } finally { await f.cleanup(); }
});
for (const ending of ["refresh-denied", "unrenewable-expired"] as const)
  it(`shows the plain connect state on the first status read that forgets a ${ending} connection`, async () => {
    const f = await chatGptFixture();
    try {
      if (ending === "unrenewable-expired") f.setToken({ refresh_token: undefined });
      await f.connected(); f.clock.advanceWall(3_600_000);
      if (ending === "refresh-denied") f.setTokenStatus(400, "invalid_grant");
      const status = await f.service.readStatus();
      assert.deepEqual(status.account, { state: "signed-out" }); assert.deepEqual(status.usage, { state: "unavailable", reason: "signed-out" });
      assert.equal(f.repository.read()?.registration, null); assert.equal(f.repository.read()?.session, null);
      assert.deepEqual((await f.service.readStatus()).account, { state: "signed-out" });
    } finally { await f.cleanup(); }
  });
it("forgets an unrenewable connection whose access token is rejected", async () => {
  const f = await chatGptFixture();
  try {
    f.setToken({ refresh_token: undefined }); await f.connected();
    f.setModelsHook(async () => Response.json({ detail: "rejected" }, { status: 401 }));
    for (let read = 1; read <= 2; read++) {
      const status = await f.service.readStatus();
      assert.deepEqual(status.account, { state: "signed-out" }, `read ${String(read)}`);
      assert.equal(f.repository.read()?.registration, null); assert.equal(f.repository.read()?.session, null);
    }
    assert.equal(f.calls.filter(call => call.url.endsWith("/models")).length, 1);
  } finally { await f.cleanup(); }
});
