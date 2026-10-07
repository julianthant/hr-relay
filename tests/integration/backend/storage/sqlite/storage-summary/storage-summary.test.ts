/**
 * 2i-D: the cheap backup indicator (`summarizeBackupHealth`) against REAL
 * manifests written by the REAL backup service — the write-time-verified
 * manifest is exactly what the summary trusts, so the test writes one the
 * production way instead of hand-forging JSON.
 *
 * current = fresh by age AND no authority-generation gap; any gap or age
 * beyond the bound reads stale; no usable manifest reads missing — including
 * a manifest that no longer parses, because the summary's closed enum has no
 * invalid arm and "missing" is its fail-safe reading (the full doctor names
 * the corruption precisely).
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { manualClock } from "../../../../../../src/rules/time/clock.js";
import {
  AuthorityBackupService,
  AuthorityDatabase,
  summarizeBackupHealth,
} from "../../../../../support/helpers/synthetic-storage-admission.js";
import { NOW, UUID_7 } from "../../../../../support/fixtures/phase1c-contract-fixtures.js";
import { initializeSyntheticSettingsBackupRoot } from "../../../../../support/helpers/integration/settings-backup-fixture.js";

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

const MAX_AGE_MS = 45 * 60 * 1000;

function world() {
  const clock = manualClock(new Date(NOW));
  const root = mkdtempSync(join(tmpdir(), "hrauto-backup-summary-"));
  disposers.push(() => rmSync(root, { recursive: true, force: true }));
  const database = AuthorityDatabase.open(
    { path: join(root, "state.db"), busyTimeoutMs: 1000, migrationOwner: "summary-test" },
    clock,
  );
  disposers.push(() => database.close());
  const directory = join(root, "backups", "authority");
  initializeSyntheticSettingsBackupRoot(root);
  const service = new AuthorityBackupService(database, { directory }, clock);
  const options = { backupDirectory: directory, maxBackupAgeMs: MAX_AGE_MS };
  return { clock, database, directory, service, options };
}

function dirtyAuthority(database: AuthorityDatabase): number {
  database.authority.notifications.create({
    notificationId: UUID_7,
    actorId: "local-operator",
    dedupeFingerprint: "f".repeat(64),
    trigger: "failed",
    channel: "ping",
    status: "unread",
    snooze: { state: "not-snoozed" },
    title: "Run failed",
    summary: "a generation-bumping durable write",
    links: [{ kind: "run", runId: "00010001-0001-4001-8001-000100010001" }],
    count: 1,
    lastSeenAt: NOW,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
  });
  return database.getMeta().authorityGeneration;
}

describe("summarizeBackupHealth", () => {
  it("reads missing with no directory, and current right after a real verified backup", async () => {
    const w = world();
    assert.equal(summarizeBackupHealth(w.options, w.database.getMeta().authorityGeneration, w.clock), "missing");

    await w.service.request({ trigger: "interval", requiredGeneration: w.database.getMeta().authorityGeneration });
    assert.equal(summarizeBackupHealth(w.options, w.database.getMeta().authorityGeneration, w.clock), "current");
  });

  it("reads stale on ANY authority-generation gap, and current again after the next backup", async () => {
    const w = world();
    await w.service.request({ trigger: "interval", requiredGeneration: w.database.getMeta().authorityGeneration });

    const generation = dirtyAuthority(w.database);
    assert.equal(summarizeBackupHealth(w.options, generation, w.clock), "stale");

    w.clock.advanceWall(60_000);
    await w.service.request({ trigger: "interval", requiredGeneration: generation });
    assert.equal(summarizeBackupHealth(w.options, w.database.getMeta().authorityGeneration, w.clock), "current");
  });

  it("reads stale past the age bound even with no gap, and judges by age alone when the live generation is unknown", async () => {
    const w = world();
    await w.service.request({ trigger: "interval", requiredGeneration: w.database.getMeta().authorityGeneration });

    w.clock.advanceWall(MAX_AGE_MS + 1);
    assert.equal(summarizeBackupHealth(w.options, w.database.getMeta().authorityGeneration, w.clock), "stale");

    // Authority unavailable (undefined generation): the fresh-age arm still
    // answers — the summary's documented degraded contract.
    const fresh = world();
    await fresh.service.request({ trigger: "interval", requiredGeneration: fresh.database.getMeta().authorityGeneration });
    assert.equal(summarizeBackupHealth(fresh.options, undefined, fresh.clock), "current");
  });

  it("treats an unparseable manifest as no usable backup — missing, never a guessed state", () => {
    const w = world();
    mkdirSync(w.directory, { recursive: true });
    writeFileSync(join(w.directory, "authority-1.manifest.json"), "{ not json");
    assert.equal(summarizeBackupHealth(w.options, w.database.getMeta().authorityGeneration, w.clock), "missing");
  });
});
