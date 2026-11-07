import { Button, Dialog, DialogContent, DialogFooter, dsText } from "../../../ds/ui.js";
import { cn } from "../../../lib/utils.js";

export interface CommandRecoveryEntry {
  readonly inFlightKey: string;
  readonly label: string;
  readonly targets: readonly { runId: string; title: string; expectedVersion: number }[];
  readonly detail?: string;
}

/** A lost response remains recoverable even after its row leaves the queue. */
export function CommandRecovery({ entries, pendingKey, onReview, onReplay }: {
  entries: readonly CommandRecoveryEntry[];
  pendingKey: string | null;
  onReview: (key: string | null) => void;
  onReplay: (entry: CommandRecoveryEntry) => void;
}) {
  const pending = entries.find(entry => entry.inFlightKey === pendingKey);
  return <>
    {entries.length > 0 && <section
      aria-label="Commands awaiting recovery"
      className={cn(dsText.meta, "mx-[var(--ds-shell-inset)] mt-[var(--ds-shell-inset)] flex flex-wrap items-center gap-[var(--ds-space-base)] text-[color:var(--ds-fg-secondary)]")}
    >
      <span>Command outcome unknown. Review the original request to recover its result.</span>
      {entries.map(entry => <Button key={entry.inFlightKey} variant="secondary" onClick={() => onReview(entry.inFlightKey)}>
        Review {entry.label} ({entry.targets.length} {entry.targets.length === 1 ? "run" : "runs"})
      </Button>)}
    </section>}
    <Dialog open={pending !== undefined} onOpenChange={open => { if (!open) onReview(null); }}>
      {pending !== undefined && <DialogContent
        size="sm"
        title={`Recover previous ${pending.label}`}
        description="The previous response was lost. Resend the original request to recover its result. If it was not received, this can apply it to the runs below. Your current selection does not change this request."
      >
        <div className={cn(dsText.meta, "max-h-40 overflow-y-auto px-[var(--ds-space-loose)] pt-[var(--ds-space-cozy)] text-[color:var(--ds-fg-secondary)]")}>
          {pending.detail !== undefined && <p>{pending.detail}</p>}
          <ul>{pending.targets.map(target => <li key={target.runId}>
            {target.title} · {target.runId} · row rev {target.expectedVersion}
          </li>)}</ul>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onReview(null)}>Keep unresolved</Button>
          <Button variant="danger" onClick={() => onReplay(pending)}>Resend original request</Button>
        </DialogFooter>
      </DialogContent>}
    </Dialog>
  </>;
}
