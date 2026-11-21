import { Info } from "lucide-react";
import { useState } from "react";
import type { z } from "zod";
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
  MetaLine,
  Well,
  dsIcon,
} from "../../../ds/ui.js";
import type { ActionDescriptorWire } from "../../../../models/dashboard/actions.js";
import {
  isTerminalQueueStatus,
  type QueueSurfaceWireSchema,
} from "../../../../models/dashboard/projection.js";
import { renameDraftProblem } from "./rename-draft.js";
import type { ActionTarget } from "../../shared/actions/actions.js";
import { runTiming } from "../../shared/status/format.js";

export type QueueSurfaceWire = z.infer<typeof QueueSurfaceWireSchema>;

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
                "The subject and history are unchanged.",
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
