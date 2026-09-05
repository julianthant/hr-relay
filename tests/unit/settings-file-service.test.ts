import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { resolveConfig } from "../../src/domain/config/resolve.js";
import { manualClock } from "../../src/domain/clock.js";
import {
  CURRENT_SETTINGS_SCHEMA_HASH,
  deriveSettingsPatchFingerprint,
} from "../../src/domain/config/settings.js";
import {
  createSettingsFileAuthority,
  type SettingsFileOperations,
} from "../../src/infra/config/settings-file.js";

const roots: string[] = [];
let commandSequence = 0;

function settingsPath(): string {
  const root = mkdtempSync(join(tmpdir(), "hrauto-settings-file-"));
  roots.push(root);
  return join(root, ".tracker", "settings.json");
}

function createTestService(options: Readonly<{
  path: string;
  operations?: SettingsFileOperations;
}>): ReturnType<typeof createSettingsFileAuthority> {
  return createSettingsFileAuthority({
    ...options,
    validateCandidate: (settings) => { resolveConfig({}, settings, manualClock(new Date("2026-08-30T12:00:00.000Z"))); },
  });
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
  const outcome = service.apply({
    commandId,
    commandFingerprint,
    expectedRevision,
    settingsSchemaHash: CURRENT_SETTINGS_SCHEMA_HASH,
    patchFingerprint: deriveSettingsPatchFingerprint(patch),
    patch,
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

  it("deep-merges successive patches into one strict revisioned record", () => {
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
        ucPathEntrySheet: "https://crm-test.example.test",
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
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{\"revision\":", { flag: "wx", mode: 0o600 });
    const service = createTestService({ path });

    assert.throws(() => service.read(), /JSON/);
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
    assert.equal(existsSync(`${path}.prepare.json`), true);
    assert.equal(existsSync(`${path}.lock`), true);
    assert.throws(() => service.read(), /held by live pid/);
  });
});
