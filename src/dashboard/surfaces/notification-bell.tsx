import {
Bell,
Clock,
Inbox,
Mail,
MailOpen,
Siren,
TriangleAlert
} from "lucide-react";
import { useState } from "react";
import { systemClock } from "../../domain/clock.js";
import { settleCommandResult } from "../app/command-result.js";
import { Badge,Button,Chip,Drawer,DrawerContent,EmptyState,MetaLine,Refusal,dsFocus,dsIcon,dsMotion,dsText } from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import { useNotificationClient as useDashboardClient } from "../state/notification-client.js";
import {
elapsedSecondsBetween,
fmtElapsed
} from "./format.js";
import { NOTIFICATION_FILTERS,type NotificationFilterKey,type NotificationRowWire,type OrdinaryNotificationRowWire,notificationInboxView } from "./notification-bell-model.js";


/* ── notifications ───────────────────────────────────────────────────────── */

/**
 * The row facts ref dashboard-surfaces §2.6 deliberately keeps OFF the notification wire.
 *
 * The demo's row carries a body sentence, a trigger label, a ping/inbox
 * routing verdict, a dedupe count and an OS-delivery flag. This wire carries
 * none of them ON PURPOSE — §2.6's trigger union is ids, closed codes and
 * counts with no free-text field, which is the only way "notification text
 * carries no captured form contents" is enforceable at all (D138).
 *
 * So the markup below ports the demo whole and every one of those arms renders
 * ONLY when its field is present. None of THESE is, so a row is dot · glyph ·
 * title · age · actions — the honest shape of what the server actually said.
 * This is an on-record deviation from the demo, not a placeholder: nothing
 * here invents a body, a delivery verdict, or a repeat count.
 *
 * D262 moved ONE of them onto the wire, and only one: the row's `link`. It is
 * an id, not prose — the same line §2.6 draws inside the trigger union — and a
 * needs-you alert whose only affordance is "mark read" is an alert nobody can
 * act on.
 */
/**
 * The button's word, per link kind. It lives here rather than on the wire
 * because it is UI copy about a destination this surface owns; the SERVER says
 * which run, never what to call the trip.
 */
const NOTIFICATION_LINK_LABEL: Record<"run" | "failure", string> = {
  run: "Open run",
  failure: "Open failure",
};


/**
 * Severity's PAIR — the badge tone and the glyph — off one table, so a row can
 * never carry a red siren beside a neutral badge. The wire's three arms line up
 * with the demo's three: `error` is its `critical`, `warning` its `attention`.
 */
const SEVERITY_TONE: Record<
  OrdinaryNotificationRowWire["severity"],
  { badge: "danger" | "warning" | "neutral"; icon: typeof Siren }
> = {
  error: { badge: "danger", icon: Siren },
  warning: { badge: "warning", icon: TriangleAlert },
  info: { badge: "neutral", icon: Inbox },
};


/**
 * 2i-B: the inbox bell over ref dashboard-surfaces §2.6's durable rows, in the demo's own
 * anatomy — a raw square button with a corner superscript badge, and a 480px
 * Drawer holding the filter chips, the rows and the standing footer.
 *
 * Every row renders durable state; the wire is the fold, not a toast log. A
 * failed command is REPORTED rather than swallowed, which is the one place this
 * surface deliberately outgrows the demo: the demo has no server to refuse it.
 * Read/unread and snooze stay independent axes — snoozing does not mark read
 * (D138).
 */
export function NotificationBell({
  notifications,
  actorId,
  nowIso,
  onOpenRun,
}: {
  notifications: readonly NotificationRowWire[];
  actorId: string;
  /**
   * The app's ONE live instant (D256), passed in rather than read here. A
   * notification's age is a fact about a served instant, so it must be
   * measured against the clock every other served instant on this screen is
   * measured against — never against this browser's own wall clock.
   */
  nowIso: string;
  onOpenRun: (runId: string) => void;
}) {
  const client = useDashboardClient();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<NotificationFilterKey>("all");
  const [commandError, setCommandError] = useState<string | null>(null);
  const { pinned, shown, counts, empty, unread, critical } = notificationInboxView(notifications, filter);

  const issue = (
    type: "notification-read" | "notification-unread" | "notification-snooze",
    entry: OrdinaryNotificationRowWire,
  ): void => {
    setCommandError(null);
    client.executeCommand({
      commandId: crypto.randomUUID(),
      requestedAt: systemClock.now().toISOString(),
      requestedBy: actorId,
      source: "notification-bell",
      family: "notification",
      type,
      target: { notificationId: entry.notificationId, actorId, expectedVersion: entry.revision },
      ...(type === "notification-snooze"
        ? { payload: { until: new Date(systemClock.nowMs() + 3_600_000).toISOString() } }
        : {}),
    }).then((result) => {
      // D253 — a notification row carries its own `revision`, so a bell action
      // races the fold that marks the row unread again. Branching on `rejected`
      // alone swallowed that CAS refusal: the control did nothing and said
      // nothing, which reads as a broken button rather than a stale view.
      const settlement = settleCommandResult(result);
      if (settlement.kind === "refused") setCommandError(settlement.problem);
    }, (caught: unknown) => {
      setCommandError(caught instanceof Error ? caught.message : String(caught));
    });
  };

  return (
    <>
      <button
        type="button"
        aria-label={`Notifications — ${unread} unread`}
        onClick={() => setOpen(true)}
        className={cn(
          "relative flex items-center justify-center rounded-[var(--ds-radius-md)] p-[var(--ds-space-snug)] text-[color:var(--ds-fg-muted)]",
          "hover:bg-[var(--ds-surface-3)] hover:text-[color:var(--ds-fg)]",
          dsFocus,
          dsMotion.base,
        )}
      >
        <Bell aria-hidden className={dsIcon.md} />
        {unread > 0 && (
          // Dark ink on a bright fill — the same contract the two LOUD statuses
          // use (DESIGN.md). White numerals on this red fail AA at 10px. And
          // NOTHING is painted at zero: a permanently lit badge is chrome, not
          // a signal.
          <span
            aria-hidden
            className={cn(
              "absolute -right-0.5 -top-0.5 flex items-center justify-center rounded-full",
              "size-[var(--ds-space-cozy)] font-semibold",
              dsText.micro,
              dsText.nums,
              critical
                ? "bg-[var(--ds-status-failed-solid-bg)] text-[color:var(--ds-status-failed-solid-fg)]"
                : "bg-[var(--ds-status-waiting-solid-bg)] text-[color:var(--ds-status-waiting-solid-fg)]",
            )}
          >
            {unread}
          </span>
        )}
      </button>

      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent
          title="Notifications"
          description={`${unread} unread · pings are silent · a record survives a failed desktop delivery`}
          size="480px"
        >
          <div className="flex min-h-0 flex-1 flex-col">
            {/* A refused command is SAID, never dropped: the demo has no server
                to refuse one, and a silently failed Mark read would leave the
                operator believing they had cleared something they had not. */}
            {commandError !== null && (
              <div className="border-b border-[color:var(--ds-border)] px-[var(--ds-space-cozy)] py-[var(--ds-space-base)]">
                <span role="alert" className={cn(dsText.meta, "text-[color:var(--ds-danger)]")}>
                  {commandError}
                </span>
              </div>
            )}

            <div
              data-notification-filters
              className="flex shrink-0 flex-wrap items-center gap-[var(--ds-space-tight)] border-b border-[color:var(--ds-border)] bg-[var(--ds-surface-overlay)] px-[var(--ds-space-cozy)] py-[var(--ds-space-base)]"
            >
              {NOTIFICATION_FILTERS.map((entry) => (
                <Chip
                  key={entry.key}
                  selected={filter === entry.key}
                  onSelect={() => setFilter(entry.key)}
                  tone="neutral"
                >
                  {`${entry.label} ${counts[entry.key]}`}
                </Chip>
              ))}
            </div>

            <div data-notification-scroll className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {/* Permanent safety rows share the bounded content scroller with
                  ordinary rows. Six gaps cannot push the filters or the rest
                  of the inbox beyond the viewport; every row remains reachable. */}
              {pinned.length > 0 && (
                <section aria-label="Pinned safety notices">
                  {pinned.map((entry) => (
                    <div
                      key={entry.notificationId}
                      data-backfill-gap="pinned"
                      className="border-b border-[color:var(--ds-border)] p-[var(--ds-space-cozy)]"
                    >
                      <Refusal
                        title={entry.title}
                        code="event-stream-history-gap"
                        meta={[`${fmtElapsed(elapsedSecondsBetween(entry.occurredAt, nowIso))} ago`, "pinned"]}
                      >
                        <span className="flex flex-col gap-[var(--ds-space-tight)]">
                          <span>
                            The dashboard could not backfill part of the event stream. Resnapshot and reconcile the
                            affected work before relying on dashboard history.
                          </span>
                          <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>
                            This safety record cannot be filtered, marked read, snoozed or dismissed. A reconnect does
                            not clear it.
                          </span>
                        </span>
                      </Refusal>
                    </div>
                  ))}
                </section>
              )}

              {empty ? (
                <EmptyState
                  icon={<Inbox aria-hidden className={dsIcon.lg} />}
                  title="Nothing under this filter"
                  description="The records still exist — switch the filter to see them. A count that reads zero here never means a notification was deleted."
                />
              ) : (
                shown.map((entry) => (
                  <NotificationRow
                    key={entry.notificationId}
                    entry={entry}
                    nowIso={nowIso}
                    onRead={() =>
                      issue(entry.state === "unread" ? "notification-read" : "notification-unread", entry)}
                    onSnooze={() => issue("notification-snooze", entry)}
                    onOpen={() => {
                      if (entry.link === undefined) return;
                      onOpenRun(entry.link.runId);
                      setOpen(false);
                    }}
                  />
                ))
              )}
            </div>

            <footer
              className={cn(
                "border-t border-[color:var(--ds-border)] bg-[var(--ds-surface-2)] px-[var(--ds-space-cozy)] py-[var(--ds-space-base)]",
                dsText.meta,
                "text-[color:var(--ds-fg-muted)]",
              )}
            >
              Failed · gate · parked · repeating · storage ping. A clean finish is inbox-only. A notification is a durable
              record first and a desktop delivery second — a failed delivery still leaves an unread item here.
            </footer>
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}


function NotificationRow({
  entry,
  nowIso,
  onRead,
  onSnooze,
  onOpen,
}: {
  entry: OrdinaryNotificationRowWire;
  nowIso: string;
  onRead: () => void;
  onSnooze: () => void;
  onOpen: () => void;
}) {
  const spec = SEVERITY_TONE[entry.severity];
  const Icon = spec.icon;
  const unread = entry.state === "unread";
  const snoozing = entry.state === "snoozed";
  const badges =
    entry.triggerLabel !== undefined
    || entry.delivery !== undefined
    || (entry.count !== undefined && entry.count > 1)
    || entry.desktopDelivered === false;

  return (
    <article
      className={cn(
        "flex flex-col gap-[var(--ds-space-tight)] border-b border-[color:var(--ds-border-subtle)] px-[var(--ds-space-cozy)] py-[var(--ds-space-base)]",
        snoozing && "opacity-60",
      )}
    >
      <div className="flex min-w-0 items-center gap-[var(--ds-space-snug)]">
        {unread && <span aria-label="unread" className="size-1.5 shrink-0 rounded-full bg-[var(--ds-accent)]" />}
        <Icon
          aria-hidden
          className={cn(
            dsIcon.md,
            "shrink-0",
            entry.severity === "error" ? "text-[color:var(--ds-danger)]" : "text-[color:var(--ds-fg-muted)]",
          )}
        />
        <span
          className={cn(
            dsText.ui,
            "min-w-0 flex-1 truncate",
            unread ? "font-semibold text-[color:var(--ds-fg)]" : "text-[color:var(--ds-fg-secondary)]",
          )}
        >
          {entry.title}
        </span>
        <MetaLine
          className="shrink-0"
          items={[`${fmtElapsed(elapsedSecondsBetween(entry.occurredAt, nowIso))} ago`]}
        />
      </div>

      {entry.body !== undefined && (
        <p className={cn(dsText.body, "text-[color:var(--ds-fg-muted)]")}>{entry.body}</p>
      )}

      {badges && (
        <div className="flex flex-wrap items-center gap-[var(--ds-space-tight)]">
          {entry.triggerLabel !== undefined && <Badge tone={spec.badge}>{entry.triggerLabel}</Badge>}
          {entry.delivery !== undefined && (
            <Badge tone={entry.delivery === "ping" ? "info" : "neutral"}>
              {entry.delivery === "ping" ? "Ping" : "Inbox only"}
            </Badge>
          )}
          {entry.count !== undefined && entry.count > 1 && (
            <Chip label="repeats">{`+${entry.count - 1} more like this`}</Chip>
          )}
          {entry.desktopDelivered === false && (
            <Badge
              tone="warning"
              title="The desktop notification never appeared. The record is here anyway — that is the point of durability."
            >
              delivery failed
            </Badge>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-[var(--ds-space-tight)]">
        {entry.link !== undefined && (
          <Button size="sm" variant="secondary" onClick={onOpen}>
            {NOTIFICATION_LINK_LABEL[entry.link.kind]}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          icon={unread ? <MailOpen aria-hidden className={dsIcon.sm} /> : <Mail aria-hidden className={dsIcon.sm} />}
          onClick={onRead}
        >
          {unread ? "Mark read" : "Mark unread"}
        </Button>
        {/* THE UN-SNOOZE ARM KEEPS ITS PLACE AND SAYS WHY IT CANNOT FIRE. The
            kernel serves `notification-snooze` and no inverse, so a live
            Un-snooze here would 422 on click. Hiding the control instead —
            what this surface used to do — moves every button beside it the
            moment a row snoozes. */}
        <Button
          size="sm"
          variant="ghost"
          icon={<Clock aria-hidden className={dsIcon.sm} />}
          disabled={snoozing}
          title={snoozing ? "This build serves no un-snooze command; the snooze expires on its own" : undefined}
          onClick={onSnooze}
        >
          {snoozing ? "Un-snooze" : "Snooze 1h"}
        </Button>
      </div>
    </article>
  );
}
