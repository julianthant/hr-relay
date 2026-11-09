import { Lock } from "lucide-react";
import type { ReactNode } from "react";
import { Checkbox, DsBodyScope } from "../../ds/ui.js";
import { cn } from "../../lib/utils.js";

const TITLE = "text-[14px] font-normal leading-[18px] text-[color:var(--ds-fg)]";
const NOTE = "mt-0.5 truncate text-[13px] font-normal leading-4 text-[color:var(--ds-fg-secondary)]";
const CHECK_COPY = "[&_.ds-checkbox-control]:!mt-0 [&_.ds-checkbox-control]:!size-[14px] [&_.ds-checkbox-label]:!text-[14px] [&_.ds-checkbox-label]:!font-normal [&_.ds-checkbox-label]:!leading-[18px] [&_.ds-checkbox-description]:!mt-0.5 [&_.ds-checkbox-description]:!text-[13px] [&_.ds-checkbox-description]:!leading-4 [&_.ds-checkbox-description]:!text-[color:var(--ds-fg-secondary)]";

function RunHeading({ title, description, aside }: { title: string; description?: ReactNode; aside?: ReactNode }) {
  return <div className="flex flex-col gap-0.5"><div className="flex items-baseline justify-between gap-3"><h4 className="m-0 text-[16px] font-normal leading-[22px] text-[color:var(--ds-fg)]">{title}</h4>{aside && <span className="text-[13px] text-ui-muted">{aside}</span>}</div>{description && <p className="m-0 text-[13px] leading-4 text-[color:var(--ds-fg-secondary)]">{description}</p>}</div>;
}

/** The one card every list in the Run and Rerun dialogs uses (input, spreadsheets, options, steps, blockers), so their rows cannot drift. Without children it is just the heading. */
export function RunList({ title, label, description, aside, children }: { title?: string; label?: string; description?: ReactNode; aside?: ReactNode; children?: ReactNode }) {
  return <DsBodyScope role="region" aria-label={label ?? title} className="flex min-w-0 flex-col gap-3" style={{ background: "transparent" }}>
    {title && <RunHeading title={title} description={description} aside={aside} />}
    {children && <div className="overflow-hidden rounded-[14px] border border-ui-stroke bg-ui-table px-4">{children}</div>}
  </DsBodyScope>;
}

/** A heading with its grey description above a control that is not a row list (a textbox). */
export function RunSection({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return <section aria-label={title} className="flex min-w-0 flex-col gap-3"><RunHeading title={title} description={description} />{children}</section>;
}

/** One row: a title with its grey line directly under it on the left, controls vertically centred on the right. `check` puts an include checkbox before the copy, `locked` a locked check, `lead` an icon. */
export function RunListRow({ title, description, check, locked, lead, dimmed, below, children }: {
  title: ReactNode; description?: ReactNode;
  check?: { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean };
  locked?: boolean; lead?: ReactNode; dimmed?: boolean; below?: ReactNode; children?: ReactNode;
}) {
  return <div className={cn("flex min-h-[42px] flex-col justify-center gap-2 border-b border-ui-stroke last:border-b-0", description ? "py-3" : "py-2.5", dimmed && "opacity-50")}>
    <div className="flex items-center justify-between gap-4">
      {check
        ? <Checkbox className={cn("min-w-0 items-center", CHECK_COPY)} label={title} description={description} disabled={check.disabled} checked={check.checked} onCheckedChange={value => check.onChange(value === true)} />
        : <div className="flex min-w-0 items-center gap-[var(--ds-space-base)]">
          {locked && <span role="img" aria-label="Required" className="inline-flex size-[14px] shrink-0 items-center justify-center rounded-[var(--ds-radius-xs)] bg-[var(--ds-surface-3)] text-[color:var(--ds-fg-muted)]"><Lock aria-hidden className="size-2.5" /></span>}
          {lead}
          <div className="min-w-0"><div className={TITLE}>{title}</div>{description && <div className={NOTE}>{description}</div>}</div>
        </div>}
      {children && <div className="flex shrink-0 items-center gap-3">{children}</div>}
    </div>
    {below}
  </div>;
}
