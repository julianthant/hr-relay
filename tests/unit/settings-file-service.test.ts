import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { hostConfigFacts } from "../../src/domain/config/host-display.js";
import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { resolveConfigWithProvenance } from "../../src/domain/config/resolve.js";
import {
  PROTECTED_SETTINGS_SCHEMA_HASH,
  PROTECTED_SETTINGS_SET_MARKER,
  ProtectedSettingsReadbackSchema,
  markProtectedSettingsPatch,
  protectedSettingsReadback,
} from "../../src/domain/config/protected-settings.js";
import {
  SettingsRootAuthoritySchema,
  settingsRootPaths,
} from "../../src/domain/config/settings-root.js";
import { manualClock } from "../../src/domain/clock.js";
import { canonicalJsonStringify } from "../../src/domain/canonical-json.js";
import {
  CURRENT_SETTINGS_SCHEMA_HASH,
  SettingsApplyRejectionCodeSchema,
  deriveSettingsPatchFingerprint,
} from "../../src/domain/config/settings.js";
import {
  createSettingsFileAuthority,
  createProtectedSettingsFileAuthority,
  type SettingsFileOperations,
} from "../../src/infra/config/settings-file.js";
import { sha256Hex } from "../../src/domain/sha256.js";
import { settingsSetOperations } from "./fixtures/settings-operation-fixtures.js";

const roots: string[] = [];
let commandSequence = 0;

function settingsPath(): string {
  const root = mkdtempSync(join(tmpdir(), "hrauto-settings-file-"));
  roots.push(root);
  return join(root, ".tracker", "settings", "settings.json");
}

function createTestService(options: Readonly<{
  path: string;
  operations?: SettingsFileOperations;
}>): ReturnType<typeof createSettingsFileAuthority> {
  return createSettingsFileAuthority({
    ...options,
    validateCandidate: (settings) => { resolveConfigWithProvenance(settings, hostConfigFacts({}), manualClock(new Date("2026-08-30T12:00:00.000Z"))); },
  });
}

function rawPatchFingerprint(patch: unknown): string {
  return sha256Hex(`hrauto:settings-patch:v2\0${canonicalJsonStringify(patch)}`);
}

function apply(
  service: ReturnType<typeof createSettingsFileAuthority>,
  expectedRevision: number,
  patch: unknown,
) {
  commandSequence += 1;
  const tail = String(commandSequence).padStart(12, "0");
  const commandId = `99999999-9999-4999-8999-${tail}`;
  const commandFingerprint = "9".repeat(64);
  const operations = settingsSetOperations(patch);
  const outcome = service.apply({
    commandId,
    commandFingerprint,
    expectedRevision,
    settingsSchemaHash: CURRENT_SETTINGS_SCHEMA_HASH,
    patchFingerprint: deriveSettingsPatchFingerprint(operations),
    patch: operations,
  });
  if (outcome.state === "applied") outcome.commit();
  return outcome;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("baseline atomic Settings invariants on the single file authority", () => {
  it("refuses an incomplete annual-date candidate before creating the settings authority", () => {
    const path = settingsPath();
    const service = createTestService({ path });

    assert.throws(
      () => apply(service, 1, { annualDates: { FY2027: { jobEndDate: "06/30/2027" } } }),
      /annualDates/,
    );
    assert.equal(existsSync(path), false);
    assert.equal(service.read().revision, 1);
  });

  it("preserves untouched catalog leaves while replacing one catalog leaf", () => {
    const path = settingsPath();
    const service = createTestService({ path });
    assert.equal(apply(service, 1, {
      browser: { headless: false },
      urls: { crm: { test: { ucPathEntrySheet: "https://crm-test.example.test" } } },
    }).state, "applied");

    const second = apply(service, 2, {
      browser: { closeProofMs: 25_000 },
      urls: { crm: { test: { onboardingSearch: "https://crm-search.example.test" } } },
    });

    assert.equal(second.state, "applied");
    assert.deepEqual(service.read().settings, {
      browser: { headless: false, closeProofMs: 25_000 },
      urls: { crm: { test: {
        onboardingSearch: "https://crm-search.example.test",
      } } },
    });
    assert.equal(service.read().revision, 3);
  });

  it("refuses a stale revision without changing the persisted bytes", () => {
    const path = settingsPath();
    const service = createTestService({ path });
    assert.equal(apply(service, 1, { browser: { headless: false } }).state, "applied");
    const before = readFileSync(path);

    const stale = apply(service, 1, { concurrency: { defaultWorkers: 3 } });

    assert.equal(stale.state, "conflict");
    if (stale.state === "conflict") assert.equal(stale.currentRevision, 2);
    assert.deepEqual(readFileSync(path), before);
  });

  it("refuses malformed JSON instead of treating it as empty settings", () => {
    const path = settingsPath();
    const service = createTestService({ path });
    assert.equal(apply(service, 1, { browser: { headless: false } }).state, "applied");
    writeFileSync(path, "{malformed", { mode: 0o600 });
    assert.throws(() => service.read(), /invalid-value: settings.json is malformed JSON/u);
  });

  it("refuses a valid JSON record whose content fingerprint was corrupted", () => {
    const path = settingsPath();
    const service = createTestService({ path });
    assert.equal(apply(service, 1, { browser: { headless: false } }).state, "applied");
    const record = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    writeFileSync(path, JSON.stringify({ ...record, settingsFingerprint: "a".repeat(64) }), "utf8");

    assert.throws(() => service.read(), /settingsFingerprint|strict persisted settings contract/);
  });

  it("cleans a partially staged temp file and preserves the prior live bytes", () => {
    const path = settingsPath();
    const initial = createTestService({ path });
    assert.equal(apply(initial, 1, { browser: { headless: false } }).state, "applied");
    const before = readFileSync(path);
    const service = createTestService({
      path,
      operations: {
        writeExclusive: (temporaryPath, bytes) => {
          if (!(basename(temporaryPath).startsWith(".settings.json.") && !basename(temporaryPath).startsWith(".settings.json.authority.") && !basename(temporaryPath).startsWith(".settings.json.prepare."))) {
            writeFileSync(temporaryPath, bytes, { flag: "wx", mode: 0o600 });
            return;
          }
          writeFileSync(temporaryPath, bytes.slice(0, 12), { flag: "wx", mode: 0o600 });
          throw new Error("injected partial staging failure");
        },
      },
    });

    assert.throws(
      () => apply(service, 2, { concurrency: { defaultWorkers: 2 } }),
      /could not stage a complete durable replacement/,
    );
    assert.deepEqual(readFileSync(path), before);
    assert.deepEqual(readdirSync(dirname(path)).filter((name) => name.endsWith(".tmp")), []);
  });

  it("refuses to overwrite live bytes that change while a complete patch is staging", () => {
    const path = settingsPath();
    const initial = createTestService({ path });
    assert.equal(apply(initial, 1, { browser: { headless: false } }).state, "applied");
    const externallyChanged = "external concurrent edit\n";
    const service = createTestService({
      path,
      operations: {
        writeExclusive: (temporaryPath, bytes) => {
          writeFileSync(temporaryPath, bytes, { flag: "wx", mode: 0o600 });
          if (basename(temporaryPath).startsWith(".settings.json.") && !basename(temporaryPath).startsWith(".settings.json.authority.") && !basename(temporaryPath).startsWith(".settings.json.prepare.")) writeFileSync(path, externallyChanged);
        },
      },
    });

    assert.throws(
      () => apply(service, 2, { concurrency: { defaultWorkers: 2 } }),
      /live bytes changed before replacement/,
    );
    assert.equal(readFileSync(path, "utf8"), externallyChanged);
    assert.deepEqual(readdirSync(dirname(path)).filter((name) => name.endsWith(".tmp")), []);
  });

  it("reconciles an atomic replace that took effect before rename reported failure", () => {
    const path = settingsPath();
    const service = createTestService({
      path,
      operations: {
        atomicReplace: (source, destination) => {
          renameSync(source, destination);
          throw new Error("injected post-replace report failure");
        },
        syncPath: () => undefined,
      },
    });

    const outcome = apply(service, 1, { browser: { headless: false } });

    assert.equal(outcome.state, "applied");
    assert.equal(service.read().revision, 2);
    assert.deepEqual(service.read().settings, { browser: { headless: false } });
  });

  it("retains exclusive recovery evidence when directory fsync fails after replacement", () => {
    const path = settingsPath();
    const directory = dirname(path);
    let failedDirectorySync = false;
    const service = createTestService({
      path,
      operations: {
        syncPath: (candidate) => {
          if (candidate === directory && existsSync(path) && !failedDirectorySync) {
            failedDirectorySync = true;
            throw new Error("injected directory fsync failure");
          }
        },
      },
    });

    assert.throws(
      () => apply(service, 1, { browser: { headless: false } }),
      /directory fsync failed/,
    );
    assert.equal(existsSync(path), true);
    assert.equal(existsSync(join(dirname(path), "prepare.json")), true);
    assert.equal(existsSync(join(dirname(path), "settings.lock")), true);
    assert.throws(() => service.read(), /held by live pid/);
  });
});


describe("D331 shared settings root", () => {
  it("closes the settings rejection vocabulary exactly", () => {
    assert.deepEqual(SettingsApplyRejectionCodeSchema.options, [
      "schema-mismatch",
      "patch-fingerprint-mismatch",
      "envelope-fingerprint-mismatch",
      "not-editable",
      "invalid-value",
      "cross-field-invalid",
      "document-too-large",
      "authority-unjournaled",
      "authority-uncertain",
      "directory-integrity",
      "lock-unavailable",
      "command-divergent",
      "write-id-reused",
    ]);
  });

  function protectedRequest(expectedRevision = 1, value = "synthetic-protected-value") {
    return {
      commandId: randomUUID(), commandFingerprint: "a".repeat(64), expectedRevision,
      protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, writeId: randomUUID(),
      entries: { ucpathPassword: { set: value } }, updatedAt: "2026-09-04T12:00:00.000Z",
    };
  }

  it("P7/P21 canonicalizes every protected set to the one journal marker", () => {
    const firstValue = "first-synthetic-value";
    const secondValue = "second-distinct-value";
    const first = markProtectedSettingsPatch({
      ucpathPassword: { set: firstValue },
      timekeeperName: { clear: true },
    });
    const second = markProtectedSettingsPatch({
      ucpathPassword: { set: secondValue },
      timekeeperName: { clear: true },
    });

    assert.deepEqual(first, second);
    assert.deepEqual(first, {
      ucpathPassword: { set: PROTECTED_SETTINGS_SET_MARKER },
      timekeeperName: { clear: true },
    });
    const journalBytes = canonicalJsonStringify(first);
    assert.equal(journalBytes.includes(firstValue), false);
    assert.equal(journalBytes.includes(secondValue), false);
    assert.equal(journalBytes.includes(sha256Hex(firstValue)), false);
  });

  it("P8/P28 refuses a protected ordinary key before creating authority state", () => {
    const path = settingsPath();
    const service = createTestService({ path });
    const patch = { ucpathPassword: { set: "must-not-enter-settings-json" } };

    assert.throws(() => service.apply({
      commandId: randomUUID(),
      commandFingerprint: "8".repeat(64),
      expectedRevision: 1,
      settingsSchemaHash: CURRENT_SETTINGS_SCHEMA_HASH,
      patchFingerprint: rawPatchFingerprint(patch),
      patch,
    }), /not-editable \{ key: ucpathPassword \}/u);
    assert.equal(existsSync(dirname(path)), false);
  });

  it("P12 keeps protected readback exhaustive, presence-only, and strict", () => {
    const path = settingsPath();
    const store = createProtectedSettingsFileAuthority({ path, assertWriteIdAvailable: () => undefined });
    const result = store.apply(protectedRequest());
    if (result.state !== "applied") assert.fail("expected protected update");
    result.commit();
    const readback = protectedSettingsReadback(result.record);

    assert.equal(Object.keys(readback.entries).length, 7);
    assert.deepEqual(readback.entries.ucpathPassword, {
      present: true,
      valueId: result.record.entries.ucpathPassword?.valueId,
      updatedAt: result.record.entries.ucpathPassword?.updatedAt,
    });
    assert.throws(() => ProtectedSettingsReadbackSchema.parse({
      ...readback,
      effectiveValue: "forbidden",
    }), /unrecognized/i);
    assert.throws(() => ProtectedSettingsReadbackSchema.parse({
      ...readback,
      entries: {
        ...readback.entries,
        ucpathPassword: { ...readback.entries.ucpathPassword, last4: "alue" },
      },
    }), /unrecognized/i);
  });

  it("P23 enforces private files, hard-link count, ancestry, and bound directory identity", () => {
    const permissionPath = settingsPath();
    const permissionStore = createProtectedSettingsFileAuthority({
      path: permissionPath,
      assertWriteIdAvailable: () => undefined,
    });
    const permissionUpdate = permissionStore.apply(protectedRequest());
    if (permissionUpdate.state !== "applied") assert.fail("expected protected update");
    permissionUpdate.commit();
    chmodSync(join(dirname(permissionPath), "protected.json"), 0o640);
    assert.throws(() => permissionStore.read(), /protected\.json permissions are 640; exactly 600 is required/u);

    const hardLinkPath = settingsPath();
    const hardLinkStore = createProtectedSettingsFileAuthority({
      path: hardLinkPath,
      assertWriteIdAvailable: () => undefined,
    });
    const hardLinkUpdate = hardLinkStore.apply(protectedRequest());
    if (hardLinkUpdate.state !== "applied") assert.fail("expected protected update");
    hardLinkUpdate.commit();
    linkSync(join(dirname(hardLinkPath), "protected.json"), join(dirname(dirname(dirname(hardLinkPath))), "protected-link.json"));
    assert.throws(() => hardLinkStore.read(), /protected\.json has 2 hard links/u);

    const identityPath = settingsPath();
    const identityStore = createProtectedSettingsFileAuthority({
      path: identityPath,
      assertWriteIdAvailable: () => undefined,
    });
    identityStore.read();
    const authorityRoot = dirname(identityPath);
    renameSync(authorityRoot, `${authorityRoot}-replaced`);
    mkdirSync(authorityRoot, { mode: 0o700 });
    assert.throws(() => identityStore.read(), /changed pathname identity/u);

    const symlinkBase = mkdtempSync(join(tmpdir(), "hrauto-settings-symlink-"));
    roots.push(symlinkBase);
    mkdirSync(join(symlinkBase, "target"), { mode: 0o700 });
    symlinkSync("target", join(symlinkBase, ".tracker"));
    const symlinkPath = join(symlinkBase, ".tracker", "settings", "settings.json");
    assert.throws(() => createTestService({ path: symlinkPath }).read(), /symbolic link/u);
  });

  it("P27 derives the single root and returns independent revision-1 baselines", () => {
    const stateRoot = mkdtempSync(join(tmpdir(), "hrauto-settings-root-"));
    roots.push(stateRoot);
    const paths = settingsRootPaths(stateRoot);
    assert.equal(paths.root, join(stateRoot, "settings"));
    const ordinary = createTestService({ path: paths.ordinary });
    const protectedStore = createProtectedSettingsFileAuthority({
      path: paths.ordinary,
      assertWriteIdAvailable: () => undefined,
    });
    assert.equal(ordinary.read().revision, 1);
    assert.equal(protectedStore.read().revision, 1);
    assert.deepEqual(protectedSettingsReadback(protectedStore.read()).entries.ucpathPassword, { present: false });
  });

  it("P28 performs request-only schema, fingerprint, and value refusals before authority access", () => {
    const schemaPath = settingsPath();
    const ordinary = createTestService({ path: schemaPath });
    const patch = settingsSetOperations({ browser: { headless: false } });
    const mismatch = ordinary.apply({
      commandId: randomUUID(), commandFingerprint: "8".repeat(64), expectedRevision: 1,
      settingsSchemaHash: "0".repeat(64), patchFingerprint: rawPatchFingerprint(patch), patch,
    });
    assert.equal(mismatch.state, "rejected");
    if (mismatch.state === "rejected") assert.equal(mismatch.code, "schema-mismatch");
    assert.equal(existsSync(dirname(schemaPath)), false);

    const fingerprintPath = settingsPath();
    const fingerprintMismatch = createTestService({ path: fingerprintPath }).apply({
      commandId: randomUUID(), commandFingerprint: "8".repeat(64), expectedRevision: 1,
      settingsSchemaHash: CURRENT_SETTINGS_SCHEMA_HASH, patchFingerprint: "0".repeat(64), patch,
    });
    assert.equal(fingerprintMismatch.state, "rejected");
    if (fingerprintMismatch.state === "rejected") {
      assert.equal(fingerprintMismatch.code, "patch-fingerprint-mismatch");
    }
    assert.equal(existsSync(dirname(fingerprintPath)), false);

    const invalidPath = settingsPath();
    const protectedStore = createProtectedSettingsFileAuthority({
      path: invalidPath,
      assertWriteIdAvailable: () => assert.fail("request-only refusal reached journal authority"),
    });
    assert.throws(() => protectedStore.apply(protectedRequest(1, "")), /invalid-value \{ key: ucpathPassword\.set \}/u);
    assert.equal(existsSync(dirname(invalidPath)), false);
  });

  it("P24 holds one lock across ordinary/protected apply and commit", () => {
    const path = settingsPath();
    const ordinary = createTestService({ path });
    const protectedStore = createProtectedSettingsFileAuthority({ path, assertWriteIdAvailable: () => undefined });
    const update = protectedStore.apply(protectedRequest());
    assert.equal(update.state, "applied");
    assert.deepEqual(readdirSync(dirname(path)).filter((name) => name.includes("lock")), ["settings.lock"]);
    assert.throws(() => ordinary.read(), /live pid|already held|exclusive/u);
    assert.equal(update.state, "applied");
    if (update.state !== "applied") assert.fail("expected protected update");
    update.commit();
    assert.equal(ordinary.read().revision, 1);
    assert.equal(apply(ordinary, 1, { browser: { headless: false } }).state, "applied");
    assert.equal(protectedStore.read().revision, 2);
    assert.deepEqual(readdirSync(dirname(path)).sort(), ["authority.json", "protected.json", "settings.json"]);
  });

  it("P24 admits an active writer's staging name only long enough to report the shared lock", () => {
    const path = settingsPath();
    const contender = createProtectedSettingsFileAuthority({
      path,
      assertWriteIdAvailable: () => undefined,
    });
    let contentionObserved = false;
    const winner = createTestService({
      path,
      operations: {
        writeExclusive: (temporaryPath, bytes) => {
          writeFileSync(temporaryPath, bytes, { flag: "wx", mode: 0o600 });
          if (basename(temporaryPath).startsWith(".settings.json.")) {
            assert.throws(() => contender.read(), /exclusive settings authority/u);
            contentionObserved = true;
          }
        },
      },
    });

    assert.equal(apply(winner, 1, { browser: { headless: false } }).state, "applied");
    assert.equal(contentionObserved, true);
  });

  it("P22/P29 compares exact replay values inside the held shared lock and rejects divergence", () => {
    const path = settingsPath();
    let uniquenessChecks = 0;
    const store = createProtectedSettingsFileAuthority({ path, assertWriteIdAvailable: () => { uniquenessChecks += 1; } });
    const request = protectedRequest();
    const first = store.apply(request);
    if (first.state !== "applied") assert.fail("expected first update");
    first.commit();
    const persisted = readFileSync(join(dirname(path), "protected.json"));
    const replay = store.apply(request);
    if (replay.state !== "applied") assert.fail("expected exact replay");
    assert.equal(existsSync(join(dirname(path), "settings.lock")), true);
    assert.deepEqual(replay.record, first.record);
    replay.commit();
    assert.throws(() => store.apply({ ...request, entries: { ucpathPassword: { set: "divergent" } } }), /command-divergent/u);
    assert.equal(uniquenessChecks, 1);
    assert.deepEqual(store.read(), first.record);
    assert.deepEqual(readFileSync(join(dirname(path), "protected.json")), persisted);
  });

  it("P15 keeps authority tuple identical across different protected values and never retains digests", () => {
    const authorityBytes: string[] = [];
    for (const value of ["first-synthetic-value", "second-distinct-value"]) {
      const path = settingsPath();
      const store = createProtectedSettingsFileAuthority({ path, assertWriteIdAvailable: () => undefined });
      const result = store.apply(protectedRequest(1, value));
      if (result.state !== "applied") assert.fail("expected update");
      result.commit();
      const bytes = readFileSync(join(dirname(path), "authority.json"), "utf8");
      SettingsRootAuthoritySchema.parse(JSON.parse(bytes));
      authorityBytes.push(bytes);
      assert.deepEqual(Object.keys(result.record.entries.ucpathPassword ?? {}).sort(), ["updatedAt", "value", "valueId"]);
      assert.equal(JSON.stringify(protectedSettingsReadback(result.record)).includes(value), false);
    }
    assert.equal(authorityBytes[0], authorityBytes[1]);
  });

  it("P25 retains exact target/document/authority bytes and restores both on rollback", () => {
    const path = settingsPath();
    const store = createProtectedSettingsFileAuthority({ path, assertWriteIdAvailable: () => undefined });
    store.read();
    const prior = readFileSync(join(dirname(path), "authority.json"));
    const result = store.apply(protectedRequest());
    if (result.state !== "applied") assert.fail("expected update");
    const prepare = z.strictObject({
      schemaVersion: z.literal(1), target: z.literal("protected"), prepareId: z.uuid(),
      settingsPathFingerprint: z.string(),
      command: z.strictObject({ commandId: z.uuid(), commandFingerprint: z.string(), expectedRevision: z.number(), protectedSchemaHash: z.string(), writeId: z.uuid() }),
      priorInitializationBytesBase64: z.string(), nextInitializationBytesBase64: z.string(),
      priorSettingsBytesBase64: z.string().nullable(), nextSettingsBytesBase64: z.string(),
    }).parse(JSON.parse(readFileSync(join(dirname(path), "prepare.json"), "utf8")));
    assert.equal(prepare.target, "protected");
    assert.deepEqual(Buffer.from(prepare.priorInitializationBytesBase64, "base64"), prior);
    assert.deepEqual(Buffer.from(prepare.nextSettingsBytesBase64, "base64"), readFileSync(join(dirname(path), "protected.json")));
    assert.equal(prepare.priorSettingsBytesBase64, null);
    result.rollback();
    assert.deepEqual(readFileSync(join(dirname(path), "authority.json")), prior);
    assert.equal(existsSync(join(dirname(path), "protected.json")), false);
    assert.deepEqual(readdirSync(dirname(path)), ["authority.json"]);
    assert.equal(store.read().revision, 1);
  });

  it("P23 rejects an unexplained entry before it acquires the root lock", () => {
    const path = settingsPath();
    const store = createProtectedSettingsFileAuthority({ path, assertWriteIdAvailable: () => undefined });
    store.read();
    writeFileSync(join(dirname(path), ".protected.json.crashed.tmp"), "unknown", { mode: 0o600 });
    assert.throws(() => store.read(), /directory-integrity: unexpected settings entry .protected.json.crashed.tmp/u);
    assert.equal(existsSync(join(dirname(path), "settings.lock")), false);
  });

  it("P27 refuses missing initialized documents by name and keeps protected absence distinct", () => {
    const path = settingsPath();
    const store = createProtectedSettingsFileAuthority({ path, assertWriteIdAvailable: () => undefined });
    assert.deepEqual(store.read().entries, {});
    const update = store.apply(protectedRequest());
    if (update.state !== "applied") assert.fail("expected update");
    update.commit();
    rmSync(join(dirname(path), "protected.json"));
    assert.throws(() => store.read(), /authority-uncertain: protected.json presence/u);
    assert.throws(() => createTestService({ path }).read(), /authority-uncertain: protected.json presence/u);
  });

  it("P29/P31 applies CAS before writeId uniqueness, rotates valueId, and journals clear", () => {
    const path = settingsPath();
    const seen = new Set<string>();
    const store = createProtectedSettingsFileAuthority({ path, assertWriteIdAvailable: (writeId) => {
      if (seen.has(writeId)) throw new Error("write-id-reused");
      seen.add(writeId);
    } });
    const request = protectedRequest();
    const first = store.apply(request);
    if (first.state !== "applied") assert.fail("expected first update");
    first.commit();
    assert.equal(store.apply({ ...request, commandId: randomUUID() }).state, "conflict");
    assert.throws(() => store.apply({ ...request, commandId: randomUUID(), expectedRevision: 2 }), /write-id-reused/u);
    const second = store.apply(protectedRequest(2));
    if (second.state !== "applied") assert.fail("expected second update");
    second.commit();
    assert.equal(second.record.revision, 3);
    assert.notEqual(second.record.entries.ucpathPassword?.valueId, first.record.entries.ucpathPassword?.valueId);

    const cleared = store.apply({
      ...protectedRequest(3),
      entries: { ucpathPassword: { clear: true } },
    });
    if (cleared.state !== "applied") assert.fail("expected clear update");
    cleared.commit();
    assert.equal(cleared.record.revision, 4);
    assert.equal(cleared.record.entries.ucpathPassword, undefined);
    assert.deepEqual(protectedSettingsReadback(cleared.record).entries.ucpathPassword, { present: false });
    assert.equal(cleared.record.lastApplied?.expectedRevision, 3);
  });

  it("P30 refuses oversized candidates and unjournaled authority without changing prior bytes", () => {
    const oversizedPath = settingsPath();
    const oversized = createTestService({ path: oversizedPath });
    oversized.read();
    const authorityBefore = readFileSync(join(dirname(oversizedPath), "authority.json"));
    const patch = {
      urls: { kuali: { test: { entry: `https://example.test/${"a".repeat(1_048_576)}` } } },
    };
    const operations = settingsSetOperations(patch);
    assert.throws(() => oversized.apply({
      commandId: randomUUID(), commandFingerprint: "7".repeat(64), expectedRevision: 1,
      settingsSchemaHash: CURRENT_SETTINGS_SCHEMA_HASH,
      patchFingerprint: rawPatchFingerprint(operations),
      patch: operations,
    }), /document-too-large: settings\.json/u);
    assert.equal(existsSync(oversizedPath), false);
    assert.deepEqual(readFileSync(join(dirname(oversizedPath), "authority.json")), authorityBefore);

    const unjournaledPath = settingsPath();
    const unjournaled = createTestService({ path: unjournaledPath });
    assert.equal(apply(unjournaled, 1, { browser: { headless: false } }).state, "applied");
    rmSync(join(dirname(unjournaledPath), "authority.json"));
    assert.throws(() => unjournaled.read(), /authority-unjournaled/u);
  });
});


describe("D331 process-loss recovery for both document targets", () => {
  function crashRequest(target: "ordinary" | "protected", expectedRevision: number): unknown {
    if (target === "ordinary") {
      const patch = settingsSetOperations({ browser: { headless: expectedRevision === 1 ? false : true } });
      return {
        commandId: randomUUID(), commandFingerprint: "d".repeat(64), expectedRevision,
        settingsSchemaHash: CURRENT_SETTINGS_SCHEMA_HASH,
        patchFingerprint: deriveSettingsPatchFingerprint(patch), patch,
      };
    }
    return {
      commandId: randomUUID(), commandFingerprint: "e".repeat(64), expectedRevision,
      protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, writeId: randomUUID(),
      entries: { ucpathPassword: { set: `synthetic-crash-proof-${String(expectedRevision)}` } },
      updatedAt: "2026-09-04T12:00:00.000Z",
    };
  }

  function crashBeforeAtomicReplace(options: Readonly<{
    path: string;
    target: "ordinary" | "protected";
    request?: unknown;
    destination: "authority.json" | "prepare.json" | "rollback.json" | "settings.json" | "protected.json";
    occurrence?: number;
    action: "read" | "apply" | "rollback";
  }>) {
    const moduleUrl = pathToFileURL(join(process.cwd(), "src/infra/config/settings-file.ts")).href;
    const factory = options.target === "ordinary" ? "createSettingsFileAuthority" : "createProtectedSettingsFileAuthority";
    return spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", `
      import { writeFileSync } from "node:fs";
      import { basename } from "node:path";
      import { ${factory} } from ${JSON.stringify(moduleUrl)};
      let matchingWrites = 0;
      const authority = ${factory}({
        path: ${JSON.stringify(options.path)}, validateCandidate: () => undefined, assertWriteIdAvailable: () => undefined,
        operations: { writeExclusive: (destination, bytes) => {
          writeFileSync(destination, bytes, { flag: "wx", mode: 0o600 });
          if (basename(destination).startsWith(${JSON.stringify(`.${options.destination}.`)})) {
            matchingWrites += 1;
            if (matchingWrites === ${String(options.occurrence ?? 1)}) process.kill(process.pid, "SIGKILL");
          }
        } },
      });
      if (${JSON.stringify(options.action)} === "read") authority.read();
      else {
        const result = authority.apply(${JSON.stringify(options.request)});
        if (result.state !== "applied") process.exit(2);
        if (${JSON.stringify(options.action)} === "rollback") result.rollback();
      }
      process.exit(3);
    `], { encoding: "utf8" });
  }

  it("P25 removes an exact crash-left virgin authority temporary only after stale-lock recovery", () => {
    const path = settingsPath();
    const child = crashBeforeAtomicReplace({
      path, target: "ordinary", destination: "authority.json", action: "read",
    });
    assert.equal(child.signal, "SIGKILL", child.stderr);
    assert.match(
      readdirSync(dirname(path)).find((name) => name.startsWith(".authority.json.")) ?? "",
      /^\.authority\.json\.\d+\.\d+\.tmp$/u,
    );

    assert.equal(createTestService({ path }).read().revision, 1);
    assert.deepEqual(readdirSync(dirname(path)), ["authority.json"]);
  });

  it("P23 refuses a crash-left temporary whose exact staged bytes changed", () => {
    const path = settingsPath();
    const authority = createTestService({ path });
    authority.read();
    const child = crashBeforeAtomicReplace({
      path,
      target: "ordinary",
      request: crashRequest("ordinary", 1),
      destination: "settings.json",
      action: "apply",
    });
    assert.equal(child.signal, "SIGKILL", child.stderr);
    const temporaryName = readdirSync(dirname(path)).find((name) => name.startsWith(".settings.json."));
    if (temporaryName === undefined) assert.fail("expected crash-left settings temporary");
    writeFileSync(join(dirname(path), temporaryName), "changed", { mode: 0o600 });

    assert.throws(
      () => authority.pendingTarget(),
      new RegExp(`directory-integrity: unexpected settings entry ${temporaryName}`, "u"),
    );
  });

  for (const target of ["ordinary", "protected"] as const) {
    for (const scenario of [
      { destination: "prepare.json", occurrence: 1, action: "apply", seeded: false },
      { destination: target === "ordinary" ? "settings.json" : "protected.json", occurrence: 1, action: "apply", seeded: false },
      { destination: "authority.json", occurrence: 1, action: "apply", seeded: false },
      { destination: "rollback.json", occurrence: 1, action: "rollback", seeded: false },
      { destination: "authority.json", occurrence: 2, action: "rollback", seeded: false },
      { destination: target === "ordinary" ? "settings.json" : "protected.json", occurrence: 2, action: "rollback", seeded: true },
    ] as const) {
      it(`P25 ${target} recovers its exact ${scenario.destination} temporary before rename (${scenario.action} ${String(scenario.occurrence)})`, () => {
        const path = settingsPath();
        const ordinary = createTestService({ path });
        ordinary.read();
        const targetAuthority = target === "ordinary"
          ? ordinary
          : createProtectedSettingsFileAuthority({ path, assertWriteIdAvailable: () => undefined });
        if (scenario.seeded) {
          const seeded = targetAuthority.apply(crashRequest(target, 1));
          if (seeded.state !== "applied") assert.fail("expected seed update");
          seeded.commit();
        }
        const root = dirname(path);
        const authorityBefore = readFileSync(join(root, "authority.json"));
        const targetPath = join(root, target === "ordinary" ? "settings.json" : "protected.json");
        const documentBefore = existsSync(targetPath) ? readFileSync(targetPath) : undefined;
        const child = crashBeforeAtomicReplace({
          path,
          target,
          request: crashRequest(target, scenario.seeded ? 2 : 1),
          destination: scenario.destination,
          occurrence: scenario.occurrence,
          action: scenario.action,
        });
        assert.equal(child.signal, "SIGKILL", child.stderr);
        assert.equal(
          readdirSync(root).filter((name) => /^\.(?:settings|protected|authority|prepare|rollback)\.json\.\d+\.\d+\.tmp$/u.test(name)).length,
          1,
        );

        const pending = ordinary.pendingTarget();
        assert.equal(pending, scenario.destination === "prepare.json" ? undefined : target);
        const recovered = pending === undefined
          ? targetAuthority.read()
          : targetAuthority.reconcile(() => "rollback");
        assert.equal(recovered.revision, scenario.seeded ? 2 : 1);
        assert.deepEqual(readFileSync(join(root, "authority.json")), authorityBefore);
        assert.deepEqual(existsSync(targetPath) ? readFileSync(targetPath) : undefined, documentBefore);
        assert.deepEqual(
          readdirSync(root).filter((name) => name.endsWith(".tmp") || name === "settings.lock" || name === "prepare.json" || name === "rollback.json"),
          [],
        );
      });
    }
  }

  for (const target of ["ordinary", "protected"] as const) {
    for (const crashStage of ["prepare.json", "document", "authority.json", "afterRollbackPrepared", "afterRollbackSettingsRestored", "afterRollbackInitializationRestored"] as const) {
      it(`P25 ${target} preserves exact prior bytes after death at ${crashStage}`, () => {
        const path = settingsPath();
        const ordinary = createTestService({ path });
        ordinary.read();
        const authorityBefore = readFileSync(join(dirname(path), "authority.json"));
        const ordinaryPatch = settingsSetOperations({ browser: { headless: false } });
        const request = target === "ordinary" ? {
          commandId: randomUUID(), commandFingerprint: "b".repeat(64), expectedRevision: 1,
          settingsSchemaHash: CURRENT_SETTINGS_SCHEMA_HASH,
          patchFingerprint: deriveSettingsPatchFingerprint(ordinaryPatch),
          patch: ordinaryPatch,
        } : {
          commandId: randomUUID(), commandFingerprint: "c".repeat(64), expectedRevision: 1,
          protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, writeId: randomUUID(),
          entries: { ucpathPassword: { set: "synthetic-crash-proof" } }, updatedAt: "2026-09-04T12:00:00.000Z",
        };
        const fileName = target === "ordinary" ? "settings.json" : "protected.json";
        const killDestination = crashStage === "document" ? fileName : crashStage;
        const moduleUrl = pathToFileURL(join(process.cwd(), "src/infra/config/settings-file.ts")).href;
        const factory = target === "ordinary" ? "createSettingsFileAuthority" : "createProtectedSettingsFileAuthority";
        const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", `
          import { renameSync } from "node:fs";
          import { basename } from "node:path";
          import { ${factory} } from ${JSON.stringify(moduleUrl)};
          const authority = ${factory}({
            path: ${JSON.stringify(path)}, validateCandidate: () => undefined, assertWriteIdAvailable: () => undefined,
            hooks: { [${JSON.stringify(crashStage)}]: () => process.kill(process.pid, "SIGKILL") },
            operations: { atomicReplace: (source, destination) => {
              renameSync(source, destination);
              if (basename(destination) === ${JSON.stringify(killDestination)}) process.kill(process.pid, "SIGKILL");
            } },
          });
          const result = authority.apply(${JSON.stringify(request)});
          if (result.state !== "applied") process.exit(2);
          result.rollback();
        `], { encoding: "utf8" });
        assert.equal(child.signal, "SIGKILL", child.stderr);
        assert.equal(ordinary.pendingTarget(), target);
        assert.throws(() => ordinary.read(), /interrupted settings prepare|interrupted settings rollback/u);
        const recovered = target === "ordinary"
          ? ordinary.reconcile(() => "rollback")
          : createProtectedSettingsFileAuthority({ path, assertWriteIdAvailable: () => undefined }).reconcile(() => "rollback");
        assert.equal(recovered.revision, 1);
        assert.deepEqual(readFileSync(join(dirname(path), "authority.json")), authorityBefore);
        assert.equal(existsSync(join(dirname(path), fileName)), false);
        assert.deepEqual(readdirSync(dirname(path)), ["authority.json"]);
        assert.equal(ordinary.pendingTarget(), undefined);
      });
    }
  }
});
