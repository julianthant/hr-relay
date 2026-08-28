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
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "vitest";
import {
  CURRENT_SETTINGS_SCHEMA_HASH,
  deriveSettingsPatchFingerprint,
} from "../../src/domain/config/settings.js";
import { createSettingsFileService } from "../../src/server/settings/settings-file-service.js";

const roots: string[] = [];

function settingsPath(): string {
  const root = mkdtempSync(join(tmpdir(), "hrauto-settings-file-"));
  roots.push(root);
  return join(root, "config", "settings.json");
}

function apply(
  service: ReturnType<typeof createSettingsFileService>,
  expectedRevision: number,
  patch: unknown,
) {
  return service.apply({
    expectedRevision,
    settingsSchemaHash: CURRENT_SETTINGS_SCHEMA_HASH,
    patchFingerprint: deriveSettingsPatchFingerprint(patch),
    patch,
  });
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("atomic settings-file service", () => {
  it("refuses an incomplete annual-date candidate before creating the settings authority", () => {
    const path = settingsPath();
    const service = createSettingsFileService({ path });

    assert.throws(
      () => apply(service, 1, { annualDates: { FY2027: { jobEndDate: "06/30/2027" } } }),
      /annualDates/,
    );
    assert.equal(existsSync(path), false);
    assert.equal(service.read().revision, 1);
  });

  it("refuses forwarded capture without its paired URL before changing bytes or revision", () => {
    const path = settingsPath();
    const service = createSettingsFileService({ path });
    assert.equal(apply(service, 1, { browser: { headless: false } }).state, "applied");
    const before = readFileSync(path);

    assert.throws(
      () => apply(service, 2, { capture: { ingress: "forwarded" } }),
      /forwarded ingress requires forwardedUrl/,
    );
    assert.deepEqual(readFileSync(path), before);
    assert.equal(service.read().revision, 2);
  });

  it("deep-merges successive patches into one strict revisioned record", () => {
    const path = settingsPath();
    const service = createSettingsFileService({ path });
    assert.equal(apply(service, 1, {
      browser: { headless: false },
      urls: { crm: { test: { entry: "https://crm-test.example.test" } } },
    }).state, "applied");

    const second = apply(service, 2, {
      browser: { closeProofMs: 25_000 },
      urls: { crm: { test: { onboardingSearch: "https://crm-search.example.test" } } },
    });

    assert.equal(second.state, "applied");
    assert.deepEqual(service.read().settings, {
      browser: { headless: false, closeProofMs: 25_000 },
      urls: { crm: { test: {
        entry: "https://crm-test.example.test",
        onboardingSearch: "https://crm-search.example.test",
      } } },
    });
    assert.equal(service.read().revision, 3);
  });

  it("refuses a stale revision without changing the persisted bytes", () => {
    const path = settingsPath();
    const service = createSettingsFileService({ path });
    assert.equal(apply(service, 1, { browser: { headless: false } }).state, "applied");
    const before = readFileSync(path);

    const stale = apply(service, 1, { concurrency: { defaultWorkers: 3 } });

    assert.deepEqual(stale, { state: "conflict", currentRevision: 2 });
    assert.deepEqual(readFileSync(path), before);
  });

  it("refuses malformed JSON instead of treating it as empty settings", () => {
    const path = settingsPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{\"revision\":", { encoding: "utf8", flag: "wx" });
    const service = createSettingsFileService({ path });

    assert.throws(() => service.read(), /is not valid JSON/);
  });

  it("refuses a valid JSON record whose content fingerprint was corrupted", () => {
    const path = settingsPath();
    const service = createSettingsFileService({ path });
    assert.equal(apply(service, 1, { browser: { headless: false } }).state, "applied");
    const record = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    writeFileSync(path, JSON.stringify({ ...record, settingsFingerprint: "a".repeat(64) }), "utf8");

    assert.throws(() => service.read(), /strict persisted settings contract/);
  });

  it("cleans a partially staged temp file and preserves the prior live bytes", () => {
    const path = settingsPath();
    const initial = createSettingsFileService({ path });
    assert.equal(apply(initial, 1, { browser: { headless: false } }).state, "applied");
    const before = readFileSync(path);
    const service = createSettingsFileService({
      path,
      operations: {
        writeExclusive: (temporaryPath, bytes) => {
          writeFileSync(temporaryPath, bytes.slice(0, 12), { encoding: "utf8", flag: "wx" });
          throw new Error("injected partial staging failure");
        },
      },
    });

    assert.throws(
      () => apply(service, 2, { concurrency: { defaultWorkers: 2 } }),
      /could not stage a complete durable apply/,
    );
    assert.deepEqual(readFileSync(path), before);
    assert.deepEqual(readdirSync(dirname(path)).filter((name) => name.endsWith(".tmp")), []);
  });

  it("refuses to overwrite live bytes that change while a complete patch is staging", () => {
    const path = settingsPath();
    const initial = createSettingsFileService({ path });
    assert.equal(apply(initial, 1, { browser: { headless: false } }).state, "applied");
    const externallyChanged = "external concurrent edit\n";
    const service = createSettingsFileService({
      path,
      operations: {
        writeExclusive: (temporaryPath, bytes) => {
          writeFileSync(temporaryPath, bytes, { encoding: "utf8", flag: "wx" });
          writeFileSync(path, externallyChanged);
        },
      },
    });

    assert.throws(
      () => apply(service, 2, { concurrency: { defaultWorkers: 2 } }),
      /matches neither the prior nor staged bytes; outcome is uncertain/,
    );
    assert.equal(readFileSync(path, "utf8"), externallyChanged);
    assert.deepEqual(readdirSync(dirname(path)).filter((name) => name.endsWith(".tmp")), []);
  });

  it("reconciles an atomic replace that took effect before rename reported failure", () => {
    const path = settingsPath();
    const service = createSettingsFileService({
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

  it("restores the prior state when directory fsync fails after replacement", () => {
    const path = settingsPath();
    const directory = dirname(path);
    let failedDirectorySync = false;
    const service = createSettingsFileService({
      path,
      operations: {
        syncPath: (candidate) => {
          if (candidate === directory && !failedDirectorySync) {
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
    assert.equal(existsSync(path), false);
    assert.equal(service.read().revision, 1);
    assert.deepEqual(service.read().settings, {});
  });
});
