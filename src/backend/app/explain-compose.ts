/**
 * The `explain run` composition value (D143) — the CLI's injected seam.
 *
 * It sits in `src/backend/app/` because it imports the workflow registry
 * and assembles lower-level services for `src/cli.ts`.
 *
 * It opens the SAME authority database the dashboard and workers use, in the
 * same isolated state root, and closes it before returning. `explain` is a
 * read-and-derive command: the only row it may create is the run's receipt,
 * and that insert is idempotent by construction (D141).
 */
import { join } from "node:path";
import { z } from "zod";
import type { RuntimeIsolation } from "../../config/define-runtime-isolation.js";
import { DESCRIPTORS } from "./control/workflow-registry.js";
import { HISTORICAL_STEP_PROOF_DESCRIPTORS, historicalStepProofDescriptorOf } from "./control/step-proof-modules.js";
import { systemClock, type Clock } from "../../domain/clock.js";
import { descriptorRuntimeNodes } from "../../base/workflow.js";
import { RunIdSchema, TraceIdSchema } from "../../domain/ids.js";
import { AuthorityDatabase } from "../../infra/sqlite/index.js";
import { requireRuntimeAdmission, type RuntimeAdmission } from "../../infra/runtime-control/admission.js";
import { createTrustRunReader } from "../runs/trust/canonical-reader.js";
import { requireTrustRun, listLiveTrustRuns, assertTrustEvidenceIdentity } from "../runs/trust/run-reader.js";
import { createReceiptService } from "../runs/trust/receipt-service.js";
import {
  buildExplainRunView,
  renderExplainRun,
  type ExplainRunEvidence,
} from "../runs/explain/explain-run.js";

export interface ExplainComposeInput {
  readonly admission?: RuntimeAdmission;
  readonly isolation: RuntimeIsolation;
  readonly args: readonly string[];
  readonly repoRoot?: string;
  readonly clock?: Clock;
}

const SUBJECT_HELP = "usage: cli explain run <traceId|runId> [--json] [--bundle <dir>]";

export function composeExplainRuntime(input: ExplainComposeInput): string {
  const admission = requireRuntimeAdmission(input.admission);
  const [subject, identity, ...flags] = input.args;
  if (subject !== "run") {
    throw new Error(
      `explain supports only the "run" subject today (ref operator-trust §2.5 also names "failure <fingerprint>", `
      + `which lands with the knowledge/fix slice); received "${subject ?? "(nothing)"}". ${SUBJECT_HELP}`,
    );
  }
  if (identity === undefined) throw new Error(SUBJECT_HELP);

  const bundleIndex = flags.indexOf("--bundle");
  if (bundleIndex !== -1) {
    // Ref operator-trust §2.5's `--bundle` exports a REDACTED portable diagnostic package
    // plus a manifest and hash. The capture side of that package (ref operator-trust §2.2)
    // is a separate 2g slice; exporting a package that silently omitted the
    // screenshots, DOM excerpts, and console/network evidence it promises would
    // be worse than refusing, because the recipient could not tell.
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
    ?? historicalStepProofDescriptorOf(run.envelope.workflow);
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
    ? createReceiptService({ database, descriptors: [...DESCRIPTORS, ...HISTORICAL_STEP_PROOF_DESCRIPTORS], runReader }).ensureReceipt(run.envelope.runId)
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
  };
  return buildExplainRunView(evidence);
}

export const ExplainArgsSchema = z.array(z.string());
