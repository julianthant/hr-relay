// Session replacement is authored or identity-forced and requires proven closure before opening.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, it } from "vitest";
import { manualClock } from "../../../src/rules/time/clock.js";
import { FingerprintSchema } from "../../../src/rules/identity/ids.js";
import type { WorkerSessionEvent } from "../../../src/backend/runtime/workers/worker-sessions.js";
import { REPO_ROOT, walkFiles } from "../support/helpers/guard-files.js";
import {
  healthyUcpathDriver,
  sessionFactoryHarness,
  sessionManagerFor,
} from "../../support/helpers/phase1f-executor-harness.js";
import { QUEUED_RUN } from "../../support/fixtures/phase1f-run-fixtures.js";

const RUN_FINGERPRINT = FingerprintSchema.parse(QUEUED_RUN.envelope.configFingerprint);
const OTHER_FINGERPRINT = FingerprintSchema.parse("9".repeat(64));
const UCPATH_REUSE = { system: "ucpath", access: "read", session: "reuse-worker" } as const;
const SIGNAL = new AbortController().signal;

/** The closed set of modules allowed to name the boundary close reason. */
const BOUNDARY_REASON_OWNERS = new Set([
  "src/workflow-kit/session.ts",
  "src/backend/runtime/workers/worker-sessions.ts",
  "src/backend/runtime/workers/worker-loop.ts",
]);

function sourceFiles(): readonly { path: string; content: string }[] {
  return walkFiles(join(REPO_ROOT, "src"), { extensions: [".ts", ".tsx"] })
    .map((file) => ({
      path: relative(REPO_ROOT, file).replaceAll("\\", "/"),
      content: readFileSync(file, "utf8"),
    }));
}


function computedSessionFields(): readonly string[] {
  const violations: string[] = [];
  for (const { path, content } of sourceFiles()) {
    if (!/^src\/(?:stores\/[a-z0-9-]+\/tasks|backend\/workflow-tasks\/[a-z0-9-]+\/tasks|workflows)\//u.test(path)) continue;
    const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAssignment(node)
        && ts.isIdentifier(node.name)
        && node.name.text === "session"
        && !ts.isStringLiteralLike(node.initializer)) {
        violations.push(`${path}: session need is computed, not authored`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return violations;
}

describe("fresh session boundary", () => {
  it("keeps the boundary close reason inside the session-ownership modules", () => {
    const violations = sourceFiles()
      .filter(({ path, content }) =>
        content.includes("\"fresh-boundary\"") && !BOUNDARY_REASON_OWNERS.has(path))
      .map(({ path }) => path);
    assert.deepEqual(violations, [], "a boundary was minted outside worker session ownership");
    const manager = readFileSync(join(REPO_ROOT, "src/backend/runtime/workers/worker-sessions.ts"), "utf8");
    assert.match(
      manager,
      /need\.session === "fresh"/u,
      "the authored-fresh branch must exist for the scans above to mean anything",
    );
    const resetCallers = sourceFiles()
      .filter(({ content }) => content.includes("\"profile-reset\""))
      .map(({ path }) => path)
      .sort();
    assert.deepEqual(resetCallers, [
      "src/backend/runtime/browser/browser-session-factory.ts",
      "src/backend/runtime/browser/native-profile-probe.ts",
      "src/workflow-kit/session.ts",
    ]);
    const loop = readFileSync(join(REPO_ROOT, "src/backend/runtime/workers/worker-loop.ts"), "utf8");
    assert.doesNotMatch(loop, /profile-reset/u);
    assert.match(loop, /event\.reason === "fresh-boundary"/u);
  });

  it("authors every session need as a literal, never a computed one", () => {
    assert.deepEqual(computedSessionFields(), []);
    // Negative control: the same audit on a synthetic computed need must fail.
    const synthetic = ts.createSourceFile(
      "src/backend/systems/ucpath/tasks/bad.ts",
      "export const t = { sessions: [{ system: \"ucpath\", session: attempt > 1 ? \"fresh\" : \"reuse-worker\" }] };",
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    let caught = false;
    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)
        && node.name.text === "session" && !ts.isStringLiteralLike(node.initializer)) caught = true;
      ts.forEachChild(node, visit);
    };
    visit(synthetic);
    assert.equal(caught, true, "the computed-session audit must catch a computed need");
  });

  it("never mints a boundary for repeated reuse-worker needs", async () => {
    const harness = sessionFactoryHarness({ ucpath: () => healthyUcpathDriver() });
    const events: WorkerSessionEvent[] = [];
    const sessions = await sessionManagerFor(
      harness,
      manualClock(new Date("2026-08-03T09:00:00.000Z")),
      (event) => events.push(event),
    );
    for (let lease = 0; lease < 3; lease += 1) {
      await sessions.withDriver(UCPATH_REUSE, "prod", SIGNAL, async () => lease);
    }
    assert.equal(harness.opens("ucpath"), 1, "reuse must not reopen");
    assert.deepEqual(harness.closeReasons(), [], "reuse must not close");
    assert.deepEqual(
      events.filter((event) => event.type === "browser-session:close"),
      [],
      "no boundary may be inferred from repetition",
    );
  });

  it("closes with proof before the replacement starts on an authored fresh need", async () => {
    const harness = sessionFactoryHarness({ ucpath: () => healthyUcpathDriver() });
    const events: WorkerSessionEvent[] = [];
    const sessions = await sessionManagerFor(
      harness,
      manualClock(new Date("2026-08-03T09:00:00.000Z")),
      (event) => events.push(event),
    );
    await sessions.withDriver(UCPATH_REUSE, "prod", SIGNAL, async () => "first");
    await sessions.withDriver({ ...UCPATH_REUSE, session: "fresh" }, "prod", SIGNAL, async () => "second");

    assert.deepEqual(
      harness.trace().map((entry) => entry.kind),
      ["open", "close", "open"],
      "the old resource must be closed BEFORE the replacement is opened",
    );
    assert.deepEqual(harness.closeReasons(), ["fresh-boundary"]);
    const [firstOpen, close, secondOpen] = harness.trace();
    assert.equal(close?.kind === "close" ? close.sessionId : undefined, firstOpen?.sessionId);
    assert.notEqual(secondOpen?.sessionId, firstOpen?.sessionId);

    const observed = events.filter((event) => event.type !== "browser-session:reset");
    assert.deepEqual(observed.map((event) => event.type), [
      "browser-session:start",
      "browser-session:close",
      "browser-session:start",
    ], "close must be emitted between the two starts");
  });

  it("forces the same proven boundary when the reuse identity drifts", async () => {
    const harness = sessionFactoryHarness({ ucpath: () => healthyUcpathDriver() });
    const events: WorkerSessionEvent[] = [];
    const sessions = await sessionManagerFor(
      harness,
      manualClock(new Date("2026-08-03T09:00:00.000Z")),
      (event) => events.push(event),
    );
    await sessions.withDriver(UCPATH_REUSE, "prod", SIGNAL, async () => "first-run");
    assert.equal(RUN_FINGERPRINT === OTHER_FINGERPRINT, false);
    sessions.releaseRunConfigFingerprint();
    sessions.bindRunConfigFingerprint(OTHER_FINGERPRINT);
    await sessions.withDriver(UCPATH_REUSE, "prod", SIGNAL, async () => "second-run");

    assert.deepEqual(harness.trace().map((entry) => entry.kind), ["open", "close", "open"]);
    assert.deepEqual(harness.closeReasons(), ["fresh-boundary"]);
    assert.equal(harness.logins(), 2, "the replacement must authenticate for itself");
    assert.deepEqual(
      events.filter((event) => event.type !== "browser-session:reset").map((event) => event.type),
      ["browser-session:start", "browser-session:close", "browser-session:start"],
    );
  });
});
