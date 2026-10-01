import { testRunLifecycle } from "../../../fixtures/run-lifecycle-fixtures.js";
/**
 * Executable scenarios for `person-lookup` — the T1a half of this workflow's
 * canonical pair (ref guards-and-tests §10.3 · §10.9).
 *
 * ONE collected structural scenario per workflow, at
 * `tests/scenario/workflows/<workflow-id>/structural.scenario.test.ts`, no
 * browser, claiming every scenario id the manifest registers for this workflow.
 * The **T1b** half is the sibling `dry-run.scenario.ts` — D318's `live-read`
 * arm, because this graph carries ZERO transaction nodes — which no vitest
 * project may collect and which the last `it` in this file proves stayed
 * uncollected.
 *
 * This file is the merge of the two root-level files it replaces
 * (`tests/scenario/person-lookup.scenario.test.ts` and
 * `tests/scenario/person-lookup-runtime.scenario.test.ts`, retired 2026-09-02):
 * every `it` they carried survives here unchanged, under the same scenario id.
 *
 * Three kinds of arm:
 *
 * - **Pure graph walks** run the real descriptor's real `bind`/`when`/`derive`
 *   functions along one path, re-parsing every value through the schema that
 *   owns it. They falsify the PATH — that its decisions typecheck, parse, and
 *   produce the terminal value the workflow claims.
 * - **Runtime walks** run the REAL task implementations and the REAL driver
 *   interpreters against deterministic fakes, because a subject-mismatch
 *   refusal is observable as "it refused" rather than "it returned something
 *   plausible" only when the real implementation runs.
 * - **Recovery walks** (D314) drive the REAL interpreter over a REAL authority
 *   database, which is the only way to say anything about which node re-read
 *   and which replayed: the claim is a `run_checkpoints` row, not a log line.
 *
 * `person-lookup` declares no branch, gate, delegation or transaction, so it
 * derives ZERO graph coverage points and `PERSON_LOOKUP_CLAIMS` is correctly
 * empty. That is the right answer for this graph, not a pass by absence — the
 * coverage rule itself is proven against `fixtureDescriptor`.
 *
 * **Every subject value here is SYNTHETIC** (ref guards-and-tests §10.3): the
 * `10800000` / `10800001` EIDs, which no live system resolves from this file. A
 * real person's identifier is a dry-run fact, lives in the target registry, and
 * is reached by LABEL through the sibling manifest.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { afterEach, describe, it } from "vitest";
import { ReadOnboardingDatesOutputSchema } from "../../../../src/domain/contracts/crm/read-onboarding-dates.js";
import { ReadOnboardingRecordOutputSchema } from "../../../../src/domain/contracts/crm/read-onboarding-record.js";
import { EidSchema } from "../../../../src/domain/ids.js";
import { directIdentifierDisplay } from "../../../../src/domain/redaction.js";
import { DataPointSchema } from "../../../../src/domain/task-provenance.js";
import type { DataPoint } from "../../../../src/domain/task-provenance.js";
import { createDeterministicCrmOnboardingDriver } from "../../../../src/stores/crm/driver/fake.js";
import { chooseExactCrmRecord } from "../../../../src/stores/crm/driver/interpreter.js";
import { readOnboardingDatesTask } from "../../../../src/stores/crm/tasks/read-onboarding-dates.js";
import { readOnboardingRecordTask } from "../../../../src/stores/crm/tasks/read-onboarding-record.js";
import {
  parsePersonOrgGridRows,
  searchPersonOrgWithPagePort,
} from "../../../../src/stores/ucpath/driver/person-org-operation.js";
import type {
  PersonOrgDetail,
  PersonOrgPagePort,
} from "../../../../src/stores/ucpath/driver/person-org-operation.js";
import { executeClaimedRun } from "../../../../src/core/run-executor.js";
import type { RunExecutorDependencies } from "../../../../src/core/run-executor.js";
import { taskStoreRegistry } from "../../../../src/backend/app/task-registry.js";
import { UUID_5 } from "../../../fixtures/phase1c-contract-fixtures.js";
import {
  RUN_ID,
  WORKER_ID,
  WORKFLOW_ID,
  sequentialIdFactory,
} from "../../../fixtures/phase1f-run-fixtures.js";
import {
  ManualScheduler,
  healthyCrmDriver,
  healthyUcpathDriver,
  openAuthorityHarness,
  personLookupQueuedRun,
  recordingEmitter,
  recordingLogger,
  sessionFactoryHarness,
  sessionManagerFor,
  type AuthorityHarness,
} from "../../../helpers/phase1f-executor-harness.js";
import { personLookupDescriptor } from "../../../helpers/registered-workflows.js";
import { walkDescriptor } from "../../helpers/pure-walk.js";

const RESOLVED_CANDIDATE = {
  emplId: "10800000",
  name: "Battistessa, Johnnie",
  department: "Housing Dining Hospitality",
  jobTitle: "Dining Assistant",
  employeeStatus: "active",
  hdh: true,
};

const SEARCH_RESOLVED = {
  results: [RESOLVED_CANDIDATE],
  selection: { status: "resolved", selected: RESOLVED_CANDIDATE, candidateEids: ["10800000"] },
};

const CRM_FOUND = {
  state: "found",
  record: {
    recordId: "ONB-40213",
    emplId: "10800000",
    fullName: "Battistessa, Johnnie",
    rawStage: "Completed",
  },
};

const ACTIVE = {
  state: "active",
  reason: "UCPath reports an active HDH appointment and CRM onboarding is complete",
  hdh: true,
};

const CRM_DATES = {
  emplId: "10800000",
  invitedOn: { state: "present", value: "2026-06-01" },
  startsOn: { state: "present", value: "2026-07-15" },
  completedOn: { state: "absent", reason: "CRM history has no Completed transition" },
};

describe("person-lookup scenarios", () => {
  it("person-lookup/happy-by-eid — resolves, cross-verifies, and skips the optional dates step", () => {
    const walk = walkDescriptor(personLookupDescriptor, { emplId: "10800000" }, {
      outputs: {
        searching: SEARCH_RESOLVED,
        "cross-verify": CRM_FOUND,
        "active-status": ACTIVE,
      },
    });
    assert.deepEqual(walk.visited, ["searching", "cross-verify", "active-status"]);
    // `when` is false, so the node produces `undefined` rather than a fabricated value.
    assert.deepEqual(walk.skipped, ["crm-dates"]);
    assert.deepEqual(walk.result, { activeStatus: ACTIVE, crmDates: { state: "not-requested" } });
  });

  it("person-lookup/happy-by-eid-with-dates — the conditional node runs and reaches the result", () => {
    const walk = walkDescriptor(personLookupDescriptor, { emplId: "10800000", includeCrmDates: true }, {
      outputs: {
        searching: SEARCH_RESOLVED,
        "cross-verify": CRM_FOUND,
        "active-status": ACTIVE,
        "crm-dates": CRM_DATES,
      },
    });
    assert.deepEqual(walk.visited, ["searching", "cross-verify", "active-status", "crm-dates"]);
    assert.deepEqual(walk.skipped, []);
    assert.deepEqual(walk.result, { activeStatus: ACTIVE, crmDates: { state: "included", dates: CRM_DATES } });
  });

  it("person-lookup/ambiguous-name — a bind that needs a selection fails loud instead of guessing", () => {
    // Two candidates and no selection is a real outcome of a correct search. The
    // charter's rule is that the next step must NOT pick one.
    assert.throws(
      () => walkDescriptor(personLookupDescriptor, { name: "Battistessa" }, {
        outputs: {
          searching: {
            results: [RESOLVED_CANDIDATE, { ...RESOLVED_CANDIDATE, emplId: "10800001" }],
            selection: {
              status: "ambiguous",
              selected: null,
              candidateEids: ["10800000", "10800001"],
              searchName: "Battistessa",
            },
          },
        },
      }),
      /requires searching\.selection\.selected, which is null/,
    );
  });

  it("person-lookup/not-found — the same refusal, from the other absent outcome", () => {
    assert.throws(
      () => walkDescriptor(personLookupDescriptor, { name: "Nobody, At All" }, {
        outputs: {
          searching: {
            results: [],
            selection: {
              status: "not-found",
              selected: null,
              candidateEids: [],
              searchName: "Nobody, At All",
            },
          },
        },
      }),
      /requires searching\.selection\.selected, which is null/,
    );
  });

  it("person-lookup/crm-failure-retry — a replayed search feeds a fresh cross-verification", () => {
    // The retry shape from ref workflow-model §8: `searching` replays from its checkpoint,
    // `cross-verify` runs again, and `active-status` (always-rerun) folds both.
    const walk = walkDescriptor(personLookupDescriptor, { emplId: "10800000" }, {
      outputs: {
        searching: SEARCH_RESOLVED,
        "cross-verify": { state: "absent", queriedEid: "10800000", reason: "no onboarding record for this EID" },
        "active-status": { state: "undetermined", reason: "CRM has no onboarding record to cross-verify" },
      },
    });
    assert.equal(walk.result !== null && typeof walk.result === "object", true);
    assert.deepEqual(walk.result, {
      activeStatus: { state: "undetermined", reason: "CRM has no onboarding record to cross-verify" },
      crmDates: { state: "not-requested" },
    });
  });

  it("rejects a supplied output the producing contract's own schema refuses", () => {
    assert.throws(
      () => walkDescriptor(personLookupDescriptor, { emplId: "10800000" }, {
        outputs: {
          searching: {
            results: [],
            // `resolved` with nobody selected is unspellable — that is the point
            // of the three-arm union.
            selection: { status: "resolved", selected: null, candidateEids: ["10800000"] },
          },
        },
      }),
      /invalid|expected/i,
    );
  });
});

/* ── runtime walks: the real task implementations ────────────────────────── */

const signal = new AbortController().signal;
const log = Object.freeze({
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
});
const fail = (_code: string, message: string): never => {
  throw new Error(message);
};
const dataPoints: DataPoint[] = [];
const recordData = (input: DataPoint | readonly DataPoint[]): void => {
  for (const point of Array.isArray(input) ? input : [input]) {
    dataPoints.push(DataPointSchema.parse(point));
  }
};
const EID = EidSchema.parse("10800000");
const record = ReadOnboardingRecordOutputSchema.parse({
  state: "found",
  record: {
    recordId: "ONB-40213",
    emplId: EID,
    fullName: "Battistessa, Johnnie",
    rawStage: "Completed",
  },
});
const dates = ReadOnboardingDatesOutputSchema.parse({
  emplId: EID,
  invitedOn: { state: "present", value: "2026-06-01" },
  startsOn: { state: "present", value: "2026-07-15" },
  completedOn: { state: "absent", reason: "CRM history has no Completed transition" },
});

describe("person-lookup runtime scenarios", () => {
  it("person-lookup/crm-subject-mismatch — stale CRM identity refuses both reads", async () => {
    const driver = createDeterministicCrmOnboardingDriver({
      record,
      dates,
      recordObservedEid: "10800001",
      datesObservedEid: "10800001",
    });
    await assert.rejects(
      readOnboardingRecordTask.impl.run({
        input: { eid: EID, name: "Battistessa, Johnnie" },
        ctx: { signal, log, driver, fail, recordData },
      }),
      new RegExp(`expected EID ${directIdentifierDisplay(EID)} but bound ${directIdentifierDisplay("10800001")}`),
    );
    await assert.rejects(
      readOnboardingDatesTask.impl.run({
        input: { eid: EID },
        ctx: { signal, log, driver, fail, recordData },
      }),
      new RegExp(`expected EID ${directIdentifierDisplay(EID)} but bound ${directIdentifierDisplay("10800001")}`),
    );

    const exact = {
      fullName: "Fixture, Person",
      rawStage: "Completed",
      recordId: "ONB-40213",
      recordUrl: "https://act-crm.my.site.com/hr/ONB_ViewOnboarding?id=ONB-40213",
      observedEid: EID,
      firstName: "Person",
      lastName: "Fixture",
      firstDayOfService: "7/15/2026",
    };
    assert.throws(
      () => chooseExactCrmRecord([exact, { ...exact, recordId: "ONB-40214" }], EID),
      /resolved 2 exact displayed-EID records/,
    );
  });

  it("person-lookup/ucpath-drill-subject-mismatch — a stale detail never becomes a candidate", async () => {
    const wrongEid = EidSchema.parse("10800001");
    const rows = parsePersonOrgGridRows([
      [EID, "0", "Active", "SDCMP", "004921", "Dining Assistant", "Battistessa", "Johnnie Battistessa"],
    ]);
    const staleDetail: PersonOrgDetail = {
      observedEid: wrongEid,
      displayedName: "Different Person",
      cells: [[
        "0", "08/01/2026", "Active", "SDCMP", "40000000", "000412",
        "HOUSING/DINING/HOSPITALITY", "004921", "Dining Assistant", "", "0.50", "Student",
      ]],
      employmentInstances: "already-complete",
    };
    const page: PersonOrgPagePort = {
      search: async () => ({ kind: "grid", rows }),
      drill: async () => staleDetail,
      returnToResults: async () => undefined,
    };

    await assert.rejects(
      searchPersonOrgWithPagePort(page, {
        kind: "by-name",
        name: "Battistessa, Johnnie",
        keepNonHdh: true,
      }),
      new RegExp(`expected EID ${directIdentifierDisplay(EID)} but displayed ${directIdentifierDisplay(wrongEid)}`),
    );
  });
});

/* ── recovery walks (D314): the real interpreter over real authority ─────── */

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});
const EXECUTOR_SIGNAL = new AbortController().signal;

/**
 * ONE id factory across every attempt in this file: durable outbox and
 * authorization ids are unique per row, so a per-attempt factory would restart
 * the sequence and mint a collision the second attempt cannot distinguish from
 * a replay.
 */
const executorIds = sequentialIdFactory("d");

/** Counts what actually reached UCPath, which is the whole claim of a replay. */
function countingSessions(): {
  readonly sessions: ReturnType<typeof sessionFactoryHarness>;
  readonly searches: () => number;
} {
  let searches = 0;
  const sessions = sessionFactoryHarness({
    ucpath: () => {
      const driver = healthyUcpathDriver();
      return {
        ...driver,
        searchPersonOrg: (...args: Parameters<typeof driver.searchPersonOrg>) => {
          searches += 1;
          return driver.searchPersonOrg(...args);
        },
      };
    },
    crm: () => healthyCrmDriver(),
  });
  return { sessions, searches: () => searches };
}

function depsFor(
  authority: AuthorityHarness,
  sessions: ReturnType<typeof sessionFactoryHarness>,
): RunExecutorDependencies {
  return {
    lifecycle: testRunLifecycle(authority.database, authority.clock),
    descriptor: personLookupDescriptor,
    stores: taskStoreRegistry,
    authority: authority.database,
    sessions: sessionManagerFor(sessions, authority.clock),
    emitter: recordingEmitter().emitter,
    clock: authority.clock,
    ids: executorIds,
    scheduler: new ManualScheduler(authority.clock, 0),
    taskDeadlineMs: 60_000,
    log: recordingLogger().log,
  };
}

/** Enqueue → claim → execute one attempt, reporting what it actually read. */
async function runAttempt(
  authority: AuthorityHarness,
  run: Record<string, unknown>,
): Promise<{ readonly searches: number; readonly ucpathOpens: number }> {
  authority.database.authority.runs.enqueue(run);
  const claimed = authority.database.authority.runs.claimNext({
    workflow: WORKFLOW_ID,
    workerId: WORKER_ID,
    now: authority.clock.now().toISOString(),
  });
  if (claimed.state !== "claimed") throw new Error(`claim outcome was ${claimed.state}`);
  const counting = countingSessions();
  const outcome = await executeClaimedRun(depsFor(authority, counting.sessions), {
    run: claimed.run,
    claim: { workerId: WORKER_ID, claimGeneration: claimed.run.claimGeneration },
    signal: EXECUTOR_SIGNAL,
  });
  assert.equal(outcome.state, "done");
  return { searches: counting.searches(), ucpathOpens: counting.sessions.opens("ucpath") };
}

function checkpointAttempts(
  authority: AuthorityHarness,
  itemId: string,
  nodeId: string,
): readonly number[] {
  return authority.database.authority.runCheckpoints
    .listByItem(WORKFLOW_ID, itemId)
    .filter((row) => row.nodeId === nodeId)
    .map((row) => row.attempt)
    .toSorted();
}

describe("person-lookup recovery", () => {
  /**
   * D314's first recovery choice, over the REAL descriptor: a resumed attempt
   * replays the reads from their checkpoints — zero UCPath sessions, zero
   * searches — and re-executes the always-rerun fold. The proof is the
   * `run_checkpoints` attempt column, not the absence of a log line: a replayed
   * node writes NO row for the new attempt, and `active-status` writes one.
   */
  it("person-lookup/resume-from-checkpoints — resuming from checkpoints replays the reads and re-executes the always-rerun fold", async () => {
    const authority = openAuthorityHarness();
    disposers.push(authority.dispose);

    const first = await runAttempt(authority, personLookupQueuedRun());
    assert.deepEqual(first, { searches: 1, ucpathOpens: 1 });

    const resume = personLookupQueuedRun({ runId: UUID_5, attempt: 2 });
    (resume.envelope as Record<string, unknown>).retryOf = RUN_ID;
    const itemId = (resume.envelope as { itemId: string }).itemId;
    const second = await runAttempt(authority, resume);
    assert.deepEqual(second, { searches: 0, ucpathOpens: 0 }, "a resumed read reached UCPath");

    assert.deepEqual(checkpointAttempts(authority, itemId, "searching"), [1]);
    assert.deepEqual(checkpointAttempts(authority, itemId, "cross-verify"), [1]);
    assert.deepEqual(checkpointAttempts(authority, itemId, "active-status"), [1, 2]);

    // The resumed attempt still terminalized with the workflow's own result,
    // bound to the attempt that actually produced the fold.
    const result = authority.database.authority.runResults.get(UUID_5);
    assert.ok(result, "the resumed attempt wrote no run result");
    const activeStatus = result.dependencies.find((candidate) => candidate.nodeId === "active-status");
    assert.equal(activeStatus?.state, "resolved");
    assert.equal(activeStatus?.state === "resolved" ? activeStatus.checkpoint.attempt : undefined, 2);
  });

  /**
   * D314's second choice: Restart from start is the SAME logical item taking
   * its next attempt from pristine canonical input. Every read and computation
   * executes again — a fresh UCPath session and a fresh checkpoint under the
   * new attempt — and the earlier attempt's rows are untouched, because D301
   * never rewrites history. This graph has no transaction node, so nothing here
   * can re-execute a completed write; that half of the rule is proven where a
   * transaction exists.
   */
  it("person-lookup/restart-from-start — restarting from start reruns every read and computation under the next attempt", async () => {
    const authority = openAuthorityHarness();
    disposers.push(authority.dispose);

    const first = await runAttempt(authority, personLookupQueuedRun());
    assert.deepEqual(first, { searches: 1, ucpathOpens: 1 });

    const restart = personLookupQueuedRun({ runId: UUID_5, attempt: 2 });
    const envelope = restart.envelope as Record<string, unknown>;
    envelope.retryOf = RUN_ID;
    envelope.recovery = "restart-from-start";
    const itemId = (restart.envelope as { itemId: string }).itemId;
    const second = await runAttempt(authority, restart);
    assert.deepEqual(second, { searches: 1, ucpathOpens: 1 }, "a restarted read replayed instead of re-reading");

    assert.deepEqual(checkpointAttempts(authority, itemId, "searching"), [1, 2]);
    assert.deepEqual(checkpointAttempts(authority, itemId, "cross-verify"), [1, 2]);
    assert.deepEqual(checkpointAttempts(authority, itemId, "active-status"), [1, 2]);

    const restartRows = authority.database.authority.runCheckpoints
      .listByItem(WORKFLOW_ID, itemId)
      .filter((row) => row.attempt === 2);
    assert.ok(restartRows.length > 0, "the restart wrote no checkpoint of its own");
    assert.ok(
      restartRows.every((row) => row.runId === UUID_5),
      "an attempt-2 row was attributed to a run other than the restart",
    );
    // Attempt 1's rows still belong to attempt 1's run: history is append-only.
    const priorRows = authority.database.authority.runCheckpoints
      .listByItem(WORKFLOW_ID, itemId)
      .filter((row) => row.attempt === 1);
    assert.ok(priorRows.length > 0, "the first attempt's checkpoints disappeared");
    assert.ok(
      priorRows.every((row) => row.runId === RUN_ID),
      "the restart rewrote an earlier attempt's checkpoint",
    );
  });
});

/* ── the pair's own invariant ────────────────────────────────────────────── */

/**
 * Every module specifier a file actually imports — static `import`/`export …
 * from`, and dynamic `import(…)`. A dynamic import whose specifier is not a
 * literal is refused rather than ignored: a computed specifier is exactly how a
 * manifest would be reached without this audit noticing.
 */
function moduleSpecifiers(file: string, source: string): readonly string[] {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier !== undefined
      && ts.isStringLiteralLike(node.moduleSpecifier)) {
      specifiers.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [only] = node.arguments;
      if (only === undefined || !ts.isStringLiteralLike(only)) {
        throw new Error(`${file} takes a dynamic import whose specifier is not a literal`);
      }
      specifiers.push(only.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return specifiers;
}

describe("person-lookup T1 pair", () => {
  /**
   * Ref guards-and-tests §10.4/§10.9's structural half, asserted where the pair
   * lives — the same arm both separations pairs carry, because the invariant is
   * per-pair and a third pair that skipped it would be the first one nobody
   * checked.
   *
   * `dry-run.scenario.ts` is a DECLARATION: running it starts a browser and
   * reaches live UCPath and the live CRM under `dryRun: false` (D318's
   * `live-read` arm), so a vitest project that collected it — or a collected
   * file that imported it and executed its side effects — would put a live read
   * inside the per-commit gate. Two facts keep it out, and neither is
   * self-evident from reading the manifest: it carries no `.test.` segment, and
   * nothing vitest collects imports it.
   */
  it("keeps the dry-run manifest out of every vitest project", () => {
    const testsRoot = join(import.meta.dirname, "..", "..", "..");
    const manifest = join(import.meta.dirname, "dry-run.scenario.ts");
    assert.ok(existsSync(manifest), "the T1b manifest is missing from this workflow's folder");

    // The NAME, asserted against what is on disk rather than against the string
    // this test just built: a hard-coded literal cannot carry `.test.`, so the
    // old form could never fail. A `dry-run*.test.*` sibling would be collected
    // and would start a browser.
    assert.deepEqual(
      readdirSync(import.meta.dirname).filter((entry) => /^dry-run.*\.test\./u.test(entry)),
      [],
      "a collectible dry-run file sits beside the manifest",
    );

    // An actual import of a manifest — determined by the PARSER, not by a
    // pattern over the raw text. A dynamic import executes the declaration
    // exactly as a static one does, `.ts` resolves as readily as `.js`, and
    // prose that merely names a manifest is not an import. A regex could not
    // separate those three, and the file it would false-positive on first is
    // this one.
    //
    // Every `.ts` under `tests/` is scanned, not only `*.test.ts`: a helper,
    // fixture or world file is never collected by vitest itself, but a
    // collected `*.test.ts` importing THAT file would import the manifest
    // transitively without this audit's direct-specifier check on the
    // `.test.ts` file ever seeing it. Scanning every file the corpus can
    // reach closes that gap without re-deriving the whole import graph.
    const collected: string[] = [];
    const visit = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const full = join(directory, entry.name);
        if (entry.isDirectory()) visit(full);
        else if (entry.isFile() && entry.name.endsWith(".ts")) collected.push(full);
      }
    };
    visit(testsRoot);
    assert.ok(collected.length > 0, "the test corpus scan found nothing, so it proves nothing");
    const importers = collected.filter((file) => {
      if (file === manifest) return false;
      const source = readFileSync(file, "utf8");
      // Cheap pre-filter; every candidate is then judged by the parser alone.
      if (!source.includes("dry-run.scenario.")) return false;
      return moduleSpecifiers(file, source).some((specifier) =>
        /dry-run\.scenario\.(?:js|ts)$/u.test(specifier));
    });
    assert.deepEqual(importers, [], "a file the test corpus can reach imports a dry-run manifest");
  });
});
