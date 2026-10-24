import { manualClock } from "../../../../../src/rules/time/clock.js";
import assert from "node:assert/strict";
import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { startDashboardHttpServer } from "../../../../../src/backend/transports/http/http-server.js";
import { it, vi } from "vitest";
import * as accounts from "../../../../../src/backend/accounts/chatgpt-account-service.js";
import * as processLocks from "../../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { readRuntimeProcessLock } from "../../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { readFileSync } from "node:fs";
import { composeProfileRuntime, RuntimeCustodyUncertainError } from "../../../../../src/backend/app/composition/storage-compose.js";
import { composeDashboardRuntime } from "../../../../../src/backend/app/composition/dashboard/compose.js";
import { rebuildRuntimeIsolation } from "../../../../../src/backend/app/config/runtime-isolation.js";
import { ChatGptSignInStartSchema } from "../../../../../src/models/dashboard/chatgpt-account.js";
import { createBoundProfileFixture } from "../../../../support/helpers/admission-fixture.js";
import { healthyRuntimePreflightRunners } from "../../../../support/fixtures/preflight-seams.js";

for (const startupFailure of [false, true]) it(`drains a pending HTTP completion before account closure during ${startupFailure ? "startup unwind" : "shutdown"}`, async () => {
  const profile = createBoundProfileFixture(), repoRoot = profile.workspace;
  const clock = manualClock(new Date("2026-10-12T12:00:00.000Z"));
  for (const file of ["package.json", "package-lock.json"]) copyFileSync(join(process.cwd(), file), join(repoRoot, file));
  let accountClosed = false, httpClosed = false, requestAborted = false, networkReads = 0;
  let completionFailure: Promise<unknown> | undefined;
  const createAccount = accounts.createChatGptAccountService;
  const factory = vi.spyOn(accounts, "createChatGptAccountService").mockImplementation(options => {
    const actual = createAccount({ ...options, fetch: async () => { networkReads++; throw new Error("pending sign-in must not access the network"); } });
    return { ...actual, signIn: async (input: Parameters<typeof actual.signIn>[0]) => {
      const authorization = await actual.signIn(input);
      completionFailure = authorization.completion.then(() => undefined, (error: unknown) => error);
      return authorization;
    }, close: async () => { assert.equal(httpClosed, true); assert.equal(requestAborted, true); await actual.close(); accountClosed = true; } };
  });
  const runtime = composeProfileRuntime({ admission: profile.machine, clock, hostFacts: { primaryDisplay: null },
    processLockRoot: join(repoRoot, rebuildRuntimeIsolation.processLockRoot) });
  const active = runtime.session.signIn({ email: "fixture@example.edu", password: "disposable-fixture-password", at: clock.now().toISOString() });
  assert.equal(active.state, "active");
  const primary = new Error("synthetic post-listen failure");
  try {
    const composed = composeDashboardRuntime({ admission: profile.machine, profile: { runtime, token: active.token }, clock, repoRoot, isolation: rebuildRuntimeIsolation, backendPortOverride: 0, frontendPortOverride: 0, env: {},
      preflightRunnerFactory: healthyRuntimePreflightRunners,
      httpServerStarter: async input => {
        const { app } = input;
        const started = ChatGptSignInStartSchema.parse(await (await app.request("http://127.0.0.1/api/v1/settings/chatgpt-account/sign-in", {
          method: "POST", headers: { host: "127.0.0.1", origin: "http://127.0.0.1", "content-type": "application/json" }, body: JSON.stringify({ usePlan: true }),
        })).json());
        const completionPath = `/api/v1/settings/chatgpt-account/sign-in/${started.attemptId}`;
        let entered = (): void => { throw new Error("completion request not initialized"); };
        const accepted = new Promise<void>(resolve => { entered = resolve; });
        const actualFetch = app.fetch;
        const handler = vi.spyOn(app, "fetch").mockImplementation((request, ...args) => {
          if (new URL(request.url).pathname === completionPath) {
            request.signal.addEventListener("abort", () => { requestAborted = true; }, { once: true });
            entered();
          }
          return actualFetch(request, ...args);
        });
        const server = await startDashboardHttpServer(input);
        const completion = fetch(`http://127.0.0.1:${String(server.port)}${completionPath}`)
          .then(async response => { await response.arrayBuffer(); return response; }).catch((error: unknown) => error);
        await accepted;
        return { get port() { if (startupFailure) throw primary; return server.port; }, close: async () => {
          assert.equal(accountClosed, false);
          await server.close();
          assert.equal(requestAborted, true);
          assert.ok(await completion instanceof TypeError);
          handler.mockRestore();
          httpClosed = true;
        } };
      } });
    if (startupFailure) await assert.rejects(composed, error => error === primary);
    else await (await composed).stop();
    assert.equal(httpClosed, true);
    assert.equal(accountClosed, true);
    assert.ok(completionFailure);
    const cancelled = await completionFailure; assert.ok(cancelled instanceof accounts.ChatGptAccountError);
    assert.equal(cancelled.code, "CHATGPT_AUTH_CANCELLED");
    assert.equal(networkReads, 0);
    assert.equal(factory.mock.calls[0]?.[0].stateRoot, profile.stateRoot);
  } finally { factory.mockRestore(); await runtime.close(); profile.close(); }
});

it("retains actual account, database and process custody when cleanup refuses after the pending HTTP wait drains", async () => {
  const profile = createBoundProfileFixture(), repoRoot = profile.workspace;
  const clock = manualClock(new Date("2026-10-21T12:00:00.000Z"));
  for (const file of ["package.json", "package-lock.json"]) copyFileSync(join(process.cwd(), file), join(repoRoot, file));
  const primary = new Error("synthetic account cleanup refusal"), errors: unknown[] = [];
  let actualAccount: accounts.ChatGptAccountService | undefined;
  let role: processLocks.RuntimeProcessLockHandle | undefined;
  let httpClosed = false, networkReads = 0, callbackUrl: string | undefined;
  const actualCreate = accounts.createChatGptAccountService;
  const factory = vi.spyOn(accounts, "createChatGptAccountService").mockImplementation(options => {
    actualAccount = actualCreate({ ...options, fetch: async () => { networkReads++; throw new Error("external transport forbidden"); } });
    return { ...actualAccount, close: async () => { assert.equal(httpClosed, true); throw primary; } };
  });
  const actualAcquire = processLocks.acquireRuntimeProcessLock;
  const acquisition = vi.spyOn(processLocks, "acquireRuntimeProcessLock").mockImplementation((...args) => {
    const handle = actualAcquire(...args);
    if (processLocks.RuntimeProcessLockOptionsSchema.parse(args[0]).name === "server") role = handle;
    return handle;
  });
  const lockRoot = join(repoRoot, rebuildRuntimeIsolation.processLockRoot);
  const runtime = composeProfileRuntime({ admission: profile.machine, clock, hostFacts: { primaryDisplay: null }, processLockRoot: lockRoot });
  const active = runtime.session.signIn({ email: "fixture@example.edu", password: "disposable-fixture-password", at: clock.now().toISOString() });
  assert.equal(active.state, "active");
  if (active.state !== "active") throw new Error("fixture-profile-sign-in-refused");
  const context = runtime.selectedContext(active.token);
  const protectedPath = join(profile.stateRoot, "credentials", "protected.json"), protectedBefore = readFileSync(protectedPath);
  let retentionProved = false;
  try {
    const dashboard = await composeDashboardRuntime({ admission: profile.machine, profile: { runtime, token: active.token }, clock, repoRoot,
      isolation: rebuildRuntimeIsolation, backendPortOverride: 0, frontendPortOverride: 0, env: {}, preflightRunnerFactory: healthyRuntimePreflightRunners,
      httpServerStarter: async input => {
        const started = ChatGptSignInStartSchema.parse(await (await input.app.request("http://127.0.0.1/api/v1/settings/chatgpt-account/sign-in", {
          method: "POST", headers: { host: "127.0.0.1", origin: "http://127.0.0.1", "content-type": "application/json" }, body: JSON.stringify({ usePlan: true }),
        })).json());
        const redirect = new URL(started.authorizationUrl).searchParams.get("redirect_uri"); assert.ok(redirect); callbackUrl = redirect;
        const completionPath = `/api/v1/settings/chatgpt-account/sign-in/${started.attemptId}`;
        let entered = (): void => { throw new Error("completion request not initialized"); };
        const accepted = new Promise<void>(resolve => { entered = resolve; });
        const actualFetch = input.app.fetch;
        const handler = vi.spyOn(input.app, "fetch").mockImplementation((request, ...args) => {
          if (new URL(request.url).pathname === completionPath) entered();
          return actualFetch(request, ...args);
        });
        const server = await startDashboardHttpServer(input);
        const completion = fetch(`http://127.0.0.1:${String(server.port)}${completionPath}`)
          .then(async response => { await response.arrayBuffer(); return response; }).catch((error: unknown) => error);
        await accepted;
        return { port: server.port, close: async () => {
          await server.close(); assert.ok(await completion instanceof TypeError); handler.mockRestore(); httpClosed = true;
        } };
      } });
    await assert.rejects(dashboard.stop(), error => {
      assert.ok(error instanceof RuntimeCustodyUncertainError); assert.equal(error.errors.length, 1);
      const detached: unknown = error.errors[0]; assert.ok(detached instanceof RuntimeCustodyUncertainError);
      assert.deepEqual(detached.errors, [primary]); assert.equal(detached.cause, primary); assert.equal(error.cause, detached); return true;
    });
    assert.equal(httpClosed, true); assert.equal(networkReads, 0);
    assert.ok(callbackUrl); assert.equal((await fetch(callbackUrl)).status, 400);
    assert.equal(context.database.getMeta().profileId, active.profileId);
    context.admission.assertLive(); profile.machine.assertLive();
    assert.deepEqual(readFileSync(protectedPath), protectedBefore);
    const current = readRuntimeProcessLock(lockRoot, "server"); assert.ok(current); assert.ok(role);
    assert.equal(current.acquisitionId, role.acquisitionId); assert.equal(current.releasedAt, null);
    retentionProved = true;
  } catch (error) { errors.push(error); }
  factory.mockRestore(); acquisition.mockRestore();
  if (retentionProved) {
    try {
      assert.ok(actualAccount); await actualAccount.close();
      assert.ok(callbackUrl); await assert.rejects(fetch(callbackUrl));
      context.database.close(); context.admission.release(); assert.ok(role); role.release(); profile.close();
    } catch (error) { errors.push(error); }
  }
  if (errors.length > 0) throw new AggregateError(errors, "account cleanup custody proof failed", { cause: errors[0] });
});
