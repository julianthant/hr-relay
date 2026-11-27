import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import { HostConfigFactsSchema, type HostConfigFacts } from "../../../../models/config/host-display.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH, ProtectedSettingsReadbackSchema, ProtectedStoreEntriesSchema } from "../../../../models/config/protected-settings.js";
import { workerBootstrapEnvironment } from "../../../../models/config/secrets.js";
import { CommandResultSchema, SettingsCommandRequestSchema } from "../../../../rules/commands/commands.js";
import { systemIdFactory } from "../../../../rules/identity/identifiers.js";
import { systemClock } from "../../../../rules/time/clock.js";
import { createSettingsApplicationExecutor } from "../../../runs/commands/settings-service.js";
import { executeSettingsCommand } from "../../../runs/commands/settings-command.js";
import type { ProtectedSettingsEditorFacts } from "../../../runs/queries/settings-editor.js";
import { createProtectedSettingsRuntimeReader } from "../../../runtime/settings/settings-runtime.js";
import { RuntimeAdmission } from "../../../storage/admission/admission.js";
import { receiveRuntimeLifetimeLock, type RuntimeLifetimeLock } from "../../../storage/admission/lifetime-lock.js";
import { createCredentialStore } from "../../../storage/configuration/credential-store.js";
import { hasUnprovedSourceClosure } from "../../../storage/source-closure.js";
import { AuthorityDatabase } from "../../../storage/sqlite/authority-database.js";
import { workerExecArgv } from "../../../storage/sqlite/backup-inspection-worker.js";
import { resolveConfigWithProvenance } from "../../config/resolve.js";
import { copySigninFixtureWorkspace, useCopySigninFixtureWorkspace } from "../../config/runtime-isolation.js";
import { assertProfileBrowserRoot } from "../profile-credential-inventory.js";

const RoleSchema = z.enum(["editor", "ordinary-command"]);
const LaunchSchema = z.tuple([z.coerce.number().int().positive().max(65535), z.uuid(),
  z.coerce.number().int().nonnegative(), RoleSchema, z.literal("fixture").optional()]);
const RequestSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("read"), id: z.uuid() }),
  z.strictObject({ kind: z.literal("apply"), id: z.uuid(), command: SettingsCommandRequestSchema, hostFacts: HostConfigFactsSchema }),
  z.strictObject({ kind: z.literal("stop") }),
]);
type Request = Exclude<z.infer<typeof RequestSchema>, { kind: "stop" }>;
type WorkerRequest = Omit<Extract<Request, { kind: "read" }>, "id"> | Omit<Extract<Request, { kind: "apply" }>, "id">;
const FactsSchema = z.strictObject({ protectedSchemaHash: z.literal(PROTECTED_SETTINGS_SCHEMA_HASH), readback: ProtectedSettingsReadbackSchema,
  record: z.strictObject({ entries: ProtectedStoreEntriesSchema }) });
const ReplySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("ready") }),
  z.strictObject({ kind: z.literal("read"), id: z.uuid(), facts: FactsSchema }),
  z.strictObject({ kind: z.literal("command"), id: z.uuid(), result: CommandResultSchema, committed: z.boolean() }),
  z.strictObject({ kind: z.literal("unavailable"), id: z.uuid() }),
]);
type WorkerReply = Extract<z.infer<typeof ReplySchema>, { kind: "read" | "command" }>;
const STOP_TIMEOUT_MS = 10_000;
const unavailable = () => new Error("profile-settings-worker-unavailable");

/** Separate profile-bound processes read editor facts and apply ordinary commands. */
export function createProfileSettingsProcesses(admission: RuntimeAdmission, lifetime: RuntimeLifetimeLock, profileEpoch: number, hostFacts: HostConfigFacts) {
  const editor = profileSettingsProcess(admission, lifetime, profileEpoch, "editor");
  const commands = profileSettingsProcess(admission, lifetime, profileEpoch, "ordinary-command");
  return {
    async read(): Promise<ProtectedSettingsEditorFacts> {
      const reply = await editor.request({ kind: "read" });
      if (reply.kind !== "read") throw unavailable();
      return reply.facts;
    },
    async execute(command: z.infer<typeof SettingsCommandRequestSchema>) {
      const reply = await commands.request({ kind: "apply", command, hostFacts });
      if (reply.kind !== "command" || reply.result.commandId !== command.commandId
        || reply.committed !== (reply.result.state === "applied")) throw unavailable();
      return reply.result;
    },
    close: editor.close,
    closeCommands: commands.close,
  };
}

function profileSettingsProcess(admission: RuntimeAdmission, lifetime: RuntimeLifetimeLock, profileEpoch: number, role: z.infer<typeof RoleSchema>) {
  const profileId = admission.profileBinding.profileId;
  const fixture = copySigninFixtureWorkspace() !== undefined;
  let worker: ReturnType<typeof spawn> | undefined;
  let closed = false;

  function spawn() {
    const child = fork(fileURLToPath(import.meta.url), [String(lifetime.port), profileId, String(profileEpoch), role, ...(fixture ? ["fixture"] : [])], {
      execArgv: workerExecArgv(), env: workerBootstrapEnvironment(), stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    const ready = Promise.withResolvers<void>();
    // A failure can arrive even when no read is currently waiting for the child.
    void ready.promise.catch(() => {});
    const startup = setTimeout(() => { failed(); child.kill("SIGKILL"); }, STOP_TIMEOUT_MS);
    const pending = new Map<string, ReturnType<typeof Promise.withResolvers<WorkerReply>>>();
    const failed = () => {
      clearTimeout(startup);
      ready.reject(unavailable());
      for (const reply of pending.values()) reply.reject(unavailable());
      pending.clear();
    };
    child.on("error", failed);
    child.once("disconnect", failed);
    const exited = new Promise<number | null>(resolve => child.once("close", code => { failed(); worker = undefined; resolve(code); }));
    child.on("message", (input: unknown) => {
      const result = ReplySchema.safeParse(input);
      if (!result.success) { failed(); child.kill("SIGKILL"); return; }
      const reply = result.data;
      if (reply.kind === "ready") { clearTimeout(startup); ready.resolve(); }
      else if (reply.kind === "read" || reply.kind === "command") pending.get(reply.id)?.resolve(reply);
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
      async request(request: WorkerRequest) {
        const id = randomUUID(), reply = Promise.withResolvers<WorkerReply>();
        const timer = role === "editor" ? setTimeout(() => { failed(); child.kill("SIGKILL"); }, STOP_TIMEOUT_MS) : undefined;
        try {
          await ready.promise;
          if (!child.connected) throw unavailable();
          pending.set(id, reply);
          child.send({ ...request, id }, error => { if (error !== null) reply.reject(unavailable()); });
          return await reply.promise;
        } finally {
          clearTimeout(timer);
          pending.delete(id);
        }
      },
      async close() {
        if (child.connected) child.send({ kind: "stop" }, error => { if (error !== null && child.connected) child.disconnect(); });
        const deadline = Promise.withResolvers<never>();
        const timeout = setTimeout(() => {
          if (role === "editor") child.kill("SIGKILL");
          else deadline.reject(new Error("settings-command-worker-close-unproved"));
        }, STOP_TIMEOUT_MS);
        try {
          const code = await Promise.race([exited, deadline.promise]);
          if (owned) lifetime.assertOwnedChildClosed(child);
          if (role === "ordinary-command" && code !== 0) throw new Error("settings-command-worker-close-unproved");
        } finally { clearTimeout(timeout); }
      },
    };
  }

  return {
    request: (request: WorkerRequest) => {
      if (closed) throw unavailable();
      return (worker ??= spawn()).request(request);
    },
    async close() {
      closed = true;
      await worker?.close();
    },
  };
}

async function serve() {
  const [port, profileId, epoch, role, fixture] = LaunchSchema.parse(process.argv.slice(2));
  const release: (() => void)[] = [];
  const close = () => {
    try { for (const end of release) end(); process.exit(0); }
    catch { process.exit(1); }
  };
  const lifetime = await receiveRuntimeLifetimeLock(port, close);
  if (fixture) useCopySigninFixtureWorkspace(lifetime.workspace);
  const machine = RuntimeAdmission.acquireWorker(lifetime.workspace, lifetime);
  const { captureSelectedProfileStorage } = await import("../storage-compose.js");
  const selected = captureSelectedProfileStorage(machine);
  if (selected.profileId !== profileId || selected.epoch !== epoch) throw unavailable();
  const admitted = machine.admitProfile(profileId);
  release.push(() => admitted.release(), () => machine.release());
  const credentials = createCredentialStore({ admission: admitted, stateRoot: admitted.stateRoot });
  const protectedSettings = role === "editor" ? createProtectedSettingsRuntimeReader(credentials) : undefined;
  const database = role === "ordinary-command" ? AuthorityDatabase.open(admitted, {
    path: selected.authorityPath, busyTimeoutMs: 5000, migrationOwner: "settings-command-worker",
  }, systemClock, undefined, undefined, undefined, credentials) : undefined;
  if (database !== undefined) release.unshift(() => database.close());
  process.on("message", (input: unknown) => {
    const request = RequestSchema.parse(input);
    if (request.kind === "stop") { close(); return; }
    const { id } = request;
    try {
      selected.assertCurrent();
      if (request.kind === "read" && protectedSettings !== undefined) {
        const { protectedSchemaHash, readback, record } = protectedSettings.read();
        const facts = FactsSchema.parse({ protectedSchemaHash, readback, record: { entries: record.entries } });
        selected.assertCurrent();
        process.send?.({ kind: "read", id, facts });
      } else if (request.kind === "apply" && database !== undefined) {
        const settings = createSettingsApplicationExecutor(value => {
          admitted.assertProfileRuntime();
          selected.assertCurrent();
          const resolved = resolveConfigWithProvenance(value, request.hostFacts, systemClock, {
            stateRoot: admitted.stateRoot, artifactRoot: admitted.artifactRoot,
          });
          assertProfileBrowserRoot(admitted, resolved.config.paths.browserProfileRoot);
          return resolved;
        }, credentials);
        let committed = false;
        const result = executeSettingsCommand({ authority: {
          withAuthorityTransaction: work => database.withAuthorityTransaction(repositories => {
            selected.assertCurrent();
            const applied = work(repositories);
            selected.assertCurrent();
            return applied;
          }),
          afterAuthorityCommit: publish => database.afterAuthorityCommit(publish),
        }, settings, clock: systemClock, ids: systemIdFactory, settingsCommitted: () => { committed = true; } }, request.command);
        process.send?.({ kind: "command", id, result, committed });
      } else throw unavailable();
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
