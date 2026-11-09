import { Lock } from "lucide-react";
import type { ReactNode } from "react";
import { Checkbox } from "../../ds/ui.js";
import { cn } from "../../lib/utils.js";

const TITLE = "text-[13px] font-normal leading-[18px] text-[color:var(--ds-fg)]";
const NOTE = "truncate text-[12px] font-normal leading-4 text-[color:var(--ds-fg-muted)]";
const CHECK_COPY = "[&_.ds-checkbox-label]:text-[13px] [&_.ds-checkbox-label]:font-normal [&_.ds-checkbox-label]:leading-[18px] [&_.ds-checkbox-description]:mt-0 [&_.ds-checkbox-description]:text-[12px] [&_.ds-checkbox-description]:leading-4";

/** The one card every list in the Run and Rerun dialogs uses (input, spreadsheets, options, steps, blockers), so their rows cannot drift. */
export function RunList({ title, label, children }: { title?: string; label?: string; children: ReactNode }) {
  return <section aria-label={label ?? title} className="flex min-w-0 flex-col gap-2">
    {title && <h4 className="m-0 text-[13px] font-semibold leading-[18px]">{title}</h4>}
    <div className="overflow-hidden rounded-[var(--ds-radius-body-group)] border border-ui-stroke bg-ui-panel">{children}</div>
  </section>;
}

/** One row: a title with its grey line directly under it on the left, controls vertically centred on the right. `check` puts an include checkbox before the copy, `locked` a locked check, `lead` an icon. */
export function RunListRow({ title, description, check, locked, lead, dimmed, below, children }: {
  title: ReactNode; description?: ReactNode;
  check?: { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean };
  locked?: boolean; lead?: ReactNode; dimmed?: boolean; below?: ReactNode; children?: ReactNode;
}) {
  return <div className={cn("flex flex-col gap-3 border-b border-ui-stroke px-4 py-3 last:border-b-0", dimmed && "opacity-50")}>
    <div className="flex min-h-[34px] items-center justify-between gap-4">
      {check
        ? <Checkbox className={cn("min-w-0 items-center", CHECK_COPY)} label={title} description={description} disabled={check.disabled} checked={check.checked} onCheckedChange={value => check.onChange(value === true)} />
        : <div className="flex min-w-0 items-center gap-[var(--ds-space-base)]">
          {locked && <span role="img" aria-label="Required" className="inline-flex size-4 shrink-0 items-center justify-center rounded-[var(--ds-radius-xs)] bg-[var(--ds-surface-3)] text-[color:var(--ds-fg-muted)]"><Lock aria-hidden className="size-2.5" /></span>}
          {lead}
          <div className="min-w-0"><div className={TITLE}>{title}</div>{description && <div className={NOTE}>{description}</div>}</div>
        </div>}
      {children && <div className="flex shrink-0 items-center gap-3">{children}</div>}
    </div>
    {below}
  </div>;
}
