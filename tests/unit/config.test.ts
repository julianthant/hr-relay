import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs, {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, it, vi } from "vitest";
import { deriveSchemaHash } from "../../src/domain/schema-bound-value.js";
import { manualClock } from "../../src/domain/clock.js";
import { assertNotPast, requireAnnualDates } from "../../src/domain/config/fiscal-year.js";
import { resolveInstances, resolveSystemEntryUrl } from "../../src/domain/config/instance.js";
import { CONFIG_ENV_BINDINGS, resolveConfig, resolveConfigWithProvenance } from "../../src/domain/config/resolve.js";
import { defaultRuntimePaths } from "../../src/domain/config/runtime-paths.js";
import { ConfigSchema, SettingsOverrideSchema } from "../../src/domain/config/schema.js";
import {
  SETTINGS_SCHEMA_HASH,
  SettingsApplyInputSchema,
  SettingsFileRecordSchema,
  derivePersistedSettingsFingerprint,
  deriveSettingsPatchFingerprint,
} from "../../src/domain/config/settings.js";
import {
  SettingsCommandRequestSchema,
  deriveSettingsCommandFingerprint,
} from "../../src/domain/commands.js";
import {
  MAX_SETTINGS_FILE_BYTES,
  createSettingsFileAuthority as createRawSettingsFileAuthority,
  type SettingsFileAuthorityOptions,
} from "../../src/infra/config/settings-file.js";

const CLOCK = manualClock(new Date("2026-08-10T12:00:00-07:00"));
const SETTINGS_COMMAND_1 = "11111111-1111-4111-8111-111111111111";
const SETTINGS_COMMAND_2 = "22222222-2222-4222-8222-222222222222";

type TestSettingsFileAuthorityOptions = Omit<SettingsFileAuthorityOptions, "validateCandidate"> & {
  readonly validateCandidate?: SettingsFileAuthorityOptions["validateCandidate"];
};

function createSettingsFileAuthority(options: TestSettingsFileAuthorityOptions) {
  return createRawSettingsFileAuthority({
    ...options,
    validateCandidate: options.validateCandidate ?? ((settings) => {
      resolveConfigWithProvenance({}, settings, CLOCK);
    }),
  });
}

function settingsApplyRequest(commandId: string, expectedRevision: number, patch: unknown): unknown {
  const patchFingerprint = deriveSettingsPatchFingerprint(patch);
  const command = {
    commandId,
    requestedAt: "2026-08-28T12:00:00.000Z",
    requestedBy: "local-operator",
    source: "dashboard",
    family: "settings",
    type: "apply-settings",
    target: { expectedRevision },
    payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint, patch },
  };
  return {
    commandId,
    commandFingerprint: deriveSettingsCommandFingerprint(command),
    expectedRevision,
    settingsSchemaHash: SETTINGS_SCHEMA_HASH,
    patchFingerprint,
    patch,
  };
}

function crashSettingsAuthorityAtHook(path: string, hook: string) {
  const moduleUrl = pathToFileURL(join(
    process.cwd(),
    "src",
    "infra",
    "config",
    "settings-file.ts",
  )).href;
  return spawnSync(process.execPath, [
    "--import",
    "tsx",
    "--input-type=module",
    "--eval",
    `import { createSettingsFileAuthority } from ${JSON.stringify(moduleUrl)};
     createSettingsFileAuthority({
       path: ${JSON.stringify(path)},
       validateCandidate: () => undefined,
       hooks: { [${JSON.stringify(hook)}]: () => process.kill(process.pid, "SIGKILL") },
     }).read();`,
  ], { encoding: "utf8" });
}

function crashFirstUpdateRollbackAtHook(path: string, hook: string) {
  const moduleUrl = pathToFileURL(join(
    process.cwd(),
    "src",
    "infra",
    "config",
    "settings-file.ts",
  )).href;
  const request = settingsApplyRequest(
    SETTINGS_COMMAND_1,
    1,
    { browser: { headless: false } },
  );
  return spawnSync(process.execPath, [
    "--import",
    "tsx",
    "--input-type=module",
    "--eval",
    `import { createSettingsFileAuthority } from ${JSON.stringify(moduleUrl)};
     const authority = createSettingsFileAuthority({
       path: ${JSON.stringify(path)},
       validateCandidate: () => undefined,
       hooks: { [${JSON.stringify(hook)}]: () => process.kill(process.pid, "SIGKILL") },
     });
     const outcome = authority.apply(${JSON.stringify(request)});
     if (outcome.state !== "applied") process.exit(2);
     outcome.rollback();`,
  ], { encoding: "utf8" });
}

function crashSettingsApplyAfterLiveRename(path: string, request: unknown) {
  const moduleUrl = pathToFileURL(join(
    process.cwd(),
    "src",
    "infra",
    "config",
    "settings-file.ts",
  )).href;
  return spawnSync(process.execPath, [
    "--import",
    "tsx",
    "--input-type=module",
    "--eval",
    `import { renameSync } from "node:fs";
     import { createSettingsFileAuthority } from ${JSON.stringify(moduleUrl)};
     createSettingsFileAuthority({
       path: ${JSON.stringify(path)},
       validateCandidate: () => undefined,
       operations: {
         atomicReplace: (source, destination) => {
           renameSync(source, destination);
           if (destination === ${JSON.stringify(path)}) process.kill(process.pid, "SIGKILL");
         },
       },
     }).apply(${JSON.stringify(request)});`,
  ], { encoding: "utf8" });
}

describe("strict config resolution", () => {
  it.each(["read", "fsync"] as const)(
    "preserves a primary %s failure before a simultaneous descriptor-close failure",
    (fault) => {
      const root = mkdtempSync(join(tmpdir(), "hrauto-settings-primary-cleanup-"));
      try {
        const path = join(root, "settings.json");
        const seeded = createSettingsFileAuthority({ path }).apply(settingsApplyRequest(
          SETTINGS_COMMAND_1, 1, { browser: { headless: false } },
        ));
        assert.equal(seeded.state, "applied");
        if (seeded.state !== "applied") assert.fail("fixture settings must apply");
        seeded.commit();

        const primary = new Error(`injected ${fault} failure`);
        const cleanup = new Error("injected close failure");
        const realClose = fs.closeSync;
        let primaryTriggered = false;
        let cleanupTriggered = false;
        const operation = fault === "read"
          ? vi.spyOn(fs, "readFileSync").mockImplementationOnce(() => {
            primaryTriggered = true;
            throw primary;
          })
          : vi.spyOn(fs, "fsyncSync").mockImplementationOnce(() => {
            primaryTriggered = true;
            throw primary;
          });
        const close = vi.spyOn(fs, "closeSync").mockImplementation((descriptor) => {
          realClose(descriptor);
          if (primaryTriggered && !cleanupTriggered) {
            cleanupTriggered = true;
            throw cleanup;
          }
        });
        syncBuiltinESMExports();
        let thrown: unknown;
        try {
          createSettingsFileAuthority({ path }).read();
        } catch (error) {
          thrown = error;
        } finally {
          operation.mockRestore();
          close.mockRestore();
          syncBuiltinESMExports();
        }

        const pending: unknown[] = [thrown];
        let preserved: AggregateError | undefined;
        while (pending.length > 0) {
          const candidate = pending.shift();
          if (candidate instanceof AggregateError
            && candidate.cause === primary
            && candidate.errors[0] === primary
            && candidate.errors[1] === cleanup) {
            preserved = candidate;
            break;
          }
          if (candidate instanceof AggregateError) {
            for (const nested of candidate.errors as unknown[]) pending.push(nested);
          }
          if (candidate instanceof Error && candidate.cause !== undefined) pending.push(candidate.cause);
        }
        assert.ok(preserved, "the primary and close errors must survive in primary-first order");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it("refuses a writable settings parent before touching authority evidence", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-settings-directory-integrity-"));
    try {
      const path = join(root, "settings.json");
      const authority = createSettingsFileAuthority({ path });
      const applied = authority.apply(settingsApplyRequest(
        SETTINGS_COMMAND_1, 1, { browser: { headless: false } },
      ));
      assert.equal(applied.state, "applied");
      if (applied.state !== "applied") assert.fail("fixture settings must apply");
      applied.commit();
      const entries = readdirSync(root);
      const bytes = entries.map((entry) => readFileSync(join(root, entry)));
      for (const mode of [0o770, 0o707, 0o777, 0o1777]) {
        chmodSync(root, mode);
        assert.throws(() => authority.read(), /settings directory.*group\/world-writable/u);
        assert.deepEqual(readdirSync(root), entries);
        assert.deepEqual(entries.map((entry) => readFileSync(join(root, entry))), bytes);
        assert.equal(lstatSync(root).mode & 0o7777, mode);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses unsafe ancestors at every settings entry point without creating missing descendants", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-settings-unsafe-ancestor-"));
    try {
      for (const mode of [0o770, 0o707]) {
        const ancestor = join(root, String(mode));
        const directory = join(ancestor, "private");
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        const path = join(directory, "settings.json");
        const seed = createSettingsFileAuthority({ path });
        const applied = seed.apply(settingsApplyRequest(
          SETTINGS_COMMAND_1, 1, { browser: { headless: false } },
        ));
        if (applied.state !== "applied") assert.fail("fixture settings must apply");
        // Leave a real prepare plus live lock as evidence; refusal must not reap
        // or compensate any of them, even when read() would otherwise fail busy.
        const entries = readdirSync(directory);
        const before = entries.map((entry) => readFileSync(join(directory, entry)));
        chmodSync(ancestor, mode);
        let effects = 0;
        const authority = createSettingsFileAuthority({
          path,
          validateCandidate: () => { effects += 1; },
          operations: {
            writeExclusive: () => { effects += 1; },
            syncPath: () => { effects += 1; },
            atomicReplace: () => { effects += 1; },
            remove: () => { effects += 1; },
          },
          hooks: { afterLockLinked: () => { effects += 1; } },
        });
        const refusal = /settings directory.*group\/world-writable/u;
        assert.throws(() => authority.read(), refusal);
        assert.throws(() => authority.reconcile(() => { effects += 1; return "committed"; }), refusal);
        assert.throws(() => authority.withExactRecord({
          revision: applied.record.revision, settingsFingerprint: applied.record.settingsFingerprint,
        }, () => { effects += 1; }), refusal);
        assert.throws(() => authority.apply(settingsApplyRequest(
          SETTINGS_COMMAND_2, 2, { browser: { headless: true } },
        )), refusal);
        assert.throws(() => createSettingsFileAuthority({
          path: join(ancestor, "missing", "nested", "settings.json"),
        }).read(), refusal);
        assert.equal(existsSync(join(ancestor, "missing")), false);
        assert.deepEqual(readdirSync(directory), entries);
        assert.deepEqual(entries.map((entry) => readFileSync(join(directory, entry))), before);
        assert.equal(effects, 0);
        assert.equal(lstatSync(ancestor).mode & 0o777, mode);
        chmodSync(ancestor, 0o700);
        applied.commit();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("allows owned 0755 settings directories below sticky temporary ancestors and system aliases", () => {
    // /tmp is a root-owned symlink on macOS; tmpdir() also traverses /var.
    const root = mkdtempSync(join("/tmp", "hrauto-settings-safe-directory-"));
    try {
      const sticky = join(root, "sticky");
      const directory = join(sticky, "config");
      mkdirSync(directory, { recursive: true });
      chmodSync(root, 0o755);
      chmodSync(sticky, 0o1777);
      chmodSync(directory, 0o755);
      const authority = createSettingsFileAuthority({ path: join(directory, "settings.json") });
      const applied = authority.apply(settingsApplyRequest(
        SETTINGS_COMMAND_1, 1, { actor: { label: "safe-directory" } },
      ));
      assert.equal(applied.state, "applied");
      if (applied.state !== "applied") assert.fail("safe directory must permit apply");
      applied.commit();
      assert.deepEqual(authority.read(), applied.record);
      assert.equal(authority.read().settings.actor?.label, "safe-directory");
      assert.equal(lstatSync(directory).mode & 0o777, 0o755);
      assert.equal(lstatSync(sticky).mode & 0o7777, 0o1777);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses application directory symlinks without touching their targets", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-settings-directory-symlink-"));
    try {
      const target = join(root, "target");
      const alias = join(root, "alias");
      mkdirSync(target);
      symlinkSync(target, alias);
      for (const path of [join(alias, "settings.json"), join(alias, "missing", "settings.json")]) {
        assert.throws(() => createSettingsFileAuthority({ path }).read(), /settings directory.*symbolic link/u);
        assert.deepEqual(readdirSync(target), []);
        assert.equal(lstatSync(alias).isSymbolicLink(), true);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses raw parent traversal in a system symlink target before touching its physical destination", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "hrauto-settings-symlink-parent-")));
    try {
      const system = join(root, "system");
      const foreign = join(root, "foreign");
      const physicalSafe = join(foreign, "safe");
      const lexicalSafe = join(system, "safe");
      mkdirSync(physicalSafe, { recursive: true, mode: 0o700 });
      mkdirSync(join(foreign, "sub"), { mode: 0o700 });
      mkdirSync(lexicalSafe, { recursive: true, mode: 0o700 });
      const alias = join(system, "alias");
      const pivot = join(system, "pivot");
      symlinkSync(join(foreign, "sub"), pivot);
      // Keep the raw target: path.join/resolve would erase the very component
      // whose physical traversal this regression must exercise.
      symlinkSync("pivot/../safe", alias);
      chmodSync(foreign, 0o777);
      assert.equal(realpathSync.native(alias), physicalSafe);
      assert.notEqual(realpathSync.native(alias), lexicalSafe);
      const record = SettingsFileRecordSchema.parse({
        revision: 1, settingsSchemaHash: SETTINGS_SCHEMA_HASH,
        settingsFingerprint: derivePersistedSettingsFingerprint({}), settings: {},
      });
      const settingsBytes = Buffer.from(JSON.stringify(record));
      writeFileSync(join(physicalSafe, "settings.json"), settingsBytes, { mode: 0o600 });
      const entries = readdirSync(physicalSafe);
      const realLstat = fs.lstatSync;
      const systemOwnedPaths = new Set([system, alias, pivot]);
      let inspectedRootAlias = false;
      // No real chown/root privilege: only these fixture ownership observations
      // change. Inodes, modes, symlink bytes, traversal, reads and writes stay real.
      const ownership = vi.spyOn(fs, "lstatSync").mockImplementation((path, options) => {
        const status = realLstat(path, options);
        if (status !== undefined && typeof path === "string" && systemOwnedPaths.has(path)) {
          status.uid = 0;
          if (path === alias) inspectedRootAlias = true;
        }
        return status;
      });
      syncBuiltinESMExports();
      let refusal: unknown;
      try {
        try {
          createSettingsFileAuthority({ path: join(alias, "settings.json") }).read();
        } catch (error) {
          refusal = error;
        }
      } finally {
        ownership.mockRestore();
        syncBuiltinESMExports();
      }
      assert.equal(inspectedRootAlias, true, "must pass the simulated root-owned alias boundary");
      assert.deepEqual(readdirSync(physicalSafe), entries,
        "unsafe alias must not publish authority evidence at its physical destination");
      assert.deepEqual(readFileSync(join(physicalSafe, "settings.json")), settingsBytes);
      assert.deepEqual(readdirSync(lexicalSafe), []);
      assert.ok(refusal instanceof Error, "raw parent traversal must refuse, not accept settings");
      assert.match(refusal.message, /raw symbolic-link target contains a '\.\.' path component/u);
      assert.equal(lstatSync(foreign).mode & 0o777, 0o777);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses a directory owned by another uid before publishing a lock", () => {
    const root = mkdtempSync(join("/tmp", "hrauto-settings-foreign-directory-"));
    // A different runtime UID makes this real filesystem directory foreign;
    // no privileged chown or second OS account is needed for the refusal test.
    const runtimeUid = lstatSync(root).uid;
    const uidObservation = vi.spyOn(process, "getuid").mockReturnValue(runtimeUid + 1);
    try {
      assert.throws(() => createSettingsFileAuthority({
        path: join(root, "settings.json"),
      }).read(), /settings directory.*untrusted owner uid/u);
      assert.deepEqual(readdirSync(root), []);
    } finally {
      uidObservation.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses a redirected bound directory before reading or settling through its replacement", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-settings-directory-redirect-"));
    try {
      const directory = join(root, "config");
      const retained = join(root, "retained");
      const path = join(directory, "settings.json");
      const authority = createSettingsFileAuthority({ path });
      const applied = authority.apply(settingsApplyRequest(
        SETTINGS_COMMAND_1, 1, { browser: { headless: false } },
      ));
      if (applied.state !== "applied") assert.fail("fixture settings must apply");
      const entries = readdirSync(directory);
      const before = entries.map((entry) => readFileSync(join(directory, entry)));
      renameSync(directory, retained);
      mkdirSync(directory, { mode: 0o700 });

      assert.throws(() => authority.read(), /settings directory.*changed pathname identity/u);
      assert.throws(() => applied.commit(), /settings directory.*changed pathname identity/u);
      assert.throws(() => applied.rollback(), /settings directory.*changed pathname identity/u);
      assert.deepEqual(readdirSync(directory), []);
      assert.deepEqual(readdirSync(retained), entries);
      assert.deepEqual(entries.map((entry) => readFileSync(join(retained, entry))), before);
      rmSync(directory, { recursive: true });
      assert.throws(() => authority.read(), /settings directory.*disappeared/u);
      assert.equal(existsSync(directory), false);
      renameSync(retained, directory);
      applied.commit();
      assert.deepEqual(authority.read(), applied.record);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("admits exactly the four DCC3 leaves alongside the retained backend arms", () => {
    const patch = {
      ocr: { pageConcurrency: 3, maxValidationRetries: 0 },
      concurrency: { defaultWorkers: 2 },
      paths: { reportsDir: "/tmp/reviewed-reports" },
      browser: { headless: false },
    };
    const parsed = SettingsApplyInputSchema.parse(settingsApplyRequest(SETTINGS_COMMAND_1, 1, patch));
    assert.deepEqual(parsed.patch, patch);
    const resolved = resolveConfigWithProvenance({}, parsed.patch, CLOCK);
    assert.equal(resolved.config.ocr.pageConcurrency, 3);
    assert.equal(resolved.config.ocr.maxValidationRetries, 0);
    assert.equal(resolved.config.concurrency.defaultWorkers, 2);
    assert.equal(resolved.config.paths.reportsDir, "/tmp/reviewed-reports");
    assert.throws(() => deriveSettingsPatchFingerprint({ paths: { reportsDir: "relative" } }));
    assert.throws(() => deriveSettingsPatchFingerprint({ ocr: { pageConcurrency: -1 } }));
    const root = mkdtempSync(join(tmpdir(), "hrauto-settings-dcc3-roundtrip-"));
    try {
      const authority = createSettingsFileAuthority({ path: join(root, "settings.json") });
      const applied = authority.apply(settingsApplyRequest(SETTINGS_COMMAND_1, 1, patch));
      if (applied.state !== "applied") assert.fail("DCC3 leaves must apply");
      applied.commit();
      assert.deepEqual(authority.read().settings, patch);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses old broad-schema and missing-lastApplied envelopes without converting bytes", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-settings-incompatible-"));
    try {
      const path = join(root, "settings.json");
      const settings = { display: { screenWidth: 1920 } };
      for (const settingsSchemaHash of [deriveSchemaHash(SettingsOverrideSchema, "input"), SETTINGS_SCHEMA_HASH]) {
        // The broad-hash case has otherwise complete lastApplied evidence; the
        // current-hash case omits ONLY lastApplied. Neither refusal masks the other.
        const lastApplied = settingsSchemaHash === SETTINGS_SCHEMA_HASH ? undefined : {
          commandId: SETTINGS_COMMAND_1,
          commandFingerprint: "a".repeat(64),
          expectedRevision: 1,
          settingsSchemaHash,
          patchFingerprint: deriveSettingsPatchFingerprint(settings),
        };
        const bytes = JSON.stringify({ revision: 2, settingsSchemaHash,
          settingsFingerprint: derivePersistedSettingsFingerprint(settings), settings, lastApplied });
        writeFileSync(path, bytes, { mode: 0o600 });
        const authority = createSettingsFileAuthority({ path });
        assert.throws(() => authority.read(), /strict persisted settings contract.*schema.*lastApplied.*no automatic conversion/);
        assert.equal(readFileSync(path, "utf8"), bytes);
        assert.equal(existsSync(`${path}.prepare.json`), false);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects credential paths and environment-owned leaves at both settings write boundaries", () => {
    const forbiddenPatches = [
      { paths: { duoCredential: "/tmp/stolen-duo.json" } },
      { paths: { duoExtensionDir: "/tmp/untrusted-extension" } },
      { operator: { timekeeperName: "request-owned-identity" } },
      { paths: { stateRoot: "/tmp/untrusted-state" } },
      { paths: { authRoot: "/tmp/untrusted-auth" } },
    ] as const;

    for (const patch of forbiddenPatches) {
      assert.throws(() => deriveSettingsPatchFingerprint(patch));
      const patchFingerprint = "a".repeat(64);
      assert.equal(SettingsApplyInputSchema.safeParse({
        commandId: SETTINGS_COMMAND_1,
        expectedRevision: 1,
        settingsSchemaHash: SETTINGS_SCHEMA_HASH,
        patchFingerprint,
        patch,
      }).success, false);
      assert.equal(SettingsCommandRequestSchema.safeParse({
        commandId: SETTINGS_COMMAND_1,
        requestedAt: "2026-08-28T12:00:00.000Z",
        requestedBy: "local-operator",
        source: "dashboard",
        family: "settings",
        type: "apply-settings",
        target: { expectedRevision: 1 },
        payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint, patch },
      }).success, false);
    }
  });

  it.each(["settingsSchemaHash", "patchFingerprint"] as const)(
    "refuses request-owned %s mismatch without touching pristine authority",
    (field) => {
      const root = mkdtempSync(join(tmpdir(), "hrauto-settings-pure-refusal-"));
      try {
        const path = join(root, "config", "settings.json");
        const afterLockLinked = vi.fn();
        const authority = createSettingsFileAuthority({ path, hooks: { afterLockLinked } });
        const request = SettingsApplyInputSchema.parse(settingsApplyRequest(
          SETTINGS_COMMAND_1, 1, { browser: { headless: false } },
        ));
        const mismatch = field === "settingsSchemaHash"
          ? "a".repeat(64)
          : deriveSettingsPatchFingerprint({ browser: { headless: true } });
        assert.notEqual(mismatch, request[field]);
        const snapshot = () => ({
          entries: readdirSync(root),
          settings: existsSync(path),
          initialization: existsSync(`${path}.authority.json`),
          lock: existsSync(`${path}.lock`),
          prepare: existsSync(`${path}.prepare.json`),
          rollback: existsSync(`${path}.rollback.json`),
        });
        const pristine = {
          entries: [], settings: false, initialization: false,
          lock: false, prepare: false, rollback: false,
        };
        assert.deepEqual(snapshot(), pristine);

        const outcome = authority.apply({ ...request, [field]: mismatch });

        assert.deepEqual(outcome, {
          state: "rejected",
          code: "schema-mismatch",
          message: field === "settingsSchemaHash"
            ? `settings schema ${mismatch} does not match this build's ${SETTINGS_SCHEMA_HASH}`
            : `settings patch fingerprint ${mismatch} does not match its strict patch value`,
        });
        assert.equal(Object.isFrozen(outcome), true);
        assert.deepEqual(snapshot(), pristine);
        assert.equal(afterLockLinked.mock.calls.length, 0, "refusal must not even transiently acquire the lock");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it("rejects an editable patch whose fully merged config cannot restart", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-settings-merged-config-"));
    try {
      const path = join(root, "config", "settings.json");
      const authority = createSettingsFileAuthority({
        path,
        validateCandidate: (settings: unknown) => {
          resolveConfigWithProvenance({}, settings, CLOCK);
        },
      });

      assert.throws(
        () => authority.apply(settingsApplyRequest(
          SETTINGS_COMMAND_1,
          1,
          { capture: { ingress: "forwarded" } },
        )),
        /fully merged config/u,
      );
      assert.equal(authority.read().revision, 1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("binds crash-recovery replay to the full canonical settings command envelope", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-settings-command-envelope-"));
    try {
      const path = join(root, "config", "settings.json");
      const patch = { browser: { headless: false } } as const;
      const command = {
        commandId: SETTINGS_COMMAND_1,
        requestedAt: "2026-08-28T12:00:00.000Z",
        requestedBy: "local-operator",
        source: "dashboard",
        reason: "operator requested browser policy",
        family: "settings",
        type: "apply-settings",
        target: { expectedRevision: 1 },
        payload: {
          settingsSchemaHash: SETTINGS_SCHEMA_HASH,
          patchFingerprint: deriveSettingsPatchFingerprint(patch),
          patch,
        },
      } as const;
      const authority = createSettingsFileAuthority({ path });
      const first = authority.apply({
        commandId: command.commandId,
        expectedRevision: command.target.expectedRevision,
        settingsSchemaHash: command.payload.settingsSchemaHash,
        patchFingerprint: command.payload.patchFingerprint,
        patch: command.payload.patch,
        commandFingerprint: deriveSettingsCommandFingerprint(command),
      });
      assert.equal(first.state, "applied");
      if (first.state !== "applied") return;
      first.commit();

      const divergentEnvelope = {
        ...command,
        requestedAt: "2026-08-28T12:00:01.000Z",
      };
      assert.throws(() => createSettingsFileAuthority({ path }).apply({
        commandId: command.commandId,
        expectedRevision: command.target.expectedRevision,
        settingsSchemaHash: command.payload.settingsSchemaHash,
        patchFingerprint: command.payload.patchFingerprint,
        patch: command.payload.patch,
        commandFingerprint: deriveSettingsCommandFingerprint(divergentEnvelope),
      }), /full canonical command envelope/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses to follow a settings-file symbolic link", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-settings-symlink-"));
    try {
      const targetPath = join(root, "target.json");
      const linkedPath = join(root, "settings.json");
      const target = createSettingsFileAuthority({ path: targetPath });
      const applied = target.apply(settingsApplyRequest(
        SETTINGS_COMMAND_1,
        1,
        { browser: { headless: false } },
      ));
      assert.equal(applied.state, "applied");
      if (applied.state === "applied") applied.commit();
      symlinkSync(targetPath, linkedPath);

      assert.throws(
        () => createSettingsFileAuthority({ path: linkedPath }).read(),
        /symbolic link|no-follow/u,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses non-regular, over-permissive, and oversized settings files", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-settings-file-shape-"));
    try {
      const regularPath = join(root, "regular.json");
      const regular = createSettingsFileAuthority({ path: regularPath }).apply(settingsApplyRequest(
        SETTINGS_COMMAND_1,
        1,
        { browser: { headless: false } },
      ));
      assert.equal(regular.state, "applied");
      if (regular.state === "applied") regular.commit();
      const hardLinkedPath = join(root, "hard-linked.json");
      linkSync(regularPath, hardLinkedPath);
      assert.throws(
        () => createSettingsFileAuthority({ path: hardLinkedPath }).read(),
        /has 2 hard links; expected 1/u,
      );
      unlinkSync(hardLinkedPath);
      chmodSync(regularPath, 0o644);
      assert.throws(
        () => createSettingsFileAuthority({ path: regularPath }).read(),
        /permissions are 644; exactly 600 is required/u,
      );

      const directoryPath = join(root, "directory.json");
      mkdirSync(directoryPath);
      assert.throws(
        () => createSettingsFileAuthority({ path: directoryPath }).read(),
        /not a regular file/u,
      );

      const oversizedPath = join(root, "oversized.json");
      writeFileSync(oversizedPath, Buffer.alloc(MAX_SETTINGS_FILE_BYTES + 1), { mode: 0o600 });
      assert.throws(
        () => createSettingsFileAuthority({ path: oversizedPath }).read(),
        /maximum is/u,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects actor metadata that would make the persisted settings file max plus one byte", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-settings-next-bytes-limit-"));
    try {
      const path = join(root, "config", "settings.json");
      const authority = createSettingsFileAuthority({ path });

      assert.throws(
        () => authority.apply(settingsApplyRequest(
          SETTINGS_COMMAND_1,
          1,
          { actor: { label: "a".repeat(1_048_001) } },
        )),
        /settings candidate is 1048577 bytes; maximum is 1048576 before replacement/u,
      );
      assert.equal(authority.read().revision, 1);
      assert.equal(readdirSync(join(root, "config")).includes("settings.json"), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("persists actor metadata whose canonical settings file is exactly the byte maximum", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-settings-next-bytes-boundary-"));
    try {
      const path = join(root, "config", "settings.json");
      const applied = createSettingsFileAuthority({ path }).apply(settingsApplyRequest(
        SETTINGS_COMMAND_1,
        1,
        { actor: { label: "a".repeat(1_048_000) } },
      ));

      assert.equal(applied.state, "applied");
      if (applied.state === "applied") applied.commit();
      assert.equal(readFileSync(path).byteLength, MAX_SETTINGS_FILE_BYTES);
      const parsed = SettingsFileRecordSchema.parse(JSON.parse(readFileSync(path, "utf8")));
      assert.equal(parsed.revision, 2);
      assert.equal(parsed.settingsSchemaHash, SETTINGS_SCHEMA_HASH);
      assert.ok(parsed.settings.actor?.label === "a".repeat(1_048_000),
        "exact-boundary actor label must round-trip without substitution");
      assert.equal(parsed.lastApplied?.commandId, SETTINGS_COMMAND_1);
      assert.deepEqual(parsed, applied.record);
      assert.deepEqual(createSettingsFileAuthority({ path }).read(), parsed);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("recovers an acquisition-named hard-link twin left by process loss", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-settings-lock-twin-"));
    try {
      const path = join(root, "config", "settings.json");
      const child = crashSettingsAuthorityAtHook(path, "afterLockLinked");
      assert.equal(child.signal, "SIGKILL", child.stderr);

      const recovered = createSettingsFileAuthority({ path }).read();
      assert.equal(recovered.revision, 1);
      assert.deepEqual(
        readdirSync(join(root, "config")),
        ["settings.json.authority.json"],
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("holds exclusive settings authority until transaction commit or rollback", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-settings-exclusive-"));
    try {
      const path = join(root, "config", "settings.json");
      const firstAuthority = createSettingsFileAuthority({ path });
      const first = firstAuthority.apply(settingsApplyRequest(
        SETTINGS_COMMAND_1,
        1,
        { browser: { headless: false } },
      ));
      assert.equal(first.state, "applied");
      if (first.state !== "applied") return;

      assert.throws(
        () => createSettingsFileAuthority({ path }).apply(settingsApplyRequest(
          SETTINGS_COMMAND_2,
          2,
          { display: { screenHeight: 1080 } },
        )),
        /exclusive settings authority/u,
      );

      first.commit();
      const committedBytes = readFileSync(path);
      const second = createSettingsFileAuthority({ path }).apply(settingsApplyRequest(
        SETTINGS_COMMAND_2,
        2,
        { display: { screenHeight: 1080 } },
      ));
      assert.equal(second.state, "applied");
      if (second.state === "applied") second.rollback();
      assert.deepEqual(readFileSync(path), committedBytes);
      assert.equal(createSettingsFileAuthority({ path }).read().revision, 2);
      assert.equal(readdirSync(join(root, "config")).includes("settings.json.rollback.json"), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("durably prepares exact prior and next settings before the live rename", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-settings-durable-prepare-"));
    try {
      const path = join(root, "config", "settings.json");
      const request = settingsApplyRequest(
        SETTINGS_COMMAND_1,
        1,
        { browser: { headless: false } },
      );
      const child = crashSettingsApplyAfterLiveRename(path, request);
      assert.equal(child.signal, "SIGKILL", child.stderr);

      const prepare = JSON.parse(readFileSync(`${path}.prepare.json`, "utf8")) as Record<string, unknown>;
      assert.deepEqual(prepare.command, {
        commandId: SETTINGS_COMMAND_1,
        commandFingerprint: (request as { commandFingerprint: string }).commandFingerprint,
        expectedRevision: 1,
        settingsSchemaHash: SETTINGS_SCHEMA_HASH,
        patchFingerprint: deriveSettingsPatchFingerprint({ browser: { headless: false } }),
      });
      assert.equal(prepare.priorSettingsBytesBase64, null);
      assert.equal(
        prepare.nextSettingsBytesBase64,
        readFileSync(path).toString("base64"),
      );
      assert.equal(typeof prepare.priorInitializationBytesBase64, "string");
      assert.equal(typeof prepare.nextInitializationBytesBase64, "string");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("restores the exact prior settings when a prepared command did not commit", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-settings-prepare-rollback-"));
    try {
      const path = join(root, "config", "settings.json");
      const child = crashSettingsApplyAfterLiveRename(
        path,
        settingsApplyRequest(
          SETTINGS_COMMAND_1,
          1,
          { browser: { headless: false } },
        ),
      );
      assert.equal(child.signal, "SIGKILL", child.stderr);

      const recovered = createSettingsFileAuthority({ path }).reconcile(() => "rollback");

      assert.equal(recovered.revision, 1);
      assert.deepEqual(recovered.settings, {});
      assert.equal(existsSync(path), false);
      assert.equal(existsSync(`${path}.prepare.json`), false);
      assert.deepEqual(readdirSync(join(root, "config")), ["settings.json.authority.json"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("serializes stale cleanup through main-lock reacquisition", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-settings-stale-reaper-"));
    try {
      const path = join(root, "config", "settings.json");
      const request = settingsApplyRequest(
        SETTINGS_COMMAND_1,
        1,
        { browser: { headless: false } },
      );
      const moduleUrl = pathToFileURL(join(
        process.cwd(),
        "src",
        "infra",
        "config",
        "settings-file.ts",
      )).href;
      const child = spawnSync(process.execPath, [
        "--import",
        "tsx",
        "--input-type=module",
        "--eval",
        `import { createSettingsFileAuthority } from ${JSON.stringify(moduleUrl)};
         const outcome = createSettingsFileAuthority({
           path: ${JSON.stringify(path)},
           validateCandidate: () => undefined,
         }).apply(${JSON.stringify(request)});
         if (outcome.state !== "applied") process.exit(2);
         process.kill(process.pid, "SIGKILL");`,
      ], { encoding: "utf8" });
      assert.equal(child.signal, "SIGKILL", child.stderr);

      let concurrentReaperRefused = false;
      const recovered = createSettingsFileAuthority({
        path,
        hooks: {
          beforeStaleLockRemoval: () => {
            assert.throws(
              () => createSettingsFileAuthority({ path }).apply(settingsApplyRequest(
                SETTINGS_COMMAND_2,
                2,
                { display: { screenHeight: 1080 } },
              )),
              /stale-lock reclamation is in progress/u,
            );
            concurrentReaperRefused = true;
          },
        },
      }).reconcile(() => "committed");

      assert.equal(concurrentReaperRefused, true);
      assert.equal(recovered.revision, 2);
      assert.deepEqual(recovered.settings, { browser: { headless: false } });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    ["before its file fsync", "beforeReaperFsync"],
    ["after its file fsync", "afterReaperFsync"],
    ["before main-lock reacquisition", "beforeMainLockReacquisition"],
    ["after main-lock reacquisition", "afterMainLockReacquisition"],
  ] as const)("recovers a dead stale-reaper that crashed %s", (_phase, hook) => {
    const root = mkdtempSync(join(tmpdir(), `hrauto-settings-dead-reaper-${hook}-`));
    try {
      const path = join(root, "config", "settings.json");
      const staleMain = crashSettingsAuthorityAtHook(path, "afterLockLinked");
      assert.equal(staleMain.signal, "SIGKILL", staleMain.stderr);
      const deadReaper = crashSettingsAuthorityAtHook(path, hook);
      assert.equal(deadReaper.signal, "SIGKILL", deadReaper.stderr);

      const recovered = createSettingsFileAuthority({ path }).read();

      assert.equal(recovered.revision, 1);
      assert.deepEqual(readdirSync(join(root, "config")), ["settings.json.authority.json"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps revision CAS inside the exclusive atomic-replace authority", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-settings-cas-race-"));
    try {
      const path = join(root, "config", "settings.json");
      const contender = createSettingsFileAuthority({ path });
      let raceAttempted = false;
      const winner = createSettingsFileAuthority({
        path,
        operations: {
          atomicReplace: (source, destination) => {
            if (destination === path && !raceAttempted) {
              raceAttempted = true;
              assert.throws(
                () => contender.apply(settingsApplyRequest(
                  SETTINGS_COMMAND_2,
                  1,
                  { display: { screenHeight: 1080 } },
                )),
                /exclusive settings authority/u,
              );
            }
            renameSync(source, destination);
          },
        },
      }).apply(settingsApplyRequest(
        SETTINGS_COMMAND_1,
        1,
        { browser: { headless: false } },
      ));

      assert.equal(raceAttempted, true);
      assert.equal(winner.state, "applied");
      if (winner.state !== "applied") return;
      winner.commit();
      assert.deepEqual(createSettingsFileAuthority({ path }).read().settings, {
        browser: { headless: false },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("distinguishes virgin settings from deletion after initialization", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-settings-deletion-evidence-"));
    try {
      const path = join(root, "config", "settings.json");
      const authority = createSettingsFileAuthority({ path });
      assert.equal(authority.read().revision, 1);
      const applied = authority.apply(settingsApplyRequest(
        SETTINGS_COMMAND_1,
        1,
        { browser: { headless: false } },
      ));
      assert.equal(applied.state, "applied");
      if (applied.state !== "applied") return;
      applied.commit();
      unlinkSync(path);

      assert.throws(
        () => createSettingsFileAuthority({ path }).read(),
        /missing after settings authority was initialized/u,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("recovers a settings replace that completed before initialization evidence advanced", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-settings-init-recovery-"));
    try {
      const path = join(root, "config", "settings.json");
      const evidencePath = `${path}.authority.json`;
      const authority = createSettingsFileAuthority({ path });
      assert.equal(authority.read().revision, 1);
      const virginEvidence = readFileSync(evidencePath);
      const applied = authority.apply(settingsApplyRequest(
        SETTINGS_COMMAND_1,
        1,
        { browser: { headless: false } },
      ));
      assert.equal(applied.state, "applied");
      if (applied.state !== "applied") return;
      applied.commit();

      writeFileSync(evidencePath, virginEvidence, { mode: 0o600 });
      const restarted = createSettingsFileAuthority({ path }).read();
      assert.deepEqual(restarted.settings, { browser: { headless: false } });
      assert.notDeepEqual(readFileSync(evidencePath), virginEvidence);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails loud after process loss between first-update sidecar and settings-byte rollback", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-settings-rollback-order-"));
    try {
      const path = join(root, "config", "settings.json");
      const evidencePath = `${path}.authority.json`;
      const request = settingsApplyRequest(
        SETTINGS_COMMAND_1,
        1,
        { browser: { headless: false } },
      );
      const moduleUrl = pathToFileURL(join(
        process.cwd(),
        "src",
        "infra",
        "config",
        "settings-file.ts",
      )).href;
      const child = spawnSync(process.execPath, [
        "--import",
        "tsx",
        "--input-type=module",
        "--eval",
        `import { readFileSync, renameSync } from "node:fs";
         import { createSettingsFileAuthority } from ${JSON.stringify(moduleUrl)};
         let rollbackArmed = false;
         const authority = createSettingsFileAuthority({
           path: ${JSON.stringify(path)},
           validateCandidate: () => undefined,
           operations: {
             atomicReplace: (source, destination) => {
               renameSync(source, destination);
               if (rollbackArmed && destination === ${JSON.stringify(evidencePath)}
                 && JSON.parse(readFileSync(destination, "utf8")).state === "virgin") {
                 process.kill(process.pid, "SIGKILL");
               }
             },
           },
         });
         const outcome = authority.apply(${JSON.stringify(request)});
         if (outcome.state !== "applied") process.exit(2);
         rollbackArmed = true;
         outcome.rollback();`,
      ], { encoding: "utf8" });
      assert.equal(child.signal, "SIGKILL", child.stderr);

      assert.throws(
        () => createSettingsFileAuthority({ path }).read(),
        /interrupted settings rollback/u,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps every interrupted first-update rollback phase distinguishable on restart", () => {
    const interruptedHooks = [
      "afterRollbackPrepared",
      "afterRollbackSettingsRestored",
      "afterRollbackInitializationRestored",
    ] as const;

    for (const hook of interruptedHooks) {
      const root = mkdtempSync(join(tmpdir(), `hrauto-settings-rollback-${hook}-`));
      try {
        const path = join(root, "config", "settings.json");
        const child = crashFirstUpdateRollbackAtHook(path, hook);
        assert.equal(child.signal, "SIGKILL", `${hook}: ${child.stderr}`);
        assert.match(readFileSync(`${path}.rollback.json`, "utf8"), /"rollbackId":/u);
        assert.throws(
          () => createSettingsFileAuthority({ path }).read(),
          /interrupted settings rollback/u,
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  it("admits restart only after first-update rollback evidence is durably removed", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-settings-rollback-complete-"));
    try {
      const path = join(root, "config", "settings.json");
      const child = crashFirstUpdateRollbackAtHook(path, "afterRollbackCompleted");
      assert.equal(child.signal, "SIGKILL", child.stderr);
      assert.equal(readdirSync(join(root, "config")).includes("settings.json.rollback.json"), false);

      const restarted = createSettingsFileAuthority({ path }).read();
      assert.equal(restarted.revision, 1);
      assert.deepEqual(restarted.settings, {});
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("applies one representative leaf from every ConfigSchema-owned settings group", () => {
    assert.deepEqual(
      Object.keys(SettingsOverrideSchema.shape).sort(),
      Object.keys(ConfigSchema.shape).sort(),
    );
    const resolved = resolveConfigWithProvenance({}, {
      actor: { label: "Settings actor" },
      urls: { kuali: { test: { entry: "https://kuali-test.example.test" } } },
      timeouts: { navigationMs: 12_345 },
      paths: { reportsDir: "/tmp/settings-reports" },
      annualDates: {
        FY2027: {
          jobEndDate: "06/30/2027",
          kronosDefaultEndDate: "06/30/2027",
          kronosDefaultStartDate: "07/01/2026",
        },
      },
      operator: { timekeeperName: "Settings operator" },
      display: { screenWidth: 1920 },
      performance: { navigationRetries: 3 },
      ocr: { secondOpinionMax: 2 },
      capture: { maxPhotos: 12 },
      browserHealth: { maxAutoRefresh: 4 },
      browser: { headless: false },
      concurrency: { defaultWorkers: 2 },
      daemon: { idleMs: 120_000 },
      features: { debugScreenshots: true },
      providers: {
        ocrExtract: {
          timeoutMs: 30_000,
          concurrency: 2,
          requestsPerMinute: 5,
          dailyRequestLimit: 50,
          costLimitUsdMicros: 0,
        },
      },
    }, CLOCK);

    for (const path of [
      "actor.label", "urls.kuali.test.entry", "timeouts.navigationMs", "paths.reportsDir",
      "annualDates.FY2027.jobEndDate", "operator.timekeeperName", "display.screenWidth",
      "performance.navigationRetries", "ocr.secondOpinionMax", "capture.maxPhotos",
      "browserHealth.maxAutoRefresh", "browser.headless", "concurrency.defaultWorkers",
      "daemon.idleMs", "features.debugScreenshots", "providers.ocrExtract.timeoutMs",
    ]) {
      assert.equal(resolved.provenance[path], "settings", path);
    }
  });

  it("persists an atomic patch for exact restart readback while environment leaves stay authoritative", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-settings-authority-"));
    try {
      const path = join(root, "config", "settings.json");
      const patch = { browser: { headless: false }, display: { screenWidth: 1920 } } as const;
      const authority = createSettingsFileAuthority({ path });

      const applied = authority.apply(settingsApplyRequest(SETTINGS_COMMAND_1, 1, patch));

      assert.equal(applied.state, "applied");
      if (applied.state !== "applied") return;
      assert.equal(applied.record.revision, 2);
      applied.commit();
      const persistedBytes = readFileSync(path);
      const restarted = createSettingsFileAuthority({ path }).read();
      assert.deepEqual(restarted.settings, patch);
      const recoveredReplay = createSettingsFileAuthority({ path }).apply(
        settingsApplyRequest(SETTINGS_COMMAND_1, 1, patch),
      );
      assert.equal(recoveredReplay.state, "applied");
      if (recoveredReplay.state === "applied") recoveredReplay.commit();
      assert.deepEqual(readFileSync(path), persistedBytes);
      const resolved = resolveConfigWithProvenance(
        { TIMEKEEPER_NAME: "environment-name" },
        { ...restarted.settings, operator: { timekeeperName: "persisted-name" } },
        CLOCK,
      );
      assert.equal(resolved.config.operator.timekeeperName, "environment-name");
      assert.equal(resolved.provenance["operator.timekeeperName"], "env");
      assert.equal(resolved.config.browser.headless, false);
      assert.equal(resolved.provenance["browser.headless"], "settings");
      assert.equal(resolved.config.display.screenWidth, 1920);
      assert.equal(resolved.provenance["display.screenWidth"], "settings");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps the prior settings bytes exact when staging is interrupted", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-settings-interrupted-"));
    try {
      const directory = join(root, "config");
      const path = join(directory, "settings.json");
      const initial = createSettingsFileAuthority({ path });
      const firstPatch = { browser: { headless: false } } as const;
      const first = initial.apply(settingsApplyRequest(SETTINGS_COMMAND_1, 1, firstPatch));
      assert.equal(first.state, "applied");
      if (first.state === "applied") first.commit();
      const priorBytes = readFileSync(path);
      const priorEvidenceBytes = readFileSync(`${path}.authority.json`);
      const nextPatch = { display: { screenHeight: 1080 } } as const;
      const interrupted = createSettingsFileAuthority({
        path,
        operations: {
          writeExclusive: (temporaryPath, bytes) => {
            writeFileSync(temporaryPath, bytes.slice(0, 17), { flag: "wx" });
            throw new Error("injected interrupted settings staging write");
          },
        },
      });

      assert.throws(
        () => interrupted.apply(settingsApplyRequest(SETTINGS_COMMAND_2, 2, nextPatch)),
        /could not stage a complete durable replacement/u,
      );
      assert.deepEqual(readFileSync(path), priorBytes);
      assert.deepEqual(readFileSync(`${path}.authority.json`), priorEvidenceBytes);
      assert.deepEqual(readdirSync(directory), ["settings.json", "settings.json.authority.json"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports failure-integrity inspection errors instead of hiding them", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-settings-failure-inspection-"));
    try {
      const directory = join(root, "config");
      const path = join(directory, "settings.json");
      let liveReplacementReached = false;
      const authority = createSettingsFileAuthority({
        path,
        operations: {
          atomicReplace: (source, destination) => {
            renameSync(source, destination);
            if (destination === path) liveReplacementReached = true;
          },
          syncPath: (target) => {
            if (!liveReplacementReached || target !== directory) return;
            chmodSync(path, 0o644);
            throw new Error("injected live settings directory fsync failure");
          },
        },
      });

      assert.throws(
        () => authority.apply(settingsApplyRequest(
          SETTINGS_COMMAND_1,
          1,
          { browser: { headless: false } },
        )),
        (error: unknown) => {
          assert.ok(error instanceof AggregateError);
          assert.match(error.message, /could not verify failure integrity/u);
          assert.equal(error.errors.length, 2);
          assert.match(String(error.errors[0]), /directory fsync failed/u);
          assert.match(String(error.errors[1]), /permissions are 644/u);
          return true;
        },
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses malformed or incomplete persisted settings instead of resolving defaults", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-settings-malformed-"));
    try {
      const path = join(root, "config", "settings.json");
      mkdirSync(join(root, "config"));
      const authority = createSettingsFileAuthority({ path });

      writeFileSync(path, '{"revision":2', { encoding: "utf8", mode: 0o600 });
      assert.throws(() => authority.read(), /is not valid JSON/u);
      writeFileSync(path, '{"revision":2}\n', { encoding: "utf8", mode: 0o600 });
      assert.throws(
        () => authority.read(),
        /does not satisfy the strict persisted settings contract/u,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("makes empty settings exactly equal schema defaults", () => {
    assert.deepEqual(resolveConfig({}, {}, CLOCK), ConfigSchema.parse({ paths: defaultRuntimePaths() }));
    assert.equal(resolveConfig({}, {}, CLOCK).timeouts.ukgNavigationMs, 60_000);
    assert.equal(ConfigSchema.safeParse({ unexpected: true }).success, false);
    assert.equal(ConfigSchema.safeParse({ urls: { unexpected: true } }).success, false);
    assert.equal(SettingsOverrideSchema.safeParse({ urls: { ucpath: { test: { typo: "https://example.test" } } } }).success, false);
    assert.equal(SettingsOverrideSchema.safeParse({ actor: { id: "someone-else" } }).success, false);
    assert.equal(ConfigSchema.safeParse({ actor: { id: "someone-else", label: "Other" } }).success, false);
  });

  it("applies env over settings over defaults and records complete provenance", () => {
    const settings = {
      operator: { timekeeperName: "settings-name" },
      ocr: { secondOpinionMax: 7 },
      urls: { ucpath: { test: { smartHr: "https://settings-ucpath.example.test" } } },
    };
    const resolved = resolveConfigWithProvenance({
      TIMEKEEPER_NAME: "env-name",
      HRAUTO_UCPATH_TEST_URL: "https://env-ucpath.example.test",
      HRAUTO_UKG_NAVIGATION_MS: "75000",
    }, settings, CLOCK);
    assert.equal(resolved.config.operator.timekeeperName, "env-name");
    assert.equal(resolved.config.ocr.secondOpinionMax, 7);
    assert.equal(resolved.config.urls.ucpath.test?.smartHr, "https://env-ucpath.example.test");
    assert.equal(resolved.config.timeouts.ukgNavigationMs, 75_000);
    assert.equal(resolved.provenance["operator.timekeeperName"], "env");
    assert.equal(resolved.provenance["ocr.secondOpinionMax"], "settings");
    assert.equal(resolved.provenance["timeouts.ukgNavigationMs"], "env");
    assert.equal(resolved.provenance["timeouts.taskMs"], "default");
    assert.match(resolved.fingerprint, /^[0-9a-f]{64}$/);
    assert.equal(Object.keys(resolved.provenance).length > 70, true);
  });

  it("applies the browser settings group instead of accepting and dropping it", () => {
    const resolved = resolveConfigWithProvenance({}, {
      browser: { headless: false, closeProofMs: 25_000 },
    }, CLOCK);

    assert.deepEqual(resolved.config.browser, { headless: false, closeProofMs: 25_000 });
    assert.equal(resolved.provenance["browser.headless"], "settings");
    assert.equal(resolved.provenance["browser.closeProofMs"], "settings");
  });

  it("rejects malformed env values and incomplete annual-date env groups", () => {
    assert.throws(() => resolveConfig({ OCR_PAGE_CONCURRENCY: "auto" }, {}, CLOCK));
    assert.throws(() => resolveConfig({ ANNUAL_DATES_END: "06/30/2027" }, {}, CLOCK), /incomplete/);
    const config = resolveConfig({
      ANNUAL_DATES_END: "06/30/2027",
      KRONOS_DEFAULT_END_DATE: "2/1/2027",
      KRONOS_DEFAULT_START_DATE: "1/1/2017",
    }, {}, CLOCK);
    assert.equal(config.annualDates.FY2027?.jobEndDate, "06/30/2027");
  });

  it("keeps the env map one-to-one", () => {
    const keys = CONFIG_ENV_BINDINGS.map(({ env }) => env);
    const paths = CONFIG_ENV_BINDINGS.map(({ path }) => path);
    assert.equal(new Set(keys).size, keys.length);
    assert.equal(new Set(paths).size, paths.length);
  });

  it("binds every declared environment path to a real schema leaf and provenance channel", () => {
    const env = Object.fromEntries(CONFIG_ENV_BINDINGS.map(({ env }) => [
      env,
      env.endsWith("_URL") ? "https://config.example.test"
        : env === "TIMEKEEPER_NAME" ? "Operator"
          : env === "ANNUAL_DATES_END" ? "06/30/2027"
            : env === "KRONOS_DEFAULT_END_DATE" ? "2/1/2027"
              : env === "KRONOS_DEFAULT_START_DATE" ? "1/1/2017"
                : env === "DEBUG_SCREENSHOTS" || env === "HR_AUTOMATION_DUO_WEBAUTHN" ? "1"
                  : env.includes("CONCURRENCY") || env.includes("RETRIES") ? "1" : "1000",
    ]));
    const resolved = resolveConfigWithProvenance(env, {}, CLOCK);
    for (const binding of CONFIG_ENV_BINDINGS) {
      assert.equal(resolved.provenance[binding.path.replace("*", "FY2027")], "env", binding.path);
    }
  });
});

describe("instance and fiscal safety", () => {
  it("defaults declared systems to production and refuses absent/equal test endpoints", () => {
    const config = resolveConfig({}, {}, CLOCK);
    assert.deepEqual(resolveInstances(config, ["ucpath", "crm"], undefined, "run-1"), { ucpath: "prod", crm: "prod" });
    assert.throws(() => resolveInstances(config, ["ucpath"], { crm: "test" }, "run-1"), /undeclared systems/);
    assert.throws(() => resolveSystemEntryUrl(config, "ucpath", "test", "run-1"), /no distinct test URL/);

    const withDistinct = resolveConfig({}, {
      urls: { ucpath: { test: { smartHr: "https://ucpath-test.example.test" } } },
    }, CLOCK);
    assert.equal(resolveSystemEntryUrl(withDistinct, "ucpath", "test", "run-1"), "https://ucpath-test.example.test");
    const withEqual = resolveConfig({}, {
      urls: { ucpath: { test: { smartHr: config.urls.ucpath.prod.smartHr } } },
    }, CLOCK);
    assert.throws(() => resolveSystemEntryUrl(withEqual, "ucpath", "test", "run-1"), /no distinct test URL/);
  });

  it("fails on missing and stale current-fiscal-year values", () => {
    const defaults = resolveConfig({}, {}, CLOCK);
    assert.throws(() => requireAnnualDates(defaults, CLOCK), /FY2027/);
    const stale = resolveConfig({}, {
      annualDates: { FY2027: {
        jobEndDate: "06/30/2026",
        kronosDefaultEndDate: "2/1/2027",
        kronosDefaultStartDate: "1/1/2017",
      } },
    }, CLOCK);
    assert.throws(() => requireAnnualDates(stale, CLOCK), /stale/);
    assert.throws(() => assertNotPast("02/30/2027", "badDate", CLOCK), /valid calendar date/);
  });
});
