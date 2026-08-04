/**
 * Ported from legacy hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc,
 * src/dashboard/components/dev/rebuild-demo/DemoRunStart.tsx
 *
 * **The** Start Run surface — 1i's typed method, wired to the real start
 * protocol (doc 13 §5.1):
 *
 *   1. the descriptor's own input surface decides the door exists; a workflow
 *      that declares none renders the served absence, not empty scaffolding;
 *   2. the operator types into the descriptor's placeholder, and the
 *      descriptor's own parser spec previews exactly how that text splits;
 *   3. `POST /start-plans` returns the exact proposed runs, the refusals, and a
 *      short-lived plan token bound to every fingerprint;
 *   4. the operator CONFIRMS, and one `start-run` command consumes that token
 *      idempotently;
 *   5. the queue changes only from the authoritative projection. This surface
 *      never inserts a row, never turns a status, and stops at "applied".
 *
 * Nothing here knows a workflow: every input, constant and system is read off
 * props the app composed from the descriptor/bootstrap projections, so a
 * workflow registered tomorrow gets a correct dialog for free — and one whose
 * start capability is absent is not offered rather than offered and broken.
 *
 * Deferred with their owning slices, and omitted rather than faked: the upload,
 * capture, spreadsheet and bare start methods and their peer-method tabs (2h),
 * the workflow picker's catalogue and its "not startable" disclosure (needs the
 * bootstrap start-capability projection), presets, preflight/doctor results,
 * per-system host lines, and the active-run enqueue-policy select (the policy
 * is a descriptor declaration in this tree, not an operator choice).
 */
import { useCallback, useMemo, useState } from "react";
import { Keyboard, Layers, Play, SlidersHorizontal } from "lucide-react";
import { cn } from "../lib/utils.js";
import {
  Banner,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  EmptyState,
  Field,
  MetaLine,
  SectionLabel,
  Select,
  Textarea,
  Well,
  dsFg,
  dsIcon,
  dsRadius,
  dsText,
} from "../ds/ui.js";
import { systemClock } from "../../domain/clock.js";
import type { CommandResult } from "../../domain/commands.js";
import {
  parseInputRunText,
  toRawSubmission,
  type InputParserSpec,
  type InputRunSurface,
  type ParsedInputEntry,
} from "../../domain/workflow/ingress.js";
import type { StartPlanResponse } from "../client/index.js";
import { useDashboardClient } from "../state/client-context.js";
import {
  EnqueueResultBanner,
  InstanceSelector,
  PlanPreview,
  PlanRefusals,
  RunFlagChips,
  StageRail,
  StartChoiceControl,
  StartFlagControl,
  testSystemsOf,
  type InstanceChoice,
  type SystemInstancePrimitive,
} from "./run-start-kit.js";

/** the surface id this command family is audited under (doc 13 §3.4) */
const SOURCE_SURFACE = "run-start";

const STAGES = Object.freeze([
  { key: "input", label: "Input" },
  { key: "plan", label: "Plan" },
  { key: "result", label: "Result" },
] as const);

type StageKey = (typeof STAGES)[number]["key"];

/**
 * What the app composes from the descriptor and bootstrap projections. The
 * dialog reads exactly this and imports no workflow module.
 */
export interface RunStartWorkflow {
  readonly workflowId: string;
  readonly label: string;
  /** the descriptor's declared typed-input surface, or why there is none */
  readonly inputRun:
    | { readonly state: "present"; readonly surface: InputRunSurface }
    | { readonly state: "absent"; readonly reason: string };
  readonly systemInstances: readonly SystemInstancePrimitive[];
}

// ---------------------------------------------------------------------------
// The launcher
// ---------------------------------------------------------------------------

/** the queue toolbar's one primary control — the dialog itself lives at the root */
export function RunStartButton({ onOpen }: { onOpen: () => void }) {
  return (
    <Button
      size="toolbar"
      variant="brand"
      onClick={onOpen}
      icon={<Play aria-hidden className={dsIcon.sm} />}
      // No `r` hint on the face of it: a shortcut badge on the ONE primary in
      // the toolbar spends the slot where the verb should end the eye's travel.
      // The binding stays discoverable where every other one is.
      title="Start a run (r)"
    >
      Start a run
    </Button>
  );
}

// ---------------------------------------------------------------------------
// The descriptor's own parser, previewed
// ---------------------------------------------------------------------------

function separatorLabel(spec: InputParserSpec): string {
  if (spec.split.kind === "whole-text") return "the whole box is one entry";
  const shown = spec.split.delimiters.map((delimiter) => (delimiter === "\n" ? "a new line" : `“${delimiter}”`));
  if (shown.length === 1) return `separated by ${shown[0]}`;
  return `separated by ${shown.slice(0, -1).join(", ")} or ${shown[shown.length - 1]}`;
}

interface ParsePreview {
  readonly entries: readonly ParsedInputEntry[];
  /** the parser's own refusal, surfaced verbatim — never swallowed to an empty list */
  readonly problem: string | null;
}

function TypedInput({
  surface,
  workflowId,
  text,
  onText,
  preview,
}: {
  surface: InputRunSurface;
  workflowId: string;
  text: string;
  onText: (next: string) => void;
  preview: ParsePreview;
}) {
  return (
    <div className="flex flex-col gap-[var(--ds-space-snug)]">
      <Field
        label={`Entries — ${separatorLabel(surface.parser)}`}
        hint={`${String(preview.entries.length)} parsed`}
        error={preview.problem}
      >
        <Textarea
          // Re-keyed per workflow so switching one puts the caret in the box the
          // operator is about to type into.
          key={workflowId}
          autoFocus
          rows={4}
          value={text}
          placeholder={surface.placeholder}
          onChange={(event) => onText(event.target.value)}
        />
      </Field>

      {preview.entries.length > 0 && (
        <ul className="flex flex-col gap-[var(--ds-space-hair)]">
          {preview.entries.map((entry) => (
            <li
              key={entry.index}
              className={cn(
                "flex min-w-0 items-center gap-[var(--ds-space-snug)] px-[var(--ds-space-snug)] py-[var(--ds-space-hair)]",
                dsRadius.sm,
                "bg-[var(--ds-surface-2)]",
              )}
            >
              <span className={cn(dsText.micro, dsText.nums, dsFg.faint)}>{entry.index + 1}</span>
              <span className={cn(dsText.body, "min-w-0 flex-1 truncate", dsFg.base)}>{entry.sourceText}</span>
              <span className={cn(dsText.meta, dsFg.muted)}>{entry.fields[0].field}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The dialog
// ---------------------------------------------------------------------------

export function RunStartDialog({
  open,
  onOpenChange,
  workflow,
  actorId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflow: RunStartWorkflow;
  /** echoed from bootstrap; the server matches it against the request identity */
  actorId: string;
}) {
  const client = useDashboardClient();
  const { inputRun, systemInstances, workflowId } = workflow;

  const [stage, setStage] = useState<StageKey>("input");
  const [text, setText] = useState("");
  const [priority, setPriority] = useState<"interactive" | "bulk">("interactive");
  const [dryRunRequested, setDryRunRequested] = useState(false);
  const [instances, setInstances] = useState<InstanceChoice>({});
  const [plan, setPlan] = useState<StartPlanResponse | null>(null);
  const [result, setResult] = useState<CommandResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const supportsDryRun = inputRun.state === "present" && inputRun.surface.supportsDryRun === true;
  const dryRun = supportsDryRun && dryRunRequested;
  const test = testSystemsOf(systemInstances, instances);

  const preview = useMemo((): ParsePreview => {
    if (inputRun.state !== "present" || text.trim().length === 0) return { entries: [], problem: null };
    try {
      return { entries: parseInputRunText(inputRun.surface.parser, text), problem: null };
    } catch (caught) {
      // The parser refuses an entry no rule claims. That refusal is precisely
      // what the operator has to see — it is rendered, never defaulted away.
      return { entries: [], problem: caught instanceof Error ? caught.message : String(caught) };
    }
  }, [inputRun, text]);

  const constants = inputRun.state === "present" ? (inputRun.surface.parser.constants ?? []) : [];

  const submitPlan = useCallback(async (): Promise<void> => {
    if (preview.entries.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const next = await client.submitStartPlan({
        workflowId,
        submissions: preview.entries.map((entry) => toRawSubmission(entry)),
        dryRun,
        priority,
        ...(Object.keys(instances).length === 0 ? {} : { requestedInstance: instances }),
      });
      setPlan(next);
      setResult(null);
      setStage("plan");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }, [client, dryRun, instances, preview, priority, workflowId]);

  const confirmStart = useCallback(async (): Promise<void> => {
    if (plan === null) return;
    setBusy(true);
    setError(null);
    try {
      const next = await client.executeCommand({
        commandId: crypto.randomUUID(),
        requestedAt: systemClock.now().toISOString(),
        requestedBy: actorId,
        source: SOURCE_SURFACE,
        family: "start",
        type: "start-run",
        target: {
          workflowId: plan.workflowId,
          startPlanId: plan.startPlanId,
          expectedVersion: plan.expectedVersion,
        },
        payload: plan.fingerprints,
      });
      setResult(next);
      setStage("result");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }, [actorId, client, plan]);

  const reachable = useMemo(() => {
    const keys = new Set<string>(["input"]);
    if (plan !== null) keys.add("plan");
    if (result !== null) keys.add("result");
    return keys;
  }, [plan, result]);

  const applied = result?.state === "applied" || result?.state === "already-applied";
  const blockedReason = inputRun.state !== "present"
    ? inputRun.reason
    : preview.problem !== null
      ? "Fix the refused entry first."
      : preview.entries.length === 0
        ? "Type at least one entry."
        : null;

  const closeAndReset = useCallback((next: boolean) => {
    onOpenChange(next);
    if (!next) {
      // The plan token is short-lived and single-use; a closed dialog must not
      // reopen holding a token the server may already have consumed. The typed
      // draft survives — retyping it is the cost this deliberately avoids.
      setPlan(null);
      setResult(null);
      setError(null);
      setStage("input");
    }
  }, [onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={closeAndReset}>
      <DialogContent
        size="xl"
        title="Start a run"
        description="It declares what it takes, and the plan says exactly what will exist before anything is enqueued."
        className="h-[min(88vh,760px)]"
      >
        <div className="flex min-h-0 flex-1">
          <DialogBody className="flex flex-1 flex-col gap-[var(--ds-space-loose)]">
            <StageRail stages={STAGES} current={stage} reachable={reachable} onSelect={(key) => setStage(key as StageKey)} />

            {error !== null && (
              <Banner tone="danger" title="The request did not complete">
                {error}
              </Banner>
            )}

            <section className="flex flex-col gap-[var(--ds-space-snug)]">
              <SectionLabel>Workflow</SectionLabel>
              <div className="flex min-w-0 flex-wrap items-center gap-[var(--ds-space-base)]">
                <h3 className={cn(dsText.section, "min-w-0 font-semibold", dsFg.base)}>{workflow.label}</h3>
                <RunFlagChips dryRun={dryRun} test={test} priority={priority} />
              </div>
            </section>

            {stage === "input" && (
              inputRun.state === "present" ? (
                <TypedInput
                  surface={inputRun.surface}
                  workflowId={workflowId}
                  text={text}
                  onText={(next) => {
                    setText(next);
                    setPlan(null);
                    setResult(null);
                  }}
                  preview={preview}
                />
              ) : (
                <Well>
                  <EmptyState
                    className="p-[var(--ds-space-base)]"
                    icon={<Keyboard aria-hidden className={dsIcon.lg} />}
                    title="No typed start for this workflow"
                    description={inputRun.reason}
                  />
                </Well>
              )
            )}

            {stage === "input" && constants.length > 0 && (
              <section className="flex flex-col gap-[var(--ds-space-cozy)]">
                <SectionLabel>
                  <SlidersHorizontal aria-hidden className={cn(dsIcon.sm, "mr-[var(--ds-space-tight)] inline")} />
                  How this run is shaped
                </SectionLabel>
                <div className="grid grid-cols-1 gap-[var(--ds-space-cozy)] min-[560px]:grid-cols-2">
                  {constants.map((constant) => (
                    <StartChoiceControl
                      key={constant.field}
                      constant={constant}
                      reason="fixed by this workflow's input surface"
                    />
                  ))}
                </div>
              </section>
            )}

            {stage === "plan" && (
              plan === null ? (
                <Well>
                  <EmptyState
                    className="p-[var(--ds-space-base)]"
                    icon={<Layers aria-hidden className={dsIcon.lg} />}
                    title="No plan yet"
                    description="Type the entries and plan the run; this fills in with the exact rows it would create."
                  />
                </Well>
              ) : (
                <div className="flex flex-col gap-[var(--ds-space-loose)]">
                  <PlanPreview plan={plan} test={test} />
                  <PlanRefusals refused={plan.refused} />
                </div>
              )
            )}

            {stage === "result" && result !== null && (
              <EnqueueResultBanner result={result} onDismiss={() => setResult(null)} />
            )}
          </DialogBody>

          {/* Shared run behavior, deliberately OUTSIDE the workflow form: these
              controls keep the same meaning whichever workflow is selected. */}
          <aside
            aria-label="Run controls"
            className="flex w-[300px] shrink-0 flex-col gap-[var(--ds-space-loose)] overflow-y-auto border-l border-[color:var(--ds-border)] bg-[var(--ds-recess-bg)] p-[var(--ds-space-cozy)]"
          >
            <Field label="Priority" description="Bulk work yields whenever interactive work needs the browser.">
              <Select
                value={priority}
                onChange={(event) => {
                  setPriority(event.target.value === "bulk" ? "bulk" : "interactive");
                  setPlan(null);
                }}
              >
                <option value="interactive">Interactive</option>
                <option value="bulk">Bulk</option>
              </Select>
            </Field>

            <StartFlagControl
              label="Dry run"
              description={supportsDryRun ? undefined : "not declared by this workflow"}
              checked={dryRun}
              disabled={!supportsDryRun}
              onChange={(next) => {
                setDryRunRequested(next);
                setPlan(null);
              }}
            />

            <section className="flex flex-col gap-[var(--ds-space-snug)]">
              <SectionLabel>Destination</SectionLabel>
              <InstanceSelector
                systems={systemInstances}
                value={instances}
                onChange={(next) => {
                  setInstances(next);
                  setPlan(null);
                }}
              />
            </section>
          </aside>
        </div>

        <DialogFooter
          meta={
            <MetaLine
              tone="faint"
              items={[
                workflow.label,
                blockedReason ?? (plan === null ? undefined : `${String(plan.planned.length)} to create`),
              ].filter((item): item is string => item !== undefined)}
            />
          }
        >
          <Button variant="secondary" onClick={() => closeAndReset(false)}>
            Cancel
          </Button>
          {stage === "plan" && plan !== null ? (
            <Button
              variant="primary"
              icon={<Play aria-hidden className={dsIcon.md} />}
              loading={busy}
              disabled={busy || applied || plan.planned.length === 0}
              onClick={() => void confirmStart()}
            >
              {plan.dryRun ? "Start dry run" : "Start run"}
            </Button>
          ) : (
            <Button
              variant="primary"
              loading={busy}
              disabled={busy || blockedReason !== null}
              onClick={() => void submitPlan()}
            >
              Plan the run
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The launcher plus the dialog, mounted at the shell's ROOT rather than inside
 * the queue toolbar — "reachable from anywhere" has to stay true on surfaces
 * that draw no toolbar.
 */
export function RunStartSurfaces({
  open,
  onOpenChange,
  workflow,
  actorId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflow: RunStartWorkflow;
  actorId: string;
}) {
  return <RunStartDialog open={open} onOpenChange={onOpenChange} workflow={workflow} actorId={actorId} />;
}
