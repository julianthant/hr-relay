/**
 * The DESKTOP half of phone capture — what the operator is served after the QR
 * is scanned (D274 item 7, ledger 3 CP2/CP5–CP18/CP21).
 *
 * `capture-start.tsx` is the door: one button and a QR. Until this panel existed
 * the operator walked through it into silence — no phase, no page count, no
 * expiry, no unreadable-page alert, no contact sheet — while the phone on the
 * desk filled up with pages nothing on screen acknowledged.
 *
 * Three things are load-bearing, and the first two are the demo's own
 * (`DemoCapture.tsx`, legacy `1bffbd658db34ce84a08e69484db3a40b3658d6e`):
 *
 * - **The pages are on the RIGHT, and the divider is a grid TRACK.** The left
 *   column is the session and its hazards, the right is the contact sheet and
 *   it is the wider of the two. One grid, one gap, and a 1px track instead of a
 *   border, so the two columns end on the same line however much either has to
 *   say (CP17).
 * - **Nothing here claims a page is good.** A captured page has been received,
 *   not read: no green, no check, no "accepted" anywhere on this surface. The
 *   only tone it spends beyond neutral is on the pages a human has to act on
 *   (CP59).
 * - **No page is drawn, because no bytes are served.** Every frame is the
 *   page's OWN served geometry and holds an icon; the production byte path is
 *   doc 04's deferral and this surface does not pretend otherwise. A stand-in
 *   image of a plausible form, on the screen an operator approves from, is the
 *   exact fabrication this rebuild exists to stop.
 *
 * Its own third rule is the two failure arms. `unreadable` and `unavailable`
 * are separate banners with separate tones and separate instructions, because
 * the wire keeps them separate: one is a page to photograph again, the other is
 * a storage fault that retaking cannot clear.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Camera, FileText, Info } from "lucide-react";
import type { CaptureOperatorPageWire, CaptureOperatorSessionWire } from "../../domain/capture-operator.js";
import {
  Badge,
  Banner,
  BulletList,
  CountBadge,
  EmptyState,
  IconButton,
  KeyValueList,
  MetaLine,
  SectionLabel,
  Select,
  Skeleton,
  Well,
  dsFg,
  dsFocus,
  dsIcon,
  dsMotion,
  dsRadius,
  dsText,
  useDsEnterTransition,
} from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import { useActiveCaptureSessions, useCaptureSession } from "../state/use-capture-session.js";
import {
  CAPTURE_PHASE,
  CAPTURE_RULE_ITEMS,
  CAPTURE_RULE_LABEL,
  capturePageAlerts,
  capturePageTileFacts,
  capturePickedPage,
  captureRecordedFacts,
  captureSelectedSessionId,
  captureSessionMetaItems,
  captureSessionOptions,
  captureEmptySheetDescription,
} from "./capture-session-model.js";

/** Which page the left column describes, keyed to the session it belongs to. */
interface PickedPage {
  readonly sessionId: string;
  readonly ordinal: number;
}

function PageTile({
  page,
  total,
  current,
  onSelect,
}: {
  page: CaptureOperatorPageWire;
  total: number;
  current: boolean;
  onSelect: () => void;
}) {
  const facts = capturePageTileFacts(page, total);
  const flagged = facts.flag !== "none";
  return (
    <button
      type="button"
      aria-current={current ? "true" : undefined}
      aria-label={facts.accessibleName}
      onClick={onSelect}
      className={cn(
        // A tile is an OBJECT, so it reads the recessed plane as a matte fill
        // AND a hairline — the treatment every chip in this product wears.
        "flex w-full min-w-0 cursor-pointer flex-col items-stretch gap-[var(--ds-space-hair)] border",
        "p-[var(--ds-space-tight)]",
        dsRadius.md,
        dsFocus,
        dsMotion.fast,
        "active:translate-y-px",
        facts.flag === "unreadable"
          && "border-[color:var(--ds-status-waiting-border)] bg-[var(--ds-status-waiting-bg)]",
        facts.flag === "unavailable"
          && "border-[color:var(--ds-danger-border)] bg-[var(--ds-danger-quiet)]",
        facts.flag === "none"
          && "border-[color:var(--ds-recess-border)] bg-[var(--ds-recess-bg)] hover:bg-[var(--ds-surface-3)]",
        // SELECTION NEVER TAKES A FLAG'S EDGE (CP15). Which page you are reading
        // is a FILL; which page is in trouble is an EDGE — so inspecting a
        // flagged page cannot quietly repaint the one cue that matters.
        current && "bg-[var(--ds-surface-selected)]",
        current && !flagged && "border-[color:var(--ds-border-loud)]",
      )}
    >
      {/* THE FRAME IS THE PAGE'S OWN SERVED SHAPE (CP13). Width comes from the
          grid track and the height falls out of the ratio, so a row of frames
          lands on one baseline without anyone picking a height. A page whose
          bytes would not parse has NO served shape, so it takes a fixed frame
          instead — visibly not a page outline, because letterboxing it to a
          plausible US Letter would be this surface inventing the one thing it
          is looking at. */}
      <span
        aria-hidden
        style={facts.aspectRatio === undefined ? undefined : { aspectRatio: facts.aspectRatio }}
        className={cn(
          "flex w-full items-center justify-center border bg-[var(--ds-surface-1)]",
          dsRadius.sm,
          facts.aspectRatio === undefined && "h-[var(--ds-h-lg)]",
          facts.flag === "unreadable" && "border-[color:var(--ds-status-waiting-mark)]",
          facts.flag === "unavailable" && "border-[color:var(--ds-danger)]",
          facts.flag === "none" && "border-[color:var(--ds-border-subtle)]",
        )}
      >
        <FileText
          className={cn(
            dsIcon.md,
            facts.flag === "unreadable" && "text-[color:var(--ds-status-waiting-fg)]",
            facts.flag === "unavailable" && "text-[color:var(--ds-danger)]",
            facts.flag === "none" && "text-[color:var(--ds-fg-faint)]",
          )}
        />
      </span>
      <span className={cn(dsText.micro, "truncate text-center font-medium", current ? dsFg.base : dsFg.secondary)}>
        {facts.title}
      </span>
      {/* Always drawn, so every tile is one height and the sheet keeps a single
          baseline whether or not a page is flagged. */}
      <span
        className={cn(
          dsText.micro,
          "truncate text-center",
          // `muted`, not `faint`: a page's size is a fact the operator reads,
          // and `faint` is the disabled/placeholder step.
          facts.flag === "unreadable" && "text-[color:var(--ds-status-waiting-fg)]",
          facts.flag === "unavailable" && "text-[color:var(--ds-danger)]",
          facts.flag === "none" && cn(dsText.nums, dsFg.muted),
        )}
      >
        {facts.stateLine}
      </span>
    </button>
  );
}

function SessionBody({
  session,
  picked,
  onPick,
}: {
  session: CaptureOperatorSessionWire;
  picked: PickedPage | undefined;
  onPick: (next: PickedPage) => void;
}) {
  const phase = CAPTURE_PHASE[session.phase];
  const PhaseIcon = phase.Icon;
  const alerts = capturePageAlerts(session.pages);
  const inspected = capturePickedPage(session.pages, picked, session.sessionId);
  const total = session.pages.length;

  return (
    <div className="grid grid-cols-1 gap-[var(--ds-space-cozy)] @min-[560px]:grid-cols-[minmax(0,1fr)_1px_minmax(0,1.55fr)]">
      {/* ---- LEFT: the session, its hazards, and the inspected page -------- */}
      <div className="flex min-w-0 flex-col gap-[var(--ds-space-cozy)]">
        <div className="flex min-w-0 flex-col gap-[var(--ds-space-snug)]">
          {/* `State`, not `Session` — the header a line above already said the
              word, and the page count that could sit here is the same number
              the sheet's own badge carries. A surface that says one fact twice
              teaches the eye to skip both. */}
          <SectionLabel>State</SectionLabel>
          <Well className="flex flex-col gap-[var(--ds-space-snug)]">
            <Badge tone={phase.tone} className="self-start">
              <PhaseIcon aria-hidden className={dsIcon.sm} />
              {phase.label}
            </Badge>
            <MetaLine items={[...captureSessionMetaItems(session)]} />
          </Well>
        </div>

        {/* The projector's own sentence, verbatim. `blocked` is the phase for a
            finalization that failed, and the operator holding the phone decides
            between Try again and Discard on it — "something went wrong" decides
            nothing. */}
        {session.handoff.state === "failed" && (
          <Banner tone="danger" title="The bundle could not be sent">
            {session.handoff.message}
          </Banner>
        )}

        {/* Two arms, never one (CP9). A parse refusal is a page to photograph
            again; a read-back failure is a fault, and telling an operator to
            retake a form because a disk read failed would be worse than saying
            nothing. */}
        {alerts.map((alert) => (
          <Banner key={alert.kind} tone={alert.tone} title={alert.title}>
            <div className="flex min-w-0 flex-col gap-[var(--ds-space-snug)]">
              {alert.reasons.length === 1
                ? <p className="min-w-0">{alert.reasons[0]}</p>
                : <BulletList items={[...alert.reasons]} />}
              <p className="min-w-0">{alert.instruction}</p>
            </div>
          </Banner>
        ))}

        {inspected !== undefined && (
          <div className="flex min-w-0 flex-col gap-[var(--ds-space-snug)]">
            <SectionLabel>What was recorded</SectionLabel>
            <KeyValueList items={captureRecordedFacts(inspected, total).map((fact) => ({
              key: fact.key,
              value: fact.value,
              ...(fact.tone === undefined ? {} : { tone: fact.tone }),
            }))} />
          </div>
        )}
      </div>

      {/* The divider is a grid TRACK, so it is exactly as tall as the taller
          column and needs no height of its own — it is also the thing that SAYS
          the two columns end level. It reads the strong hairline rather than the
          default one: between two filled columns the subtle rule is invisible,
          and an invisible divider is not one. */}
      <span aria-hidden className="hidden bg-[color:var(--ds-border-strong)] @min-[560px]:block" />

      {/* ---- RIGHT: the pages, which is what the operator came to see ------ */}
      <div className="flex min-w-0 flex-col gap-[var(--ds-space-snug)]">
        <div className="flex items-center gap-[var(--ds-space-snug)]">
          <SectionLabel className="min-w-0 truncate">Pages received</SectionLabel>
          <CountBadge className="ml-auto" value={total} />
        </div>
        {total === 0
          ? (
            /* `flex-1` on both branches: the sheet is the column's body, so it
               reaches the bottom edge whatever the LEFT column has to say. A box
               that stopped short would make the divider look like it was
               dividing nothing. */
            <Well className="flex min-h-0 flex-1 flex-col justify-center">
              <EmptyState
                className="p-[var(--ds-space-base)]"
                icon={<Camera aria-hidden className={dsIcon.lg} />}
                title="No page has arrived yet"
                description={captureEmptySheetDescription(session)}
              />
            </Well>
          )
          : (
            /* A well that SCROLLS draws its edge — the border is what tells the
               eye the sheet is cut rather than finished. `--ds-h-capture-box` is
               its ceiling, so a thirty-page packet never turns the workspace
               into a page. */
            <Well className="max-h-[var(--ds-h-capture-box)] min-h-0 flex-1 overflow-y-auto">
              <ul
                role="list"
                aria-label="Pages received"
                className="grid gap-[var(--ds-space-snug)] [grid-template-columns:repeat(auto-fill,minmax(var(--ds-w-capacity-cell),1fr))]"
              >
                {session.pages.map((page) => (
                  <li key={page.photoId} className="min-w-0">
                    <PageTile
                      page={page}
                      total={total}
                      current={inspected?.ordinal === page.ordinal}
                      onSelect={() => onPick({ sessionId: session.sessionId, ordinal: page.ordinal })}
                    />
                  </li>
                ))}
              </ul>
            </Well>
          )}
      </div>
    </div>
  );
}

/**
 * The panel, scoped to the workflow whose intake screen it sits on.
 *
 * The list route serves every active capture, not one workflow's; filtering
 * here is a scope rather than a hidden fact, and `workflow` is a served field on
 * every summary. An operator inside Separations' intake has no use for a
 * Person-lookup capture, and a picker that offered one would let a page land in
 * the wrong plan.
 */
export function CaptureSessionPanel({ workflowId }: { workflowId: string }) {
  const [ruleOpen, setRuleOpen] = useState(false);
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [picked, setPicked] = useState<PickedPage | undefined>(undefined);
  const enter = useDsEnterTransition();

  const list = useActiveCaptureSessions();
  const active = list.state === "loaded"
    ? list.value.sessions.filter((summary) => summary.workflow === workflowId)
    : [];

  // The effective id is DERIVED so the first render already reads the right
  // session — an effect alone would paint "no capture session is open" for a
  // frame over a capture that is open. The effect then LATCHES it, which is what
  // keeps the panel on a capture that finalizes and leaves the active list.
  const effective = captureSelectedSessionId(active, selected);
  useEffect(() => {
    if (selected === undefined && effective !== undefined) setSelected(effective);
  }, [effective, selected]);

  const session = useCaptureSession(effective);
  const loaded = session.state === "loaded" ? session.value : undefined;
  const options = captureSessionOptions(active, loaded);

  const body = ((): ReactNode => {
    if (effective === undefined) {
      if (list.state === "loading" || list.state === "idle") {
        return <Skeleton className="h-[var(--ds-h-capture-box)] w-full" />;
      }
      if (list.state === "failed") {
        return (
          <Banner tone="danger" title="The open captures could not be read">
            {list.error.message} Nothing below is missing — nothing below was asked for.
          </Banner>
        );
      }
      return (
        <Well>
          <EmptyState
            className="p-[var(--ds-space-base)]"
            icon={<Camera aria-hidden className={dsIcon.lg} />}
            title="No capture session is open"
            description="A capture opens when you start one above and the phone scans the code. Until one is open there is nothing here to build a plan from, and nothing here will invent one."
          />
        </Well>
      );
    }
    if (session.state === "loading" || session.state === "idle") {
      return <Skeleton className="h-[var(--ds-h-capture-box)] w-full" />;
    }
    if (session.state === "failed") {
      return (
        <Banner tone="danger" title="This capture session could not be read">
          {session.error.message}
        </Banner>
      );
    }
    return <SessionBody session={session.value} picked={picked} onPick={setPicked} />;
  })();

  return (
    <section aria-label="Capture session" className="@container flex flex-col gap-[var(--ds-space-snug)]">
      <div className="flex flex-wrap items-center gap-[var(--ds-space-snug)]">
        <SectionLabel className="min-w-0 truncate">Capture session</SectionLabel>
        {options.length > 1 && effective !== undefined && (
          /* `lg`, not `md`: an option is `<id> · <phase label> · N pages` and a
             native select CUTS rather than wraps, so the width has to seat the
             longest phase the vocabulary holds. */
          <span className="ml-auto min-w-0 max-w-[var(--ds-w-popover-lg)] flex-1">
            <Select
              aria-label="Open capture session"
              value={effective}
              onChange={(event) => {
                setSelected(event.target.value);
                // The pick is keyed to its own session, so it cannot describe a
                // page of the session before this one — but dropping it here
                // keeps the left column on page 1 of what was just opened
                // rather than on whatever ordinal happened to match.
                setPicked(undefined);
              }}
            >
              {options.map((option) => (
                <option key={option.sessionId} value={option.sessionId}>{option.label}</option>
              ))}
            </Select>
          </span>
        )}
        <IconButton
          size="xs"
          className={options.length > 1 ? undefined : "ml-auto"}
          label={CAPTURE_RULE_LABEL}
          aria-expanded={ruleOpen}
          onClick={() => setRuleOpen((open) => !open)}
          icon={<Info aria-hidden className={dsIcon.sm} />}
        />
      </div>

      {ruleOpen && (
        <div
          {...enter}
          className={cn(
            dsMotion.enter,
            "data-[demo-enter=from]:translate-y-[var(--ds-travel-sm)] data-[demo-enter=from]:opacity-0",
          )}
        >
          <Well>
            <BulletList items={[...CAPTURE_RULE_ITEMS]} />
          </Well>
        </div>
      )}

      {body}
    </section>
  );
}
