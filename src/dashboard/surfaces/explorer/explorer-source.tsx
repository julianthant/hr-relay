import { useEffect, useRef } from "react";
import { ArrowUpRight, Monitor, PencilLine, X } from "lucide-react";
import { ButtonLink, Button, Card, dsElev, dsLayer, IconButton, Well } from "../../ds/ui.js";
import type { FieldSource } from "./explorer-spec.js";

export function ExplorerSource({ label, destination, source, onClose, onJump }: {
  label: string; destination: string; source?: FieldSource; onClose: () => void;
  onJump: (step: number) => void;
}) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => { close.current?.focus({ preventScroll: true }); }, []);
  return <Card role="dialog" aria-modal="false" aria-label={`${label} source`} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}
    className={`fixed right-[var(--ds-space-loose)] top-[calc(var(--ds-h-topbar)+var(--ds-space-section)*3)] max-h-[calc(100dvh-var(--ds-h-topbar)-var(--ds-space-section)*4)] w-[var(--ds-w-body-control-wide)] overflow-hidden ${dsLayer.drawer} ${dsElev.mid}`}>
    <div className="flex items-center gap-2 border-b border-ui-stroke px-4 py-3"><h2 className="min-w-0 flex-1 text-heading">{label}</h2><IconButton ref={close} label="Close field source" size="sm" onClick={onClose} icon={<X aria-hidden className="size-4" />} /></div>
    <div className="flex flex-col gap-4 overflow-y-auto px-4 py-3 text-body">
      <p className="m-0 flex items-start gap-2 text-caption text-ui-muted"><PencilLine aria-hidden className="mt-0.5 size-3.5 shrink-0" />{destination}</p>
      {!source ? <p className="m-0">No source mapping is recorded for this field.</p> : <>
        {source.origin && <section className="flex flex-col gap-2"><h3 className="m-0 text-caption font-medium text-ui-secondary">{source.origin}</h3><Well className="leading-relaxed">{source.detail}</Well></section>}
        {source.reads?.map((read, index) => <section key={`${read.step}-${read.page}-${read.field}`} className="flex flex-col gap-2">
          <h3 className="m-0 text-caption font-medium text-ui-secondary">{index === 0 ? "Read from" : "Also uses"}</h3>
          <Well className="flex flex-col gap-1">
            <p className="m-0 flex items-center gap-2 text-caption text-ui-muted"><Monitor aria-hidden className="size-3.5" />{read.system} · Step {read.step}</p>
            <strong className="text-body font-medium">{read.page}</strong><p className="m-0 text-ui-secondary">{read.field}</p>
            <ButtonLink href={`#explorer-step-${read.step}`} variant="ghost" size="toolbar" className="mt-2 self-start" iconAfter={<ArrowUpRight aria-hidden className="size-3.5" />}
              onClick={event => { event.preventDefault(); onJump(read.step); }}>Go to source step</ButtonLink>
          </Well>
        </section>)}
      </>}
    </div>
    <div className="border-t border-ui-stroke px-4 py-2"><Button size="toolbar" variant="secondary" onClick={onClose}>Back to field</Button></div>
  </Card>;
}
