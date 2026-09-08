import {
  DESCRIPTORS,
} from "../../../control/workflow-registry.js";

import { RunRecordService } from "../../../core/run-record-service.js";
import type { Clock } from "../../../domain/clock.js";
import { type IdFactory } from "../../../domain/identifiers.js";
import {
  LOCAL_OPERATOR_ACTOR_ID,
} from "../../../domain/ids.js";

import {
  AuthorityDatabase,
} from "../../../infra/sqlite/index.js";
import { createServerVerifiedArtifactReader } from "../../../infra/artifacts/server-verified-artifact-reader.js";
import { createNotificationInbox } from "../../../services/notifications/inbox.js";
import { createBackfillGapNotifier } from "../../../services/notifications/backfill-gap.js";
import {
  GateParkObservationSchema,
  createGateParkNotifier,
  type GateParkObservation,
} from "../../../services/notifications/gate-park.js";

import { createReceiptService } from "../../trust/receipt-service.js";

/**
 * D262's read: every run currently parked at a gate, narrowed to the shape
 * `GateParkNotifier.observed` takes. Exported (not a `createDashboardRuntime`
 * closure) so a scenario test can prove the SAME fold the running composition
 * calls, rather than a hand-copy that could drift from it unnoticed. Lives
 * here rather than in `src/services/notifications/gate-park.ts` because that
 * module's own header is explicit that the notifier "holds no authority
 * handle and does no I/O of its own" — this function does both, so it belongs
 * with the other authority-reading folds the composition owns (see
 * `readBackupSummary` below).
 */
export function readGateParks(database: AuthorityDatabase): readonly GateParkObservation[] {
  return database.authority.runs.listParkedAtGate().map((run) => {
    // The repository refuses such a row before it reaches here; this keeps the
    // narrowing below a checked fact rather than an assertion.
    if (run.lifecycle.state !== "parked-gate") {
      throw new Error(`run ${run.envelope.runId} was listed as parked at a gate but reads ${run.lifecycle.state}`);
    }
    return GateParkObservationSchema.parse({
      runId: run.envelope.runId,
      workflowId: run.envelope.workflow,
      gateId: run.lifecycle.gateId,
    });
  });
}

export function createTrustNotifications(input: { database: AuthorityDatabase; clock: Clock; ids: IdFactory; reader: Pick<RunRecordService, "read" | "list"> }) {
  const { database, clock, ids } = input;
  const inbox = createNotificationInbox({ authority: database, clock, ids, runReader: input.reader, actorId: LOCAL_OPERATOR_ACTOR_ID });
  return { inbox, backfillGapNotifier: createBackfillGapNotifier({ inbox }), gateParkNotifier: createGateParkNotifier({ inbox }), readParks: () => readGateParks(database) };
}
export function createTrustReadDependencies(input: { database: AuthorityDatabase; artifactReader: ReturnType<typeof createServerVerifiedArtifactReader>; reader: Pick<RunRecordService, "read" | "list"> }) {
  const { database, artifactReader, reader } = input;
  return { trust: createReceiptService({ database, descriptors: DESCRIPTORS, runReader: reader }), captures: { runReader: reader, authority: database.authority.diagnosticBundles, artifactReader }, diagnosticBundles: { runReader: reader, authority: database.authority.diagnosticBundles, artifactReader } };
}
