/** D292: Receipt capture state belongs to the app's requested run, not a stale detail. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RunCaptureArtifactWire, RunDetailWire } from "../../domain/dashboard/run-detail.js";
import { useDashboardClient } from "../state/client-context.js";

export interface RunCaptureItem {
  readonly capture: RunCaptureArtifactWire;
  readonly downloadUrl: string;
}

type RunCapturesRead =
  | { readonly state: "inactive" }
  | { readonly state: "loading" }
  | { readonly state: "absent"; readonly reason: string }
  | { readonly state: "error"; readonly message: string }
  | { readonly state: "available"; readonly runId: string; readonly items: readonly RunCaptureItem[] };

export type RunCapturesState = Exclude<RunCapturesRead, { state: "available" }>
  | (Extract<RunCapturesRead, { state: "available" }> & {
    readonly generation: number;
    readonly selectedId: string | undefined;
    readonly select: (artifactId: string | undefined) => void;
  });

export function runCaptureFrame(capture: RunCaptureArtifactWire): string {
  return capture.origins.some(origin => origin.originKind === "failure")
    ? "border-2 border-[color:var(--ds-danger)]"
    : "border border-[color:var(--ds-border)]";
}

export function useRunCaptures(
  requestedRunId: string | undefined,
  detail: RunDetailWire | undefined,
  active: boolean,
): RunCapturesState {
  const client = useDashboardClient();
  const runId = detail?.runId;
  const revision = detail?.rowRevision;
  const available = detail?.captures?.state === "available";
  const count = detail?.captures?.state === "available" ? detail.captures.artifactCount : undefined;
  const advertised = detail?.availableSections.includes("captures") === true;
  const owner = useMemo(() => ({ requestedRunId, runId, revision, active, available, count, advertised }),
    [requestedRunId, runId, revision, active, available, count, advertised]);
  const [read, setRead] = useState<{ owner: typeof owner; generation: number; value: RunCapturesRead }>(
    { owner, generation: 0, value: { state: "loading" } },
  );
  const [selection, setSelection] = useState<{ owner: typeof owner; artifactId: string }>();
  const select = useCallback((artifactId: string | undefined) => {
    if (artifactId === undefined) {
      setSelection(current => current?.owner === owner ? undefined : current);
      return;
    }
    if (read.owner !== owner || read.value.state !== "available"
      || !read.value.items.some(item => item.capture.artifact.artifactId === artifactId)) {
      throw new Error("The selected capture does not belong to the current run read.");
    }
    setSelection({ owner, artifactId });
  }, [owner, read]);
  // Invalidate during render, before any child can commit yesterday's capture.
  if (read.owner !== owner) setRead({ owner, generation: read.generation + 1, value: { state: "loading" } });
  useEffect(() => {
    if (!owner.active || !owner.available || !owner.advertised || owner.requestedRunId === undefined
      || owner.runId !== owner.requestedRunId) return;
    const controller = new AbortController();
    let live = true;
    const publish = (value: RunCapturesRead) => {
      if (!live) return;
      setRead(current => current.owner === owner ? { ...current, value } : current);
    };
    void client.runSection(owner.requestedRunId, "captures", undefined, controller.signal).then(response => {
      if (response.section !== "captures") {
        publish({ state: "error", message: "The capture response named a different section." });
        return;
      }
      if (response.payload.artifacts.length !== owner.count) {
        publish({ state: "error", message: `Capture count does not match the availability for run ${owner.requestedRunId}.` });
        return;
      }
      publish({ state: "available", runId: response.payload.runId,
        items: response.payload.artifacts.map(capture => ({ capture, downloadUrl: client.artifactUrl(capture.artifact.artifactId) })) });
    }, (error: unknown) => {
      publish({ state: "error", message: error instanceof Error ? error.message : "The capture request failed." });
    });
    return () => { live = false; controller.abort(); };
  }, [client, owner]);
  if (!active || requestedRunId === undefined) return { state: "inactive" };
  if (detail?.runId !== requestedRunId) return { state: "loading" };
  if (detail.captures === undefined) return { state: "error", message: `Live capture availability is missing for run ${requestedRunId}.` };
  if (available !== advertised) return { state: "error", message: `Capture availability and section advertisement disagree for run ${requestedRunId}.` };
  if (detail.captures.state === "error") return { state: "error", message: `${detail.captures.code}: ${detail.captures.message}` };
  if (detail.captures?.state === "absent") return detail.captures;
  if (read.owner !== owner) return { state: "loading" };
  return read.value.state === "available" ? {
    ...read.value, generation: read.generation,
    selectedId: selection?.owner === owner ? selection.artifactId : undefined, select,
  } : read.value;
}

/** The mounted DOM image owns each decode, not a URL that may be visited again. */
export function useRunCaptureImage(artifact: RunCaptureArtifactWire["artifact"]) {
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const mounted = useRef<HTMLImageElement | null>(null);
  const attempt = useRef<object | undefined>(undefined);
  const bind = useCallback((image: HTMLImageElement | null) => {
    mounted.current = image;
    attempt.current = undefined;
  }, []);
  const fail = useCallback((image: HTMLImageElement) => {
    if (mounted.current !== image) return;
    attempt.current = undefined;
    setState("failed");
  }, []);
  const decode = useCallback((image: HTMLImageElement) => {
    if (mounted.current !== image) return;
    const current = {};
    attempt.current = current;
    setState("loading");
    // A missing/throwing decoder is a local refusal too, never a ready image.
    void Promise.resolve().then(() => image.decode()).then(() => {
      if (attempt.current !== current) return;
      setState(artifact.mediaKind === "image" && image.naturalWidth === artifact.width
        && image.naturalHeight === artifact.height ? "ready" : "failed");
    }, () => {
      if (attempt.current === current) setState("failed");
    });
  }, [artifact]);
  return { state, bind, fail, decode };
}
