import { ChevronDown, FileText } from "lucide-react";
import { dsFocus } from "../../ds/ui.js";
import { commentTemplate, LEAVE_CONDITIONS, LEAVE_OPTIONS, type CommentChoices } from "./explorer-flow-model.js";

function Choice({ label, value, options, onChange }: { label: string; value: string; options: readonly (readonly [string, string])[]; onChange: (value: string) => void }) {
  return <label className="flex min-w-0 flex-col gap-1 text-caption text-ui-secondary">
    {label}<select className={`h-8 min-w-0 rounded-md border border-ui-stroke-control bg-ui-field px-2 text-body text-ui-primary ${dsFocus}`} value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map(([id, text]) => <option key={id} value={id}>{text}</option>)}
    </select>
  </label>;
}

export function ExplorerComment({ kind, choices, onChange, open, onToggle, id, rulesOpen, onRulesToggle }: {
  kind: "ucpath" | "kuali" | "duplicate"; choices: CommentChoices; onChange: (choices: CommentChoices) => void;
  open: boolean; onToggle: (open: boolean) => void; id: string;
  rulesOpen: boolean; onRulesToggle: (open: boolean) => void;
}) {
  const templateKind = kind === "kuali" ? "kuali" : "ucpath";
  const text = commentTemplate(templateKind, choices);
  return <details data-disclosure={id} open={open} onToggle={(event) => onToggle(event.currentTarget.open)} className="group mx-6 mb-3 rounded-md border border-ui-stroke bg-ui-panel">
    <summary className={`group flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-body text-ui-secondary [&::-webkit-details-marker]:hidden ${dsFocus}`}>
      <FileText aria-hidden className="size-3.5 shrink-0" />
      {kind === "duplicate" ? "Exact template · same text as Initiator comments" : "Exact template"}
      <ChevronDown aria-hidden className="ml-auto size-3.5 group-open:rotate-180" />
    </summary>
    <div className="border-t border-ui-stroke px-3 pb-3 pt-2.5">
      {kind === "ucpath" && <div className="mb-3 max-w-80"><Choice label="Leave scenario" value={choices.leave} options={LEAVE_OPTIONS} onChange={(leave) => onChange({ ...choices, leave: leave as CommentChoices["leave"] })} /></div>}
      {kind === "kuali" && <div className="mb-3 grid grid-cols-3 gap-2">
        <Choice label="Date changes" value={choices.changes} options={[["none", "Neither date changed"], ["last", "Last day worked changed"], ["separation", "Separation date changed"], ["both", "Both dates changed"]]} onChange={(changes) => onChange({ ...choices, changes: changes as CommentChoices["changes"] })} />
        <Choice label="Date source" value={choices.authority} options={[["kronos", "Kronos timesheet"], ["operator", "Operator entry · Kronos omitted"]]} onChange={(authority) => onChange({ ...choices, authority: authority as CommentChoices["authority"] })} />
        <Choice label="Existing text" value={choices.existing} options={[["no", "No existing comments"], ["yes", "Preserve existing comments"]]} onChange={(existing) => onChange({ ...choices, existing: existing as CommentChoices["existing"] })} />
      </div>}
      <pre aria-label={`${templateKind === "kuali" ? "Kuali" : "UCPath"} comment template`} className="m-0 whitespace-pre-wrap break-words rounded-md border border-ui-stroke bg-ui-table px-3 py-2.5 font-data text-body font-normal leading-relaxed text-ui-primary">
        {text.split(/(\{[^}]+\})/u).map((part, i) => part.startsWith("{") ? <span key={i} className="text-ui-info">{part}</span> : part)}
      </pre>
      <p className="mt-2 text-body text-ui-secondary">{kind === "kuali" ? choices.changes === "none" ? "Neither date changed: no date-change lines are added." : "Only changed dates add a line. Existing text is preserved." : LEAVE_CONDITIONS[choices.leave]}</p>
      <p className="mt-1 text-caption text-ui-muted">{kind === "kuali" ? "Nonempty parts are trimmed and joined with one newline. The filing line is always included." : "Exact wording and punctuation. Braces identify values supplied by this run. Both UCPath comment fields receive identical text."}</p>
      {kind !== "duplicate" && <details className="mt-3" data-disclosure={`${id}-rules`} open={rulesOpen} onToggle={(event) => onRulesToggle(event.currentTarget.open)}>
        <summary className={`cursor-pointer text-caption text-ui-secondary ${dsFocus}`}>{kind === "kuali" ? "Template conditions & values" : "All leave rules"}</summary>
        <dl className="mt-2 grid grid-cols-[8rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-caption text-ui-secondary">
          {(kind === "kuali" ? [
            ["Date-change lines", "Added only when the reconciled value differs from its original Kuali value."],
            ["Date source", "Uses “per Kronos timesheet” or “per operator entry at run start” when Kronos is omitted."],
            ["Initials", "First letter of each whitespace-separated part of the configured timekeeper name, uppercased."],
            ["As-of date", "The Pacific calendar day the Kuali document was read, not the save time."],
            ["Existing termination", "The filing line uses the same wording and the existing verified receipt’s transaction number."],
            ["Changed comments", "Stop before saving if current text differs from the original read. Do not overwrite it."],
          ] : [
            ["No leave", "No optional clause."], ["Sick leave", " Sick Leave on {latestSickDate}."],
            ["One holiday", " Holiday Pay on {firstHolidayDate}."], ["Holiday range", " Holiday Pay from {firstHolidayDate} to {latestHolidayDate}."],
            ["Both leave types", "The later latest date wins. Sick wins ties. Exactly one clause is added."], ["Kronos omitted", "No leave clause. The run uses the operator’s dates."],
          ]).map(([term, definition]) => <div key={term} className="contents"><dt className="font-medium text-ui-primary">{term}</dt><dd>{definition}</dd></div>)}
        </dl>
      </details>}
    </div>
  </details>;
}
