import { useCallback, useEffect, useRef, useState } from "react";
import { createErrorCatalogFailure, formatErrorCatalogFailure } from "../../../models/failures/error-catalog.js";
import type { RerunValuesSnapshot } from "../../../models/dashboard/rerun-values.js";
import type { RerunWarningWire } from "../../../models/dashboard/rerun-warning.js";
import type { StartPlanRequest } from "../../../models/dashboard/start-plan.js";
import type { CommandResult, RunWorkerStartupFailure } from "../../../rules/commands/commands.js";
import type { CommandOutcome } from "../../app/commands/command-executor.js";
import { commandAttemptView, type CommandAttemptView } from "../../app/commands/command-outcome.js";
import type { StartPlanResponse } from "../../client/commands/start-commands.js";
import type { LaunchFinalCommand, LaunchVerificationPlan } from "./run-launch-recovery.js";
import type { RerunLaunchSource } from "./run-launch-model.js";

/** The Run and Rerun dialog stages. There is no Confirm: Start is the last stage and its Start plans and submits. */
export type RunStartStage = "Input" | "Warning" | "Start";

export type RunDialogState = Readonly<{
  nextRequest: number;
  /** Mirror of the routed stage, never stored apart from it. */
  stage: RunStartStage;
  source: LaunchSource;
  recovery: LaunchRecovery;
  /** The plan on screen; drawn only while `for` is the current fingerprint. */
  shown?: Planned;
  problem?: string;
  /** The last prepared or sent final command; decides expiry re-planning. */
  prepared?: LaunchFinalCommand;
  /** Requests running without owning busy. */
  detached: readonly DetachedRequest[];
  activity: LaunchActivity;
}>;

export type LaunchSource =
  | { readonly kind: "start" }
  | { readonly kind: "rerun"; readonly request: RerunLaunchSource; readonly load: RerunLoad };
export type RerunLoad =
  | { readonly state: "loading"; readonly request: number }
  | { readonly state: "failed"; readonly message: string }
  | { readonly state: "ready"; readonly snapshot: RerunValuesSnapshot;
      readonly warning?: RerunWarningWire; readonly acknowledgment?: string };

export type LaunchAnswer = Exclude<CommandResult, { state: "pending" }>;
export type LaunchRecovery =
  | { readonly state: "none" }
  | { readonly state: "unreadable"; readonly message: string }
  /** `answer.for` is the fingerprint the server answered for; another fingerprint hides it. */
  | { readonly state: "retained"; readonly command: LaunchFinalCommand;
      readonly answer?: Readonly<{ reply: LaunchAnswer; for: string }> };

/** What is in flight. `request` is the request's number; `for` the fingerprint it serves. */
export type LaunchActivity =
  | { readonly kind: "idle" }
  | { readonly kind: "planning"; readonly request: number; readonly for: string }
  | { readonly kind: "checking-warnings"; readonly request: number; readonly for: string;
      readonly acknowledgmentAtDispatch?: string }
  | { readonly kind: "submitting"; readonly request: number; readonly for: string; readonly command: LaunchFinalCommand;
      readonly expiryRequest?: StartPlanRequest; readonly plannedCount?: number }
  | { readonly kind: "replanning"; readonly request: number; readonly for: string; readonly planRequest: StartPlanRequest };

export type DetachedRequest = Exclude<LaunchActivity, { kind: "idle" }>;

export type Planned = Readonly<{
  for: string;
  plan: StartPlanResponse;
  request: StartPlanRequest;
  /** Display only: the plan replaced an expired one. */
  expired: boolean;
}>;

/** What the draft allows this render; `next` is the adjacent stage, null on the last stage. */
export type LaunchGates = Readonly<{
  next: RunStartStage | null;
  inputBlocked: boolean;
  stepsBlocked: boolean;
  /** A required launch pick (a PDF workflow's File to OnBase) is still unmade; it blocks Start. */
  optionsBlocked: boolean;
  rerunInputBlocked: boolean;
  /** A readiness check failed or has not been read yet; Start stays off until every check passes or only warns. */
  checksBlocked: boolean;
  referencesUnavailable: boolean;
  omissionMismatch: boolean;
  plannedCount: number;
  /** The stages on screen, in order. */
  path?: readonly RunStartStage[];
  /** Undefined when the workflow has no dry run; otherwise the draft's choice. */
  dryRun?: boolean;
}>;

export type AuthorityCheck = { readonly state: "ok" } | { readonly state: "replaced" };
export type RunDialogEvent =
  | { type: "open"; recovery: LaunchRecovery; rerun?: RerunLaunchSource }
  | { type: "source-loaded"; request: number; snapshot: RerunValuesSnapshot }
  | { type: "source-failed"; request: number; message: string }
  | { type: "pick-workflow" }
  | { type: "draft-changed" }
  | { type: "go-to"; stage: RunStartStage; via: "back" | "stage-bar"; path?: readonly RunStartStage[] }
  | { type: "continue"; gates: LaunchGates }
  | { type: "plan-settled"; request: number; plan: StartPlanResponse; planRequest: StartPlanRequest }
  | { type: "plan-failed"; request: number; message: string }
  | { type: "warnings-settled"; request: number; warning: RerunWarningWire }
  | { type: "warnings-failed"; request: number; message: string }
  | { type: "acknowledge"; via: "button" | "enter" } | { type: "cancel-warning" }
  | { type: "start"; gates: LaunchGates; authority: AuthorityCheck; planRequest: () => StartPlanRequest;
      prepare: (plan: StartPlanResponse) => LaunchFinalCommand }
  | { type: "replay"; authority: AuthorityCheck }
  | { type: "retained"; request: number }
  | { type: "submit-settled"; request: number; view: CommandAttemptView; reply?: CommandResult }
  | { type: "submit-threw"; request: number; message: string }
  | { type: "binding-changed" }
  | { type: "close" };

export type RunDialogRefusal = "superseded" | "busy" | "blocked" | "not-here";
export type RunDialogStep =
  | { readonly next: RunDialogState; readonly effects: readonly RunDialogEffect[] }
  | { readonly refused: RunDialogRefusal };
export type RunDialogEffect =
  | { kind: "load-source"; request: number }
  | { kind: "request-plan"; request: number; planRequest: StartPlanRequest }
  | { kind: "check-warnings"; request: number }
  | { kind: "retain-and-submit"; request: number; command: LaunchFinalCommand; plan?: StartPlanResponse }
  | { kind: "dismiss-recovery"; command: LaunchFinalCommand }
  | { kind: "feedback" }
  | { kind: "applied"; workflowId: string; count?: number; runId?: string; workerStartup?: RunWorkerStartupFailure }
  | { kind: "close-dialog" } | { kind: "refusal-toast" }
  /** A clean plan from Start: the runner sends `start` again with fresh authority and gates. */
  | { kind: "auto-start" };

const IDLE: LaunchActivity = { kind: "idle" };
const NONE: LaunchRecovery = { state: "none" };
const catalogText = (code: "DASHBOARD_AUTHORITY_REPLACED" | "COMMAND_DISPATCH_FAILED" | "BOUNDARY_VALIDATION_FAILED") =>
  formatErrorCatalogFailure(createErrorCatalogFailure(code, code === "BOUNDARY_VALIDATION_FAILED" ? { source: "http-response" } : {})).text;
export const REFERENCES_UNAVAILABLE = "Reference data is unavailable. Refresh it first.";

export const initialRunDialogState: RunDialogState = { nextRequest: 1, stage: "Input", source: { kind: "start" }, recovery: NONE, detached: [], activity: IDLE };

/** Stage order per source; Warning sits between Input and Start in a rerun and is never a Back target. */
function stageOrder(source: LaunchSource): readonly RunStartStage[] {
  return source.kind === "start" ? ["Input", "Start"] : ["Input", "Warning", "Start"];
}
/** `path` is the stages this draft walks; without it every stage of the source counts. */
function previousStage(state: RunDialogState, path: readonly RunStartStage[] = stageOrder(state.source)): RunStartStage | null {
  if (state.stage === "Warning") return null;
  const order = path.filter(stage => stage !== "Warning");
  return order[order.indexOf(state.stage) - 1] ?? null;
}

const requests = (state: RunDialogState): readonly DetachedRequest[] =>
  state.activity.kind === "idle" ? state.detached : [state.activity, ...state.detached];
const sendingExists = (state: RunDialogState) => requests(state).some(r => r.kind === "submitting" || r.kind === "replanning");
const withoutAnswer = (recovery: LaunchRecovery): LaunchRecovery =>
  recovery.state === "retained" && recovery.answer !== undefined ? { state: "retained", command: recovery.command } : recovery;
const currentShown = (state: RunDialogState, fingerprint: string) => state.shown?.for === fingerprint ? state.shown : undefined;
const warningNeedsAcknowledgment = (plan: StartPlanResponse) =>
  plan.rerun !== undefined && plan.rerun.warnings.length > 0 && plan.rerun.acknowledgment !== plan.rerun.warningDigest;

function sameStepKeys(left: readonly string[], right: readonly string[]): boolean {
  const a = [...left].sort(); const b = [...right].sort();
  return a.length === b.length && a.every((key, index) => key === b[index]);
}
/** A plan Start can submit without a second look: nothing refused, a matching omission set and at least one run. */
function cleanPlan(plan: StartPlanResponse, request: StartPlanRequest): boolean {
  return plan.refused.length === 0 && plan.planned.length > 0
    && sameStepKeys(plan.omittedSteps ?? [], (request.stepOmissions ?? []).map(({ step }) => step));
}

function step(next: RunDialogState, effects: readonly RunDialogEffect[] = []): RunDialogStep { return { next, effects }; }
function cleared(state: RunDialogState, keys: readonly ("shown" | "problem" | "prepared")[]): RunDialogState {
  const next: { -readonly [K in keyof RunDialogState]: RunDialogState[K] } = { ...state };
  for (const key of keys) delete next[key];
  return next;
}

/** Closing drops every request; an answered submission is dismissed, otherwise only its answer goes. */
function closeState(state: RunDialogState): { next: RunDialogState; effects: RunDialogEffect[] } {
  const answered = state.recovery.state === "retained" && state.recovery.answer !== undefined;
  const base = { ...cleared(state, answered ? ["shown", "problem", "prepared"] : ["shown", "problem"]),
    stage: "Input" as const, activity: IDLE, detached: [] };
  if (answered && state.recovery.state === "retained") return { next: { ...base, recovery: NONE }, effects: [{ kind: "dismiss-recovery", command: state.recovery.command }] };
  return { next: { ...base, recovery: withoutAnswer(state.recovery) }, effects: [] };
}

function startRefusal(state: RunDialogState, gates: LaunchGates, current: Planned | undefined): RunDialogRefusal | undefined {
  if (gates.next !== null || state.stage === "Warning") return "not-here";
  if (state.activity.kind !== "idle" || sendingExists(state)) return "busy";
  if (gates.checksBlocked) return "blocked";
  if (state.recovery.state === "unreadable") return "blocked";
  if (state.recovery.state === "retained" && current?.plan.startPlanId !== state.recovery.command.target.startPlanId) return "blocked";
  if (current !== undefined) return gates.omissionMismatch || gates.plannedCount === 0 ? "blocked" : undefined;
  if (state.source.kind === "rerun" && state.source.load.state !== "ready") return "blocked";
  if (gates.stepsBlocked) return "blocked";
  if (gates.optionsBlocked) return "blocked";
  if (state.source.kind === "start" ? gates.inputBlocked : gates.rerunInputBlocked) return "blocked";
  return undefined;
}

function continueRefusal(state: RunDialogState, gates: LaunchGates): RunDialogRefusal | undefined {
  if (state.activity.kind !== "idle") return "busy";
  if (state.stage === "Warning" || gates.next === null) return "not-here";
  if (state.recovery.state !== "none") return "blocked";
  if (state.source.kind === "rerun" && state.source.load.state !== "ready") return "blocked";
  if (state.stage === "Input" && (state.source.kind === "start" ? gates.inputBlocked : gates.rerunInputBlocked)) return "blocked";
  return undefined;
}

function acknowledgeRefusal(state: RunDialogState, via: "button" | "enter"): RunDialogRefusal | undefined {
  if (state.stage !== "Warning" || state.source.kind !== "rerun" || state.source.load.state !== "ready" || state.source.load.warning === undefined) return "not-here";
  if (via === "button") return undefined;
  if (state.activity.kind !== "idle") return "busy";
  return state.recovery.state === "none" ? undefined : "blocked";
}

function replayRefusal(state: RunDialogState): RunDialogRefusal | undefined {
  if (state.recovery.state !== "retained" || state.recovery.answer !== undefined) return "not-here";
  return state.activity.kind !== "idle" || sendingExists(state) ? "busy" : undefined;
}

/** Writes a rerun warning into a loaded source; a source that is not loaded has nowhere to hold it. */
function withWarning(source: LaunchSource, warning: RerunWarningWire, acknowledgment?: string): LaunchSource {
  if (source.kind !== "rerun" || source.load.state !== "ready") return source;
  return { ...source, load: { ...source.load, warning, ...(acknowledgment === undefined ? {} : { acknowledgment }) } };
}

type Owner = { readonly request: DetachedRequest; readonly detached: boolean };
function findOwner(state: RunDialogState, request: number, kinds: readonly DetachedRequest["kind"][]): Owner | undefined {
  if (state.activity.kind !== "idle" && state.activity.request === request) return kinds.includes(state.activity.kind) ? { request: state.activity, detached: false } : undefined;
  const found = state.detached.find(entry => entry.request === request);
  return found !== undefined && kinds.includes(found.kind) ? { request: found, detached: true } : undefined;
}
/** Completes the owner. A detached completion releases busy again, so the running activity moves into `detached`. */
function release(state: RunDialogState, owner: Owner): RunDialogState {
  if (!owner.detached) return { ...state, activity: IDLE };
  const rest = state.detached.filter(entry => entry !== owner.request);
  return { ...state, activity: IDLE, detached: state.activity.kind === "idle" ? rest : [...rest, state.activity] };
}
function replaceOwner(state: RunDialogState, owner: Owner, next: DetachedRequest): RunDialogState {
  return owner.detached ? { ...state, detached: state.detached.map(entry => entry === owner.request ? next : entry) } : { ...state, activity: next };
}

/** Terminal settlement: ownership, then currency; the payload runs only for a request made for the current fingerprint. */
function settle<K extends DetachedRequest["kind"]>(state: RunDialogState, request: number, kinds: readonly K[], fingerprint: string,
  payload: (released: RunDialogState, owner: Extract<DetachedRequest, { kind: K }>) => RunDialogStep): RunDialogStep {
  const owner = findOwner(state, request, kinds);
  if (owner === undefined) return { refused: "superseded" };
  const released = release(state, owner);
  if (owner.request.for !== fingerprint) return step(released);
  return payload(released, owner.request as Extract<DetachedRequest, { kind: K }>);
}

function planShown(state: RunDialogState, planned: Planned, effectsWhenClean: readonly RunDialogEffect[]): RunDialogStep {
  const base = { ...state, shown: planned, recovery: withoutAnswer(state.recovery) };
  const rerun = planned.plan.rerun;
  if (rerun !== undefined && warningNeedsAcknowledgment(planned.plan) && state.source.kind === "rerun" && state.source.load.state === "ready") {
    return step({ ...base, source: withWarning(state.source, { workflowId: planned.plan.workflowId, rerun }), stage: "Warning" });
  }
  return step(base, cleanPlan(planned.plan, planned.request) ? effectsWhenClean : []);
}

function submitSettled(state: RunDialogState, event: Extract<RunDialogEvent, { type: "submit-settled" }>, fingerprint: string): RunDialogStep {
  const owner = findOwner(state, event.request, ["submitting"]);
  if (owner === undefined || owner.request.kind !== "submitting") return { refused: "superseded" };
  const request = owner.request;
  const { view } = event;
  if (request.for === fingerprint && view.view === "rejected" && view.code === "RUN_START_PLAN_EXPIRED" && request.expiryRequest !== undefined) {
    const replanning: DetachedRequest = { kind: "replanning", request: request.request, for: request.for, planRequest: request.expiryRequest };
    return step({ ...cleared(replaceOwner(state, owner, replanning), ["shown", "prepared"]), recovery: NONE },
      [{ kind: "dismiss-recovery", command: request.command }, { kind: "request-plan", request: request.request, planRequest: request.expiryRequest }]);
  }
  return settle(state, event.request, ["submitting"], fingerprint, released => {
    const closed = { ...cleared(released, ["shown", "problem", "prepared"]), stage: "Input" as const, activity: IDLE, detached: [], recovery: NONE };
    switch (view.view) {
      case "landed": {
        const reply = event.reply;
        const workerStartup = reply !== undefined && (reply.state === "applied" || reply.state === "already-applied") ? reply.workerStartup : undefined;
        const startedRunId = reply !== undefined && (reply.state === "applied" || reply.state === "already-applied") ? reply.affectedTargets.find(target => target.family === "run")?.runId : undefined;
        return step(closed, [{ kind: "dismiss-recovery", command: request.command }, { kind: "feedback" },
          { kind: "applied", workflowId: request.command.target.workflowId, ...(startedRunId === undefined ? {} : { runId: startedRunId }),
            ...(request.plannedCount === undefined ? {} : { count: request.plannedCount }), ...(workerStartup === undefined ? {} : { workerStartup }) },
          { kind: "close-dialog" }]);
      }
      case "rejected": case "conflict":
        return step(closed, [{ kind: "dismiss-recovery", command: request.command }, { kind: "feedback" }, { kind: "close-dialog" }]);
      case "confirmation-required": {
        const reply = event.reply;
        const recovery = released.recovery.state === "retained" && reply !== undefined && reply.state !== "pending"
          ? { ...released.recovery, answer: { reply, for: request.for } } : released.recovery;
        return step({ ...released, problem: view.feedback.text, recovery }, [{ kind: "feedback" }]);
      }
      case "superseded": case "unknown": case "call-refused": case "not-sent":
        return step({ ...released, problem: view.feedback.text }, [{ kind: "feedback" }]);
      case "pending": case "bulk":
        throw new Error(`a start command settled as ${view.view}, which a single start never produces`);
    }
  });
}

export function runDialogTransition(state: RunDialogState, event: RunDialogEvent, fingerprint: string): RunDialogStep {
  switch (event.type) {
    case "open": {
      const base = { ...cleared(state, ["shown", "problem"]), activity: IDLE, detached: [], recovery: event.recovery };
      if (event.rerun === undefined) return step({ ...base, stage: "Input", source: { kind: "start" } });
      const request = state.nextRequest;
      return step({ ...base, nextRequest: request + 1, stage: "Input",
        source: { kind: "rerun", request: event.rerun, load: { state: "loading", request } } }, [{ kind: "load-source", request }]);
    }
    case "source-loaded": case "source-failed": {
      const source = state.source;
      if (source.kind !== "rerun" || source.load.state !== "loading" || source.load.request !== event.request) return { refused: "superseded" };
      if (event.type === "source-failed") return step({ ...state, source: { ...source, load: { state: "failed", message: event.message } } });
      const identity = event.snapshot.source;
      const load: RerunLoad = identity.runId === source.request.runId && identity.version === source.request.expectedVersion
        ? { state: "ready", snapshot: event.snapshot } : { state: "failed", message: catalogText("BOUNDARY_VALIDATION_FAILED") };
      return step({ ...state, source: { ...source, load } });
    }
    case "pick-workflow":
      if (sendingExists(state)) return { refused: "busy" };
      return step({ ...cleared(state, ["shown", "problem"]), stage: "Input", activity: IDLE, detached: [], recovery: withoutAnswer(state.recovery) });
    case "draft-changed":
      return step({ ...cleared(state, ["shown", "problem"]), recovery: withoutAnswer(state.recovery) });
    case "close": {
      const { next, effects } = closeState(state);
      return step(next, effects);
    }
    case "go-to": {
      if (event.via === "back") {
        const previous = previousStage(state, event.path);
        return previous === null || previous !== event.stage ? { refused: "not-here" } : step({ ...state, stage: previous });
      }
      if (state.activity.kind !== "idle") return { refused: "busy" };
      const order = stageOrder(state.source);
      if (event.stage === "Warning" || !order.includes(event.stage) || order.indexOf(event.stage) >= order.indexOf(state.stage)) return { refused: "not-here" };
      if (state.recovery.state === "retained") return { refused: "blocked" };
      return step({ ...state, stage: event.stage });
    }
    case "continue": {
      const refusal = continueRefusal(state, event.gates);
      if (refusal !== undefined) return { refused: refusal };
      if (state.stage === "Input" && state.source.kind === "rerun" && state.source.load.state === "ready") {
        const request = state.nextRequest;
        const acknowledgment = state.source.load.acknowledgment;
        return step({ ...cleared(state, ["problem"]), nextRequest: request + 1,
          activity: { kind: "checking-warnings", request, for: fingerprint, ...(acknowledgment === undefined ? {} : { acknowledgmentAtDispatch: acknowledgment }) } },
          [{ kind: "check-warnings", request }]);
      }
      return step({ ...state, stage: event.gates.next ?? state.stage });
    }
    case "warnings-settled":
      return settle(state, event.request, ["checking-warnings"], fingerprint, (released, owner) => {
        const digest = event.warning.rerun.warningDigest;
        if (event.warning.rerun.warnings.length > 0 && digest !== owner.acknowledgmentAtDispatch) {
          return step({ ...released, source: withWarning(released.source, event.warning), stage: "Warning" });
        }
        return step({ ...released, source: withWarning(released.source, event.warning, digest), stage: "Start" });
      });
    case "warnings-failed": case "plan-failed":
      if (event.type === "plan-failed" && findOwner(state, event.request, ["replanning"]) !== undefined) {
        return settle(state, event.request, ["replanning"], fingerprint, released => {
          const { next, effects } = closeState(released);
          return step(next, [...effects, { kind: "close-dialog" }, { kind: "refusal-toast" }]);
        });
      }
      return settle(state, event.request, [event.type === "plan-failed" ? "planning" : "checking-warnings"], fingerprint,
        released => step({ ...released, problem: event.message }));
    case "plan-settled":
      return settle(state, event.request, ["planning", "replanning"], fingerprint, (released, owner) => owner.kind === "planning"
        ? planShown(released, { for: owner.for, plan: event.plan, request: event.planRequest, expired: false }, [{ kind: "auto-start" }])
        : planShown(released, { for: owner.for, plan: event.plan, request: owner.planRequest, expired: true }, []));
    case "acknowledge": {
      const refusal = acknowledgeRefusal(state, event.via);
      if (refusal !== undefined || state.source.kind !== "rerun" || state.source.load.state !== "ready" || state.source.load.warning === undefined) return { refused: refusal ?? "not-here" };
      const warning = state.source.load.warning;
      return step({ ...cleared(state, ["shown"]), source: withWarning(state.source, warning, warning.rerun.warningDigest), stage: "Start" });
    }
    case "cancel-warning":
      return state.stage === "Warning" ? step({ ...state, stage: "Input" }) : { refused: "not-here" };
    case "start": {
      const current = currentShown(state, fingerprint);
      const refusal = startRefusal(state, event.gates, current);
      if (refusal !== undefined) return { refused: refusal };
      if (current === undefined) {
        if (event.gates.referencesUnavailable) return step({ ...state, problem: REFERENCES_UNAVAILABLE });
        const request = state.nextRequest;
        return step({ ...cleared(state, ["problem"]), nextRequest: request + 1, activity: { kind: "planning", request, for: fingerprint } },
          [{ kind: "request-plan", request, planRequest: event.planRequest() }]);
      }
      if (event.authority.state === "replaced") return step({ ...state, problem: catalogText("DASHBOARD_AUTHORITY_REPLACED") });
      const command = state.prepared?.target.startPlanId === current.plan.startPlanId ? state.prepared : event.prepare(current.plan);
      const expiryRequest = state.prepared === undefined && state.recovery.state === "none" ? current.request : undefined;
      const request = state.nextRequest;
      return step({ ...cleared(state, ["problem"]), nextRequest: request + 1, prepared: command,
        activity: { kind: "submitting", request, for: fingerprint, command, plannedCount: current.plan.planned.length, ...(expiryRequest === undefined ? {} : { expiryRequest }) } },
      [{ kind: "retain-and-submit", request, command, plan: current.plan }]);
    }
    case "replay": {
      const refusal = replayRefusal(state);
      if (refusal !== undefined || state.recovery.state !== "retained") return { refused: refusal ?? "not-here" };
      if (event.authority.state === "replaced") return step({ ...state, problem: catalogText("DASHBOARD_AUTHORITY_REPLACED") });
      const command = state.recovery.command;
      const request = state.nextRequest;
      const plannedCount = state.shown?.plan.planned.length;
      const plan = state.shown?.plan.startPlanId === command.target.startPlanId ? state.shown.plan : undefined;
      return step({ ...cleared(state, ["problem"]), nextRequest: request + 1,
        activity: { kind: "submitting", request, for: fingerprint, command, ...(plannedCount === undefined ? {} : { plannedCount }) } },
      [{ kind: "retain-and-submit", request, command, ...(plan === undefined ? {} : { plan }) }]);
    }
    case "retained": {
      const owner = findOwner(state, event.request, ["submitting"]);
      if (owner === undefined || owner.request.kind !== "submitting") return { refused: "superseded" };
      const command = owner.request.command;
      const answer = state.recovery.state === "retained" && state.recovery.command.commandId === command.commandId ? state.recovery.answer : undefined;
      return step({ ...state, prepared: command, recovery: { state: "retained", command, ...(answer === undefined ? {} : { answer }) } });
    }
    case "submit-threw":
      return settle(state, event.request, ["submitting"], fingerprint, released => step({ ...released, problem: event.message }));
    case "submit-settled":
      return submitSettled(state, event, fingerprint);
    case "binding-changed": {
      const reads = (entry: DetachedRequest) => entry.kind === "planning" || entry.kind === "checking-warnings";
      const moved = state.activity.kind !== "idle" && reads(state.activity) ? [state.activity] : [];
      return step({ ...state, activity: IDLE, detached: [...state.detached.filter(reads), ...moved] });
    }
  }
}

/** The state the dialog draws: a plan or an answer made for another fingerprint is dropped. */
export function visibleRunDialog(state: RunDialogState, fingerprint: string): RunDialogState {
  const staleShown = state.shown !== undefined && state.shown.for !== fingerprint;
  const staleAnswer = state.recovery.state === "retained" && state.recovery.answer !== undefined && state.recovery.answer.for !== fingerprint;
  if (!staleShown && !staleAnswer) return state;
  return { ...(staleShown ? cleared(state, ["shown"]) : state), recovery: staleAnswer ? withoutAnswer(state.recovery) : state.recovery };
}

export type RunDialogPrimaryInput = Readonly<{
  gates: LaunchGates; authority: AuthorityCheck; planRequest: () => StartPlanRequest;
  prepare: (plan: StartPlanResponse) => LaunchFinalCommand;
}>;
export type RunDialogControls = Readonly<{
  primary: Readonly<{ label: string; enabled: boolean; loading: boolean; event: (input: RunDialogPrimaryInput) => RunDialogEvent }>;
  back: RunStartStage | null;
  cancel: Extract<RunDialogEvent, { type: "cancel-warning" | "close" }>;
  /** The Enter key's event, or null when Enter does nothing. */
  enter: ((input: RunDialogPrimaryInput) => RunDialogEvent) | null;
  hint: "Enter to start" | "Enter to continue" | null;
}>;

/** The footer, once: the button, the hint and the Enter handler all read it. `view` comes from `visibleRunDialog`. */
export function runDialogControls(view: RunDialogState, gates: LaunchGates): RunDialogControls {
  const loading = view.activity.kind !== "idle";
  const back = previousStage(view, gates.path);
  if (view.stage === "Warning") {
    const button = (via: "button" | "enter") => () => ({ type: "acknowledge", via }) as const;
    return { primary: { label: "Confirm", enabled: acknowledgeRefusal(view, "button") === undefined && !loading && view.recovery.state === "none", loading, event: button("button") },
      back, cancel: { type: "cancel-warning" }, enter: acknowledgeRefusal(view, "enter") === undefined ? button("enter") : null,
      hint: acknowledgeRefusal(view, "enter") === undefined ? "Enter to continue" : null };
  }
  if (gates.next !== null) {
    const enabled = continueRefusal(view, gates) === undefined;
    const event = (input: RunDialogPrimaryInput) => ({ type: "continue", gates: input.gates }) as const;
    return { primary: { label: "Continue", enabled, loading, event }, back, cancel: { type: "close" },
      enter: enabled ? event : null, hint: enabled ? "Enter to continue" : null };
  }
  const plan = view.shown?.plan;
  const label = gates.dryRun === undefined ? "Start run" : (plan === undefined ? gates.dryRun : plan.dryRun) ? "Start dry run" : "Start live run";
  const enabled = startRefusal(view, gates, view.shown) === undefined;
  const event = (input: RunDialogPrimaryInput) => ({ type: "start", ...input }) as const;
  return { primary: { label, enabled, loading, event }, back, cancel: { type: "close" },
    enter: enabled ? event : null, hint: enabled ? "Enter to start" : null };
}

/** The dialog's side effects. Each async result becomes the settled event for the effect's request number. */
export type RunDialogEffects = Readonly<{
  loadSource: (source: RerunLaunchSource) => Promise<RerunValuesSnapshot>;
  /** Restores the draft from a matching snapshot; a throw settles the load as failed. */
  restoreSource: (snapshot: RerunValuesSnapshot) => void;
  requestPlan: (planRequest: StartPlanRequest) => Promise<StartPlanResponse>;
  checkWarnings: () => Promise<RerunWarningWire>;
  /** Retains the command (retainLaunchFinal) and reads its verification plan. */
  retain: (command: LaunchFinalCommand, plan: StartPlanResponse | undefined) => LaunchVerificationPlan | undefined;
  submit: (command: LaunchFinalCommand, verification: LaunchVerificationPlan | undefined) => Promise<CommandOutcome>;
  dismissRecovery: (command: LaunchFinalCommand) => void;
  feedback: (outcome: CommandOutcome) => void;
  applied: (workflowId: string, count?: number, workerStartup?: RunWorkerStartupFailure, runId?: string) => void;
  closeDialog: () => void;
  refusalToast: () => void;
  /** Runs after the clean plan has rendered, so the component sends `start` with fresh gates and authority. */
  autoStart: () => void;
}>;

const messageOf = (caught: unknown) => caught instanceof Error ? caught.message : String(caught);

export function useRunDialogMachine(input: Readonly<{ stage: RunStartStage; setStage: (stage: RunStartStage) => void; fingerprint: string; effects: RunDialogEffects }>):
  { readonly state: RunDialogState; readonly send: (event: RunDialogEvent) => RunDialogStep } {
  const [state, setState] = useState<RunDialogState>(() => ({ ...initialRunDialogState, stage: input.stage }));
  const live = useRef(state);
  const latest = useRef(input);
  const outcome = useRef<CommandOutcome | undefined>(undefined);
  const autoStart = useRef(false);
  latest.current = input;
  // The routed stage is the truth; adopt it when something outside the machine moved it.
  if (live.current.stage !== input.stage) live.current = { ...live.current, stage: input.stage };

  const send = useCallback((event: RunDialogEvent): RunDialogStep => {
    const result = runDialogTransition(live.current, event, latest.current.fingerprint);
    if ("refused" in result) return result;
    live.current = result.next;
    setState(result.next);
    if (result.next.stage !== latest.current.stage) latest.current.setStage(result.next.stage);
    const fx = latest.current.effects;
    for (const effect of result.effects) {
      switch (effect.kind) {
        case "load-source": {
          const { request } = effect;
          const source = live.current.source;
          if (source.kind !== "rerun") break;
          void fx.loadSource(source.request).then(snapshot => {
            const now = live.current.source;
            if (now.kind !== "rerun" || now.load.state !== "loading" || now.load.request !== request) return;
            if (snapshot.source.runId === now.request.runId && snapshot.source.version === now.request.expectedVersion) {
              try { latest.current.effects.restoreSource(snapshot); } catch (caught) { send({ type: "source-failed", request, message: messageOf(caught) }); return; }
            }
            send({ type: "source-loaded", request, snapshot });
          }, (caught: unknown) => send({ type: "source-failed", request, message: messageOf(caught) }));
          break;
        }
        case "request-plan": {
          const { request, planRequest } = effect;
          void fx.requestPlan(planRequest).then(plan => send({ type: "plan-settled", request, plan, planRequest }),
            (caught: unknown) => send({ type: "plan-failed", request, message: messageOf(caught) }));
          break;
        }
        case "check-warnings": {
          const { request } = effect;
          void fx.checkWarnings().then(warning => send({ type: "warnings-settled", request, warning }),
            (caught: unknown) => send({ type: "warnings-failed", request, message: messageOf(caught) }));
          break;
        }
        case "retain-and-submit": {
          const { request, command } = effect;
          const threw = () => send({ type: "submit-threw", request, message: catalogText("COMMAND_DISPATCH_FAILED") });
          let verification: LaunchVerificationPlan | undefined;
          try { verification = fx.retain(command, effect.plan); } catch { threw(); break; }
          send({ type: "retained", request });
          void fx.submit(command, verification).then(settled => {
            const reply = settled.reply !== undefined && "state" in settled.reply && "commandId" in settled.reply ? settled.reply : undefined;
            outcome.current = settled;
            try { send({ type: "submit-settled", request, view: commandAttemptView(settled), ...(reply === undefined ? {} : { reply }) }); }
            finally { outcome.current = undefined; }
          }).catch(threw);
          break;
        }
        case "dismiss-recovery": fx.dismissRecovery(effect.command); break;
        case "feedback": if (outcome.current !== undefined) fx.feedback(outcome.current); break;
        case "applied": fx.applied(effect.workflowId, effect.count, effect.workerStartup, effect.runId); break;
        case "close-dialog": fx.closeDialog(); break;
        case "refusal-toast": fx.refusalToast(); break;
        case "auto-start": autoStart.current = true; break;
      }
    }
    return result;
  }, []);

  useEffect(() => {
    if (!autoStart.current) return;
    autoStart.current = false;
    latest.current.effects.autoStart();
  });

  return { state: live.current === state ? state : live.current, send };
}
