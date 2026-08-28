import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, it } from "vitest";
import { manualClock } from "../../src/domain/clock.js";
import { assertNotPast, requireAnnualDates } from "../../src/domain/config/fiscal-year.js";
import { resolveInstances, resolveSystemEntryUrl } from "../../src/domain/config/instance.js";
import { CONFIG_ENV_BINDINGS, resolveConfig, resolveConfigWithProvenance } from "../../src/domain/config/resolve.js";
import { defaultRuntimePaths } from "../../src/domain/config/runtime-paths.js";
import { ConfigSchema, SettingsOverrideSchema } from "../../src/domain/config/schema.js";
import {
  SETTINGS_SCHEMA_HASH,
  SettingsApplyInputSchema,
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

describe("strict config resolution", () => {
  it("rejects credential paths and environment-owned leaves at both settings write boundaries", () => {
    const forbiddenPatches = [
      { paths: { duoCredential: "/tmp/stolen-duo.json" } },
      { paths: { duoExtensionDir: "/tmp/untrusted-extension" } },
      { operator: { timekeeperName: "request-owned-identity" } },
      { concurrency: { defaultWorkers: 99 } },
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
      }).read();

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
