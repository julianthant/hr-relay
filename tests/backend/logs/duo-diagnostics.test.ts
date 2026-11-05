import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";
import { appendDuoDiagnostic, DuoDiagnosticLogError } from "../../../src/backend/logs/duo-diagnostics.js";

it("writes only closed diagnostic fields and omits correlation identifiers", () => {
  const root = mkdtempSync(join(tmpdir(), "relay duo log "));
  const now = new Date("2026-11-04T00:00:00Z");
  try {
    appendDuoDiagnostic(root, now, { stage: "refused", code: "ONBOARDING_DUO_SCOPE", detail: "scope",
      requestId: "00000000-0000-4000-8000-000000000001", durationMs: 12 });
    for (const key of ["password", "privateKey", "email", "profileId", "message", "cause", "url"]) {
      assert.throws(() => appendDuoDiagnostic(root, now, { stage: "refused", [key]: "sensitive-value" }), DuoDiagnosticLogError);
    }
    assert.throws(() => appendDuoDiagnostic(root, now, { stage: "refused", exceptionType: "person@example.edu" }), DuoDiagnosticLogError);
    const content = readFileSync(join(root, "logs", "duo.jsonl"), "utf8");
    if (process.platform !== "win32") {
      assert.equal(statSync(join(root, "logs")).mode & 0o777, 0o700);
      assert.equal(statSync(join(root, "logs", "duo.jsonl")).mode & 0o777, 0o600);
    }
    assert.deepEqual(JSON.parse(content), { at: now.toISOString(), stage: "refused", detail: "scope", code: "ONBOARDING_DUO_SCOPE", durationMs: 12 });
    assert.doesNotMatch(content, /sensitive-value|00000000|person@example/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("rotates within one MiB and continues writing the newest timings", () => {
  const root = mkdtempSync(join(tmpdir(), "relay duo log "));
  try {
    for (let durationMs = 0; durationMs < 9000; durationMs++) appendDuoDiagnostic(root, new Date("2026-11-04T00:00:00Z"), {
      stage: "slow-operation", code: "ONBOARDING_DUO_SLOW_OPERATION", operation: "broker-request", durationMs,
    });
    const directory = join(root, "logs"), files = readdirSync(directory);
    assert.equal(files.length, 4);
    assert.ok(files.reduce((sum, name) => sum + statSync(join(directory, name)).size, 0) <= 1024 * 1024);
    const current = readFileSync(join(directory, "duo.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line) as { durationMs: number });
    assert.equal(current.at(-1)?.durationMs, 8999);
    assert.ok(!files.some(name => readFileSync(join(directory, name), "utf8").includes('"durationMs":0}')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
