import assert from "node:assert/strict";
import { copyFileSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { it, vi } from "vitest";
import * as accounts from "../../../../../src/backend/accounts/chatgpt-account-service.js";
import { composeDashboardRuntime } from "../../../../../src/backend/app/composition/dashboard/compose.js";
import { composeProfileRuntime } from "../../../../../src/backend/app/composition/storage-compose.js";
import { rebuildRuntimeIsolation } from "../../../../../src/backend/app/config/runtime-isolation.js";
import { CHATGPT_OCR_MODEL } from "../../../../../src/backend/processing/providers/chatgpt-ocr-adapter.js";
import type { DashboardApp } from "../../../../../src/backend/transports/http/routes/api-types.js";
import { createBoundProfileFixture } from "../../../../support/helpers/admission-fixture.js";
import { chatGptFixture, completedOcrStream } from "../../../../support/helpers/chatgpt-account-fixtures.js";

it("the actual selected dashboard Test OCR uses its account, fixed page and shared reader without a workflow execution", async () => {
  const profile = createBoundProfileFixture(), transport = chatGptFixture(profile.admission);
  for (const file of ["package.json", "package-lock.json"]) copyFileSync(file, join(profile.workspace, file));
  const createAccount = accounts.createChatGptAccountService;
  let account: accounts.ChatGptAccountService | undefined, app: DashboardApp | undefined;
  const factory = vi.spyOn(accounts, "createChatGptAccountService").mockImplementation(options => {
    account = createAccount({ ...options, fetch: transport.transport }); return account;
  });
  const runtime = composeProfileRuntime({ admission: profile.machine, clock: transport.clock, hostFacts: { primaryDisplay: null },
    processLockRoot: join(profile.workspace, rebuildRuntimeIsolation.processLockRoot) });
  const active = runtime.session.signIn({ email: "fixture@example.edu", password: "disposable-fixture-password", at: transport.clock.now().toISOString() });
  assert.equal(active.state, "active");
  if (active.state !== "active") throw new Error("synthetic selected context required");
  let dashboard: Awaited<ReturnType<typeof composeDashboardRuntime>> | undefined;
  try {
    dashboard = await composeDashboardRuntime({ admission: profile.machine, profile: { runtime, token: active.token },
      repoRoot: profile.workspace, clock: transport.clock, isolation: rebuildRuntimeIsolation, backendPortOverride: 0, frontendPortOverride: 0, env: {},
      httpServerStarter: async input => { app = input.app; return { port: 12345, close: async () => undefined }; } });
    assert.ok(app); assert.ok(account);
    const headers = { host: "127.0.0.1", origin: "http://127.0.0.1", "content-type": "application/json" };
    const actualApp = app;
    const invoke = (body = "{}", signal?: AbortSignal) => actualApp.request("http://127.0.0.1/api/v1/settings/chatgpt-account/test-ocr", { method: "POST", headers, body, signal });
    const missing = await invoke(); assert.equal((await missing.json() as { state: string }).state, "refused");
    assert.equal(transport.calls.filter(call => call.url.endsWith("/responses")).length, 0);
    const attempt = await account.signIn({ usePlan: true }); await transport.callback(attempt); await attempt.completion;
    transport.setResponse(init => {
      assert.equal(typeof init.body, "string");
      if (typeof init.body !== "string") throw new Error("synthetic OCR request must be JSON");
      const body = JSON.parse(init.body) as { model: string; store: boolean; stream: boolean; input: { content: { type: string; text?: string; filename?: string }[] }[] };
      assert.equal(body.model, CHATGPT_OCR_MODEL); assert.equal(body.store, false); assert.equal(body.stream, true);
      const content = body.input[0]?.content; assert.ok(content);
      assert.equal(content[1]?.type, "input_file"); assert.equal(content[1]?.filename, "page.pdf");
      const instruction = content[0]?.text; assert.ok(instruction);
      const marker = "Use exactly this invocation metadata: ", index = instruction.indexOf(marker); assert.ok(index >= 0);
      const metadata: unknown = JSON.parse(instruction.slice(index + marker.length));
      assert.ok(typeof metadata === "object" && metadata !== null);
      return new Response(completedOcrStream(JSON.stringify({ ...metadata, pageKind: "oath", record: { answers: {
        printedName: { state: "read", raw: "Example, Avery", confidence: 1 }, employeeId: { state: "read", raw: "10800000", confidence: 1 },
        signatureDate: { state: "read", raw: "07/21/2026", confidence: 1 }, employeeSigned: { state: "read", raw: "yes", confidence: 1 }, officerSigned: { state: "read", raw: "yes", confidence: 1 },
      } } }), CHATGPT_OCR_MODEL), { headers: { "content-type": "text/event-stream" } });
    });
    await account.readAuthority();
    const profileBytes = () => {
      const files = new Map<string, { device: number; inode: number; mode: number; bytes?: Buffer }>();
      const visit = (relative: string): void => {
        const path = join(profile.stateRoot, relative), stat = lstatSync(path);
        assert.equal(stat.isSymbolicLink(), false);
        files.set(relative, { device: stat.dev, inode: stat.ino, mode: stat.mode,
          ...(stat.isDirectory() ? {} : { bytes: readFileSync(path) }) });
        if (stat.isDirectory()) for (const name of readdirSync(path).sort()) visit(join(relative, name));
      };
      visit(""); return files;
    };
    const before = profileBytes();
    const unchanged = () => {
      const after = profileBytes(); assert.deepEqual([...after.keys()], [...before.keys()]);
      for (const [path, value] of after) {
        const prior = before.get(path); assert.ok(prior);
        assert.equal(value.device, prior.device); assert.equal(value.inode, prior.inode); assert.equal(value.mode, prior.mode);
        assert.equal(value.bytes === undefined, prior.bytes === undefined);
        if (value.bytes !== undefined) { assert.ok(prior.bytes); assert.equal(value.bytes.equals(prior.bytes), true); }
      }
    };
    const context = runtime.selectedContext(active.token), generation = context.database.getMeta().authorityGeneration;
    assert.equal((await (await invoke('{"page":"foreign"}')).json() as { state: string }).state, "refused");
    assert.equal(transport.calls.filter(call => call.url.endsWith("/responses")).length, 0);
    const response = await invoke(); assert.deepEqual(await response.json(), { state: "completed", model: CHATGPT_OCR_MODEL });
    assert.equal(transport.calls.filter(call => call.url.endsWith("/responses")).length, 1); unchanged();
    transport.setResponse(() => Response.json({ error: { code: "subscription_sharing_unsupported_capability" } }, { status: 400 }));
    const failed = await invoke(); assert.equal((await failed.json() as { code: string }).code, "CHATGPT_OCR_INVALID"); unchanged();
    const cancellation = new AbortController();
    transport.setResponse(() => { cancellation.abort(); return new Response(completedOcrStream("synthetic"), { headers: { "content-type": "text/event-stream" } }); });
    const cancelled = await invoke("{}", cancellation.signal); assert.equal((await cancelled.json() as { code: string }).code, "CHATGPT_OCR_CANCELLED"); unchanged();
    assert.equal(context.database.getMeta().authorityGeneration, generation);
    assert.equal(factory.mock.calls[0]?.[0].admission, context.admission);
    assert.equal(factory.mock.calls[0]?.[0].stateRoot, profile.stateRoot);
  } finally { if (dashboard !== undefined) await dashboard.stop(); else await runtime.close(); factory.mockRestore(); await transport.cleanup(); profile.close(); }
});
