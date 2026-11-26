import { useContext, useLayoutEffect, useRef, useState } from "react";
import { Minus, Plus, UserPlus } from "lucide-react";
import { Button, Dialog, DialogBody, DialogContent, DialogFooter, DialogTrigger, Field, IconButton, Select, Tooltip } from "../../ds/ui.js";
import { useViewState } from "../../app/navigation/view-route-model.js";
import { FirstScreenRevealedContext } from "../../app/startup/first-screen.js";
import type { SessionsViewState } from "./sessions-view-model.js";
import type { SessionPreviewOperation } from "./session-preview-command-model.js";

/** Add workers: the person-plus control in the sidebar footer and its dialog. */
export function AddWorkers({ data, workflows, operations = {}, onAdd, onAdded }: {
  data: SessionsViewState; workflows: readonly { id: string; label: string }[];
  operations?: Readonly<Record<string, SessionPreviewOperation>>; onAdd: (workflowId: string, count: number) => void; onAdded: () => void;
}) {
  const actionable = data.state === "ready" && !data.stale;
  const addTriggerRef = useRef<HTMLButtonElement>(null);
  const addFocusOrigin = useRef<Element | null>(null);
  const [addOpen, setAddOpen] = useViewState("addWorkers", false);
  const firstScreenRevealed = useContext(FirstScreenRevealedContext);
  const [workflow, setWorkflow] = useViewState("workerWorkflow", workflows[0]?.id ?? "");
  const [count, setCount] = useState("1");
  const validCount = Number.isSafeInteger(Number(count)) && Number(count) >= 1;
  const addLocked = operations.add?.state === "pending";
  // Why Add workers cannot act now; the dimmed button keeps its place and says so.
  const addOff = data.state === "loading" ? "Sessions are loading" : data.state === "unavailable" ? "Sessions are unavailable" : data.stale ? "Sessions are out of date" : !workflows.length ? "No workflow can start workers" : undefined;
  const selectedWorkflow = workflows.find(item => item.id === workflow) ?? workflows[0];
  const selectedWorkflowId = selectedWorkflow?.id ?? "";
  // Workers the workflow already has, from the sessions the dashboard reads.
  const nowCount = (id: string) => data.state === "ready" ? data.workers.filter(worker => worker.workflowId === id).length : 0;
  const validWorkflow = selectedWorkflow !== undefined;
  useLayoutEffect(() => {
    const origin = addFocusOrigin.current;
    const trigger = addTriggerRef.current;
    if (origin === null || addOpen || trigger === null || trigger.disabled) return;
    addFocusOrigin.current = null;
    const active = document.activeElement;
    if (active !== null && active !== document.body && active.isConnected && active !== trigger && !origin.contains(active)) return;
    trigger.focus({ preventScroll: true });
  }, [addOpen, addLocked, data.state, validWorkflow]);
  const addControl = <Dialog open={addOpen && firstScreenRevealed} onOpenChange={setAddOpen}>
          {addOff === undefined
            ? <Tooltip side="right" content="Add workers"><DialogTrigger asChild><IconButton ref={addTriggerRef} variant="ghost" size="sm" label="Add workers" title="" disabled={addLocked} aria-busy={addLocked || undefined} icon={<UserPlus aria-hidden className="size-4" />} /></DialogTrigger></Tooltip>
            : <Tooltip side="right" content={addOff}><span role="group" tabIndex={0} aria-label={addOff} className="inline-flex rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-ui-info"><DialogTrigger asChild><IconButton ref={addTriggerRef} variant="ghost" size="sm" label="Add workers" title="" disabled icon={<UserPlus aria-hidden className="size-4" />} /></DialogTrigger></span></Tooltip>}
          <DialogContent title="Add workers" className="ui-theme-scope overflow-visible bg-ui-panel font-ui text-ui-primary [--ds-control-bg:var(--ui-field)] [--ds-control-bg-hover:var(--ui-hover)] [--ds-control-fg:var(--ui-primary)] [--ds-border-strong:var(--ui-stroke-control)] [--ds-focus-ring:var(--ui-info)]" size="sm">
            <DialogBody><div className="grid grid-cols-[1fr_auto] items-end gap-3">
              <Field label="Workflow"><Select value={selectedWorkflowId} onChange={event => setWorkflow(event.target.value)}>{workflows.map(item => <option key={item.id} value={item.id}>{item.label} · {nowCount(item.id)} now</option>)}</Select></Field>
              <Field label="Workers"><div className="flex h-7 items-center rounded-lg border border-ui-stroke-control bg-ui-field focus-within:border-ui-info">
                <button type="button" aria-label="Remove one worker" className="grid h-full w-8 place-items-center rounded-l-lg text-ui-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-ui-info hover:bg-ui-hover disabled:text-ui-muted disabled:hover:bg-transparent" disabled={!validCount || Number(count) <= 1} onClick={() => setCount(String(Number(count) - 1))}><Minus aria-hidden className="size-3.5" /></button>
                <input aria-label="Workers" className="h-full w-10 border-0 bg-transparent p-0 text-center tabular-nums outline-none focus-visible:bg-ui-hover [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" type="number" min={1} step={1} value={count} onChange={event => setCount(event.target.value)} />
                <button type="button" aria-label="Add one worker" className="grid h-full w-8 place-items-center rounded-r-lg text-ui-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-ui-info hover:bg-ui-hover disabled:text-ui-muted disabled:hover:bg-transparent" disabled={!validCount || Number(count) >= Number.MAX_SAFE_INTEGER} onClick={() => setCount(String(Number(count) + 1))}><Plus aria-hidden className="size-3.5" /></button>
              </div></Field>
            </div></DialogBody>
            <DialogFooter><Button variant="secondary" onClick={() => setAddOpen(false)}>Cancel</Button><Button variant="primary" disabled={!validCount || !validWorkflow || !actionable || addLocked} onClick={event => { addFocusOrigin.current = event.currentTarget.closest('[role="dialog"]'); onAdd(selectedWorkflowId, Number(count)); setAddOpen(false); onAdded(); }}>{validCount ? `Add ${count} ${Number(count) === 1 ? "worker" : "workers"}` : "Add workers"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>;
  return addControl;
}
