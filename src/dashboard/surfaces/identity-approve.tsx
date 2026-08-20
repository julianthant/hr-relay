/**
 * THE IDENTITY-APPROVAL CEREMONY (doc 09 §14.4/§14.6/§14.10, D226).
 *
 * The gate asks one question — *is this the right person* — and doc 09 §14.6
 * risk 1 is explicit that the control which answers it may not be the same
 * control every time. ALWAYS-GATE fires on EVERY separation, so a gate that is
 * one click on every run carries no signal and trains the operator to approve
 * without reading. The answer §14.6 ratified is that the shape of the decision
 * changes with its risk, and that the SERVER decides which shape.
 *
 * This surface renders what the server said and adds nothing:
 *
 * | served `approvalShape` | what the operator does |
 * |---|---|
 * | `one-click` | reads the packet and presses the server's own confirm verb |
 * | `choose-a-candidate` | picks WHICH candidate the document means, from the served options |
 * | `type-the-eid` | types the 8-digit EID — and it must still be one the packet showed |
 *
 * plus the fourth ceremony every shape carries: **reject**, with the operator's
 * own reason, which terminalizes the run and never falls through to a write.
 *
 * **A shape this build does not know draws a REFUSAL, never the approve
 * button.** That is the one rule this file exists to keep. A surface that met
 * an unrecognised ceremony and approved anyway would be §14.6 risk 1 with the
 * server's own guard removed — strictly worse than no guard, because the server
 * would still be reporting that it had asked for a choice.
 *
 * WHAT IS ON SCREEN, and why each part is there rather than one level away:
 *
 *  - **the disagreements, FIRST** (§14.6 risk 1). `comparisons` arrives sorted
 *    disagreements-first by construction and is rendered in that order, under
 *    its own heading, above everything that agrees;
 *  - **every approvable candidate**, in `CompareGrid` — the primitive that
 *    exists because two identity candidates are read ACROSS, name against name
 *    and EID against EID, not down a page;
 *  - **the write plan** (§14.10 / D211). The approval binds to the digest of the
 *    exact packet shown, so the values the writes will consume are ON the packet
 *    — *an approval of a person is not an approval of a date*. Rendering them
 *    here is what makes that binding something the operator actually saw.
 *
 * Every fact is served. This file composes no sentence about the decision, and
 * the commit verb is the SERVER's `confirmLabel` (doc 13 §8.5), for the same
 * reason `park-resolve.tsx` gives: only the server knows the casualties.
 */
import { useEffect, useState } from "react";
import { CheckCircle2, CircleSlash } from "lucide-react";
import { cn } from "../lib/utils.js";
import {
  Banner,
  Button,
  Chip,
  ChipRow,
  CompareCard,
  CompareGrid,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  Field,
  Input,
  KeyValueList,
  MetaLine,
  RadioGroup,
  Refusal,
  SectionLabel,
  Textarea,
  Well,
  dsIcon,
  dsMotion,
  dsText,
  useDsEnterTransition,
  useToasts,
} from "../ds/ui.js";
import { identityGateArm } from "./identity-approve-model.js";
import { useDashboardClient } from "../state/client-context.js";
import { composeCommandRequest, type CommandAction } from "../app/command-dispatch.js";
import {
  EMPTY_IDENTITY_GATE_DRAFT,
  identityCeremonyFor,
  identityDraftProblem,
  identityGateAnswer,
  type IdentityCeremony,
  type IdentityGateAvailable,
  type IdentityGateDetail,
  type IdentityGateDraft,
} from "../app/identity-ceremony.js";
import { fmtClock } from "./format.js";

/* which arm a served gate command resolves lives in `identity-approve-model.ts` — see the note there */

export interface IdentityApproveTarget {
  readonly gate: IdentityGateAvailable;
  readonly action: CommandAction;
}

/** A refusal as this surface holds it: the server's sentence, and its code when there is one. */
interface Refused {
  readonly message: string;
  readonly code?: string;
}

type Outcome =
  | { state: "idle" }
  | { state: "sending" }
  | { state: "refused"; refusal: Refused };

/* ── the evidence, in §14.4's own order ──────────────────────────────────── */

/**
 * The subject the packet is about, as served chips.
 *
 * `documentName` and `ucpathName` sit side by side because the incident this
 * whole control exists for — `T002173685` — was two spellings of one name that
 * `classifyNameSimilarity` calls the SAME person. The operator reads them; the
 * classifier's tier is printed beside them rather than instead of them.
 */
function PacketSubject({ gate }: { gate: IdentityGateDetail }) {
  const { packet } = gate;
  return (
    <Well className="flex flex-wrap items-center gap-[var(--ds-space-snug)]">
      <Chip label="document">{packet.documentNumber}</Chip>
      <Chip label="document name">{packet.documentName}</Chip>
      <Chip label="UCPath name">{packet.ucpathName}</Chip>
      <Chip label="name tier" tone={packet.nameTier === "same" ? "neutral" : "warning"}>
        {packet.nameTier}
      </Chip>
      <Chip label="EID read">{packet.emplId}</Chip>
      <Chip label="observed">{fmtClock(packet.observedAt)}</Chip>
      {/*
        The packet's own identity, cut for the eye and whole on the element's
        `title`. §14.5 binds this approval to THIS digest: if the evidence moves
        between opening the dialog and pressing the verb, the post-gate check
        refuses with `identity-approval-evidence-moved` and the gate re-opens.
        The ceremony is printed beside it because it is the server's statement
        about this decision's risk, and the operator is entitled to see that the
        control they are being given is the one the server asked for.
      */}
      <MetaLine
        items={[
          `packet ${gate.evidenceDigest.slice(0, 12)}…`,
          `ceremony ${gate.approvalShape}`,
          `parked ${fmtClock(gate.parkedAt)}`,
        ]}
      />
    </Well>
  );
}

/**
 * DISCONFIRMING EVIDENCE FIRST — §14.6 risk 1's cheap half, and the reason the
 * packet's `comparisons` array is ordered rather than merely populated.
 *
 * The two groups are drawn as two SECTIONS with their own headings, not as one
 * list with a mark per row, because the operator's eye has to land on the
 * disagreements before it lands on the verb. A run where nothing disagrees says
 * so in a sentence — an empty heading would read as a rendering fault.
 */
function PacketComparisons({ gate }: { gate: IdentityGateDetail }) {
  const disagreements = gate.packet.comparisons.filter(({ agrees }) => !agrees);
  const agreements = gate.packet.comparisons.filter(({ agrees }) => agrees);
  return (
    <div className="flex flex-col gap-[var(--ds-space-cozy)]">
      <section className="flex flex-col gap-[var(--ds-space-snug)]">
        <SectionLabel>What disagrees</SectionLabel>
        {disagreements.length === 0 ? (
          <span className={cn(dsText.body, "text-[color:var(--ds-fg-muted)]")}>
            Every compared field agreed. That is not the same as being the right person — it is the
            absence of a reason to doubt it.
          </span>
        ) : (
          <KeyValueList
            items={disagreements.map((row) => ({
              key: row.field,
              tone: "warning" as const,
              value: `${row.documentValue} → ${row.ucpathValue} · ${row.note}`,
            }))}
          />
        )}
      </section>
      {agreements.length > 0 && (
        <section className="flex flex-col gap-[var(--ds-space-snug)]">
          <SectionLabel>What agrees</SectionLabel>
          <KeyValueList
            items={agreements.map((row) => ({
              key: row.field,
              value: `${row.documentValue} · ${row.note}`,
            }))}
          />
        </section>
      )}
    </div>
  );
}

/**
 * Every EID a human may legitimately approve, read ACROSS.
 *
 * `CompareGrid` rather than a list: DESIGN.md names two identity candidates as
 * the case the primitive was built for, because the reading is horizontal —
 * name against name, EID against EID, origin against origin. Every card renders
 * the same three children in the same order, which is the contract the subgrid
 * alignment rests on.
 */
function PacketCandidates({ gate }: { gate: IdentityGateDetail }) {
  return (
    <section className="flex flex-col gap-[var(--ds-space-snug)]">
      <SectionLabel>Approvable candidates</SectionLabel>
      <CompareGrid rows={3} min="14rem">
        {gate.options.map((option) => (
          <CompareCard key={option.eid} rows={3}>
            <span className={cn(dsText.ui, "font-semibold text-[color:var(--ds-fg)]")}>
              {option.displayName}
            </span>
            <ChipRow>
              <Chip label="EID">{option.eid}</Chip>
              <Chip label="from">{option.chosenFrom}</Chip>
            </ChipRow>
            <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>{option.origin}</span>
          </CompareCard>
        ))}
      </CompareGrid>
    </section>
  );
}

/**
 * WHAT THE WRITES WILL CONSUME (§14.10, D211).
 *
 * The approval binds to the digest of the exact packet shown, so these values
 * are inside the packet and a reconciled date that moves after approval
 * re-opens the gate. Rendering them is what turns that binding into something
 * the operator saw: *an approval of a person is not an approval of a date.*
 *
 * The `not-composed` arm prints its stated reason rather than nothing — a graph
 * that files at most one write says so in a sentence somebody wrote, which is
 * exactly why that arm is required rather than optional.
 */
function PacketPlan({ gate }: { gate: IdentityGateDetail }) {
  const { plan } = gate.packet;
  if (plan.state === "not-composed") {
    return (
      <section className="flex flex-col gap-[var(--ds-space-snug)]">
        <SectionLabel>What this approval authorizes</SectionLabel>
        <span className={cn(dsText.body, "text-[color:var(--ds-fg-muted)]")}>{plan.reason}</span>
      </section>
    );
  }
  const { termination, document, dates } = plan;
  return (
    <section className="flex flex-col gap-[var(--ds-space-snug)]">
      <SectionLabel>What this approval authorizes</SectionLabel>
      <KeyValueList
        items={[
          { key: "Termination", value: `${termination.terminationType} · ${termination.classification}` },
          { key: "Template", value: `${termination.template} · reason ${termination.reasonCode}` },
          { key: "Empl record", value: termination.emplRecord },
          { key: "Effective", value: termination.effectiveDate },
          { key: "Last date worked", value: termination.lastDateWorked },
          { key: "Comments", value: termination.initiatorComments },
          { key: "Kuali document", value: document.documentNumber },
          {
            key: "Department",
            value: `${document.department} (${document.departmentCode}) · UCPath: ${document.ucpathDepartment}`,
          },
          { key: "Payroll title", value: `${document.payrollTitle} (${document.payrollTitleCode})` },
          { key: "Timekeeper", value: document.timekeeperName },
          {
            key: "Last day worked",
            tone: dates.lastDayWorkedChanged ? ("warning" as const) : undefined,
            value: dates.lastDayWorkedChanged
              ? `${dates.lastDayWorked} — the form said ${dates.kualiLastDayWorked}`
              : dates.lastDayWorked,
          },
          {
            key: "Separation date",
            tone: dates.separationDateChanged ? ("warning" as const) : undefined,
            value: dates.separationDateChanged
              ? `${dates.separationDate} — the form said ${dates.kualiSeparationDate}${
                dates.separationDeterminingLeave === null
                  ? ""
                  : ` (${dates.separationDeterminingLeave} leave moved it)`}`
              : dates.separationDate,
          },
          ...(dates.unclassifiedPayCodes.length === 0 ? [] : [{
            key: "Pay codes not counted",
            tone: "warning" as const,
            value: dates.unclassifiedPayCodes.join(", "),
          }]),
        ]}
      />
    </section>
  );
}

/* ── the three ceremonies ────────────────────────────────────────────────── */

/**
 * The control the SERVER asked for, and nothing else.
 *
 * Each arm draws exactly one control, and the arms are not skins of one screen:
 * `choose` presents the candidates as a decision with no default selected —
 * a pre-selected radio is a one-click approve wearing a radio's clothes — and
 * `type-the-eid` presents an empty field, because the whole point of the typing
 * ceremony is that the operator states the answer rather than recognises it.
 */
function CeremonyControl({
  ceremony,
  draft,
  problem,
  disabled,
  showProblem,
  onDraft,
}: {
  ceremony: IdentityCeremony;
  draft: IdentityGateDraft;
  problem: string | undefined;
  disabled: boolean;
  showProblem: boolean;
  onDraft: (next: IdentityGateDraft) => void;
}) {
  switch (ceremony.kind) {
    case "unsupported":
      return (
        <Refusal
          title="This build cannot answer this gate"
          code="identity-approval-ceremony-unsupported"
          outcome="nothing was sent · the run is still held at the gate"
        >
          {ceremony.reason}
        </Refusal>
      );
    case "confirm":
      return (
        <Banner tone="info" title="One unambiguous candidate">
          The server set this decision&apos;s ceremony to one click:{" "}
          {ceremony.option.displayName} · EID {ceremony.option.eid}. {ceremony.option.origin}.
        </Banner>
      );
    case "choose":
      return (
        <RadioGroup
          label="Which candidate does this separation document mean?"
          name="identity-approval-candidate"
          value={draft.eid}
          onValueChange={(eid) => onDraft({ ...draft, eid })}
          options={ceremony.options.map((option) => ({
            value: option.eid,
            label: `${option.displayName} · EID ${option.eid}`,
            description: option.origin,
            disabled,
          }))}
        />
      );
    case "type-the-eid":
      return (
        <Field
          label="Type the employee ID this separation is about"
          description="The server called this decision ambiguous, so the EID is stated rather than selected. It must still be one this packet showed."
          error={showProblem ? problem ?? null : null}
          required
        >
          <Input
            value={draft.eid}
            disabled={disabled}
            inputMode="numeric"
            autoComplete="off"
            maxLength={8}
            placeholder="10001799"
            onChange={(event) => onDraft({ ...draft, eid: event.target.value.trim() })}
          />
        </Field>
      );
    case "reject":
      return (
        <Field
          label="Why is this not the right person?"
          description="Recorded on the run's failure record. It is the only account of why nothing was filed."
          error={showProblem ? problem ?? null : null}
          required
        >
          <Textarea
            rows={3}
            value={draft.reason}
            disabled={disabled}
            onChange={(event) => onDraft({ ...draft, reason: event.target.value })}
            placeholder="The UCPath detail is a different person — same name, different department, and the document's EID belongs to the STDT 3 in Housing."
          />
        </Field>
      );
  }
}

/**
 * The server's refusal, ARRIVING — the same two arms and the same reasoning as
 * `park-resolve.tsx`: `rejected` always carries a code and `conflict` never
 * does, so the split is exact rather than approximate, and an uncoded refusal
 * says in as many words that there is nothing to quote.
 */
function RefusedNotice({ refusal }: { refusal: Refused }) {
  const entering = useDsEnterTransition();
  const enterClass = cn(
    dsMotion.enter,
    "data-[demo-enter=from]:translate-y-[var(--ds-travel-md)] data-[demo-enter=from]:opacity-0",
  );
  if (refusal.code === undefined) {
    return (
      // NO nested `role="alert"` inside the body: a `danger` Banner already
      // carries one, and an alert inside an alert announces the same sentence
      // twice to a screen reader while making every `getByRole("alert")` on
      // this surface ambiguous.
      <Banner tone="danger" title="Nothing was recorded" className={enterClass} {...entering}>
        {refusal.message} The gate is still open and your answer below is untouched — but the
        server sent no refusal code, so there is nothing here to quote in a bug report.
      </Banner>
    );
  }
  return (
    <Refusal
      title="Nothing was recorded"
      code={refusal.code}
      outcome="the gate is still open · your answer below is untouched"
      className={enterClass}
      {...entering}
    >
      {refusal.message}
    </Refusal>
  );
}

/**
 * The dialog a served `resolve-gate` descriptor opens.
 *
 * CONFIRM-FIRST in doc 13 §8.5's literal sense: the title, the body and the
 * commit verb are the `confirm` block the SERVER authored. NO OPTIMISTIC
 * AUTHORITY — pressing the verb sends the one command envelope and then shows
 * what came back; a `conflict` or a `rejected` keeps the dialog, keeps every
 * character the operator typed, and prints the server's own sentence.
 *
 * The envelope is composed by `composeCommandRequest`, which is still THE one
 * place a served control becomes a command. This dialog supplies the one thing
 * no served fact carries — the human's answer — and reads the composer's own
 * refusal when the answer does not fit the ceremony.
 */
export function IdentityApproveDialog({
  target,
  actorId,
  onClose,
  onResolved,
}: {
  target: IdentityApproveTarget | null;
  actorId: string;
  onClose: () => void;
  /** A resolved gate moved the run — the owner refetches detail + sections. */
  onResolved: () => void;
}) {
  const client = useDashboardClient();
  const { toast } = useToasts();
  const [draft, setDraft] = useState<IdentityGateDraft>(EMPTY_IDENTITY_GATE_DRAFT);
  const [outcome, setOutcome] = useState<Outcome>({ state: "idle" });
  const [attempted, setAttempted] = useState(false);

  // A fresh open starts a fresh answer. A refusal does NOT — keeping what the
  // operator authored is the entire point of showing them the refusal.
  useEffect(() => {
    if (target === null) return;
    setDraft(EMPTY_IDENTITY_GATE_DRAFT);
    setOutcome({ state: "idle" });
    setAttempted(false);
  }, [target]);

  if (target === null) return null;
  const { gate, action } = target;
  const served = gate.value;
  const arm = identityGateArm(action);
  const confirm = action.confirm;
  if (arm === undefined || confirm === undefined) {
    // The wire's own `superRefine` pins every action on this section to a
    // `resolve-gate`, and the server authors a confirm block on both. Reaching
    // here means the descriptor changed shape under a surface mid-flight.
    throw new Error(
      `action ${action.key} is not a doc 09 §14.4 gate resolution with a confirm block`,
    );
  }

  const ceremony = identityCeremonyFor(served, arm);
  const problem = identityDraftProblem(ceremony, draft);
  const sending = outcome.state === "sending";

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
    setAttempted(true);
    if (problem !== undefined) return;
    const answer = identityGateAnswer(ceremony, draft);
    // `identityDraftProblem` said the draft was answerable, so this is
    // unreachable — and it refuses loudly rather than sending a payload nobody
    // composed, because the alternative is a real HR identity decision made
    // from a value this surface invented.
    if (answer === undefined) {
      refuse({ message: `the ${ceremony.kind} ceremony yielded no answer from an accepted draft` });
      return;
    }
    const composed = composeCommandRequest(
      action,
      { runId: served.runId, expectedVersion: action.expectedVersion },
      { actorId, source: "run-detail", gate, gateAnswer: answer },
    );
    if (composed.state === "refused") {
      refuse({ message: composed.reason });
      return;
    }
    setOutcome({ state: "sending" });
    client.executeCommand(composed.request).then((result) => {
      // `conflict` and `rejected` are VALUES, not exceptions (doc 13 §3.4).
      if (result.state === "conflict" || result.state === "rejected") {
        refuse(
          result.state === "rejected"
            ? { message: result.message, code: result.code }
            : { message: result.message },
        );
        return;
      }
      onResolved();
      onClose();
    }, (caught: unknown) => {
      // A transport failure is not a server refusal and has no code to quote.
      refuse({ message: caught instanceof Error ? caught.message : String(caught) });
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      {/* `lg` for the same reason the park dialog takes it: this body carries
          the packet's comparisons, its candidates, the write plan, a ceremony
          control and a reserved answer slot. */}
      <DialogContent size="lg" title={confirm.title} description={confirm.body}>
        <DialogBody className="flex flex-col gap-[var(--ds-space-cozy)]">
          <PacketSubject gate={served} />
          <PacketComparisons gate={served} />
          <PacketCandidates gate={served} />
          <PacketPlan gate={served} />

          <CeremonyControl
            ceremony={ceremony}
            draft={draft}
            problem={problem}
            disabled={sending}
            // A refusal suppresses the client-side note: the server has just
            // answered, and a field note above the server's own refusal would
            // be two verdicts on one answer.
            showProblem={attempted && outcome.state !== "refused"}
            onDraft={setDraft}
          />

          {/* RESERVED SPACE — the answer's slot exists before there is an
              answer, so a refusal does not shove the footer out from under a
              pointer already travelling toward it. */}
          <div className="min-h-[var(--ds-h-lg)]">
            {outcome.state === "refused" && <RefusedNotice refusal={outcome.refusal} />}
          </div>
        </DialogBody>

        <DialogFooter
          meta={`${served.runId} · gate ${served.gateId} · rev ${String(action.expectedVersion)}`}
        >
          <Button variant="secondary" onClick={onClose} disabled={sending}>
            Not yet
          </Button>
          {/*
            THE ARM PICKS THE VARIANT AND THE GLYPH. An approval is what binds
            the rest of the separation to a person and is drawn `primary`;
            a rejection ENDS the run and is drawn `danger` with the slashed
            circle. The LABEL stays the server's `confirmLabel` (doc 13 §8.5).

            `disabled` is the CEREMONY's own verdict, not a guess: an
            unsupported shape, an unpicked candidate, an EID the packet never
            showed, an empty reason. Each of those has its sentence beside the
            control it belongs to, and the same sentence rides the button's
            `title` so a pointer that lands here first still gets it.
          */}
          <Button
            variant={arm === "approved" ? "primary" : "danger"}
            disabled={problem !== undefined}
            loading={sending}
            title={problem}
            icon={arm === "approved"
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
