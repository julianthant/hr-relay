import { createNotificationObserver } from "../../../runs/notifications/observation.js";
import { readNotificationSources } from "./notification-sources.js";
import { createNotificationHealthObserver, readNotificationHealth } from "./notification-health.js";
import { RunRecordService } from "../../../runs/lifecycle/run-record-service.js";
import type { Clock } from "../../../../rules/time/clock.js";
import { type IdFactory } from "../../../../rules/identity/identifiers.js";
import {
  LOCAL_OPERATOR_ACTOR_ID,
} from "../../../../rules/identity/ids.js";

import {
  AuthorityDatabase,
} from "../../../storage/sqlite/index.js";
import { createNotificationInbox } from "../../../runs/notifications/inbox.js";
import { createBackfillGapNotifier } from "../../../runs/notifications/backfill-gap.js";
import {
  GateParkObservationSchema,
  createGateParkNotifier,
  type GateParkObservation,
} from "../../../runs/notifications/gate-park.js";

import { createTrustRunReader } from "../../../runs/trust/canonical-reader.js";
import { type RuntimeAdmission } from "../../../storage/admission/admission.js";
import { requireRuntimeAdmission } from "../../../storage/admission/admission-identity.js";
import { listLiveTrustRuns, type TrustRunReader } from "../../../runs/trust/run-reader.js";

/** Retained gate-watch adapter; production observation also includes canonical occurrence identity. */
export function readGateParks(database: AuthorityDatabase, reader: TrustRunReader = createTrustRunReader(database)): readonly GateParkObservation[] {
  return database.withAuthorityReadSnapshot(() => listLiveTrustRuns(reader).filter(run => run.lifecycle.state === "parked-gate").map((run) => {
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
  }));
}

export function createTrustNotifications(input: { admission?: RuntimeAdmission; database: AuthorityDatabase; clock: Clock; ids: IdFactory; reader: Pick<RunRecordService, "read" | "list">; stateRoot?: string }) {
  const { database, clock, ids, stateRoot } = input;
  const inbox = createNotificationInbox({ authority: database, clock, ids, runReader: input.reader, actorId: LOCAL_OPERATOR_ACTOR_ID });
  const observer = createNotificationObserver({ inbox, read: () => readNotificationSources(database, input.reader),
    health: stateRoot === undefined ? async () => {} : createNotificationHealthObserver({ database, clock, inbox, read: () => readNotificationHealth({ admission: requireRuntimeAdmission(input.admission), database, clock, reader: input.reader, stateRoot }) }),
  });
  return { observer, inbox, backfillGapNotifier: createBackfillGapNotifier({ inbox }), gateParkNotifier: createGateParkNotifier({ inbox }), readParks: () => readGateParks(database, input.reader) };
}
