import { useOperationSourceNavigation } from "./operation-source-navigation-model.js";
import { OperationDefinitionSource, OperationFieldTemplate } from "./operation-definition.js";
import { SYSTEM_HOST_PRESENTATION } from "./settings-hosts-model.js";
import { OperationCapture } from "./run-captures.js";
import { exactOperationCaptures, type RunCaptureItem } from "./run-captures-model.js";
import { fmtActionClock } from "./format.js";
import { useEffect, useRef, useState } from "react";
import { ChevronRight, Eye, MousePointer2, PencilLine, Monitor, Link2, PanelsTopLeft, Cpu, GitBranch, CircleStop, CheckCheck, LockKeyhole } from "lucide-react";
import type { SessionNeed } from "../../models/sessions/session.js";
import type { WorkflowOperationDisplaySnapshot } from "../../models/workflow/operation-display-snapshot.js";
import type { OperationActionObservationWire, ObservedOperationStructureWire } from "../../models/dashboard/operation-structure.js";
import type { DeclaredActionIdentity } from "../../rules/workflow/task-provenance.js";
import { Button, Collapsible, CollapsibleContent, CollapsibleTrigger, Dialog, DialogContent, DialogBody, Select, dsText, dsIcon } from "../ds/ui.js";
import { useDashboardClient } from "../state/client-context.js";
import { cn } from "../lib/utils.js";
import { definitionMutedPresentation, presentationAddress, definitionMutedActions, definitionActionAddress, flattenPresentation, flattenActions, operationAction, operationAddress, operationSourceIdentities, operationSourceLabel, operationStepLabel, operationValueText, operationObservationParent, observedOperationOutcome, type OperationAction, type OperationInvocation, type OperationValue } from "./operation-structure-model.js";
import "./operation-structure.css";

function ValueSource({ value, ownerRunId }: { value: OperationValue; ownerRunId: string }) {
  const client = useDashboardClient();
  const navigation = useOperationSourceNavigation();
  const jumping = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<DeclaredActionIdentity>();
  const [result, setResult] = useState<ObservedOperationStructureWire>();
  const [error, setError] = useState<string>();
  const identities = operationSourceIdentities(value.producer);
  useEffect(() => {
    if (!open || selected === undefined) return;
    const controller = new AbortController();
    setResult(undefined);
    setError(undefined);
    void (async () => {
      let cursor: string | undefined;
      const seen = new Set<string>();
      for (let page = 0; page < 128; page += 1) {
        const response = await client.operationSource(ownerRunId, { identity: selected, ...(cursor === undefined ? {} : { cursor }) }, controller.signal);
        if (controller.signal.aborted) return;
        if (response.state === "found") { setResult(response.structure); return; }
        if (response.state === "unavailable") { setError("Exact source occurrence is no longer retained."); return; }
        if (seen.has(response.cursor)) throw new Error("operation-source-cursor-repeated");
        seen.add(response.cursor);
        cursor = response.cursor;
      }
      throw new Error("operation-source-client-page-bound-exceeded");
    })().catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Source request failed");
    });
    return () => controller.abort();
  }, [client, open, selected, ownerRunId]);
  return <>
    <div className="operation-source-well">
      <Button ref={trigger} size="sm" variant="ghost" onClick={() => { setResult(undefined); setError(undefined); setSelected(identities[0]); setOpen(true); }}><Link2 aria-hidden className={dsIcon.sm} />{operationSourceLabel(value.producer)}</Button>
    </div>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent title="Value source" description="Exact retained producer and its inputs." size="lg" onCloseAutoFocus={(event) => { event.preventDefault(); if (!jumping.current) trigger.current?.focus(); jumping.current = false; }}>
        <DialogBody>
          <p className={dsText.body}>{operationSourceLabel(value.producer)}</p>
          {value.producer.kind === "child-output" && value.producer.result !== undefined && <p className={dsText.meta}>Immediate child result · {value.producer.result.runId}</p>}
          {identities.length === 0 && <p className={dsText.body}>{value.producer.kind === "run-input" || value.producer.kind === "configuration" || value.producer.kind === "constant" ? "Definition source; no browser field occurrence." : "Exact input occurrence is not retained."}</p>}
          {identities.length > 1 && <div className="operation-controls">{identities.map((identity, index) => <Button key={operationAddress(identity)} size="sm" variant="ghost" onClick={() => { setResult(undefined); setError(undefined); setSelected(identity); }}>Input {index + 1}</Button>)}</div>}
          {selected !== undefined && result === undefined && error === undefined && <p role="status">Loading exact source…</p>}
          {error !== undefined && <p role="alert">{error}</p>}
          {result !== undefined && <p className={dsText.meta}>Source run · {result.runId}{result.runId !== ownerRunId ? " · child evidence" : result.observations.some((item) => navigation?.contains(item.occurrence)) ? "" : " · retained source context"}</p>}
          {selected !== undefined && navigation?.contains(selected) && <Button size="toolbar" variant="secondary" onClick={() => { if (trigger.current === null) return; jumping.current = true; setOpen(false); navigation.jump(selected, trigger.current); }}>Go to field in logs</Button>}
          {selected !== undefined && result !== undefined && !navigation?.contains(selected) && <Button size="toolbar" variant="secondary" onClick={() => { const field = document.getElementById(`operation-${operationAddress(selected)}`); field?.scrollIntoView({ block: "center" }); field?.focus(); }}>Go to field in source</Button>}
          {result !== undefined && !result.observations.some((item) => navigation?.contains(item.occurrence)) && result.observations.map((observation) => <OperationObservedAction key={observation.logId} definition={result.definition} observation={observation} highlight ownerRunId={ownerRunId} />)}
          <Button size="toolbar" variant="secondary" onClick={() => setOpen(false)}>Return to value</Button>
        </DialogBody>
      </DialogContent>
    </Dialog>
  </>;
}

function ObservedValue({ value }: { value: OperationValue }) {
  const text = operationValueText(value);
  const identifier = /^#?[A-Za-z][A-Za-z0-9]*-[A-Za-z0-9-]+$/u;
  return <div className="operation-value-text">{text.split(/(#?[A-Za-z][A-Za-z0-9]*-[A-Za-z0-9-]+)/gu).map((part, index) => identifier.test(part) && part.length <= 80 ? <span key={index} className="operation-value-identifier">{part}</span> : part)}</div>;
}

function ActionRow({ action, invocation, observation, highlight, ownerRunId, definition, onDefinitionJump }: { action: OperationAction; invocation: OperationInvocation; observation?: OperationActionObservationWire; highlight?: boolean; ownerRunId?: string; definition?: WorkflowOperationDisplaySnapshot; onDefinitionJump?: (invocationId: string, actionId: string, trigger: HTMLButtonElement) => void }) {
  const read = action.kind === "read-field";
  const fill = action.kind === "fill-field" || action.kind === "select-field" || action.kind === "check-field";
  const Icon = read ? Eye : fill ? PencilLine : action.kind === "compute" ? Cpu : action.kind === "verify" ? CheckCheck : MousePointer2;
  const slot = invocation.operation.values.find((value) => value.id === action.valueSlot);
  const value = observation?.occurrence.value;
  const state = observation?.occurrence.state;
  return <div className={cn("operation-action", observation !== undefined && "operation-observed-row", fill && "operation-fill-row", dsText.body)} data-operation-highlight={highlight || undefined} id={observation === undefined ? definitionActionAddress(invocation.id, action.id) : `operation-${operationAddress(observation.occurrence)}`} tabIndex={-1}>
    {observation !== undefined && <time className="operation-row-time" title={`${observation.occurrence.confirmation?.verifiedAt ?? observation.at} · attempt ${observation.occurrence.attempt}/${observation.occurrence.taskAttempt}`}>{fmtActionClock(observation.occurrence.confirmation?.verifiedAt ?? observation.at)}</time>}
    <Icon aria-hidden className={dsIcon.sm} /><span className="operation-row-label">{action.label ?? action.target ?? slot?.source.path ?? action.kind.replaceAll("-", " ")}</span>
    <div className="operation-row-value">
      {value !== undefined ? <><ObservedValue value={value} />{(fill || operationSourceIdentities(value.producer).length > 0) && ownerRunId !== undefined && <ValueSource value={value} ownerRunId={ownerRunId} />}</> : slot !== undefined && fill ? <span>{slot.source.kind === "contract-input" ? "Input" : "Output"} · {slot.source.path}</span> : null}
      {fill && definition !== undefined && onDefinitionJump !== undefined && <OperationDefinitionSource definition={definition} invocation={invocation} action={action} onJump={onDefinitionJump} />}
      {action.templateId !== undefined && <OperationFieldTemplate invocation={invocation} action={action} observed={observation !== undefined} />}
      {state !== undefined && state !== "confirmed" && <span className="operation-lifecycle">{state === "completed" ? "Gesture completed · effect unconfirmed" : state === "failed" ? <><CircleStop aria-hidden className={dsIcon.sm} />Failed</> : state === "not-run" ? `Not run · ${observation?.occurrence.reason ?? "unavailable"}` : "Started"}</span>}
    </div>
  </div>;
}

type DefinitionTreeProps = { invocation: OperationInvocation; definition: WorkflowOperationDisplaySnapshot; collapsed: boolean; selected: Readonly<Record<string, string>>; onSelect: (address: string, value: string) => void; muted: ReadonlySet<string>; jumpId?: string; onJump: (invocationId: string, actionId: string, trigger: HTMLButtonElement) => void };

function DeclaredOutcome({ action, invocationId, selected = "", onSelect, onJump }: { action: OperationAction; invocationId: string; selected?: string; onSelect: (address: string, value: string) => void; onJump: DefinitionTreeProps["onJump"] }) {
  const outcome = action.outcomes?.find((item) => item.id === selected);
  return <div className="operation-read-footer"><GitBranch aria-hidden className={dsIcon.sm} /><span>Read result</span>
    <Select aria-label={`${action.label ?? action.id} declared result`} value={selected} onChange={(event) => onSelect(definitionActionAddress(invocationId, action.id), event.target.value)}><option value="">Choose declared result</option>{action.outcomes?.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}<option value="unknown">Unknown · stop</option></Select>
    {outcome?.continuation !== undefined && <Button size="sm" variant="ghost" onClick={(event) => onJump(invocationId, outcome.continuation!, event.currentTarget)}>Continue at {outcome.continuation}</Button>}
    {selected === "unknown" && <span role="status" className={dsText.meta}>Preview stops here</span>}
  </div>;
}

function ActionTree({ actions, ...props }: DefinitionTreeProps & { actions: readonly OperationAction[] }) {
  const [verificationOpen, setVerificationOpen] = useState(false);
  const verification = actions.filter((action) => action.kind === "verify");
  useEffect(() => { if (props.jumpId !== undefined && flattenActions(verification).some((action) => definitionActionAddress(props.invocation.id, action.id) === props.jumpId)) setVerificationOpen(true); }, [props.jumpId, props.invocation.id, verification]);
  return <div className="operation-actions">{actions.filter((action) => action.kind !== "verify").map((action) => action.children === undefined ? <div key={action.id} data-operation-muted={props.muted.has(action.id) || undefined}>
    <ActionRow action={action} invocation={props.invocation} definition={props.definition} onDefinitionJump={props.onJump} highlight={props.jumpId === definitionActionAddress(props.invocation.id, action.id)} />
    {action.kind === "branch" && <DeclaredOutcome action={action} invocationId={props.invocation.id} selected={props.selected[definitionActionAddress(props.invocation.id, action.id)]} onSelect={props.onSelect} onJump={props.onJump} />}
    {action.kind === "resume-page" && action.continuedFrom !== undefined && <Button size="sm" variant="ghost" onClick={(event) => props.onJump(props.invocation.id, action.continuedFrom!, event.currentTarget)}>Initial visit</Button>}
  </div> : <OperationForm key={action.id} action={action} {...props} />)}
    {verification.length > 0 && <Collapsible open={verificationOpen} onOpenChange={setVerificationOpen} className="operation-diagnostic"><CollapsibleTrigger className={dsText.meta}>Verification details</CollapsibleTrigger><CollapsibleContent>{verification.map((action) => <div key={action.id}><ActionRow action={action} invocation={props.invocation} /><ActionTree actions={action.children ?? []} {...props} /></div>)}</CollapsibleContent></Collapsible>}
  </div>;
}

function OperationForm({ action, ...props }: DefinitionTreeProps & { action: OperationAction }) {
  const [open, setOpen] = useState(true);
  useEffect(() => setOpen(!props.collapsed), [props.collapsed]);
  useEffect(() => { if (props.jumpId !== undefined && flattenActions([action]).some((item) => definitionActionAddress(props.invocation.id, item.id) === props.jumpId)) setOpen(true); }, [props.jumpId, props.invocation.id, action]);
  return <Collapsible open={open} onOpenChange={setOpen} className="operation-form" data-operation-muted={props.muted.has(action.id) || undefined} id={definitionActionAddress(props.invocation.id, action.id)} tabIndex={-1}>
    <CollapsibleTrigger className={cn("operation-form-header", dsText.ui)}><ChevronRight aria-hidden className={cn(dsIcon.sm, open && "rotate-90")} /><PanelsTopLeft aria-hidden className={dsIcon.sm} /><strong>{action.label ?? action.page?.form ?? action.page?.screen ?? "Page"}</strong></CollapsibleTrigger>
    <CollapsibleContent><div className="operation-form-body"><ActionTree actions={action.children ?? []} {...props} /></div></CollapsibleContent>
    {action.outcomes !== undefined && action.outcomes.length > 0 && <DeclaredOutcome action={action} invocationId={props.invocation.id} selected={props.selected[definitionActionAddress(props.invocation.id, action.id)]} onSelect={props.onSelect} onJump={props.onJump} />}
  </Collapsible>;
}

export function OperationObservedAction({ definition, observation, highlight, ownerRunId }: { definition: WorkflowOperationDisplaySnapshot; observation: OperationActionObservationWire; highlight?: boolean; ownerRunId: string }) {
  const { action, invocation } = operationAction(definition, observation);
  return <ActionRow action={action} invocation={invocation} observation={observation} highlight={highlight} ownerRunId={ownerRunId} />;
}

export function OperationObservedGroup({ definition, observations, ownerRunId, captures = [], hit = false, dim = false }: { definition: WorkflowOperationDisplaySnapshot; observations: readonly OperationActionObservationWire[]; ownerRunId: string; captures?: readonly RunCaptureItem[]; hit?: boolean; dim?: boolean }) {
  const navigation = useOperationSourceNavigation();
  const [diagnosticOpen, setDiagnosticOpen] = useState(false);
  useEffect(() => { if (navigation?.address !== undefined && observations.some((item) => operationAddress(item.occurrence) === navigation.address)) setDiagnosticOpen(true); }, [navigation?.address, observations]);
  const first = observations[0];
  if (first === undefined) return null;
  const parent = operationObservationParent(definition, first);
  const { invocation } = operationAction(definition, first);
  const step = flattenPresentation(definition.presentation).find((node) => node.kind === "operation" && node.invocationId === invocation.id);
  const outcome = parent === undefined ? undefined : observedOperationOutcome(parent, observations);
  const title = parent?.label ?? parent?.page?.form ?? parent?.page?.screen;
  const primary = observations.filter((observation) => observation.occurrence.state === "confirmed" || observation.occurrence.state === "failed" || observation.occurrence.state === "not-run");
  const diagnostic = observations.filter((observation) => !primary.includes(observation));
  const computed = primary.length > 0 && primary.every((observation) => operationAction(definition, observation).action.kind === "compute");
  return <section className={cn("operation-observed-group", dim && "opacity-40")} data-search-hit={hit || undefined}>
    {primary.length > 0 && <div className="operation-heading"><h3 className={cn(dsText.ui, "font-semibold")}>{step === undefined ? invocation.label ?? invocation.operation.id : operationStepLabel(step, definition)}</h3>{!(computed && invocation.operation.system === "local") && <span className="operation-session"><Monitor aria-hidden className={dsIcon.sm} />{invocation.operation.system === "local" ? "Local" : SYSTEM_HOST_PRESENTATION[invocation.operation.system].name}</span>}</div>}
    {primary.length > 0 && <div className={cn("operation-observed-body", (parent !== undefined || computed) && "operation-form")}>
      {title !== undefined && !computed && <div className={cn("operation-form-header", dsText.ui)}><PanelsTopLeft aria-hidden className={dsIcon.sm} /><strong>{title}</strong></div>}
      <div className="operation-form-body">{primary.map((observation) => <div className="operation-observed-action" key={observation.logId}><OperationObservedAction definition={definition} observation={observation} ownerRunId={ownerRunId} highlight={navigation?.address === operationAddress(observation.occurrence)} />{exactOperationCaptures(captures, observation.occurrence).map(({ item, capturedAt }) => <OperationCapture key={item.capture.artifact.artifactId} item={item} capturedAt={capturedAt} />)}</div>)}</div>
      {outcome !== undefined && !computed && <div className={cn("operation-read-footer", dsText.meta)}><GitBranch aria-hidden className={dsIcon.sm} /><span>Read result</span><strong>{outcome.state === "selected" ? outcome.label : outcome.reason}</strong></div>}
    </div>}
    {diagnostic.length > 0 && <Collapsible className="operation-diagnostic" open={diagnosticOpen} onOpenChange={setDiagnosticOpen}><CollapsibleTrigger className={dsText.meta}>Driver evidence · {diagnostic.length} events</CollapsibleTrigger><CollapsibleContent>{diagnostic.map((observation) => <OperationObservedAction key={observation.logId} definition={definition} observation={observation} ownerRunId={ownerRunId} highlight={navigation?.address === operationAddress(observation.occurrence)} />)}</CollapsibleContent></Collapsible>}
  </section>;
}

export function OperationTimeline({ definition, labels = {}, sessionNeeds }: { definition: WorkflowOperationDisplaySnapshot; labels?: Readonly<Record<string, string>>; sessionNeeds?: readonly SessionNeed[] }) {
  const [collapsed, setCollapsed] = useState(false);
  const [selected, setSelected] = useState<Readonly<Record<string, string>>>({});
  const [jump, setJump] = useState<{ id: string; trigger: HTMLButtonElement }>();
  const returnToValue = () => { jump?.trigger.focus(); jump?.trigger.scrollIntoView({ block: "center" }); setJump(undefined); };
  useEffect(() => {
    if (jump === undefined) return;
    let second: number | undefined;
    const frame = requestAnimationFrame(() => { second = requestAnimationFrame(() => { const target = document.getElementById(jump.id); target?.scrollIntoView({ block: "center" }); target?.focus(); }); });
    return () => { cancelAnimationFrame(frame); if (second !== undefined) cancelAnimationFrame(second); };
  }, [jump]);
  const onJump = (invocationId: string, actionId: string, trigger: HTMLButtonElement) => { setCollapsed(false); setJump({ id: definitionActionAddress(invocationId, actionId), trigger }); };
  const nodes = flattenPresentation(definition.presentation);
  const mutedNodes = definitionMutedPresentation(definition, selected);
  let number = 0;
  const sessions = [...new Map(definition.invocations.filter((invocation) => invocation.operation.session.kind === "browser").map((invocation) => [invocation.operation.session.id, invocation.operation.session])).values()];
  return <div className="operation-timeline" onKeyDown={(event) => { if (event.key === "Escape" && jump !== undefined) { event.stopPropagation(); returnToValue(); } }}>
    <div className="operation-controls">{jump !== undefined && <Button size="toolbar" variant="secondary" onClick={returnToValue}>Return to value</Button>}<Button size="toolbar" variant="ghost" onClick={() => setCollapsed((value) => !value)}>{collapsed ? "Expand all" : "Collapse all"}</Button></div>
    {sessions.length > 0 && <section className="operation-step" aria-label="Declared sessions"><span className="operation-number">{++number}</span><div><div className="operation-heading"><h3 className={cn(dsText.title, "font-semibold")}>Establish sessions</h3></div><div className="operation-session-chips">{sessions.map((session) => {
      if (session.kind !== "browser") return null;
      if (session.system === undefined) throw new Error("operation-render-session-system-missing");
      const policies = [...new Set(sessionNeeds?.filter((need) => need.system === session.system).map((need) => need.session === "fresh" ? "Fresh session" : "Reuse worker session"))];
      return <span key={session.id} className="operation-session-start"><Monitor aria-hidden className={dsIcon.sm} />{SYSTEM_HOST_PRESENTATION[session.system].name}<LockKeyhole aria-hidden className={dsIcon.sm} /><span className={dsText.meta}>{policies.length > 0 ? policies.join(" · ") : "Startup policy unavailable"} · declared</span></span>;
    })}</div></div></section>}
    {nodes.map((step) => {
      const invocation = step.kind === "operation" ? definition.invocations.find((candidate) => candidate.id === step.invocationId) : undefined;
      if (step.kind === "session-lifecycle") return <div key={step.id} className="operation-session-start"><Monitor aria-hidden className={dsIcon.sm} />{step.id}</div>;
      const outcomes = step.outcomes ?? invocation?.outcomes;
      const selectedOutcome = outcomes?.find((item) => item.id === selected[presentationAddress(step.id)]);
      return <section key={step.id} className="operation-step" id={presentationAddress(step.id)} tabIndex={-1} data-operation-muted={mutedNodes.has(step.id) || undefined} aria-label={operationStepLabel(step, definition)}>
        <span className="operation-number">{++number}</span><div>
          <div className="operation-heading"><h3 className={cn(dsText.title, "font-semibold")}>{(invocation === undefined ? step.entryId === undefined ? undefined : labels[step.entryId] : labels[invocation.entryId]) ?? operationStepLabel(step, definition)}</h3>{invocation !== undefined && invocation.operation.system !== "local" && <span className="operation-session"><Monitor aria-hidden className={dsIcon.sm} />{SYSTEM_HOST_PRESENTATION[invocation.operation.system].name}</span>}</div>
          {invocation !== undefined && <div className={invocation.operation.system === "local" && invocation.operation.actions.some((action) => action.kind === "compute") ? "operation-form operation-form-body operation-computation" : undefined}><ActionTree actions={invocation.operation.actions} invocation={invocation} definition={definition} collapsed={collapsed} selected={selected} onSelect={(address, value) => setSelected((current) => ({ ...current, [address]: value }))} muted={definitionMutedActions(invocation, selected)} jumpId={jump?.id} onJump={onJump} /></div>}
          {step.kind === "delegate" && <div className="operation-definition-source"><Link2 aria-hidden className={dsIcon.sm} /><span>{step.targetWorkflowId} · {step.entryId}</span></div>}
          {step.kind === "compute" && <div className="operation-form operation-form-body operation-computation">{definition.transforms.find((item) => item.id === step.transform)?.inputs.map((input) => <div key={input.id} className="operation-action"><Cpu aria-hidden className={dsIcon.sm} /><span>{input.id}</span><span className="operation-row-value">{input.value.kind}</span></div>)}</div>}
          {outcomes !== undefined && outcomes.length > 0 && <div className="operation-read-footer"><GitBranch aria-hidden className={dsIcon.sm} /><Select aria-label={`${step.id} declared path`} value={selected[presentationAddress(step.id)] ?? ""} onChange={(event) => setSelected((current) => ({ ...current, [presentationAddress(step.id)]: event.target.value }))}><option value="">Choose declared path</option>{outcomes.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}<option value="unknown">Unknown · stop</option></Select>{selectedOutcome?.continuation !== undefined && <Button size="sm" variant="ghost" onClick={(event) => { setCollapsed(false); setJump({ id: presentationAddress(selectedOutcome.continuation!), trigger: event.currentTarget }); }}>Continue at {selectedOutcome.continuation}</Button>}{selected[presentationAddress(step.id)] === "unknown" && <span role="status">Preview stops here</span>}</div>}
        </div>
      </section>;
    })}
  </div>;
}
