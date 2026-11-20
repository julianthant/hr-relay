import { GATE_PARK_WATCH_MS } from "./timeline.js";
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
  // A stop ends a backup inspection still running in the health pass instead of waiting for it.
  const healthStop = new AbortController(), signal = healthStop.signal;
  const observeHealth = stateRoot === undefined ? undefined : createNotificationHealthObserver({ database, clock, inbox, signal,
    read: () => readNotificationHealth({ admission: requireRuntimeAdmission(input.admission), database, clock, reader: input.reader, stateRoot, signal }) });
  let healthDueAt = Infinity;
  const observation = createNotificationObserver({ inbox, read: () => readNotificationSources(database, input.reader),
    health: async () => {
      if (observeHealth === undefined) return;
      await observeHealth();
      if (signal.aborted) return;
      const sample = database.authority.notificationHealth.get("wal-growth");
      if (sample === undefined) throw new Error("missing wal-growth observation after storage health pass");
      healthDueAt = Date.parse(sample.observedAt) + 60_000;
    },
  });
  const observer = Object.freeze({ ...observation, healthDueAt: () => healthDueAt, async stop() { healthStop.abort(); await observation.stop(); } });
  return { observer, inbox, backfillGapNotifier: createBackfillGapNotifier({ inbox }), gateParkNotifier: createGateParkNotifier({ inbox }), readParks: () => readGateParks(database, input.reader) };
}

export function startNotificationPolling(database: AuthorityDatabase, clock: Clock, observation: ReturnType<typeof createTrustNotifications>["observer"]) {
  const revision = database.trackAuthorityTables(["runs", "deleted_runs", "run_failures", "run_receipts", "notifications"]);
  let observed = revision();
  const changed = () => {
    const current = revision();
    const dirty = current === undefined || current !== observed;
    observed = current;
    return dirty;
  };
  let safetyAt = Infinity;
  const safetyPass = () => {
    safetyAt = Infinity;
    void observation.observe().then(() => {
      const delay = observation.status().state === "failed" ? GATE_PARK_WATCH_MS : Math.min(60_000, observation.healthDueAt() - clock.nowMs());
      safetyAt = clock.monotonicMs() + delay;
    });
  };
  safetyPass();
  const timer = setInterval(() => {
    if (clock.monotonicMs() >= safetyAt) safetyPass();
    else void observation.observeSources(changed);
  }, GATE_PARK_WATCH_MS);
  timer.unref();
  return timer;
}
