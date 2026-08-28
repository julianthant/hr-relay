/**
 * The generated UI catalog surface (ref operator-trust §1.3, ref dashboard-surfaces §13, D177).
 *
 * ## What this is, and why it is worth a surface
 *
 * `generated/ui-catalog.json` is the canonical answer to "what does this system
 * know how to see and touch on a page, and when was that last verified against
 * the live system". Until now it was reachable only from a CLI
 * (`npm run selector:search`) and from two markdown projections. The operator
 * who needs it most is the one already in the dashboard looking at a failed
 * run, and the ONE thing that would make them distrust it is a catalog that
 * disagrees with the drivers — so the server refuses to serve a stale artifact
 * at all, and this surface renders that refusal in the generator's own words.
 *
 * ## THESIS — provenance sits beside the id, not behind it
 *
 * A selector catalog read without its verification date is worse than no
 * catalog: it invites acting on a mapping that may have rotted, and ref operator-trust §10
 * says plainly that the registry "cannot make a stale live verification
 * current". So every row carries its `verifiedAt` and both evidence refs on the
 * same line as its id, at the same weight — never folded into a details
 * disclosure that a hurried reader will skip.
 *
 * It is strictly read-only: there is no control here that writes anything, and
 * regenerating is deliberately not offered. `npm run ui:catalog` is the one
 * writer, and a surface that regenerated on demand would silently heal a stale
 * checkout — the exact failure the 2026-08-03 tracked-artifact lesson records.
 */
import { useEffect, useMemo, useState } from "react";
import { BookMarked, CircleAlert, ScanEye, X } from "lucide-react";
import type { UiCatalogWire } from "../../domain/dashboard/explorer.js";
import { matchesUiCatalogQuery } from "../../domain/dashboard/explorer.js";
import type { UiCatalogEntry } from "../../domain/ui/contracts.js";
import {
  Badge,
  Banner,
  Chip,
  EmptyState,
  IconButton,
  MetaLine,
  PanelHeader,
  PanelToolbar,
  SearchInput,
  SectionLabel,
  Spinner,
  Tab,
  TabList,
  TabPanel,
  TakeoverFrame,
  Tabs,
  dsIcon,
  dsText,
} from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import { RowCatalogView } from "./row-catalog.js";
import { parseCatalogView, type CatalogView } from "./row-catalog-model.js";
import { failed, loaded, LOADING, type AsyncResource } from "../state/async-resource.js";
import { DashboardClientError } from "../client/index.js";
import { useDashboardClient } from "../state/client-context.js";

/**
 * How loudly each entry kind is drawn.
 *
 * `observation` is the only tinted one: an observation is what a subject
 * binding and a write's completion proof are checked against (ref operator-trust §1.1), so
 * it is the kind whose staleness has consequences beyond a failed read.
 */
const ENTRY_KIND = {
  screen: { word: "Screen", tone: "neutral" },
  element: { word: "Element", tone: "neutral" },
  "page-state": { word: "Page state", tone: "neutral" },
  observation: { word: "Observation", tone: "info" },
} as const;

/**
 * A wrapping row of chips, packed rather than tracked.
 *
 * The DS's `ChipRow` lays chips on an equal-width GRID so a wrapped set ends on
 * one edge instead of leaving an orphan — which is exactly right in the queue's
 * ~400px column, where it was designed. These two surfaces are the other case:
 * a ~700px record column holding a dozen SHORT facts (`code pl`, `version 1`),
 * where `auto-fit` cuts seven 160px tracks and every chip sits alone at the
 * left of one. The shared ending edge is bought with gaps wide enough that the
 * set stops reading as a set. So the facts pack, and the ragged right edge is
 * the deliberate cost — the DS's own note already says a row that is not a
 * track of peers "is a flex row, and the chip is one item in it".
 */
function FactChips({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-[var(--ds-space-tight)]">
      {children}
    </div>
  );
}

function CatalogRow({ entry }: { entry: UiCatalogEntry }) {
  const kind = ENTRY_KIND[entry.kind];
  return (
    <li className="flex flex-col gap-[var(--ds-space-tight)] border-b border-[color:var(--ds-border-subtle)] py-[var(--ds-space-base)] last:border-b-0">
      <div className="flex flex-wrap items-center gap-[var(--ds-space-tight)]">
        <Badge tone={kind.tone}>{kind.word}</Badge>
        <span className={cn(dsText.ui, dsText.nums, "font-medium text-[color:var(--ds-fg)]")}>
          {entry.id}
        </span>
        <span className={cn(dsText.meta, "text-[color:var(--ds-fg-secondary)]")}>{entry.label}</span>
      </div>

      <FactChips>
        <Chip label="system">{entry.system}</Chip>
        {"screen" in entry && <Chip label="screen">{entry.screen}</Chip>}
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

      <FactChips>
        <Chip label="verified" icon={<ScanEye aria-hidden className={cn(dsIcon.sm, "shrink-0")} />}>
          {entry.verification.verifiedAt}
        </Chip>
        <Chip label="fixture">{entry.verification.fixtureEvidenceRef}</Chip>
        <Chip label="live">{entry.verification.liveReadOnlyEvidenceRef}</Chip>
        <Chip label="owner">{entry.sourceLink}</Chip>
      </FactChips>

      {entry.taskUses.length > 0 && (
        <FactChips>
          {entry.taskUses.map((taskId) => (
            <Chip key={String(taskId)} label="used by">{taskId}</Chip>
          ))}
        </FactChips>
      )}

      {/*
        THE SCENARIOS ARE NAMED, NOT COUNTED (D276 item 5, ledger 3 CA59).
        `ref operator-trust` §5.8's whole thesis is that provenance sits beside
        the id — and a count is the one shape of provenance that cannot be
        checked: "3 verification scenarios" is equally true of three scenarios
        that cover the write and three that cover nothing. The names are what
        the operator can act on, so they are printed.

        There is deliberately no empty arm: `UiCatalogVerificationSchema.scenarios`
        is `.min(1)`, so an entry with none cannot be served at all, and an arm
        that can never fire is a check that cannot fail.
      */}
      <MetaLine
        tone="faint"
        items={[
          `search: ${entry.searchTerms.join(" · ")}`,
          `verified by: ${entry.verification.scenarios.join(" · ")}`,
        ]}
      />
    </li>
  );
}

/**
 * The catalog takeover, in TWO views (D274 item 4 / D275 item 1).
 *
 * `selectors` is the generated selector-semantics catalog this surface has
 * always been. `vocabulary` is the row-and-panel reference the demo carries and
 * this tree had nowhere to put — it lives here rather than behind a third route
 * key because both answer "what does this system call the thing I am looking
 * at", and the view is route-owned (`?catalogView=`) for the same reason the
 * Archive's is: a door from elsewhere must be able to land on the actual panel
 * in one navigation, and a local state authority beside a URL is two answers to
 * one question.
 */
export function UiCatalogWorkspace({
  query,
  onQuery,
  view,
  onView,
  onClose,
}: {
  query: string;
  onQuery: (next: string) => void;
  view: CatalogView;
  onView: (next: CatalogView) => void;
  onClose: () => void;
}) {
  const client = useDashboardClient();
  const [resource, setResource] = useState<AsyncResource<UiCatalogWire>>(LOADING);

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
  /**
   * Grouped by system, in the catalog's own order within each group.
   *
   * Grouping is not decoration: an operator debugging a Kuali page has no use
   * for a CRM element between two of theirs, and the systems ARE the top-level
   * partition of the registries the catalog is composed from.
   */
  const groups = useMemo(() => {
    if (wire === undefined) return [];
    const bySystem = new Map<string, UiCatalogEntry[]>();
    for (const entry of wire.entries) {
      if (!matchesUiCatalogQuery(entry, query)) continue;
      const list = bySystem.get(entry.system) ?? [];
      list.push(entry);
      bySystem.set(entry.system, list);
    }
    return [...bySystem.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [wire, query]);

  const shown = groups.reduce((total, [, entries]) => total + entries.length, 0);

  return (
    /* UF-FU-1 / D275 item 2. Preserve the catalog's existing region name,
       while the shared frame owns full-bleed geometry, arrival and focus. */
    <TakeoverFrame label="UI catalog">
      <PanelHeader
        title="UI catalog"
        subtitle={
          view === "selectors"
            ? "The committed selector-semantics catalog, exactly as generated"
            : "The row and panel vocabulary, as this build serves it"
        }
        icon={<BookMarked aria-hidden className={dsIcon.lg} />}
        // The source path names the BYTES the selector view served. The
        // vocabulary view serves no artifact — it is derived from the schemas
        // in this bundle — so it names none rather than borrowing one.
        meta={view === "selectors" && wire !== undefined ? <span>{wire.sourcePath}</span> : undefined}
        actions={
          <IconButton
            size="sm"
            label="Close the UI catalog"
            icon={<X aria-hidden className={dsIcon.md} />}
            onClick={onClose}
          />
        }
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

        <TabPanel value="selectors" className="px-[var(--ds-space-cozy)] [&>*]:max-w-[var(--ds-w-explorer-measure)]">
        {/*
          The search and the entry count live INSIDE the tabpanel they filter.
          As a sibling of it they were content the `Selectors` tab's
          `aria-controls` did not name, so a reader who moved from the tab into
          its panel — which is exactly what `aria-controls` promises — arrived
          past the only control on the view. `sticky` keeps the geometry: the
          panel is the scroll container, so the toolbar holds the top it already
          held instead of scrolling away with the first system group.
        */}
        <PanelToolbar
          label="Search the UI catalog"
          className="sticky top-0 z-10 -mx-[var(--ds-space-cozy)] max-w-none bg-[var(--ds-surface-1)] px-[var(--ds-space-cozy)]"
        >
          <SearchInput
            className="w-full max-w-[28rem]"
            value={query}
            aria-label="Search the UI catalog by id, label, system or search term"
            placeholder="kuali save · observation · ucpath person org"
            onChange={(event) => onQuery(event.currentTarget.value)}
            onClear={() => onQuery("")}
          />
          {wire !== undefined && (
            <span className={cn(dsText.meta, dsText.nums, "shrink-0 text-[color:var(--ds-fg-muted)]")}>
              {shown === wire.entries.length
                ? `${String(wire.entries.length)} entries`
                : `${String(shown)} of ${String(wire.entries.length)} entries`}
            </span>
          )}
        </PanelToolbar>

        {resource.state === "loading" && (
          <div className="flex items-center gap-[var(--ds-space-tight)] py-[var(--ds-space-base)] text-[color:var(--ds-fg-muted)]">
            <Spinner label="Loading the UI catalog" />
            <span className={dsText.body}>Reading the committed catalog…</span>
          </div>
        )}

        {resource.state === "failed" && (
          // A stale artifact arrives here, carrying the generator's own
          // remediation. It is a refusal, not an outage: serving the stale
          // bytes would describe selectors this build does not use.
          <div className="py-[var(--ds-space-base)]">
            <Banner tone="danger" title="The committed UI catalog could not be served">
              {resource.error.message}
            </Banner>
          </div>
        )}

        {wire !== undefined && shown === 0 && (
          <EmptyState
            icon={<CircleAlert aria-hidden className={dsIcon.lg} />}
            title={`Nothing in the catalog matches “${query}”`}
            description={
              `All ${String(wire.entries.length)} entries were searched by id, label, system, kind `
              + "and registered search terms. Try one word — a system (kuali), a kind (observation), "
              + "or part of an id (timekeeper)."
            }
          />
        )}

        {groups.map(([system, entries]) => (
          <section key={system} aria-label={system} className="pt-[var(--ds-space-base)]">
            <SectionLabel>
              {system} · {String(entries.length)} entr{entries.length === 1 ? "y" : "ies"}
            </SectionLabel>
            <ul>
              {entries.map((entry) => <CatalogRow key={String(entry.id)} entry={entry} />)}
            </ul>
          </section>
        ))}
        </TabPanel>
      </Tabs>
    </TakeoverFrame>
  );
}
