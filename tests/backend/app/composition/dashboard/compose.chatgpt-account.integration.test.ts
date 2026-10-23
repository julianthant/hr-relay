import { manualClock } from "../../../../../src/rules/time/clock.js";
import assert from "node:assert/strict";
import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { it, vi } from "vitest";
import * as accounts from "../../../../../src/backend/accounts/chatgpt-account-service.js";
import { composeProfileRuntime } from "../../../../../src/backend/app/composition/storage-compose.js";
import { composeDashboardRuntime } from "../../../../../src/backend/app/composition/dashboard/compose.js";
import { rebuildRuntimeIsolation } from "../../../../../src/backend/app/config/runtime-isolation.js";
import { ChatGptSignInStartSchema } from "../../../../../src/models/dashboard/chatgpt-account.js";
import { createBoundProfileFixture } from "../../../../support/helpers/admission-fixture.js";
import { healthyRuntimePreflightRunners } from "../../../../support/fixtures/preflight-seams.js";

for (const startupFailure of [false, true]) it(`closes pending account completion before HTTP drain during ${startupFailure ? "startup unwind" : "shutdown"}`, async () => {
  const profile = createBoundProfileFixture(), repoRoot = profile.workspace;
  const clock = manualClock(new Date("2026-10-12T12:00:00.000Z"));
  for (const file of ["package.json", "package-lock.json"]) copyFileSync(join(process.cwd(), file), join(repoRoot, file));
  let accountClosed = false, httpClosed = false, networkReads = 0;
  const createAccount = accounts.createChatGptAccountService;
  const factory = vi.spyOn(accounts, "createChatGptAccountService").mockImplementation(options => {
    const actual = createAccount({ ...options, fetch: async () => { networkReads++; throw new Error("pending sign-in must not access the network"); } });
    return { ...actual, close: async () => { await actual.close(); accountClosed = true; } };
  });
  const runtime = composeProfileRuntime({ admission: profile.machine, clock, hostFacts: { primaryDisplay: null },
    processLockRoot: join(repoRoot, rebuildRuntimeIsolation.processLockRoot) });
  const active = runtime.session.signIn({ email: "fixture@example.edu", password: "disposable-fixture-password", at: clock.now().toISOString() });
  assert.equal(active.state, "active");
  const primary = new Error("synthetic post-listen failure");
  try {
    const composed = composeDashboardRuntime({ admission: profile.machine, profile: { runtime, token: active.token }, clock, repoRoot, isolation: rebuildRuntimeIsolation, backendPortOverride: 0, frontendPortOverride: 0, env: {},
      preflightRunnerFactory: healthyRuntimePreflightRunners,
      httpServerStarter: async ({ app }) => {
        const started = ChatGptSignInStartSchema.parse(await (await app.request("http://127.0.0.1/api/v1/settings/chatgpt-account/sign-in", {
          method: "POST", headers: { host: "127.0.0.1", origin: "http://127.0.0.1", "content-type": "application/json" }, body: JSON.stringify({ usePlan: true }),
        })).json());
        const completion = app.request(`/api/v1/settings/chatgpt-account/sign-in/${started.attemptId}`);
        return { get port() { if (startupFailure) throw primary; return 12345; }, close: async () => {
          assert.equal(accountClosed, true);
          const response = await completion;
          assert.equal((await response.json() as { code: string }).code, "CHATGPT_AUTH_CANCELLED");
          httpClosed = true;
        } };
      } });
    if (startupFailure) await assert.rejects(composed, error => error === primary);
    else await (await composed).stop();
    assert.equal(httpClosed, true);
    assert.equal(networkReads, 0);
    assert.equal(factory.mock.calls[0]?.[0].stateRoot, profile.stateRoot);
  } finally { factory.mockRestore(); await runtime.close(); profile.close(); }
});
