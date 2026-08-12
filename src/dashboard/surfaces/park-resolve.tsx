/**
 * Ported from legacy hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc,
 * src/dashboard/components/dev/rebuild-demo/DemoParkResolve.tsx
 * (`ParkResolveDialog` and `SettlingPanel`).
 *
 * THE TWO TYPED EXITS FROM `Write parked` (doc 09 §4.1, row-model D20).
 *
 * `Write parked` means one thing: a write was attempted against a real HR
 * system and nobody can tell whether it landed. There is no Resume and no
 * Retry — the kernel refuses generic retry for this lifecycle BY NAME, because
 * resuming an unknown write is how a person gets terminated twice. There are
 * exactly two answers and both are the operator reporting what they SAW.
 *
 * WHAT THIS SURFACE MAY SAY. Every fact on it is a field the server served on
 * the `parked-write` section, rendered verbatim: this file composes no sentence
 * about the park itself, because `parkedMessage` is the KERNEL's own sentence
 * (doc 09 §4's `park()` interpolates a driver error or a probe's reason into
 * it) and a second, friendlier paraphrase beside it would be this surface
 * guessing at what happened to a live transaction.
 *
 * THREE THINGS THE DEMO DREW THAT THIS ONE DOES NOT, and why each absence is
 * the honest rendering rather than a porting shortfall:
 *
 *  - **The settle fence** (`fence clears at …`, "twice, at least 10 minutes
 *    apart"). Doc 09's `recoveryAbsence` is `operator-only` for every contract
 *    but the one live-measured Kuali write; the wire serves no fence window and
 *    a `minSinceFenceMs` invented here is exactly the banned constant.
 *  - **`SettlingPanel`** — the negative-settlement wait state. D198 is explicit
 *    that `createWriteRecovery` writes NOTHING on `wait`, so no durable row
 *    carries an observation count or a `nextProbeAt`. The panel is therefore
 *    ported in the only form the wire supports: it renders when the section
 *    carries settling data, and the section carries none, so it is ABSENT. It
 *    is not stubbed and it is not faked.
 *  - **The proof entry for `resolve-write-present`.** See `ProofUnserved`.
 */
import { useEffect, useState } from "react";
import { CircleSlash, PauseCircle } from "lucide-react";
import type { z } from "zod";
import { systemClock } from "../../domain/clock.js";
import { cn } from "../lib/utils.js";
import {
  Button,
  Chip,
  ChipRow,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  Field,
  MetaLine,
  Refusal,
  SectionLabel,
  StatusPill,
  Textarea,
  Well,
  dsIcon,
  dsMotion,
  dsRadius,
  dsText,
  useDsEnterTransition,
} from "../ds/ui.js";
import type { RunDetailSectionResponseSchema } from "../../domain/dashboard/run-detail.js";
import type { ActionDescriptorWire } from "../../domain/dashboard/actions.js";
import { useDashboardClient } from "../state/client-context.js";
import { BannerActions, type DashboardActionHandler } from "./actions.js";
import { fmtClock } from "./format.js";

type RunDetailSectionResponse = z.infer<typeof RunDetailSectionResponseSchema>;
export type ParkedWritePayload = Extract<
  RunDetailSectionResponse,
  { section: "parked-write" }
>["payload"];

/** The command half of a served descriptor — the only kind this surface takes. */
type CommandAction = Extract<ActionDescriptorWire, { kind: "command" }>;

/** Which typed resolution a descriptor names. Nothing else may open this dialog. */
export function parkResolutionArm(action: ActionDescriptorWire): "present" | "absent" | undefined {
  if (action.kind !== "command") return undefined;
  if (action.command === "resolve-write-present") return "present";
  if (action.command === "resolve-write-absent") return "absent";
  return undefined;
}

/**
 * The digest, cut for the eye and never for the record.
 *
 * The permanent write key EMBEDS the subject's identifier, which is why the
 * wire serves only its digest (doc 09). Sixty-four hex characters wrap to three
 * lines in a 376px rail and carry no more meaning than their head does, so the
 * head is what is printed — and the whole value stays on the element's `title`,
 * because the operator's job here is to compare it against what a second
 * surface says, not to memorise it.
 */
function shortDigest(digest: string): string {
  return `${digest.slice(0, 12)}…`;
}

/* ── the parked fact, in the stream where it happened ────────────────────── */

/**
 * WHO the fenced write was bound to. Every arm of `SubjectEvidence` is already
 * display-safe by construction — a bounded suffix, a branded artifact id, or a
 * closed catalog key beside a digest — so this renders the served members and
 * re-shapes none of them (doc 13 §3.4).
 */
function SubjectFacts({ subject }: { subject: ParkedWritePayload["subject"] }) {
  if (subject.state === "unscoped") {
    return (
      <ChipRow>
        <Chip label="subject">unscoped</Chip>
        <Chip label="reviewed">{subject.reviewedReasonId}</Chip>
        <Chip label="proof">{subject.proofId}</Chip>
        <Chip label="observed">{fmtClock(subject.observedAt)}</Chip>
      </ChipRow>
    );
  }
  const { evidence } = subject;
  return (
    <ChipRow>
      {evidence.kind === "person" && (
        <Chip label={evidence.identifierKind}>{evidence.displaySuffix}</Chip>
      )}
      {evidence.kind === "artifact" && <Chip label="artifact">{evidence.artifactId}</Chip>}
      {evidence.kind === "catalog" && <Chip label="catalog">{evidence.catalogKey}</Chip>}
      <Chip label="binding" title={evidence.bindingDigest}>
        {shortDigest(evidence.bindingDigest)}
      </Chip>
      <Chip label="proof">{subject.proofId}</Chip>
      <Chip label="observed">{fmtClock(subject.observedAt)}</Chip>
    </ChipRow>
  );
}

/**
 * THE PARKED WRITE, rendered where the run stopped.
 *
 * Same geometry as `InlineDecision` and `InlineFailureRecord` — indented to the
 * stream's hanging indent, a rail in its own tone — because DESIGN.md names
 * `Write parked` as one of exactly two decision surfaces, and a decision's full
 * surface renders INLINE in the stream at the line that produced it, never as a
 * band stacked above the stream the panel is opened to read.
 *
 * The tone is the status's own: amber, and the only DASHED hairline in the
 * product. Nothing else dashes, which is what says "a write is in doubt" at a
 * glance without spending a hue nobody else may have.
 */
export function InlineParkedWrite({
  parked,
  onResolve,
  anchorRef,
}: {
  parked: ParkedWritePayload;
  onResolve: DashboardActionHandler;
  anchorRef?: (node: HTMLElement | null) => void;
}) {
  return (
    <div
      ref={anchorRef}
      tabIndex={-1}
      data-panel-parked-write=""
      aria-label="Parked write"
      className={cn(
        "mx-[var(--ds-space-cozy)] my-[var(--ds-space-base)] ml-5 border p-[var(--ds-space-cozy)]",
        dsRadius.lg,
        "border-[length:var(--ds-border-w-rail)]",
        // `ds-dashed` is the status's own edge treatment, taken from the same
        // token set `StatusPill status="parked"` paints itself with.
        "ds-dashed border-[color:var(--ds-status-parked-border)] bg-[var(--ds-status-parked-bg)]",
      )}
    >
      <div className="flex flex-wrap items-center gap-[var(--ds-space-snug)]">
        <PauseCircle
          aria-hidden
          className={cn(dsIcon.md, "shrink-0 text-[color:var(--ds-status-parked-fg)]")}
        />
        {/* The status word comes from the ONE renderer that owns it. */}
        <StatusPill status="parked" size="sm" />
        <span className={cn(dsText.meta, dsText.nums, "text-[color:var(--ds-fg-muted)]")}>
          {parked.system} · {parked.taskId}
        </span>
      </div>

      <div className="mt-[var(--ds-space-base)] flex flex-col gap-[var(--ds-space-base)] pl-5">
        {/* The kernel's own sentence, verbatim. */}
        <span className={cn(dsText.body, "min-w-0 break-words text-[color:var(--ds-fg)]")}>
          {parked.parkedMessage}
        </span>

        <MetaLine
          items={[
            `fenced ${fmtClock(parked.fencedAt)}`,
            `parked ${fmtClock(parked.parkedAt)}`,
            `code ${parked.parkedCode}`,
            `generation ${String(parked.generation)}`,
            `attempt ${String(parked.runAttempt)}`,
          ]}
        />

        <section className="flex flex-col gap-[var(--ds-space-snug)]">
          <SectionLabel>Bound to</SectionLabel>
          <SubjectFacts subject={parked.subject} />
        </section>

        {/*
          The two resolutions, from the SERVED descriptors and nothing else —
          the same `banner` placement filter every other surface uses. A third
          exit does not exist in doc 09 and cannot be invented here, because
          there is no descriptor to render it from.
        */}
        <BannerActions
          actions={parked.actions}
          target={{ runId: parked.runId, expectedVersion: parkedExpectedVersion(parked) }}
          onAction={onResolve}
        />
      </div>
    </div>
  );
}

/**
 * The run version both resolutions CAS against, taken off the descriptors the
 * server projected them at rather than off a second fetch — doc 13 §8.5's whole
 * point is that a control carries the revision it was described at.
 */
function parkedExpectedVersion(parked: ParkedWritePayload): number {
  const first = parked.actions[0];
  if (first === undefined || first.kind !== "command") {
    throw new Error(
      `parked-write section for run ${parked.runId} served no command descriptor; `
      + "the schema requires at least one and every one of them is intent-scoped",
    );
  }
  return first.expectedVersion;
}

/* ── the resolution dialog ───────────────────────────────────────────────── */

/**
 * `resolve-write-present` CANNOT BE SENT FROM ANY SURFACE IN THIS BUILD, and
 * this says so rather than drawing a control that quietly does nothing.
 *
 * The kernel's payload is `{ proof: SchemaBoundCanonicalValue, evidenceNote }`,
 * and `createWriteResolutionExecutor.resolvePresent` refuses any proof whose
 * `schemaHash` is not the commit contract's own
 * (`deriveSchemaHash(node.commit.uses.writeSafety.completion.proofSchema)`).
 * The `parked-write` wire serves no proof schema identity and no proof shape,
 * so a client can compose neither half — and minting a plausible `schemaHash`
 * to make the button clickable is precisely the fabricated-constant failure
 * this program exists to refuse.
 *
 * It is drawn DISABLED WITH ITS REASON rather than hidden: DESIGN.md's rule for
 * an option that exists in the target system but is not wired, because hiding
 * it teaches the operator the product has never heard of it. The refusal names
 * the missing wire so the next slice has a code to search for.
 */
function ProofUnserved() {
  return (
    <Refusal
      title="This build cannot record a present write"
      code="proof-contract-unserved"
      outcome="nothing was sent · the write is still parked and still fenced"
    >
      A confirmed-present resolution carries the transaction proof, parsed by the same schema the
      run&apos;s own completion would have parsed it with. The parked-write section serves no proof
      schema for this commit, so this surface has nothing to parse a proof against. Record the
      absence instead, or resolve this write from the CLI.
    </Refusal>
  );
}

/**
 * The server's refusal, ARRIVING.
 *
 * This is the one moment in the flow the operator is watching hardest — they
 * pressed a verb that settles a real HR write and this is the answer. An
 * element that simply exists on the next frame reads as a render fault, so it
 * comes from somewhere: the house `enter` pair, which is a TRANSITION off a
 * mounted state rather than a key-frame, so it is interruptible and so
 * `prefers-reduced-motion` removes it by zeroing both tokens at once — the
 * clock AND the travel. No reduced-motion branch, on purpose: zeroing only the
 * clock would still slide it 8px in one frame, which is a jump.
 *
 * The refusal is the LAST element in the dialog body, so nothing below it
 * moves; the standing `min-h` above keeps the block's own presence stable
 * rather than letting the body jump by a line.
 */
function RefusedNotice({ message }: { message: string }) {
  const entering = useDsEnterTransition();
  return (
    <Refusal
      title="Nothing was recorded"
      code="command-refused"
      outcome="the write is still parked · your answer below is untouched"
      className={cn(
        dsMotion.enter,
        "data-[demo-enter=from]:translate-y-[var(--ds-travel-md)] data-[demo-enter=from]:opacity-0",
      )}
      {...entering}
    >
      <span role="alert">{message}</span>
    </Refusal>
  );
}

/** What the operator's answer produced. `idle` reserves the space it will need. */
type Outcome =
  | { state: "idle" }
  | { state: "sending" }
  | { state: "refused"; message: string };

export interface ParkResolveTarget {
  readonly parked: ParkedWritePayload;
  readonly action: CommandAction;
}

/**
 * The dialog a served resolution opens. It is CONFIRM-FIRST in the literal
 * sense doc 13 §8.5 means: its title, its body and its commit verb are the
 * `confirm` block the SERVER authored, because only the server knows the
 * casualties of settling a real HR transaction one way or the other.
 *
 * NO OPTIMISTIC AUTHORITY. Pressing the verb sends the one command envelope and
 * then shows what came back. A `conflict` or a `rejected` keeps the dialog, keeps
 * every character the operator typed, and prints the SERVER's own sentence — the
 * row itself does not move until the projection says it moved.
 */
export function ParkResolveDialog({
  target,
  actorId,
  onClose,
  onResolved,
}: {
  target: ParkResolveTarget | null;
  actorId: string;
  onClose: () => void;
  /** An applied resolution moved the run — the owner refetches detail + sections. */
  onResolved: () => void;
}) {
  const client = useDashboardClient();
  const [evidenceNote, setEvidenceNote] = useState("");
  const [outcome, setOutcome] = useState<Outcome>({ state: "idle" });

  // A fresh open starts a fresh answer. A refusal does NOT — keeping what the
  // operator typed is the entire point of showing them the refusal.
  useEffect(() => {
    if (target === null) return;
    setEvidenceNote("");
    setOutcome({ state: "idle" });
  }, [target]);

  if (target === null) return null;
  const { parked, action } = target;
  const arm = parkResolutionArm(action);
  const confirm = action.confirm;
  if (arm === undefined || confirm === undefined || action.writeTarget === undefined) {
    // The wire's own `superRefine` pins all three, so reaching here means the
    // descriptor changed shape under a surface that was mid-flight on it.
    throw new Error(
      `action ${action.key} is not a doc 09 §4.1 write resolution with a confirm block and an intent target`,
    );
  }

  const note = evidenceNote.trim();
  // The kernel's own `OperatorReasonSchema` bound, stated where it is typed
  // rather than discovered from a rejection.
  const noteProblem = note.length === 0
    ? "Write what you checked — an empty note is not evidence."
    : note.length > 500
      ? `An evidence note is at most 500 characters; this one is ${String(note.length)}.`
      : undefined;
  const blocked = arm === "present"
    ? "This build serves no proof contract for this commit."
    : noteProblem;

  const { writeTarget } = action;
  const submit = (): void => {
    if (arm !== "absent" || blocked !== undefined) return;
    setOutcome({ state: "sending" });
    client.executeCommand({
      commandId: crypto.randomUUID(),
      requestedAt: systemClock.now().toISOString(),
      requestedBy: actorId,
      source: "run-detail",
      family: "run",
      type: "resolve-write-absent",
      target: {
        runId: parked.runId,
        expectedVersion: action.expectedVersion,
        writeIntentId: writeTarget.writeIntentId,
        intentGeneration: writeTarget.intentGeneration,
      },
      payload: { evidenceNote: note },
    }).then((result) => {
      // `conflict` and `rejected` are VALUES, not exceptions (doc 13 §3.4). The
      // server's sentence is printed verbatim: a stale generation is exactly
      // the state a second tab produces, and the server is the only party that
      // can say which generation is live now.
      if (result.state === "conflict" || result.state === "rejected") {
        setOutcome({ state: "refused", message: result.message });
        return;
      }
      onResolved();
      onClose();
    }, (caught: unknown) => {
      setOutcome({
        state: "refused",
        message: caught instanceof Error ? caught.message : String(caught),
      });
    });
  };

  const sending = outcome.state === "sending";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="md" title={confirm.title} description={confirm.body}>
        <DialogBody className="flex flex-col gap-[var(--ds-space-cozy)]">
          {/* The fence facts the resolution BINDS to — shown, never assumed. */}
          <Well className="flex flex-col gap-[var(--ds-space-snug)]">
            <ChipRow>
              <Chip label="system">{parked.system}</Chip>
              <Chip label="fenced">{fmtClock(parked.fencedAt)}</Chip>
              <Chip label="generation">{String(parked.generation)}</Chip>
              <Chip label="key" title={parked.idempotencyKeyDigest}>
                {shortDigest(parked.idempotencyKeyDigest)}
              </Chip>
            </ChipRow>
            <SubjectFacts subject={parked.subject} />
          </Well>

          {arm === "present" ? (
            <ProofUnserved />
          ) : (
            <Field
              label="What did you check, and what did you see?"
              description="The only record of why a retry was permitted to submit for real."
              error={outcome.state === "refused" ? null : (note.length > 500 ? noteProblem ?? null : null)}
              required
            >
              <Textarea
                rows={3}
                value={evidenceNote}
                disabled={sending}
                onChange={(event) => setEvidenceNote(event.target.value)}
                placeholder="Job Data and Person Org Summary for this EID — no termination row of any effective date; last action is the 2024 hire."
              />
            </Field>
          )}

          {/*
            RESERVED SPACE. The answer's slot exists before there is an answer,
            so a refusal does not shove the footer out from under a pointer that
            is already travelling toward it.
          */}
          <div className="min-h-[var(--ds-h-lg)]">
            {outcome.state === "refused" && <RefusedNotice message={outcome.message} />}
          </div>
        </DialogBody>

        <DialogFooter
          meta={`${parked.runId} · rev ${String(action.expectedVersion)} · generation ${String(writeTarget.intentGeneration)}`}
        >
          <Button variant="secondary" onClick={onClose} disabled={sending}>
            Not yet
          </Button>
          {/* `loading` rather than a swapped label: the primitive keeps the
              LABEL put and puts the spinner in the icon's slot, so the button
              never changes width under a pointer mid-click. */}
          <Button
            variant="danger"
            disabled={blocked !== undefined}
            loading={sending}
            title={blocked}
            icon={<CircleSlash aria-hidden className={dsIcon.md} />}
            onClick={submit}
          >
            {confirm.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
