/**
 * Opening a row: the small header, then only the selected panel section
 * (doc 13 §3.3/§7.4 — a terminal 50-person packet must not ship in the day
 * payload). Selection and section are client UI state; everything they fetch
 * is a finished server read model.
 */
import { useEffect, useState } from "react";
import type {
  RunDetailSectionResponse,
  RunDetailWire,
} from "../../domain/dashboard/run-detail.js";
import { DashboardClientError } from "../client/index.js";
import { failed, IDLE, loaded, LOADING, type AsyncResource } from "./async-resource.js";
import { useDashboardClient } from "./client-context.js";

export function useRunDetail(runId: string | undefined): AsyncResource<RunDetailWire> {
  const client = useDashboardClient();
  const [resource, setResource] = useState<AsyncResource<RunDetailWire>>(IDLE);

  useEffect(() => {
    if (runId === undefined) {
      setResource(IDLE);
      return;
    }
    let live = true;
    setResource(LOADING);
    client.runDetail(runId).then(
      (value) => {
        if (live) setResource(loaded(value));
      },
      (error: unknown) => {
        if (!live) return;
        if (error instanceof DashboardClientError) {
          setResource(failed(error));
          return;
        }
        throw error;
      },
    );
    return () => {
      live = false;
    };
  }, [client, runId]);

  return resource;
}

/**
 * One section of the open run. A section the detail did not advertise is never
 * requested — `availableSections` is the server's statement of what exists, and
 * asking anyway would turn a legitimate absence into an error toast.
 */
export function useRunSection(
  runId: string | undefined,
  section: string | undefined,
  availableSections: readonly string[],
): AsyncResource<RunDetailSectionResponse> {
  const client = useDashboardClient();
  const [resource, setResource] = useState<AsyncResource<RunDetailSectionResponse>>(IDLE);
  const advertised = section !== undefined && availableSections.includes(section);

  useEffect(() => {
    if (runId === undefined || section === undefined || !advertised) {
      setResource(IDLE);
      return;
    }
    let live = true;
    setResource(LOADING);
    client.runSection(runId, section).then(
      (value) => {
        if (live) setResource(loaded(value));
      },
      (error: unknown) => {
        if (!live) return;
        if (error instanceof DashboardClientError) {
          setResource(failed(error));
          return;
        }
        throw error;
      },
    );
    return () => {
      live = false;
    };
  }, [client, runId, section, advertised]);

  return resource;
}
