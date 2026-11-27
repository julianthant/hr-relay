import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import { PROTECTED_SETTINGS_SCHEMA_HASH, ProtectedSettingsReadbackSchema, ProtectedStoreEntriesSchema } from "../../../../models/config/protected-settings.js";
import { workerBootstrapEnvironment } from "../../../../models/config/secrets.js";
import type { ProtectedSettingsEditorFacts } from "../../../runs/queries/settings-editor.js";
import { createProtectedSettingsRuntimeReader } from "../../../runtime/settings/settings-runtime.js";
import { RuntimeAdmission } from "../../../storage/admission/admission.js";
import { receiveRuntimeLifetimeLock, type RuntimeLifetimeLock } from "../../../storage/admission/lifetime-lock.js";
import { createCredentialStore } from "../../../storage/configuration/credential-store.js";
import { hasUnprovedSourceClosure } from "../../../storage/source-closure.js";
import { workerExecArgv } from "../../../storage/sqlite/backup-inspection-worker.js";
import { copySigninFixtureWorkspace, useCopySigninFixtureWorkspace } from "../../config/runtime-isolation.js";

const LaunchSchema = z.tuple([z.coerce.number().int().positive().max(65535), z.uuid(), z.literal("fixture").optional()]);
const RequestSchema = z.strictObject({ id: z.uuid() });
const FactsSchema = z.strictObject({ protectedSchemaHash: z.literal(PROTECTED_SETTINGS_SCHEMA_HASH), readback: ProtectedSettingsReadbackSchema,
  record: z.strictObject({ entries: ProtectedStoreEntriesSchema }) });
const ReplySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("ready") }),
  z.strictObject({ kind: z.literal("read"), id: z.uuid(), facts: FactsSchema }),
  z.strictObject({ kind: z.literal("unavailable"), id: z.uuid() }),
]);
const READ_TIMEOUT_MS = 10_000;
const unavailable = () => new Error("protected-settings-reader-unavailable");

/** A profile-bound child reads through the normal credential owner. Its replies carry only fields the editor uses. */
export function createProtectedSettingsEditorReader(admission: RuntimeAdmission, lifetime: RuntimeLifetimeLock) {
  const profileId = admission.profileBinding.profileId;
  const fixture = copySigninFixtureWorkspace() !== undefined;
  let worker: ReturnType<typeof spawn> | undefined;
  let closed = false;

  function spawn() {
    const child = fork(fileURLToPath(import.meta.url), [String(lifetime.port), profileId, ...(fixture ? ["fixture"] : [])], {
      execArgv: workerExecArgv(), env: workerBootstrapEnvironment(), stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    const ready = Promise.withResolvers<void>();
    // A failure can arrive even when no read is currently waiting for the child.
    void ready.promise.catch(() => {});
    const pending = new Map<string, ReturnType<typeof Promise.withResolvers<ProtectedSettingsEditorFacts>>>();
    const failed = () => {
      ready.reject(unavailable());
      for (const reply of pending.values()) reply.reject(unavailable());
      pending.clear();
    };
    child.on("error", failed);
    child.once("disconnect", failed);
    const exited = new Promise<void>(resolve => child.once("close", () => { failed(); worker = undefined; resolve(); }));
    child.on("message", (input: unknown) => {
      const result = ReplySchema.safeParse(input);
      if (!result.success) { failed(); child.kill("SIGKILL"); return; }
      const reply = result.data;
      if (reply.kind === "ready") ready.resolve();
      else if (reply.kind === "read") pending.get(reply.id)?.resolve(reply.facts);
      else pending.get(reply.id)?.reject(unavailable());
    });
    let owned = false;
    try {
      const shared = lifetime.share(child);
      lifetime.observeOwnedChildClosure(child);
      owned = true;
      void shared.catch(() => { failed(); child.kill("SIGKILL"); });
    } catch {
      failed();
      child.kill("SIGKILL");
    }
    return {
      async read() {
        const id = randomUUID(), reply = Promise.withResolvers<ProtectedSettingsEditorFacts>();
        const timer = setTimeout(() => { failed(); child.kill("SIGKILL"); }, READ_TIMEOUT_MS);
        try {
          await ready.promise;
          if (!child.connected) throw unavailable();
          pending.set(id, reply);
          child.send({ id }, error => { if (error !== null) reply.reject(unavailable()); });
          return await reply.promise;
        } finally {
          clearTimeout(timer);
          pending.delete(id);
        }
      },
      async close() {
        if (child.connected) child.disconnect();
        const timeout = setTimeout(() => child.kill("SIGKILL"), READ_TIMEOUT_MS);
        try {
          await exited;
          if (owned) lifetime.assertOwnedChildClosed(child);
        } finally { clearTimeout(timeout); }
      },
    };
  }

  return {
    read: () => {
      if (closed) throw unavailable();
      return (worker ??= spawn()).read();
    },
    async close() {
      closed = true;
      await worker?.close();
    },
  };
}

async function serve() {
  const [port, profileId, fixture] = LaunchSchema.parse(process.argv.slice(2));
  let release = () => {};
  const lifetime = await receiveRuntimeLifetimeLock(port, () => {
    try { release(); process.exit(0); }
    catch { process.exit(1); }
  });
  if (fixture) useCopySigninFixtureWorkspace(lifetime.workspace);
  const machine = RuntimeAdmission.acquireWorker(lifetime.workspace, lifetime);
  if (machine.readProfileRegistry().activeProfileId !== profileId) throw unavailable();
  const admitted = machine.admitProfile(profileId);
  release = () => { admitted.release(); machine.release(); };
  const protectedSettings = createProtectedSettingsRuntimeReader(createCredentialStore({ admission: admitted, stateRoot: admitted.stateRoot }));
  process.on("message", (input: unknown) => {
    const { id } = RequestSchema.parse(input);
    try {
      const { protectedSchemaHash, readback, record } = protectedSettings.read();
      const facts = FactsSchema.parse({ protectedSchemaHash, readback, record: { entries: record.entries } });
      process.send?.({ kind: "read", id, facts });
    } catch (error) {
      if (hasUnprovedSourceClosure(error)) process.exit(1);
      process.send?.({ kind: "unavailable", id });
    }
  });
  process.send?.({ kind: "ready" });
}

if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await serve().catch(() => process.exit(1));
}
