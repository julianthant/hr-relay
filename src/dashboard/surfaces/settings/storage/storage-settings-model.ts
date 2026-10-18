import { STORAGE_DOCTOR_DEADLINE_MS } from "../../../client/read-deadline.js";
import { useSettingsRead } from "../../../state/settings-read-model.js";
import { ERROR_CATALOG } from "../../../../models/failures/error-catalog.js";
import { systemClock } from "../../../../rules/time/clock.js";
import type { StorageDoctorLatestWire } from "../../../../models/dashboard/storage.js";
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useDashboardCommandBinding } from "../../../state/client-context.js";
import { useStorageClient } from "./storage-client.js";
import { z } from "zod";
import type {
StorageHealthSummaryWireSchema
} from "../../../../models/dashboard/bootstrap.js";
import type { StorageDoctorWire } from "../../../../models/dashboard/storage.js";


export type StorageHealthSummary = z.infer<typeof StorageHealthSummaryWireSchema>;


type DegradedSpanAuthority = Extract<StorageDoctorWire["spanAuthority"], { state: "degraded" }>;

export type SpanAuthorityProblem = DegradedSpanAuthority["problems"][number];


/** The strict degraded union's operator facts. The discriminant is rendered
 * separately, so this fold carries only that arm's safe identifying detail. */
export function spanAuthorityProblemDetail(problem: SpanAuthorityProblem): string {
  switch (problem.state) {
    case "missing":
    case "restore-loss":
      return `run ${problem.runId}${problem.possibleExternalWrite === true ? " · possible external write" : ""}`;
    case "missing-span":
      return `run ${problem.runId}`;
    case "malformed-authority":
      return `source ${problem.source} · record ${problem.recordKey} · ${problem.summary}`;
    case "malformed":
      return `table ${problem.table} · run ${problem.runId} · ${problem.summary}`;
  }
}


/** True when the top-bar gear should carry the attention dot. */
export function storageNeedsAttention(storage: StorageHealthSummary): boolean {
  return storage.authority !== "healthy";
}

export type DoctorState =
  | { state: "idle"; report?: undefined }
  | { state: "reading"; report?: undefined }
  | { state: "running"; report?: StorageDoctorWire }
  | { state: "loaded"; report: StorageDoctorWire }
  | { state: "failed"; message: string; neverRun: boolean; report?: StorageDoctorWire };

const STORAGE_DOCTOR_MAX_AGE_MS = 5 * 60_000;
const staleChecks = new WeakMap<object, string>();

export function useStorageDoctor() {
  const client = useStorageClient();
  const binding = useDashboardCommandBinding();
  const latest = useSettingsRead<StorageDoctorLatestWire>(client, "doctor-latest");
  const checking = useSettingsRead<StorageDoctorWire>(client, "doctor-check");
  const observed = useSyncExternalStore(latest.subscribe, latest.snapshot, latest.snapshot);
  const check = useSyncExternalStore(checking.subscribe, checking.snapshot, checking.snapshot);
  const request = useMemo(() => ({ client, latest, checking }), [client, latest, checking]);
  const current = useRef(request);
  current.current = request;
  const now = useRef(0);
  now.current = binding === undefined ? systemClock.nowMs() : Date.parse(binding.authority.nowIso);
  const run = useCallback((): Promise<StorageDoctorWire> => checking.read(() => client.storageDoctor(), "STORAGE_DOCTOR_FAILED", STORAGE_DOCTOR_DEADLINE_MS).then(report => {
    latest.accept({ state: "completed", report });
    return report;
  }), [client, checking, latest]);
  const checkStale = useCallback((value: StorageDoctorLatestWire | undefined): void => {
    if (value?.state !== "completed") return;
    if (now.current - Date.parse(value.report.checkedAt) > STORAGE_DOCTOR_MAX_AGE_MS && staleChecks.get(checking) !== value.report.checkedAt) {
      staleChecks.set(checking, value.report.checkedAt);
      void run().catch(() => checking.snapshot());
    }
  }, [checking, run]);
  useEffect(() => {
    checkStale(latest.snapshot().value);
    void latest.read(async () => {
      const value = await client.latestStorageDoctor();
      const held = latest.snapshot().value;
      if (held?.state === "completed" && (value.state === "never-run" || Date.parse(value.report.checkedAt) < Date.parse(held.report.checkedAt))) throw new Error(ERROR_CATALOG.STORAGE_DOCTOR_FAILED.text);
      return value;
    }, "STORAGE_DOCTOR_FAILED").then(value => {
      if (current.current !== request || value.state !== "completed") return;
      checkStale(value);
    }).catch(() => latest.snapshot());
  }, [client, latest, checking, request, checkStale]);
  const report = observed.value?.state === "completed" ? observed.value.report : undefined;
  const doctor: DoctorState = check.state === "loading" ? { state: "running", report }
    : observed.state === "failed" || check.state === "failed" ? { state: "failed", report, message: ERROR_CATALOG.STORAGE_DOCTOR_FAILED.text, neverRun: observed.value?.state === "never-run" }
    : report !== undefined ? { state: "loaded", report }
    : observed.state === "idle" || observed.state === "loading" ? { state: "reading" }
    : { state: "idle" };
  const runDoctor = (): void => {
    if (current.current !== request || doctor.state === "running" || doctor.state === "reading") return;
    void run().catch(() => checking.snapshot());
  };
  return { doctor, runDoctor };
}
