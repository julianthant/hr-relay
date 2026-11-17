import { useCallback, useEffect, useState } from "react";
import { PreflightSelectionSchema, type PreflightReadinessWire } from "../../../models/preflight/preflight-contract.js";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import { readWithDeadline } from "../../client/read-deadline.js";
import type { PreflightQueries } from "../../client/queries/preflight-queries.js";
import { CHECK_COPY } from "../settings/preflight/preflight-check-copy.js";
import { runCheckFix, runCheckHint } from "../settings/preflight/preflight-remedy-model.js";

export type RunCheckVerdict = "pass" | "warning" | "fail";
export interface RunCheckRow {
  readonly check: string;
  readonly title: string;
  readonly description: string;
  readonly verdict: RunCheckVerdict;
  /** The Settings section a failed, fixable check opens, and the button's name; absent means nothing to fix here. */
  readonly fix?: Readonly<{ section: string; label: string; target?: string }>;
}

export type RunChecksState =
  | Readonly<{ state: "checking" }>
  | Readonly<{ state: "ready"; rows: readonly RunCheckRow[] }>
  | Readonly<{ state: "unavailable"; message: string }>;

const RANK: Readonly<Record<RunCheckVerdict, number>> = { fail: 0, warning: 1, pass: 2 };

/** Every check of the served report as a row, problems first; text comes from the readiness check copy. */
export function runCheckRows(wire: PreflightReadinessWire): RunChecksState {
  if (wire.state !== "present") return { state: "unavailable", message: wire.reason };
  const rows = wire.report.results.map((result): RunCheckRow => {
    const copy = CHECK_COPY[result.check];
    if (copy === undefined) throw new Error(`Run check "${result.check}" has no readiness copy`);
    const fix = result.status === "fail" ? runCheckFix(result.check) : null;
    const description = result.status === "pass" ? copy.description
      : result.status === "fail" && fix === null ? `${runCheckHint(result.check)} ${result.summary}` : result.summary;
    return { check: result.check, title: copy.name, description,
      verdict: result.status, ...(fix === null ? {} : { fix }) };
  });
  return { state: "ready", rows: rows.map((row, index) => ({ row, index })).sort((a, b) => RANK[a.row.verdict] - RANK[b.row.verdict] || a.index - b.index).map(({ row }) => row) };
}

/** Start stays off until every check was read and none failed; warnings do not block. */
export const runChecksBlocked = (state: RunChecksState): boolean =>
  state.state !== "ready" || state.rows.some(row => row.verdict === "fail");

/** Reads the selected workflow's readiness while `active`, and again on every `recheck` or workflow change. */
export function useRunChecks(client: PreflightQueries, workflowId: string | undefined, active: boolean): Readonly<{ state: RunChecksState; recheck: () => void }> {
  const [state, setState] = useState<RunChecksState>({ state: "checking" });
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (!active || workflowId === undefined) return;
    let current = true;
    setState({ state: "checking" });
    void readWithDeadline(() => client.readPreflight(PreflightSelectionSchema.parse({ workflowId })), "PREFLIGHT_READ_UNAVAILABLE").then(
      wire => { if (current) setState(runCheckRows(wire)); },
      () => { if (current) setState({ state: "unavailable", message: ERROR_CATALOG.PREFLIGHT_READ_UNAVAILABLE.text }); });
    return () => { current = false; };
  }, [client, workflowId, active, round]);
  const recheck = useCallback(() => setRound(value => value + 1), []);
  return { state, recheck };
}
