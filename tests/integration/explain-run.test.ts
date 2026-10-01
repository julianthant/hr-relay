import { TargetNotFoundError } from "../../src/server/failures.js";
/**
 * `explain run` against the real authority database (ref operator-trust §2.5, D143).
 *
 * The command's value is that an operator can paste a trace id from a screen
 * and get every fact ref operator-trust lists — including the ones authority does NOT
 * hold, said out loud. These arms therefore assert the absences as hard as the
 * presences: a section that quietly rendered empty would read as "nothing
 * happened", which is the exact confusion this command exists to remove.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { manualClock } from "../../src/domain/clock.js";
import { AuthorityDatabase } from "../helpers/synthetic-storage-admission.js";
import { explainRunFrom } from "../../src/server/explain/compose.js";
import { renderExplainRun } from "../../src/server/explain/explain-run.js";
import {
  EXIT_RUN_ID,
  EXIT_TRACE_ID,
  seedPersonLookupExitRun,
} from "../fixtures/receipt-run-fixtures.js";

const roots: string[] = [];
const databases: AuthorityDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function seeded(): AuthorityDatabase {
  const root = mkdtempSync(join(tmpdir(), "hrauto-explain-"));
  roots.push(root);
  const database = AuthorityDatabase.open(
    { path: join(root, "state.sqlite"), busyTimeoutMs: 250, migrationOwner: "explain-test" },
    manualClock(new Date("2026-08-04T00:11:13.500Z")),
  );
  databases.push(database);
  seedPersonLookupExitRun(database);
  return database;
}

describe("explain run", () => {
  it("resolves either identity form to the same explanation", () => {
    const database = seeded();
    const byRun = explainRunFrom(database, EXIT_RUN_ID);
    const byTrace = explainRunFrom(database, EXIT_TRACE_ID);
    assert.deepEqual(byTrace, byRun);
    assert.equal(byRun.runId, EXIT_RUN_ID);
    assert.equal(byRun.traceId, EXIT_TRACE_ID);
  });

  it("refuses an identity that is neither form rather than guessing", () => {
    const database = seeded();
    assert.throws(() => explainRunFrom(database, "the-run-i-mean"), /neither a run id .* nor a trace id/s);
    assert.throws(
      () => explainRunFrom(database, "00000000-0000-4000-8000-000000000000"),
      (error: unknown) => error instanceof TargetNotFoundError && /absent from canonical authority/.test(error.message),
    );
  });

  it("resolves the node timeline, checkpoint reuse, and terminal outcome", () => {
    const view = explainRunFrom(seeded(), EXIT_TRACE_ID);

    assert.equal(view.state, "terminal");
    assert.deepEqual(view.outcome, { state: "present", value: "done" });
    assert.equal(view.attempt, 2);

    const timeline = new Map(view.timeline.map((entry) => [entry.nodeId, entry]));
    assert.equal(timeline.get("searching")?.disposition, "replayed-from-checkpoint");
    assert.match(String(timeline.get("searching")?.detail), /attempt 1/);
    assert.equal(timeline.get("cross-verify")?.disposition, "observed-this-attempt");
    assert.equal(timeline.get("active-status")?.disposition, "observed-this-attempt");
    assert.equal(timeline.get("crm-dates")?.disposition, "not-run");
    assert.match(String(timeline.get("crm-dates")?.detail), /condition-false/);

    const reuse = new Map(view.reuse.map((entry) => [entry.nodeId, entry]));
    assert.equal(reuse.get("searching")?.kind, "checkpoint");
    assert.equal(reuse.get("cross-verify")?.kind, "fresh-live");
    assert.ok((reuse.get("searching")?.ageMs ?? 0) > 0);
  });

  it("names every absence instead of rendering an empty section", () => {
    const view = explainRunFrom(seeded(), EXIT_RUN_ID);
    assert.equal(view.failure.state, "absent");
    assert.equal(view.openGate.state, "absent");
    assert.equal(view.openDependency.state, "absent");
    assert.match(view.notifications.reason, /2g slice/);
    assert.equal(view.commandHistory.state, "absent");
    assert.match(view.commandHistory.reason, /indexes commands by id, not by run/);
    assert.deepEqual(view.writes, [], "a read-only workflow fenced no external write");
  });

  it("carries the receipt's verdicts and a concrete next safe action", () => {
    const view = explainRunFrom(seeded(), EXIT_RUN_ID);
    assert.equal(view.receipt.state, "present");
    if (view.receipt.state !== "present") throw new Error("unreachable");
    assert.equal(view.receipt.value.result, "verified-done");
    assert.equal(view.receipt.value.confidence, "verified");
    const mandatory = view.receipt.value.verification.filter((row) => row.mandatory);
    assert.ok(mandatory.length > 0);
    assert.ok(mandatory.every((row) => row.verdict === "verified"), "every mandatory obligation is verified");
    assert.deepEqual(view.receipt.value.warnings, []);
    assert.match(view.nextSafeAction, /Nothing\. This run is settled/);
  });

  it("renders an operator-readable report carrying every ref operator-trust §2.5 section", () => {
    const text = renderExplainRun(explainRunFrom(seeded(), EXIT_TRACE_ID));
    for (const heading of [
      "state", "node timeline", "checkpoint reuse", "subject bindings", "failure",
      "last successful action", "open gate", "open dependency", "command history",
      "notifications", "write intent / proof", "evidence receipt", "next safe action",
    ]) {
      assert.ok(text.includes(`  ${heading}\n`), `report is missing the "${heading}" section`);
    }
    assert.match(text, /run 4ebf7275-.* trace pl-000619-4ebf/);
    assert.match(text, /terminal → done/);
    assert.match(text, /identity\.eid-agrees-across-sources\s+verified/);
    // No credential, cookie, or storage-state canary may reach a terminal.
    for (const canary of ["password", "Cookie", "storageState", "PRIVATE KEY"]) {
      assert.ok(!text.includes(canary), `explain output leaked ${canary}`);
    }
  });
});
