import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, it } from "vitest";
import { PHASE1_ACTIVE_COMMAND_ARMS } from "../../../src/backend/runs/commands/command-arms.js";
import { COMMAND_FAMILY_REGISTRY, CommandRequestSchema } from "../../../src/rules/commands/commands.js";
import { COMMAND_FIXTURES,HASH_B,NOW,UUID_2,UUID_4 } from "../../support/fixtures/phase1c-contract-fixtures.js";
import tsconfig from "../../../tsconfig.json" with { type: "json" };
import { REPO_ROOT,repoRelative,walkFiles } from "../support/helpers/guard-files.js";

const KERNEL_PATH = "src/backend/runs/commands/command-kernel.ts";
const WORKER_COMMANDS_PATH = "src/backend/runs/commands/worker-pool-commands.ts";
const SETTINGS_COMMAND_PATH = "src/backend/runs/commands/settings-command.ts";
const REPLAY_PATH = "src/backend/runs/commands/command-replay.ts";
const RUN_LIFECYCLE_COMMANDS_PATH = "src/backend/runs/commands/run-lifecycle-commands.ts";

const COMMAND_EXECUTOR_EXPORTS = new Map<string, readonly string[]>([
  [REPLAY_PATH, ["replay"]],
  [RUN_LIFECYCLE_COMMANDS_PATH, ["executeRetry", "executeCancel", "executeDelete", "executeBump", "executePresentation"]],
  [SETTINGS_COMMAND_PATH, ["executeSettings"]],
  [WORKER_COMMANDS_PATH, ["executeWorkerPoolCommand"]],
  ["src/backend/runs/commands/start-command.ts", ["executeStartRun"]],
  ["src/backend/runs/commands/intake-commands.ts", ["executeIntake"]],
  ["src/backend/runs/commands/gate-command.ts", ["executeResolveGate"]],
  ["src/backend/runs/commands/notification-commands.ts", ["executeNotification"]],
  ["src/backend/runs/commands/write-resolution-command.ts", ["executeWriteResolution"]],
]);

const { options: moduleOptions, errors: moduleOptionErrors } = ts.convertCompilerOptionsFromJson(tsconfig.compilerOptions, REPO_ROOT);
assert.deepEqual(moduleOptionErrors, []);
const moduleCache = ts.createModuleResolutionCache(REPO_ROOT, path => path, moduleOptions);

function scanCommandExecutorImports(path: string, raw: string): string[] {
  const file = join(REPO_ROOT, path);
  const source = ts.createSourceFile(file, raw, ts.ScriptTarget.Latest);
  const imports: string[] = [];
  const executorBindings = new Set<string>();
  function resolve(specifier: ts.Node | undefined): string | undefined {
    while (specifier && ts.isParenthesizedExpression(specifier)) specifier = specifier.expression;
    if (!specifier || !ts.isStringLiteralLike(specifier)) return undefined;
    const resolved = ts.resolveModuleName(specifier.text, file, moduleOptions, ts.sys, moduleCache).resolvedModule;
    return resolved && repoRelative(resolved.resolvedFileName);
  }
  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && node.importClause && !node.importClause.isTypeOnly) {
      const target = resolve(node.moduleSpecifier);
      const names = COMMAND_EXECUTOR_EXPORTS.get(target ?? "");
      if (names && target) {
        const bindings = node.importClause.namedBindings;
        if (node.importClause.name) imports.push(`${path} -> ${target}: default import`);
        if (bindings && ts.isNamespaceImport(bindings)) imports.push(`${path} -> ${target}: namespace import`);
        if (bindings && ts.isNamedImports(bindings)) {
          for (const binding of bindings.elements) {
            const name = (binding.propertyName ?? binding.name).text;
            if (!binding.isTypeOnly && names.includes(name)) {
              imports.push(`${path} -> ${target}: ${name}`);
              executorBindings.add(binding.name.text);
            }
          }
        }
      }
    } else if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier) {
      const target = resolve(node.moduleSpecifier);
      const names = COMMAND_EXECUTOR_EXPORTS.get(target ?? "");
      const clause = node.exportClause;
      if (names && target && (!clause || !ts.isNamedExports(clause) || clause.elements.some(binding =>
        !binding.isTypeOnly && names.includes((binding.propertyName ?? binding.name).text)))) {
        imports.push(`${path} -> ${target}: re-export`);
      }
    } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
      || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
      const target = resolve(node.arguments[0]);
      if (target && COMMAND_EXECUTOR_EXPORTS.has(target)) imports.push(`${path} -> ${target}: dynamic import`);
    } else if (ts.isImportEqualsDeclaration(node) && !node.isTypeOnly && ts.isExternalModuleReference(node.moduleReference)) {
      const target = resolve(node.moduleReference.expression);
      if (target && COMMAND_EXECUTOR_EXPORTS.has(target)) imports.push(`${path} -> ${target}: namespace import`);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  for (const node of source.statements) {
    if (ts.isExportDeclaration(node) && !node.isTypeOnly && !node.moduleSpecifier && node.exportClause
      && ts.isNamedExports(node.exportClause)) {
      for (const binding of node.exportClause.elements) {
        const local = (binding.propertyName ?? binding.name).text;
        if (!binding.isTypeOnly && executorBindings.has(local)) imports.push(`${path}: re-export of ${local}`);
      }
    }
  }
  return imports;
}

function assertCommandExecutorImports(imports: readonly string[]): void {
  const expected = [...COMMAND_EXECUTOR_EXPORTS].flatMap(([target, names]) => names.map(name => `${KERNEL_PATH} -> ${target}: ${name}`));
  expected.push(`${WORKER_COMMANDS_PATH} -> ${RUN_LIFECYCLE_COMMANDS_PATH}: executeCancel`,
    `${WORKER_COMMANDS_PATH} -> ${REPLAY_PATH}: replay`, `${SETTINGS_COMMAND_PATH} -> ${REPLAY_PATH}: replay`);
  assert.deepEqual([...imports].sort(), expected.sort());
}

function readCommandScopeSources() {
  return {
    kernel: readFileSync(join(REPO_ROOT, KERNEL_PATH), "utf8"),
    worker: readFileSync(join(REPO_ROOT, WORKER_COMMANDS_PATH), "utf8"),
  };
}

/** Read-only command receipt queries: each may reach exactly one commandAudits.findByCommand(id) inside an authority read snapshot. */
const RECEIPT_QUERIES: readonly string[] = ["src/backend/runs/queries/intake-command-result.ts", "src/backend/runs/queries/worker-command-result.ts"];
function withoutIntakeCommandReceiptRead(content: string): string {
  const source = ts.createSourceFile("candidate.ts", content, ts.ScriptTarget.Latest, true);
  const auditUses: ts.PropertyAccessExpression[] = [];
  let admitted: ts.PropertyAccessExpression | undefined;
  function inspect(node: ts.Node): void {
    if (ts.isIdentifier(node) && node.text === "commandAudits" && ts.isPropertyAccessExpression(node.parent)
      && node.parent.name === node) auditUses.push(node.parent);
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && ts.isPropertyAccessExpression(node.expression.expression) && node.expression.getText(source) === "database.authority.commandAudits.findByCommand"
      && node.arguments.length === 1 && node.arguments[0].getText(source) === "id") {
      let parent: ts.Node | undefined = node.parent;
      while (parent !== undefined && !ts.isArrowFunction(parent)) parent = parent.parent;
      if (parent !== undefined && ts.isArrowFunction(parent) && ts.isCallExpression(parent.parent)
        && parent.parent.expression.getText(source) === "database.withAuthorityReadSnapshot"
        && parent.parent.arguments.length === 1 && parent.parent.arguments[0] === parent) {
        admitted = node.expression.expression;
      }
    }
    ts.forEachChild(node, inspect);
  }
  inspect(source);
  if (auditUses.length !== 1 || admitted !== auditUses[0]) return content;
  const start = admitted.name.getStart(source);
  return content.slice(0, start) + "receiptReads" + content.slice(admitted.name.end);
}

type DelegationAuditRead = Readonly<{ owner: string; id: string; guards: readonly string[]; calls?: readonly string[]; bindings?: Readonly<Record<string, string>> }>;
const DELEGATION_AUDIT_READS: Readonly<Record<string, readonly DelegationAuditRead[]>> = {
  "src/backend/storage/sqlite/command-record-row.ts": [
    { owner: "withCanonicalRunCommandScope", id: "request.commandId", guards: [
      'canonicalJsonStringify(repositories.commands.get(request.commandId))!==canonicalJsonStringify(request)',
      'repositories.commandAudits.findByCommand(request.commandId)!==undefined',
      'activeRunCommand!==undefined', '!(request.family==="ocr-review"||request.family==="start"||request.family==="run"&&(request.type==="retry"||request.type==="recover-run"||request.type==="cancel"||request.type==="resume"))', '"then"inresult',
    ], calls: ["repositories.commands.assertIdentity(request,parentCommandId)"] },
  ],
  "src/backend/storage/sqlite/delegation-root-authority.ts": [
    {
      "owner": "authenticateRunGateResume",
      "id": "gate.commandId",
      "guards": [
        "rows.some(gate=>gate.runId!==run.envelope.runId||gate.expectedVersion>=run.version)||newSet(rows.map(gate=>gate.nodeId)).size!==rows.length",
        "gate===undefined||!(\"commandId\"ingate)||gate.runId!==run.envelope.runId||gates[1]?.expectedVersion===gate.expectedVersion||String(gate.nodeId)!==String(gate.gateId)||gate.resolvedBy!==actorId||gate.checkpointFingerprint!==deriveGateResultCheckpointFingerprint(gate.result)",
        "command===undefined||!(command.family===\"gate\"&&command.type===\"resolve-gate\"||command.family===\"run\"&&command.type===\"resolve-workbook-reference-row\")||command.commandId!==gate.commandId||command.type===\"resolve-gate\"&&command.source!==\"dashboard\"||command.requestedBy!==actorId||command.requestedBy!==gate.resolvedBy||command.target.runId!==run.envelope.runId||command.target.gateId!==gate.gateId||command.target.expectedVersion!==gate.expectedVersion||command.type===\"resolve-gate\"&&!same(command.payload.result,gate.result)||audit?.result.state!==\"applied\"||audit.result.commandId!==command.commandId||!same(audit.request,command)||audit.completedAt!==gate.resolvedAt||audit.versionChanges.length!==1||!audit.versionChanges.some(change=>change.target.family===\"gate\"&&change.target.runId===run.envelope.runId&&change.target.gateId===gate.gateId&&Number(change.before)===Number(gate.expectedVersion)&&change.after===gate.expectedVersion+1)||audit.result.affectedTargets.length!==2||!audit.result.affectedTargets.some(target=>target.family===\"gate\"&&target.runId===run.envelope.runId&&target.gateId===gate.gateId)||!audit.result.affectedTargets.some(target=>target.family===\"run\"&&target.runId===run.envelope.runId)",
        "resumed===undefined||!(\"kind\"inresumed)||resumed.kind!==\"run-lifecycle\"||resumed.operation!==\"transition\"||settled===undefined||!(\"kind\"insettled)||settled.kind!==\"run-lifecycle\"||!same(settled.request,resumed)||settled.result.kind!==\"run\"||settled.result.runId!==run.envelope.runId||settled.result.appliedVersion!==gate.expectedVersion+1||settled.completedAt<gate.resolvedAt",
        "!same(CanonicalTransitionRequestSchema.parse(resumed.request),{commandId:resumeId,runId:run.envelope.runId,expectedVersion:gate.expectedVersion,lifecycle:{state:\"queued\"}})",
        "resolved?.source.kind!==\"native\"||resolved.eventId!==lifecycleCommandId(\"timeline-gate-resolved\",command.commandId)||resolved.scope.kind!==\"run\"||resolved.scope.runId!==run.envelope.runId||resolved.workflow!==run.envelope.workflow||resolved.occurredAt!==gate.resolvedAt||resolved.recordedAt!==gate.resolvedAt||event===undefined||event.runId!==run.envelope.runId||event.workflow!==run.envelope.workflow||event.traceId!==run.envelope.traceId||event.spanPath!==run.envelope.traceId||event.attempt>run.envelope.attempt||event.gate!==gate.gateId||event.ts!==gate.resolvedAt||event.resultHash!==sha256Hex(`hrauto:gate-resolved-span:v1\\0${canonicalJsonStringify(gate.result)}`)",
        "parked===undefined",
        "parked.operation!==\"worker-transition\"||parkedAudit===undefined||!(\"kind\"inparkedAudit)||parkedAudit.kind!==\"run-lifecycle\"||!same(parkedAudit.request,parked)||parkedAudit.result.kind!==\"run\"||parkedAudit.result.runId!==run.envelope.runId||parkedAudit.result.appliedVersion>gate.expectedVersion||parkedAudit.completedAt>gate.resolvedAt",
        "park.runId!==run.envelope.runId||park.lifecycle.state!==\"parked-gate\"||park.lifecycle.gateId!==gate.gateId||park.lifecycle.resumeAt!==run.envelope.startAt||park.claim.claimGeneration>run.claimGeneration||park.commandId!==lifecycleCommandId(\"executor-transition\",{runId:run.envelope.runId,generation:park.claim.claimGeneration,version:parkedAudit.result.appliedVersion-1})"
      ],
      "calls": [
        "validateNativeLifecycleRequest(resumed)",
        "validateNativeLifecycleRequest(parked)",
        "repositories.lifecycleJournal.findGatePark(run.envelope.runId,gate.gateId,gate.expectedVersion)"
      ],
      "bindings": {
        "rows": "repositories.gateResults.listByRun(run.envelope.runId)",
        "gates": "rows.toSorted((left,right)=>right.expectedVersion-left.expectedVersion)",
        "gate": "gates[0]",
        "command": "repositories.commands.get(gate.commandId)",
        "audit": "repositories.commandAudits.findByCommand(gate.commandId)",
        "resumeId": "lifecycleCommandId(\"operator-gate\",command.commandId)",
        "resumed": "repositories.lifecycleJournal.getCommand(resumeId)",
        "settled": "repositories.lifecycleJournal.findAuditByCommand(resumeId)",
        "resolved": "repositories.timelineEvents.get(lifecycleCommandId(\"timeline-gate-resolved\",command.commandId))",
        "event": "resolved?.payload.kind===\"span\"&&resolved.payload.event.t===\"gate.resolved\"?resolved.payload.event:undefined",
        "parked": "repositories.lifecycleJournal.findGatePark(run.envelope.runId,gate.gateId,gate.expectedVersion)",
        "parkedAudit": "repositories.lifecycleJournal.findAuditByCommand(parked.commandId)",
        "park": "CanonicalWorkerTransitionRequestSchema.parse(parked.request)"
      }
    },
    { owner: "authenticateRunPriority", id: "source.commandId", guards: ['audit?.result.state!=="applied"', "!same(audit.request,source)", "Number(changes[0].before)!==Number(source.target.expectedVersion)"], calls: ["validateNativeLifecycleRequest(command)"] },
    { owner: "authenticateStartPlanRun", id: "plan.consumedBy.commandId", guards: ["audit===undefined", "!same(audit.request,command)", "command.target.expectedVersion!==plan.version-1"], calls: ["validateNativeLifecycleRequest(created)", "authenticateRunGateResume(repositories,run,command.requestedBy)"] },
    { owner: "authenticateRoot", id: "request.sourceCommandId", guards: ['audit?.result.state!=="applied"', "!same(audit.request,source)", "source.target.expectedVersion!==request.expectedVersion"], calls: ["validateNativeLifecycleRequest(origin)", "authenticateRunGateResume(repositories,run,source.requestedBy)"] },
  ],
  "src/backend/storage/sqlite/delegation-authority.ts": [
    { owner: "authenticateOperatorSource", id: "source.commandId", guards: ['audit.result.state!=="applied"', "canonicalJsonStringify(audit.request)!==canonicalJsonStringify(source)", "source.requestedBy!==LOCAL_OPERATOR_ACTOR_ID"], calls: ["assertCanonicalRunCommandScope(repositories,source)"] },
    { owner: "resolveDelegationRetry", id: "retry.sourceCommandId", guards: ['sourceAudit!==undefined&&(sourceAudit.result.state!=="applied"||canonicalJsonStringify(sourceAudit.request)!==canonicalJsonStringify(source))', "canonicalJsonStringify(sourceAudit.request)!==canonicalJsonStringify(source)", "lifecycleRequest.sourceCommandId!==source.commandId"], calls: ["authenticateOperatorSource(repositories,source,sourceAudit)", "assertDelegationReplacement(repositories,original,child,next)", "authenticateContinuationRetryOwner(repositories,child,retry.continuationOwner,retry.sourceCommandId)"] },
    { owner: "delegationCancellationAvailability", id: "source.commandId", guards: ['run?.lifecycle.state!=="terminal"', "repositories.commandAudits.findByCommand(source.commandId)===undefined"], calls: ["readDelegationCancellation(repositories,runId)"] },
    { owner: "readDelegationCancellation", id: "source.commandId", guards: ['authored?.result.state!=="applied"', "canonicalJsonStringify(authored.request)!==canonicalJsonStringify(source)", "canonicalJsonStringify(audit.request)!==canonicalJsonStringify(retained)"], calls: ["authenticateCancellationSource(repositories,run,request.cancellationSource)"] },
  ],
  "src/backend/runs/workbooks.ts": [
    { owner: "authenticateCrmReferenceChoice", id: "gate.commandId", guards: [
      "data===undefined||data.rows.state!==\"resolve-required\"||!(\"commandId\"ingate)",
      "complete===undefined||gate.runId!==run.envelope.runId||gate.gateId!==CRM_DOCUMENT_ROW_CHOICE_GATE_ID||String(gate.nodeId)!==String(gate.gateId)||gate.result.schemaHash!==deriveSchemaHash(CrmDocumentRowChoiceSchema,\"output\")||gate.checkpointFingerprint!==deriveGateResultCheckpointFingerprint(gate.result)||canonicalJsonStringify(gate.result.value)!==canonicalJsonStringify(complete)||command?.family!==\"run\"||command.type!==\"resolve-workbook-reference-row\"||command.target.runId!==gate.runId||command.target.gateId!==gate.gateId||command.target.expectedVersion!==gate.expectedVersion||command.requestedBy!==gate.resolvedBy||audit?.result.state!==\"applied\"||audit.completedAt!==gate.resolvedAt||canonicalJsonStringify(audit.request)!==canonicalJsonStringify(command)||event===undefined||event.gate!==gate.gateId||event.ts!==gate.resolvedAt||event.resultHash!==sha256Hex(`hrauto:gate-resolved-span:v1\\0${canonicalJsonStringify(gate.result)}`)||recorded===undefined",
    ], bindings: {
      data: "crmReferenceRows(repositories,run,retained)",
      complete: "completeCrmReferenceChoice(data,crmReferenceSelections(repositories,run,data))",
      command: "repositories.commands.get(gate.commandId)",
      audit: "repositories.commandAudits.findByCommand(gate.commandId)",
      recorded: "repositories.timelineEvents.get(lifecycleCommandId(\"timeline-gate-resolved\",gate.commandId))",
      event: "recorded?.payload.kind===\"span\"&&recorded.payload.event.t===\"gate.resolved\"?recorded.payload.event:undefined",
    } },
    { owner: "crmReferenceSelections", id: "event.commandId", guards: [
      "record.source.kind!==\"native\"||record.scope.kind!==\"run\"||record.scope.runId!==run.envelope.runId||record.workflow!==run.envelope.workflow||event.runId!==run.envelope.runId||event.workflow!==run.envelope.workflow||event.traceId!==run.envelope.traceId||event.attempt!==data.sourceAttempt||event.gateId!==CRM_DOCUMENT_ROW_CHOICE_GATE_ID||anchor===undefined||source===undefined||chosenDigest!==event.referenceDigest||event.checkpointDigest!==data.checkpointDigest||record.occurredAt!==event.at||record.recordedAt!==event.at||record.eventId!==deriveStableUuid(\"workbook-reference-row-selected\",event.commandId)||command?.family!==\"run\"||command.type!==\"resolve-workbook-reference-row\"||command.target.runId!==event.runId||command.target.gateId!==event.gateId||command.target.key!==event.key||command.target.referenceDigest!==anchor.digest||command.target.libraryId!==anchor.value.snapshot.libraryId||command.target.typeId!==ONBOARDING_ROSTER_TYPE_ID||command.target.workbookVersion!==anchor.value.snapshot.version||(command.payload.referenceDigest===undefined)!==(data.sources.length===1)||command.payload.workbookVersion!==undefined&&command.payload.workbookVersion!==source.value.snapshot.version||command.payload.sheetId!==event.sheetId||command.payload.rowId!==event.rowId||audit?.result.state!==\"applied\"||audit.completedAt!==event.at||canonicalJsonStringify(audit.request)!==canonicalJsonStringify(command)||candidate===undefined||selections.has(event.key)",
    ], bindings: {
      selections: "newMap<string,CrmSelection>()",
      anchor: "data.sources[0]",
      event: "record.payload",
      command: "repositories.commands.get(event.commandId)",
      audit: "repositories.commandAudits.findByCommand(event.commandId)",
      person: "data.rows.people.find(person=>person.subject.value===event.key)",
      source: "data.sources.find(item=>item.digest===event.referenceDigest)",
      referenceCommand: "command?.type===\"resolve-workbook-reference-row\"?command:undefined",
      chosenDigest: "referenceCommand?.payload.referenceDigest??(data.sources.length===1?anchor?.digest:undefined)",
      candidate: "person?.resolution.state===\"resolve-required\"?person.resolution.candidates.find(candidate=>candidate.referenceDigest===event.referenceDigest&&candidate.row.worksheetId===event.sheetId&&candidate.row.rowId===event.rowId):undefined",
    } },
    { owner: "authenticateOnboardingRosterChoice", id: "gate.commandId", guards: [
      'recorded?.source.kind!=="native"', 'recorded.eventId!==eventId', 'recorded.scope.kind!=="run"',
      'recorded.scope.runId!==run.envelope.runId', 'recorded.workflow!==run.envelope.workflow', 'native===undefined',
      'native.runId!==gate.runId', 'native.workflow!==run.envelope.workflow', 'native.traceId!==run.envelope.traceId',
      'native.gate!==gate.gateId', 'native.attempt>run.envelope.attempt', 'native.ts!==gate.resolvedAt',
      'recorded.occurredAt!==gate.resolvedAt',
      'native.resultHash!==sha256Hex(`hrauto:gate-resolved-span:v1\\0${canonicalJsonStringify(gate.result)}`)',
      'roster.state!=="resolve-required"', 'gate.runId!==run.envelope.runId', 'gate.gateId!==ONBOARDING_ROSTER_GATE_ID',
      'gate.nodeId!==ONBOARDING_ROSTER_GATE_ID', '!("resolvedBy"ingate)',
      'gate.checkpointFingerprint!==deriveGateResultCheckpointFingerprint(gate.result)',
      'command?.family!=="run"', 'command.type!=="resolve-workbook-reference-row"',
      'command.target.runId!==gate.runId', 'command.target.gateId!==gate.gateId',
      'command.target.expectedVersion!==gate.expectedVersion', 'command.requestedBy!==gate.resolvedBy',
      'command.target.referenceDigest!==binding.referenceDigest', 'command.target.libraryId!==binding.workbookId',
      'command.target.typeId!==binding.workbookType', 'command.target.key!==binding.rowKey.email',
      'row.binding.referenceDigest!==(command.payload.referenceDigest??reference.digest)',
      '!group.some(candidate=>candidate.digest===row.binding.referenceDigest&&candidate.value.snapshot.libraryId===row.binding.workbookId&&candidate.value.snapshot.worksheets.some(sheet=>sheet.sheetId===row.binding.sheetId))',
      'row.binding.workbookType!==binding.workbookType', 'row.binding.rowKey.email!==binding.rowKey.email',
      'row.binding.workbookVersion!==(command.payload.workbookVersion??command.target.workbookVersion)',
      'row.binding.capturedAt!==gate.resolvedAt',
      'row.binding.sheetId!==command.payload.sheetId', 'row.binding.rowId!==command.payload.rowId',
      'audit?.result.state!=="applied"', 'canonicalJsonStringify(audit.request)!==canonicalJsonStringify(command)',
    ], calls: ['onboardingReference(run)'], bindings: {
      row: 'schemaBoundValueSchema(OnboardingRosterChoiceSchema,deriveSchemaHash(OnboardingRosterChoiceSchema,"output")).parse(gate.result).value.row',
      command: '"commandId"ingate?repositories.commands.get(gate.commandId):undefined',
      audit: '"commandId"ingate?repositories.commandAudits.findByCommand(gate.commandId):undefined',
      eventId: '"commandId"ingate?lifecycleCommandId("timeline-gate-resolved",gate.commandId):undefined',
      recorded: 'eventId===undefined?undefined:repositories.timelineEvents.get(eventId)',
      native: 'recorded?.payload.kind==="span"&&recorded.payload.event.t==="gate.resolved"?recorded.payload.event:undefined',
    } },
  ],
  "src/backend/runs/lifecycle/delegation-admission.ts": [
    { owner: "admitDelegation", id: "gate.commandId", guards: ['audit?.result.state!=="applied"', "canonicalJsonStringify(audit.request)!==canonicalJsonStringify(command)", "command.target.expectedVersion!==gate.expectedVersion", "command.requestedBy!==gate.resolvedBy"] },
  ],
  "src/backend/runs/lifecycle/ocr-review-authority.ts": [
    { owner: "readOcrReviewAuthority", id: "record.origin.commandId", guards: [
      'existence.state!=="present"', 'existence.disposition!=="live"', 'existence.run.envelope.workflow!=="ocr"',
      'latest.sourceRunId!==runId', 'record===undefined', 'record.sourceRunId!==runId', 'record.revision!==revision', 'checkpoint===undefined', 'checkpoint.runId!==runId',
      '!same(checkpoint.output.value,record.seed)', 'record.origin.digest!==sha256Hex(canonicalJsonStringify(checkpoint))',
      '!same(record.origin.checkpoint,timelineCheckpointReference(checkpoint))', '!same(record.records,rebuilt.records)',
      'previous===undefined', 'request?.family!=="ocr-review"', 'request.commandId!==record.origin.commandId', 'request.requestedBy!=="local-operator"', 'request.source!=="dashboard"',
      'audit?.result.state!=="applied"', 'audit.result.commandId!==request.commandId', '!same(audit.request,request)',
      '!same(applyOcrReviewCommand(previous,request,record.createdAt,record),record)',
      'command===undefined', 'command.kind!=="run-lifecycle"', 'command.operation!=="transition"',
      'settled===undefined', '!same(settled.request,command)', 'settled.result.runId!==runId',
      'change===undefined', 'change.after!==Number(change.before)+1', 'change.after!==settled.result.appliedVersion',
      'existence.run.version<change.after', 'audit.completedAt!==record.createdAt',
      'mutation.sourceCommandId!==request.commandId', 'mutation.runId!==runId', 'mutation.ocrReviewRevision!==revision',
      'Number(mutation.expectedVersion)!==Number(change.before)',
    ], calls: ['authenticateOcrOperator(repositories,reader,existence.run)', 'CanonicalTransitionRequestSchema.parse(command.request)'],
      bindings: { subset: 'rebuildOcrReviewRecords(record.seed,previous,"subset",baseline)',
        rebuilt: 'same(record.records,subset.records)?subset:rebuildOcrReviewRecords(record.seed,previous,"exact",baseline)' } },
    { owner: "readOcrSnapshotsAuthority", id: "snapshot.snapshotId", guards: [
      'snapshot.sourceRunId!==review.run.envelope.runId', 'revision===undefined', 'snapshot.reviewDigest!==ocrReviewDigest(revision)',
      '!snapshot.selectedRecordIds.every(id=>revision.records.some(record=>record.recordId===id))',
      '!same(snapshot.records,snapshot.selectedRecordIds.map(id=>revision.records.find(record=>record.recordId===id)))',
      'command?.family!=="gate"', 'command.commandId!==snapshot.snapshotId', 'command.target.runId!==snapshot.sourceRunId', 'String(command.target.gateId)!=="approve-records"',
      'command.requestedBy!=="local-operator"', 'command.source!=="dashboard"', 'audit?.result.state!=="applied"',
      'audit.result.commandId!==command.commandId', '!same(audit.request,command)',
      'command.payload.ocrApproval?.expectedRevision!==snapshot.revision', 'command.payload.ocrApproval.reviewDigest!==snapshot.reviewDigest',
      '!same(command.payload.ocrApproval.selectedRecordIds,snapshot.selectedRecordIds)',
      'gate===undefined', 'gate.runId!==snapshot.sourceRunId', 'String(gate.nodeId)!=="approve-records"',
      'String(gate.gateId)!=="approve-records"', 'gate.expectedVersion!==command.target.expectedVersion',
      'gate.resolvedBy!==snapshot.approvedBy', 'gate.resolvedAt!==snapshot.approvedAt', 'audit.completedAt!==snapshot.approvedAt',
      '!same(command.payload.result,gate.result)', '!same(gate.result.value,reference)',
      'mutation===undefined', 'mutation.kind!=="run-lifecycle"', 'mutation.operation!=="transition"',
      'settled===undefined', '!same(settled.request,mutation)', 'settled.result.runId!==snapshot.sourceRunId',
      'settled.result.appliedVersion!==command.target.expectedVersion+1',
      'queued.lifecycle.state!=="queued"', 'queued.runId!==snapshot.sourceRunId', 'queued.expectedVersion!==command.target.expectedVersion',
    ], calls: ['CanonicalTransitionRequestSchema.parse(mutation.request)'] },
  ],
  "src/backend/runs/commands/ocr-source-service.ts": [
    { owner: "readOcrCommandResult", id: "commandId", guards: [
      'review===undefined', 'command===undefined', 'command.commandId!==commandId', 'command.family!=="ocr-review"&&command.family!=="gate"',
      'command.target.runId!==runId', 'command.requestedBy!=="local-operator"', 'command.source!=="dashboard"',
      'audit===undefined', 'canonicalJsonStringify(audit.request)!==canonicalJsonStringify(command)',
      'audit.result.state!=="applied"', 'audit.result.commandId!==command.commandId',
      'revision?.origin.kind!=="command"', 'revision.origin.commandId!==commandId',
      '!readOcrSnapshotsAuthority(repositories,review).some(snapshot=>snapshot.snapshotId===commandId)',
    ], calls: ['readOcrReviewAuthority(repositories,reader,runId)', 'CommandIdSchema.parse(commandId)'] },
  ],
};

const STOP_CANCELS = 'constcancels=[...(run===undefined?[]:[journaledResetCancel(repositories,run,false)]),...workerPauseHeldRuns(repositories,member.workerId,"paused").map(held=>journaledResetCancel(repositories,held,true))];';

/** Stop ends the current run (fenced write finish) and every paused-held run (no finish) through journaledResetCancel, inside the stop-worker admission transaction. */
function stopCancelsDeclaration(kernel: ts.SourceFile): ts.VariableStatement | undefined {
  const found: ts.VariableStatement[] = [];
  function find(node: ts.Node): void {
    if (ts.isCaseClause(node) && node.expression.getText(kernel) === '"stop-worker"') {
      function inCase(inner: ts.Node): void {
        if (ts.isVariableStatement(inner) && inner.declarationList.declarations.some(declaration => declaration.name.getText(kernel) === "cancels")) found.push(inner);
        ts.forEachChild(inner, inCase);
      }
      inCase(node);
    }
    ts.forEachChild(node, find);
  }
  find(kernel);
  return found.length === 1 ? found[0] : undefined;
}

function isStopHeldCancelAdmission(kernel: ts.SourceFile): boolean {
  const compact = (node: ts.Node): string => node.getText(kernel).replace(/\s+/gu, "");
  const declaration = stopCancelsDeclaration(kernel);
  if (declaration === undefined || compact(declaration) !== STOP_CANCELS) return false;
  let callback: ts.Node | undefined = declaration.parent;
  while (callback !== undefined && !ts.isArrowFunction(callback)) callback = callback.parent;
  if (callback === undefined || !ts.isArrowFunction(callback) || !ts.isCallExpression(callback.parent) || compact(callback.parent.expression) !== "transact" || callback.body !== declaration.parent) return false;
  let clause: ts.Node | undefined = callback;
  while (clause !== undefined && !ts.isCaseClause(clause)) clause = clause.parent;
  if (clause === undefined || !ts.isCaseClause(clause)) return false;
  const journaled: ts.CallExpression[] = [], scopedOrBare: ts.CallExpression[] = [];
  function calls(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const name = compact(node.expression);
      if (name === "journaledResetCancel") journaled.push(node);
      if (name === "executeCancel" || name === "withCanonicalRunCommandScope") scopedOrBare.push(node);
    }
    ts.forEachChild(node, calls);
  }
  calls(clause);
  let owner: ts.Node | undefined = scopedOrBare[0];
  while (owner !== undefined && !(ts.isVariableDeclaration(owner) && owner.name.getText(kernel) === "journaledResetCancel")) owner = owner.parent;
  return journaled.length === 2 && scopedOrBare.length === 2 && owner !== undefined
    && scopedOrBare.every(call => { let node: ts.Node | undefined = call; while (node !== undefined && node !== owner) node = node.parent; return node === owner; });
}

function withoutDelegationAuditReads(content: string, path: string, commandSources: ReturnType<typeof readCommandScopeSources>): string {
  const specs = DELEGATION_AUDIT_READS[path];
  if (specs === undefined) return content;
  const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true);
  const compact = (node: ts.Node): string => node.getText(source).replace(/\s+/gu, "");
  const importsRepository = source.statements.some(node => ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)
    && node.moduleSpecifier.text === (path === "src/backend/runs/workbooks.ts" ? "../storage/sqlite/authority-repositories.js"
      : ["src/backend/runs/lifecycle/delegation-admission.ts", "src/backend/runs/lifecycle/ocr-review-authority.ts",
        "src/backend/runs/commands/ocr-source-service.ts"].includes(path) ? "../../storage/sqlite/authority-repositories.js" : "./authority-repositories.js")
    && node.importClause?.namedBindings !== undefined && ts.isNamedImports(node.importClause.namedBindings)
    && node.importClause.namedBindings.elements.some(binding => binding.name.text === "AuthorityRepositories" && binding.propertyName === undefined));
  if (!importsRepository) return content;
  const uses: ts.PropertyAccessExpression[] = [];
  function findUses(node: ts.Node): void {
    if (ts.isPropertyAccessExpression(node) && node.name.text === "commandAudits") uses.push(node);
    ts.forEachChild(node, findUses);
  }
  findUses(source);
  if (uses.length !== specs.length) return content;
  const admitted: ts.PropertyAccessExpression[] = [];
  for (const spec of specs) {
    const owner = source.statements.filter(ts.isFunctionDeclaration).find(fn => fn.name?.text === spec.owner);
    if (owner?.body === undefined) return content;
    if (spec.owner !== "admitDelegation" && (owner.parameters[0]?.name.getText(source) !== "repositories"
      || owner.parameters[0].type?.getText(source) !== "AuthorityRepositories")) return content;
    const candidates = uses.filter(use => { let node: ts.Node | undefined = use.parent;
      while (node !== undefined && !ts.isFunctionDeclaration(node)) node = node.parent;
      return node === owner;
    });
    if (candidates.length !== 1) return content;
    const use = candidates[0], method = use.parent, call = method.parent;
    if (compact(use.expression) !== "repositories" || !ts.isPropertyAccessExpression(method) || method.name.text !== "findByCommand"
      || !ts.isCallExpression(call) || call.expression !== method || call.arguments.length !== 1 || compact(call.arguments[0]) !== spec.id) return content;
    const guards = new Set<string>(), calls = new Set<string>(), bindings = new Map<string, string>();
    function facts(node: ts.Node): void {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined) bindings.set(node.name.text, compact(node.initializer));
      if (ts.isCallExpression(node)) calls.add(compact(node));
      if (ts.isIfStatement(node)) {
        let refuses = false;
        function refusal(statement: ts.Node): void {
          const literal = (expression: ts.Expression): ts.Expression => ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression) || ts.isParenthesizedExpression(expression) ? literal(expression.expression) : expression;
          const returned = ts.isReturnStatement(statement) ? statement.expression : undefined;
          const unavailable = returned !== undefined && ts.isObjectLiteralExpression(returned)
            && returned.properties.some(property => {
              if (!ts.isPropertyAssignment(property) || property.name.getText(source) !== "state") return false;
              const value = literal(property.initializer);
              return ts.isStringLiteral(value) && value.text === "unavailable";
            });
          if (ts.isThrowStatement(statement) || returned !== undefined && (returned.kind === ts.SyntaxKind.FalseKeyword || unavailable)) refuses = true;
          ts.forEachChild(statement, refusal);
        }
        refusal(node.thenStatement);
        if (refuses) {
          function condition(expression: ts.Node): void {
            if (ts.isBinaryExpression(expression) || ts.isPrefixUnaryExpression(expression) || ts.isConditionalExpression(expression)) guards.add(compact(expression));
            ts.forEachChild(expression, condition);
          }
          condition(node.expression);
        }
      }
      ts.forEachChild(node, facts);
    }
    facts(owner.body);
    if (spec.guards.some(proof => !guards.has(proof)) || spec.calls?.some(proof => !calls.has(proof))
      || Object.entries(spec.bindings ?? {}).some(([name, value]) => bindings.get(name) !== value)) return content;
    if (spec.owner === "withCanonicalRunCommandScope") {
      const installed = owner.body.statements.some(statement => ts.isExpressionStatement(statement)
        && compact(statement) === "activeRunCommand={repositories,request:canonicalJsonStringify(request)};");
      const guarded = owner.body.statements.filter(ts.isTryStatement);
      if (!installed || guarded.length !== 1 || guarded[0].finallyBlock === undefined
        || compact(guarded[0].finallyBlock) !== "{activeRunCommand=undefined;}"
        || guarded[0].tryBlock.statements.length !== 3
        || compact(guarded[0].tryBlock.statements[0]) !== "constresult=work();"
        || !ts.isReturnStatement(guarded[0].tryBlock.statements[2])
        || compact(guarded[0].tryBlock.statements[2]) !== "returnresult;") return content;
    }
    if (spec.owner === "admitDelegation") {
      if (owner.parameters[0]?.name.getText(source) !== "dependencies" || owner.parameters[0].type?.getText(source) !== "RunRecordServiceDependencies"
        || !source.statements.some(node => ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)
          && node.moduleSpecifier.text === "./run-record-service.js" && node.importClause?.namedBindings !== undefined
          && ts.isNamedImports(node.importClause.namedBindings) && node.importClause.namedBindings.elements.some(binding => binding.name.text === "RunRecordServiceDependencies" && binding.propertyName === undefined))) return content;
      let callback: ts.Node | undefined = call.parent;
      while (callback !== undefined && !ts.isArrowFunction(callback)) callback = callback.parent;
      // The gate read sits inside its map callback; locate the actual authority callback above it.
      while (callback !== undefined && !(ts.isArrowFunction(callback) && ts.isCallExpression(callback.parent)
        && compact(callback.parent.expression) === "dependencies.database.withAuthorityTransaction")) callback = callback.parent;
      if (callback === undefined || !ts.isArrowFunction(callback) || callback.parameters[0]?.name.getText(source) !== "repositories") return content;
    }
    admitted.push(use);
  }
  if (path.endsWith("/command-record-row.ts")) {
    const kernel = ts.createSourceFile(KERNEL_PATH, commandSources.kernel, ts.ScriptTarget.Latest, true);
    const worker = ts.createSourceFile(WORKER_COMMANDS_PATH, commandSources.worker, ts.ScriptTarget.Latest, true);
    const importsScope = (owner: ts.SourceFile) => owner.statements.some(node => ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)
      && node.moduleSpecifier.text === "../../storage/sqlite/command-record-row.js" && node.importClause?.namedBindings !== undefined
      && ts.isNamedImports(node.importClause.namedBindings) && node.importClause.namedBindings.elements.some(binding => binding.name.text === "withCanonicalRunCommandScope" && binding.propertyName === undefined));
    if (!importsScope(kernel) || !importsScope(worker)) return content;
    function scopeCalls(owner: ts.SourceFile): ts.CallExpression[] {
      const calls: ts.CallExpression[] = [];
      function find(node: ts.Node): void {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
          && node.expression.text === "withCanonicalRunCommandScope") calls.push(node);
        ts.forEachChild(node, find);
      }
      find(owner);
      return calls;
    }
    const argumentsOf = (call: ts.CallExpression) => call.arguments.map(node => node.getText().replace(/\s+/gu, "")).join(",");
    const workerCalls = scopeCalls(worker), calls = scopeCalls(kernel);
    if (workerCalls.length !== 1 || argumentsOf(workerCalls[0]) !== "repositories,cancel,()=>executeCancel(dependencies,repositories,cancel,now,!held)"
      || calls.length !== 1 || argumentsOf(calls[0]) !== "repositories,request,()=>dispatchActive(dependencies,repositories,request,now,auditId),parentCommandId") return content;
    // Reset's own Cancel is journaled inside the Reset's transaction: commands.insert before the scope, commandAudits.insert after.
    let resetOwner: ts.Node | undefined = workerCalls[0].parent;
    while (resetOwner !== undefined && !ts.isArrowFunction(resetOwner)) resetOwner = resetOwner.parent;
    if (resetOwner === undefined || !ts.isArrowFunction(resetOwner) || !ts.isVariableDeclaration(resetOwner.parent)
      || resetOwner.parent.name.getText(worker) !== "journaledResetCancel") return content;
    const resetBefore: ts.CallExpression[] = [], resetAfter: ts.CallExpression[] = [], resetStray: ts.CallExpression[] = [];
    function resetJournal(node: ts.Node): void {
      if (ts.isCallExpression(node)) {
        const expression = node.expression.getText(worker);
        if (expression === "repositories.commands.insert" && node.getText(worker) === "repositories.commands.insert(cancel)") resetBefore.push(node);
        else if (expression === "repositories.commandAudits.insert") resetAfter.push(node);
        else if (expression.startsWith("repositories.command")) resetStray.push(node);
      }
      ts.forEachChild(node, resetJournal);
    }
    resetJournal(resetOwner.body);
    if (resetBefore.length !== 1 || resetAfter.length !== 1 || resetStray.length !== 0 || resetBefore[0].end >= workerCalls[0].getStart(worker)
      || workerCalls[0].end >= resetAfter[0].getStart(worker)) return content;
    if (!isStopHeldCancelAdmission(worker)) return content;
    const selection = calls[0].parent;
    if (!ts.isConditionalExpression(selection) || selection.whenTrue !== calls[0]
      || selection.condition.getText(kernel).replace(/\s+/gu, "") !== 'request.family==="ocr-review"||request.family==="start"||request.family==="run"&&(request.type==="retry"||request.type==="cancel"||request.type==="resume")') return content;
    let callback: ts.Node | undefined = calls[0].parent;
    while (callback !== undefined && !ts.isArrowFunction(callback)) callback = callback.parent;
    if (callback === undefined || !ts.isArrowFunction(callback) || !ts.isCallExpression(callback.parent)
      || callback.parent.expression.getText(kernel) !== "dependencies.authority.withAuthorityTransaction") return content;
    // Shared admission returns terminal replays before either caller can reach canonical application.
    const effect = callback.parent;
    let owner: ts.Node | undefined = effect.parent;
    while (owner !== undefined && !ts.isArrowFunction(owner)) owner = owner.parent;
    if (owner === undefined || !ts.isArrowFunction(owner) || !ts.isVariableDeclaration(owner.parent)
      || owner.parent.name.getText(kernel) !== "applyCommand") return content;
    const helpers: ts.VariableDeclaration[] = [], starts: ts.MethodDeclaration[] = [];
    const helperCalls: ts.CallExpression[] = [];
    let escapedHelper = false;
    function sharedPaths(node: ts.Node): void {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
        && ["admitCommand", "executeSync"].includes(node.name.text)) helpers.push(node);
      if (ts.isMethodDeclaration(node) && node.name.getText(kernel) === "executeStart") starts.push(node);
      if (ts.isIdentifier(node) && ["admitCommand", "applyCommand"].includes(node.text)) {
        if (ts.isCallExpression(node.parent) && node.parent.expression === node) helperCalls.push(node.parent);
        else if (!ts.isVariableDeclaration(node.parent) || node.parent.name !== node) escapedHelper = true;
      }
      ts.forEachChild(node, sharedPaths);
    }
    sharedPaths(kernel);
    const admissionOwner = helpers.find(node => node.name.getText(kernel) === "admitCommand")?.initializer;
    const syncOwner = helpers.find(node => node.name.getText(kernel) === "executeSync")?.initializer;
    if (helpers.length !== 2 || starts.length !== 1 || escapedHelper || helperCalls.length !== 4
      || admissionOwner === undefined || !ts.isArrowFunction(admissionOwner)
      || syncOwner === undefined || !ts.isArrowFunction(syncOwner) || starts[0].body === undefined) return content;
    const syncText = syncOwner.body.getText(kernel).replace(/\s+/gu, ""), startText = starts[0].body.getText(kernel).replace(/\s+/gu, "");
    if (!syncText.includes("constreplayed=admitCommand(request,parentCommandId,preferenceCurrent);if(replayed!==undefined)returnreplayed;")
      || !syncText.endsWith("returnapplyCommand(request,parentCommandId,preferenceCurrent);}")
      || !startText.includes("constreplayed=admitCommand(request,undefined,assertEffectCurrent);if(replayed!==undefined)returnreplayed;admitted=true;")
      || !startText.includes("returnapplyCommand(request,undefined,assertEffectCurrent);")
      || startText.indexOf("awaitdependencies.preflight.prepare(scope,newAbortController().signal)") <= startText.indexOf("admitted=true;")
      || startText.indexOf("returnapplyCommand(") <= startText.indexOf("awaitdependencies.preflight.prepare(")) return content;
    const expectedCalls = ["request,parentCommandId,preferenceCurrent", "request,undefined,assertEffectCurrent"];
    for (const name of ["admitCommand", "applyCommand"]) {
      const actual = helperCalls.filter(call => call.expression.getText(kernel) === name).map(argumentsOf).sort();
      if (JSON.stringify(actual) !== JSON.stringify([...expectedCalls].sort())) return content;
    }
    const transactions: ts.CallExpression[] = [], inserts: ts.CallExpression[] = [], audits: ts.CallExpression[] = [];
    function journal(node: ts.Node): void {
      if (ts.isCallExpression(node)) {
        const expression = node.expression.getText(kernel);
        if (expression === "dependencies.authority.withAuthorityTransaction") transactions.push(node);
        if (expression === "repositories.commands.insert") inserts.push(node);
        if (expression === "repositories.commandAudits.insert") audits.push(node);
      }
      ts.forEachChild(node, journal);
    }
    journal(admissionOwner.body);
    journal(owner.body);
    const admission = transactions[0];
    if (transactions.length !== 2 || transactions[1] !== effect || inserts.length !== 1 || audits.length !== 1
      || inserts[0].getStart(kernel) <= admission.getStart(kernel) || inserts[0].end >= admission.end
      || calls[0].end >= audits[0].getStart(kernel) || audits[0].end >= effect.end) return content;
    const admissionText = admission.getText(kernel).replace(/\s+/gu, "");
    if (!admissionText.includes("repositories.commands.assertIdentity(request,parentCommandId);repositories.commands.insert(request,parentCommandId);if(repositories.commandAudits.findByCommand(request.commandId)===undefined)returnundefined;if(request.family===\"assistant-model-preference\")repositories.assistantModelPreference.get();returnreplay(dependencies,repositories,request,")
      || !admissionOwner.body.getText(kernel).replace(/\s+/gu, "").startsWith("{return" + admissionText)
      || !owner.body.getText(kernel).replace(/\s+/gu, "").includes("constresult=dependencies.authority.withAuthorityTransaction(")) return content;
  }
  if (path === "src/backend/runs/commands/ocr-source-service.ts") {
    const owner = source.statements.filter(ts.isFunctionDeclaration).find(node => node.name?.text === "readOcrCommandResult");
    if (owner === undefined || ts.getModifiers(owner)?.some(node => node.kind === ts.SyntaxKind.ExportKeyword) === true) return content;
    const references: ts.Identifier[] = [];
    function find(node: ts.Node): void {
      if (ts.isIdentifier(node) && node.text === "readOcrCommandResult" && node !== owner?.name) references.push(node);
      ts.forEachChild(node, find);
    }
    find(source);
    if (references.length !== 1 || !ts.isCallExpression(references[0].parent) || references[0].parent.expression !== references[0]) return content;
    const call = references[0].parent;
    const statement = call.parent, callback = statement.parent;
    if (!ts.isReturnStatement(statement) || !ts.isBlock(callback) || !ts.isArrowFunction(callback.parent)
      || !ts.isCallExpression(callback.parent.parent) || compact(callback.parent.parent.expression) !== "input.database.withAuthorityReadSnapshot"
      || compact(callback) !== "{input.assertCurrent();returnreadOcrCommandResult(input.database.authority,input.reader,runId,commandId);}") return content;
  }
  for (const use of admitted.sort((left, right) => right.name.getStart(source) - left.name.getStart(source))) {
    content = content.slice(0, use.name.getStart(source)) + "receiptReads" + content.slice(use.name.end);
  }
  return content;
}

/** Stop held-cancel negative controls: held cancels outside the admission transaction, the wrong pause state, a missing or unjournaled held cancel, and swapped finish flags. */
function stopHeldCancelMutants(kernel: string): readonly string[] {
  const parsed = ts.createSourceFile("kernel.ts", kernel, ts.ScriptTarget.Latest, true);
  const declaration = stopCancelsDeclaration(parsed);
  assert.ok(declaration);
  const statement = kernel.slice(declaration.getStart(parsed), declaration.end);
  const held = "...workerPauseHeldRuns(repositories, member.workerId, \"paused\").map(held => journaledResetCancel(repositories, held, true))";
  const current = "run === undefined ? [] : [journaledResetCancel(repositories, run, false)]";
  assert.ok(statement.includes(held) && statement.includes(current));
  const without = kernel.slice(0, declaration.getStart(parsed)) + kernel.slice(declaration.end);
  return [
    without.replace('catch (error) { if (workerEffectRefusal(request, error) === undefined) throw error; }\n      return result;', `catch (error) { if (workerEffectRefusal(request, error) === undefined) throw error; }\n      ${statement}\n      return result;`),
    kernel.replace(statement, statement.replace('"paused"', '"requested"')),
    kernel.replace(statement, statement.replace(`, ${held}`, "").replace(held, "")),
    kernel.replace(statement, statement.replace("journaledResetCancel(repositories, held, true)", "executeCancel(dependencies, repositories, held, now, false)")),
    kernel.replace(statement, statement.replace("run, false", "run, true").replace("held, true", "held, false")),
    kernel.replace(statement, statement.replace("run, false", "run, true")),
    kernel.replace(statement, statement.replace("held, true", "held, false")),
  ];
}

describe("finite native delegation audit read ownership", () => {
  for (const [path, specs] of Object.entries(DELEGATION_AUDIT_READS)) {
    it(`retains exact proof-bound reads and refuses altered authority in ${path}`, () => {
      const source = readFileSync(join(REPO_ROOT, path), "utf8");
      const commandSources = readCommandScopeSources();
      assert.ok(!withoutDelegationAuditReads(source, path, commandSources).includes("commandAudits"));
      const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
      const calls: ts.CallExpression[] = [], expressions: ts.Node[] = [];
      function visit(node: ts.Node): void {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
          && ts.isPropertyAccessExpression(node.expression.expression) && node.expression.expression.name.text === "commandAudits") calls.push(node);
        if (ts.isBinaryExpression(node) || ts.isPrefixUnaryExpression(node) || ts.isConditionalExpression(node)) expressions.push(node);
        ts.forEachChild(node, visit);
      }
      visit(parsed);
      assert.equal(calls.length, specs.length);
      const mutate = (node: ts.Node, replacement: string) => source.slice(0, node.getStart(parsed)) + replacement + source.slice(node.end);
      const mutants: string[] = [`${source}\nfunction unrelated(repositories: any) { return repositories.commandAudits; }`];
      for (const call of calls) {
        for (const method of ["insert", "get"]) mutants.push(mutate(call, `repositories.commandAudits.${method}(${call.arguments[0].getText(parsed)})`));
        mutants.push(mutate(call.arguments[0], "foreignCommandId"));
        mutants.push(mutate(call, "repositories.commandAudits.findByCommand"));
      }
      for (const spec of specs) {
        for (const guard of spec.guards) {
          const proof = expressions.find(expression => {
            let owner: ts.Node | undefined = expression.parent;
            while (owner !== undefined && !ts.isFunctionDeclaration(owner)) owner = owner.parent;
            let condition: ts.Node = expression;
            while (condition.parent !== undefined && !ts.isIfStatement(condition.parent) && !ts.isFunctionDeclaration(condition.parent)) condition = condition.parent;
            return owner !== undefined && ts.isFunctionDeclaration(owner) && owner.name?.text === spec.owner
              && ts.isIfStatement(condition.parent) && condition.parent.expression === condition
              && expression.getText(parsed).replace(/\s+/gu, "") === guard;
          });
          assert.ok(proof, `missing refusal guard ${guard}`);
          mutants.push(mutate(proof, "true"));
        }
      }
      for (const spec of specs.filter(value => value.owner === "authenticateRunGateResume")) {
        const owner = parsed.statements.filter(ts.isFunctionDeclaration).find(fn => fn.name?.text === spec.owner); assert.ok(owner?.body);
        const proofNodes: ts.Node[] = [];
        function proofTree(node: ts.Node): void { proofNodes.push(node); ts.forEachChild(node, proofTree); }
        proofTree(owner.body);
        for (const guard of spec.guards) {
          const condition = proofNodes.find(node => node.getText(parsed).replace(/\s+/gu, "") === guard); assert.ok(condition);
          const parts: ts.Node[] = [];
          function operands(node: ts.Node): void {
            if (ts.isBinaryExpression(node) || ts.isPrefixUnaryExpression(node) || ts.isConditionalExpression(node)) parts.push(node);
            ts.forEachChild(node, operands);
          }
          operands(condition);
          for (const part of parts) mutants.push(mutate(part, "true"));
        }
        for (const name of Object.keys(spec.bindings ?? {})) {
          const binding = proofNodes.filter(ts.isVariableDeclaration).find(node => ts.isIdentifier(node.name) && node.name.text === name);
          assert.ok(binding?.initializer); mutants.push(mutate(binding.initializer, "undefined"));
        }
        for (const proof of spec.calls ?? []) {
          const call = proofNodes.filter(ts.isCallExpression).find(node => node.getText(parsed).replace(/\s+/gu, "") === proof); assert.ok(call);
          mutants.push(mutate(call, "undefined"));
        }
      }
      for (const spec of specs.filter(value => value.owner === "readOcrReviewAuthority")) {
        const owner = parsed.statements.filter(ts.isFunctionDeclaration).find(fn => fn.name?.text === spec.owner); assert.ok(owner?.body);
        const declarations: ts.VariableDeclaration[] = [];
        function variables(node: ts.Node): void { if (ts.isVariableDeclaration(node)) declarations.push(node); ts.forEachChild(node, variables); }
        variables(owner.body);
        for (const name of Object.keys(spec.bindings ?? {})) {
          const binding = declarations.find(node => ts.isIdentifier(node.name) && node.name.text === name); assert.ok(binding?.initializer);
          mutants.push(mutate(binding.initializer, "undefined"));
          mutants.push(mutate(binding.initializer, "rebuildOcrReviewRecords(record.seed, undefined)"));
          mutants.push(mutate(binding.initializer, "{ records: initialOcrReviewRecords(record.seed) }"));
        }
      }
      if (path === "src/backend/runs/workbooks.ts") {
        const owner = parsed.statements.filter(ts.isFunctionDeclaration).find(fn => fn.name?.text === "authenticateOnboardingRosterChoice");
        assert.ok(owner?.body);
        mutants.push(mutate(owner.parameters[0], "repositories: ForeignRepositories"));
        const repositoryImport = parsed.statements.filter(ts.isImportDeclaration).flatMap(node =>
          node.importClause?.namedBindings !== undefined && ts.isNamedImports(node.importClause.namedBindings)
            ? node.importClause.namedBindings.elements : []).find(binding => binding.name.text === "AuthorityRepositories");
        assert.ok(repositoryImport);
        mutants.push(mutate(repositoryImport, "AuthorityRepositories as ForeignRepositories"));
        for (const spec of specs) {
          const proofOwner = parsed.statements.filter(ts.isFunctionDeclaration).find(fn => fn.name?.text === spec.owner);
          assert.ok(proofOwner?.body);
          mutants.push(mutate(proofOwner.parameters[0], "repositories: ForeignRepositories"));
          const declarations: ts.VariableDeclaration[] = [];
          function variables(node: ts.Node): void { if (ts.isVariableDeclaration(node)) declarations.push(node); ts.forEachChild(node, variables); }
          variables(proofOwner.body);
          for (const name of Object.keys(spec.bindings ?? {})) {
            const binding = declarations.find(node => ts.isIdentifier(node.name) && node.name.text === name);
            assert.ok(binding?.initializer);
            mutants.push(mutate(binding.initializer, "undefined"));
          }
        }
        const bindingCall = owner.body.statements.flatMap(statement => {
          if (!ts.isVariableStatement(statement)) return [];
          return statement.declarationList.declarations.flatMap(declaration => declaration.initializer !== undefined
            && declaration.initializer.getText(parsed).replace(/\s+/gu, "") === "onboardingReference(run)" ? [declaration.initializer] : []);
        })[0];
        assert.ok(bindingCall);
        mutants.push(mutate(bindingCall, "foreignReference(run)"));
        mutants.push(source.replace("repositories.commandAudits.findByCommand(gate.commandId)", "aliasedAudits.findByCommand(gate.commandId)"));
      }
      for (const [index, mutant] of mutants.entries()) {
        assert.notEqual(mutant, source);
        if (mutant.includes("commandAudits")) assert.ok(withoutDelegationAuditReads(mutant, path, commandSources).includes("commandAudits"), `proof mutant ${index}`);
      }
      if (path.endsWith("command-record-row.ts")) {
        const { kernel, worker } = commandSources;
        for (const mutant of [
          kernel.replace("withCanonicalRunCommandScope(repositories, request,", "withCanonicalRunCommandScope(repositories, otherRequest,"),
          kernel.replace("() => dispatchActive(dependencies, repositories, request, now, auditId), parentCommandId)", "() => arbitraryDispatch(dependencies, repositories, request, now, auditId), parentCommandId)"),
          kernel.replaceAll("dependencies.authority.withAuthorityTransaction", "dependencies.authority.withAuthorityReadSnapshot"),
          kernel.replace('request.family === "ocr-review" || request.family === "start"', 'request.family === "settings" || request.family === "start"'),
          kernel.replace('request.family === "ocr-review" || request.family === "start"', 'request.family === "start"'),
          kernel.replace("repositories.commands.insert(request, parentCommandId);", ""),
          kernel.replace("if (replayed !== undefined) return replayed;", ""),
          kernel.replace("const replayed = admitCommand(request, parentCommandId, preferenceCurrent);", "const replayed = undefined;"),
          kernel.replace("const replayed = admitCommand(request, undefined, assertEffectCurrent);", "const replayed = undefined;"),
          kernel.replace("if (replayed !== undefined) return replayed;\n          admitted = true;", "admitted = true;"),
          kernel.replace("return applyCommand(request, undefined, assertEffectCurrent);", "return applyCommand(otherRequest, undefined, assertEffectCurrent);"),
          kernel.replace("await dependencies.preflight.prepare(scope, new AbortController().signal);", "dependencies.preflight.assertReady(scope);"),
          `${kernel}\nconst escapedApplication = applyCommand;`,
        ]) {
          assert.notEqual(mutant, kernel);
          assert.ok(withoutDelegationAuditReads(source, path, { kernel: mutant, worker }).includes("commandAudits"));
        }
        for (const mutant of [
          worker.replace("() => executeCancel(dependencies, repositories, cancel, now, !held))", "() => executeCancel(dependencies, repositories, request, now, !held))"),
          worker.replace("repositories.commands.insert(cancel);", ""),
          ...stopHeldCancelMutants(worker),
          worker.replace("const journaledResetCancel =", "const resetCancel ="),
          worker.replace("const application = withCanonicalRunCommandScope(repositories, cancel,", "repositories.commandAudits.findByCommand(cancel.commandId); const application = withCanonicalRunCommandScope(repositories, cancel,"),
        ]) {
          assert.notEqual(mutant, worker);
          assert.ok(withoutDelegationAuditReads(source, path, { kernel, worker: mutant }).includes("commandAudits"));
        }
        const revoked = source.replace("activeRunCommand = undefined;", "void activeRunCommand;");
        assert.notEqual(revoked, source);
        assert.ok(withoutDelegationAuditReads(revoked, path, commandSources).includes("commandAudits"));
      }
      if (path.endsWith("delegation-root-authority.ts")) {
        for (const proof of [
          "authenticateRunGateResume(repositories, run, command.requestedBy);",
          "authenticateRunGateResume(repositories, run, source.requestedBy);",
          "validateNativeLifecycleRequest(resumed);",
          "validateNativeLifecycleRequest(parked);",
          "repositories.lifecycleJournal.findGatePark(run.envelope.runId, gate.gateId, gate.expectedVersion)",
        ]) {
          const mutant = source.replaceAll(proof, "undefined");
          assert.notEqual(mutant, source);
          assert.ok(withoutDelegationAuditReads(mutant, path, commandSources).includes("commandAudits"));
        }
        const aliased = source.replace("repositories.commandAudits.findByCommand(gate.commandId)",
          "Reflect.get(repositories, 'commandAudits').findByCommand(gate.commandId)");
        assert.notEqual(aliased, source);
        assert.ok(withoutDelegationAuditReads(aliased, path, commandSources).includes("commandAudits"));
      }
      if (path.endsWith("ocr-source-service.ts")) {
        const aliased = source.replace("repositories.commandAudits.findByCommand(commandId)", "Reflect.get(repositories, 'commandAudits').findByCommand(commandId)");
        assert.notEqual(aliased, source);
        assert.ok(withoutDelegationAuditReads(aliased, path, commandSources).includes("commandAudits"));
        for (const [from, to] of [
          ["function readOcrCommandResult", "export function readOcrCommandResult"],
          ["input.assertCurrent();", "void input;"],
          ["input.database.withAuthorityReadSnapshot", "input.database.withAuthorityTransaction"],
        ]) {
          const mutant = source.replaceAll(from, to); assert.notEqual(mutant, source);
          assert.ok(withoutDelegationAuditReads(mutant, path, commandSources).includes("commandAudits"));
        }
      }
    });
  }
});

const ASSISTANT_PREFERENCE_PROFILE = "11111111-1111-4111-8111-111111111111";

const CURRENT_COMMAND_FIXTURES: readonly unknown[] = Object.freeze([
  ...COMMAND_FIXTURES,
  { commandId: "67676767-6767-4676-8676-676767676767", requestedAt: NOW, requestedBy: "local-operator", source: "run-detail",
    family: "run", type: "resolve-workbook-row", target: { runId: UUID_2, expectedVersion: 1, libraryId: "workbook-fixture",
      operationId: "operation-fixture", receiptDigest: HASH_B, workbookVersion: 1 }, payload: { sheetId: "sheet-1", rowId: "row-1" } },
  ...["remove-worker", "retry-worker"].map((type, index) => ({
    commandId: index === 0 ? "10101010-1010-4010-8010-101010101010" : "20202020-2020-4020-8020-202020202020",
    requestedAt: NOW, requestedBy: "local-operator", source: "dashboard", family: "worker-browser", type,
    target: { workflowId: "fixture-graph", workerId: "fixture-graph-worker-1", lifetimeId: null, expectedVersion: 0 },
  })),
  {
    commandId: "35353535-3535-4353-8353-353535353535",
    requestedAt: NOW, requestedBy: "local-operator", source: "run-detail", family: "worker-browser", type: "check-parked-write",
    target: {
      workerId: "fixture-graph-worker-9", lifetimeId: "49494949-4949-4494-8494-494949494949", expectedVersion: 1,
      installationId: "33333333-3333-4333-8333-333333333333", profileId: ASSISTANT_PREFERENCE_PROFILE,
      workflowId: "fixture-graph", itemId: "46464646-4646-4464-8464-464646464646",
      runId: "45454545-4545-4454-8454-454545454545", runVersion: 1, runAttempt: 1, traceId: "ab-120000-0001", nodeId: "parked-check",
      writeIntentId: "47474747-4747-4474-8474-474747474747", intentVersion: 1, intentGeneration: 1,
      writeAttemptId: "48484848-4848-4484-8484-484848484848", bindingProofDigest: HASH_B, occurrenceKeyDigest: HASH_B,
    },
  },
  {
    commandId: "12121212-1212-4121-8121-121212121212", requestedAt: NOW,
    requestedBy: "local-operator", source: "dashboard", family: "assistant-model-preference", type: "set-assistant-model-preference",
    target: { profileId: ASSISTANT_PREFERENCE_PROFILE, epoch: 0, expectedRevision: 1 }, payload: { slug: "gpt-6.1-sol", effort: "light" },
  },
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
]);

/* ── the partition (ref dashboard-surfaces authority) ────────── */

const EXPECTED_ACTIVE = {
  "ocr-review": ["correct-ocr-record", "discard-ocr-record", "restore-ocr-record", "add-ocr-record"],
  application: ["pause-all", "pause-all-and-quit"],
  "assistant-model-preference": ["set-assistant-model-preference"],
  "failure-resolution": ["annotate-failure"],
  start: ["start-run"],
  "workflow-batch": ["set-batch-grouping"],
  "worker-browser": [
    "check-parked-write",
    "plan-worker-count", "spawn-worker", "stop-worker", "remove-worker", "retry-worker", "pause-worker",
    "resume-worker", "refresh-browser", "reopen-browser",
  ],
  run: [
    "pause", "resume",
    "retry",
    "cancel", "bump", "rename",

    "delete",
    "recheck-write", "resolve-write-absent", "resolve-workbook-row", "resolve-workbook-reference-row",

  ],
  gate: ["resolve-gate"],

  notification: ["notification-read", "notification-unread", "notification-snooze", "notification-unsnooze", "notification-read-all", "notification-unread-all", "notification-snooze-all", "notification-unsnooze-all", "notification-clear"],

  intake: [
    "inspect-intake", "confirm-intake-mapping", "correct-intake-row",
    "exclude-intake-row", "validate-intake", "enqueue-intake-manifest",
  ],
  settings: ["apply-settings", "apply-protected-settings"],

} as const;

describe("control-command-single-path", () => {
  it("pins the exact active arm set", () => {
    assert.deepEqual(PHASE1_ACTIVE_COMMAND_ARMS, EXPECTED_ACTIVE);
    const partitioned = Object.entries(EXPECTED_ACTIVE).flatMap(([family, actions]) => actions.map((action) => `${family}/${action}`));
    const registry = COMMAND_FAMILY_REGISTRY.flatMap(({ family, actions }) =>
      actions.filter(action => action !== "recover-run").map((action) => `${family}/${action}`));
    assert.deepEqual([...partitioned].sort(), [...registry].sort());
    assert.equal(new Set(partitioned).size, partitioned.length);
  });

  it("refuses prohibited audit authority in the same-person restore candidate", () => {
    const source = readFileSync(join(REPO_ROOT, "src/backend/storage/sqlite/same-person-restore-candidate.ts"), "utf8");
    assert.ok(!source.includes("commandAudits"));
    const additions = [
      'function probe(repo: any) { repo.commandAudits.insert({}); }',
      'function probe(repo: any) { return repo.commandAudits.findByCommand("other"); }',
      'const forged = { commandAudits: { findByCommand: () => undefined } };',
      'function probe(repo: any) { return repo["commandAudits"]; }',
      'function probe(repo: any) { return Reflect.get(repo, "commandAudits"); }',
      'function probe(repo: any) { const { commandAudits } = repo; return commandAudits; }',
      'function probe(repo: any) { const audit = repo.commandAudits; return audit; }',
      'export function probe(repo: any) { return repo.commandAudits.get("other"); }',
    ];
    for (const addition of additions) {
      const bad = `${source}\n${addition}`;
      assert.notEqual(bad, source);
      assert.ok(bad.includes("commandAudits"), "unrelated audit authority must remain visible");
    }
  });

  it.each(RECEIPT_QUERIES)("admits only %s's snapshot-bound audit read", path => {
    const source = readFileSync(join(REPO_ROOT, path), "utf8");
    assert.ok(!withoutIntakeCommandReceiptRead(source).includes("commandAudits"));
    for (const bad of [
      source.replace("commandAudits.findByCommand(id)", "commandAudits.insert(id)"),
      source.replace("commandAudits.findByCommand(id)", "commandAudits.findByCommand(otherId)"),
      source.replace("database.withAuthorityReadSnapshot", "database.withAuthorityTransaction"),
      source.replace("commandAudits.findByCommand(id)", "commandAudits.get(id)"),
      `${source}\nfunction forged(database: any) { database.authority.commandAudits.insert({}); }`,
      `${source}\nfunction forged(database: any) { return database.authority.commandAudits; }`,
    ]) assert.ok(withoutIntakeCommandReceiptRead(bad).includes("commandAudits"), "mutating, aliased or out-of-snapshot audit reach stays visible");
  });

  it("keeps the command journal, audit, and start-plan consumption on exactly one executing path", () => {
    const allowed = new Set([
      KERNEL_PATH,
      "src/backend/storage/sqlite/authority-database.ts",
    ]);
    const tokens = ["commandAudits", ".commands.insert(", "startPlans.consume("];
    const storageAuthorityReads = new Map<string, Readonly<Record<string, number>>>([
      ["src/backend/storage/sqlite/authority-repositories.ts", { "commandAudits: CommandAuditRepository;": 1 }],
      ["src/backend/storage/sqlite/authority-run-evidence.ts", {
        '"commandAudits">': 1, "commandAudits.get(recheck.auditId)": 1, "commandAudits: {get(id:string)": 1,
      }],
    ]);
    const movedAuthorityCalls = new Map<string, Readonly<Record<string, number>>>([
      [REPLAY_PATH, { "commandAudits.findByCommand(": 2, "startPlans.consume(": 1 }],
      [SETTINGS_COMMAND_PATH, { ".commands.insert(": 1, "commandAudits.insert(": 1 }],
      ["src/backend/runs/commands/start-command.ts", { "startPlans.consume(": 1 }],
      [WORKER_COMMANDS_PATH, { ".commands.insert(": 2, "commandAudits.insert(": 2, "commandAudits.findByCommand(": 1 }],
    ]);
    const settingsAuditReaders = new Map([
      ["src/backend/runtime/settings/settings-runtime.ts", 1],
      ["src/backend/storage/sqlite/backup-service.ts", 0],
      ["src/backend/runs/lifecycle/run-record-service.ts", 1],
      ["src/backend/runs/recovery/span-root-repair.ts", 1],
      ["src/models/events/confirmed-operation.ts", 1],
    ]);
    const violations: string[] = [];
    const executorImports: string[] = [];
    let kernelDefinitions = 0;
    const commandSources = readCommandScopeSources();
    for (const file of walkFiles(join(REPO_ROOT, "src"), { extensions: [".ts", ".tsx"] })) {
      const path = repoRelative(file);
      const raw = readFileSync(file, "utf8");
      executorImports.push(...scanCommandExecutorImports(path, raw));
      let content = withoutDelegationAuditReads(raw, path, commandSources);
      if (content.includes("export function createCommandKernel")) kernelDefinitions += 1;
      if (path !== KERNEL_PATH && path !== WORKER_COMMANDS_PATH && path !== "src/backend/storage/sqlite/command-record-row.ts"
        && /\bwithCanonicalRunCommandScope\b/u.test(raw)) violations.push(`${path} references private synchronous run command custody outside the kernel`);
      if (allowed.has(path)) continue;
      for (const [call, count] of Object.entries(storageAuthorityReads.get(path) ?? movedAuthorityCalls.get(path) ?? {})) {
        if (content.split(call).length - 1 !== count) violations.push(`${path} changed its command authority calls to ${call}`);
        content = content.replaceAll(call, "");
      }
      for (const token of tokens) {
        const expectedSettingsAuditReads = settingsAuditReaders.get(path);
        if (RECEIPT_QUERIES.includes(path) && token === "commandAudits") {
          if (withoutIntakeCommandReceiptRead(content).includes(token)) violations.push(`${path} may only read its actual command receipt in an authority snapshot`);
          continue;
        }
        if (path === "src/backend/runs/queries/run-detail/gate-park.ts" && token === "commandAudits") {
          const uses = content.match(/\bcommandAudits\.[A-Za-z]+/gu) ?? [];
          if (uses.length !== 1 || uses[0] !== "commandAudits.parkedWriteChecks") violations.push(`${path} may only read its run's parked-write check audits`);
          continue;
        }
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
        if (content.includes(token)) violations.push(`${path} reaches ${token} outside the command kernel`);
      }
    }
    assert.deepEqual(violations, []);
    assert.equal(kernelDefinitions, 1, "exactly one module may define the command kernel");
    assertCommandExecutorImports(executorImports);

    const foreignPath = "src/backend/runs/foreign-command.ts";
    const specifier = '"./commands/../commands/start-command.js"';
    for (const mutant of [
      `import { executeStartRun as start } from ${specifier};`,
      `import * as start from ${specifier};`,
      `const start = () => import(${specifier});`,
      `export { executeStartRun as start } from ${specifier};`,
      `export * from ${specifier};`,
    ]) {
      assert.throws(() => assertCommandExecutorImports([
        ...executorImports, ...scanCommandExecutorImports(foreignPath, mutant),
      ]), /foreign-command\.ts/u);
    }
    assert.throws(() => assertCommandExecutorImports([
      ...executorImports.filter(entry => !entry.startsWith(`${KERNEL_PATH} -> `)),
      ...scanCommandExecutorImports(KERNEL_PATH, `${commandSources.kernel}\nexport { executeStartRun as start };`),
    ]), /re-export of executeStartRun/u);
    assert.deepEqual(scanCommandExecutorImports(foreignPath, `
      import { type executeStartRun } from ${specifier};
      import { isAdmittedUnsettled } from "./commands/command-replay.js";
      import { executeSettingsCommand } from "./commands/settings-command.js";
    `), []);

    const commandPaths = [KERNEL_PATH, ...movedAuthorityCalls.keys(),
      "src/backend/runs/commands/command-application.ts", "src/backend/runs/commands/command-arms.ts",
      "src/backend/runs/commands/command-refusal.ts", "src/backend/runs/commands/gate-command.ts",
      "src/backend/runs/commands/intake-commands.ts", "src/backend/runs/commands/notification-commands.ts",
      "src/backend/runs/commands/run-command-context.ts", RUN_LIFECYCLE_COMMANDS_PATH,
      "src/backend/runs/commands/write-resolution-command.ts"];
    for (const path of commandPaths) {
      const content = readFileSync(join(REPO_ROOT, path), "utf8");
      assert.ok(!/\bDatabaseSync\b/.test(content), `${path} may not hold a raw database handle`);
      assert.ok(!/\bDELETE\s+FROM\b/i.test(content), `${path} may not physically delete authority rows`);
      assert.ok(!/"Delete"/.test(content), "the UI label is Hide, never Delete");
    }
  });

  it("carries a version or immutability binding on every wire arm's target", () => {
    const versionless: string[] = [];
    for (const fixture of CURRENT_COMMAND_FIXTURES) {
      const parsed = CommandRequestSchema.parse(fixture);
      const request = parsed.family === "worker-browser" && "workflowId" in parsed.target
        ? { ...parsed, target: { ...parsed.target, workflowId: "fixture-graph" } } : parsed;
      const target: Record<string, unknown> = request.target;
      const members = target.members;
      const memberVersions = Array.isArray(members) && members.length > 0 && members.every(member => member !== null && typeof member === "object" && "expectedVersion" in member);
      const carries = "expectedVersion" in target || "expectedRevision" in target
        || "scope" in target || memberVersions || request.family === "application" && "runtimeGeneration" in target;
      if (!carries) versionless.push(`${request.family}/${request.type}`);
    }
    assert.deepEqual(versionless, []);
  });

  it("notification stays read/unread/snooze", () => {
    const notification = COMMAND_FAMILY_REGISTRY.find(({ family }) => family === "notification");
    assert.deepEqual(notification?.actions, ["notification-read", "notification-unread", "notification-snooze", "notification-unsnooze", "notification-read-all", "notification-unread-all", "notification-snooze-all", "notification-unsnooze-all", "notification-clear"]);
  });
});
