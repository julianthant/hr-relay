import { useCallback, useEffect, useRef, useState } from "react";
import { chatGptOcrAvailable } from "../../../models/dashboard/chatgpt-account.js";
import { PreflightSelectionSchema, type PreflightReadinessWire } from "../../../models/preflight/preflight-contract.js";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import { DashboardClientError } from "../../client/errors.js";
import { BOUNDED_READ_BUDGET_MS, CHATGPT_ACCOUNT_READ_DEADLINE_MS, PREFLIGHT_RERUN_DEADLINE_MS, readDeadlineExpired, readWithDeadline } from "../../client/read-deadline.js";
import type { PreflightQueries } from "../../client/queries/preflight-queries.js";
import type { SettingsQueries } from "../../client/queries/settings-queries.js";
import type { ChatGptAccountQueries } from "../../client/queries/chatgpt-account-queries.js";
import { useDashboardCommandBinding } from "../../state/client-context.js";
import { systemClock } from "../../../rules/time/clock.js";
import { CHECK_COPY } from "../settings/preflight/preflight-check-copy.js";
import { runCheckFix } from "../settings/preflight/preflight-remedy-model.js";

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
export function runCheckRows(wire: PreflightReadinessWire, ocrAvailable = true): RunChecksState {
  if (wire.state !== "present") return { state: "unavailable", message: wire.reason };
  const rows = wire.report.results.map((result): RunCheckRow => {
    const copy = CHECK_COPY[result.check];
    if (copy === undefined) throw new Error(`Run check "${result.check}" has no readiness copy`);
    const fix = result.status === "fail" ? runCheckFix(result.check) : null;
    const description = result.status === "fail" && fix === null ? copy.description : result.summary;
    return { check: result.check, title: copy.name, description,
      verdict: result.status, ...(fix === null ? {} : { fix }) };
  });
  if (!ocrAvailable) rows.unshift({ check: "ocr.extract", title: "OCR page reading", description: ERROR_CATALOG.PROVIDER_UNAVAILABLE.text, verdict: "fail" });
  return { state: "ready", rows: rows.map((row, index) => ({ row, index })).sort((a, b) => RANK[a.row.verdict] - RANK[b.row.verdict] || a.index - b.index).map(({ row }) => row) };
}

/** Start stays off until every check was read and none failed; warnings do not block. */
export const runChecksBlocked = (state: RunChecksState): boolean =>
  state.state !== "ready" || state.rows.some(row => row.verdict === "fail");

function runCheckFailure(error: unknown, fallback: string): string {
  const cause = error instanceof DashboardClientError && error.cause instanceof DashboardClientError ? error.cause : error;
  if (readDeadlineExpired(cause)) return "The readiness check request timed out.";
  if (cause instanceof DashboardClientError) {
    if (cause.code === "COMMAND_RESULT_IDENTITY_MISMATCH") return ERROR_CATALOG.COMMAND_RESULT_IDENTITY_MISMATCH.text;
    if ((cause.kind === "schema" && cause.code === undefined)
      || (cause.kind === "http" && cause.status !== undefined && cause.status >= 200 && cause.status < 300)) {
      return "Relay received an invalid readiness response.";
    }
    if (cause.kind === "network") return "Relay lost the connection while checking readiness.";
    if (cause.kind === "http" && cause.status !== undefined && cause.status >= 400) {
      if ((cause.status === 409 || cause.status === 429) && cause.code?.startsWith("PREFLIGHT_")) return cause.message;
      return `The readiness service returned HTTP ${String(cause.status)}.`;
    }
  }
  if (error instanceof DashboardClientError && error.code === "SETTINGS_READ_UNAVAILABLE") return ERROR_CATALOG.PREFLIGHT_SETTINGS_UNAVAILABLE.text;
  return fallback;
}

/** Reads exact-scope evidence while active. Each workflow may prepare missing evidence once per open dialog and once after its Fix visit. */
export function useRunChecks(client: PreflightQueries & Pick<SettingsQueries, "editableSettings"> & Pick<ChatGptAccountQueries, "checkChatGptAccount">,
  workflowId: string | undefined, active: boolean, prepare: boolean, open: boolean, requiresOcr: boolean) {
  const binding = useDashboardCommandBinding();
  const actorId = binding?.scope.actorId;
  const authority = binding?.authority.epoch;
  const [read, setRead] = useState<Readonly<{ workflowId: string | undefined; requiresOcr: boolean; state: RunChecksState }>>({ workflowId, requiresOcr, state: { state: "checking" } });
  /** Another workflow's checks never stand for this one's. */
  const state: RunChecksState = read.workflowId === workflowId && read.requiresOcr === requiresOcr ? read.state : { state: "checking" };
  /** The latest asked-for re-check, bound to the workflow it was asked for; `handled` is the last one sent. */
  const [rerun, setRerun] = useState<Readonly<{ workflowId: string; n: number }>>();
  const handled = useRef(0);
  /** The workflow whose read found no evidence before Checks was reached; reaching Checks asks for it. */
  const [held, setHeld] = useState<string>();
  const asked = useRef(new Set<string>());
  const prepareNow = useRef(prepare);
  prepareNow.current = prepare;
  const ask = useCallback((id: string) => setRerun(current => ({ workflowId: id, n: (current?.n ?? 0) + 1 })), []);
  useEffect(() => { if (!open) { asked.current.clear(); setHeld(undefined); } }, [open]);
  useEffect(() => { if (prepare && held !== undefined && held === workflowId) { setHeld(undefined); ask(held); } }, [prepare, held, workflowId, ask]);
  useEffect(() => {
    if (!active || workflowId === undefined) return;
    const controller = new AbortController();
    let current = true;
    let failureMessage: string = ERROR_CATALOG.PREFLIGHT_READ_FAILED.text;
    const setState = (next: RunChecksState) => setRead({ workflowId, requiresOcr, state: next });
    const posting = rerun !== undefined && rerun.workflowId === workflowId && rerun.n > handled.current;
    if (rerun !== undefined) handled.current = Math.max(handled.current, rerun.n);
    setState({ state: "checking" });
    setHeld(undefined);
    const check = async (): Promise<PreflightReadinessWire | undefined> => {
      const selection = PreflightSelectionSchema.parse({ workflowId });
      if (!posting) {
        const wire = await client.readPreflight(selection);
        if (!current || wire.state === "present" || wire.code === "PREFLIGHT_READ_FAILED" || asked.current.has(workflowId)) return wire;
        if (!prepareNow.current) { setHeld(workflowId); return; }
      }
      if (actorId === undefined) return { state: "unavailable", reason: ERROR_CATALOG.PREFLIGHT_SCOPE_UNAVAILABLE.text };
      failureMessage = ERROR_CATALOG.PREFLIGHT_SCOPE_UNAVAILABLE.text;
      const [settings, workflows] = await readWithDeadline(() => Promise.all([client.editableSettings({ retry: true }), client.preflightScopes()]),
        "PREFLIGHT_SCOPE_UNAVAILABLE", BOUNDED_READ_BUDGET_MS);
      if (!current) return;
      const workflow = workflows.find(candidate => candidate.id === workflowId);
      if (workflow === undefined) return { state: "unavailable", reason: ERROR_CATALOG.PREFLIGHT_SCOPE_UNAVAILABLE.text };
      if (settings.runtimeStatus.state !== "current") return { state: "unavailable", reason: ERROR_CATALOG.PREFLIGHT_SETTINGS_RESTART_REQUIRED.text };
      asked.current.add(workflowId);
      failureMessage = ERROR_CATALOG.PREFLIGHT_RERUN_UNAVAILABLE.text;
      await readWithDeadline(() => client.rerunPreflight({
        commandId: crypto.randomUUID(), requestedAt: systemClock.now().toISOString(), requestedBy: actorId,
        source: "run-start", type: "rerun-preflight", target: {
          expectedConfigFingerprint: settings.activeConfigFingerprint,
          expectedDescriptorFingerprint: workflow.descriptorFingerprint, selection,
        },
      }), "PREFLIGHT_RERUN_UNAVAILABLE", PREFLIGHT_RERUN_DEADLINE_MS);
      if (!current) return;
      failureMessage = ERROR_CATALOG.PREFLIGHT_READ_FAILED.text;
      return client.readPreflight(selection);
    };
    const provider = requiresOcr
      ? readWithDeadline(signal => client.checkChatGptAccount(signal, { fresh: true }), "PROVIDER_UNAVAILABLE", CHATGPT_ACCOUNT_READ_DEADLINE_MS, controller.signal)
        .then(status => chatGptOcrAvailable(status) && status.ocrModelAvailable === true, () => false)
      : Promise.resolve(true);
    void Promise.all([check(), provider]).then(([wire, ready]) => {
      if (current && wire !== undefined) setState(runCheckRows(wire, ready));
    }).catch((error: unknown) => {
      if (current) setState({ state: "unavailable", message: runCheckFailure(error, failureMessage) });
    });
    return () => { current = false; controller.abort(); };
  }, [client, workflowId, active, rerun, actorId, authority, requiresOcr]);
  const recheck = useCallback(() => { if (workflowId !== undefined) ask(workflowId); }, [ask, workflowId]);
  return { state, recheck, prepareAfterFix: () => { if (workflowId !== undefined) asked.current.delete(workflowId); } };
}

/** "1 check failed", as the footer and the Checks announcement read it; undefined while no check has failed. */
export function failedCheckSentence(checks: RunChecksState): string | undefined {
  const failed = checks.state === "ready" ? checks.rows.filter(row => row.verdict === "fail").length : 0;
  return failed === 0 ? undefined : `${failed} ${failed === 1 ? "check" : "checks"} failed`;
}
