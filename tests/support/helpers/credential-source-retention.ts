import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once, on } from "node:events";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { testProcessImport } from "../compiled-process.js";
import { createCredentialStore } from "../../../src/backend/storage/configuration/credential-store.js";
import { LogoutSettlementSchema } from "../../../src/models/profiles/profile.js";
import { ProtectedSettingsApplyInputSchema, PROTECTED_SETTINGS_SCHEMA_HASH } from "../../../src/models/config/protected-settings.js";
import { createBoundProfileFixture } from "./admission-fixture.js";
import { credentialKeychainTestEnvironment } from "./credential-keychain-fake.js";
import { scaledMs } from "../time-scale.js";

export type CredentialSourceRetentionCase = "writer-close" | "duo-read-first" | "duo-read-second" | "stopped-head-close"
  | "protected-source" | "chatgpt-source" | "account-projection" | "stopped-control-snapshot-disposal" | "setup-protected-close" | "authenticated-upgrade-key-close" | "authenticated-upgrade-service-inspection"
  | "authenticated-upgrade-binding-consume" | "authenticated-upgrade-unproved-close" | "authenticated-upgrade-closed-publication-refusal";
const retainedChildren = new Set<object>();

export async function runCredentialSourceRetentionCase(scenario: CredentialSourceRetentionCase): Promise<void> {
  const profile = await createBoundProfileFixture({ sharedMachine: true });
  const setupNonce = scenario === "setup-protected-close" || scenario.startsWith("authenticated-upgrade-") ? randomUUID() : undefined;
  const setupWorkspace = setupNonce === undefined ? undefined : join(profile.workspace, `.${scenario}-${setupNonce}`);
  if (setupWorkspace !== undefined) mkdirSync(setupWorkspace, { mode: 0o700 });
  const child = fork(fileURLToPath(new URL("../../support/processes/credential-source-retention-worker.ts", import.meta.url)),
    [String(profile.lifetime.port), profile.workspace, profile.admission.profileBinding.profileId, scenario, ...(setupNonce === undefined ? [] : [setupNonce])],
    { execArgv: ["--import", testProcessImport()], env: credentialKeychainTestEnvironment(process.env), stdio: ["ignore", "ignore", "pipe", "ipc"] });
  const held = { profile, child, setupWorkspace }; retainedChildren.add(held);
  let stderrBytes = 0;
  child.stderr?.on("data", (bytes: Buffer) => { stderrBytes += bytes.length; if (stderrBytes > 65_536) child.kill("SIGKILL"); });
  const closed = once(child, "close").then(() => undefined);
  const events = on(child, "message", { signal: AbortSignal.timeout(scaledMs(20_000)) });
  const ownedWorkspaces = new Set<string>(setupWorkspace === undefined ? [] : [setupWorkspace]);
  const ownedSnapshots = new Set<string>();
  let messages = 0;
  let primary: unknown;
  try {
    await profile.lifetime.share(child);
    for (;;) {
      const next = await Promise.race([events.next(), closed.then(() => { throw new Error("retention-child-closed-before-proof"); })]);
      assert.equal(next.done, false); assert.ok(++messages <= 3);
      const message = z.union([z.strictObject({ ownedWorkspace: z.string().min(1).max(4096) }), z.strictObject({ ownedSnapshot: z.string().min(1).max(4096) }),
        z.strictObject({ scenario: z.literal(scenario), assertionsComplete: z.literal(true), ...(setupNonce === undefined ? {} : { nonce: z.literal(setupNonce) }) }),
        z.strictObject({ scenario: z.literal(scenario), assertionsComplete: z.literal(false), failure: z.strictObject({
          name: z.enum(["Error", "AssertionError", "TypeError", "RangeError", "SyntaxError"]),
          locations: z.array(z.string().max(240).regex(/^(?:tests|src)\/[A-Za-z0-9_./-]+\.(?:[cm]?js|tsx?):[1-9]\d*:[1-9]\d*$/u)).max(8),
        }) })]).parse(next.value?.[0]);
      if ("ownedWorkspace" in message) {
        assert.equal(setupWorkspace, undefined);
        assert.equal(realpathSync(message.ownedWorkspace), message.ownedWorkspace);
        assert.equal(message.ownedWorkspace.startsWith(`${realpathSync(tmpdir())}${sep}incomplete-publication-`), true);
        ownedWorkspaces.add(message.ownedWorkspace);
      } else if ("ownedSnapshot" in message) {
        assert.equal(scenario.startsWith("authenticated-upgrade-") || setupWorkspace === undefined, true);
        assert.equal(realpathSync(message.ownedSnapshot), message.ownedSnapshot);
        assert.equal(message.ownedSnapshot.startsWith(`${realpathSync(tmpdir())}${sep}relay-readonly-authority-`), true);
        ownedSnapshots.add(message.ownedSnapshot);
      } else {
        if (!message.assertionsComplete) {
          const error = new Error(`credential-source-retention-failed: ${scenario}; ${message.failure.name}; ${message.failure.locations.join(", ")}`);
          error.name = "CredentialSourceRetentionAssertionError";
          throw error;
        }
        break;
      }
    }
    assert.equal(child.exitCode, null); assert.equal(child.signalCode, null);
  } catch (error) { primary = error; }
  try {
    if (child.exitCode === null && child.signalCode === null) assert.equal(child.kill("SIGKILL"), true);
    await closed;
    assert.equal(child.connected, false); assert.equal(stderrBytes, 0);
    await events.return?.();
    for (const path of ownedSnapshots) rmSync(path, { recursive: true });
    for (const path of ownedWorkspaces) rmSync(path, { recursive: true });
    await profile.close(); retainedChildren.delete(held);
  } catch (error) {
    throw new AggregateError(primary === undefined ? [error] : [primary, error], "retention-child-kernel-closure-unproved", { cause: error });
  }
  if (primary !== undefined) throw primary instanceof Error ? primary : new Error("credential source child failed", { cause: primary });
}

export async function runCredentialPublicationCrashCase(boundary: "before" | "after"): Promise<void> {
  const profile = await createBoundProfileFixture({ sharedMachine: true });
  const store = createCredentialStore({ admission: profile.admission, stateRoot: profile.stateRoot });
  const path = join(profile.stateRoot, "credentials", "protected.json"), before = readFileSync(path), revision = store.read().revision;
  const input = ProtectedSettingsApplyInputSchema.parse({ commandId: "11111111-1111-4111-8111-111111111111", writeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    commandFingerprint: "1".repeat(64), expectedRevision: revision, protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
    updatedAt: "2026-09-06T12:00:00.000Z", entries: { ucpathPassword: { set: "credential-store-private-one" } } });
  const scenario = `protected-crash-${boundary}`, nonce = randomUUID();
  const marker = join(profile.workspace, `.credential-publication-${nonce}.json`);
  const child = fork(fileURLToPath(new URL("../../support/processes/credential-source-retention-worker.ts", import.meta.url)),
    [String(profile.lifetime.port), profile.workspace, profile.admission.profileBinding.profileId, scenario, nonce],
    { execArgv: ["--import", testProcessImport()], env: credentialKeychainTestEnvironment(process.env), stdio: ["ignore", "ignore", "pipe", "ipc"] });
  const held = { profile, child }; retainedChildren.add(held);
  let stderrBytes = 0;
  child.stderr?.on("data", (bytes: Buffer) => { stderrBytes += bytes.length; if (stderrBytes > 65_536) child.kill("SIGKILL"); });
  const closed = once(child, "close");
  const events = on(child, "message", { signal: AbortSignal.timeout(scaledMs(20_000)) });
  let primary: unknown;
  try {
    await profile.lifetime.share(child);
    const result = await Promise.race([closed.then(value => ({ closed: value })), events.next().then(value => ({ message: value }))]);
    if ("message" in result) {
      const message = z.strictObject({ scenario: z.literal(scenario), assertionsComplete: z.literal(false), failure: z.strictObject({
        name: z.enum(["Error", "AssertionError", "TypeError", "RangeError", "SyntaxError"]),
        locations: z.array(z.string().max(240).regex(/^(?:tests|src)\/[A-Za-z0-9_./-]+\.(?:[cm]?js|tsx?):[1-9]\d*:[1-9]\d*$/u)).max(8),
      }) }).parse(result.message.value?.[0]);
      throw new Error(`credential-publication-crash-failed: ${scenario}; ${message.failure.name}; ${message.failure.locations.join(", ")}`);
    }
    assert.deepEqual(z.tuple([z.number().int().nullable(), z.string().nullable()]).parse(result.closed), [null, "SIGKILL"]);
    assert.equal(stderrBytes, 0); assert.equal(child.connected, false);
    const receipt: unknown = JSON.parse(readFileSync(marker, "utf8"));
    assert.deepEqual(z.strictObject({ nonce: z.uuid(), scenario: z.string(), commandId: z.uuid(), expectedRevision: z.number().int().positive() }).parse(receipt),
      { nonce, scenario, commandId: input.commandId, expectedRevision: input.expectedRevision });
    const after = readFileSync(path);
    assert.equal(store.acceptedAt(input.commandId), boundary === "before" ? undefined : input.updatedAt);
    assert.equal(store.ownsCommandId(input.commandId), boundary === "after");
    if (boundary === "before") {
      assert.deepEqual(after, before);
      const retry = ProtectedSettingsApplyInputSchema.parse({ ...input, updatedAt: "2026-09-06T12:01:00.000Z" });
      assert.equal(store.apply(retry).state, "applied"); assert.equal(store.acceptedAt(input.commandId), retry.updatedAt);
      const bytes = readFileSync(path);
      assert.equal(store.apply({ ...retry, entries: { ucpathPassword: { set: "credential-store-private-two" } } }).state, "rejected");
      assert.deepEqual(readFileSync(path), bytes);
    } else {
      assert.notDeepEqual(after, before);
      assert.equal(store.read().entries.ucpathPassword?.value, "credential-store-private-one");
      assert.equal(store.verifyReplay(input).state, "applied");
      assert.equal(store.apply(input).state, "applied"); assert.deepEqual(readFileSync(path), after);
      const lock = join(profile.machine.stateRoot, "machine", "credential-keys", `.${profile.admission.profileBinding.profileId}.writer.lock`), lockBytes = readFileSync(lock);
      const blocked = store.apply(ProtectedSettingsApplyInputSchema.parse({ ...input, commandId: "22222222-2222-4222-8222-222222222222", writeId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", expectedRevision: revision + 1 }));
      assert.deepEqual(blocked, { state: "rejected", code: "lock-unavailable", message: "credential store lock is unavailable" });
      assert.deepEqual(readFileSync(lock), lockBytes); assert.deepEqual(readFileSync(path), after);
    }
  } catch (error) { primary = error; }
  try {
    if (child.exitCode === null && child.signalCode === null) assert.equal(child.kill("SIGKILL"), true);
    await closed; await events.return?.();
    await profile.close(); retainedChildren.delete(held);
  } catch (error) { throw new AggregateError(primary === undefined ? [error] : [primary, error], "credential-crash-child-kernel-closure-unproved", { cause: error }); }
  if (primary !== undefined) throw primary instanceof Error ? primary : new Error("credential source child failed", { cause: primary });
}

export type LogoutSettlementCase = "prepared" | "commit-intent" | "after-commit" | "done" | "ready" | "unlink" | "writer-close" | "third-image" | "unknown-copy" | "live-process" | "browser-root" | "key-replacement" | "snapshot-disposal" | "process-observation" | "unknown" | "browser-busy" | "browser-unproved" | "process-root-copy" | "exited-process";

export async function runLogoutSettlementCase(boundary: LogoutSettlementCase): Promise<void> {
  const profile = await createBoundProfileFixture({ sharedMachine: true });
  const profileId = profile.admission.profileBinding.profileId, port = profile.lifetime.port;
  const retained = [join(profile.stateRoot, "credentials", "protected.json"), join(profile.stateRoot, "credentials", "chatgpt-account.json"),
    join(profile.machine.stateRoot, "machine", "duo-credentials", `${profileId}.json`),
    join(profile.machine.stateRoot, "machine", "credential-keys", `${profileId}.json`)].map(path => ({ path, bytes: readFileSync(path) }));
  await profile.closeController();
  const nonce = randomUUID(), marker = join(profile.workspace, `.logout-publication-${nonce}.json`);
  const owned = { profile, boundary }; retainedChildren.add(owned);
  let childClosureProved = true;
  const ownedSnapshots = new Set<string>();
  async function stage(scenario: string, crash: boolean): Promise<number> {
    childClosureProved = false;
    const child = fork(fileURLToPath(new URL("../../support/processes/credential-source-retention-worker.ts", import.meta.url)),
      [String(port), profile.workspace, profileId, scenario, nonce], { execArgv: ["--import", testProcessImport()],
        env: credentialKeychainTestEnvironment(process.env), stdio: ["ignore", "ignore", "pipe", "ipc"] });
    const closed = once(child, "close");
    const events = on(child, "message", { signal: AbortSignal.timeout(scaledMs(20_000)) });
    let stderrBytes = 0, primary: unknown;
    child.stderr?.on("data", (bytes: Buffer) => { stderrBytes += bytes.length; if (stderrBytes > 65_536) child.kill("SIGKILL"); });
    try {
      let result = await Promise.race([closed.then(value => ({ closed: value })), events.next().then(value => ({ message: value }))]);
      if ("message" in result && result.message.value?.[0] !== undefined && typeof result.message.value[0] === "object" && result.message.value[0] !== null
        && "ownedSnapshot" in result.message.value[0]) {
        const message = z.strictObject({ ownedSnapshot: z.string().min(1).max(4096) }).parse(result.message.value[0]);
        assert.equal(realpathSync(message.ownedSnapshot), message.ownedSnapshot);
        assert.equal(message.ownedSnapshot.startsWith(`${realpathSync(tmpdir())}${sep}relay-readonly-authority-`), true);
        ownedSnapshots.add(message.ownedSnapshot);
        result = await Promise.race([closed.then(value => ({ closed: value })), events.next().then(value => ({ message: value }))]);
      }
      if ("message" in result) {
        const message = z.union([z.strictObject({ scenario: z.literal(scenario), assertionsComplete: z.literal(true) }),
          z.strictObject({ scenario: z.literal(scenario), assertionsComplete: z.literal(false), failure: z.strictObject({
            name: z.enum(["Error", "AssertionError", "TypeError", "RangeError", "SyntaxError"]),
            locations: z.array(z.string().max(240).regex(/^(?:tests|src)\/[A-Za-z0-9_./-]+\.(?:[cm]?js|tsx?):[1-9]\d*:[1-9]\d*$/u)).max(8),
          }) })]).parse(result.message.value?.[0]);
        if (!message.assertionsComplete) throw new Error(`logout-child-failed: ${scenario}; ${message.failure.name}; ${message.failure.locations.join(", ")}`);
        assert.equal(crash, false, "crash scenario must reach its durable parent-nonce marker");
        assert.equal(child.exitCode, null); assert.equal(child.signalCode, null);
      } else {
        assert.equal(crash, true, "assertion scenario closed before its proof");
        assert.deepEqual(result.closed, [null, "SIGKILL"]);
      }
    } catch (error) { primary = error; }
    try {
      if (child.exitCode === null && child.signalCode === null) assert.equal(child.kill("SIGKILL"), true);
      await closed; childClosureProved = true; await events.return?.(); assert.equal(child.connected, false); assert.equal(stderrBytes, 0);
    } catch (error) { throw new AggregateError(primary === undefined ? [error] : [primary, error], "logout-child-kernel-closure-unproved", { cause: error }); }
    if (primary !== undefined) {
      if (boundary === "exited-process") childClosureProved = false;
      throw primary instanceof Error ? primary : new Error("logout child failed", { cause: primary });
    }
    assert.ok(child.pid); return child.pid;
  }
  try {
    const poison = ["writer-close", "unknown-copy", "live-process", "browser-root", "key-replacement", "snapshot-disposal", "process-observation", "browser-busy", "browser-unproved", "process-root-copy", "exited-process"].includes(boundary);
    const prefix = !poison;
    let sourceOperationId: string | undefined;
    if (prefix) {
      const sourcePid = await stage(boundary === "unknown" ? "logout-seed-unknown" : "logout-seed", true);
      const source = z.object({ nonce: z.uuid(), operationId: z.uuid(), runId: z.uuid(), workerId: z.string(), processId: z.number().int().positive() })
        .parse(JSON.parse(readFileSync(join(profile.workspace, `.logout-source-${nonce}.json`), "utf8")));
      assert.equal(source.nonce, nonce); assert.equal(source.processId, sourcePid); sourceOperationId = source.operationId;
    }
    const faultPid = await stage(`logout-${boundary}`, !poison && boundary !== "unknown");
    assert.equal(existsSync(join(profile.machine.stateRoot, "machine", "erasures", `${profileId}.json`)), false);
    for (const item of retained) assert.deepEqual(readFileSync(item.path), item.bytes);
    if (!poison && boundary !== "unknown") {
      const receipt = z.strictObject({ nonce: z.uuid(), scenario: z.literal(`logout-${boundary}`), operationId: z.uuid(), profileId: z.uuid(), phase: z.literal(boundary === "third-image" ? "commit-intent" : boundary), settlement: LogoutSettlementSchema })
        .parse(JSON.parse(readFileSync(marker, "utf8")));
      assert.equal(receipt.nonce, nonce); assert.equal(receipt.profileId, profileId); assert.equal(receipt.operationId, sourceOperationId); assert.equal(receipt.settlement.processId, faultPid);
      if (boundary === "third-image") {
        const { DatabaseSync } = await import("node:sqlite");
        const database = new DatabaseSync(profile.path);
        try { assert.equal(database.prepare("UPDATE database_states SET updated_at=? WHERE id=1").run("2026-10-21T12:02:00.000Z").changes, 1); }
        finally { database.close(); }
      }
      await stage("logout-resume", false);
      for (const item of retained) assert.deepEqual(readFileSync(item.path), item.bytes);
    }
  } catch (error) {
    if (childClosureProved) { for (const path of ownedSnapshots) rmSync(path, { recursive: true }); await profile.close(); retainedChildren.delete(owned); }
    throw error;
  }
  for (const path of ownedSnapshots) rmSync(path, { recursive: true });
  await profile.close(); retainedChildren.delete(owned);
}
