import { useCallback, useEffect, useRef, useState } from "react";
import type { IntakeQueries } from "../client/intake-queries.js";

export type IntakeUploadState =
  | { phase: "idle" | "reading" | "uploading" }
  | { phase: "refused"; code: string; message: string }
  | { phase: "failed"; delivery: "not-sent" | "unknown"; message: string };

/** Cancellation suppresses client work; an upload already sent may still commit. */
export function useIntakeUpload(client: IntakeQueries, workflowId: string, onOpened: (id: string) => void) {
  const [state, setState] = useState<IntakeUploadState>({ phase: "idle" });
  const generation = useRef(0);
  const pending = useRef(false);
  useEffect(() => () => { generation.current++; pending.current = false; }, [client, workflowId]);
  const upload = useCallback((file: File): void => {
    if (pending.current) return;
    pending.current = true;
    const attempt = ++generation.current;
    const current = () => generation.current === attempt;
    setState({ phase: "reading" });
    let sent = false;
    void (async () => {
      try {
        const bytes = await file.arrayBuffer();
        if (!current()) return;
        sent = true;
        setState({ phase: "uploading" });
        const result = await client.uploadIntakeFile({ workflowId, fileName: file.name,
          mediaType: file.type.length > 0 ? file.type : "application/octet-stream", bytes });
        if (!current()) return;
        pending.current = false;
        if (result.state === "refused") setState({ phase: "refused", code: result.code, message: result.message });
        else { setState({ phase: "idle" }); onOpened(result.session.intakeSessionId); }
      } catch (error) {
        if (!current()) return;
        pending.current = false;
        setState({ phase: "failed", delivery: sent ? "unknown" : "not-sent", message: error instanceof Error ? error.message : String(error) });
      }
    })();
  }, [client, workflowId, onOpened]);
  return { state, upload };
}
