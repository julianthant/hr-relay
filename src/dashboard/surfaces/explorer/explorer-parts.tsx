import { ArrowUpRight, CheckCheck, ChevronDown, CircleStop, CornerDownRight, Cpu, Eye, GitBranch, GitMerge, Keyboard, LockKeyhole, Monitor, MousePointer2, PanelsTopLeft, PencilLine, UserRound } from "lucide-react";
import { Select, dsFocus } from "../../ds/ui.js";
import { ExplorerComment } from "./explorer-comment.js";
import type { CommentChoices, FlowField, FlowPart, FlowStep, PreviewScenario } from "./explorer-flow-model.js";

interface PartProps {
  parts: readonly FlowPart[]; step: FlowStep; scenario: PreviewScenario; onScenario: (scenario: PreviewScenario) => void;
  open: Readonly<Record<string, boolean>>; onToggle: (id: string, open: boolean) => void;
  onSource: (field: FlowField, step: FlowStep, trigger: HTMLButtonElement, formTitle?: string) => void;
  formTitle?: string;
  onStep: (step: number) => void; selected?: string; disabled: boolean;
  comments: CommentChoices; onComments: (choices: CommentChoices) => void;
  onMockChoice?: (id: string, value: string) => void;
}

function BranchChoice({ choice, scenario, onScenario, disabled, result = false }: Pick<PartProps, "scenario" | "onScenario" | "disabled"> & { choice: keyof PreviewScenario; result?: boolean }) {
  const choices = choice === "identity" ? [["verified", "Verified from supplied ID"], ["review", "Operator review required"], ["rejected", "Operator rejects"]]
    : choice === "pending" ? [["none", "No pending terminations"], ["some", "Pending termination found"], ["unknown", "Could not verify"]]
      : [["absent", "No matching termination"], ["present", "Matching termination exists"], ["unknown", "Could not verify"]];
  const label = choice === "identity" ? "Identity check" : choice === "pending" ? "Read result" : "Existing termination";
  const Icon = choice === "identity" ? UserRound : GitBranch;
  return <div className={`flex items-center gap-2.5 ${result ? "border-t border-ui-stroke px-4 py-3" : "mb-3 rounded-lg border border-ui-stroke bg-ui-table px-4 py-3"}`}>
    <Icon aria-hidden className="size-4 shrink-0 text-ui-info" /><label className="text-body font-medium" htmlFor={`preview-${choice}`}>{label}</label>
    <Select id={`preview-${choice}`} aria-label={`${label} preview`} value={scenario[choice]} disabled={disabled} onChange={(event) => onScenario({ ...scenario, [choice]: event.target.value })}
      className={`ml-auto h-8 max-w-[60%] rounded-md border border-ui-stroke-control bg-ui-field px-2 text-body text-ui-primary disabled:cursor-not-allowed ${dsFocus}`}>
      {choices.map(([value, title]) => <option key={value} value={value}>{title}</option>)}
    </Select>
  </div>;
}

export function ExplorerParts(props: PartProps) {
  const { parts, step, open, onToggle, onSource, onStep, selected, comments, onComments } = props;
  return <>{parts.map((part, index) => {
    const key = `${step.number}-${index}`;
    if (part.kind === "form") {
      const id = `${step.number}-${part.id}`;
      return <section key={key} className="my-3 overflow-hidden rounded-lg border border-ui-stroke bg-ui-table">
        <details className="group" data-disclosure={id} open={open[id] ?? true} onToggle={(event) => onToggle(id, event.currentTarget.open)}>
          <summary className={`group flex min-h-11 cursor-pointer list-none items-center gap-2.5 px-4 py-2.5 text-control [&::-webkit-details-marker]:hidden ${dsFocus}`}>
            <PanelsTopLeft aria-hidden className="size-4 shrink-0 text-ui-muted" /><strong className="font-semibold">{part.title}</strong>
            <span className="ml-auto text-caption text-ui-muted">{part.mode}</span><ChevronDown aria-hidden className="ml-2 size-3.5 shrink-0 text-ui-muted group-open:rotate-180" />
          </summary>
          <div className="border-t border-ui-stroke"><ExplorerParts {...props} parts={part.parts} formTitle={part.title} /></div>
        </details>
        {part.result && <BranchChoice choice={part.result} {...props} result />}
      </section>;
    }
    if (part.kind === "detail") {
      const id = `${step.number}-${part.id}`;
      return <details key={key} data-disclosure={id} open={open[id] ?? false} onToggle={(event) => onToggle(id, event.currentTarget.open)} className="group border-t border-ui-stroke">
        <summary className={`group flex cursor-pointer list-none items-center px-4 py-2 text-caption text-ui-secondary [&::-webkit-details-marker]:hidden ${dsFocus}`}>{part.title}<ChevronDown aria-hidden className="ml-auto size-3.5 group-open:rotate-180" /></summary>
        <ExplorerParts {...props} parts={part.parts} />
      </details>;
    }
    if (part.kind === "rows") return <div key={key} className="px-4 py-1.5">{part.fields.map((field) => {
      const id = `explorer-field-${step.number}-${field.id}`;
      const templateId = `${step.number}-${field.id}-template`;
      const Icon = field.mode === "fill" ? PencilLine : field.mode === "compute" ? Cpu : Eye;
      const style = `grid w-full grid-cols-[1rem_minmax(9rem,1fr)_minmax(11rem,1fr)] items-start gap-2.5 ${field.mode === "fill" ? "py-1.5" : "py-2"} text-left text-body ${selected === id ? "rounded-md ring-2 ring-ui-info" : ""}`;
      const body = <><Icon aria-hidden className={`mt-0.5 size-3.5 shrink-0 ${field.mode === "fill" ? "text-ui-info" : "text-ui-muted"}`} /><span className="self-center text-ui-primary">{field.label}</span>
        <span className={field.mode === "fill" ? "flex min-h-7 min-w-0 items-center justify-between gap-2 self-center rounded-md border border-ui-stroke-control bg-ui-field px-2.5 py-1 text-ui-info" : "self-center text-right text-ui-secondary"}>
          {field.value}{field.mode === "fill" && <ArrowUpRight aria-hidden className="size-3.5 shrink-0" />}
        </span></>;
      return <div key={field.id} className="border-b border-ui-stroke last:border-b-0">
        {field.mode === "fill" ? <button id={id} type="button" disabled={props.disabled} aria-label={`Show source for ${field.label}`} className={`${style} hover:bg-ui-hover disabled:cursor-not-allowed ${dsFocus}`} onClick={(event) => onSource(field, step, event.currentTarget, props.formTitle)}>{body}</button> : <div id={id} tabIndex={-1} className={style}>{body}</div>}
        {field.template && <ExplorerComment id={templateId} kind={field.template} choices={comments} onChange={onComments} open={open[templateId] ?? field.template !== "duplicate"} onToggle={(value) => onToggle(templateId, value)} rulesOpen={open[`${templateId}-rules`] ?? false} onRulesToggle={(value) => onToggle(`${templateId}-rules`, value)} />}
      </div>;
    })}</div>;
    if (part.kind === "choice") return <BranchChoice key={key} choice={part.choice} {...props} />;
    if (part.kind === "mock-choice") return <div key={key} className="mb-3 flex items-center gap-2.5 rounded-lg border border-ui-stroke bg-ui-table px-4 py-3">
      <GitBranch aria-hidden className="size-4 shrink-0 text-ui-info" /><label className="text-body font-medium" htmlFor={`preview-${part.id}`}>{part.label}</label>
      <Select id={`preview-${part.id}`} aria-label={`${part.label} preview`} value={part.value} disabled={props.disabled} onChange={(event) => props.onMockChoice?.(part.id, event.target.value)}
        className={`ml-auto h-8 max-w-[60%] rounded-md border border-ui-stroke-control bg-ui-field px-2 text-body text-ui-primary disabled:cursor-not-allowed ${dsFocus}`}>
        {part.options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </Select>
    </div>;
    if (part.kind === "note") return <p key={key} className="my-2 max-w-prose text-body text-ui-secondary">{part.text}</p>;
    if (part.kind === "resume") return <button key={key} type="button" className={`flex items-center gap-2 px-4 pt-3 text-caption text-ui-info hover:underline ${dsFocus}`} onClick={() => onStep(part.step)}><CornerDownRight aria-hidden className="size-3.5" />{part.text}</button>;
    if (part.kind === "sessions") return <div key={key} className="flex flex-wrap gap-2 pt-1">{(part.systems ?? ["Kuali", "Kronos", "UCPath"]).map((system) => <span key={system} className="flex h-9 items-center gap-2 rounded-md border border-ui-stroke bg-ui-table px-3 text-body" title={`Declared session: open ${system} and authenticate`}><Monitor aria-hidden className="size-4 text-ui-muted" />{system}<LockKeyhole aria-hidden className="ml-2 size-3 text-ui-muted" /></span>)}</div>;
    const Icon = { click: MousePointer2, read: Eye, verify: CheckCheck, compute: Cpu, key: Keyboard, rejoin: GitMerge, stop: CircleStop }[part.icon];
    return <div key={key} className={`my-2.5 flex min-h-9 items-center gap-2.5 text-body ${part.icon === "stop" ? "text-ui-danger" : "text-ui-secondary"} ${part.icon === "stop" ? "rounded-md border border-ui-stroke bg-ui-table p-3" : part.icon === "click" ? "ml-3 w-fit rounded-md border border-ui-stroke bg-ui-table px-2.5 py-1.5 text-ui-primary" : part.icon === "rejoin" ? "mt-3.5 border-t border-ui-stroke pt-3" : "px-2"}`}>
      <Icon aria-hidden className={`size-3.5 shrink-0 ${part.icon === "verify" ? "text-ui-positive" : part.icon === "rejoin" ? "text-ui-info" : ""}`} /><span>{part.text}</span>
    </div>;
  })}</>;
}
