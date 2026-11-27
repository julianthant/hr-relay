import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { afterAll, it } from "vitest";
import { createAssistantM1Service } from "../../../../../src/backend/assistant/service.js";
import type { DashboardApp } from "../../../../../src/backend/transports/http/routes/api-types.js";
import { registerAssistantRoutes } from "../../../../../src/backend/transports/http/routes/assistant.js";
import { registerChatGptAccountRoutes } from "../../../../../src/backend/transports/http/routes/chatgpt-account.js";
import { createProfileFixtureSet } from "../../../../support/helpers/admission-fixture.js";
import { chatGptFixture } from "../../../../support/helpers/chatgpt-account-fixtures.js";

const profiles = createProfileFixtureSet();
afterAll(() => profiles.close());
const status = "/api/v1/settings/chatgpt-account", models = "/api/v1/assistant/models";
const unused = () => { throw new Error("unexpected assistant owner"); };

async function setup() {
  const f = await chatGptFixture(undefined, profiles.create), app: DashboardApp = new Hono();
  registerChatGptAccountRoutes(app, { clock: f.clock, chatGptAccount: f.service });
  registerAssistantRoutes(app, createAssistantM1Service({ account: f.service, clock: f.clock, actorId: "local-operator", owner: unused, facts: unused,
    selectedModel: unused, history: unused, runReferenceLabel: unused, tools: unused, debugEvents: { emit: unused } }));
  const bytes = () => readFileSync(join(f.root, "credentials/chatgpt-account.json")).toString("base64");
  return { ...f, app, bytes };
}

const accounts = {
  "near its renewal": f => { f.clock.advanceWall(3_540_000); },
  expired: f => { f.clock.advanceWall(3_600_000); },
  "whose renewal would be denied": f => { f.clock.advanceWall(3_600_000); f.setTokenStatus(400, "invalid_grant"); },
  "that cannot be renewed": f => { f.clock.advanceWall(3_600_000); },
  "whose token the provider would reject": f => { f.setModelsHook(async () => Response.json({ detail: "rejected" }, { status: 401 })); },
  "with a registration and no session": async f => {
    const current = f.repository.read(); assert.ok(current);
    await f.repository.withLock(async transaction => { transaction.replace({ ...current, revision: current.revision + 1, session: null }, current.revision); });
  },
} satisfies Record<string, (f: Awaited<ReturnType<typeof setup>>) => void | Promise<void>>;

for (const [name, prepare] of Object.entries(accounts))
  for (const path of [status, models])
    it(`reads ${path} of an account ${name} without a provider call or a credential change`, async () => {
      const f = await setup();
      try {
        if (name === "that cannot be renewed") f.setToken({ refresh_token: undefined });
        await f.connected(); await prepare(f);
        const before = f.bytes(), calls = f.calls.length;
        for (const method of ["GET", "HEAD"]) {
          const response = await f.app.request(`http://127.0.0.1${path}`, { method });
          assert.equal(response.headers.get("cache-control"), "no-store");
          assert.deepEqual(f.calls.slice(calls).map(call => call.url), [], method);
          assert.equal(f.bytes(), before, method);
        }
      } finally { await f.cleanup(); }
    });

it("reads a finished sign-in without renewing the account it stored", async () => {
  const f = await setup();
  try {
    const post = await f.app.request(`http://127.0.0.1${status}/sign-in`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"usePlan":true}' });
    const started = await post.json() as { attemptId: string; authorizationUrl: string };
    await f.callback({ authorizationUrl: started.authorizationUrl });
    const read = () => f.app.request(`http://127.0.0.1${status}/sign-in/${started.attemptId}`);
    const completed: unknown = await (await read()).json();
    f.clock.advanceWall(3_600_000);
    const before = f.bytes(), calls = f.calls.length, replayed = await read();
    assert.equal(replayed.status, 200);
    assert.deepEqual(await replayed.json(), completed);
    assert.deepEqual(f.calls.slice(calls).map(call => call.url), []);
    assert.equal(f.bytes(), before);
  } finally { await f.cleanup(); }
});
