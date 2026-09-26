import type { OpenNotification } from "../state/notification-navigation.js";
import {
Moon,
ShieldCheck,
Sun
} from "lucide-react";
import { type ReactElement,memo } from "react";
import type { CrossDateSearchResult } from "../../domain/dashboard/search.js";
import { BareButton,DEMO_THEME_LABEL,type DemoTheme,IconButton,dsBorder,dsFocus,dsIcon,dsMotion,dsRadius,dsSize,dsSurface,dsText } from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import { type DayCountWire } from "./date-navigation-model.js";
import { DateNav } from "./date-navigation.js";
import { DaySearchControl } from "./day-search.js";
import type { NavControls } from "./navigation-controls.js";
import { NavHistoryControls } from "./navigation-controls.js";
import { type NotificationRowWire } from "./notification-bell-model.js";
import { NotificationBell } from "./notification-bell.js";
import { type PreflightCheckWire } from "./preflight-popover-model.js";
import { PreflightPopover } from "./preflight-popover.js";
import type { QueueSurfaceWire } from "./queue-model.js";
import { SettingsGear } from "./settings.js";
import { type StorageHealthSummary } from "./storage-settings-model.js";
import { SEGMENTED_FRAME } from "./top-bar-layout-model.js";
import { SHELL_VIEWS,SHELL_VIEW_LABEL,type ShellView,type ShellViewSelection } from "./top-bar-model.js";


/*
 * ── shortcuts ────────────────────────────────────────────────────────────────
 *
 * `ShortcutsPopover` STOOD HERE and is gone (D274 item 5). It had zero callers
 * and was kept, in its own words, "for the Settings → Help group and the global
 * `?` binding that own it next". The Settings → Help group now exists and
 * renders the one registry through `DemoShortcutsLegend` directly, at reading
 * size with its scopes named; the `?` binding is not ruled and the ratified
 * option explicitly rejected restoring a second top-bar door. Its stated future
 * arrived and did not want it, so keeping it would be two operator-facing
 * renderings of one registry with only one of them ever on screen — the exact
 * shape the shortcuts module warns about.
 */

/**
 * One bordered container, four segments — the same shape the Status Bar's
 * `All` / `Needs you` composite uses, because both answer "which of these am I
 * looking at" rather than "do this".
 */
function ShellViewSwitcher({
  view,
  onView,
}: {
  view: ShellViewSelection;
  onView: (view: ShellView) => void;
}): ReactElement {
  return (
    <div className={SEGMENTED_FRAME}>
      {SHELL_VIEWS.map((candidate) => (
        <BareButton
          key={candidate}
          type="button"
          aria-pressed={view === candidate}
          onClick={() => onView(candidate)}
          className={cn(
            "inline-flex h-full cursor-pointer items-center px-[var(--ds-space-base)]",
            dsRadius.sm,
            dsText.meta,
            dsFocus,
            dsMotion.fast,
            view === candidate
              ? "bg-[var(--ds-surface-3)] font-semibold text-[color:var(--ds-fg)]"
              : "font-medium text-[color:var(--ds-fg-muted)] hover:text-[color:var(--ds-fg)]",
          )}
        >
          {SHELL_VIEW_LABEL[candidate]}
        </BareButton>
      ))}
    </div>
  );
}


/* ── the bar ─────────────────────────────────────────────────────────────── */

/**
 * The Top Bar.
 */
/**
 * D4 (Track D, ref frontend-backend-integration §7.4; audit finding P1) — this
 * panel is `memo`'d, and every prop it takes is stable or primitive at the one
 * place that renders it (`app/dashboard-app.tsx`;
 * `dashboard-memo-prop-stability` refuses an inline object, array, arrow or
 * call in any of its prop slots, because ONE of those turns this wrapper into
 * pure overhead).
 *
 * The bar takes `nowIso` — the app's live instant (D256) — so like the queue
 * it redraws once a second by design; `memo` removes the re-renders BETWEEN
 * ticks, which is every command dispatch, every dialog, every run-detail
 * section fetch and every SSE patch that does not move the day's rows.
 */
export const TopBar = memo(function TopBar({
  notifications,
  onOpenNotification,
  notificationConnected,
  actorId,
  nowIso,
  preflight,
  onPreflightRerun,
  storage,
  settingsOpen,
  onOpenSettings,
  day,
  today,
  monthCounts,
  onToday, dateError, calendarRevision, dayState,
  onDay,
  theme,
  onToggleTheme,
  nav,
  view,
  onView,
  daySurfaces,
  workflowLabelOf,
  onOpenRun,
  onOpenCrossDateResult,
}: {
  notifications: readonly NotificationRowWire[];
  onOpenNotification: OpenNotification;
  notificationConnected: boolean;
  actorId: string;
  /**
   * The app's ONE live instant (D256) — the same value the queue rows, the
   * gate pill and the session footer date themselves from. The bell used to
   * read `systemClock.now()` here, which put a SECOND clock on one screen: a
   * browser whose wall clock is off would have aged a notification against an
   * instant no served fact was measured with.
   */
  nowIso: string;
  /**
   * The doctor's retained served report (ref frontend-backend-integration
   * §3.1). The current dashboard supplies it; optionality preserves an older
   * producer's honest absence, which keeps the stethoscope off the bar.
   */
  preflight?: readonly PreflightCheckWire[];
  /** The served rerun route's typed caller; DCC3 still owns this screen control. */
  onPreflightRerun?: () => void;
  /** the bootstrap's storage health summary — the gear's attention dot (2i-D) */
  storage: StorageHealthSummary;
  /**
   * Whether the Settings TAKEOVER owns the main region (D272 item 1). The gear
   * only reports and requests: the page is a route, so the app owns the state
   * and the bar reads it — the storage banner above every view opens the same
   * page this gear does, and the served section list travels with the page
   * rather than through the bar that never renders it.
   */
  settingsOpen: boolean;
  onOpenSettings: () => void;
  /** the day partition the whole app is reading */
  day: string;
  today: string;
  monthCounts: readonly DayCountWire[];
  onToday: () => void;
  dateError?: string;
  calendarRevision?: object;
  dayState?: "loaded" | "loading" | "failed";
  onDay: (day: string) => void;
  theme: DemoTheme;
  onToggleTheme: () => void;
  nav: NavControls;
  /**
   * Which product view owns the main region — the switcher's pressed segment,
   * or `"none"` when the takeover on screen is one the switcher does not name
   * (Settings, intake, the catalog). See `app/url-state.ts`'s `shellViewOf`.
   */
  view: ShellViewSelection;
  onView: (view: ShellView) => void;
  /** the whole day's projection — what the search control finds over */
  daySurfaces: readonly QueueSurfaceWire[];
  workflowLabelOf: (workflowId: string) => string;
  onOpenRun: (runId: string) => void;
  onOpenCrossDateResult: (result: CrossDateSearchResult) => void;
}) {
  return (
    <header
      className={cn(
        "flex shrink-0 items-center border-b",
        dsSize.hTopbar,
        dsBorder.base,
        dsSurface.card,
        "gap-[var(--ds-space-cozy)] px-[var(--ds-shell-inset)]",
      )}
    >
      {/* The app's name is the page's ONE h1. It reads at `dsText.ui` like the
          chrome it is — heading LEVEL is the document outline, not a type size. */}
      <div className="flex shrink-0 items-center gap-[var(--ds-space-base)]">
        <span
          aria-hidden
          className={cn("flex items-center justify-center", dsRadius.md, "size-[var(--ds-h-sm)] bg-[var(--ds-accent-quiet)]")}
        >
          <ShieldCheck className={cn(dsIcon.md, "text-[color:var(--ds-accent-mark)]")} />
        </span>
        <h1 className={cn(dsText.ui, dsText.flush, "font-semibold text-[color:var(--ds-fg)]")}>HR Automation</h1>
      </div>

      {/* Product navigation sits beside the history pair: both are ways of
          changing WHERE YOU ARE, and the switcher is the deliberate one. */}
      <span className="contents">
        <NavHistoryControls nav={nav} />
      </span>

      <span className="contents">
        <ShellViewSwitcher view={view} onView={onView} />
      </span>

      {/* SEARCH AND THE DATE ARE ONE GROUP, and the group takes the bar's whole
          slack (2026-09-01). They used to be two `sm:contents` spans carrying
          an `ml-auto` EACH — the search's and the icon cluster's — and two
          `ml-auto`s do not stack, they SPLIT the free space: at 1440 that left
          the pair beached 212px short of the icons, in the middle of nowhere.
          One `flex-1 justify-end` group instead, so the bar has the two anchors
          it reads as: identity and where-you-are on the left, what you are
          looking at and the quiet tools on the right. The date here IS the day
          the queue reads. */}
      <span
        className={cn(
          "flex min-w-0 flex-1 items-center justify-end",
          "gap-[var(--ds-space-snug)]",
        )}
      >
        <DaySearchControl
          surfaces={daySurfaces}
          day={day}
          workflowLabelOf={workflowLabelOf}
          onOpenRun={onOpenRun}
          onOpenCrossDateResult={onOpenCrossDateResult}
        />
        <DateNav day={day} today={today} monthCounts={monthCounts} onDay={onDay} onToday={onToday} dateError={dateError} calendarRevision={calendarRevision} dayState={dayState} />
      </span>

      <span className="flex shrink-0 items-center gap-[var(--ds-space-hair)]">
        {/* Preflight stays on screen whenever bootstrap serves its retained
            report, rather than three clicks inside a page of preferences. Its
            glyph carries the worst verdict. Only an older producer's honest
            absence removes it, because an indicator over no report would
            invent a pass. */}
        <PreflightPopover checks={preflight} onRerun={onPreflightRerun} />
        <NotificationBell notifications={notifications} actorId={actorId} nowIso={nowIso} onOpenNotification={onOpenNotification} connected={notificationConnected} />
        {/* THE KEYBOARD GLYPH IS GONE. Operator, on the demo: *"the keyboard
            icon will be removed from there since we already have help in
            settings."* The destination that instruction traded it for now
            exists: the gear → Settings → Help → Keyboard (D274 item 5), which
            renders the one registry through `DemoShortcutsLegend` directly.
            Restoring the glyph was option C and was rejected — it reverses the
            stated reason it was removed. */}
        {/* The theme pair. One control, and its LABEL names the destination
            ("Switch to Paper Ink"), because a lone sun/moon glyph never says
            which of the two states it is reporting. */}
        <IconButton
          size="sm"
          label={`Switch to ${DEMO_THEME_LABEL[theme === "dark" ? "light" : "dark"]}`}
          onClick={onToggleTheme}
          icon={
            theme === "dark" ? (
              <Sun aria-hidden className={dsIcon.md} />
            ) : (
              <Moon aria-hidden className={dsIcon.md} />
            )
          }
        />
        {/* THE CATALOG GLYPH IS GONE from the bar by operator decision — the
            UI catalog stays reachable through its URL route (`?catalog=`),
            which is what the parity lane already drives. */}
        {/* The gear opens Settings. It sits last, as in the demo. */}
        <SettingsGear storage={storage} open={settingsOpen} onOpen={onOpenSettings} />
      </span>
    </header>
  );
});
export { DateNav } from "./date-navigation.js";
export { NavHistoryControls } from "./navigation-controls.js";
export type { NavControls } from "./navigation-controls.js";
export { NotificationBell } from "./notification-bell.js";
