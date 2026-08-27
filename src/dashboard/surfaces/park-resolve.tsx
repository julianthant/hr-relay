/**
 * Ported from legacy hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc,
 * src/dashboard/components/dev/rebuild-demo/DemoParkResolve.tsx
 * (`ParkResolveDialog` and `SettlingPanel`).
 *
 * THE TWO TYPED EXITS FROM `Write parked` (ref write-safety §4.1, row-model D20).
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
 * (ref write-safety §4's `park()` interpolates a driver error or a probe's reason into
 * it) and a second, friendlier paraphrase beside it would be this surface
 * guessing at what happened to a live transaction.
 *
 * TWO THINGS THE DEMO DREW THAT THIS ONE DOES NOT, and why each absence is
 * the honest rendering rather than a porting shortfall:
 *
 *  - **The settle fence** (`fence clears at …`, "twice, at least 10 minutes
 *    apart"). Ref write-safety's `recoveryAbsence` is `operator-only` for every contract
 *    but the one live-measured Kuali write; the wire serves no fence window and
 *    a `minSinceFenceMs` invented here is exactly the banned constant.
 *  - **`SettlingPanel`** — the negative-settlement wait state. D198 is explicit
 *    that `createWriteRecovery` writes NOTHING on `wait`, so no durable row
 *    carries an observation count or a `nextProbeAt`. The panel is therefore
 *    ported in the only form the wire supports: it renders when the section
 *    carries settling data, and the section carries none, so it is ABSENT. It
 *    is not stubbed and it is not faked.
 *
 * THE THIRD ABSENCE IS CLOSED (D245). `resolve-write-present` used to be
 * refused on this surface with `proof-contract-unserved`, because the wire
 * served neither the proof's schema hash nor its shape — and the copy told the
 * operator to resolve the write from a CLI that has never had a run-mutation
 * command. The section now serves the commit contract's proof as an ordered
 * field list, `ProofForm` renders it, and the composed value goes out bound to
 * the SERVED hash. Where a build genuinely cannot describe the proof, the
 * server says why and `ProofUnavailable` prints that reason.
 */
import { useEffect, useState } from "react";
import { CheckCircle2, CircleSlash, PauseCircle } from "lucide-react";
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
  Input,
  MetaLine,
  Refusal,
  SectionLabel,
  Select,
  StatusPill,
  Textarea,
  Well,
  dsIcon,
  dsRadius,
  dsText,
  useToasts,
} from "../ds/ui.js";
import { RefusedNotice } from "./refused-notice.js";
import type { Refused } from "./refused-notice-model.js";
import type { ProofFieldWire, RunDetailSectionResponseSchema } from "../../domain/dashboard/run-detail.js";
import {
  PROOF_BOOLEAN_OPTIONS,
  composeProofValue,
  initialProofDrafts,
  isOperatorSuppliedProofField,
  proofFieldHint,
  proofFieldLabel,
  proofFieldProblem,
} from "../app/proof-form.js";
import type { ActionDescriptorWire } from "../../domain/dashboard/actions.js";
import { parkResolutionArm } from "./park-resolve-model.js";
import { settleCommandResult } from "../app/command-result.js";
import { useDashboardClient } from "../state/client-context.js";
import { BannerActions, ParkResolutions, type DashboardActionHandler } from "./actions.js";
import { fmtClock } from "./format.js";

type RunDetailSectionResponse = z.infer<typeof RunDetailSectionResponseSchema>;
export type ParkedWritePayload = Extract<
  RunDetailSectionResponse,
  { section: "parked-write" }
>["payload"];

/** The command half of a served descriptor — the only kind this surface takes. */
type CommandAction = Extract<ActionDescriptorWire, { kind: "command" }>;

/* which resolution a served park command names lives in `park-resolve-model.ts` — see the note there */

/**
 * The digest, cut for the eye and never for the record.
 *
 * The permanent write key EMBEDS the subject's identifier, which is why the
 * wire serves only its digest (ref write-safety). Sixty-four hex characters wrap to three
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
 * re-shapes none of them (ref frontend-backend-integration §3.4).
 *
 * `inline` emits the chips with NO row of their own, for the dialog's fence
 * `Well`, which is one flex-wrap row of content-width chips (R8 finding 14). A
 * `ChipRow` nested in that row would be a grid box inside a flex line — its
 * equal-width columns fighting the wrap — so the caller that wants one row asks
 * for the chips, and the caller that wants a labelled block gets the grid.
 */
function SubjectFacts({ subject, inline }: { subject: ParkedWritePayload["subject"]; inline?: boolean }) {
  const chips = subject.state === "unscoped"
    ? (
        <>
          <Chip label="subject">unscoped</Chip>
          <Chip label="reviewed">{subject.reviewedReasonId}</Chip>
          <Chip label="proof">{subject.proofId}</Chip>
          <Chip label="observed">{fmtClock(subject.observedAt)}</Chip>
        </>
      )
    : (
        <>
          {subject.evidence.kind === "person" && (
            <Chip label={subject.evidence.identifierKind}>{subject.evidence.displaySuffix}</Chip>
          )}
          {subject.evidence.kind === "artifact" && <Chip label="artifact">{subject.evidence.artifactId}</Chip>}
          {subject.evidence.kind === "catalog" && <Chip label="catalog">{subject.evidence.catalogKey}</Chip>}
          <Chip label="binding" title={subject.evidence.bindingDigest}>
            {shortDigest(subject.evidence.bindingDigest)}
          </Chip>
          <Chip label="proof">{subject.proofId}</Chip>
          <Chip label="observed">{fmtClock(subject.observedAt)}</Chip>
        </>
      );
  return inline === true ? chips : <ChipRow>{chips}</ChipRow>;
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
          exit does not exist in ref write-safety and cannot be invented here, because
          there is no descriptor to render it from.

          `ParkResolutions` draws the two write resolutions as the demo's tinted
          cards, with the server's `detail` sentence on each (R8 finding 1);
          `BannerActions` draws whatever else the section banner carries and now
          filters the park pair out, so the same descriptor can never be drawn
          twice. Both take the same descriptor list and the same target.
        */}
        <BannerActions
          actions={parked.actions}
          target={{ runId: parked.runId, expectedVersion: parkedExpectedVersion(parked) }}
          onAction={onResolve}
        />
        <ParkResolutions
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
 * server projected them at rather than off a second fetch — ref frontend-backend-integration §8.5's whole
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
 * THE PROOF THIS BUILD CANNOT DESCRIBE (D245).
 *
 * The `unavailable` arm carries the SERVER's own reason — an unregistered
 * workflow, no transaction node committing this task, or a proof schema the
 * describer refuses by name — and this prints it verbatim. It composes no
 * sentence about the shape, because the shape is precisely what the server just
 * said it cannot state.
 *
 * It is drawn DISABLED WITH ITS REASON rather than hidden: hiding it would
 * teach the operator the product has never heard of the answer they came to
 * give, and the confirmed-ABSENT arm beside it stays fully reachable.
 *
 * The old copy on this refusal told the operator to "resolve this write from
 * the CLI". No run-mutation CLI has ever existed — `POST /api/v1/commands` is
 * the only mutation door in the system — so the sentence sent people looking
 * for a door that is not there.
 */
function ProofUnavailable({ reason }: { reason: string }) {
  return (
    <Refusal
      title="This build cannot describe the proof for this write"
      code="proof-contract-unavailable"
      outcome="nothing was sent · the write is still parked and still fenced"
    >
      <span>
        A confirmed-present resolution carries the transaction proof, parsed by the same schema the
        run&apos;s own completion would have parsed it with. {reason} Record the absence instead if
        that is what you found.
      </span>
    </Refusal>
  );
}

/**
 * THE TYPED PROOF FORM (D245).
 *
 * One control per operator-supplied leaf of the commit contract's own
 * completion proof schema, in the schema's declaration order. Three things
 * about it are decisions rather than layout:
 *
 *  - **Nothing is pre-filled.** The run holds what it TRIED to write, and
 *    offering that back as the proof would turn an attestation about a live HR
 *    system into a click-through of the system's own guess.
 *  - **The literals the schema pins are shown, not typed.** `kind` and `source`
 *    are the contract's statement of which page shape these fields come from;
 *    who vouched for the reading is recorded one level up, as the outcome's
 *    `proofSource: operator-attestation`.
 *  - **A field's problem appears once it has been TOUCHED.** Painting every box
 *    red before the operator has typed anything states a fault they have not
 *    made yet; the disabled verb names the first outstanding field, and every
 *    problem is in the Field's own accessible `error` channel the moment it is
 *    real.
 */
function ProofForm({
  contract,
  drafts,
  touched,
  disabled,
  onChange,
}: {
  contract: Extract<ParkedWritePayload["proofContract"], { state: "served" }>;
  drafts: Readonly<Record<string, string>>;
  touched: ReadonlySet<string>;
  disabled: boolean;
  onChange: (path: string, value: string) => void;
}) {
  const fixed = contract.fields.filter((field) => field.kind === "fixed");
  return (
    <section className="flex flex-col gap-[var(--ds-space-cozy)]">
      <div className="flex flex-col gap-[var(--ds-space-snug)]">
        <SectionLabel>The proof, as {contract.commitTaskId} defines it</SectionLabel>
        <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>
          Every box below is part of the transaction proof. Type what the target system shows you —
          the server parses it through the same schema the run&apos;s own completion would have.
        </span>
      </div>

      {fixed.length > 0 && (
        <Well className="flex flex-wrap items-center gap-[var(--ds-space-snug)]">
          {fixed.map((field) => (
            <Chip key={field.path} label={proofFieldLabel(field)}>
              {String(field.value)}
            </Chip>
          ))}
        </Well>
      )}

      {contract.fields.filter(isOperatorSuppliedProofField).map((field) => {
        const draft = drafts[field.path] ?? "";
        const problem = touched.has(field.path) ? proofFieldProblem(field, draft) : undefined;
        return (
          <Field
            key={field.path}
            label={proofFieldLabel(field)}
            description={proofFieldHint(field)}
            error={problem ?? null}
            required
          >
            {field.kind === "choice" || field.kind === "boolean" ? (
              <Select
                value={draft}
                disabled={disabled}
                onChange={(event) => onChange(field.path, event.target.value)}
              >
                {/* An empty first option, so nothing is chosen for the
                    operator: a select that opens on a valid answer is a
                    pre-filled proof wearing a control's clothes. */}
                <option value="">—</option>
                {(field.kind === "choice" ? field.options : PROOF_BOOLEAN_OPTIONS).map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </Select>
            ) : (
              <Input
                value={draft}
                disabled={disabled}
                inputMode={field.kind === "integer" ? "numeric" : undefined}
                onChange={(event) => onChange(field.path, event.target.value)}
              />
            )}
          </Field>
        );
      })}
    </section>
  );
}

/**
 * The blocked verb's reason, naming the FIRST outstanding proof field.
 *
 * The per-field sentences only appear once a field has been touched, so a verb
 * disabled with nothing but a shrug is exactly what this file refuses one
 * control over ("the Field's `error` is the accessible channel"). A problem
 * whose path names no served field cannot happen — the composer only reports
 * paths it was given — so the fallback prints the path rather than inventing a
 * friendlier name for a field nobody described.
 */
function firstProofProblemSentence(
  fields: readonly ProofFieldWire[],
  problems: readonly { readonly path: string; readonly message: string }[],
): string | undefined {
  const first = problems[0];
  if (first === undefined) return undefined;
  const field = fields.find(({ path }) => path === first.path);
  return `${field === undefined ? first.path : proofFieldLabel(field)}: ${first.message}`;
}

/** What the operator's answer produced. `idle` reserves the space it will need. */
type Outcome =
  | { state: "idle" }
  | { state: "sending" }
  | { state: "refused"; refusal: Refused };

export interface ParkResolveTarget {
  readonly parked: ParkedWritePayload;
  readonly action: CommandAction;
}

/**
 * The dialog a served resolution opens. It is CONFIRM-FIRST in the literal
 * sense ref frontend-backend-integration §8.5 means: its title, its body and its commit verb are the
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
  const { toast } = useToasts();
  const [evidenceNote, setEvidenceNote] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set());
  const [outcome, setOutcome] = useState<Outcome>({ state: "idle" });

  // A fresh open starts a fresh answer. A refusal does NOT — keeping what the
  // operator typed is the entire point of showing them the refusal.
  useEffect(() => {
    if (target === null) return;
    setEvidenceNote("");
    const contract = target.parked.proofContract;
    setDrafts(contract.state === "served" ? initialProofDrafts(contract.fields) : {});
    setTouched(new Set());
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
      `action ${action.key} is not a ref write-safety §4.1 write resolution with a confirm block and an intent target`,
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
  /*
   * D245 — WHAT BLOCKS THE VERB, per arm.
   *
   * The present arm needs BOTH halves of the kernel's payload: a proof that
   * composes through the served field list, and the same evidence note the
   * absent arm takes. The note's own bound is the kernel's `OperatorReasonSchema`,
   * stated here rather than discovered from a rejection.
   *
   * The proof half's refusal names the FIRST outstanding field, because the
   * per-field sentences only appear once a field has been touched and a
   * disabled verb with no reason is the thing this file already refuses
   * elsewhere.
   */
  const proofContract = parked.proofContract;
  const composed = arm === "present" && proofContract.state === "served"
    ? composeProofValue(proofContract.fields, drafts)
    : undefined;
  const proofProblem = arm !== "present"
    ? undefined
    : proofContract.state !== "served"
      ? "This build cannot describe the proof for this write."
      : composed?.state === "invalid"
        ? firstProofProblemSentence(proofContract.fields, composed.problems)
        : undefined;
  const blocked = arm === "present" ? proofProblem ?? noteProblem : noteProblem;

  const { writeTarget } = action;
  /**
   * A refusal lands in TWO places, and the demo's reason for the second one is
   * that a dialog can be scrolled (`DemoParkResolve.tsx:141-145`). The inline
   * `Refusal` is the record beside the answer it refused; the toast is
   * `danger`, which in this product means it never auto-dismisses — "nothing
   * was recorded" is not allowed to time out.
   */
  const refuse = (refusal: Refused): void => {
    setOutcome({ state: "refused", refusal });
    toast({
      tone: "danger",
      title: "Nothing was recorded",
      description: refusal.code === undefined
        ? refusal.message
        : `${refusal.message} (code ${refusal.code})`,
    });
  };
  const submit = (): void => {
    if (arm === undefined || blocked !== undefined) return;
    /*
     * D245: the present arm sends the composed proof BOUND to the schema hash
     * the server served. The hash is echoed, never computed — a client that
     * derived it would be a second implementation of the contract's identity,
     * and one that minted a plausible one to make the button work is the
     * fabricated constant this program exists to refuse. If the build moved
     * between the serve and the send, the kernel answers `schema-mismatch` and
     * this dialog prints it.
     */
    if (arm === "present" && (composed === undefined || composed.state !== "composed")) return;
    const request = arm === "present" && proofContract.state === "served" && composed?.state === "composed"
      ? {
        type: "resolve-write-present" as const,
        payload: {
          proof: { schemaHash: proofContract.schemaHash, value: composed.value },
          evidenceNote: note,
        },
      }
      : { type: "resolve-write-absent" as const, payload: { evidenceNote: note } };
    setOutcome({ state: "sending" });
    client.executeCommand({
      commandId: crypto.randomUUID(),
      requestedAt: systemClock.now().toISOString(),
      requestedBy: actorId,
      source: "run-detail",
      family: "run",
      type: request.type,
      target: {
        runId: parked.runId,
        expectedVersion: action.expectedVersion,
        writeIntentId: writeTarget.writeIntentId,
        intentGeneration: writeTarget.intentGeneration,
      },
      payload: request.payload,
    }).then((result) => {
      // `conflict` and `rejected` are VALUES, not exceptions (ref frontend-backend-integration §3.4),
      // and the ONE fold decides which of the three arms landed (D253, Track D
      // row D3). What the fold does NOT decide is how this dialog DRAWS a
      // refusal: `Refusal` has a code chip, so the two arms stay
      // distinguishable here by reading the settlement's own facts rather than
      // by re-taking the union apart. The server's sentence is printed
      // verbatim: a stale generation is exactly the state a second tab
      // produces, and the server is the only party that can say which
      // generation is live now.
      const settlement = settleCommandResult(result);
      if (settlement.kind === "refused") {
        refuse(
          settlement.reason === "rejected"
            ? { message: settlement.message, code: settlement.code }
            : { message: settlement.message },
        );
        return;
      }
      onResolved();
      onClose();
    }, (caught: unknown) => {
      // A transport failure is not a server refusal and has no code of its own
      // to quote — the uncoded arm says exactly that.
      refuse({ message: caught instanceof Error ? caught.message : String(caught) });
    });
  };

  const sending = outcome.state === "sending";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      {/* `lg`, the demo's size (R8 finding 13). This dialog carries the fence
          facts, the subject facts, a multi-line evidence field and a reserved
          answer slot; at `md` the fence row wrapped to three lines. */}
      <DialogContent size="lg" title={confirm.title} description={confirm.body}>
        <DialogBody className="flex flex-col gap-[var(--ds-space-cozy)]">
          {/*
            The fence facts the resolution BINDS to — shown, never assumed.

            A flex-wrap row of CONTENT-WIDTH chips, which is the demo's
            `FenceFacts` (`DemoParkResolve.tsx:333-340`) and R8 finding 14. The
            `ChipRow` grid this used to be gave every chip the same column
            width, so `system` and a 12-character digest were the same size and
            the row read as a table of equal facts rather than as a sentence.
          */}
          <Well className="flex flex-wrap items-center gap-[var(--ds-space-snug)]">
            <Chip label="system">{parked.system}</Chip>
            <Chip label="fenced">{fmtClock(parked.fencedAt)}</Chip>
            <Chip label="generation">{String(parked.generation)}</Chip>
            <Chip label="key" title={parked.idempotencyKeyDigest}>
              {shortDigest(parked.idempotencyKeyDigest)}
            </Chip>
            <SubjectFacts subject={parked.subject} inline />
          </Well>

          {arm === "present" && (
            proofContract.state === "served"
              ? (
                  <ProofForm
                    contract={proofContract}
                    drafts={drafts}
                    touched={touched}
                    disabled={sending}
                    onChange={(path, value) => {
                      setDrafts((current) => ({ ...current, [path]: value }));
                      setTouched((current) => new Set(current).add(path));
                    }}
                  />
                )
              : <ProofUnavailable reason={proofContract.reason} />
          )}

          {/*
            THE EVIDENCE NOTE IS ON BOTH ARMS (D245). The kernel's
            `resolve-write-present` payload requires it just as the absent one
            does, and it is the only place the operator says WHERE they looked —
            the proof above says what the page held, and the two are different
            facts. It is retained with the request in the command journal.
          */}
          {(arm === "absent" || proofContract.state === "served") && (
            <Field
              label={arm === "present"
                ? "Where did you see this, and how did you get there?"
                : "What did you check, and what did you see?"}
              description={arm === "present"
                ? "The proof says what the page held; this says where you stood when you read it."
                : "The only record of why a retry was permitted to submit for real."}
              /*
                BOTH note problems land here — the empty note as well as the
                over-long one (R8 finding 16). The empty-note sentence used to
                exist only as the disabled verb's `title`, which is a tooltip on
                a control the operator cannot focus and a screen reader is never
                given: the Field's `error` is the accessible channel, and it
                says the thing beside the box the operator has to fix. The
                sentence itself is already the demo's
                (`DemoParkResolve.tsx:255`).

                A refusal suppresses it: the server has just answered, and a
                client-side field note above the server's own refusal would be
                two verdicts on one answer.
              */
              error={outcome.state === "refused" ? null : noteProblem ?? null}
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
            {outcome.state === "refused" && (
              <RefusedNotice refusal={outcome.refusal} ceremony="parked-write" />
            )}
          </div>
        </DialogBody>

        {/*
          NO `meta` SLOT (D273 item 9, F22). The footer used to print
          `{runId} · rev {expectedVersion} · generation {intentGeneration}` —
          three facts the demo's footer never carried and that this dialog
          already shows where they mean something: `generation` is a chip in the
          fence Well above, and `runId`/`rev` are the CAS coordinates the verb
          binds to rather than anything the operator reads before pressing it.
          Repeating a fenced fact in a quieter type size a few hundred pixels
          below its own chip teaches the eye that the chip row is not the whole
          truth. The values are unchanged where they are load-bearing: the
          command envelope still targets this `runId` at `action.expectedVersion`
          and `writeTarget.intentGeneration`.
        */}
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={sending}>
            Not yet
          </Button>
          {/* `loading` rather than a swapped label: the primitive keeps the
              LABEL put and puts the spinner in the icon's slot, so the button
              never changes width under a pointer mid-click.

              THE ARM PICKS THE VARIANT AND THE GLYPH (R8 finding 3). Recording
              a write as PRESENT is the outcome where nothing further happens —
              the transaction landed, the run settles on it — so it is `primary`
              with a check. ABSENT is the one that unlocks a real second submit
              against a live HR system, which is why it keeps `danger` and the
              slashed circle. Both arms drew the ABSENT pair unconditionally, so
              the safe answer was wearing the dangerous answer's face.

              The LABEL stays the server's `confirmLabel` — ref frontend-backend-integration §8.5, on
              record as a deliberate deviation from the demo's client-authored
              strings (R8 finding 19). */}
          <Button
            variant={arm === "present" ? "primary" : "danger"}
            disabled={blocked !== undefined}
            loading={sending}
            title={blocked}
            icon={arm === "present"
              ? <CheckCircle2 aria-hidden className={dsIcon.md} />
              : <CircleSlash aria-hidden className={dsIcon.md} />}
            onClick={submit}
          >
            {confirm.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
