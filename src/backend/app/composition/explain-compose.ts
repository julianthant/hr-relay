
import { join } from "node:path";
import type { z } from "zod";
import { TimelinePageRequestSchema, TimelineEventRecordSchema } from "../../../models/events/timeline.js";
import { readEmergencyFaults } from "../../logs/emergency-faults.js";
import type { RuntimeIsolation } from "../../../models/config/define-runtime-isolation.js";
import { DESCRIPTORS } from "../registries/workflow-registry.js";
import { STEP_PROOF_DESCRIPTORS, stepProofDescriptorOf } from "../registries/step-proof-modules.js";
import { systemClock, type Clock } from "../../../rules/time/clock.js";
import { descriptorRuntimeNodes } from "../../../workflow-kit/workflow.js";
import { RunIdSchema, TraceIdSchema } from "../../../rules/identity/ids.js";
import { AuthorityDatabase } from "../../storage/sqlite/index.js";
import { type RuntimeAdmission } from "../../storage/admission/admission.js";
import { requireRuntimeAdmission } from "../../storage/admission/admission-identity.js";
import { createTrustRunReader } from "../../runs/trust/canonical-reader.js";
import { requireTrustRun, listLiveTrustRuns, assertTrustEvidenceIdentity } from "../../runs/trust/run-reader.js";
import { createReceiptService } from "../../runs/trust/receipt-service.js";
import {
  buildExplainRunView,
  renderExplainRun,
  type ExplainRunEvidence,
} from "../../runs/explain/explain-run.js";

export interface ExplainComposeInput {
  readonly admission?: RuntimeAdmission;
  readonly isolation: RuntimeIsolation;
  readonly args: readonly string[];
  readonly repoRoot?: string;
  readonly clock?: Clock;
}

const SUBJECT_HELP = "usage: cli explain run <traceId|runId> [--json] [--bundle <dir>]";

export function parseDiagnosticArgs(args: readonly string[]) {
  const values: Record<string, unknown> = {};
  let json = false, boot = false;
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--json" || flag === "--boot") {
      if (flag === "--json") { if (json) throw new Error("diagnostic-arguments-invalid"); json = true; }
      else { if (boot) throw new Error("diagnostic-arguments-invalid"); boot = true; }
      continue;
    }
    const key = flag === "--run" ? "runId" : flag === "--after" ? "after" : flag === "--through" ? "through" : flag === "--limit" ? "limit" : undefined;
    const value = args[++index];
    if (key === undefined || value === undefined || key in values || key !== "runId" && !/^\d+$/u.test(value)) throw new Error("diagnostic-arguments-invalid");
    values[key] = key === "runId" ? value : Number(value);
  }
  if (boot && Object.keys(values).length > 0) throw new Error("diagnostic-boot-does-not-have-timeline-cursors");
  return { json, boot, request: TimelinePageRequestSchema.parse(values) };
}

function renderDebugRecords(records: readonly z.infer<typeof TimelineEventRecordSchema>[]) {
  return records.map(record => `${String(record.cursor)} ${record.occurredAt} ${record.scope.kind} ${JSON.stringify(record.payload)}`).join("\n");
}

export function composeExplainRuntime(input: ExplainComposeInput): string {
  const admission = requireRuntimeAdmission(input.admission);
  const [subject, identity, ...flags] = input.args;
  if (subject === "diagnostics") {
    const options = parseDiagnosticArgs(input.args.slice(1));
    if (options.boot) {
      admission.assertExclusive();
      const report = readEmergencyFaults(admission.stateRoot);
      return options.json ? JSON.stringify(report, null, 2) : report.state === "absent" ? `boot diagnostics: absent (${report.reason})`
        : report.records.map(record => `${record.occurredAt} ${JSON.stringify(record.payload)}`).join("\n");
    }
    const page = AuthorityDatabase.inspectTimelinePageReadOnly(admission, join(admission.stateRoot, "state.db"), options.request);
    return options.json ? JSON.stringify(page, null, 2) : `${renderDebugRecords(page.records)}\nnextCursor=${String(page.nextCursor)} through=${String(page.through)} highWaterMark=${String(page.highWaterMark)} hasMore=${String(page.hasMore)}`;
  }
  if (subject !== "run") {
    throw new Error(
      `explain supports only the "run" subject today (ref operator-trust §2.5 also names "failure <fingerprint>", `
      + `which lands with the knowledge/fix slice); received "${subject ?? "(nothing)"}". ${SUBJECT_HELP}`,
    );
  }
  if (identity === undefined) throw new Error(SUBJECT_HELP);

  const bundleIndex = flags.indexOf("--bundle");
  if (bundleIndex !== -1) {
    // Bundle export packages retained diagnostics; it cannot manufacture a missing capture.
    throw new Error(
      "--bundle needs the ref operator-trust §2.2 diagnostic capture slice, which is not wired; refusing to "
      + "export a diagnostic package that would be missing the evidence its manifest claims",
    );
  }
  const json = flags.includes("--json");
  for (const flag of flags) {
    if (flag !== "--json") throw new Error(`unknown explain flag "${flag}". ${SUBJECT_HELP}`);
  }

  const clock = input.clock ?? systemClock;
  const stateRoot = admission.stateRoot;
  const database = AuthorityDatabase.open(
    admission,
    { path: join(stateRoot, "state.db"), busyTimeoutMs: 5000, migrationOwner: "rebuild-explain" },
    clock,
  );
  try {
    const view = explainRunFrom(database, identity);
    return json ? JSON.stringify(view, null, 2) : renderExplainRun(view);
  } finally {
    database.close();
  }
}

/** Resolve either identity form, then assemble the view from authority. */
export function explainRunFrom(database: AuthorityDatabase, identity: string): ReturnType<typeof buildExplainRunView> {
  return database.withAuthorityTransaction(() => explainRunSnapshot(database, identity));
}

function explainRunSnapshot(database: AuthorityDatabase, identity: string): ReturnType<typeof buildExplainRunView> {
  const { authority } = database;
  const asRun = RunIdSchema.safeParse(identity);
  const asTrace = TraceIdSchema.safeParse(identity);
  if (!asRun.success && !asTrace.success) {
    throw new Error(
      `"${identity}" is neither a run id (UUID) nor a trace id (<code>-<HHMMSS>-<runId4>); `
      + "refusing to guess which one was meant",
    );
  }
  const runReader = createTrustRunReader(database);
  const matches = asRun.success ? [] : listLiveTrustRuns(runReader).filter(run => run.envelope.traceId === identity);
  if (!asRun.success && matches.length !== 1) throw new Error(`no unique live run matches "${identity}" in this authority database; archived runs use Archive`);
  const runId = asRun.success ? asRun.data : matches[0]?.envelope.runId;
  if (runId === undefined) throw new Error(`no run matches "${identity}" in this authority database`);
  const run = requireTrustRun(runReader, runId);

  const descriptor = DESCRIPTORS.find((entry) => entry.id === run.envelope.workflow)
    ?? stepProofDescriptorOf(run.envelope.workflow);
  if (descriptor === undefined) {
    throw new Error(
      `run ${run.envelope.runId} is workflow ${run.envelope.workflow}, which this build does not register`,
    );
  }

  const failure = run.lifecycle.state === "terminal" && run.lifecycle.failureId !== undefined
    ? authority.failures.get(run.lifecycle.failureId)
    : undefined;
  if (failure !== undefined) assertTrustEvidenceIdentity(run, failure, "Explain failure");
  const result = authority.runResults.get(run.envelope.runId);
  if (result !== undefined && result.runId !== run.envelope.runId) throw new Error("TRUST_EVIDENCE_IDENTITY_MISMATCH: Explain result");
  const settled = run.lifecycle.state === "terminal" && run.lifecycle.outcome !== "interrupted";
  const receipt = settled
    ? createReceiptService({ database, descriptors: [...DESCRIPTORS, ...STEP_PROOF_DESCRIPTORS], runReader }).ensureReceipt(run.envelope.runId)
    : undefined;

  const evidence: ExplainRunEvidence = {
    run,
    checkpoints: authority.runCheckpoints.listByItem(run.envelope.workflow, run.envelope.itemId),
    writes: authority.writeIntents.listByRun(run.envelope.runId),
    ...(failure === undefined
      ? {}
      : { failure, sameFingerprintSeen: authority.failures.countByFingerprint(failure.fingerprint) }),
    ...(receipt === undefined ? {} : { receipt }),
    nodeIds: descriptorRuntimeNodes(descriptor).map((node) => String(node.id)),
    dependencies: (result?.dependencies ?? []).map((dependency) => ({
      nodeId: String(dependency.nodeId),
      state: dependency.state === "not-run" ? dependency.reason : "resolved",
    })),
    debugEvents: authority.timelineEvents.withReadSnapshot(() => {
      const through = authority.timelineEvents.highWaterMark();
      const scanned = authority.timelineEvents.page({ runId, after: 0, through, limit: 500 });
      const nextCursor = scanned.at(-1)?.cursor ?? through;
      return { records: scanned.filter(record => record.payload.kind === "debug"), nextCursor, through,
        highWaterMark: through, hasMore: nextCursor < through, after: 0 };
    }),
  };
  return buildExplainRunView(evidence);
}
