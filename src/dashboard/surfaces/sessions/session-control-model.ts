import { WorkerBrowserCommandRequestSchema } from "../../../domain/commands.js";
import { useEffect, useRef, useState } from "react";
import type { WorkerCardWire } from "./session-panel-model.js";
import type { WorkerCommandDispatch, WorkerControlAction } from "../../app/commands/worker-command-dispatch.js";

export function workerControlRefusal(card: WorkerCardWire, browser = false): string | undefined {
  if (card.controls === undefined) return "This dashboard cannot verify control of this worker.";
  if (card.controls.ownership.state !== "owned") return card.controls.ownership.reason;
  if (card.controls.basis.state !== "present") return card.controls.basis.reason;
  if (card.controls.operation?.unresolved) return "Previous command is unresolved; check its exact outcome.";
  if (card.state === "stopped" || card.state === "failed" || card.directive === "stop") return "Worker is stopping or stopped.";
  if (browser && (card.currentRun.state === "present" || card.state !== "idle" && card.state !== "paused")) return "Browser control unavailable while a run is active.";
  return undefined;
}
export function browserHealthLabel(browser: WorkerCardWire["browsers"][number]): string {
  const observation = browser.observation;
  if (observation?.state !== "present") return "Not checked";
  return observation.health === "authenticated" ? "Authenticated" : observation.health === "failed" ? "Failed" : "Not verified";
}
export const WORKER_ACTION_LABEL: Record<WorkerControlAction, string> = { "pause-worker":"Pause", "resume-worker":"Resume", "stop-worker":"Stop", "refresh-browser":"Refresh", "reopen-browser":"Reopen" };
export function retainedControlMessage(card: WorkerCardWire): string | undefined {
  const operation = card.controls?.operation;
  if (operation === undefined) return undefined;
  if (operation.state === "refused") return `Refused: ${operation.message ?? "Command refused."}`;
  if (operation.state === "uncertain") return "Outcome uncertain. No new effect is authorized.";
  if (operation.state !== "succeeded" || operation.unresolved) return "Command pending.";
  return undefined;
}
/** One card retains its exact submitted request while live snapshots and clocks change. */
export function useSessionControl(card: WorkerCardWire, dispatch: WorkerCommandDispatch | undefined) {
  const cardElement = useRef<HTMLElement>(null);
  const focusName = useRef<string | undefined>(undefined);
  const [local, setLocal] = useState<{ request?: unknown; state:"pending"|"refused"|"uncertain"|"applied"; message:string }>();
  const submitted = local?.request === undefined ? undefined : WorkerBrowserCommandRequestSchema.parse(local.request);
  const servedBasis = card.controls?.basis;
  const submittedBasis = submitted !== undefined && "workerId" in submitted.target ? submitted.target.controlBasis : undefined;
  const advanced = servedBasis?.state === "present" && submittedBasis !== undefined
    && (servedBasis.value.leaseGeneration !== submittedBasis.leaseGeneration || servedBasis.value.controlRevision > submittedBasis.controlRevision);
  const waitingForReadback = local?.state === "applied" && submitted !== undefined
    && card.controls?.operation?.commandId !== submitted.commandId && !advanced;
  useEffect(() => {
    const name = focusName.current;
    if (name === undefined) return;
    const element = cardElement.current;
    if (element === null) return;
    const document = element.ownerDocument;
    const target = [
      ...element.querySelectorAll("button"),
      ...[...document.querySelectorAll<HTMLButtonElement>("button[data-session-worker]")]
        .filter((button) => button.getAttribute("data-session-worker") === String(card.workerId)),
    ].find((button) => (button.getAttribute("aria-label") ?? button.textContent?.trim()) === name);
    if (document.activeElement !== document.body && document.activeElement !== target) { focusName.current = undefined; return; }
    if ((card.state === "stopped" || card.state === "failed") && document.activeElement === document.body) {
      element.focus(); focusName.current = undefined; return;
    }
    if (target !== undefined && !target.disabled) {
      if (document.activeElement === document.body) target.focus();
      if (local?.state !== "pending" && !waitingForReadback && !card.controls?.operation?.unresolved) focusName.current = undefined;
    }
  });
  const send = async (request: unknown) => {
    if (dispatch === undefined) return;
    setLocal({request,state:"pending",message:"Command pending."});
    try {
      const result = await dispatch.send(request);
      setLocal(result.kind === "refused" ? {request,state:"refused",message:result.message} : {request,state:"applied",message:"Command recorded."});
    } catch { setLocal({request,state:"uncertain",message:"Response unavailable. Check this command's outcome before another action."}); }
  };
  return {
    cardElement,
    busy:local?.state === "pending" || local?.state === "uncertain" || waitingForReadback,
    message:local?.state === "applied" ? retainedControlMessage(card) : local?.message ?? retainedControlMessage(card),
    uncertain:local?.state === "uncertain" || card.controls?.operation?.state === "uncertain",
    retry:local?.state === "uncertain" && local.request !== undefined ? () => {void send(local.request);} : undefined,
    invoke:(type:WorkerControlAction,browserSessionId?:string) => {
      if(dispatch===undefined)return;
      const active = cardElement.current?.ownerDocument.activeElement;
      if (active instanceof HTMLButtonElement && (cardElement.current?.contains(active) || active.getAttribute("data-session-worker") === String(card.workerId))) {
        focusName.current = active.getAttribute("aria-label") ?? active.textContent?.trim();
      }
      try {const request=dispatch.prepare(card,type,browserSessionId);void send(request);}
      catch(error){setLocal({state:"refused",message:error instanceof Error?error.message:"Control unavailable."});}
    },
  };
}
