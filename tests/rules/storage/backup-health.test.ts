import { describe, expect, it } from "vitest";
import { backupHealthOf, type VerifiedRestoreCandidate } from "../../../src/rules/storage/backup-health.js";
import type { RestoreCandidate } from "../../../src/models/storage/storage-status.js";

const verified = (gap: VerifiedRestoreCandidate["generationGap"]): VerifiedRestoreCandidate => ({
  state: "verified-compatible",
  selection: "single-database",
  schemaVersion: 29,
  restoreEligibility: { state: "eligible" },
  manifestFileName: "authority-1.sqlite.manifest.json",
  backupFileName: "authority-1.sqlite",
  createdAt: "2026-11-17T00:00:00.000Z",
  authorityGeneration: 4,
  ageMs: 1500,
  generationGap: gap,
});
const invalid: RestoreCandidate = { state: "invalid", manifestFileName: "authority-2.sqlite.manifest.json",
  cause: { code: "backup-invalid", summary: "synthetic newest candidate cause" } };
const current = verified({ state: "known", value: 0 });
const behind = verified({ state: "known", value: 3 });
const unknownGap = verified({ state: "unavailable", reason: "live authority generation is unavailable" });
const facts = { inspectionFailed: false, directoryName: "authority" } as const;

describe("backup health derivation (design machine 3)", () => {
  it("reports an unavailable candidate inspection as invalid, whatever the candidates say", () => {
    expect(backupHealthOf({ ...facts, inspectionFailed: true, newest: current, latestVerified: current, manifestCount: 1 })).toEqual({
      state: "invalid", cause: { code: "backup-invalid", summary: "Backup directory inspection is unavailable; no restore selection can be established." },
    });
  });

  it("forwards the newest candidate's own cause when it is invalid, even beside an older verified backup", () => {
    expect(backupHealthOf({ ...facts, newest: invalid, latestVerified: current, manifestCount: 2 })).toEqual({
      state: "invalid", cause: { code: "backup-invalid", summary: "synthetic newest candidate cause" },
    });
  });

  it("reports no manifests as missing", () => {
    expect(backupHealthOf({ ...facts, newest: undefined, latestVerified: undefined, manifestCount: 0 })).toEqual({
      state: "missing", cause: { code: "backup-missing", summary: "no authority backup manifests exist in authority" },
    });
  });

  it("reports manifests with none verified as invalid", () => {
    expect(backupHealthOf({ ...facts, newest: undefined, latestVerified: undefined, manifestCount: 2 })).toEqual({
      state: "invalid", cause: { code: "backup-invalid", summary: "no verified compatible authority backup exists in authority" },
    });
  });

  it("reports a known generation gap above zero as stale", () => {
    expect(backupHealthOf({ ...facts, newest: behind, latestVerified: behind, manifestCount: 1 })).toEqual({
      state: "stale", latest: behind,
      cause: { code: "backup-stale", summary: "latest verified backup is 1500ms old with authority generation gap 3" },
    });
  });

  it.each([["a zero gap", current], ["an unavailable gap", unknownGap]])("reports %s as current", (_label, latest) => {
    expect(backupHealthOf({ ...facts, newest: latest, latestVerified: latest, manifestCount: 1 })).toEqual({ state: "current", latest });
  });
});
