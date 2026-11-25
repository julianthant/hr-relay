import { ArrowUpRight, Cpu, Eye, PencilLine } from "lucide-react";
import { displayExtractedDate } from "../../../lib/date-format.js";
import { dsFocus } from "../../../ds/ui.js";
import { cn } from "../../../lib/utils.js";

export type FieldRowKind = "fill" | "read" | "compute";

const COLUMNS = "grid-cols-[1rem_minmax(var(--spacing-log-label),.85fr)_minmax(0,1.15fr)] max-[1100px]:grid-cols-[1rem_minmax(4.5rem,.85fr)_minmax(0,1.15fr)] @max-[448px]:grid-cols-[1rem_minmax(4.5rem,.85fr)_minmax(0,1.15fr)]";
const COLUMNS_WITH_SOURCE = "grid-cols-[1rem_minmax(var(--spacing-log-label),.85fr)_minmax(0,1.15fr)_auto] max-[1100px]:grid-cols-[1rem_minmax(4.5rem,.85fr)_minmax(0,1.15fr)_auto] @max-[448px]:grid-cols-[1rem_minmax(4.5rem,.85fr)_minmax(0,1.15fr)_auto]";

/**
 * A fill row (typed value, blue) or a read row (what the page showed). `unread` marks a read that found nothing.
 * `onSource` adds the arrow that opens where the value comes from (Explorer).
 */
export function FieldRow({ kind, label, value, unread = false, mark, onSource }: { kind: FieldRowKind; label: string; value: string; unread?: boolean; mark?: string; onSource?: (trigger: HTMLButtonElement) => void }) {
  const Icon = kind === "fill" ? PencilLine : kind === "compute" ? Cpu : Eye;
  return <div data-log-field={kind} className={cn("grid min-w-0 items-baseline gap-x-3 border-b border-ui-stroke py-2.5 last:border-b-0", onSource ? COLUMNS_WITH_SOURCE : COLUMNS)}>
    <Icon aria-hidden className={cn("size-3.5 self-start translate-y-0.5", kind === "fill" ? "text-ui-info" : "text-ui-muted")} />
    <dt className="min-w-0 text-body font-medium">{label}</dt>
    <FieldValueCell value={value} mark={mark} className={cn("m-0 min-w-0 text-right text-body text-balance [overflow-wrap:break-word]", kind === "fill" ? "text-ui-info font-medium" : unread ? "text-ui-danger/75" : "text-ui-secondary")} />
    {onSource && <button type="button" aria-label={`Show source for ${label}`} onClick={event => onSource(event.currentTarget)} className={cn("self-start translate-y-0.5 rounded-sm text-ui-info hover:text-ui-primary", dsFocus)}><ArrowUpRight aria-hidden className="size-3.5" /></button>}
  </div>;
}

/** The rows of a page card, grouped as one definition list. */
export function FieldRows({ padded, children }: { padded: boolean; children: React.ReactNode }) {
  return <dl className={cn("m-0", padded && "px-3")}>{children}</dl>;
}

/** The value wraps at any width, so the whole of it stays on the page. */
function FieldValueCell({ value, mark, className }: { value: string; mark?: string; className: string }) {
  return <dd className={className}><FieldValue value={value} />{mark !== undefined && <span className="ml-2 whitespace-nowrap text-caption font-normal text-ui-muted">{mark}</span>}</dd>;
}

function FieldValue({ value }: { value: string }) {
  return <>{displayExtractedDate(value).split(/(\b[A-Z]{2,}[A-Za-z\d]*-[A-Za-z\d-]+\b)/gu).map((part, index) => /^[A-Z]{2,}[A-Za-z\d]*-[A-Za-z\d-]+$/u.test(part) && part.length < 80 ? <span key={index} className="whitespace-nowrap">{part}</span> : part)}</>;
}
