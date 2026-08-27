/**
 * Ported from legacy hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc,
 * src/dashboard/components/dev/rebuild-demo/DemoRunIdentity.tsx
 *
 * WHICH RUN IS THIS, exactly — the run's PROVENANCE, in the Log Panel's bottom
 * bar, with the run HAZARD beside it and everything else behind its ⓘ: who
 * asked for this run, under which app build, against which system instance.
 * Every one of these is a served field; none is inferred.
 *
 * 1i adaptations against the demo (all rule-(c) omissions of fixture-only
 * data, recorded in the port report):
 *  - the workflow version tag renders the served DESCRIPTOR fingerprint
 *    short-prefix (the wire's name for the run's shape) instead of the demo's
 *    fixture `v3.1` pair; "shape moved" compares it against the bootstrap's
 *    current descriptor hash — same hazard, same tone, real fact;
 *  - `RunSelector` (the `‹ #2 of 2 ›` attempt lineage strip with rerun diff)
 *    is not ported: the wire serves only the attempt ordinal — the demo
 *    itself renders nothing without at least two lineage attempts;
 *  - the `preset` block still defers: no descriptor in this tree declares a
 *    preset, so there is nothing for the chain to carry
 *    (`docs/findings/queue-rows.md`).
 *
 * TWO OF THOSE DEFERRALS CLOSED (D232/D233, 2026-08-19), and one of them had
 * gone stale rather than merely waiting:
 *  - the `dry run` chip IS drawn. Its deferral said *"the 1g queue wire serves
 *    no dry-run flag"*, which stopped being true when `QueueBaseFields.dryRun`
 *    landed. The demo's own rule is stated three paragraphs down and this file
 *    was quoting it while implementing half of it: **the two hazards stay
 *    visible**, and only `test` was on screen;
 *  - `RenameRunDialog` and the `Priority` row land together, because a rename
 *    is the one thing on this bar an operator changes.
 */
import { FlaskConical, Info, TriangleAlert } from "lucide-react";
import { useState } from "react";
import type { z } from "zod";
import { cn } from "../lib/utils.js";
import { classifyRunShape, shortFingerprint } from "./run-identity-model.js";
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
} from "../ds/ui.js";
import type { ActionDescriptorWire } from "../../domain/dashboard/actions.js";
import {
  isTerminalQueueStatus,
  type QueueSurfaceWireSchema,
} from "../../domain/dashboard/projection.js";
import { renameDraftProblem } from "../app/rename-draft.js";
import type { ActionTarget } from "./actions.js";
import { runTiming } from "./format.js";
import { testInstanceHazardTitle, testInstanceSystems } from "./test-instance-hazard.js";

export type QueueSurfaceWire = z.infer<typeof QueueSurfaceWireSchema>;

/* the fingerprint cut for the eye lives in `run-identity-model.ts` — see the note there */

/**
 * The run's provenance, in the Log Panel's bottom bar.
 *
 * The two hazards stay VISIBLE: a moved run shape and a test instance are
 * outcomes about this run, not teaching, so they are never behind the
 * disclosure — a rehearsal that reads as a filing is the single most expensive
 * misread this product can produce.
 */
export function RunProvenanceBar({
  surface,
  workflowLabel,
  currentAppVersion,
  servedDescriptorHash,
}: {
  surface: QueueSurfaceWire;
  workflowLabel: string;
  currentAppVersion: string;
  /**
   * The fingerprint THIS RUN'S OWN WORKFLOW is served under today, or
   * `undefined` when this build registers no such workflow (§9.22 item 3).
   *
   * It used to be the bootstrap's whole-descriptor-SET hash, which a
   * one-workflow fingerprint can never equal — so the hazard below was on for
   * every run ever drawn.
   */
  servedDescriptorHash: string | undefined;
}) {
  const testSystems = testInstanceSystems(surface.resolvedInstances);
  const ranShape = shortFingerprint(surface.descriptorHash);
  const shape = classifyRunShape(surface.descriptorHash, servedDescriptorHash);
  const shapeMoved = shape.state !== "current";
  /**
   * D179: the row now carries the build the RUN was enqueued under, so this
   * comparison can finally fire. Before D179 the projection stamped the
   * serving build here and `staleApp` was structurally always false — the
   * warning existed but could never appear.
   */
  const ranAppVersion = surface.appVersion.state === "present"
    ? surface.appVersion.value
    : undefined;
  const staleApp = ranAppVersion !== undefined && ranAppVersion !== currentAppVersion;

  return (
    <span className="flex min-w-0 shrink-0 items-center gap-[var(--ds-space-snug)]">
      <span
        title={
          shape.state === "moved"
            ? `Ran under ${workflowLabel} shape ${ranShape}; ${workflowLabel} runs are served by ${shortFingerprint(shape.servedShape)} now. The run's SHAPE moved, so these are not comparable — a retry would replay retired code.`
            : shape.state === "unserved"
              ? `Ran under ${workflowLabel} shape ${ranShape}; this dashboard serves no ${workflowLabel} descriptor at all, so there is nothing to compare it with — and nothing for a retry to run.`
              : `${workflowLabel} ${ranShape} — the descriptor currently serving ${workflowLabel} runs.`
        }
        className={cn(
          dsText.meta,
          dsText.nums,
          "shrink-0",
          shapeMoved ? "text-[color:var(--ds-status-waiting-fg)]" : "text-[color:var(--ds-fg-muted)]",
        )}
      >
        {/*
          THE BARE TAG, in the demo's own slot (D273 item 1, ledger 2 row A3 —
          `DemoRunIdentity.tsx:88,107` prints `v3.1` with no noun in front of
          it). The `wf ` this replaces was a rebuild addition nothing recorded,
          and the fact it labelled is named in full two elements to the right:
          the ⓘ's `Workflow` row spells `<workflow> <shape>`, and the `title`
          on this span says which descriptor the string belongs to. A noun on
          the bar was a third place to say it.
        */}
        {ranShape}
      </span>

      {/* Hazards, never disclosed. */}
      {/*
        A REHEARSAL, in the demo's own slot and words (`DemoRunIdentity.tsx:111`)
        — and in D232's rehearsal hue rather than the demo's `info`, because
        `info` is what the `test` chip beside it is drawn in on the queue row,
        and one fact must not have two colours in one product. The hue was
        bought for this MEANING; the bar and the row draw the same meaning.
      */}
      {surface.dryRun && (
        <span
          title="A rehearsal: it read every system and wrote to none. The receipt says what it WOULD have written."
          className={cn(
            dsText.meta,
            "inline-flex shrink-0 items-center gap-[var(--ds-space-tight)] text-[color:var(--ds-rehearsal-fg)]",
          )}
        >
          <FlaskConical aria-hidden className={dsIcon.sm} />
          dry run
        </span>
      )}
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
                /*
                  `<label> <shape>`, the demo's own separator (D273 item 1,
                  ledger 2 row A13 — `DemoRunIdentity.tsx:141` prints
                  `${label} ${ranVersion}`). The middot this replaces read as
                  two facts where the demo draws one qualified name.
                */
                { key: "Workflow", value: `${workflowLabel} ${ranShape}`, tone: shapeMoved ? "warning" : "default" },
                {
                  key: "App build",
                  value: ranAppVersion ?? "unstamped",
                  tone: staleApp || ranAppVersion === undefined ? "warning" : "default",
                },
                { key: "Requested by", value: surface.actorId },
                /*
                  PRIORITY, in the ⓘ rather than as a chip — the demo's own
                  disposition, in its own words: *"`by` and `priority` are the
                  same two words on every row an operator starts on their own
                  machine, so they cost a chip each to say nothing — they moved
                  into the ⓘ, in full, with the reason each matters."* The
                  reason is the bullet below; this is the value.
                */
                { key: "Priority", value: surface.priority },
                /*
                  The operator's own name, stated where the run's identity is.
                  It is the row's TITLE elsewhere, which is exactly why it
                  belongs here too: the bar is where you check that the thing
                  you renamed is still the thing you think it is.
                */
                ...(surface.displayName.state === "present"
                  ? [{ key: "Named", value: surface.displayName.value }]
                  : []),
                /*
                  `Config` AND `Attempt` ARE GONE (D273 item 1, ledger 2 rows
                  A18/A19). Both were real served facts and neither was
                  provenance the operator ACTS on, which is the whole basis on
                  which the demo trimmed this popover — and `Attempt` was worse
                  than redundant: R5 f.2 deleted the header's `attempt N` badge
                  on the argument that the attempt affordance belongs to the
                  rail's attempts section, and putting the same fact back three
                  lines lower undoes that deletion while leaving its reasoning
                  in place. `configFingerprint` remains on the wire and remains
                  the archive key's other half; nothing here needed to say so.
                */
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
                  ? "Bulk yields the worker to anything interactive — a 50-person packet must never make one urgent separation wait."
                  : "Interactive takes a worker ahead of bulk work.",
                shape.state === "moved"
                  ? `This run's SHAPE is a prior descriptor. It is not comparable with a ${shortFingerprint(shape.servedShape)} run, and a retry would replay retired code.`
                  : shape.state === "unserved"
                    ? `This build registers no ${workflowLabel} descriptor, so this run's shape cannot be compared with a current one — and this run cannot be retried here.`
                    : "The descriptor fingerprint is the run's shape; a row served under the same fingerprint is the same run shape.",
                ranAppVersion === undefined
                  ? `${surface.appVersion.state === "absent" ? surface.appVersion.reason : ""} — the app build is the other half of the archive key, so this run can only be told apart from a current one by its descriptor.`
                  : staleApp
                    ? `Ran under app ${ranAppVersion}; this dashboard is ${currentAppVersion}. The app build is the other half of the archive key.`
                    : `Ran under the app build this dashboard is running (${currentAppVersion}), which is why it is stated once on the Sessions bar rather than on every run.`,
                /*
                  The rename's whole safety argument, stated on the run it was
                  applied to: a name replaces nothing. It is drawn only for a
                  named run because it is an answer to "why does this row say
                  something I typed", and a run nobody named never raises it.
                */
                ...(surface.displayName.state === "present"
                  ? [`Named by you. The subject is still ${surface.title} and the trace id ${surface.traceId} is unchanged — history matches either way.`]
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

/**
 * The run whose name is being edited, and the descriptor that authorised it.
 *
 * The whole SURFACE rides along rather than five copied fields: the dialog's
 * footer states the run's identity (subject, trace, `#N`, elapsed) and that is
 * precisely the set that must not be re-derived anywhere else. `nowIso` is the
 * bootstrap-calibrated instant the row's own elapsed is measured against, so
 * the dialog and the row it opened from cannot disagree by a second.
 */
export interface PendingRename {
  action: Extract<ActionDescriptorWire, { kind: "command" }>;
  target: ActionTarget;
  surface: QueueSurfaceWire;
  nowIso: string;
}

/**
 * Ported from the demo's `RenameRunDialog` (`DemoRunIdentity.tsx:320`).
 *
 * Naming a run does not touch its identity: the subject, the trace id and the
 * `#N` ordinal all stay exactly as they were. That is the whole reason a rename
 * is safe to offer on a row that has already written to UCPath, and it is why
 * the footer prints those three facts UNDER the field — the operator can see
 * that the things which identify this run are not what they are editing.
 */
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
          // The dialog is REMOUNTED per run: `key` on the body is what discards
          // a half-typed name when the operator closes this and opens the
          // rename on a different row. Without it the field's state would
          // survive and offer one run's draft name for another run.
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
  /*
   * THE SAME RULE THE COMPOSER APPLIES (`rename-draft.ts`), stated at the field
   * the value is typed into. `composeCommandRequest` calls it again as a
   * backstop — a refusal that reaches the composer is a surface bug, and the
   * operator should never be the one to discover a bound.
   *
   * D273 item 1 RULED THIS IN (ledger 2 rows A35/A37/A47): the demo's rename has
   * no error affordance and disables its primary on `!trimmed` alone, and option
   * C — port that too — was rejected because it *"may hide why a valid-looking
   * rename cannot be sent."* So the visible refusal, the Enter arm that reports
   * rather than silently ignores, and the `title` on the disabled primary all
   * stay, as the sheet's named accessibility/safety exception rather than as
   * unrecorded drift.
   */
  const problem = renameDraftProblem(name);
  const timing = runTiming(surface, pending.nowIso, isTerminalQueueStatus);

  const submit = (): void => {
    setAttempted(true);
    if (problem !== undefined) return;
    onConfirm(pending, name.trim());
  };

  return (
    <DialogContent size="sm" title={named ? "Rename this run" : "Name this run"}>
      <DialogBody className="flex flex-col gap-[var(--ds-space-snug)]">
        <Field
          label={
            <span className="flex items-center gap-[var(--ds-space-tight)]">
              Name
              {/*
                WHAT A NAME DOES, one press away. It is a rule of the PRODUCT,
                true of every rename, so drawing it in full every time the
                dialog opens is three lines nobody asked for on the tenth
                rename — and deleting it loses the one sentence that makes a
                rename obviously safe.

                It is NOT a `Popover`, for the reason the demo records: a
                Popover portals BELOW a Dialog, so it opens in the
                accessibility tree and nowhere on screen. Anything disclosed
                from inside a dialog is disclosed inside the dialog.
              */}
              <IconButton
                size="xs"
                label="What a name does"
                aria-expanded={ruleOpen}
                onClick={() => setRuleOpen((open) => !open)}
                icon={<Info aria-hidden className={dsIcon.sm} />}
              />
            </span>
          }
          // Shown only after a send was attempted: a field that turns red while
          // somebody is still typing their first character is reporting an
          // empty box as an error.
          error={attempted ? problem ?? null : null}
        >
          <Input
            value={name}
            autoFocus
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
            }}
            /*
              THE SUBJECT ITSELF, with no fallback behind it (D273 item 1,
              ledger 2 rows A38/A41). The demo writes
              `row.title || "Friday exception pack"` here and `row.title || "—"`
              in the footer, and BOTH arms are unreachable on this wire:
              `QueueSurfaceWireSchema.title` is `z.string().min(1)`
              (`src/domain/dashboard/projection.ts:351`), so a blank title
              cannot be parsed, let alone rendered. Restoring the strings would
              add two branches that can never be taken, and an unreachable
              fallback is exactly the "plausible-but-wrong value" this tree's
              fail-loud rule bans: if a title were ever empty the right outcome
              is the schema's refusal, not a fixture's packet name in a
              placeholder.
            */
            placeholder={surface.title}
          />
        </Field>
        {ruleOpen && (
          <Well>
            <BulletList
              items={[
                "It rides the queue row and the receipt.",
                "The subject, the trace id and the run number are untouched, so everything in history still matches.",
                "It is yours — nothing downstream reads it.",
              ]}
            />
          </Well>
        )}
      </DialogBody>

      {/*
        THE HOUSE FOOTER: `meta (quiet, left) · Cancel · [primary]`.

        `Cancel` and not "Keep the name it has": at that length the two buttons
        read as two peers rather than as a dismissal and a commit, and on a
        surface with exactly two exits an unmistakable primary is the whole job
        of the footer.

        The meta line is the run's IDENTITY — the facts a rename does not
        touch. `#N` is drawn only when the server served one: a run enqueued
        before schema v15 has no ordinal, and the footer of all places must not
        invent one (D230).
      */}
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
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" disabled={problem !== undefined} title={problem} onClick={submit}>
          Save the name
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
