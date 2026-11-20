import { Info, TriangleAlert } from "lucide-react";
import { useState } from "react";
import type { z } from "zod";
import { cn } from "../../../lib/utils.js";
import { classifyRunShape } from "./run-identity-model.js";
import {
  BulletList,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  Field,
  IconButton,
  Input,
  KeyValueList,
  MetaLine,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Well,
  dsIcon,
  dsText,
} from "../../../ds/ui.js";
import type { ActionDescriptorWire } from "../../../../models/dashboard/actions.js";
import {
  isTerminalQueueStatus,
  type QueueSurfaceWireSchema,
} from "../../../../models/dashboard/projection.js";
import { renameDraftProblem } from "./rename-draft.js";
import { DryRunMark } from "../run-state-chips.js";
import type { ActionTarget } from "../../shared/actions/actions.js";
import { runTiming } from "../../shared/status/format.js";
import { testInstanceHazardTitle, testInstanceSystems } from "../../shared/status/test-instance-hazard.js";

export type QueueSurfaceWire = z.infer<typeof QueueSurfaceWireSchema>;

/** the fingerprint cut for the eye lives in `run-identity-model.ts` — see the note there */

/** The run's provenance, in the Log Panel's bottom bar. The two hazards stay VISIBLE */
export function RunProvenanceBar({
  surface,
  workflowLabel,
  currentAppVersion,
  servedDescriptorHash,
}: {
  surface: QueueSurfaceWire;
  workflowLabel: string;
  currentAppVersion: string;
  /** The fingerprint THIS RUN'S OWN WORKFLOW is served under today, or
 * `undefined` when this build registers no such workflow (§9.22 item 3). */
  servedDescriptorHash: string | undefined;
}) {
  const testSystems = testInstanceSystems(surface.resolvedInstances);
  const shape = classifyRunShape(surface.descriptorHash, servedDescriptorHash);
  const shapeMoved = shape.state !== "current";
  /** the build the RUN was enqueued */
  const ranAppVersion = surface.appVersion.state === "present"
    ? surface.appVersion.value
    : undefined;
  const staleApp = ranAppVersion !== undefined && ranAppVersion !== currentAppVersion;

  return (
    <span className="flex min-w-0 shrink-0 items-center gap-[var(--ds-space-snug)]">
      <span
        title={
          shape.state === "moved" ? "This run used an older version of the workflow."
            : shape.state === "unserved" ? "This workflow is no longer available to run."
              : undefined
        }
        className={cn(
          dsText.meta,
          dsText.nums,
          "shrink-0",
          shapeMoved ? "text-[color:var(--ds-status-waiting-fg)]" : "text-[color:var(--ds-fg-muted)]",
        )}
      >
        {shapeMoved ? "Older version" : null}
      </span>

      {/* Hazards, never disclosed. */}
      {/* Rehearsal meaning keeps the same distinct hue in the identity bar and queue. */}
      {surface.dryRun && <DryRunMark />}
      {testSystems.length > 0 && (
        <span
          title={testInstanceHazardTitle(testSystems)}
          className={cn(
            dsText.meta,
            "inline-flex shrink-0 items-center gap-[var(--ds-space-tight)] text-[color:var(--ds-status-waiting-fg)]",
          )}
        >
          <TriangleAlert aria-hidden className={dsIcon.sm} />
          test
        </span>
      )}

      <Popover>
        <PopoverTrigger asChild>
          <IconButton size="xs" label="Run provenance" icon={<Info aria-hidden className={dsIcon.sm} />} />
        </PopoverTrigger>
        <PopoverContent title="Provenance" description={surface.traceId} width="lg" side="top" align="end">
          <div className="flex flex-col gap-[var(--ds-space-base)]">
            <KeyValueList
              items={[

                { key: "Workflow", value: shapeMoved ? `${workflowLabel} (older version)` : workflowLabel, tone: shapeMoved ? "warning" : "default" },
                {
                  key: "App build",
                  value: ranAppVersion ?? "unstamped",
                  tone: staleApp || ranAppVersion === undefined ? "warning" : "default",
                },
                { key: "Requested by", value: surface.actorId ?? "Not recorded" },
                /* Repeated priority and actor facts belong in disclosure, not identical chips on every row. */
                { key: "Priority", value: surface.priority === "interactive" ? "On" : "Off" },
                /* Keep the operator name beside run identity so renaming never obscures the subject. */
                ...(surface.displayName.state === "present"
                  ? [{ key: "Named", value: surface.displayName.value }]
                  : []),

                ...surface.resolvedInstances.map(({ system, instance }) => ({
                  key: system,
                  value: instance,
                  tone: instance === "test" ? ("warning" as const) : ("default" as const),
                })),
              ]}
            />
            <BulletList
              items={[
                surface.priority === "bulk"
                  ? "Priority is off: this run waits for runs with Priority on."
                  : "Priority is on: this run goes ahead of runs without it.",
                ...(shape.state === "moved" ? ["This run used an older version of the workflow, so it cannot be retried."]
                  : shape.state === "unserved" ? [`${workflowLabel} is no longer available, so this run cannot be retried.`] : []),
                ...(staleApp ? [`Ran on app ${ranAppVersion}; this dashboard is ${currentAppVersion}.`] : []),
                /* Rename changes no identity facts; explain it only on named runs. */
                ...(surface.displayName.state === "present"
                  ? [`Named by you. The subject is still ${surface.title}.`]
                  : []),
              ]}
            />
          </div>
        </PopoverContent>
      </Popover>
    </span>
  );
}

/* ── rename ──────────────────────────────────────────────────────────────── */

/** Carry the projected surface and shared clock into rename; do not reconstruct its identity separately. */
export interface PendingRename {
  action: Extract<ActionDescriptorWire, { kind: "command" }>;
  target: ActionTarget;
  surface: QueueSurfaceWire;
  nowIso: string;
  source?: "queue" | "run-detail" | undefined;
  commandId?: string | undefined;
  requestedAt?: string | undefined;
  triggerElement?: HTMLElement | null | undefined;
}

/** Use a modal so virtualized row unmounts cannot lose name drafts or hide validation. */
export function RenameRunDialog({
  pending,
  onCancel,
  onConfirm,
}: {
  pending: PendingRename | null;
  onCancel: () => void;
  onConfirm: (pending: PendingRename, name: string) => void;
}) {
  return (
    <Dialog open={Boolean(pending)} onOpenChange={(open) => !open && onCancel()}>
      {pending && (
        <RenameDialogBody
          // Remount per run so one row’s unfinished name cannot be offered for another.
          key={String(pending.surface.runId)}
          pending={pending}
          onCancel={onCancel}
          onConfirm={onConfirm}
        />
      )}
    </Dialog>
  );
}

function RenameDialogBody({
  pending,
  onCancel,
  onConfirm,
}: {
  pending: PendingRename;
  onCancel: () => void;
  onConfirm: (pending: PendingRename, name: string) => void;
}) {
  const surface = pending.surface;
  const named = surface.displayName.state === "present";
  const [name, setName] = useState(named && surface.displayName.state === "present" ? surface.displayName.value : "");
  const [attempted, setAttempted] = useState(false);
  const [ruleOpen, setRuleOpen] = useState(false);
  /* Show the shared rename refusal at the field and Enter path; never silently ignore invalid submission. */
  const problem = renameDraftProblem(name);
  const timing = runTiming(surface, pending.nowIso, isTerminalQueueStatus);

  const submit = (): void => {
    setAttempted(true);
    if (problem !== undefined) return;
    onConfirm(pending, name.trim());
  };

  return (
    <DialogContent
      size="sm"
      title={named ? "Rename this run" : "Name this run"}
      onCloseAutoFocus={(e) => {
        if (pending.triggerElement?.isConnected) {
          e.preventDefault();
          pending.triggerElement.focus();
        }
      }}
    >
      <DialogBody className="flex flex-col gap-[var(--ds-space-snug)]">
        <Field
          label={
            <span className="flex items-center gap-[var(--ds-space-tight)]">
              Name
              {/* Dialog disclosures stay inside the dialog; lower portal layers would hide the opened content. */}
              <IconButton
                size="xs"
                label="What a name does"
                aria-expanded={ruleOpen}
                onClick={() => setRuleOpen((open) => !open)}
                icon={<Info aria-hidden className={dsIcon.sm} />}
              />
            </span>
          }
          // Show validation after attempted submission, not during the first typed character.
          error={attempted ? problem ?? null : null}
        >
          <Input
            value={name}
            autoFocus
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
            }}
            /* The wire guarantees a title; invalid authority must refuse, never substitute a fixture name. */
            placeholder={surface.title}
          />
        </Field>
        {ruleOpen && (
          <Well>
            <BulletList
              items={[
                "It appears on the queue row and in the Run Panel.",
                "The subject, the trace id and the run number are untouched, so everything in history still matches.",
                "It is yours — nothing downstream reads it.",
              ]}
            />
          </Well>
        )}
      </DialogBody>

      {/* Show only served ordinals; schema-old runs must not receive an invented sequence number. */}
      <DialogFooter
        meta={
          <MetaLine
            tone="faint"
            items={[
              `subject ${surface.title}`,
              surface.traceId,
              surface.runNumber.state === "present" ? `#${String(surface.runNumber.value)}` : false,
              timing?.text ?? false,
            ]}
          />
        }
      >
        <Button variant="muted" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" disabled={problem !== undefined} title={problem} onClick={submit}>
          Save the name
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
