/**
 * The generated UI catalog surface (ref operator-trust §1.3, ref dashboard-surfaces §13, D177),
 * mounted as the `ui-catalog` section of the Settings takeover (D295).
 *
 * ## What this is, and why it is worth a surface
 *
 * `generated/ui-catalog.json` is the canonical answer to "what does this system
 * know how to see and touch on a page, and when was that last verified against
 * the live system". Before it had a surface it was reachable only from a CLI
 * (`npm run selector:search`) and from two markdown projections. The operator
 * who needs it most is the one already in the dashboard looking at a failed
 * run, and the ONE thing that would make them distrust it is a catalog that
 * disagrees with the drivers — so the server refuses to serve a stale artifact
 * at all, and this surface renders that refusal in the generator's own words.
 *
 * ## SHAPE — a rail beside a record (2026-09-01)
 *
 * The first cut drew every entry as a seven-line block of identical chips:
 * five entries per screen out of 118, the same `system` / `owner` / evidence
 * chips repeated on every row of a system, and screens flattened into one list
 * with the elements that live on them. The operator's verdict was that it could
 * not be followed. This is the Explorer's shape instead (ref dashboard-surfaces
 * §9.5.3 — "the same contract at system scope"): a **rail** of every id, nested
 * under the screen it names and grouped by system, beside a **record** column
 * that prints the selected entry whole. The rail answers "what is here"; the
 * record answers "what is this one", which is the question an operator arrives
 * holding.
 *
 * ## Provenance — the one deliberate bend
 *
 * ref operator-trust §5.8 says provenance sits beside the id, never behind a
 * disclosure a hurried reader skips. The rail keeps `verifiedAt` on every row at
 * the id's own weight; both evidence refs are printed in full on the record,
 * one click away and never collapsed. That is a bend of "on the same line",
 * ratified by the operator on 2026-09-01 in exchange for a catalog that can be
 * read.
 *
 * It is strictly read-only: there is no control here that writes anything, and
 * regenerating is deliberately not offered. `npm run ui:catalog` is the one
 * writer, and a surface that regenerated on demand would silently heal a stale
 * checkout — the exact failure the 2026-08-03 tracked-artifact lesson records.
 */
import { useCallback, useEffect, useId, useMemo, useState, type KeyboardEvent } from "react";
import { BookMarked, CircleAlert, ScanEye } from "lucide-react";
import type { UiCatalogWire } from "../../domain/dashboard/explorer.js";
import type { UiCatalogEntry } from "../../domain/ui/contracts.js";
import {
  Badge,
  Banner,
  Chip,
  EmptyState,
  KeyValueList,
  Panel,
  PanelHeader,
  PanelToolbar,
  SearchInput,
  SectionLabel,
  Spinner,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  dsClip,
  dsFocus,
  dsIcon,
  dsMotion,
  dsText,
} from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import { RowCatalogView } from "./row-catalog.js";
import { parseCatalogView, type CatalogView } from "./row-catalog-model.js";
import {
  ENTRY_KIND,
  catalogRowDomId,
  foldCatalogRail,
  railDisplayId,
  resolveCatalogSelection,
  siblingsOnScreen,
  stepCatalogSelection,
  type CatalogRail,
  type CatalogSelectionRequest,
} from "./ui-catalog-model.js";
import { failed, loaded, LOADING, type AsyncResource } from "../state/async-resource.js";
import { DashboardClientError } from "../client/index.js";
import { useDashboardClient } from "../state/client-context.js";

/**
 * A wrapping row of chips, packed rather than tracked.
 *
 * The DS's `ChipRow` lays chips on an equal-width GRID so a wrapped set ends on
 * one edge instead of leaving an orphan — which is exactly right in the queue's
 * ~400px column, where it was designed. The record column is the other case: a
 * dozen SHORT facts (`role field`, `effect prepare`) where `auto-fit` cuts
 * seven 160px tracks and every chip sits alone at the left of one. So the facts
 * pack, and the ragged right edge is the deliberate cost.
 */
function FactChips({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <div
      aria-label={label}
      className="flex min-w-0 flex-wrap items-center gap-[var(--ds-space-tight)]"
    >
      {children}
    </div>
  );
}

/** The rail's one-letter kind glyph, at the chip's own height so rows stay 40px. */
function KindMark({ kind }: { kind: UiCatalogEntry["kind"] }) {
  const meta = ENTRY_KIND[kind];
  return (
    <Badge tone={meta.tone} title={meta.word} className="w-5 shrink-0 justify-center px-0">
      <span aria-hidden>{meta.mark}</span>
      <span className="sr-only">{meta.word}</span>
    </Badge>
  );
}

/**
 * One rail row: the id first and loud, the label beneath it, the verified
 * date on the id's line at the id's weight (the §5.8 half the rail keeps).
 *
 * `role="option"` inside the rail's `listbox`: a single-select list whose
 * arrow keys move the selection is what this is, and the roving `tabIndex`
 * gives the selected row the one tab stop.
 */
function RailRow({
  entry,
  domId,
  selected,
  nested,
  onSelect,
}: {
  entry: UiCatalogEntry;
  domId: string;
  selected: boolean;
  nested: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      id={domId}
      role="option"
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      onClick={onSelect}
      title={String(entry.id)}
      className={cn(
        "flex min-w-0 cursor-pointer items-start gap-[var(--ds-space-base)] border-l-[length:var(--ds-border-w-rail)]",
        "py-[var(--ds-space-snug)] pr-[var(--ds-space-cozy)]",
        nested ? "pl-[var(--ds-space-section)]" : "pl-[var(--ds-space-base)]",
        dsFocus,
        dsMotion.base,
        selected
          ? "border-l-[color:var(--ds-accent)] bg-[var(--ds-surface-selected)]"
          : "border-l-transparent hover:bg-[var(--ds-surface-3)]",
      )}
    >
      <span className="pt-px"><KindMark kind={entry.kind} /></span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-baseline gap-[var(--ds-space-base)]">
          <span
            className={cn(
              dsText.ui,
              dsText.nums,
              dsClip.text,
              "min-w-0 flex-1",
              entry.kind === "screen" || selected ? "font-semibold text-[color:var(--ds-fg)]" : "font-medium text-[color:var(--ds-fg-secondary)]",
            )}
          >
            {railDisplayId(entry)}
          </span>
          <span className={cn(dsText.meta, dsText.nums, "shrink-0 text-[color:var(--ds-fg-muted)]")}>
            {entry.verification.verifiedAt}
          </span>
        </span>
        <span className={cn(dsText.meta, dsClip.text, "text-[color:var(--ds-fg-muted)]")}>{entry.label}</span>
      </span>
    </div>
  );
}

function CatalogRailView({
  rail,
  baseId,
  selectedId,
  onSelect,
}: {
  rail: CatalogRail;
  baseId: string;
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}) {
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
      const next = stepCatalogSelection(rail.rows, selectedId, event.key);
      if (next === undefined) return;
      event.preventDefault();
      onSelect(String(next.id));
      // The row is already mounted (the rail draws every row), so focus can
      // move in the same tick the selection does.
      document.getElementById(catalogRowDomId(baseId, String(next.id)))?.focus();
    },
    [rail.rows, selectedId, onSelect, baseId],
  );

  return (
    <div
      role="listbox"
      aria-label="Catalog entries"
      aria-activedescendant={selectedId === undefined ? undefined : catalogRowDomId(baseId, selectedId)}
      onKeyDown={onKeyDown}
      className="min-h-0 overflow-y-auto border-r border-[color:var(--ds-border)]"
    >
      {rail.systems.map((system) => (
        <div key={system.system} role="group" aria-label={system.system}>
          {/*
            Grouping is not decoration: an operator debugging a Kuali page has
            no use for a CRM element between two of theirs, and the systems ARE
            the top-level partition of the registries the catalog is composed
            from. Sticky, so the system a row belongs to is always in view.
          */}
          <div
            className={cn(
              "sticky top-0 z-10 flex items-center gap-[var(--ds-space-snug)] border-y border-[color:var(--ds-border)]",
              "h-[var(--ds-h-sm)] bg-[var(--ds-recess-bg)] px-[var(--ds-space-cozy)]",
            )}
          >
            <SectionLabel className="text-[color:var(--ds-fg-secondary)]">{system.system}</SectionLabel>
            <SectionLabel>
              · {String(system.matchedCount)} entr{system.matchedCount === 1 ? "y" : "ies"}
            </SectionLabel>
          </div>
          {system.screens.map(({ screen, children }) => (
            <div key={String(screen.id)}>
              <RailRow
                entry={screen}
                domId={catalogRowDomId(baseId, String(screen.id))}
                selected={selectedId === String(screen.id)}
                nested={false}
                onSelect={() => onSelect(String(screen.id))}
              />
              {children.map((child) => (
                <RailRow
                  key={String(child.id)}
                  entry={child}
                  domId={catalogRowDomId(baseId, String(child.id))}
                  selected={selectedId === String(child.id)}
                  nested
                  onSelect={() => onSelect(String(child.id))}
                />
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * The selected entry, whole. Every served field is printed; nothing is behind
 * a disclosure. The scenarios are NAMED, not counted (D276 item 5, ledger 3
 * CA59): a count is the one shape of provenance that cannot be checked.
 */
function CatalogRecord({
  entry,
  siblings,
  onSelect,
}: {
  entry: UiCatalogEntry;
  siblings: readonly UiCatalogEntry[];
  onSelect: (id: string) => void;
}) {
  const kind = ENTRY_KIND[entry.kind];
  const verification = entry.verification;
  return (
    <article
      aria-label={`${kind.word} ${String(entry.id)}`}
      className="flex min-w-0 flex-col gap-[var(--ds-space-loose)] px-[var(--ds-space-loose)] py-[var(--ds-space-cozy)] [&>*]:max-w-[var(--ds-w-explorer-measure)]"
    >
      <header className="flex min-w-0 flex-col gap-[var(--ds-space-tight)]">
        <div className="flex min-w-0 flex-wrap items-center gap-[var(--ds-space-base)]">
          <Badge tone={kind.tone}>{kind.word}</Badge>
          <h3 className={cn(dsText.title, dsText.nums, "min-w-0 break-all font-semibold text-[color:var(--ds-fg)]")}>
            {String(entry.id)}
          </h3>
        </div>
        <p className={cn(dsText.body, "text-[color:var(--ds-fg-secondary)]")}>{entry.label}</p>
        <FactChips label="Facts">
          <Chip label="system">{entry.system}</Chip>
          {"screen" in entry && <Chip label="screen">{String(entry.screen)}</Chip>}
          {"role" in entry && <Chip label="role">{entry.role}</Chip>}
          {"effect" in entry && (
            // `effect` is the one field that separates reading a page from
            // acting on it, so a non-observing element is marked rather than
            // sitting in a row of identical neutral chips.
            <Chip label="effect" tone={entry.effect === "observe" ? "neutral" : "warning"}>
              {entry.effect}
            </Chip>
          )}
          {"authoritativeFor" in entry && (
            <Chip label="authoritative for" tone="info">
              {entry.authoritativeFor.join(", ")}
            </Chip>
          )}
          <Chip label="sensitivity" tone={entry.sensitivity === "hr" ? "warning" : "neutral"}>
            {entry.sensitivity}
          </Chip>
        </FactChips>
      </header>

      <section aria-label="Provenance" className="flex flex-col gap-[var(--ds-space-base)]">
        <SectionLabel className="border-b border-[color:var(--ds-border)] pb-[var(--ds-space-tight)]">Provenance</SectionLabel>
        <KeyValueList
          items={[
            {
              key: "Verified",
              value: (
                <span className="inline-flex items-center gap-[var(--ds-space-tight)]">
                  <ScanEye aria-hidden className={cn(dsIcon.sm, "shrink-0 text-[color:var(--ds-fg-muted)]")} />
                  {verification.verifiedAt}
                </span>
              ),
            },
            { key: "Fixture evidence", value: verification.fixtureEvidenceRef },
            { key: "Live evidence", value: verification.liveReadOnlyEvidenceRef },
            { key: "Owner", value: entry.sourceLink },
          ]}
        />
        <FactChips label="Verified by">
          <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>verified by</span>
          {verification.scenarios.map((scenario) => (
            <Chip key={String(scenario)}>{String(scenario)}</Chip>
          ))}
        </FactChips>
      </section>

      <section aria-label="Usage" className="flex flex-col gap-[var(--ds-space-base)]">
        <SectionLabel className="border-b border-[color:var(--ds-border)] pb-[var(--ds-space-tight)]">Usage</SectionLabel>
        <FactChips label="Used by">
          <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>used by</span>
          {entry.taskUses.length === 0 ? (
            <span className={cn(dsText.meta, "text-[color:var(--ds-fg-faint)]")}>no task</span>
          ) : (
            entry.taskUses.map((taskId) => <Chip key={String(taskId)}>{String(taskId)}</Chip>)
          )}
        </FactChips>
        <FactChips label="Search terms">
          <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>search</span>
          {entry.searchTerms.map((term) => (
            <Chip key={term}>{term}</Chip>
          ))}
        </FactChips>
      </section>

      {siblings.length > 0 && (
        <section aria-label="On the same screen" className="flex flex-col gap-[var(--ds-space-base)]">
          <SectionLabel className="border-b border-[color:var(--ds-border)] pb-[var(--ds-space-tight)]">On the same screen</SectionLabel>
          {/*
            Derived from the served `screen` field, so a chip here is a fact
            about the registry and not a guess. Selecting one moves the record,
            which is the one interaction this read-only surface has.
          */}
          <FactChips>
            {siblings.map((sibling) => (
              <Chip key={String(sibling.id)} onSelect={() => onSelect(String(sibling.id))} title={sibling.label}>
                {String(sibling.id)}
              </Chip>
            ))}
          </FactChips>
        </section>
      )}
    </article>
  );
}

/**
 * The catalog, in TWO views (D274 item 4), as a Settings section (D295).
 *
 * `selectors` is the generated selector-semantics catalog this surface has
 * always been. `vocabulary` is the row-and-panel reference the demo carries and
 * this tree had nowhere to put — it lives here rather than behind a third route
 * key because both answer "what does this system call the thing I am looking
 * at", and the view is route-owned (`?catalogView=`) for the same reason the
 * Archive's is: a door from elsewhere must be able to land on the actual panel
 * in one navigation, and a local state authority beside a URL is two answers to
 * one question.
 *
 * The SELECTION is local, as the Explorer's node selection is: a search term
 * is what a link carries, and the record it opens on is the term's first hit.
 *
 * D295 moved it out of its own takeover and under `?settings=ui-catalog`. It
 * takes NO `onClose`: the containing Settings takeover already owns exactly one
 * `Back to the dashboard`, and a second close control inside its content pane
 * would be two exits from one page — the duplicate-door problem the Activity
 * report's missing back button was ruled on for (D275 item 2).
 */
export function UiCatalogSection({
  query,
  onQuery,
  view,
  onView,
}: {
  query: string;
  onQuery: (next: string) => void;
  view: CatalogView;
  onView: (next: CatalogView) => void;
}) {
  const client = useDashboardClient();
  const [resource, setResource] = useState<AsyncResource<UiCatalogWire>>(LOADING);
  const [request, setRequest] = useState<CatalogSelectionRequest | undefined>(undefined);
  const baseId = useId();

  // The vocabulary view reads no server artifact at all, so it must not ask for
  // one: a fetch fired for a panel that never renders its result is a request
  // whose only visible effect is a refusal banner on the wrong screen.
  useEffect(() => {
    if (view !== "selectors") return undefined;
    let live = true;
    setResource(LOADING);
    client.uiCatalog().then(
      (value) => {
        if (live) setResource(loaded(value));
      },
      (error: unknown) => {
        if (!live) return;
        if (error instanceof DashboardClientError) {
          setResource(failed(error));
          return;
        }
        throw error;
      },
    );
    return () => {
      live = false;
    };
  }, [client, view]);

  const wire = resource.state === "loaded" ? resource.value : undefined;
  const rail = useMemo(() => foldCatalogRail(wire?.entries ?? [], query), [wire, query]);
  const selected = resolveCatalogSelection(wire?.entries ?? [], rail, request, query);
  const siblings = useMemo(
    () => (wire === undefined || selected === undefined ? [] : siblingsOnScreen(wire.entries, selected)),
    [wire, selected],
  );
  const select = useCallback((id: string) => setRequest({ id, query }), [query]);

  return (
    /*
      D295. A Settings SECTION, so the takeover, its region name and its own
      close control all belong to `SettingsPage` now — this draws the demo's
      `Panel` + `PanelHeader` + body shape every other Settings destination
      draws (SE45).
    */
    <Panel className="min-h-0 flex-1">
      <PanelHeader
        title="UI catalog"
        headingLevel={2}
        subtitle={
          view === "selectors"
            ? "The committed selector-semantics catalog, exactly as generated"
            : "The row and panel vocabulary, as this build serves it"
        }
        icon={<BookMarked aria-hidden className={dsIcon.md} />}
        // The source path names the BYTES the selector view served. The
        // vocabulary view serves no artifact — it is derived from the schemas
        // in this bundle — so it names none rather than borrowing one.
        meta={view === "selectors" && wire !== undefined ? <span>{wire.sourcePath}</span> : undefined}
      />

      {/*
        The view switch is the DS's own `Tabs` rather than two buttons, so the
        two panels get roving arrow-key focus and a real `aria-controls` target.
        Its value is the ROUTE's, so pressing a tab navigates — which is what
        puts the view in history and makes it linkable.
      */}
      <Tabs
        value={view}
        onValueChange={(next) => {
          const parsed = parseCatalogView(next);
          // A tab whose value is not a view would silently do nothing; the
          // strip and the parser are the two halves of one vocabulary.
          if (parsed === undefined) throw new Error(`catalog tab ${next} is not a catalog view`);
          onView(parsed);
        }}
        className="min-h-0 flex-1"
      >
        <PanelToolbar label="Catalog views">
          <TabList label="Catalog views">
            <Tab value="selectors">Selectors</Tab>
            <Tab value="vocabulary">Rows &amp; panels</Tab>
          </TabList>
        </PanelToolbar>

        <TabPanel value="vocabulary" className="px-[var(--ds-space-cozy)] [&>*]:max-w-[var(--ds-w-explorer-measure)]">
          <RowCatalogView />
        </TabPanel>

        {/*
          The search and the entry count live INSIDE the tabpanel they filter,
          so a reader who moves from the tab into its panel — which is what
          `aria-controls` promises — arrives at the only control on the view.
          The panel is a column, not a scroll container: the rail and the
          record scroll on their own, so the toolbar never leaves the top.
        */}
        <TabPanel value="selectors" className="flex flex-col overflow-hidden">
          <PanelToolbar label="Search the UI catalog" className="px-[var(--ds-space-cozy)]">
            <SearchInput
              className="w-full max-w-[28rem]"
              value={query}
              aria-label="Search the UI catalog by id, label, system or search term"
              placeholder="kuali save · observation · ucpath person org"
              onChange={(event) => onQuery(event.currentTarget.value)}
              onClear={() => onQuery("")}
            />
            {wire !== undefined && (
              <span className={cn(dsText.meta, dsText.nums, "ml-auto shrink-0 text-[color:var(--ds-fg-muted)]")}>
                {rail.matchedCount === wire.entries.length
                  ? `${String(wire.entries.length)} entries`
                  : `${String(rail.matchedCount)} of ${String(wire.entries.length)} entries`}
              </span>
            )}
          </PanelToolbar>

          {resource.state === "loading" && (
            <div className="flex items-center gap-[var(--ds-space-tight)] px-[var(--ds-space-cozy)] py-[var(--ds-space-base)] text-[color:var(--ds-fg-muted)]">
              <Spinner label="Loading the UI catalog" />
              <span className={dsText.body}>Reading the committed catalog…</span>
            </div>
          )}

          {resource.state === "failed" && (
            // A stale artifact arrives here, carrying the generator's own
            // remediation. It is a refusal, not an outage: serving the stale
            // bytes would describe selectors this build does not use.
            <div className="px-[var(--ds-space-cozy)] py-[var(--ds-space-base)]">
              <Banner tone="danger" title="The committed UI catalog could not be served">
                {resource.error.message}
              </Banner>
            </div>
          )}

          {wire !== undefined && selected === undefined && (
            <div className="px-[var(--ds-space-cozy)]">
              <EmptyState
                icon={<CircleAlert aria-hidden className={dsIcon.lg} />}
                title={`Nothing in the catalog matches “${query}”`}
                description={
                  `All ${String(wire.entries.length)} entries were searched by id, label, system, kind `
                  + "and registered search terms. Try one word — a system (kuali), a kind (observation), "
                  + "or part of an id (timekeeper)."
                }
              />
            </div>
          )}

          {wire !== undefined && selected !== undefined && (
            /*
              The split keys on the panel's own width: the rail takes the
              Explorer's 232px column at the narrow rung and widens once the
              record has room to spare, so an id truncates in the rail before
              the record loses its measure.
            */
            <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,232px)_minmax(0,1fr)] min-[1280px]:grid-cols-[minmax(0,400px)_minmax(0,1fr)]">
              <CatalogRailView rail={rail} baseId={baseId} selectedId={String(selected.id)} onSelect={select} />
              <div className="min-h-0 overflow-y-auto">
                <CatalogRecord entry={selected} siblings={siblings} onSelect={select} />
              </div>
            </div>
          )}
        </TabPanel>
      </Tabs>
    </Panel>
  );
}
