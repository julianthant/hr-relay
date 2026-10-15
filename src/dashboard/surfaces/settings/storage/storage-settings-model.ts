import { useEffect, useMemo, useRef, useState } from "react";
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
  | { state: "reading" }
  | { state: "running"; report?: StorageDoctorWire }
  | { state: "loaded"; report: StorageDoctorWire }
  | { state: "failed"; message: string; report?: StorageDoctorWire };

export function useStorageDoctor() {
  const client = useStorageClient();
  const binding = useDashboardCommandBinding();
  const request = useMemo(() => ({ client, authority: binding?.authority.epoch }), [client, binding?.authority.epoch]);
  const current = useRef(request);
  current.current = request;
  const sequence = useRef(0);
  const pending = useRef<typeof request | undefined>(undefined);
  const [observed, setObserved] = useState<{ request: typeof request; doctor: DoctorState }>({ request, doctor: { state: "reading" } });
  const doctor: DoctorState = observed.request === request ? observed.doctor : { state: "reading" };
  useEffect(() => {
    const started = ++sequence.current;
    const publish = (doctor: DoctorState): void => {
      if (current.current === request && sequence.current === started) setObserved({ request, doctor });
    };
    void client.latestStorageDoctor().then(
      latest => publish(latest.state === "completed" ? { state: "loaded", report: latest.report } : { state: "idle" }),
      (error: unknown) => publish({ state: "failed", message: error instanceof Error ? error.message : String(error) }),
    );
    return () => { sequence.current += 1; };
  }, [client, request]);
  const runDoctor = (): void => {
    if (current.current !== request || pending.current === request || doctor.state === "running" || doctor.state === "reading") return;
    const started = ++sequence.current;
    pending.current = request;
    const report = doctor.report;
    setObserved({ request, doctor: { state: "running", report } });
    void client.storageDoctor().then(
      report => { if (current.current === request && sequence.current === started) { pending.current = undefined; setObserved({ request, doctor: { state: "loaded", report } }); } },
      (error: unknown) => { if (current.current === request && sequence.current === started) { pending.current = undefined; setObserved({ request, doctor: { state: "failed", report, message: error instanceof Error ? error.message : String(error) } }); } },
    );
  };
  return { doctor, runDoctor };
}
