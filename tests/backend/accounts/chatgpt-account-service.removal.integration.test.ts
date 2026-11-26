import assert from "node:assert/strict";
import { it, vi } from "vitest";
import { chatGptFixture } from "../../support/helpers/chatgpt-account-fixtures.js";

it("forgets an expired connection on the next account check", async () => {
  const f = await chatGptFixture();
  try {
    await f.connected(); const before = f.repository.read(); assert.ok(before);
    f.clock.advanceWall(3_600_000); f.setTokenStatus(400, "invalid_grant");
    assert.deepEqual((await f.service.checkStatus()).account, { state: "signed-out" });
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
    const ending = f.repository.read();
    assert.equal((await f.service.checkStatus()).account.state, "connected");
    assert.deepEqual(f.repository.read(), ending);
    f.clock.advanceWall(60_000);
    assert.deepEqual((await f.service.checkStatus()).account, { state: "signed-out" });
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
    assert.deepEqual((await f.service.checkStatus()).account, { state: "signed-out" });
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
  it(`shows the plain connect state on the first status check that forgets a ${ending} connection`, async () => {
    const f = await chatGptFixture();
    try {
      if (ending === "unrenewable-expired") f.setToken({ refresh_token: undefined });
      await f.connected(); f.clock.advanceWall(3_600_000);
      if (ending === "refresh-denied") f.setTokenStatus(400, "invalid_grant");
      const status = await f.service.checkStatus();
      assert.deepEqual(status.account, { state: "signed-out" }); assert.deepEqual(status.usage, { state: "unavailable", reason: "signed-out" });
      assert.equal(f.repository.read()?.registration, null); assert.equal(f.repository.read()?.session, null);
      assert.deepEqual(f.service.readStatus(), status);
    } finally { await f.cleanup(); }
  });
it("forgets an unrenewable connection whose access token is rejected", async () => {
  const f = await chatGptFixture();
  try {
    f.setToken({ refresh_token: undefined }); await f.connected();
    f.setModelsHook(async () => Response.json({ detail: "rejected" }, { status: 401 }));
    for (let read = 1; read <= 2; read++) {
      const status = await f.service.checkStatus();
      assert.deepEqual(status.account, { state: "signed-out" }, `check ${String(read)}`);
      assert.equal(f.repository.read()?.registration, null); assert.equal(f.repository.read()?.session, null);
    }
    assert.equal(f.calls.filter(call => call.url.endsWith("/models")).length, 1);
  } finally { await f.cleanup(); }
});
it("connects fresh after a connect that stopped once the callback stored its client", async () => {
  const f = await chatGptFixture();
  try {
    f.setTokenStatus(400); const stopped = await f.service.signIn({ usePlan: true }); await f.callback(stopped);
    await assert.rejects(stopped.completion, { code: "CHATGPT_ACCOUNT_EXPIRED" });
    const leftover = f.repository.read(); assert.equal(leftover?.clientId, "oaiapp_fixture"); assert.equal(leftover.session, null);
    assert.deepEqual(f.service.readStatus().account, { state: "signed-out" });
    f.setTokenStatus(200);
    const attempt = await f.service.signIn({ usePlan: true }), url = new URL(attempt.authorizationUrl);
    assert.equal(url.searchParams.get("client_id"), "dynamic_agent_client"); assert.equal(url.searchParams.get("agent_name_hint"), "Relay");
    assert.equal(url.searchParams.has("login_hint"), false); assert.notEqual(url.searchParams.get("ext_agent_host_id"), leftover.hostId);
    f.setClaims({ aud: "oaiapp_fresh" }); await f.callback(attempt, { client_id: "oaiapp_fresh" });
    assert.equal((await attempt.completion).state, "connected"); assert.equal(f.repository.read()?.clientId, "oaiapp_fresh");
  } finally { await f.cleanup(); }
});
for (const leftover of ["client", "client and identity"] as const)
  it(`reads a stored ${leftover} without a session as not connected and connects with the dynamic client and no login hint`, async () => {
    const f = await chatGptFixture();
    try {
      await f.connected(); const connected = f.repository.read(); assert.ok(connected);
      await f.repository.withLock(async transaction => {
        transaction.replace({ ...connected, revision: connected.revision + 1, session: null, ...(leftover === "client" ? { registration: null } : {}) }, connected.revision);
      });
      assert.deepEqual(f.service.readAccount(), { state: "signed-out" });
      assert.deepEqual(f.service.readStatus().account, { state: "signed-out" });
      const url = new URL((await f.service.signIn({ usePlan: true })).authorizationUrl);
      assert.equal(url.searchParams.get("client_id"), "dynamic_agent_client"); assert.equal(url.searchParams.has("login_hint"), false);
      assert.notEqual(url.searchParams.get("ext_agent_host_id"), connected.hostId);
    } finally { await f.cleanup(); }
  });
for (const ending of ["refused", "cancelled"] as const)
  it(`sign-out forgets the client a ${ending} connect stored after its callback`, async () => {
    const f = await chatGptFixture();
    const exchange = Promise.withResolvers<void>();
    try {
      if (ending === "refused") f.setTokenStatus(400);
      else f.setTokenHook(() => exchange.promise);
      const stopped = await f.service.signIn({ usePlan: true }); await f.callback(stopped);
      if (ending === "refused") await assert.rejects(stopped.completion, { code: "CHATGPT_ACCOUNT_EXPIRED" });
      else await vi.waitFor(() => { assert.equal(f.repository.read()?.clientId, "oaiapp_fixture"); });
      const leftover = f.repository.read(); assert.ok(leftover); assert.equal(leftover.clientId, "oaiapp_fixture"); assert.equal(leftover.session, null);
      assert.deepEqual(await f.service.signOut(), { state: "signed-out", remoteRevocation: "not-needed" });
      exchange.resolve(); await stopped.completion.catch(() => undefined);
      const after = f.repository.read(); assert.ok(after);
      assert.deepEqual(after, { schemaVersion: 1, revision: after.revision, hostId: after.hostId, clientId: null, registration: null, session: null });
      assert.ok(after.revision > leftover.revision); assert.notEqual(after.hostId, leftover.hostId);
    } finally { exchange.resolve(); await f.cleanup(); }
  });
