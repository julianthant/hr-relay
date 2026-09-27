import { hostConfigFacts } from "../../src/domain/config/host-display.js";
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
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, it, vi } from "vitest";
import { MIGRATED_SETTINGS_ENVIRONMENT_KEYS, SETTINGS_CATALOG } from "../../src/domain/config/catalog.js";
import { manualClock } from "../../src/domain/clock.js";
import { assertNotPast, requireAnnualDates } from "../../src/domain/config/fiscal-year.js";
import { resolveInstances, resolveSystemEntryUrl } from "../../src/domain/config/instance.js";
import { CONFIG_ENV_BINDINGS, ConfigEnvBindingRegistrySchema, configLeafPaths, resolveConfigWithProvenance } from "../../src/domain/config/resolve.js";
import { defaultRuntimePaths } from "../../src/domain/config/runtime-paths.js";
import { ConfigSchema, SettingsOverrideSchema } from "../../src/domain/config/schema.js";
import { SettingsCurrentRecordSchema } from "../../src/domain/config/settings-current.js";
import { settingsRootAuthority } from "../../src/infra/compat/d331-settings-root.js";
import {
  SETTINGS_SCHEMA_HASH,
  SettingsPatchSchema,
  SettingsApplyInputSchema,
  SettingsFileRecordSchema,
  derivePersistedSettingsFingerprint,
  deriveSettingsPatchFingerprint,
  mergeSettingsPatch,
} from "../../src/domain/config/settings.js";
import {
  SettingsCommandRequestSchema,
  deriveSettingsCommandFingerprint,
} from "../../src/domain/commands.js";
import {
  MAX_SETTINGS_FILE_BYTES,
  createSettingsFileAuthority as createRawSettingsFileAuthority,
  type SettingsFileAuthorityOptions,
} from "../fixtures/d331-settings-file.js";

const CLOCK = manualClock(new Date("2026-08-10T12:00:00-07:00"));
const SETTINGS_COMMAND_1 = "11111111-1111-4111-8111-111111111111";
const SETTINGS_COMMAND_2 = "22222222-2222-4222-8222-222222222222";

function ordinarySettingsPath(stateRoot: string): string {
  return join(stateRoot, "settings", "settings.json");
}

type TestSettingsFileAuthorityOptions = Omit<SettingsFileAuthorityOptions, "validateCandidate"> & {
  readonly validateCandidate?: SettingsFileAuthorityOptions["validateCandidate"];
};

function createSettingsFileAuthority(options: TestSettingsFileAuthorityOptions) {
  return createRawSettingsFileAuthority({
    ...options,
    validateCandidate: options.validateCandidate ?? ((settings) => {
      resolveConfigWithProvenance(settings, hostConfigFacts({}), CLOCK);
    }),
  });
}

function settingsOperations(settings: Record<string, unknown>): Record<string, { set: unknown }> {
  const operations: Record<string, { set: unknown }> = {};
  const walk = (value: unknown, path: string): void => {
    const catalogKey = path.replace(/^annualDates\.FY\d{4}\./u, "annualDates.*.");
    if (SETTINGS_CATALOG.some((row) => row.key === catalogKey && row.sourceClass === "ordinary-settings")) {
      operations[path] = { set: value };
      return;
    }
    if (value === null || Array.isArray(value) || typeof value !== "object") {
      operations[path] = { set: value };
      return;
    }
    for (const [key, nested] of Object.entries(value)) walk(nested, path.length === 0 ? key : `${path}.${key}`);
  };
  walk(settings, "");
  delete operations[""];
  return operations;
}

function settingsApplyRequest(commandId: string, expectedRevision: number, settings: Record<string, unknown>): unknown {
  const parsedPatch = SettingsPatchSchema.safeParse(settings);
  const patch = parsedPatch.success ? parsedPatch.data : settingsOperations(settings);
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
    "tests",
    "fixtures",
    "d331-settings-file.ts",
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
    "tests",
    "fixtures",
    "d331-settings-file.ts",
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
    "tests",
    "fixtures",
    "d331-settings-file.ts",
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
        const path = ordinarySettingsPath(root);
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
      const path = ordinarySettingsPath(root);
      const authority = createSettingsFileAuthority({ path });
      const applied = authority.apply(settingsApplyRequest(
        SETTINGS_COMMAND_1, 1, { browser: { headless: false } },
      ));
      assert.equal(applied.state, "applied");
      if (applied.state !== "applied") assert.fail("fixture settings must apply");
      applied.commit();
      const directory = dirname(path);
      const entries = readdirSync(directory);
      const bytes = entries.map((entry) => readFileSync(join(directory, entry)));
      for (const mode of [0o770, 0o707, 0o777, 0o1777]) {
        chmodSync(directory, mode);
        assert.throws(() => authority.read(), /directory-integrity: settings directory .* must have mode 0700/u);
        assert.deepEqual(readdirSync(directory), entries);
        assert.deepEqual(entries.map((entry) => readFileSync(join(directory, entry))), bytes);
        assert.equal(lstatSync(directory).mode & 0o7777, mode);
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
        const path = ordinarySettingsPath(directory);
        const seed = createSettingsFileAuthority({ path });
        const applied = seed.apply(settingsApplyRequest(
          SETTINGS_COMMAND_1, 1, { browser: { headless: false } },
        ));
        if (applied.state !== "applied") assert.fail("fixture settings must apply");
        // Leave a real prepare plus live lock as evidence; refusal must not reap
        // or compensate any of them, even when read() would otherwise fail busy.
        const authorityDirectory = dirname(path);
        const entries = readdirSync(authorityDirectory);
        const before = entries.map((entry) => readFileSync(join(authorityDirectory, entry)));
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
          path: ordinarySettingsPath(join(ancestor, "missing", "nested")),
        }).read(), refusal);
        assert.equal(existsSync(join(ancestor, "missing")), false);
        assert.deepEqual(readdirSync(authorityDirectory), entries);
        assert.deepEqual(entries.map((entry) => readFileSync(join(authorityDirectory, entry))), before);
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
      const directory = join(sticky, ".tracker");
      mkdirSync(directory, { recursive: true });
      chmodSync(root, 0o755);
      chmodSync(sticky, 0o1777);
      chmodSync(directory, 0o755);
      const authority = createSettingsFileAuthority({ path: ordinarySettingsPath(directory) });
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
      for (const path of [ordinarySettingsPath(alias), ordinarySettingsPath(join(alias, "missing"))]) {
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
      mkdirSync(dirname(ordinarySettingsPath(physicalSafe)), { mode: 0o700 });
      writeFileSync(ordinarySettingsPath(physicalSafe), settingsBytes, { mode: 0o600 });
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
          createSettingsFileAuthority({ path: ordinarySettingsPath(alias) }).read();
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
      assert.deepEqual(readFileSync(ordinarySettingsPath(physicalSafe)), settingsBytes);
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
        path: ordinarySettingsPath(root),
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
      const stateRoot = join(root, ".tracker");
      const path = ordinarySettingsPath(stateRoot);
      const directory = dirname(path);
      const retained = join(root, "retained");
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

  it("preserves the four DCC3 settings among the catalogued ordinary leaves", () => {
    const patch = {
      ocr: { pageConcurrency: 3, maxValidationRetries: 0 },
      concurrency: { defaultWorkers: 2 },
      paths: { reportsDir: "/tmp/reviewed-reports" },
      browser: { headless: false },
    };
    const parsed = SettingsApplyInputSchema.parse(settingsApplyRequest(SETTINGS_COMMAND_1, 1, patch));
    assert.deepEqual(parsed.patch, settingsOperations(patch));
    const persisted = mergeSettingsPatch({}, parsed.patch);
    const resolved = resolveConfigWithProvenance(persisted, hostConfigFacts({}), CLOCK);
    assert.equal(resolved.config.ocr.pageConcurrency, 3);
    assert.equal(resolved.config.ocr.maxValidationRetries, 0);
    assert.equal(resolved.config.concurrency.defaultWorkers, 2);
    assert.equal(resolved.config.paths.reportsDir, "/tmp/reviewed-reports");
    assert.throws(() => deriveSettingsPatchFingerprint({ "paths.reportsDir": { set: "relative" } }));
    assert.throws(() => deriveSettingsPatchFingerprint({ "ocr.pageConcurrency": { set: -1 } }));
    const root = mkdtempSync(join(tmpdir(), "hrauto-settings-dcc3-roundtrip-"));
    try {
      const authority = createSettingsFileAuthority({ path: ordinarySettingsPath(root) });
      const applied = authority.apply(settingsApplyRequest(SETTINGS_COMMAND_1, 1, patch));
      if (applied.state !== "applied") assert.fail("DCC3 leaves must apply");
      applied.commit();
      assert.deepEqual(authority.read().settings, patch);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("applies closed leaf operations and clears persisted overrides back to defaults", () => {
    assert.throws(() => deriveSettingsPatchFingerprint({ "paths.stateRoot": { set: "/tmp/forbidden" } }));
    assert.doesNotThrow(() => deriveSettingsPatchFingerprint({ "display.screenWidth": { set: 1920 } }));
    assert.doesNotThrow(() => deriveSettingsPatchFingerprint({
      "display.screenWidth": { set: 1920 },
      "display.screenHeight": { set: 1080 },
    }));

    const root = mkdtempSync(join(tmpdir(), "hrauto-settings-clear-"));
    try {
      const authority = createSettingsFileAuthority({ path: ordinarySettingsPath(root) });
      const first = authority.apply(settingsApplyRequest(
        SETTINGS_COMMAND_1,
        1,
        { "actor.label": { set: "Temporary operator" } },
      ));
      assert.equal(first.state, "applied");
      if (first.state !== "applied") return;
      first.commit();
      assert.deepEqual(authority.read().settings, { actor: { label: "Temporary operator" } });

      const clearRequest = settingsApplyRequest(
        SETTINGS_COMMAND_2,
        2,
        { "actor.label": { clear: true } },
      );
      const cleared = authority.apply(clearRequest);
      assert.equal(cleared.state, "applied");
      if (cleared.state !== "applied") return;
      cleared.commit();
      assert.deepEqual(authority.read().settings, {});
      const replay = authority.apply(clearRequest);
      assert.equal(replay.state, "applied");
      assert.equal(replay.record.revision, 3);
      if (replay.state === "applied") replay.rollback();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses old broad-schema and missing-lastApplied envelopes without converting bytes", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-settings-incompatible-"));
    try {
      const path = ordinarySettingsPath(root);
      mkdirSync(dirname(path), { mode: 0o700 });
      createSettingsFileAuthority({ path }).read();
      const settings = { display: { screenWidth: 1920, screenHeight: 1080 } };
      for (const settingsSchemaHash of ["cd3bb6c31ccbfb22293d427de1d166227230fb7b7ac5394d821381cf76123151", SETTINGS_SCHEMA_HASH]) {
        // The broad-hash case has otherwise complete lastApplied evidence; the
        // current-hash case omits ONLY lastApplied. Neither refusal masks the other.
        const lastApplied = settingsSchemaHash === SETTINGS_SCHEMA_HASH ? undefined : {
          commandId: SETTINGS_COMMAND_1,
          commandFingerprint: "a".repeat(64),
          expectedRevision: 1,
          settingsSchemaHash,
          patchFingerprint: deriveSettingsPatchFingerprint(settingsOperations(settings)),
        };
        const bytes = JSON.stringify({ revision: 2, settingsSchemaHash,
          settingsFingerprint: derivePersistedSettingsFingerprint(settings), settings, lastApplied });
        writeFileSync(path, bytes, { mode: 0o600 });
        const authority = createSettingsFileAuthority({ path });
        assert.throws(() => authority.read(), /invalid-value: settings\.json/u);
        assert.equal(readFileSync(path, "utf8"), bytes);
        assert.equal(existsSync(join(dirname(path), "prepare.json")), false);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("P8 rejects protected names and state deployment paths at both settings write boundaries", () => {
    const forbiddenPatches = [
      { operator: { timekeeperName: "request-owned-identity" } },
      { paths: { stateRoot: "/tmp/untrusted-state" } },
      { paths: { artifactRoot: "/tmp/untrusted-artifacts" } },
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
        const path = ordinarySettingsPath(join(root, ".tracker"));
        const afterLockLinked = vi.fn();
        const authority = createSettingsFileAuthority({ path, hooks: { afterLockLinked } });
        const request = SettingsApplyInputSchema.parse(settingsApplyRequest(
          SETTINGS_COMMAND_1, 1, { browser: { headless: false } },
        ));
        const mismatch = field === "settingsSchemaHash"
          ? "a".repeat(64)
          : deriveSettingsPatchFingerprint({ "browser.headless": { set: true } });
        assert.notEqual(mismatch, request[field]);
        const snapshot = () => ({
          entries: readdirSync(root),
          settings: existsSync(path),
          initialization: existsSync(join(dirname(path), "authority.json")),
          lock: existsSync(join(dirname(path), "settings.lock")),
          prepare: existsSync(join(dirname(path), "prepare.json")),
          rollback: existsSync(join(dirname(path), "rollback.json")),
        });
        const pristine = {
          entries: [], settings: false, initialization: false,
          lock: false, prepare: false, rollback: false,
        };
        assert.deepEqual(snapshot(), pristine);

        const outcome = authority.apply({ ...request, [field]: mismatch });

        assert.deepEqual(outcome, {
          state: "rejected",
          code: field === "settingsSchemaHash" ? "schema-mismatch" : "patch-fingerprint-mismatch",
          message: field === "settingsSchemaHash"
            ? "settings.json schema-mismatch"
            : "patch-fingerprint-mismatch: settings patch fingerprint does not match its canonical value",
        });
        assert.equal(Object.isFrozen(outcome), true);
        assert.deepEqual(snapshot(), pristine);
        assert.equal(afterLockLinked.mock.calls.length, 0, "refusal must not even transiently acquire the lock");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it("binds crash-recovery replay to the full canonical settings command envelope", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-settings-command-envelope-"));
    try {
      const path = ordinarySettingsPath(join(root, ".tracker"));
      const patch = { "browser.headless": { set: false } } as const;
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
      }), /command-divergent: settings command .* differs from its persisted canonical envelope/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses to follow a settings-file symbolic link", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-settings-symlink-"));
    try {
      const targetPath = ordinarySettingsPath(join(root, "target"));
      const linkedPath = ordinarySettingsPath(join(root, "linked"));
      const target = createSettingsFileAuthority({ path: targetPath });
      const applied = target.apply(settingsApplyRequest(
        SETTINGS_COMMAND_1,
        1,
        { browser: { headless: false } },
      ));
      assert.equal(applied.state, "applied");
      if (applied.state === "applied") applied.commit();
      mkdirSync(dirname(linkedPath), { recursive: true, mode: 0o700 });
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
      const regularPath = ordinarySettingsPath(join(root, "regular"));
      const regular = createSettingsFileAuthority({ path: regularPath }).apply(settingsApplyRequest(
        SETTINGS_COMMAND_1,
        1,
        { browser: { headless: false } },
      ));
      assert.equal(regular.state, "applied");
      if (regular.state === "applied") regular.commit();
      const hardLinkedPath = ordinarySettingsPath(join(root, "hard-linked"));
      mkdirSync(dirname(hardLinkedPath), { recursive: true, mode: 0o700 });
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

      const directoryPath = ordinarySettingsPath(join(root, "directory"));
      mkdirSync(directoryPath, { recursive: true, mode: 0o700 });
      assert.throws(
        () => createSettingsFileAuthority({ path: directoryPath }).read(),
        /not a regular file/u,
      );

      const oversizedPath = ordinarySettingsPath(join(root, "oversized"));
      mkdirSync(dirname(oversizedPath), { recursive: true, mode: 0o700 });
      writeFileSync(oversizedPath, Buffer.alloc(MAX_SETTINGS_FILE_BYTES + 1), { mode: 0o600 });
      assert.throws(
        () => createSettingsFileAuthority({ path: oversizedPath }).read(),
        /settings\.json .* exceeds maximum 1048576 bytes/u,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects actor metadata that would make the persisted settings file max plus one byte", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-settings-next-bytes-limit-"));
    try {
      const path = ordinarySettingsPath(join(root, ".tracker"));
      const authority = createSettingsFileAuthority({ path });

      assert.throws(
        () => authority.apply(settingsApplyRequest(
          SETTINGS_COMMAND_1,
          1,
          { actor: { label: "a".repeat(1_048_001) } },
        )),
        /document-too-large: settings\.json exceeds its maximum before replacement/u,
      );
      assert.equal(authority.read().revision, 1);
      assert.equal(readdirSync(join(root, ".tracker")).includes("settings.json"), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("persists actor metadata whose canonical settings file is exactly the byte maximum", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-settings-next-bytes-boundary-"));
    try {
      const path = ordinarySettingsPath(join(root, ".tracker"));
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
      const path = ordinarySettingsPath(join(root, ".tracker"));
      const child = crashSettingsAuthorityAtHook(path, "afterLockLinked");
      assert.equal(child.signal, "SIGKILL", child.stderr);

      const recovered = createSettingsFileAuthority({ path }).read();
      assert.equal(recovered.revision, 1);
      assert.deepEqual(
        readdirSync(dirname(path)).sort(),
        ["authority.json", "protected.json", "settings.json"],
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("holds exclusive settings authority until transaction commit or rollback", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-settings-exclusive-"));
    try {
      const path = ordinarySettingsPath(join(root, ".tracker"));
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
          { display: { screenWidth: 1920, screenHeight: 1080 } },
        )),
        /exclusive settings authority/u,
      );

      first.commit();
      const committedBytes = readFileSync(path);
      const second = createSettingsFileAuthority({ path }).apply(settingsApplyRequest(
        SETTINGS_COMMAND_2,
        2,
        { display: { screenWidth: 1920, screenHeight: 1080 } },
      ));
      assert.equal(second.state, "applied");
      if (second.state === "applied") second.rollback();
      assert.deepEqual(readFileSync(path), committedBytes);
      assert.equal(createSettingsFileAuthority({ path }).read().revision, 2);
      assert.equal(readdirSync(dirname(path)).includes("rollback.json"), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("durably prepares exact prior and next settings before the live rename", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-settings-durable-prepare-"));
    try {
      const path = ordinarySettingsPath(join(root, ".tracker"));
      createSettingsFileAuthority({ path }).read();
      const priorSettingsBytes = readFileSync(path);
      const request = settingsApplyRequest(
        SETTINGS_COMMAND_1,
        1,
        { browser: { headless: false } },
      );
      const child = crashSettingsApplyAfterLiveRename(path, request);
      assert.equal(child.signal, "SIGKILL", child.stderr);

      const prepare = JSON.parse(readFileSync(join(dirname(path), "prepare.json"), "utf8")) as Record<string, unknown>;
      assert.deepEqual(prepare.command, {
        commandId: SETTINGS_COMMAND_1,
        commandFingerprint: (request as { commandFingerprint: string }).commandFingerprint,
        expectedRevision: 1,
        settingsSchemaHash: SETTINGS_SCHEMA_HASH,
        patchFingerprint: deriveSettingsPatchFingerprint({ "browser.headless": { set: false } }),
      });
      assert.deepEqual(
        Buffer.from(String(prepare.priorSettingsBytesBase64), "base64"),
        priorSettingsBytes,
      );
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
      const path = ordinarySettingsPath(join(root, ".tracker"));
      createSettingsFileAuthority({ path }).read();
      const priorSettingsBytes = readFileSync(path);
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
      assert.deepEqual(readFileSync(path), priorSettingsBytes);
      assert.equal(existsSync(join(dirname(path), "prepare.json")), false);
      assert.deepEqual(
        readdirSync(dirname(path)).sort(),
        ["authority.json", "protected.json", "settings.json"],
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("serializes stale cleanup through main-lock reacquisition", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-settings-stale-reaper-"));
    try {
      const path = ordinarySettingsPath(join(root, ".tracker"));
      const request = settingsApplyRequest(
        SETTINGS_COMMAND_1,
        1,
        { browser: { headless: false } },
      );
      const moduleUrl = pathToFileURL(join(
        process.cwd(),
        "tests",
        "fixtures",
        "d331-settings-file.ts",
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
                { display: { screenWidth: 1920, screenHeight: 1080 } },
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
      const path = ordinarySettingsPath(join(root, ".tracker"));
      const staleMain = crashSettingsAuthorityAtHook(path, "afterLockLinked");
      assert.equal(staleMain.signal, "SIGKILL", staleMain.stderr);
      const deadReaper = crashSettingsAuthorityAtHook(path, hook);
      assert.equal(deadReaper.signal, "SIGKILL", deadReaper.stderr);

      const recovered = createSettingsFileAuthority({ path }).read();

      assert.equal(recovered.revision, 1);
      assert.deepEqual(
        readdirSync(dirname(path)).sort(),
        ["authority.json", "protected.json", "settings.json"],
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps revision CAS inside the exclusive atomic-replace authority", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-settings-cas-race-"));
    try {
      const path = ordinarySettingsPath(join(root, ".tracker"));
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
                  { display: { screenWidth: 1920, screenHeight: 1080 } },
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
      const path = ordinarySettingsPath(join(root, ".tracker"));
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
        /authority-uncertain: settings\.json presence does not match authority\.json/u,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses a settings replace whose initialization evidence regressed", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-settings-init-recovery-"));
    try {
      const path = ordinarySettingsPath(join(root, ".tracker"));
      const evidencePath = join(dirname(path), "authority.json");
      const authority = createSettingsFileAuthority({ path });
      assert.equal(authority.read().revision, 1);
      const virginEvidence = Buffer.from(`${JSON.stringify(settingsRootAuthority("virgin", "initialized"))}\n`);
      const applied = authority.apply(settingsApplyRequest(
        SETTINGS_COMMAND_1,
        1,
        { browser: { headless: false } },
      ));
      assert.equal(applied.state, "applied");
      if (applied.state !== "applied") return;
      applied.commit();
      const settingsBytes = readFileSync(path);

      writeFileSync(evidencePath, virginEvidence, { mode: 0o600 });
      assert.throws(
        () => createSettingsFileAuthority({ path }).read(),
        /authority-uncertain: settings\.json exists before its revision-1 baseline was initialized/u,
      );
      assert.deepEqual(readFileSync(evidencePath), virginEvidence);
      assert.deepEqual(readFileSync(path), settingsBytes);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails loud after process loss between the rollback sidecar and settings-byte rollback", () => {
      const root = mkdtempSync(join(tmpdir(), "hrauto-settings-rollback-order-"));
    try {
      const path = ordinarySettingsPath(join(root, ".tracker"));
      const request = settingsApplyRequest(
        SETTINGS_COMMAND_1,
        1,
        { browser: { headless: false } },
      );
      const moduleUrl = pathToFileURL(join(
        process.cwd(),
        "tests",
        "fixtures",
        "d331-settings-file.ts",
      )).href;
      const child = spawnSync(process.execPath, [
        "--import",
        "tsx",
        "--input-type=module",
        "--eval",
        `import { renameSync } from "node:fs";
         import { createSettingsFileAuthority } from ${JSON.stringify(moduleUrl)};
         let rollbackArmed = false;
         const authority = createSettingsFileAuthority({
           path: ${JSON.stringify(path)},
           validateCandidate: () => undefined,
           operations: {
             atomicReplace: (source, destination) => {
               renameSync(source, destination);
               if (rollbackArmed && destination === ${JSON.stringify(join(dirname(path), "rollback.json"))}) {
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
        const path = ordinarySettingsPath(join(root, ".tracker"));
        const child = crashFirstUpdateRollbackAtHook(path, hook);
        assert.equal(child.signal, "SIGKILL", `${hook}: ${child.stderr}`);
        assert.match(readFileSync(join(dirname(path), "rollback.json"), "utf8"), /"rollbackId":/u);
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
      const path = ordinarySettingsPath(join(root, ".tracker"));
      const child = crashFirstUpdateRollbackAtHook(path, "afterRollbackCompleted");
      assert.equal(child.signal, "SIGKILL", child.stderr);
      assert.equal(readdirSync(dirname(path)).includes("rollback.json"), false);

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
    const resolved = resolveConfigWithProvenance({
      actor: { label: "Settings actor" },
      urls: { kuali: { prod: { entry: "https://kuali.example.test" } } },
      timeouts: { navigationMs: 12_345 },
      paths: { reportsDir: "/tmp/settings-reports" },
      annualDates: {
        FY2027: {
          jobEndDate: "06/30/2027",
          kronosDefaultEndDate: "06/30/2027",
          kronosDefaultStartDate: "07/01/2026",
        },
      },
      display: { screenWidth: 1920, screenHeight: 1080 },
      performance: { navigationRetries: 3 },
      ocr: { secondOpinionMax: 2 },
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
    }, hostConfigFacts({}), CLOCK);

    for (const path of [
      "actor.label", "urls.kuali.prod.entry", "timeouts.navigationMs", "paths.reportsDir",
      "annualDates.FY2027.jobEndDate", "display.screenWidth",
      "performance.navigationRetries", "ocr.secondOpinionMax",
      "browserHealth.maxAutoRefresh", "browser.headless", "concurrency.defaultWorkers",
      "daemon.idleMs", "features.debugScreenshots", "providers.ocrExtract.timeoutMs",
    ]) {
      assert.equal(resolved.provenance[path], "settings", path);
    }
  });

  it("P4 preserves settings authority on restart under hostile environment names", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-settings-authority-"));
    try {
      const path = ordinarySettingsPath(join(root, ".tracker"));
      const patch = { browser: { headless: false }, display: { screenWidth: 1920, screenHeight: 1080 } } as const;
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
      const resolved = resolveConfigWithProvenance(restarted.settings, hostConfigFacts({ TIMEKEEPER_NAME: "environment-name" }), CLOCK);
      assert.equal(Object.hasOwn(resolved.config, "operator"), false);
      assert.equal(Object.hasOwn(resolved.provenance, "operator.timekeeperName"), false);
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
      const directory = join(root, ".tracker");
      const path = ordinarySettingsPath(directory);
      const initial = createSettingsFileAuthority({ path });
      const firstPatch = { browser: { headless: false } } as const;
      const first = initial.apply(settingsApplyRequest(SETTINGS_COMMAND_1, 1, firstPatch));
      assert.equal(first.state, "applied");
      if (first.state === "applied") first.commit();
      const priorBytes = readFileSync(path);
      const priorEvidenceBytes = readFileSync(join(dirname(path), "authority.json"));
      const nextPatch = { display: { screenWidth: 1920, screenHeight: 1080 } } as const;
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
      assert.deepEqual(readFileSync(join(dirname(path), "authority.json")), priorEvidenceBytes);
      assert.deepEqual(
        readdirSync(dirname(path)).sort(),
        ["authority.json", "protected.json", "settings.json"],
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports failure-integrity inspection errors instead of hiding them", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-settings-failure-inspection-"));
    try {
      const directory = join(root, ".tracker");
      const path = ordinarySettingsPath(directory);
      const authorityDirectory = dirname(path);
      createSettingsFileAuthority({ path }).read();
      let liveReplacementReached = false;
      const authority = createSettingsFileAuthority({
        path,
        operations: {
          atomicReplace: (source, destination) => {
            renameSync(source, destination);
            if (destination === path) liveReplacementReached = true;
          },
          syncPath: (target) => {
            if (!liveReplacementReached || target !== authorityDirectory) return;
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
      const path = ordinarySettingsPath(join(root, ".tracker"));
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      const authority = createSettingsFileAuthority({ path });
      authority.read();

      writeFileSync(path, '{"revision":2', { encoding: "utf8", mode: 0o600 });
      assert.throws(() => authority.read(), /invalid-value: settings\.json is malformed JSON/u);
      writeFileSync(path, '{"revision":2}\n', { encoding: "utf8", mode: 0o600 });
      assert.throws(
        () => authority.read(),
        /invalid-value: settings\.json .* is malformed/u,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("makes empty settings exactly equal schema defaults", () => {
    assert.deepEqual(resolveConfigWithProvenance({}, hostConfigFacts({}), CLOCK).config, ConfigSchema.parse({ paths: defaultRuntimePaths() }));
    assert.equal(resolveConfigWithProvenance({}, hostConfigFacts({}), CLOCK).config.timeouts.ukgNavigationMs, 60_000);
    assert.equal(ConfigSchema.safeParse({ unexpected: true }).success, false);
    assert.equal(ConfigSchema.safeParse({ urls: { unexpected: true } }).success, false);
    assert.equal(SettingsOverrideSchema.safeParse({ urls: { ucpath: { test: { typo: "https://example.test" } } } }).success, false);
    assert.equal(SettingsOverrideSchema.safeParse({ actor: { id: "someone-else" } }).success, false);
    assert.equal(ConfigSchema.safeParse({ actor: { id: "someone-else", label: "Other" } }).success, false);
  });

  it("resolves an admitted storage pair without changing ordinary settings or an older snapshot", () => {
    const settings = { paths: { browserProfileRoot: "/tmp/profile" }, browser: { headless: false } };
    const ordinaryFingerprint = derivePersistedSettingsFingerprint(settings);
    const oldSnapshot = resolveConfigWithProvenance(settings, hostConfigFacts({}), CLOCK);
    const oldConfig = structuredClone(oldSnapshot.config);
    const pair = { stateRoot: "/tmp/relocated-state", artifactRoot: "/tmp/relocated-state/artifacts" };
    const moved = resolveConfigWithProvenance(settings, hostConfigFacts({}), CLOCK, pair);

    assert.equal(moved.config.paths.stateRoot, pair.stateRoot);
    assert.equal(moved.config.paths.artifactRoot, pair.artifactRoot);
    assert.equal(moved.config.paths.browserProfileRoot, "/tmp/profile");
    assert.equal(moved.provenance["paths.stateRoot"], "default");
    assert.equal(moved.provenance["paths.artifactRoot"], "default");
    assert.equal(moved.provenance["paths.browserProfileRoot"], "settings");
    assert.deepEqual(Object.keys(moved.provenance).sort(), [...configLeafPaths(moved.config)].sort());
    assert.notEqual(moved.fingerprint, oldSnapshot.fingerprint);
    assert.deepEqual(oldSnapshot.config, oldConfig);
    assert.equal(derivePersistedSettingsFingerprint(settings), ordinaryFingerprint);
    assert.deepEqual(resolveConfigWithProvenance(settings, hostConfigFacts({}), CLOCK), oldSnapshot);
    assert.deepEqual(resolveConfigWithProvenance(settings, hostConfigFacts({}), CLOCK, pair), moved);
  });

  it("refuses noncanonical or overlapping admitted storage pairs", () => {
    const valid = { stateRoot: "/tmp/state", artifactRoot: "/tmp/state/artifacts" };
    for (const pair of [
      { ...valid, stateRoot: "relative/state" },
      { ...valid, stateRoot: "/tmp/state/../state" },
      { ...valid, artifactRoot: "/tmp//state/artifacts" },
      { ...valid, artifactRoot: "/tmp/state" },
      { ...valid, artifactRoot: "/tmp" },
      { ...valid, extra: "unexpected" },
    ]) {
      assert.throws(() => resolveConfigWithProvenance({}, hostConfigFacts({}), CLOCK, pair), undefined, JSON.stringify(pair));
    }
    assert.equal(resolveConfigWithProvenance({}, hostConfigFacts({}), CLOCK, valid).config.paths.artifactRoot,
      valid.artifactRoot);
  });

  it("accepts complete production route edits and rejects retired test routes", () => {
    const defaults = resolveConfigWithProvenance({}, hostConfigFacts({}), CLOCK).config;
    const crm = { ...defaults.urls.crm.prod, entry: "https://crm.example.test/hr" };
    const patch = { "urls.crm.prod": { set: crm } };
    assert.equal(SettingsPatchSchema.safeParse(patch).success, true);
    const saved = mergeSettingsPatch({}, patch);
    assert.equal(resolveConfigWithProvenance(saved, hostConfigFacts({}), CLOCK).config.urls.crm.prod.entry, crm.entry);
    assert.equal(SettingsPatchSchema.safeParse({ "urls.crm.prod": { set: { entry: crm.entry } } }).success, false);
    assert.equal(SettingsPatchSchema.safeParse({ "urls.crm.test": { set: { entry: crm.entry } } }).success, true);
    assert.throws(() => mergeSettingsPatch({}, { "urls.crm.test": { set: { entry: crm.entry } } }), /retired test routes/u);
  });

  it("reads old saved test URLs without using them and removes them on the next settings write", () => {
    const historical = SettingsOverrideSchema.parse({
      urls: { crm: { test: { entry: "https://retired.example.test/hr" } } },
    });
    const oldFingerprint = derivePersistedSettingsFingerprint(historical);
    assert.match(oldFingerprint, /^[0-9a-f]{64}$/u);
    const resolved = resolveConfigWithProvenance(historical, hostConfigFacts({}), CLOCK);
    assert.equal(Object.hasOwn(resolved.config.urls.crm, "test"), false);
    assert.equal(resolved.config.urls.crm.prod.entry, "https://crm.ucsd.edu/hr");
    const next = mergeSettingsPatch(historical, { "urls.crm.prod": { set: {
      ...resolved.config.urls.crm.prod, entry: "https://new-crm.example.test/hr",
    } } });
    assert.equal(Object.hasOwn(next.urls?.crm ?? {}, "test"), false);
    assert.equal(next.urls?.crm?.prod?.entry, "https://new-crm.example.test/hr");
    const oldCommand = SettingsCommandRequestSchema.safeParse({
      commandId: SETTINGS_COMMAND_1, requestedAt: "2026-08-28T12:00:00.000Z",
      requestedBy: "local-operator", source: "dashboard", family: "settings",
      type: "apply-settings", target: { expectedRevision: 1 },
      payload: { settingsSchemaHash: "a".repeat(64), patchFingerprint: "b".repeat(64),
        patch: { "urls.crm.test": { set: { entry: "https://retired.example.test/hr" } } } },
    });
    assert.equal(oldCommand.success, true);
    assert.equal(SettingsCurrentRecordSchema.safeParse({
      revision: 2, settings: historical, settingsFingerprint: oldFingerprint,
      commandId: SETTINGS_COMMAND_1, commandFingerprint: "c".repeat(64),
      auditId: SETTINGS_COMMAND_2, committedAt: "2026-08-28T12:00:00.000Z",
    }).success, true);
  });

  it("P4/P6/P10 applies settings over defaults with complete value-free provenance", () => {
    const settings = {
      ocr: { secondOpinionMax: 7 },
      timeouts: { ukgNavigationMs: 75_000 },
      urls: { ucpath: { prod: { login: "https://login.example.test", smartHr: "https://settings-ucpath.example.test", jobSummary: "https://jobs.example.test", personalData: "https://personal.example.test", personProfile: "https://profile.example.test" } } },
    };
    const resolved = resolveConfigWithProvenance(settings, hostConfigFacts({}), CLOCK);
    assert.equal(resolved.config.ocr.secondOpinionMax, 7);
    assert.equal(resolved.config.urls.ucpath.prod.smartHr, "https://settings-ucpath.example.test");
    assert.equal(resolved.config.timeouts.ukgNavigationMs, 75_000);
    assert.equal(resolved.provenance["ocr.secondOpinionMax"], "settings");
    assert.equal(resolved.provenance["timeouts.ukgNavigationMs"], "settings");
    assert.equal(resolved.provenance["timeouts.taskMs"], "default");
    assert.equal(Object.hasOwn(resolved.config, "operator"), false);
    assert.deepEqual(Object.keys(resolved.provenance).sort(), [...configLeafPaths(resolved.config)].sort());
    assert.equal(Object.values(resolved.provenance).every((source) => source === "settings" || source === "default"), true);
    assert.match(resolved.fingerprint, /^[0-9a-f]{64}$/u);
    assert.equal(Object.keys(resolved.provenance).length > 70, true);
  });

  it("applies the browser settings group instead of accepting and dropping it", () => {
    const resolved = resolveConfigWithProvenance({
      browser: { headless: false, closeProofMs: 25_000 },
    }, hostConfigFacts({}), CLOCK);

    assert.deepEqual(resolved.config.browser, { headless: false, closeProofMs: 25_000 });
    assert.equal(resolved.provenance["browser.headless"], "settings");
    assert.equal(resolved.provenance["browser.closeProofMs"], "settings");
  });

  it("P37 rejects malformed ordinary values, missing job-end dates and half-display overrides", () => {
    assert.throws(() => resolveConfigWithProvenance({ ocr: { pageConcurrency: "auto" } }, hostConfigFacts({}), CLOCK));
    const jobEndOnly = resolveConfigWithProvenance({ annualDates: { FY2027: { jobEndDate: "06/30/2027" } } }, hostConfigFacts({}), CLOCK).config;
    assert.equal(jobEndOnly.annualDates.FY2027?.jobEndDate, "06/30/2027");
    assert.equal(jobEndOnly.annualDates.FY2027?.kronosDefaultStartDate, undefined);
    assert.equal(jobEndOnly.annualDates.FY2027?.kronosDefaultEndDate, undefined);
    assert.throws(() => resolveConfigWithProvenance({ annualDates: { FY2027: { kronosDefaultEndDate: "06/30/2027" } } }, hostConfigFacts({}), CLOCK));
    assert.throws(() => resolveConfigWithProvenance({ display: { screenWidth: 1920 } }, hostConfigFacts({}), CLOCK));
    assert.throws(() => resolveConfigWithProvenance({ display: { screenHeight: 1080 } }, hostConfigFacts({}), CLOCK));
    const config = resolveConfigWithProvenance({ annualDates: { FY2027: {
      jobEndDate: "06/30/2027", kronosDefaultEndDate: "2/1/2027", kronosDefaultStartDate: "1/1/2017",
    } } }, hostConfigFacts({}), CLOCK).config;
    assert.equal(config.annualDates.FY2027?.jobEndDate, "06/30/2027");
  });

  it("P3 has no environment bindings and refuses any restored binding", () => {
    assert.deepEqual(CONFIG_ENV_BINDINGS, []);
    assert.equal(ConfigEnvBindingRegistrySchema.safeParse([{
      env: "HRAUTO_DEFAULT_WORKERS", path: "concurrency.defaultWorkers", apply: (config: unknown) => config,
    }]).success, false);
  });

  it("P4 ignores every migrated process environment key and rejects the old resolver signature", () => {
    const settings = { concurrency: { defaultWorkers: 2 } };
    const facts = hostConfigFacts({});
    const before = resolveConfigWithProvenance(settings, facts, CLOCK);
    assert.equal(MIGRATED_SETTINGS_ENVIRONMENT_KEYS.length, 50);
    try {
      for (const key of MIGRATED_SETTINGS_ENVIRONMENT_KEYS) vi.stubEnv(key, "hostile-migrated-value");
      assert.deepEqual(resolveConfigWithProvenance(settings, facts, CLOCK), before);
      assert.throws(() => {
        // @ts-expect-error A4: an environment object is no longer the resolver's second input.
        resolveConfigWithProvenance({}, {}, CLOCK);
      }, /primaryDisplay/u);
    } finally {
      vi.unstubAllEnvs();
    }
  });

});

describe("instance and fiscal safety", () => {
  it("defaults declared systems to production and refuses retired test targets", () => {
    const config = resolveConfigWithProvenance({}, hostConfigFacts({}), CLOCK).config;
    assert.deepEqual(resolveInstances(config, ["ucpath", "crm"], undefined, "run-1"), { ucpath: "prod", crm: "prod" });
    assert.throws(() => resolveInstances(config, ["ucpath"], { ucpath: "test" }, "run-1"), /retired test instance/u);
    assert.throws(() => resolveSystemEntryUrl(config, "ucpath", "test", "run-1"), /retired test instance/u);
    assert.equal(resolveSystemEntryUrl(config, "ucpath", "prod", "run-1"), config.urls.ucpath.prod.smartHr);
  });

  it("fails on missing and stale current-fiscal-year values", () => {
    const defaults = resolveConfigWithProvenance({}, hostConfigFacts({}), CLOCK).config;
    assert.throws(() => requireAnnualDates(defaults, CLOCK), /FY2027/);
    const jobEndOnly = resolveConfigWithProvenance({
      annualDates: { FY2027: { jobEndDate: "06/30/2027" } },
    }, hostConfigFacts({}), CLOCK).config;
    assert.deepEqual(requireAnnualDates(jobEndOnly, CLOCK), { jobEndDate: "06/30/2027" });
    const stale = resolveConfigWithProvenance({
      annualDates: { FY2027: {
        jobEndDate: "06/30/2026",
        kronosDefaultEndDate: "2/1/2027",
        kronosDefaultStartDate: "1/1/2017",
      } },
    }, hostConfigFacts({}), CLOCK).config;
    assert.throws(() => requireAnnualDates(stale, CLOCK), /stale/);
    assert.throws(() => assertNotPast("02/30/2027", "badDate", CLOCK), /valid calendar date/);
  });
});
