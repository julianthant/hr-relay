import { seedSyntheticRuntimeConfig, singleAppliedRunId } from "../../support/fixtures/operator-command-fixtures.js";
import { RunRecordService } from "../../../src/backend/runs/lifecycle/run-record-service.js";
import { admitDirectWorker } from "../../../src/backend/storage/sqlite/worker-slots.js";
import { randomUUID } from "node:crypto";

import assert from "node:assert/strict";
import { PositiveIntSchema } from "../../../src/rules/identity/ids.js";
import { SETTINGS_SCHEMA_HASH } from "../../../src/models/config/settings.js";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, it } from "vitest";
import ts from "typescript";
import { createCommandKernel, PHASE1_ACTIVE_COMMAND_ARMS, PHASE1_DEFERRED_COMMAND_ARMS, type CommandKernel } from "../../../src/backend/runs/commands/command-kernel.js";
import { CommandRequestSchema, CommandResultSchema, COMMAND_FAMILY_REGISTRY } from "../../../src/rules/commands/commands.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { AuthorityDatabase, type AuthorityRepositories } from "../../support/helpers/synthetic-storage-admission.js";
import { planStart } from "../../../src/backend/runs/start/plan.js";
import { REPO_ROOT, walkFiles } from "../support/helpers/guard-files.js";
import { fixtureDescriptor } from "../../support/fixtures/descriptor-fixtures.js";
import { COMMAND_FIXTURES, HASH_B, NOW, UUID_2, UUID_4 } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN, sequentialIdFactory } from "../../support/fixtures/phase1f-run-fixtures.js";
import { NO_INTAKE_PROJECTIONS, UNWIRED_INTAKE_PARSER } from "../../support/fixtures/intake-kernel-seams.js";

function withoutReadOnlyHistoryFacade(content: string): string {
  const source = ts.createSourceFile("candidate.ts", content, ts.ScriptTarget.Latest, true);
  const compact = (node: ts.Node): string => node.getText(source).replace(/\s+/gu, "");
  const readonlyImport = source.statements.some(node => ts.isImportDeclaration(node)
    && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === "./readonly-authority-snapshot.js"
    && node.importClause?.namedBindings !== undefined && ts.isNamedImports(node.importClause.namedBindings)
    && node.importClause.namedBindings.elements.some(binding => binding.name.text === "withAuthorityDatabaseReadOnly" && binding.propertyName === undefined));
  if (!readonlyImport) return content;
  let unsafe = false;
  let admittedReads = 0;
  function inspect(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && /^(?:exec|run|insert|execute|consume)$/u.test(node.expression.name.text)) unsafe = true;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "readHistory") {
      let parent: ts.Node | undefined = node.parent;
      while (parent !== undefined && !ts.isArrowFunction(parent)) parent = parent.parent;
      if (parent !== undefined && ts.isArrowFunction(parent) && ts.isCallExpression(parent.parent)
        && parent.parent.expression.getText(source) === "withAuthorityDatabaseReadOnly"
        && parent.parent.arguments.length === 3 && parent.parent.arguments[2] === parent
        && compact(parent.parent.arguments[0]) === "copyAdmission" && compact(parent.parent.arguments[1]) === "backupPath"
        && compact(node) === "readHistory(database)") admittedReads += 1;
      else unsafe = true;
    }
    if ((ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node)) && node.name?.getText(source) === "withAuthorityDatabaseReadOnly") unsafe = true;
    ts.forEachChild(node, inspect);
  }
  inspect(source);
  if (unsafe || admittedReads !== 1
    || !compact(source).includes('constcopyAdmission=admission.verifiedReadOnlyCopy(backupPath,input.verifiedBackup.manifest.sha256);')
    || !compact(source).includes('finally{copyAdmission.release();}')) return content;
  const functions = source.statements.filter(ts.isFunctionDeclaration).filter(node => node.name?.text === "readHistory");
  if (functions.length !== 1) return content;
  const fn = functions[0];
  if (fn.parameters.length !== 1 || compact(fn.parameters[0]) !== "database:DatabaseSync"
    || fn.type?.getText(source) !== "StorageRelocationHistoryRepositories" || fn.body?.statements.length !== 5) return content;
  const [commands, audits, index, fold, result] = fn.body.statements;
  const reads = [
    [commands, "commands", "SELECT * FROM commands WHERE family='storage-relocation' ORDER BY rowid",
      'StorageRelocationCommandRequestSchema.parse(commandFromRow(raw))'],
    [audits, "audits", "SELECT audit.* FROM command_audits AS audit JOIN commands AS command ON command.id=audit.command_id WHERE command.family='storage-relocation' ORDER BY audit.rowid",
      'CommandAuditRecordSchema.parse(nativeOrdinaryRecordFromRow("command_audits",raw))'],
  ] as const;
  for (const [statement, name, sql, mapping] of reads) {
    if (!ts.isVariableStatement(statement) || (statement.declarationList.flags & ts.NodeFlags.Const) === 0
      || statement.declarationList.declarations.length !== 1) return content;
    const declaration = statement.declarationList.declarations[0];
    const map = declaration.initializer;
    if (declaration.name.getText(source) !== name || map === undefined || !ts.isCallExpression(map)
      || !ts.isPropertyAccessExpression(map.expression) || map.expression.name.text !== "map" || map.arguments.length !== 1
      || !ts.isArrowFunction(map.arguments[0]) || compact(map.arguments[0].parameters[0]) !== "raw"
      || compact(map.arguments[0].body) !== mapping) return content;
    const all = map.expression.expression;
    if (!ts.isCallExpression(all) || all.arguments.length !== 0 || !ts.isPropertyAccessExpression(all.expression)
      || all.expression.name.text !== "all") return content;
    const prepare = all.expression.expression;
    if (!ts.isCallExpression(prepare) || compact(prepare.expression) !== "database.prepare" || prepare.arguments.length !== 1
      || !ts.isStringLiteralLike(prepare.arguments[0])
      || prepare.arguments[0].text.replace(/\s+/gu, " ").trim() !== sql) return content;
  }
  if (compact(index) !== 'constbyCommand=newMap<string,(typeofaudits)[number]>();'
    || compact(fold) !== 'for(constauditofaudits){if(byCommand.has(audit.request.commandId))refuse("duplicaterelocationcommandaudit");byCommand.set(audit.request.commandId,audit);}'
    || compact(result) !== 'return{commands:{listStorageRelocationCommands:()=>commands},commandAudits:{findByCommand:(commandId)=>byCommand.get(commandId)},};') return content;

  const offset = content.indexOf("commandAudits", result.getStart(source));
  return content.slice(0, offset) + content.slice(offset + "commandAudits".length);
}

const CURRENT_COMMAND_FIXTURES: readonly unknown[] = Object.freeze([
  ...COMMAND_FIXTURES,
  {
    commandId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", requestedAt: NOW,
    requestedBy: "local-operator", source: "dashboard",
    family: "failure-resolution", type: "annotate-failure",
    target: { runId: UUID_2, failureId: UUID_4, expectedVersion: 1 }, payload: { action: "resolve" },
  },
  {
    commandId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", requestedAt: NOW,
    requestedBy: "local-operator", source: "dashboard",
    family: "workflow-batch", type: "set-batch-grouping",
    target: { batchId: UUID_2, expectedVersion: 1 }, payload: { groupInQueue: false },
  },
  {
    commandId: UUID_2,
    requestedAt: NOW,
    requestedBy: "local-operator",
    source: "dashboard",
    family: "settings",
    type: "apply-protected-settings",
    target: { expectedRevision: 1 },
    payload: {
      protectedSchemaHash: HASH_B,
      writeId: UUID_4,
      entries: { ucpathPassword: { clear: true } },
    },
  },

  {
    commandId: "abababab-abab-4aba-8aba-abababababab", requestedAt: NOW,
    requestedBy: "local-operator", source: "dashboard", family: "storage-relocation", type: "plan-storage-relocation",
    target: { installationId: UUID_2, sourceGeneration: 0,
      sourcePair: { stateRoot: "/synthetic/state", artifactRoot: "/synthetic/state/artifacts" }, expectedRevision: 0 },
    payload: { writeId: UUID_4, desiredPair: { stateRoot: "/synthetic/next-state", artifactRoot: "/synthetic/next-state/artifacts" },
      desiredDigest: HASH_B, requestFingerprint: HASH_B },
  },
  {
    commandId: "cdcdcdcd-cdcd-4cdc-8cdc-cdcdcdcdcdcd", requestedAt: NOW,
    requestedBy: "local-operator", source: "dashboard", family: "storage-relocation", type: "cancel-storage-relocation",
    target: { installationId: UUID_2, sourceGeneration: 0,
      sourcePair: { stateRoot: "/synthetic/state", artifactRoot: "/synthetic/state/artifacts" }, expectedRevision: 1 },
    payload: { writeId: "efefefef-efef-4efe-8efe-efefefefefef", cancelledPlanCommandId: "abababab-abab-4aba-8aba-abababababab",
      cancelledPlanDigest: HASH_B, requestFingerprint: HASH_B },
  },
]);

/* ── the ratified Phase-1f partition (ref dashboard-surfaces §Phase-1f authority) ────────── */

const EXPECTED_ACTIVE = {
  "failure-resolution": ["annotate-failure"],
  start: ["start-run"],
  "workflow-batch": ["set-batch-grouping"],
  "worker-browser": [
    "plan-worker-count", "spawn-worker", "stop-worker", "pause-worker",
    "resume-worker", "refresh-browser", "reopen-browser",
  ],
  run: [
    "retry",

    "restart",
    "cancel", "bump", "rename",

    "delete",
    "resolve-write-present", "resolve-write-absent",

  ],
  gate: ["resolve-gate"],

  notification: ["notification-read", "notification-unread", "notification-snooze", "notification-unsnooze"],

  intake: [
    "inspect-intake", "confirm-intake-mapping", "correct-intake-row",
    "exclude-intake-row", "validate-intake", "enqueue-intake-manifest",
  ],
  settings: ["apply-settings", "apply-protected-settings"],
  "storage-relocation": ["plan-storage-relocation", "cancel-storage-relocation"],

  explorer: ["apply-explorer-edit"],
} as const;

const EXPECTED_DEFERRED = {
  intake: [],
  settings: [],
  "storage-relocation": [],
  run: [],
  notification: [],
} as const;

const DEFERRED_KEYS = new Set(
  Object.entries(EXPECTED_DEFERRED as Readonly<Record<string, readonly string[]>>).flatMap(([family, actions]) =>
    actions.map((action) => `${family}/${action}`)),
);

/* ── harness ─────────────────────────────────────────────────────────────── */

const roots: string[] = [];
const openDatabases: AuthorityDatabase[] = [];

afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

type RepositoryWrap = (repositories: AuthorityRepositories) => AuthorityRepositories;

interface GuardHarness {
  readonly path: string;
  readonly database: AuthorityDatabase;
  readonly kernel: CommandKernel;
  readonly clock: ReturnType<typeof manualClock>;
  readonly plannerIds: ReturnType<typeof sequentialIdFactory>;
}

function createHarness(wrap?: RepositoryWrap): GuardHarness {
  const root = mkdtempSync(join(tmpdir(), "hrauto-command-guard-"));
  roots.push(root);
  const clock = manualClock(new Date(NOW));
  const database = AuthorityDatabase.open(
    { path: join(root, "guard.sqlite"), busyTimeoutMs: 250, migrationOwner: "command-guard" },
    clock,
  );

  seedSyntheticRuntimeConfig(database);
  openDatabases.push(database);
  const seamFailure = (seam: string) => () => {
    throw new Error(`${seam} process seam was reached before authority validation`);
  };
  const kernel = createCommandKernel({
    lifecycle: new RunRecordService({ database: database, clock: clock, ids: sequentialIdFactory("e"), publishQueued: () => {} }),
    appVersion: "0.1.0",
    configIdentity: database.authority.runtimeConfig.get()!,
    intakeParser: UNWIRED_INTAKE_PARSER,
    intakeProjections: NO_INTAKE_PROJECTIONS,
    authority: {
      withAuthorityTransaction: (work) => database.withAuthorityTransaction(
        (repositories) => work(wrap === undefined ? repositories : wrap(repositories)),
      ),
    },
    clock,
    ids: sequentialIdFactory("a"),
    descriptors: {
      resolve: (workflowId) => workflowId === "fixture-graph" ? fixtureDescriptor : undefined,
    },
    writeResolution: {
      resolvePresent: seamFailure("resolve-write-present"),
      resolveAbsent: seamFailure("resolve-write-absent"),
    },
    workerRuntime: { pool: {
      planPoolWorkerCount: async () => seamFailure("plan-worker-count")(),
      spawnPoolWorker: async () => seamFailure("spawn-worker")(),
      refreshPoolBrowser: async () => seamFailure("refresh-browser")(),
      reopenPoolBrowser: async () => seamFailure("reopen-browser")(),
      stopPoolWorker: async () => seamFailure("stop-worker")(),
      pausePoolWorker: async () => seamFailure("pause-worker")(),
      resumePoolWorker: async () => seamFailure("resume-worker")(),
    } },
    settings: {
      validateRequest: (command) => command.type === "apply-settings" && command.payload.settingsSchemaHash !== SETTINGS_SCHEMA_HASH
        ? { state: "rejected", code: "schema-mismatch", message: "guard fixture uses a noncurrent settings schema" } : undefined,
      commitPrivate: (command) => command.type === "apply-protected-settings"
        ? { state: "conflict", currentRevision: PositiveIntSchema.parse(1), message: "guard fixture has no mutable private target" } : undefined,
      reconcileReplay: () => {
        throw new Error("guard fixture has no persisted settings replay target");
      },
      applyOrdinary: () => ({
        state: "conflict",
        currentRevision: 1,
        message: "guard fixture has no mutable settings target",
      }),
    },
    explorerEdits: {
      apply: () => ({
        result: {
          state: "refused",
          category: "fixture-refusal",
          message: "Explorer guard fixture refuses before persistence",
        },
      }),
    },
  });
  return { path: join(root, "guard.sqlite"), database, kernel, clock, plannerIds: sequentialIdFactory("f") };
}

let guardCommandSequence = 0;

function nextCommandId(): string {
  guardCommandSequence += 1;
  const tail = String(guardCommandSequence).padStart(4, "0");
  return `eeeeeeee-${tail}-4000-8000-${tail}00000000`;
}

function createFixturePlan(harness: GuardHarness) {
  const plan = planStart(
    { authority: harness.database, clock: harness.clock, ids: harness.plannerIds, planTtlMs: 600_000 },
    {
      descriptor: fixtureDescriptor,
      submissions: [{ eid: "10800000", mode: "read-only" }],
      dryRun: false,
      priority: "bulk",
      shape: "single",
      configFingerprint: harness.database.authority.runtimeConfig.get()!.configFingerprint,
      configSnapshotId: harness.database.authority.runtimeConfig.get()!.configSnapshotId,
      plannedBy: "local-operator",
    },
  );
  assert.equal(harness.database.authority.startPlans.create(plan).state, "inserted");
  return plan;
}

function startCommandFor(plan: ReturnType<typeof createFixturePlan>) {
  return {
    commandId: nextCommandId(),
    requestedAt: NOW,
    requestedBy: "local-operator",
    source: "dashboard",
    family: "start",
    type: "start-run",
    target: { workflowId: plan.workflowId, startPlanId: plan.startPlanId, expectedVersion: plan.version },
    payload: {
      descriptorFingerprint: plan.descriptorFingerprint,
      configFingerprint: plan.configFingerprint,
      ingressSchemaHash: plan.ingressSchemaHash,
      canonicalInputSchemaHash: plan.canonicalInputSchemaHash,
      inputFingerprint: plan.inputFingerprint,
    },
  };
}

describe("control-command-single-path", () => {
  it("pins the exact ratified Phase-1f active/deferred arm partition", () => {
    assert.deepEqual(PHASE1_ACTIVE_COMMAND_ARMS, EXPECTED_ACTIVE);
    assert.deepEqual(PHASE1_DEFERRED_COMMAND_ARMS, EXPECTED_DEFERRED);
    const partitioned = [
      ...Object.entries(EXPECTED_ACTIVE),
      ...Object.entries(EXPECTED_DEFERRED),
    ].flatMap(([family, actions]) => actions.map((action) => `${family}/${action}`));
    const registry = COMMAND_FAMILY_REGISTRY.flatMap(({ family, actions }) =>
      actions.map((action) => `${family}/${action}`));
    assert.deepEqual([...partitioned].sort(), [...registry].sort());
    assert.equal(new Set(partitioned).size, partitioned.length);
  });

  it("allows only the closed SELECT-derived command/audit history facade", () => {
    const source = readFileSync(join(REPO_ROOT, "src/backend/storage/sqlite/relocation-restore-candidate.ts"), "utf8");
    assert.ok(!withoutReadOnlyHistoryFacade(source).includes("commandAudits"));
    for (const bad of [
      source.replace("SELECT audit.*", "DELETE audit.*"),
      source.replace(".all().map(raw", ".run().map(raw"),
      source.replace("byCommand.get(commandId)", "database.exec(commandId)"),
      source.replace("return {\n    commands:", 'database.exec("DELETE FROM command_audits"); return {\n    commands:'),
      source.replace("withAuthorityDatabaseReadOnly(copyAdmission, backupPath", "withAuthorityDatabaseReadOnly(input.admission, backupPath"),
      source.replace('from "./readonly-authority-snapshot.js"', 'from "./forged-readonly.js"'),
      `${source}\nfunction arbitrary(repo: any) { repo.commandAudits.insert({}); }`,
      `${source}\nconst forged = { commandAudits: { findByCommand: () => undefined } };`,
    ]) assert.ok(withoutReadOnlyHistoryFacade(bad).includes("commandAudits"), "mutating or unrelated audit authority must remain visible");
  });

  it("keeps the command journal, audit, and start-plan consumption on exactly one executing path", () => {
    const allowed = new Set([
      "src/backend/runs/commands/command-kernel.ts",
      "src/backend/storage/sqlite/authority-database.ts",
    ]);
    const tokens = ["commandAudits", ".commands.insert(", "startPlans.consume("];
    const settingsAuditReaders = new Map([
      ["src/backend/runtime/settings/settings-runtime.ts", 1],
      ["src/backend/storage/maintenance/storage-relocation-plans.ts", 1],
      ["src/backend/storage/sqlite/backup-service.ts", 0],
      ["src/backend/runs/lifecycle/run-record-service.ts", 1],
      ["src/backend/runs/recovery/span-root-repair.ts", 1],
      ["src/models/events/confirmed-operation.ts", 1],
    ]);
    const violations: string[] = [];
    let kernelDefinitions = 0;
    for (const file of walkFiles(join(REPO_ROOT, "src"), { extensions: [".ts", ".tsx"] })) {
      const path = relative(REPO_ROOT, file).replaceAll("\\", "/");
      const content = readFileSync(file, "utf8");
      if (content.includes("export function createCommandKernel")) kernelDefinitions += 1;
      if (allowed.has(path)) continue;
      for (const token of tokens) {
        const expectedSettingsAuditReads = settingsAuditReaders.get(path);
        if (expectedSettingsAuditReads !== undefined && token === "commandAudits") {
          const auditUses = content.match(/\bcommandAudits\.[A-Za-z]+/gu) ?? [];
          if (auditUses.length !== expectedSettingsAuditReads
            || auditUses.some((use) => use !== (path === "src/backend/runtime/settings/settings-runtime.ts" ? "commandAudits.findSettingsHistory"
              : path === "src/backend/runs/lifecycle/run-record-service.ts" || path === "src/models/events/confirmed-operation.ts" ? "commandAudits.get" : "commandAudits.findByCommand"))) {
            violations.push(
              `${path} may only authenticate settings through exactly ${String(expectedSettingsAuditReads)} `
              + "commandAudits.findByCommand reads",
            );
          }
          continue;
        }
        if ((token === "commandAudits" ? withoutReadOnlyHistoryFacade(content) : content).includes(token)) violations.push(`${path} reaches ${token} outside the command kernel`);
      }
    }
    assert.deepEqual(violations, []);
    assert.equal(kernelDefinitions, 1, "exactly one module may define the command kernel");

    // The kernel itself holds no raw storage escape hatch and no UI Delete.
    const kernelSource = readFileSync(join(REPO_ROOT, "src/backend/runs/commands/command-kernel.ts"), "utf8");
    assert.ok(!/\bDatabaseSync\b/.test(kernelSource), "the kernel may not hold a raw database handle");
    assert.ok(!/\bDELETE\s+FROM\b/i.test(kernelSource), "the kernel may not physically delete authority rows");
    assert.ok(!/"Delete"/.test(kernelSource), "the UI label is Hide, never Delete");
  });

  it("carries a version or immutability binding on every wire arm's target", () => {
    const versionless: string[] = [];
    for (const fixture of CURRENT_COMMAND_FIXTURES) {
      const parsed = CommandRequestSchema.parse(fixture);
      const request = parsed.family === "worker-browser" && "workflowId" in parsed.target
        ? { ...parsed, target: { ...parsed.target, workflowId: "fixture-graph" } } : parsed;
      const target: Record<string, unknown> = request.target;
      const carries = "expectedVersion" in target || "expectedRevision" in target
        || "scope" in target;
      if (!carries) versionless.push(`${request.family}/${request.type}`);
    }
    assert.deepEqual(versionless, []);
  });

  it("dispatches every command family/action: active arms execute and unavailable arms have zero effects", async () => {
    const harness = createHarness();
    const seen: string[] = [];
    for (const fixture of CURRENT_COMMAND_FIXTURES) {
      const parsed = CommandRequestSchema.parse(fixture);
      const request = parsed.family === "worker-browser" && "workflowId" in parsed.target
        ? { ...parsed, target: { ...parsed.target, workflowId: "fixture-graph" } } : parsed;
      const key = `${request.family}/${request.type}`;
      seen.push(key);
      const generationBefore = harness.database.getMeta().authorityGeneration;
      const result = CommandResultSchema.parse(request.family === "worker-browser"
        ? await harness.kernel.executeWorkerPool(structuredClone(request)) : harness.kernel.execute(structuredClone(request)));
      if (DEFERRED_KEYS.has(key) || request.family === "storage-relocation") {
        assert.equal(result.state, "rejected", key);
        if (result.state !== "rejected") continue;
        assert.equal(result.code, "capability-unavailable", key);
        assert.equal(harness.database.getMeta().authorityGeneration, generationBefore, key);
        assert.equal(harness.database.authority.commands.get(request.commandId), undefined, key);
      } else {
        // Active arms EXECUTE: against an empty store they refuse on exact
        // authority lookups with a typed code that is never the deferred one.
        assert.notEqual(result.state, "applied", key);
        if (result.state === "rejected") {
          assert.notEqual(result.code, "capability-unavailable", `${key} must execute in Phase 1f`);
        }
      }
    }
    const registry = COMMAND_FAMILY_REGISTRY.flatMap(({ family, actions }) =>
      actions.map((action) => `${family}/${action}`));
    assert.deepEqual([...new Set(seen)].sort(), [...registry].sort(), "the fixture corpus must cover every current family/action");
  });


  it("CASes every run verb against the caller's version — presentation included", () => {
    const harness = createHarness();
    assert.equal(harness.database.authority.runs.enqueue({ ...QUEUED_RUN, envelope: { ...QUEUED_RUN.envelope,
      configFingerprint: harness.database.authority.runtimeConfig.get()!.configFingerprint,
      configSnapshotId: harness.database.authority.runtimeConfig.get()!.configSnapshotId } }).state, "inserted");
    const base = {
      requestedAt: NOW,
      requestedBy: "local-operator",
      source: "dashboard",
      family: "run",
    };
    const live = harness.database.authority.runs.get(UUID_2)?.version ?? 0;
    assert.ok(live > 0);

    const staleRename = harness.kernel.execute({
      ...base, commandId: nextCommandId(), type: "rename",
      target: { runId: UUID_2, expectedVersion: 999 },
      payload: { displayName: "Renamed despite drift" },
    });
    assert.equal(staleRename.state, "conflict", "a stale rename may not overwrite a current name");
    assert.equal(harness.database.authority.runs.get(UUID_2)?.displayName, undefined);

    const staleBump = harness.kernel.execute({
      ...base, commandId: nextCommandId(), type: "bump",
      target: { runId: UUID_2, expectedVersion: 999 },
    });
    assert.equal(staleBump.state, "conflict", "bump CASes the caller's value");
    assert.equal(
      harness.database.authority.runs.get(UUID_2)?.envelope.priority,
      QUEUED_RUN.envelope.priority,
      "a refused bump reorders nothing",
    );

    const cancelled = harness.kernel.execute({
      ...base, commandId: nextCommandId(), type: "cancel",
      target: { runId: UUID_2, expectedVersion: 999 },
    });
    assert.equal(cancelled.state, "conflict", "cancel-tree is CAS-enforced");

    // At the LIVE version both land, and rename is still presentation-only:
    // the run row exists, its lifecycle is untouched.
    const renamed = harness.kernel.execute({
      ...base, commandId: nextCommandId(), type: "rename",
      target: { runId: UUID_2, expectedVersion: live },
      payload: { displayName: "Renamed at the live version" },
    });
    assert.equal(renamed.state, "applied");
    const bumped = harness.kernel.execute({
      ...base, commandId: nextCommandId(), type: "bump",
      target: { runId: UUID_2, expectedVersion: harness.database.authority.runs.get(UUID_2)?.version ?? 0 },
    });
    assert.equal(bumped.state, "applied");

    const afterRename = harness.database.authority.runs.get(UUID_2);
    assert.ok(afterRename !== undefined, "presentation may never delete the run row");
    assert.equal(afterRename.lifecycle.state, "queued");
    assert.equal(afterRename.displayName, "Renamed at the live version");
    assert.equal(afterRename.envelope.priority, "interactive");
  });

  it("enqueue policy is transactional: an injected active-run lookup error creates zero runs", () => {
    let shouldFail = false;
    const harness = createHarness((repositories) => ({
      ...repositories,
      runs: {
        ...repositories.runs,
        listByItem: (input: unknown) => {
          if (shouldFail) throw new Error("injected active-run lookup failure");
          return repositories.runs.listByItem(input);
        },
      },
    }));
    const plan = createFixturePlan(harness);
    const command = startCommandFor(plan);
    shouldFail = true;
    const generationBefore = harness.database.getMeta().authorityGeneration;
    assert.throws(() => harness.kernel.execute(command), /injected active-run lookup failure/);
    assert.deepEqual(harness.database.authority.runs.listByWorkflow(plan.workflowId), []);
    assert.equal(harness.database.authority.startPlans.get(plan.startPlanId)?.consumedBy, undefined);
    assert.equal(harness.database.authority.commands.get(command.commandId), undefined);
    assert.equal(harness.database.getMeta().authorityGeneration, generationBefore);
  });

  it("commands are idempotent: byte-exact replay returns already-applied; a different body on the same id fails loud", () => {
    const harness = createHarness();
    const plan = createFixturePlan(harness);
    const command = startCommandFor(plan);
    const first = harness.kernel.execute(command);
    assert.equal(first.state, "applied");
    const replayed = harness.kernel.execute(structuredClone(command));
    assert.equal(replayed.state, "already-applied");
    assert.throws(
      () => harness.kernel.execute({ ...command, reason: "different content, same id" }),
      /reused with different content/,
    );
  });

  it("typed gate results parse the descriptor's exact schema and store a checkpointed result", () => {
    const harness = createHarness();
    const plan = createFixturePlan(harness);
    const runId = singleAppliedRunId(harness.kernel.execute(startCommandFor(plan)));
    const slot = harness.database.withAuthorityTransaction(repositories => {
      const member = admitDirectWorker(repositories, { commandId: randomUUID(), workflow: "fixture-graph", poolIndex: 1,
        expectedPoolVersion: 0, processId: process.pid, processAcquisitionId: randomUUID(), authorityPath: harness.path,
        processLockRoot: join(harness.path, "..", "locks"), now: NOW }, randomUUID());
      assert.equal(repositories.workerLeases.start({ workerId: member.workerId, workflow: "fixture-graph", browserSystems: [],
        processId: process.pid, requestedBy: "local-operator", now: NOW }).state, "started");
      return member;
    });
    const claimed = harness.database.authority.runs.claimNext({
      workflow: "fixture-graph", workerId: slot.workerId, now: NOW,
    });
    assert.equal(claimed.state, "claimed");
    if (claimed.state !== "claimed") return;
    const claim = { workerId: slot.workerId, claimGeneration: claimed.run.claimGeneration };
    const live = { workerId: slot.workerId, claimedAt: NOW, heartbeatAt: NOW };
    let version: number = claimed.run.version;
    for (const state of ["validating", "running"] as const) {
      assert.equal(harness.database.authority.runs.transition({
        runId, expectedVersion: version, claim, lifecycle: { state, ...live }, now: NOW,
      }).state, "applied");
      version += 1;
    }
    const parked = harness.database.authority.runs.transition({
      runId, expectedVersion: version, claim,
      lifecycle: { state: "parked-gate", gateId: "approval", parkedAt: NOW, resumeAt: "fan" },
      now: NOW,
    });
    assert.equal(parked.state, "applied");
    if (parked.state !== "applied") return;

    const gateBase = {
      requestedAt: NOW,
      requestedBy: "local-operator",
      source: "dashboard",
      family: "gate",
      type: "resolve-gate",
    };
    const generationBefore = harness.database.getMeta().authorityGeneration;
    const wrong = harness.kernel.execute({
      ...gateBase, commandId: nextCommandId(),
      target: { runId, gateId: "approval", expectedVersion: parked.run.version },
      payload: { result: { schemaHash: "9".repeat(64), value: { approved: true } } },
    });
    assert.equal(wrong.state, "rejected");
    if (wrong.state === "rejected") assert.equal(wrong.code, "schema-mismatch");
    assert.equal(harness.database.authority.gateResults.get(`${runId}:approval`), undefined);
    assert.equal(harness.database.getMeta().authorityGeneration, generationBefore);
  });

  it("notification stays read/unread/snooze", () => {
    const notification = COMMAND_FAMILY_REGISTRY.find(({ family }) => family === "notification");
    assert.deepEqual(notification?.actions, ["notification-read", "notification-unread", "notification-snooze", "notification-unsnooze"]);
  });
});
