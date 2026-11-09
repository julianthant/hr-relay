import { Lock } from "lucide-react";
import type { ReactNode } from "react";
import { DsBodyScope, Switch } from "../../ds/ui.js";
import { cn } from "../../lib/utils.js";

const TITLE = "text-[length:var(--ds-row-title)] font-normal leading-[var(--ds-row-title-lh)] text-[color:var(--ds-fg)]";
const NOTE = "mt-[var(--ds-row-gap)] truncate text-[length:var(--ds-row-desc)] font-normal leading-[var(--ds-row-desc-lh)] text-[color:var(--ds-fg-secondary)]";

function RunHeading({ title, description, aside }: { title: string; description?: ReactNode; aside?: ReactNode }) {
  return <div className="flex flex-col gap-0.5"><div className="flex items-baseline justify-between gap-3"><h4 className="m-0 text-[length:var(--ds-row-heading)] font-normal leading-[var(--ds-row-heading-lh)] text-[color:var(--ds-fg)]">{title}</h4>{aside && <span className="text-[13px] text-ui-muted">{aside}</span>}</div>{description && <p className="m-0 text-[13px] leading-4 text-[color:var(--ds-fg-secondary)]">{description}</p>}</div>;
}

/** The one card every list in the Run and Rerun dialogs uses (input, spreadsheets, options, steps, blockers), so their rows cannot drift. Without children it is just the heading. */
export function RunList({ title, label, description, aside, children }: { title?: string; label?: string; description?: ReactNode; aside?: ReactNode; children?: ReactNode }) {
  return <DsBodyScope role="region" aria-label={label ?? title} className="flex min-w-0 flex-col gap-3" style={{ background: "transparent" }}>
    {title && <RunHeading title={title} description={description} aside={aside} />}
    {children && <div className="overflow-hidden rounded-[var(--ds-row-radius)] border border-ui-stroke bg-ui-table px-[var(--ds-row-pad-x)]">{children}</div>}
  </DsBodyScope>;
}

/** A heading with its grey description above a control that is not a row list (a textbox). */
export function RunSection({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return <section aria-label={title} className="flex min-w-0 flex-col gap-3"><RunHeading title={title} description={description} />{children}</section>;
}

/** One row: a title with its grey line directly under it on the left, controls vertically centred on the right. `check` puts an include toggle at the far right, `locked` a disabled on toggle with a small lock, `lead` an icon. */
export function RunListRow({ title, description, check, locked, lead, dimmed, below, children }: {
  title: ReactNode; description?: ReactNode;
  check?: { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean };
  locked?: boolean; lead?: ReactNode; dimmed?: boolean; below?: ReactNode; children?: ReactNode;
}) {
  const name = typeof title === "string" ? title : "Include";
  const toggle = check
    ? <Switch hideLabel label={`Include ${name}`} checked={check.checked} disabled={check.disabled} onCheckedChange={check.onChange} className="!min-h-0 !w-auto !py-0" />
    : locked
      ? <><Lock aria-label="Required" role="img" className="size-3 text-[color:var(--ds-fg-muted)]" /><Switch hideLabel label={`${name} (required)`} checked disabled onCheckedChange={() => undefined} className="!min-h-0 !w-auto !py-0" /></>
      : null;
  return <div className={cn("ds-run-row flex flex-col justify-center gap-2 border-b border-ui-stroke last:border-b-0", description ? "min-h-[var(--ds-row-h-2)] py-[var(--ds-row-pad-y)]" : "min-h-[var(--ds-row-h-1)] py-[var(--ds-row-pad-y-1)]", dimmed && "opacity-50")}>
    <div className="flex items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-[var(--ds-space-base)]">
        {lead}
        <div className="min-w-0"><div className={TITLE}>{title}</div>{description && <div className={NOTE}>{description}</div>}</div>
      </div>
      {(children || toggle) && <div className="flex shrink-0 items-center gap-3">{children}{toggle}</div>}
    </div>
    {below}
  </div>;
}
