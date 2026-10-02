import { useEffect, useRef } from "react";
import { ArrowUpRight, CheckCheck, Cpu, Monitor, PencilLine, X } from "lucide-react";
import { Button, dsElev, dsFocus, IconButton } from "../../ds/ui.js";
import type { FieldSource } from "./explorer-flow-model.js";

export function ExplorerSource({ label, destination, source, onClose, onJump }: {
  label: string; destination: string; source?: FieldSource; onClose: () => void;
  onJump: (step: number, fieldId?: string) => void;
}) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => { close.current?.focus({ preventScroll: true }); }, []);
  return <aside role="dialog" aria-modal="false" aria-label={`${label} source`} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}
    className={`fixed right-6 top-28 z-40 flex max-h-[calc(100dvh-10rem)] w-[22rem] flex-col overflow-hidden rounded-lg border border-ui-stroke bg-ui-panel text-ui-primary min-[1151px]:w-[24rem] ${dsElev.mid}`}>
    <div className="flex items-center gap-2 border-b border-ui-stroke px-4 py-3"><h2 className="min-w-0 flex-1 text-heading">{label}</h2><IconButton ref={close} label="Close field source" size="sm" onClick={onClose} icon={<X aria-hidden className="size-4" />} /></div>
    <div className="overflow-y-auto px-4 pb-4 text-body">
      <p className="my-3 flex items-start gap-2 text-caption text-ui-muted"><PencilLine aria-hidden className="mt-0.5 size-3.5 shrink-0" />{destination}</p>
      {!source ? <p>Source mapping is unavailable in this preview.</p> : <>
        {source.origin && <section className="mt-4"><h3 className="mb-2 text-caption font-semibold text-ui-secondary">{source.origin}</h3><p className="rounded-md border border-ui-stroke bg-ui-table p-3 leading-relaxed">{source.detail}</p></section>}
        {source.reads?.map((read, index) => <section key={`${read.step}-${read.fieldId ?? "step"}`} className="mt-4">
          <h3 className="mb-2 text-caption font-semibold text-ui-secondary">{index === 0 ? "Read from" : "Also uses"}</h3>
          <div className="rounded-md border border-ui-stroke bg-ui-table p-3">
            <p className="mb-1.5 flex items-center gap-2 text-caption text-ui-muted"><Monitor aria-hidden className="size-3.5" />{read.system} · Step {read.step}</p>
            <strong className="text-body font-semibold">{read.page}</strong><p className="mt-1 text-ui-secondary">{read.field}</p>
            <button type="button" className={`mt-3 flex items-center gap-1.5 text-ui-info hover:underline ${dsFocus}`} onClick={() => onJump(read.step, read.fieldId)}>{read.fieldId ? "Go to original field" : "Go to source step"}<ArrowUpRight aria-hidden className="size-3.5" /></button>
          </div>
        </section>)}
        {source.chain && <section className="mt-4"><h3 className="mb-2 text-caption font-semibold text-ui-secondary">Before it is filled</h3>
          <ol className="space-y-3">{source.chain.map((transform) => { const Icon = [16, 20, 21].includes(transform.step) ? CheckCheck : Cpu; return <li key={`${transform.step}-${transform.title}`} className="flex gap-2.5"><Icon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-ui-muted" /><div><strong className="block font-medium">{transform.title} · Step {transform.step}</strong><p className="mt-1 leading-relaxed text-ui-secondary">{transform.detail}</p></div></li>; })}</ol>
        </section>}
      </>}
    </div>
    <div className="border-t border-ui-stroke px-4 py-2"><Button size="toolbar" variant="secondary" onClick={onClose}>Back to field</Button></div>
  </aside>;
}
